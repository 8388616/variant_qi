const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/**
 * 跳达棋（Halma）规则（内联，无独立 rules 文件）
 *
 * 以「原始跳达棋」为基础改写：
 * - 8-19 路正方形棋盘，棋子落在格内；双方各占一角摆成直角三角形，白方右下、黑方左上
 * - 步行：8 个方向（直向 4 + 斜向 4）走一格；跳行：沿 8 个方向跳过紧邻一枚棋子（己方/对方均可）落到其后的空格，可连跳
 * - 棋子数固定、无吃子无落子；把己方全部棋子送进对方初始的三角区即获胜
 * - 强制交换：单步或单跳的落点若是自家目标区且被对方棋子占着，可把对方那枚棋子换到自己刚离开的格子（连跳不可）
 * - 和棋：双方连续两手虚着，或同一局面出现三次（不必连续）
 */
const R = (function () {
'use strict';

const DEFAULT_N = 12;
const MIN_N = 8;
const MAX_N = 19;

/** 三角形边长：8-11 路 4、12-15 路 5、16-17 路 6、18-19 路 7 */
function triangleSide(n) {
    if (n <= 11) return 4;
    if (n <= 15) return 5;
    if (n <= 17) return 6;
    return 7;
}

/** 每方棋子数 = 三角数 s(s+1)/2（10 / 15 / 21 / 28） */
function piecesPerSide(n) {
    const s = triangleSide(n);
    return s * (s + 1) / 2;
}

function emptyBoard(n) {
    return Array(n).fill(null).map(() => Array(n).fill(0));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function inBounds(n, r, c) {
    return r >= 0 && r < n && c >= 0 && c < n;
}

function oppositeSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function sideFromSlot(slot) {
    return slot === 'player1' ? 'white' : 'black';   // player1 座执白（先手）
}

function slotFromSide(side) {
    return side === 'white' ? 'player1' : 'player2';
}

/**
 * 白方初始区（右下角直角三角形）：两直角边贴棋盘右边与下边，斜边朝左上。
 * 棋盘坐标里行 0 在底、列 0 在左，所以白方占「最下 s 行中靠右的格」：
 * 最下面一行 s 个、往上每行少一个，到第 s-1 行只剩最右一格。例（10 路，s=4）：
 * 第 0 行 4 子、第 1 行 3 子、第 2 行 2 子、第 3 行 1 子，正好 10 格。
 */
function isWhiteHome(n, r, c) {
    const s = triangleSide(n);
    if (!inBounds(n, r, c)) return false;
    return r < s && c >= n - s && (c - r) >= n - s;
}

/** 黑方初始区（左上角）：与白方中心对称 */
function isBlackHome(n, r, c) {
    return isWhiteHome(n, n - 1 - r, n - 1 - c);
}

/** 某方的目标区 = 对方的初始区 */
function isTargetCell(n, side, r, c) {
    return side === 'white' ? isBlackHome(n, r, c) : isWhiteHome(n, r, c);
}

/** 棋子取值：1..K = 白方；K+1..2K = 黑方（0 = 空格） */
function pieceValue(n, side, idx) {
    return side === 'white' ? idx : piecesPerSide(n) + idx;
}

function pieceSide(v, n) {
    if (!v) return null;
    return v <= piecesPerSide(n) ? 'white' : 'black';
}

/** 初始局面：白方摆满右下三角、黑方摆满左上三角 */
function createInitialBoard(n) {
    const b = emptyBoard(n);
    let wi = 1, bi = 1;
    for (let r = n - 1; r >= 0; r--) {
        for (let c = 0; c < n; c++) {
            if (isWhiteHome(n, r, c)) b[r][c] = pieceValue(n, 'white', wi++);
            else if (isBlackHome(n, r, c)) b[r][c] = pieceValue(n, 'black', bi++);
        }
    }
    return b;
}

const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function countPieces(board, n, side) {
    let k = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) === side) k++;
        }
    }
    return k;
}

/**
 * 连跳搜索：8 个方向，跳过紧邻一枚棋子（己方/对方均可）落到其后空格；每段落点都能作为终点。
 * 同一段连跳里不能两次落到同一格（否则会绕着两枚棋子来回跳、无法收敛），故用 visited 剪枝。
 */
