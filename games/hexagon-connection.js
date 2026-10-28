'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay,
    encodeInitialPositionCompact, applyInitialPositionCompact } = require('../common');

// Keep these rules identical to public/room-plugins/hexagon-connection-rooms.js.
const hexagonConnectionRules = (() => {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1]];
    const empty = n => Array.from({ length: n }, () => Array(n).fill(0));
    const copy = board => board.map(row => row.slice());
    const valid = (n, r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < n && c < n;
    function place(board, row, col, color) {
        if ((color !== 1 && color !== 2) || !valid(board.length, row, col) || board[row][col] !== 0) return null;
        const next = copy(board);
        next[row][col] = color;
        return next;
    }
    function winningPath(board, color) {
        if ((color !== 1 && color !== 2) || !board.length) return [];
        const n = board.length, queue = [], parents = new Int32Array(n * n).fill(-2);
        for (let i = 0; i < n; i++) {
            const r = color === 1 ? 0 : i, c = color === 1 ? i : 0;
            if (board[r][c] === color) { const id = r * n + c; parents[id] = -1; queue.push(id); }
        }
        for (let index = 0; index < queue.length; index++) {
            const id = queue[index], r = Math.floor(id / n), c = id % n;
            if (color === 1 ? r === n - 1 : c === n - 1) {
                const path = [];
                for (let p = id; p >= 0; p = parents[p]) path.push([Math.floor(p / n), p % n]);
                return path.reverse();
            }
            for (const [dr, dc] of directions) {
                const nr = r + dr, nc = c + dc, next = nr * n + nc;
                if (valid(n, nr, nc) && parents[next] === -2 && board[nr][nc] === color) {
                    parents[next] = id; queue.push(next);
                }
            }
        }
        return [];
    }
    return { directions, empty, copy, valid, place, winningPath };
})();

class HexagonConnectionRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 11;
        this.resetToEmpty();
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.board = hexagonConnectionRules.empty(this.boardSize);
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingUndo = this.pendingNewGame = this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = this.tcSettings = this.tcClock = null;
        this.matchStarted = false;
    }

    _stopClockTicker() {
        if (this._clockInterval) clearInterval(this._clockInterval);
        this._clockInterval = null;
    }
    _broadcastClock() {
        if (this.tcClock && this.tcClock.timed && !this.gameOver)
            this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }
    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this._clockInterval = setInterval(() => {
            if (this.tcClock && this.tcClock.timed && !this.gameOver) this._drainClockBeforeMove();
        }, 1000);
    }
    _drainClockBeforeMove() {
        if (!this.tcClock || !this.tcClock.timed) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) { this._broadcastClock(); return true; }
        this.gameOver = true; this.winner = winnerSlot;
        this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
        this._stopClockTicker();
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }
    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }
    _firstPickerSlot() {
        const b = this.slotJoinedAt.player1, w = this.slotJoinedAt.player2;
        return b == null || w == null || b <= w ? 'player1' : 'player2';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        return !this.gameOver && this.matchStarted && !this.tcNego && this.tcSettings != null
            && slot === (this.currentPlayer === 1 ? 'player1' : 'player2');
    }
    tryPlaceStone(board, r, c, color) { return hexagonConnectionRules.place(board, r, c, color); }
    onMatchStarted() {
        for (const color of [1, 2]) if (hexagonConnectionRules.winningPath(this.board, color).length) {
            this.gameOver = true; this.winner = color === 1 ? 'player1' : 'player2';
            this.recordResultText = color === 1 ? '黑方连通两边，黑胜' : '白方连通两边，白胜';
            this._stopClockTicker(); return;
        }
    }
    getMoveCount() { return this.moveHistory.length; }
    getState() {
        return { board: this.board, boardSize: this.boardSize, currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1, moveCoords: this.moveHistory.map(m => ({ ...m })),
            lastMoveMarkers: this.lastMoveMarkers, gameOver: this.gameOver, winner: this.winner,
            recordResultText: this.recordResultText, matchStarted: this.matchStarted,
            matchTime: { negotiation: this.tcNego, settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null },
            slots: { player1: !!this.room.getPlayerBySlot('player1'), player2: !!this.room.getPlayerBySlot('player2') } };
    }
    setBoardSize(size, ws) {
        if (!Number.isInteger(size) || size < 3 || size > 21) {
            ws.send(JSON.stringify({ type: 'error', message: '棋盘大小须为3～21路。' })); return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {
            ws.send(JSON.stringify({ type: 'error', message: '已有多人落座，不能修改棋盘大小。' })); return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = size; this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: size });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }
    exportRecord() {
        return { format: 'muzei', version: 2, gameType: '六贯棋', gameId: 'hexagon-connection', boardSize: this.boardSize,
            initialPosition: encodeInitialPositionCompact(this.openingBoard, this.boardSize),
            moves: this.moveHistory.map(m => `${m.player === 'player1' ? 'B' : 'W'}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null, resultText: this.recordResultText,
            timeControl: this.tcSettings ? { enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.mainMinutes || 0, byoyomiSeconds: this.tcSettings.byoyomiSeconds || 0,
                maxTimeouts: this.tcSettings.maxTimeouts || 0 } : null };
    }
    importRecord(data, ws) {
        const fail = message => ws.send(JSON.stringify({ type: 'error', message }));
        if (!data || data.gameId !== 'hexagon-connection' || !Array.isArray(data.moves)) return fail('需要六贯棋棋谱。');
        const size = data.boardSize == null ? 11 : data.boardSize;
        if (!Number.isInteger(size) || size < 3 || size > 21) return fail('棋谱中棋盘大小无效。');
        const opening = hexagonConnectionRules.empty(size);
        if (data.initialPosition != null && (!Array.isArray(data.initialPosition) || data.initialPosition.some(s => {
            const m = typeof s === 'string' && /^([BW])(\d+),(\d+)$/.exec(s);
            return !m || !hexagonConnectionRules.valid(size, Number(m[2]), Number(m[3]));
        }))) return fail('棋谱中的初始盘面无效。');
        applyInitialPositionCompact(opening, size, data.initialPosition);
        const history = [], boards = [];
        let board = this.copyBoard(opening), color = 1;
        for (let i = 0; i < data.moves.length; i++) {
            const raw = data.moves[i], match = typeof raw === 'string' && /^([BW])(\d+),(\d+)$/.exec(raw);
            const move = match ? { row: Number(match[2]), col: Number(match[3]), player: match[1] === 'B' ? 'player1' : 'player2' } : raw;
            const slot = color === 1 ? 'player1' : 'player2';
            const next = move && (!move.type || move.type === 'move') && move.player === slot
                && hexagonConnectionRules.place(board, move.row, move.col, color);
            if (!next) return fail(`棋谱第${i + 1}手无效（六贯棋不能虚着、换先或重复落子）。`);
            boards.push(board); board = next;
            history.push({ type: 'move', player: slot, row: move.row, col: move.col });
            color = 3 - color;
        }
        this.boardSize = size; this.resetToEmpty();
        this.openingBoard = opening; this.board = board;
        this.historyBoards = boards; this.moveHistory = history; this.currentPlayer = color;
        const last = history.at(-1);
        this.lastMoveMarkers = last ? [{ row: last.row, col: last.col, color: 3 - color }] : [];
        // Import follows the site's policy: recorded results take precedence.
        if (['player1', 'player2', 'draw'].includes(data.result)) {
            this.gameOver = true; this.winner = data.result;
            this.recordResultText = data.resultText ? String(data.resultText) : null;
        }
        this.matchStarted = history.length > 0;
        if (this.matchStarted) this.tcSettings = { timed: false };
        this.broadcast({ type: 'importSuccess', ...this.getState(), replayData: this.exportRecord() });
    }
    performUndoSteps(steps) {
        if (!Number.isInteger(steps) || steps < 1 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) { this.board = this.historyBoards.pop(); this.moveHistory.pop(); }
        this.currentPlayer = this.moveHistory.length % 2 ? 2 : 1;
        const last = this.moveHistory.at(-1);
        this.lastMoveMarkers = last ? [{ row: last.row, col: last.col, color: last.player === 'player1' ? 1 : 2 }] : [];
        this.gameOver = false; this.winner = null; this.recordResultText = null;
        this._syncClockAfterTurnChange();
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }
    onResignResolved(slot) { this.recordResultText = slot === 'player1' ? '白中盘胜' : '黑中盘胜'; }
    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor': return qiProtocol.selectColor(this, ws, msg);
            case 'timeControlSubmit': return this._handleTimeControlSubmit(ws, msg);
            case 'timeControlAccept': return this._handleTimeControlAccept(ws);
            case 'setBoardSize': return qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
            case 'exportRecord': return qiProtocol.exportRecord(this, ws);
            case 'importRecord': return qiProtocol.importRecord(this, ws, msg);
            case 'resetRoom': return qiProtocol.resetRoomToEmpty(this, ws);
            case 'move': {
                if (!this._timeAllowsPlay(slot)) return;
                const next = this.tryPlaceStone(this.board, msg.row, msg.col, this.currentPlayer);
                if (!next || !this._drainClockBeforeMove()) return;
                this.historyBoards.push(this.board); this.board = next;
                this.moveHistory.push({ type: 'move', player: slot, row: msg.row, col: msg.col });
                this.lastMoveMarkers = [{ row: msg.row, col: msg.col, color: this.currentPlayer }];
                if (hexagonConnectionRules.winningPath(this.board, this.currentPlayer).length) {
                    this.gameOver = true; this.winner = slot;
                    this.recordResultText = this.currentPlayer === 1 ? '黑方连通两边，黑胜' : '白方连通两边，白胜';
                    this._stopClockTicker();
                }
                this.currentPlayer = 3 - this.currentPlayer;
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                return;
            }
            case 'pass': case 'swap':
                if (slot) ws.send(JSON.stringify({ type: 'error', message: '六贯棋不允许虚着或换先。' }));
                return;
            case 'requestUndo': return qiProtocol.undoWuziqiHistory(this, ws, msg, slot);
            case 'undoResponse': return qiProtocol.undoResponseWuziqiHistory(this, ws, msg);
            case 'resign': qiProtocol.resign(this, ws, slot); if (this.gameOver) this._stopClockTicker(); return;
            case 'requestNewGame': return qiProtocol.requestNewGame(this, ws, slot);
            case 'newGameResponse': return qiProtocol.newGameResponse(this, ws, msg);
            case 'requestDraw': return qiProtocol.requestDraw(this, ws, slot);
            case 'drawResponse': return qiProtocol.drawResponse(this, ws, msg, {
                onDrawResolved: () => { this.recordResultText = '双方同意和棋'; this._stopClockTicker(); }
            });
            default: return;
        }
    }
    resetGame() {
        this.resetToEmpty(); qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }
    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) { this.slotJoinedAt[slot] = null; this.broadcast({ type: 'playerLeft', slot }); }
        if (this.tcNego) { this.tcNego = null; this.broadcast({ type: 'timeControlReset', reason: 'playerLeft' }); }
    }
}

module.exports = { hexagonConnectionRules, HexagonConnectionRoom, initRoom(room) {
    room.gameLogic = new HexagonConnectionRoom(room);
    qiBoardSeatOverlay.install(room.gameLogic);
    qiProtocol.installStandardEditBoard(room.gameLogic);
    const submitTime = room.gameLogic._handleTimeControlSubmit;
    room.gameLogic._handleTimeControlSubmit = function (ws, msg) {
        return submitTime.call(this, ws, { ...msg, handicap: 0 });
    };
    room.maxPlayers = 2;
} };
