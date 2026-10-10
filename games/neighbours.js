'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay,
    applyInitialPositionCompact, encodeOpeningPositionCompact } = require('../common');

const BLACK_VAL = 1;
const WHITE_VAL = 2;

/** 邻居棋：正方形棋盘 5~9 路（默认 5），白方先行（player1 执白） */
const SIZE_MIN = 5;
const SIZE_MAX = 9;
const DEFAULT_SIZE = 5;

/** 连续 60 回合（= 120 手）没有吃子 → 和棋 */
const NO_CAPTURE_PLIES = 120;

/** 八个方向：上下左右 + 四个斜角 */
const NB_DIRS = [
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

function inBounds(n, r, c) {
    return r >= 0 && r < n && c >= 0 && c < n;
}

/**
 * 初始局面：白方在底线（row 0，显示在下）、黑方在上线（row n-1）各摆满一行（每方 n 枚）；白先。
 */
function initialBoard(n) {
    const b = createBoard(n);
    for (let c = 0; c < n; c++) {
        b[0][c] = WHITE_VAL;
        b[n - 1][c] = BLACK_VAL;
    }
    return b;
}

/** 某方的棋子数 */
function countPieces(board, val) {
    let k = 0;
    for (const row of board) {
        for (const v of row) if (v === val) k += 1;
    }
    return k;
}

/** 该格八邻里棋子的数量（不分敌我）—— 也就是这枚棋子这一手要走的步数 */
function neighbourCount(board, n, row, col) {
    let k = 0;
    for (const [dr, dc] of NB_DIRS) {
        const r = row + dr;
        const c = col + dc;
        if (inBounds(n, r, c) && board[r][c] !== 0) k += 1;
    }
    return k;
}

/**
 * 一枚棋子这一手的全部落点：**步数固定 = 八邻棋子数**，每步各自选方向（可拐弯），
 * 路径中间的格子必须为空，终点可以是空格或一枚敌方棋子（踩上去即提掉）。
 * 返回 [{fromRow, fromCol, toRow, toCol}, ...]；同一条终点只算一次，原地不动不算着法。
 */
function movesOf(board, n, row, col) {
    const out = [];
    if (!inBounds(n, row, col)) return out;
    const mine = board[row][col];
    if (mine !== BLACK_VAL && mine !== WHITE_VAL) return out;
    const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
    const steps = neighbourCount(board, n, row, col);
    if (steps <= 0) return out;                       // 八邻没有棋子 → 一步也走不了
    let cur = new Set([row * n + col]);
    for (let k = 1; k <= steps; k++) {
        const isLast = (k === steps);
        const next = new Set();
        for (const key of cur) {
            const r = Math.floor(key / n);
            const c = key % n;
            for (const [dr, dc] of NB_DIRS) {
                const nr = r + dr;
                const nc = c + dc;
                if (!inBounds(n, nr, nc)) continue;
                const v = board[nr][nc];
                if (v === 0) next.add(nr * n + nc);                       // 空格随时可走
                else if (isLast && v === opp) next.add(nr * n + nc);      // 终点才能踩敌子
            }
        }
        cur = next;
    }
    for (const key of cur) {
        const r = Math.floor(key / n);
        const c = key % n;
        if (r === row && c === col) continue;          // 绕回原地不算一手
        out.push({ fromRow: row, fromCol: col, toRow: r, toCol: c });
    }
    return out;
}

/** 某方全部合法着法 */
function legalMoves(board, n, sideVal) {
    const out = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] !== sideVal) continue;
            for (const m of movesOf(board, n, r, c)) out.push(m);
        }
    }
    return out;
}

