'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay } = require('../common');

const BLACK_VAL = 1;
const WHITE_VAL = 2;

/** 八个方向：横、竖、斜 */
const REVERSI_DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
];

function createBoard(n) {
    return Array.from({ length: n }, () => Array(n).fill(0));
}

function copyBoard(board) {
    return board.map((row) => row.slice());
}

/**
 * 开局摆放：居中一块交错棋子。8/10 路 2×2，9/11 路 3×3，12 路 4×4。
 * 用户给出的图案按「屏幕从上到下」书写且左上角为白；服务器 row 0 在屏幕下方（与围棋一致），
 * 故纵向翻转后落盘，保证玩家看到的图与约定一致。
 */
function initialBoard(n) {
    const board = createBoard(n);
    const block = (n % 2 === 1) ? 3 : (n <= 10 ? 2 : 4);
    const top = Math.floor((n - block) / 2);
    for (let vr = 0; vr < block; vr++) {
        for (let c = 0; c < block; c++) {
            const row = top + (block - 1 - vr);
            board[row][top + c] = ((vr + c) % 2 === 0) ? WHITE_VAL : BLACK_VAL;
        }
    }
    return board;
}

/** 在 (row,col) 落子能翻转的对方棋子坐标；空数组表示非法着点 */
function reversiFlips(board, n, row, col, playerVal) {
    const flips = [];
    if (!Number.isInteger(row) || !Number.isInteger(col)) return flips;
    if (row < 0 || row >= n || col < 0 || col >= n) return flips;
    if (board[row][col] !== 0) return flips;
    const opp = playerVal === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
    for (const [dr, dc] of REVERSI_DIRS) {
        const line = [];
        let r = row + dr;
        let c = col + dc;
        while (r >= 0 && r < n && c >= 0 && c < n && board[r][c] === opp) {
            line.push([r, c]);
            r += dr;
            c += dc;
        }
        if (line.length && r >= 0 && r < n && c >= 0 && c < n && board[r][c] === playerVal) {
            for (const cell of line) flips.push(cell);
        }
    }
    return flips;
}

/** 该方是否还有合法着点 */
function reversiHasMove(board, n, playerVal) {
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === 0 && reversiFlips(board, n, r, c, playerVal).length > 0) return true;
        }
    }
    return false;
}

function countStones(board, n) {
    let black = 0;
    let white = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === BLACK_VAL) black++;
            else if (board[r][c] === WHITE_VAL) white++;
        }
    }
    return { black, white };
}

class ReversiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 8;
        this.resetToInitial();
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
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
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('player1') || !this.room.getPlayerBySlot('player2')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first,
            lastProposerSlot: null
        };
        const ws1 = this.room.getPlayerBySlot(first);
        const other = first === 'player1' ? 'player2' : 'player1';
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
        const other = slot === 'player1' ? 'player2' : 'player1';
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
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', now);
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
            const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
            return slot === expect;
        }
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
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
        const activeSlot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, activeSlot, Date.now());
        this._broadcastClock();
    }

    /** 该方是否还有合法着点 */
    hasMove(playerVal) {
        return reversiHasMove(this.board, this.boardSize, playerVal);
    }

    countStones() {
        return countStones(this.board, this.boardSize);
    }

    computeFinalWinner() {
        const { black, white } = this.countStones();
        if (black > white) return 'player1';
        if (white > black) return 'player2';
        return 'draw';
    }

    /** 终局：按子数判定并生成提示文案 */
    finishByCount() {
        const { black, white } = this.countStones();
        this.gameOver = true;
        this.winner = this.computeFinalWinner();
        this.recordResultText = `黑 ${black} : 白 ${white}，`
            + (this.winner === 'draw' ? '和棋' : (this.winner === 'player1' ? '黑胜' : '白胜'));
    }

    /**
     * 落子：必须能夹住至少一个对方子（否则非法）。
     * 落子后若对方无棋可下则「过手」由自己继续；双方都无棋可下即终局按子数判胜负。
     */
    applyMove(slot, row, col) {
        if (this.gameOver) return false;
        const playerVal = slot === 'player1' ? BLACK_VAL : WHITE_VAL;
        const expect = this.currentPlayer === BLACK_VAL ? 'player2' : 'player1';
        if (slot !== expect) return false;
        const n = this.boardSize;
        const flips = reversiFlips(this.board, n, row, col, playerVal);
        if (flips.length === 0) return false;

        this.historySnapshots.push(this.snapshot());

        this.board[row][col] = playerVal;
        for (const [r, c] of flips) this.board[r][c] = playerVal;
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col });
        this.lastMoveMarkers = [{ row, col, color: playerVal }];
        this.passNotice = null;

        const oppVal = playerVal === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        const oppCan = reversiHasMove(this.board, n, oppVal);
        const selfCan = reversiHasMove(this.board, n, playerVal);

        if (!oppCan && !selfCan) {
            this.finishByCount();
        } else if (oppCan) {
            this.currentPlayer = oppVal;
        } else {
            // 对方无棋可下 → 过手，自己继续下一手
            this.currentPlayer = playerVal;
            this.passNotice = oppVal === BLACK_VAL ? 'player2' : 'player1';
        }
        return true;
    }

    snapshot() {
        return {
            board: copyBoard(this.board),
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map((m) => ({ ...m })),
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            passNotice: this.passNotice,
            moveCoordsLen: this.moveCoords.length,
            moveHistoryLen: this.moveHistory.length
        };
    }

    restoreSnapshot(s) {
        this.board = copyBoard(s.board);
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = s.currentPlayer;
        this.lastMoveMarkers = s.lastMoveMarkers.map((m) => ({ ...m }));
        this.gameOver = s.gameOver;
        this.winner = s.winner;
        this.recordResultText = s.recordResultText != null ? s.recordResultText : null;
        this.passNotice = s.passNotice != null ? s.passNotice : null;
        this.moveCoords.length = s.moveCoordsLen;
        this.moveHistory.length = s.moveHistoryLen;
    }

    getState() {
        const counts = this.countStones();
        return {
            boardSize: this.boardSize,
            board: this.board,
            // 开局局面（棋谱回放/试下需要它作为起点，黑白棋开局即有子）
            openingBoard: this.openingBoard || initialBoard(this.boardSize),
            numberOfHands: this.moveCoords.length + 1,
            currentPlayer: this.currentPlayer,
            blackCount: counts.black,
            whiteCount: counts.white,
            passNotice: this.passNotice,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            // 终局文案随状态广播，客户端弹窗优先显示（如「黑 27 : 白 37，白胜」）
            recordResultText: this.gameOver ? this.recordResultText : null,
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
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    /** 重置为开局：棋盘摆上居中的交错棋子，黑先 */
    resetToInitial() {
        this.board = initialBoard(this.boardSize);
        this.openingBoard = copyBoard(this.board);
        this.currentPlayer = 1;
        this.recordResultText = null;
        this.passNotice = null;
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.moveHistory = [];
        this.historySnapshots = [];
        this.gameOver = false;
        this.winner = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    resetGame() {
        this.resetToInitial();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 12) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（支持 8–12 路）'} ));
            return false;
        }
        // 黑白棋开局即有子，故只以「有没有人入座 / 是否已落子」判断：空房才能改路数
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (this.moveCoords.length > 0 || hasPlayer) return false;
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.resetToInitial();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '黑白棋',
            gameId: 'reversi',
            boardSize: this.boardSize,
            moves: this.moveCoords.map((m) => `${m.player === 'player1' ? 'B' : 'W'}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'reversi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要黑白棋棋谱）。' }));
            return;
        }
        const n = data.boardSize || 8;
        if (!Number.isInteger(n) || n < 8 || n > 12) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效。' }));
            return;
        }

        this.boardSize = n;
        this.resetToInitial();

        const moves = (data.moves || []).map((entry) => {
            if (typeof entry !== 'string') return null;
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            const [r, c] = entry.slice(1).split(',').map(Number);
            return { player, row: r, col: c };
        }).filter(Boolean);

        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const expect = this.currentPlayer === BLACK_VAL ? 'player2' : 'player1';
            // 对方过手时棋谱里会跳过一手，此时轮到的一方仍是同一人，直接按 applyMove 判定即可
            if (m.player !== expect && this.hasMove(this.currentPlayer)) {
                this.resetToInitial();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (!this.applyMove(m.player, m.row, m.col)) {
                this.resetToInitial();
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
                const oppSlot = slot === 'player1' ? 'player2' : 'player1';
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
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) return;
                this.resetToInitial();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;
            default:
                break;
        }
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白胜' : '黑胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
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
        room.gameLogic = new ReversiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