function jumpSeqsFrom(board, n, r, c, visited, budget) {
    const out = [];
    if (budget.n <= 0) return out;
    for (const [dr, dc] of DIRS8) {
        const mr = r + dr, mc = c + dc;
        const lr = r + 2 * dr, lc = c + 2 * dc;
        if (!inBounds(n, lr, lc)) continue;
        if (board[mr][mc] === 0) continue;      // 必须跳过一枚棋子
        if (board[lr][lc] !== 0) continue;      // 落点必须是空格
        const key = lr + ',' + lc;
        if (visited[key]) continue;             // 本段连跳已到过该格
        budget.n--;
        out.push([{ row: lr, col: lc }]);
        visited[key] = true;
        for (const deeper of jumpSeqsFrom(board, n, lr, lc, visited, budget)) {
            out.push([{ row: lr, col: lc }].concat(deeper));
        }
        delete visited[key];
    }
    return out;
}

/**
 * 某方全部合法着法（每个终点一条）：
 * - 步行：8 方向走一格到空格；若落点是自家目标区且被对方棋子占着 → 强制交换（单步）
 * - 跳行：8 方向跳过紧邻一枚棋子到其后空格，可连跳；落点为自家目标区且被对方占着时，单跳可强制交换
 * 交换必须单步或单跳，连跳（两跳及以上）不以交换收尾。
 */
function legalMoves(board, n, side) {
    const out = [];
    const seen = Object.create(null);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) !== side) continue;
            // 步行 / 单步交换
            for (const [dr, dc] of DIRS8) {
                const rr = r + dr, cc = c + dc;
                if (!inBounds(n, rr, cc)) continue;
                const occupant = board[rr][cc];
                if (occupant === 0) {
                    out.push({
                        from: { row: r, col: c }, to: { row: rr, col: cc },
                        path: [{ row: rr, col: cc }], jump: false, swap: false
                    });
                } else if (pieceSide(occupant, n) !== side && isTargetCell(n, side, rr, cc)) {
                    // 自家目标格被对方占着 → 可强制交换
                    out.push({
                        from: { row: r, col: c }, to: { row: rr, col: cc },
                        path: [{ row: rr, col: cc }], jump: false, swap: true
                    });
                }
            }
            // 单跳交换（落点要换的对方棋子）：方向任意，跳过一枚棋子后落到自家目标格上的对方棋子
            for (const [dr, dc] of DIRS8) {
                const mr = r + dr, mc = c + dc;
                const lr = r + 2 * dr, lc = c + 2 * dc;
                if (!inBounds(n, lr, lc)) continue;
                if (board[mr][mc] === 0) continue;
                const occupant = board[lr][lc];
                if (occupant !== 0 && pieceSide(occupant, n) !== side && isTargetCell(n, side, lr, lc)) {
                    out.push({
                        from: { row: r, col: c }, to: { row: lr, col: lc },
                        path: [{ row: lr, col: lc }], jump: true, swap: true
                    });
                }
            }
            // 连跳（落点一律为空格）
            const visited = Object.create(null);
            visited[r + ',' + c] = true;
            for (const seq of jumpSeqsFrom(board, n, r, c, visited, { n: 200000 })) {
                const last = seq[seq.length - 1];
                const key = r + ',' + c + '>' + last.row + ',' + last.col;
                if (seen[key]) continue;
                seen[key] = true;
                out.push({
                    from: { row: r, col: c }, to: { row: last.row, col: last.col },
                    path: seq, jump: true, swap: false
                });
            }
        }
    }
    return out;
}

function hasLegalMove(board, n, side) {
    return legalMoves(board, n, side).length > 0;
}

/** 某枚棋子的合法着法（客户端选中棋子后提示落点用） */
function movesFrom(board, n, side, row, col) {
    return legalMoves(board, n, side).filter((m) => m.from.row === row && m.from.col === col);
}

/** 走子：普通移动只挪己方棋子；交换移动把对方那枚棋子换回起点 */
function applyMoveOnBoard(board, n, move) {
    const p = board[move.from.row][move.from.col];
    if (!p) return null;
    const nb = copyBoard(board);
    nb[move.from.row][move.from.col] = 0;
    const occupant = board[move.to.row][move.to.col];
    if (move.swap) {
        if (!occupant) return null;
        nb[move.from.row][move.from.col] = occupant;   // 对方棋子被换到刚离开的格
    } else if (occupant !== 0) {
        return null;                                    // 普通移动的落点必须是空格
    }
    nb[move.to.row][move.to.col] = p;
    return nb;
}

/** 从着法列表里按「起点 + 终点」找合法着法 */
function findMoveTo(moves, fromRow, fromCol, toRow, toCol) {
    for (const m of moves) {
        if (m.from.row === fromRow && m.from.col === fromCol
            && m.to.row === toRow && m.to.col === toCol) return m;
    }
    return null;
}