function hasMove(board, n, sideVal) {
    return legalMoves(board, n, sideVal).length > 0;
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

class NeighboursRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = DEFAULT_SIZE;
        this.noProgress = 0;          // 连续无吃子手数（>= NO_CAPTURE_PLIES 判和）
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
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: this.winner, ...this.getState() });
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
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: this.winner, ...this.getState() });
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
        return hasMove(this.board, this.boardSize, playerVal);
    }

    /** 路数（5~9）：仅观战者可改，改完重开 */
    setBoardSize(newSize, requesterWs) {
        const n = parseInt(newSize, 10);
        if (!Number.isInteger(n) || n < SIZE_MIN || n > SIZE_MAX) {
            if (requesterWs) requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘大小无效（需为 ${SIZE_MIN}-${SIZE_MAX}）。` }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) return false;
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = n;
        this.resetToInitial();
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    /**
     * 走子：选一枚己方棋子，走**正好 N 步**（N = 它八邻里的棋子数），每步上下左右或斜角、可拐弯，
     * 中间格必须为空，终点可以是空格或一枚敌方棋子（踩上去提掉）。走完依次判定
     * 1 对方被吃尽 → 胜；2 双方各剩一枚 → 和；3 对方无子可动 → 胜；
     * 4 三次重复局面 → 和；5 连续 60 回合无吃子 → 和。
     */
    applyMove(slot, fromRow, fromCol, toRow, toCol) {
        if (this.gameOver) return false;
        const mine = slot === 'player2' ? BLACK_VAL : WHITE_VAL;
        if (this.currentPlayer !== mine) return false;
        if (!inBounds(this.boardSize, fromRow, fromCol)) return false;
        if (this.board[fromRow][fromCol] !== mine) return false;
        const legal = movesOf(this.board, this.boardSize, fromRow, fromCol)
            .some((m) => m.toRow === toRow && m.toCol === toCol);
        if (!legal) return false;

        this.historySnapshots.push(this.snapshot());

        const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        const captured = this.board[toRow][toCol] === opp;      // 走到敌子上：提掉这一枚
        this.board[fromRow][fromCol] = 0;
        this.board[toRow][toCol] = mine;
        this.lastCaptured = captured ? [{ row: toRow, col: toCol, color: opp }] : [];
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, fromRow, fromCol, toRow, toCol });
        this.lastMoveMarkers = [
            { row: fromRow, col: fromCol, color: mine },
            { row: toRow, col: toCol, color: mine }
        ];
        this.noProgress = captured ? 0 : this.noProgress + 1;

        this.historyKeys.push(positionKey(this.board, opp));
        if (this._resolveAfterMove(slot, mine, opp)) return true;
        this.currentPlayer = opp;
        return true;
    }

    /** 走完一手后的终局判定；已结束返回 true */
    _resolveAfterMove(slot, mine, opp) {
        // 回放棋谱期间不判终局（结果只按棋谱记录显示）
        if (this.importReplayNoJudge) return;
        const n = this.boardSize;
        if (countPieces(this.board, opp) === 0) {
            this.gameOver = true;
            this.winner = slot;
            this.recordResultText = slot === 'player2' ? '黑胜' : '白胜';
            return true;
        }
        if (countPieces(this.board, mine) === 1 && countPieces(this.board, opp) === 1) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '双方各剩一枚棋子，和棋';
            return true;
        }
        if (!hasMove(this.board, n, opp)) {
            this.gameOver = true;
            this.winner = slot;
            this.recordResultText = opp === BLACK_VAL ? '黑方无子可动，白胜' : '白方无子可动，黑胜';
            return true;
        }
        if (judgeRepetition(this.historyKeys)) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '三次重复局面，和棋';
            return true;
        }
        if (this.noProgress >= NO_CAPTURE_PLIES) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = `连续 ${NO_CAPTURE_PLIES / 2} 回合无吃子，和棋`;
            return true;
        }
        return false;
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
            noProgress: this.noProgress,
            lastCaptured: (this.lastCaptured || []).map((m) => ({ ...m })),
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
        this.noProgress = s.noProgress || 0;
        this.lastCaptured = (s.lastCaptured || []).map((m) => ({ ...m }));
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
            // 开局局面（棋谱回放/试下需要它作为起点，本棋种开局即有子）
            openingBoard: this.openingBoard || initialBoard(this.boardSize),
            numberOfHands: this.moveCoords.length + 1,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            // 最近一手被提掉的对方棋子（客户端画被提标记）
            lastCaptured: this.lastCaptured || [],
            pieceCounts: {
                player2: countPieces(this.board, BLACK_VAL),
                player1: countPieces(this.board, WHITE_VAL)
            },
            noProgress: this.noProgress,
            noProgressLimit: NO_CAPTURE_PLIES,
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

    /** 重置为开局：白方底线摆满、黑方上线摆满，白先 */
    resetToInitial() {
        this.importReplayNoJudge = false;
        this.board = initialBoard(this.boardSize);
        this.openingBoard = copyBoard(this.board);
        this.currentPlayer = WHITE_VAL;
        this.recordResultText = null;
        this.lastMoveMarkers = [];
        this.lastCaptured = [];
        this.noProgress = 0;
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

    /** 编辑盘面后：白先（本棋种白方先行），并重置重复局面/无吃子记录 */
    afterEditBoard() {
        this.currentPlayer = WHITE_VAL;
        this.lastMoveMarkers = [];
        this.lastCaptured = [];
        this.noProgress = 0;
        this.historyKeys = [positionKey(this.board, this.currentPlayer)];
    }

    /** 编辑完开局即判定：无子/无子可动 → 判负；两边各剩一枚 → 和（与走子后的判定同口径） */
    onMatchStarted() {
        if (this.gameOver) return;
        const n = this.boardSize;
        const mine = this.currentPlayer;
        const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        if (countPieces(this.board, mine) === 0) {
            this.gameOver = true;
            this.winner = mine === BLACK_VAL ? 'player1' : 'player2';
            this.recordResultText = mine === BLACK_VAL ? '黑方无子，白胜' : '白方无子，黑胜';
            return;
        }
        if (countPieces(this.board, mine) === 1 && countPieces(this.board, opp) === 1) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '双方各剩一枚棋子，和棋';
            return;
        }
        if (!hasMove(this.board, n, mine)) {
            this.gameOver = true;
            this.winner = mine === BLACK_VAL ? 'player1' : 'player2';
            this.recordResultText = mine === BLACK_VAL ? '黑方无子可动，白胜' : '白方无子可动，黑胜';
        }
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
            gameType: '邻居棋',
            gameId: 'neighbours',
            boardSize: this.boardSize,
            // 开局局面（编辑过的局面也在里面）：导入时按它摆盘，否则用标准开局
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map((m) => `${m.player === 'player2' ? 'B' : 'W'}`
                + `${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`),
            result: this.gameOver ? this.winner : null,
            resultText: this.recordResultText
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'neighbours') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要邻居棋棋谱）。' }));
            return;
        }
        this.resetToInitial();
        // 棋谱里带了开局局面（编辑过的局面）就按它摆盘
        if (Array.isArray(data.initialPosition) && data.initialPosition.length) {
            applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
            this.openingBoard = copyBoard(this.board);
            this.historyKeys = [positionKey(this.board, this.currentPlayer)];
        }
        // 回放期间不做任何终局判定：只把棋谱里的着法摆上去，结果按记录显示
        this.importReplayNoJudge = true;
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

        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        // 记录里的胜负先认出执方颜色（公共层把棋谱里的「黑胜」折成 result='player1'、
        // 「白胜」折成 result='player2'，所以不能直接当座位名用），再落到本棋种的座位。
        if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw') {
            this.gameOver = true;
            this.winner = data.result;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { initialPosition: data.initialPosition || [], moves: this.moveCoords.map((m) => ({ ...m })) }
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
            case 'setBoardSize':
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
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
    NeighboursRoom,
    initRoom(room) {
        room.gameLogic = new NeighboursRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    NeighboursEngine: {
        SIZE_MIN,
        SIZE_MAX,
        DEFAULT_SIZE,
        NO_CAPTURE_PLIES,
        NB_DIRS,
        initialBoard,
        countPieces,
        neighbourCount,
        legalMoves,
        hasMove,
        movesOf,
        /** 在给定盘面上走一手（含踩子提子）：返回 { board, captured, mine }，不改原盘（测试/回放用） */
        applyMoveOn(board, n, fromRow, fromCol, toRow, toCol) {
            const nb = copyBoard(board);
            const mine = nb[fromRow][fromCol];
            const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
            const captured = nb[toRow][toCol] === opp ? [[toRow, toCol]] : [];
            nb[fromRow][fromCol] = 0;
            nb[toRow][toCol] = mine;
            return { board: nb, captured, mine };
        },
        positionKey
    }
};
