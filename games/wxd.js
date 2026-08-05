'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay } = require('../common');

function createBoard(n) {
    return Array.from({ length: n }, () => Array(n).fill(0));
}

function copyBoard(board) {
    return board.map((row) => row.slice());
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

class WxdRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 9;
        this.resetToEmpty();
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const snap = qiMatchTimeControl.snapshotForClient(this.tcClock);
        this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            const now = Date.now();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: lostSlot,
                    winner: winnerSlot,
                    ...this.getState()
                });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first,
            lastProposerSlot: null
        };
        const ws1 = this.room.getPlayerBySlot(first);
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws1) ws1.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'timeControlNegotiation',
            mode: 'respond',
            proposal: {
                ok: true,
                timed: proposal.timed,
                mainMinutes: proposal.mainMinutes,
                byoyomiSeconds: proposal.byoyomiSeconds,
                maxTimeouts: proposal.maxTimeouts
            }
        }));
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v;
        this.tcNego.lastProposerSlot = slot;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        const selfWs = this.room.getPlayerBySlot(slot);
        if (selfWs) selfWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
        this._sendRespondDialog(other, v);
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this.tcSettings = prop.timed
            ? {
                timed: true,
                mainMinutes: prop.mainMinutes,
                byoyomiSeconds: prop.byoyomiSeconds,
                maxTimeouts: prop.maxTimeouts
            }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', now);
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
        });
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) {
            const expect = this.currentPlayer === 1 ? 'black' : 'white';
            return slot === expect;
        }
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: lostSlot,
                winner: winnerSlot,
                ...this.getState()
            });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const activeSlot = this.currentPlayer === 1 ? 'black' : 'white';
        qiMatchTimeControl.setActiveSlot(this.tcClock, activeSlot, Date.now());
        this._broadcastClock();
    }

    getCenter() {
        const c = Math.floor(this.boardSize / 2);
        return { row: c, col: c };
    }

    generateWeights() {
        const n = this.boardSize;
        const total = n * n;
        const vals = shuffle(Array.from({ length: total - 1 }, (_, i) => i + 1));
        const weights = Array.from({ length: n }, () => Array(n).fill(0));
        const center = this.getCenter();
        let idx = 0;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (r === center.row && c === center.col) {
                    weights[r][c] = 0;
                } else {
                    weights[r][c] = vals[idx++];
                }
            }
        }
        return weights;
    }

    isAdjacent8(a, b) {
        const dr = Math.abs(a.row - b.row);
        const dc = Math.abs(a.col - b.col);
        return (dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0));
    }

    canPlayerMove(slot) {
        const n = this.boardSize;
        const from = this.lastByPlayer[slot] || this.getCenter();
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = from.row + dr;
                const nc = from.col + dc;
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                if (this.board[nr][nc] !== 0) continue;
                if (nr === this.center.row && nc === this.center.col) continue;
                return true;
            }
        }
        return false;
    }

    computeFinalWinner() {
        const black = this.blackScore;
        const white = this.whiteScore + this.komi;
        if (black > white) return 'black';
        if (white > black) return 'white';
        return 'draw';
    }

    applyMove(slot, row, col) {
        if (this.gameOver) return false;
        const playerVal = slot === 'black' ? 1 : 2;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        if (slot !== expect) return false;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return false;
        if (this.board[row][col] !== 0) return false;
        if (row === this.center.row && col === this.center.col) return false;
        const from = this.lastByPlayer[slot] || this.center;
        if (!this.isAdjacent8(from, { row, col })) return false;

        this.historySnapshots.push(this.snapshot());

        this.board[row][col] = playerVal;
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col });
        this.lastByPlayer[slot] = { row, col };
        if (slot === 'black') this.blackScore += this.weights[row][col];
        else this.whiteScore += this.weights[row][col];
        this.lastMoveMarkers = this.buildLastMoveMarkers();

        const other = slot === 'black' ? 'white' : 'black';
        const selfCan = this.canPlayerMove(slot);
        const otherCan = this.canPlayerMove(other);

        if (!selfCan && !otherCan) {
            this.gameOver = true;
            this.winner = this.computeFinalWinner();
        } else if (otherCan) {
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        } else {
            this.currentPlayer = this.currentPlayer;
        }
        return true;
    }

    buildLastMoveMarkers() {
        const out = [];
        if (this.lastByPlayer.black) out.push({ ...this.lastByPlayer.black, color: 1 });
        if (this.lastByPlayer.white) out.push({ ...this.lastByPlayer.white, color: 2 });
        return out;
    }

    snapshot() {
        return {
            board: copyBoard(this.board),
            currentPlayer: this.currentPlayer,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            lastByPlayer: {
                black: this.lastByPlayer.black ? { ...this.lastByPlayer.black } : null,
                white: this.lastByPlayer.white ? { ...this.lastByPlayer.white } : null
            },
            lastMoveMarkers: this.lastMoveMarkers.map((m) => ({ ...m })),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoordsLen: this.moveCoords.length,
            moveHistoryLen: this.moveHistory.length
        };
    }

    restoreSnapshot(s) {
        this.board = copyBoard(s.board);
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = s.currentPlayer;
        this.blackScore = s.blackScore;
        this.whiteScore = s.whiteScore;
        this.lastByPlayer = {
            black: s.lastByPlayer.black ? { ...s.lastByPlayer.black } : null,
            white: s.lastByPlayer.white ? { ...s.lastByPlayer.white } : null
        };
        this.lastMoveMarkers = s.lastMoveMarkers.map((m) => ({ ...m }));
        this.gameOver = s.gameOver;
        this.winner = s.winner;
        this.moveCoords.length = s.moveCoordsLen;
        this.moveHistory.length = s.moveHistoryLen;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            weights: this.weights,
            center: this.center,
            komi: this.komi,
            numberOfHands: this.moveCoords.length + 1,
            currentPlayer: this.currentPlayer,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    resetToEmpty() {
        this.center = this.getCenter();
        this.board = createBoard(this.boardSize);
        this.weights = this.generateWeights();
        this.currentPlayer = 1;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.komi = Math.floor(0.01 * ((this.boardSize * this.boardSize - 1) * this.boardSize * this.boardSize / 2));
        this.lastByPlayer = { black: null, white: null };
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.moveHistory = [];
        this.historySnapshots = [];
        this.gameOver = false;
        this.winner = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    resetGame() {
        this.resetToEmpty();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 3 || newSize > 21 || newSize % 2 === 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效'} ));
            return false;
        }
        const hasAnyStone = this.board.some((row) => row.some((v) => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: 'WxD棋',
            gameId: 'wxd',
            boardSize: this.boardSize,
            weights: this.weights.map((row) => row.slice()),
            moves: this.moveCoords.map((m) => `${m.player === 'black' ? 'B' : 'W'}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'wxd') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要WxD棋棋谱）。' }));
            return;
        }
        const n = data.boardSize || 9;
        if (!Number.isInteger(n) || n < 3 || n > 21 || n % 2 === 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效。' }));
            return;
        }

        this.boardSize = n;
        this.resetToEmpty();
        if (Array.isArray(data.weights) && data.weights.length === n && data.weights.every((row) => Array.isArray(row) && row.length === n)) {
            this.weights = data.weights.map((row) => row.slice());
        }

        const moves = (data.moves || []).map((entry) => {
            if (typeof entry !== 'string') return null;
            const player = entry[0] === 'B' ? 'black' : 'white';
            const [r, c] = entry.slice(1).split(',').map(Number);
            return { player, row: r, col: c };
        }).filter(Boolean);

        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const expect = this.currentPlayer === 1 ? 'black' : 'white';
            if (m.player !== expect && this.canPlayerMove(expect)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (!this.applyMove(m.player, m.row, m.col)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.gameOver) break;
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }
        this.broadcast({ type: 'importSuccess', ...this.getState(), replayData: { moves: this.moveCoords.map((m) => ({ ...m })) } });
    }

    performUndo(steps) {
        if (!Number.isInteger(steps) || steps <= 0) return;
        if (this.historySnapshots.length < steps) return;
        for (let i = 0; i < steps; i++) {
            const snap = this.historySnapshots.pop();
            this.restoreSnapshot(snap);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;
        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;
            case 'setBoardSize':
                if (!slot && !this.room.players.size) this.setBoardSize(msg.size, ws);
                break;
            case 'move': {
                if (!slot || this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!this.applyMove(slot, msg.row, msg.col)) return;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                if (this.gameOver) this._stopClockTicker();
                else this._syncClockAfterTurnChange();
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps <= 0 || steps > this.historySnapshots.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const oppSlot = slot === 'black' ? 'white' : 'black';
                const opp = room.getPlayerBySlot(oppSlot);
                if (!opp) this.performUndo(steps);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opp.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }
            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;
            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver) this._stopClockTicker();
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                if (this.gameOver) this._stopClockTicker();
                break;
            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;
            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;
            default:
                break;
        }
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白胜' : '黑胜';
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }

    afterColorAssigned(_ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new WxdRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
