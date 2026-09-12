'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay } = require('../common');

const BLACK_VAL = 1;
const WHITE_VAL = 2;

/** 棋盘固定 5×5 */
const SIZE = 5;

/** 八个方向：横、竖、斜 */
const NEUTREEKO_DIRS = [
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

function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/**
 * 初始局面（row 0 在下、白方在下；列 A–E = 0–4）：
 *   白 B1 D1（己方底行第 2、4 列）+ C4（黑方次底行正中）
 *   黑 B5 D5（己方底行第 2、4 列）+ C2（白方次底行正中）
 * 即：白 (0,1) (0,3) (3,2)，黑 (4,1) (4,3) (1,2)
 */
function initialBoard() {
    const b = createBoard(SIZE);
    b[0][1] = WHITE_VAL; b[0][3] = WHITE_VAL; b[3][2] = WHITE_VAL;
    b[4][1] = BLACK_VAL; b[4][3] = BLACK_VAL; b[1][2] = BLACK_VAL;
    return b;
}

/**
 * 一枚棋子的全部落点：沿横/竖/斜滑到该方向最远的连续空格。
 * 途中必须全是空格且不能中途停下，故每个方向至多一个落点；紧邻有子或出界则该方向不可走。
 */
function movesOf(board, row, col) {
    const out = [];
    if (!inBounds(row, col)) return out;
    for (const [dr, dc] of NEUTREEKO_DIRS) {
        if (!inBounds(row + dr, col + dc) || board[row + dr][col + dc] !== 0) continue;
        let lr = row + dr;
        let lc = col + dc;
        while (inBounds(lr + dr, lc + dc) && board[lr + dr][lc + dc] === 0) {
            lr += dr;
            lc += dc;
        }
        out.push({ fromRow: row, fromCol: col, toRow: lr, toCol: lc });
    }
    return out;
}

/** 某方全部合法着法 */
function legalMoves(board, sideVal) {
    const out = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] !== sideVal) continue;
            for (const m of movesOf(board, r, c)) out.push(m);
        }
    }
    return out;
}

function hasMove(board, sideVal) {
    return legalMoves(board, sideVal).length > 0;
}

/** 该方三子是否相邻连成一线（横/竖/斜，中间不能有空格） */
function hasLine(board, sideVal) {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === sideVal) cells.push([r, c]);
        }
    }
    if (cells.length < 3) return false;
    cells.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const [a, b, c] = cells.slice(0, 3);
    const dr = c[0] - a[0];
    const dc = c[1] - a[1];
    const okSpan = (dr === 2 && dc === 0) || (dr === 0 && dc === 2)
        || (dr === 2 && dc === 2) || (dr === 2 && dc === -2);
    if (!okSpan) return false;
    return (b[0] - a[0] === dr / 2) && (b[1] - a[1] === dc / 2);
}

function positionKey(board, currentPlayer) {
    return board.map((row) => row.join('')).join('/') + '#' + currentPlayer;
}

/** 三次重复局面判和 */
function judgeRepetition(historyKeys) {
    if (!historyKeys || !historyKeys.length) return false;
    const last = historyKeys[historyKeys.length - 1];
    let cnt = 0;
    for (const k of historyKeys) if (k === last) cnt++;
    return cnt >= 3;
}

class NeutreekoRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = SIZE;
        this.resetToInitial();
        this.pendingUndo = null;
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.moveHistory = [];
        this.historySnapshots = [];
        this.matchStarted = false;
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = lostSlot === 'player2' ? 'player1' : 'player2';
                this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player2;
        const tw = this.slotJoinedAt.player1;
        if (tb == null || tw == null) return 'player2';
        return tb <= tw ? 'player2' : 'player1';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('player2') || !this.room.getPlayerBySlot('player1')) return;
        if (this.tcNego || this.tcSettings) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'player2' ? 'player1' : 'player2';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'respond', proposal }));
    }

    _finishTimeControl(proposal) {
        this.tcSettings = proposal.timed
            ? { timed: true, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === BLACK_VAL ? 'player2' : 'player1', Date.now());
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
        this.broadcast({ type: 'gameState', ...this.getState() });
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
        this.tcNego.phase = 'respond';
        this.tcNego.waitingSlot = slot === 'player2' ? 'player1' : 'player2';
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        this._sendRespondDialog(this.tcNego.waitingSlot, {
            ok: true,
            timed: v.timed,
            mainMinutes: v.mainMinutes,
            byoyomiSeconds: v.byoyomiSeconds,
            maxTimeouts: v.maxTimeouts
        });
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const p = this.tcNego.proposal;
        if (!p || !p.ok) return;
        this._finishTimeControl(p);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === (this.currentPlayer === BLACK_VAL ? 'player2' : 'player1');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== (this.currentPlayer === BLACK_VAL ? 'player2' : 'player1')) return true;
        const { lostSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = lostSlot === 'player2' ? 'player1' : 'player2';
            this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === BLACK_VAL ? 'player2' : 'player1', Date.now());
        this._broadcastClock();
    }

    hasMove(playerVal) {
        return hasMove(this.board, playerVal);
    }

    /**
     * 走子：沿横/竖/斜滑到最远空格。走完依次判定
     * 1 自己三子相邻成线 → 胜；2 对方无子可动 → 胜；3 三次重复局面 → 和。
     */
    applyMove(slot, fromRow, fromCol, toRow, toCol) {
        if (this.gameOver) return false;
        const mine = slot === 'player2' ? BLACK_VAL : WHITE_VAL;
        if (this.currentPlayer !== mine) return false;
        if (!inBounds(fromRow, fromCol) || this.board[fromRow][fromCol] !== mine) return false;
        const legal = movesOf(this.board, fromRow, fromCol)
            .some((m) => m.toRow === toRow && m.toCol === toCol);
        if (!legal) return false;

        this.historySnapshots.push(this.snapshot());

        this.board[fromRow][fromCol] = 0;
        this.board[toRow][toCol] = mine;
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, fromRow, fromCol, toRow, toCol });
        this.lastMoveMarkers = [
            { row: fromRow, col: fromCol, color: mine },
            { row: toRow, col: toCol, color: mine }
        ];

        const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        this.historyKeys.push(positionKey(this.board, opp));

        if (hasLine(this.board, mine)) {
            this.gameOver = true;
            this.winner = slot;
            this.recordResultText = slot === 'player2' ? '黑胜' : '白胜';
            return true;
        }
        if (!hasMove(this.board, opp)) {
            this.gameOver = true;
            this.winner = slot;
            this.recordResultText = slot === 'player2' ? '白方无子可动，黑胜' : '黑方无子可动，白胜';
            return true;
        }
        if (judgeRepetition(this.historyKeys)) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '三次重复局面，和棋';
            return true;
        }
        this.currentPlayer = opp;
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
            historyKeys: this.historyKeys.slice(),
            moveCoordsLen: this.moveCoords.length,
            moveHistoryLen: this.moveHistory.length
        };
    }

    restoreSnapshot(s) {
        this.board = copyBoard(s.board);
        if (this.openingBoard === undefined) this.openingBoard = copyBoard(this.board);
        this.currentPlayer = s.currentPlayer;
        this.lastMoveMarkers = s.lastMoveMarkers.map((m) => ({ ...m }));
        this.gameOver = s.gameOver;
        this.winner = s.winner;
        this.recordResultText = s.recordResultText != null ? s.recordResultText : null;
        this.historyKeys = (s.historyKeys || []).slice();
        this.moveCoords.length = s.moveCoordsLen;
        this.moveHistory.length = s.moveHistoryLen;
    }

    /** 聊天/棋谱里显示的执方名：这些棋种白方先行，player1 座执白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '白方' : (slot === 'player2' ? '黑方' : String(slot));
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            // 开局局面（棋谱回放/试下需要它作为起点，结子棋开局即有子）
            openingBoard: this.openingBoard || initialBoard(),
            numberOfHands: this.moveCoords.length + 1,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
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
                player2: !!this.room.getPlayerBySlot('player2'),
                player1: !!this.room.getPlayerBySlot('player1')
            }
        };
    }

    /** 重置为开局：白方三子在下、黑方三子在上，白先 */
    resetToInitial() {
        this.board = initialBoard();
        this.openingBoard = copyBoard(this.board);
        this.currentPlayer = WHITE_VAL;
        this.recordResultText = null;
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.moveHistory = [];
        this.historySnapshots = [];
        this.historyKeys = [positionKey(this.board, this.currentPlayer)];
        this.pendingUndo = null;
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.gameOver = false;
        this.winner = null;
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    /** 编辑盘面后：白先（本棋种白方先行），并重置重复局面记录 */
    afterEditBoard() {
        this.currentPlayer = WHITE_VAL;
        this.lastMoveMarkers = [];
        this.historyKeys = [positionKey(this.board, this.currentPlayer)];
    }

    resetGame() {
        this.resetToInitial();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player2: false, player1: false } });
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '结子棋',
            gameId: 'neutreeko',
            boardSize: this.boardSize,
            moves: this.moveCoords.map((m) => `${m.player === 'player2' ? 'B' : 'W'}`
                + `${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`),
            result: this.gameOver ? this.winner : null,
            resultText: this.recordResultText
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'neutreeko') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要结子棋棋谱）。' }));
            return;
        }
        this.resetToInitial();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            if (typeof entry === 'string') {
                const m = entry.match(/^([WB])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!m) {
                    this.resetToInitial();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'player2' : 'player1';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
            }
            const expect = this.currentPlayer === BLACK_VAL ? 'player2' : 'player1';
            if (player !== expect) {
                this.resetToInitial();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (!this.applyMove(player, fromRow, fromCol, toRow, toCol)) {
                this.resetToInitial();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.gameOver) break;
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'player2' || /白胜/.test(rt)) this.winner = 'player2';
            else if (data.result === 'player1' || /黑胜/.test(rt)) this.winner = 'player1';
            else this.winner = data.result;
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { moves: this.moveCoords.map((m) => ({ ...m })) }
        });
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
            case 'move': {
                if (!slot || this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!this.applyMove(slot, msg.fromRow, msg.fromCol, msg.toRow, msg.toCol)) return;
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
                const oppSlot = slot === 'player2' ? 'player1' : 'player2';
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
                if (this.room.getPlayerBySlot('player2') || this.room.getPlayerBySlot('player1')) return;
                this.resetToInitial();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;
            default:
                break;
        }
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player2' ? '白胜' : '黑胜';
    }

    onDrawResolved() {
        this.recordResultText = '双方同意作和';
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
        room.gameLogic = new NeutreekoRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    NeutreekoEngine: { SIZE, initialBoard, legalMoves, hasMove, hasLine, movesOf, positionKey }
};