/** 从着法列表里按「起点 + 整条路线」找合法着法（棋谱回放用） */
function findMove(moves, fromRow, fromCol, path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    for (const m of moves) {
        if (m.from.row !== fromRow || m.from.col !== fromCol) continue;
        if (m.path.length !== path.length) continue;
        let ok = true;
        for (let i = 0; i < path.length; i++) {
            if (m.path[i].row !== path[i].row || m.path[i].col !== path[i].col) { ok = false; break; }
        }
        if (ok) return m;
    }
    return null;
}

/** 全部棋子都进入自家目标区（对方初始三角）即获胜 */
function hasWon(board, n, side) {
    let any = false;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) !== side) continue;
            any = true;
            if (!isTargetCell(n, side, r, c)) return false;
        }
    }
    return any;
}

/** 着法文本：起点-终点（跳跃用 ×、连跳标注段数、交换加标） */
function moveToText(move, n) {
    const col = (c) => String.fromCharCode(97 + c);
    const sq = (p) => col(p.col) + String(n - p.row);
    let s = sq(move.from) + (move.jump ? '×' : '-') + sq(move.to);
    if (move.jump && move.path.length > 1) s += `(${move.path.length}连跳)`;
    if (move.swap) s += '⇄';
    return s;
}

/** 棋盘格数合法（8-19 路） */
function isValidSize(n) {
    return Number.isInteger(n) && n >= MIN_N && n <= MAX_N;
}

/** 局面键（三次重复判和用）：棋盘本身即完整局面 + 行棋方 */
function positionKey(board, n, side) {
    const rows = [];
    for (let r = 0; r < n; r++) rows.push(board[r].join(','));
    return rows.join('|') + '#' + side;
}

/** 同一局面出现三次（含当前这次，且不必连续）即判和 */
function judgeRepetition(historyKeys) {
    if (!historyKeys || historyKeys.length === 0) return false;
    const last = historyKeys[historyKeys.length - 1];
    let cnt = 0;
    for (const k of historyKeys) if (k === last) cnt++;
    return cnt >= 3;
}

return {
    DEFAULT_N,
    MIN_N,
    MAX_N,
    triangleSide,
    piecesPerSide,
    emptyBoard,
    copyBoard,
    inBounds,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    isWhiteHome,
    isBlackHome,
    isTargetCell,
    pieceValue,
    pieceSide,
    createInitialBoard,
    countPieces,
    legalMoves,
    hasLegalMove,
    movesFrom,
    applyMoveOnBoard,
    findMove,
    findMoveTo,
    hasWon,
    moveToText,
    isValidSize,
    positionKey,
    judgeRepetition
};
})();

/**
 * 协议座位：black=白方(先手，默认显示在右下)，white=黑方(后手)
 */
class HalmaRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = R.DEFAULT_N;
        this.boardRows = this.boardSize;
        this.boardCols = this.boardSize;
        this.resetToEmpty();
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
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
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === R.slotFromSide(this.sideToMove);
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== R.slotFromSide(this.sideToMove)) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, R.slotFromSide(this.sideToMove), Date.now());
        this._broadcastClock();
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    /** 聊天/棋谱里显示的执方名：这些棋种白方先行，player1 座执白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '白方' : (slot === 'player2' ? '黑方' : String(slot));
    }

    getState() {
        const n = this.boardSize;
        const last = this.lastMove;
        return {
            board: this.board,
            boardSize: n,
            boardRows: n,
            boardCols: n,
            initialBoard: this.openingBoard ? this.openingBoard.map((row) => row.slice()) : null,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: last ? { row: last.fromRow, col: last.fromCol } : null,
            lastTo: last ? { row: last.toRow, col: last.toCol } : null,
            lastMove: last ? this._wireMove(last) : null,
            gameOver: this.gameOver,
            winner: this.winner,
            consecutivePasses: this.consecutivePasses || 0,
            moveHistory: this.moveHistory.map((m) => this._wireMove(m)),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            recordResultText: this.recordResultText,
            slots: {
                player2: !!this.room.getPlayerBySlot('player2'),
                player1: !!this.room.getPlayerBySlot('player1')
            }
        };
    }

    /** 着法的线上表示（起点 + 整条跳跃路线 + 是否强制交换） */
    _wireMove(m) {
        if (m.pass) {
            return { type: 'pass', player: m.player, pass: true };
        }
        return {
            type: 'move',
            player: m.player,
            fromRow: m.fromRow,
            fromCol: m.fromCol,
            toRow: m.toRow,
            toCol: m.toCol,
            path: (m.path || []).map((p) => ({ row: p.row, col: p.col })),
            jump: !!m.jump,
            swap: !!m.swap,
            piece: m.piece
        };
    }

    wireMoveCoords() {
        return this.moveHistory.map((m) => this._wireMove(m));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '跳达棋',
            gameId: 'halma',
            boardSize: this.boardSize,
            boardRows: this.boardSize,
            boardCols: this.boardSize,
            moves: this.moveHistory.map((m) => {
                if (m.pass) return (m.player === 'player1' ? 'W' : 'B') + 'p';
                const pts = [{ row: m.fromRow, col: m.fromCol }].concat(m.path || []);
                return (m.player === 'player1' ? 'W' : 'B') + (m.swap ? '*' : '') + pts.map((p) => `${p.row},${p.col}`).join('>');
            }),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = R.createInitialBoard(this.boardSize);
        this.openingBoard = R.copyBoard(this.board);
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyLastMoves = [];
        this.historyPasses = [];
        this.historyKeys = [R.positionKey(this.board, this.boardSize, this.sideToMove)];
        this.lastMove = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.consecutivePasses = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.hostWs = null;
        this._stopClockTicker();
    }

    _endGame(winnerSlot, resultText) {
        this.gameOver = true;
        this.winner = winnerSlot;
        this.recordResultText = resultText;
        this._stopClockTicker();
    }

    _pushHistory() {
        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyLastMoves.push(this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null);
        this.historyPasses.push(this.consecutivePasses || 0);
    }

    /** 走子：起点 + 终点（跳跃时走完整条路线；交换时对方那枚棋子换到起点） */
    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot) {
        const n = this.boardSize;
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const move = R.findMoveTo(R.legalMoves(this.board, n, side), fromRow, fromCol, toRow, toCol);
        if (!move) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const nb = R.applyMoveOnBoard(this.board, n, move);
        if (!nb) return { ok: false };

        this._pushHistory();
        this.board = nb;
        this.lastMove = {
            player: slot,
            fromRow,
            fromCol,
            toRow,
            toCol,
            path: move.path,
            jump: move.jump,
            swap: move.swap,
            piece
        };
        this.moveHistory.push({
            player: slot,
            fromRow,
            fromCol,
            toRow,
            toCol,
            path: move.path,
            jump: move.jump,
            swap: move.swap,
            piece
        });
        this.consecutivePasses = 0;
        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, n, this.sideToMove));

        return { ok: true, last: move.to };
    }

    /** 虚着：不移动棋子，只交换行棋方；双方连续两手虚着判和 */
    _passCore(slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        this._pushHistory();
        this.lastMove = null;
        this.moveHistory.push({ player: slot, pass: true });
        this.consecutivePasses = (this.consecutivePasses || 0) + 1;
        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.boardSize, this.sideToMove));
        if (this.consecutivePasses >= 2) {
            this._endGame('draw', '双方连续虚着，作和');
        }
        return { ok: true };
    }

    /** 走子后的判定：己方棋子全部进入目标区即胜；同一局面出现三次即和 */
    _resolveAfterMove() {
        if (this.gameOver) return;
        const n = this.boardSize;
        const side = R.oppositeSide(this.sideToMove);   // 刚刚走子的一方
        if (R.hasWon(this.board, n, side)) {
            this._endGame(R.slotFromSide(side), side === 'white' ? '白胜' : '黑胜');
            return;
        }
        if (R.judgeRepetition(this.historyKeys)) {
            this._endGame('draw', '同一局面出现三次，和棋');
        }
    }

    /** 观战者改路数：仅在无棋手、无着法、未开局时允许 */
    setBoardSize(newSize, requesterWs) {
        const n = parseInt(newSize, 10);
        if (!R.isValidSize(n)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（需为 8-19 路）。' }));
            return false;
        }
        if (this.room.getPlayerBySlot('player2') || this.room.getPlayerBySlot('player1')) return false;
        if (this.moveHistory.length > 0 || this.gameOver) return false;
        this.boardSize = n;
        this.boardRows = n;
        this.boardCols = n;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'halma') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要跳达棋棋谱）。' }));
            return;
        }
        const n = parseInt(data.boardSize != null ? data.boardSize : (data.boardRows || R.DEFAULT_N), 10);
        if (!R.isValidSize(n)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中的棋盘大小无效。' }));
            return;
        }
        this.boardSize = n;
        this.boardRows = n;
        this.boardCols = n;
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const parsed = HalmaRoom.parseMoveEntry(rawMoves[i]);
            if (!parsed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (parsed.player && parsed.player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = parsed.pass
                ? this._passCore(expect)
                : this._applyMoveCore(parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol, expect);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
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
            replayData: {
                moves: this.wireMoveCoords(),
                initialBoard: this.openingBoard ? this.openingBoard.map((row) => row.slice()) : null,
                resultText: this.recordResultText
            }
        });
    }

    /** 棋谱条目 → { pass } 或 { player, fromRow, fromCol, toRow, path }；支持字符串与对象两种写法 */
    static parseMoveEntry(entry) {
        if (entry == null) return null;
        if (typeof entry === 'string') {
            const mp = entry.trim().match(/^([WB])p$/i);
            if (mp) return { player: mp[1].toUpperCase() === 'B' ? 'player2' : 'player1', pass: true };
            // 形如 B3,2>5,4 （交换着法形如 B*3,2>5,4，交换与否由规则自行判定）
            const m = entry.trim().match(/^([WB])(\*?)((?:\d+,\d+)(?:>\d+,\d+)*)$/i);
            if (!m) return null;
            const player = m[1].toUpperCase() === 'B' ? 'player2' : 'player1';
            const pts = m[3].split('>').map((s) => s.split(',').map(Number));
            if (pts.length < 2) return null;
            for (const p of pts) {
                if (p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) return null;
            }
            return {
                player,
                fromRow: pts[0][0],
                fromCol: pts[0][1],
                toRow: pts[pts.length - 1][0],
                toCol: pts[pts.length - 1][1],
                path: pts.slice(1).map((p) => ({ row: p[0], col: p[1] }))
            };
        }
        if (typeof entry === 'object') {
            if (entry.pass || entry.type === 'pass') {
                return {
                    player: entry.player === 'player2' || entry.player === 'player1' ? entry.player : null,
                    pass: true
                };
            }
            const path = Array.isArray(entry.path)
                ? entry.path.map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col }))
                : null;
            if (!path || path.length === 0) return null;
            if (!Number.isInteger(entry.fromRow) || !Number.isInteger(entry.fromCol)) return null;
            const toRow = Number.isInteger(entry.toRow) ? entry.toRow : path[path.length - 1].row;
            const toCol = Number.isInteger(entry.toCol) ? entry.toCol : path[path.length - 1].col;
            return {
                player: entry.player === 'player2' || entry.player === 'player1' ? entry.player : null,
                fromRow: entry.fromRow,
                fromCol: entry.fromCol,
                toRow,
                toCol,
                path
            };
        }
        return null;
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
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
            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;
            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;
            case 'setBoardSize':
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (!Number.isInteger(fromRow) || !Number.isInteger(fromCol)
                    || !Number.isInteger(toRow) || !Number.isInteger(toCol)) return;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;
            }
            case 'pass': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const r = this._passCore(slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'player2' ? 'player1' : 'player2';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    this._undoOne();
                    this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                    return;
                }
                this.pendingUndo = { requester: ws };
                oppWs.send(JSON.stringify({ type: 'undoRequest' }));
                break;
            }
            case 'undoResponse': {
                if (!this.pendingUndo) return;
                const requester = this.pendingUndo.requester;
                this.pendingUndo = null;
                if (!msg.accept) {
                    if (requester && requester.readyState === 1) {
                        requester.send(JSON.stringify({ type: 'undoRejected' }));
                    }
                    return;
                }
                this._undoOne();
                this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                break;
            }
            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver && slot) {
                    this.recordResultText = slot === 'player2' ? '黑方认输，白胜' : '白方认输，黑胜';
                    this._stopClockTicker();
                }
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '双方同意作和';
                        this._stopClockTicker();
                    }
                });
                break;
            default:
                break;
        }
    }

    _undoOne() {
        if (this.historyBoards.length === 0) return;
        this.board = this.historyBoards.pop();
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.lastMove = this.historyLastMoves.pop() || null;
        this.consecutivePasses = this.historyPasses.pop() || 0;
        this.historyKeys.pop();
        this.moveHistory.pop();
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        if (this.tcClock && this.tcClock.timed) this._syncClockAfterTurnChange();
    }

    resetGame() {
        this.resetToEmpty();
        for (const [client, s] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(s);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player2: false, player1: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new HalmaRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
