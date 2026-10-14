'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay } = require('../common');

const BLACK_VAL = 1;
const WHITE_VAL = 2;

const SIZE_MIN = 6;
const SIZE_MAX = 10;

/* ---------- 六角棋盘几何（与非四角围棋「六角形三角」子棋类同一套） ----------
 * 路数 n：行数 ROWS = 2n-1，第 r 行格数 rowLen(r) = n + min(r, 2n-2-r)。
 * 总格点 3n²-3n+1（6 路 91 格、10 路 271 格）。
 * 显示朝向：客户端把 row 0 画在屏幕最下方（y = TOP_Y + (ROWS-1-r)*DY），
 * 所以 r 越大越靠上；中心格 = (n-1, n-1)。
 */
const rowsOf = (n) => n * 2 - 1;
const rowLenOf = (n, r) => n + Math.min(r, 2 * n - 2 - r);
const isValidCoord = (n, r, c) => r >= 0 && r < rowsOf(n) && c >= 0 && c < rowLenOf(n, r);

/** 六角盘的 6 个方向：把点写成「加倍坐标」X = 2c-(rowLen(r)-1)、y = r 后就是常量向量（= 3 条轴） */
const HEX_DIRS = [
    [2, 0], [-2, 0],
    [1, 1], [-1, 1],
    [1, -1], [-1, -1]
];

/** 加倍坐标 → (r,c)；出界或不对齐返回 null */
function fromDoubled(n, X, y) {
    if (y < 0 || y >= rowsOf(n)) return null;
    const len = rowLenOf(n, y);
    const c = (X + len - 1) / 2;
    if (!Number.isInteger(c) || c < 0 || c >= len) return null;
    return [y, c];
}

function createBoard(n) {
    return Array.from({ length: rowsOf(n) }, (_, r) => Array(rowLenOf(n, r)).fill(0));
}

function copyBoard(board) {
    return board.map((row) => row.slice());
}

/**
 * 开局座子：天元（中心点）周围的六个点间隔摆子，白黑各三。
 * 按屏幕方位：左上/左下/右 = 白；右上/右下/左 = 黑（r 越大越靠上，故「上」= r+1）。
 */
function initialBoard(n) {
    const board = createBoard(n);
    const r = n - 1;
    const c = n - 1;
    board[r + 1][c - 1] = WHITE_VAL;   // 左上
    board[r - 1][c - 1] = WHITE_VAL;   // 左下
    board[r][c + 1] = WHITE_VAL;       // 右
    board[r + 1][c] = BLACK_VAL;       // 右上
    board[r - 1][c] = BLACK_VAL;       // 右下
    board[r][c - 1] = BLACK_VAL;       // 左
    return board;
}

/** 在 (row,col) 落子能翻转的对方棋子坐标；空数组表示非法着点 */
function reversiFlips(board, n, row, col, playerVal) {
    const flips = [];
    if (!Number.isInteger(row) || !Number.isInteger(col)) return flips;
    if (!isValidCoord(n, row, col)) return flips;
    if (board[row][col] !== 0) return flips;
    const opp = playerVal === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
    const X0 = 2 * col - (rowLenOf(n, row) - 1);
    for (const [dX, dy] of HEX_DIRS) {
        const line = [];
        let X = X0 + dX;
        let y = row + dy;
        let cur = fromDoubled(n, X, y);
        while (cur && board[cur[0]][cur[1]] === opp) {
            line.push(cur);
            X += dX;
            y += dy;
            cur = fromDoubled(n, X, y);
        }
        if (line.length && cur && board[cur[0]][cur[1]] === playerVal) {
            for (const cell of line) flips.push(cell);
        }
    }
    return flips;
}

/** 该方是否还有合法着点 */
function reversiHasMove(board, n, playerVal) {
    for (let r = 0; r < rowsOf(n); r++) {
        for (let c = 0; c < rowLenOf(n, r); c++) {
            if (board[r][c] === 0 && reversiFlips(board, n, r, c, playerVal).length > 0) return true;
        }
    }
    return false;
}

function countStones(board, n) {
    let black = 0;
    let white = 0;
    for (let r = 0; r < rowsOf(n); r++) {
        for (let c = 0; c < rowLenOf(n, r); c++) {
            if (board[r][c] === BLACK_VAL) black++;
            else if (board[r][c] === WHITE_VAL) white++;
        }
    }
    return { black, white };
}

class TriangleReversiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = SIZE_MIN;   // 路数（6–10，默认 6）
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

    get ROWS() {
        return rowsOf(this.boardSize);
    }

    rowLen(r) {
        return rowLenOf(this.boardSize, r);
    }

    isValidCoord(r, c) {
        return isValidCoord(this.boardSize, r, c);
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

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
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
        if (this.importReplayNoJudge) return;
        const { black, white } = this.countStones();
        this.gameOver = true;
        this.winner = this.computeFinalWinner();
        this.recordResultText = `黑 ${black} : 白 ${white}，`
            + (this.winner === 'draw' ? '和棋' : (this.winner === 'player1' ? '黑胜' : '白胜'));
    }

    /**
     * 落子：必须能夹住至少一个对方子（否则非法），夹吃沿六角盘的 6 个方向。
     * 落子后若对方无棋可下则「过手」由自己继续；双方都无棋可下即终局按子数判胜负。
     */
    applyMove(slot, row, col) {
        if (this.gameOver) return false;
        const playerVal = slot === 'player1' ? BLACK_VAL : WHITE_VAL;
        // currentPlayer 是「该谁走」的色值（1 黑 2 白），与 _timeAllowsPlay 同口径
        const expect = this.currentPlayer === BLACK_VAL ? 'player1' : 'player2';
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
            // 对方无棋可下 → 过手，自己继续下一手（passNotice = 过手那一方的座位）
            this.currentPlayer = playerVal;
            this.passNotice = oppVal === BLACK_VAL ? 'player1' : 'player2';
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
        if (this.openingBoard === undefined) this.openingBoard = copyBoard(this.board);
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
            // 开局局面（棋谱回放/试下需要它作为起点，本棋种开局即有 6 枚座子）
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

    /** 重置为开局：六角盘中心周围摆好 6 枚座子，黑先 */
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
        this.importReplayNoJudge = false;
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
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < SIZE_MIN || newSize > SIZE_MAX) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘大小无效（支持 ${SIZE_MIN}–${SIZE_MAX} 路）` }));
            return false;
        }
        // 开局即有座子，故只以「有没有人入座 / 是否已落子」判断：空房才能改路数
        if (!qiProtocol.canChangeRoomSettings(this)) return false;
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.resetToInitial();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    /**
     * 编辑棋盘：六角盘是锯齿盘（行数 = 2n-1 ≠ 路数），公共的锯齿分支按 boardSize 校验行数会误判，
     * 所以本棋种自己接管（公共层见 applyEditBoard 即转交过来），收尾照抄公共口径。
     */
    applyEditBoard(ws, msg) {
        const ROWS = this.ROWS;
        const edited = msg.board;
        const allowed = Array.isArray(this.editBoardAllowedValues) ? this.editBoardAllowedValues : [0, 1, 2];
        if (!Array.isArray(edited) || edited.length !== ROWS) {
            ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
            return true;
        }
        const next = new Array(ROWS);
        for (let r = 0; r < ROWS; r++) {
            const expectLen = this.rowLen(r);
            const row = edited[r];
            if (!Array.isArray(row) || row.length !== expectLen) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return true;
            }
            next[r] = new Array(expectLen);
            for (let c = 0; c < expectLen; c++) {
                const v = Number(row[c]);
                if (!allowed.includes(v)) {
                    ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                    return true;
                }
                next[r][c] = v;
            }
        }
        this.board = next;
        this.currentPlayer = 1;
        if (typeof this.afterEditBoard === 'function') this.afterEditBoard();
        this.openingBoard = copyBoard(this.board);
        if (Array.isArray(this.historySnapshots)) this.historySnapshots = [];
        if (Array.isArray(this.historyBoards)) this.historyBoards = [];
        if (this.historyBoardSet && typeof this.historyBoardSet.clear === 'function') {
            this.historyBoardSet.clear();
            if (typeof this.boardToString === 'function') this.historyBoardSet.add(this.boardToString(this.board));
        }
        this.moveCoords = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.passNotice = null;
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        const state = typeof this.getInitialState === 'function' ? this.getInitialState() : this.getState();
        this.broadcast({ type: 'editBoardAccepted', ...state });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '三角黑白棋',
            gameId: 'triangle-reversi',
            boardSize: this.boardSize,
            moves: this.moveCoords.map((m) => `${m.player === 'player1' ? 'B' : 'W'}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'triangle-reversi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要三角黑白棋棋谱）。' }));
            return;
        }
        const n = data.boardSize || SIZE_MIN;
        if (!Number.isInteger(n) || n < SIZE_MIN || n > SIZE_MAX) {
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

        this.importReplayNoJudge = true;   // 回放期间不判终局（结果只按棋谱记录）

        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const expect = this.currentPlayer === BLACK_VAL ? 'player1' : 'player2';
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

        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw') {
            this.gameOver = true;
            this.winner = data.result;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
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
                if (qiProtocol.canChangeRoomSettings(this)) this.setBoardSize(msg.size, ws);
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
    TriangleReversiRoom,
    initRoom(room) {
        room.gameLogic = new TriangleReversiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
