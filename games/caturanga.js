const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/** 国际象棋规则（内联，无独立 rules 文件） */
const R = (function () {
'use strict';


const BOARD_H = 8;
const BOARD_W = 8;

const PIECE_CHAR = {
    wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
    bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
};

const PROMOTE_TYPES = ['q', 'r', 'n', 'b', 'f'];

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function copyCastling(c) {
    return {
        whiteK: !!c.whiteK, whiteQ: !!c.whiteQ,
        blackK: !!c.blackK, blackQ: !!c.blackQ
    };
}

function defaultCastling() {
    return { whiteK: false, whiteQ: false, blackK: false, blackQ: false };
}

function createInitialBoard() {
    const b = emptyBoard();
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'bb'; b[0][3] = 'bk';
    b[0][4] = 'bf'; b[0][5] = 'bb'; b[0][6] = 'bn'; b[0][7] = 'br';
    for (let c = 0; c < 8; c++) b[1][c] = 'bp';

    b[7][0] = 'wr'; b[7][1] = 'wn'; b[7][2] = 'wb'; b[7][3] = 'wf';
    b[7][4] = 'wk'; b[7][5] = 'wb'; b[7][6] = 'wn'; b[7][7] = 'wr';
    for (let c = 0; c < 8; c++) b[6][c] = 'wp';
    return b;
}

function createInitialMeta() {
    return { castling: defaultCastling(), enPassant: null };
}

function sideColorChar(side) {
    return side === 'white' ? 'w' : 'b';
}

function oppositeSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'white' : 'black';
}

function slotFromSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function findKing(board, side) {
    const code = side === 'white' ? 'wk' : 'bk';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            if (board[r][c] === code) return { row: r, col: c };
        }
    }
    return null;
}

function pathClear(board, fromRow, fromCol, toRow, toCol) {
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (board[r][c] !== '') return false;
        r += dR;
        c += dC;
    }
    return true;
}

/** 攻击判定（不含易位；兵按斜吃） */
function attacksSquare(piece, fromRow, fromCol, toRow, toCol, board) {
    if (!piece || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const type = piece[1];
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);

    if (type === 'k') return aR <= 1 && aC <= 1;
    if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);
    if (type === 'p') {
        const forward = piece[0] === 'w' ? -1 : 1;
        return dR === forward && aC === 1;
    }
    if (type === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    if (type === 'f') return aR === 1 && aC === 1;
    if (type === 'b') {
        // 象斜走两步，不卡象眼（中间可有棋子）
        return aR === aC && aR >= 1 && aR <= 2;
    }
    if (type === 'q') {
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    return false;
}

function isSquareAttackedBy(board, row, col, bySide) {
    const ch = sideColorChar(bySide);
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (attacksSquare(p, r, c, row, col, board)) return true;
        }
    }
    return false;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

/**
 * 几何走法（含吃过路兵目标格、易位目标格；不含将军应将）。
 * promote 仅在升变时需要，此处不校验。
 */
function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta) {
    if (!piece || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const color = piece[0];
    const type = piece[1];
    const target = board[toRow][toCol];
    if (target && target[0] === color) return false;

    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    const side = color === 'w' ? 'white' : 'black';
    const castling = (meta && meta.castling) || defaultCastling();
    const ep = meta && meta.enPassant;

    if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);

    if (type === 'f') return aR === 1 && aC === 1;

    if (type === 'b') {
        // 象斜走两步，不卡象眼（中间可有棋子）
        return aR === aC && aR >= 1 && aR <= 2;
    }

    if (type === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'q') {
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'k') {
        // 王一步一格，无易位
        return aR <= 1 && aC <= 1;
    }

    if (type === 'p') {
        const forward = side === 'white' ? -1 : 1;
        // 直走一格
        if (dC === 0 && dR === forward && !target) return true;
        // 斜吃一格
        if (aC === 1 && dR === forward && target && target[0] !== color) return true;
        return false;
    }

    return false;
}

function needsPromotion(piece, toRow) {
    if (!piece || piece[1] !== 'p') return false;
    if (piece[0] === 'w') return toRow === 0;
    return toRow === 7;
}

/** 己方某类棋子数量 */
function countOwn(board, color, type) {
    let n = 0;
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            if (board[r][c] === color + type) n++;
        }
    }
    return n;
}

/**
 * 升变类型：按目标列对应棋子（a/h 车、b/g 马、c/f 象、d 士、e 后）。
 * 需己方缺少该棋子（车马象 < 2、后 = 0）才允许升变为它，否则升变为士（d 列无条件士）。
 */
function autoPromoteType(board, toRow, toCol, color) {
    if (toCol === 0 || toCol === 7) return countOwn(board, color, 'r') < 2 ? 'r' : 'f';
    if (toCol === 1 || toCol === 6) return countOwn(board, color, 'n') < 2 ? 'n' : 'f';
    if (toCol === 2 || toCol === 5) return countOwn(board, color, 'b') < 2 ? 'b' : 'f';
    if (toCol === 3) return 'f';   // 王位（d 列）：士
    return countOwn(board, color, 'q') === 0 ? 'q' : 'f';  // 后位（e 列）：需己方无后
}

function normalizePromote(promote) {
    if (!promote) return 'q';
    const t = String(promote).toLowerCase();
    return PROMOTE_TYPES.indexOf(t) >= 0 ? t : 'f';
}

/**
 * 执行走子，返回 { board, castling, enPassant, captured, wasPawnMove }
 */
function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote) {
    const next = copyBoard(board);
    const piece = next[fromRow][fromCol];
    const castling = copyCastling((meta && meta.castling) || defaultCastling());
    const ep = meta && meta.enPassant;
    let captured = next[toRow][toCol] || '';
    const wasPawnMove = piece && piece[1] === 'p';

    next[toRow][toCol] = piece;
    next[fromRow][fromCol] = '';

    // 升变：自动升变为对应列的棋子（缺少该棋子时才允许，否则升变为士）
    if (needsPromotion(piece, toRow)) {
        next[toRow][toCol] = piece[0] + autoPromoteType(next, toRow, toCol, piece[0]);
    }

    // 更新易位权
    if (piece === 'wk') { castling.whiteK = false; castling.whiteQ = false; }
    if (piece === 'bk') { castling.blackK = false; castling.blackQ = false; }
    if (piece === 'wr' && fromRow === 7 && fromCol === 0) castling.whiteQ = false;
    if (piece === 'wr' && fromRow === 7 && fromCol === 7) castling.whiteK = false;
    if (piece === 'br' && fromRow === 0 && fromCol === 0) castling.blackQ = false;
    if (piece === 'br' && fromRow === 0 && fromCol === 7) castling.blackK = false;
    if (captured === 'wr' && toRow === 7 && toCol === 0) castling.whiteQ = false;
    if (captured === 'wr' && toRow === 7 && toCol === 7) castling.whiteK = false;
    if (captured === 'br' && toRow === 0 && toCol === 0) castling.blackQ = false;
    if (captured === 'br' && toRow === 0 && toCol === 7) castling.blackK = false;

    return {
        board: next,
        castling,
        enPassant: null,
        captured,
        wasPawnMove
    };
}

function isLegalMove(board, fromRow, fromCol, toRow, toCol, side, meta, promote) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta)) return false;
    // 升变自动进行，无需客户端指定棋子
    const applied = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, side, meta) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (!isPseudoLegalMove(p, fr, fc, tr, tc, board, meta)) continue;
                    if (isLegalMove(board, fr, fc, tr, tc, side, meta, null)) {
                        moves.push({
                            fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                            promote: null,
                            capture: !!board[tr][tc] || !!(meta && meta.enPassant
                                && meta.enPassant.row === tr && meta.enPassant.col === tc)
                        });
                    }
                }
            }
        }
    }
    return moves;
}

function hasLegalMove(board, side, meta) {
    return generateLegalMoves(board, side, meta).length > 0;
}

/** K / K+B / K+N / K+B vs K+B（同色格象） */
function isInsufficientMaterial(board) {
    const pieces = [];
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p[1];
            if (t === 'k') continue;
            if (t === 'q' || t === 'w' || t === 'p') return false;
            pieces.push({ type: t, color: p[0], row: r, col: c });
        }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
        return pieces[0].type === 'n' || pieces[0].type === 'b';
    }
    if (pieces.length === 2
        && pieces[0].type === 'b' && pieces[1].type === 'b'
        && pieces[0].color !== pieces[1].color) {
        const color0 = (pieces[0].row + pieces[0].col) % 2;
        const color1 = (pieces[1].row + pieces[1].col) % 2;
        return color0 === color1;
    }
    return false;
}

function positionKey(board, sideToMove, meta) {
    let s = sideToMove === 'white' ? 'w|' : 'b|';
    const castling = (meta && meta.castling) || defaultCastling();
    s += (castling.whiteK ? 'K' : '') + (castling.whiteQ ? 'Q' : '')
        + (castling.blackK ? 'k' : '') + (castling.blackQ ? 'q' : '') + '|';
    const ep = meta && meta.enPassant;
    s += ep ? `${ep.row},${ep.col}|` : '-|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            s += board[r][c] || '.';
            s += ',';
        }
        s += ';';
    }
    return s;
}

function nextHalfmoveClock(prevClock, wasCapture, wasPawnMove) {
    if (wasCapture || wasPawnMove) return 0;
    return (prevClock || 0) + 1;
}

/** 同一局面（含行棋方、易位权、过路兵）出现 ≥3 次 → 和棋 */
function judgeRepetition(historyKeys) {
    if (!historyKeys || historyKeys.length < 3) return null;
    const cur = historyKeys[historyKeys.length - 1];
    let count = 0;
    for (let i = 0; i < historyKeys.length; i++) {
        if (historyKeys[i] === cur) count++;
    }
    if (count >= 3) return { result: 'draw', reason: 'repetition' };
    return null;
}

function pieceLabel(code) {
    return PIECE_CHAR[code] || '?';
}

function metaFrom(castling, enPassant) {
    return {
        castling: copyCastling(castling || defaultCastling()),
        enPassant: enPassant ? { row: enPassant.row, col: enPassant.col } : null
    };
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    PROMOTE_TYPES,
    emptyBoard,
    copyBoard,
    copyCastling,
    defaultCastling,
    createInitialBoard,
    createInitialMeta,
    sideColorChar,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    findKing,
    isSquareAttackedBy,
    isInCheck,
    isPseudoLegalMove,
    needsPromotion,
    normalizePromote,
    applyMoveOnBoard,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    isInsufficientMaterial,
    positionKey,
    nextHalfmoveClock,
    judgeRepetition,
    pieceLabel,
    metaFrom
};
})();

/**
 * 协议座位：black=白方(先手)，white=黑方(后手)
 */
class SimulatedChessRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        // 开局前编辑允许的棋子值（字符串棋盘：空 '' + 全部棋子编码）
        this.editBoardAllowedValues = ['', 'wp', 'wb', 'wn', 'wr', 'wq', 'wf', 'wk', 'bp', 'bb', 'bn', 'br', 'bq', 'bf', 'bk'];
        // 棋盘维度（8×8，公共编辑校验用）
        this.boardRows = R.BOARD_H;
        this.boardCols = R.BOARD_W;
        this.resetToEmpty();
    }

    /** 编辑盘面若有兵已在对方底线（白兵 row0 / 黑兵 row7），须先逐一升变才能走棋 */
    _pendingPawnPromotion() { return null; /* 升变自动进行 */ }
    _pendingPawnPromotionUnused() {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const row = this.sideToMove === 'white' ? 0 : 7;
        for (let c = 0; c < 8; c++) {
            if (this.board[row][c] === pawn) return { row, col: c };
        }
        return null;
    }

    /** 不走子升变：把指定格的行棋方底线兵替换为所选的子力（非走子，不记入 moveHistory/historyBoards） */
    _applyPawnPromotion(row, col, promote) {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        if (!this.board[row] || this.board[row][col] !== pawn) return false;
        const t = R.normalizePromote(promote);
        this.board[row][col] = (this.sideToMove === 'white' ? 'w' : 'b') + t;
        return true;
    }

    _meta() {
        return R.metaFrom(this.castling, this.enPassant);
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
                this.recordResultText = lostSlot === 'black' ? '白超时黑胜' : '黑超时白胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
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
        if (this.getMoveCount() > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego || this.tcSettings) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
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
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) {
            otherWs.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: v.timed,
                    mainMinutes: v.mainMinutes,
                    byoyomiSeconds: v.byoyomiSeconds,
                    maxTimeouts: v.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const p = this.tcNego.proposal;
        if (!p || p.ok !== true) return;
        this.tcSettings = p.timed ? {
            timed: true, mainMinutes: p.mainMinutes, byoyomiSeconds: p.byoyomiSeconds, maxTimeouts: p.maxTimeouts
        } : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, R.slotFromSide(this.sideToMove), Date.now());
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
            this.recordResultText = lostSlot === 'black' ? '白超时黑胜' : '黑超时白胜';
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

    getState() {
        return {
            board: this.board,
            boardSize: R.BOARD_W,
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'white' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmoveClock,
            castling: R.copyCastling(this.castling),
            enPassant: this.enPassant ? { ...this.enPassant } : null,
            inCheck: R.isInCheck(this.board, this.sideToMove),
            // 编辑盘面的底线兵：当前行棋方须先逐一升变（客户端据此弹升变选择）
            pendingPromotion: this._pendingPawnPromotion(),
            moveHistory: this.moveHistory.map((m) => ({ ...m })),
            moveCoords: this.wireMoveCoords(),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            recordResultText: this.recordResultText,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    wireMoveCoords() {
        return this.moveHistory.map((m) => ({
            type: 'move',
            player: m.player,
            fromRow: m.fromRow,
            fromCol: m.fromCol,
            toRow: m.toRow,
            toCol: m.toCol,
            piece: m.piece,
            captured: m.captured || '',
            promote: m.promote || null
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '国际象棋',
            gameId: 'chess',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => {
                let s = `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`;
                if (m.promote) s += `=${m.promote.toUpperCase()}`;
                return s;
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
        this.board = R.createInitialBoard();
        const meta = R.createInitialMeta();
        this.castling = meta.castling;
        this.enPassant = meta.enPassant;
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyHalfmoves = [];
        this.historyCastling = [];
        this.historyEnPassant = [];
        this.historyKeys = [R.positionKey(this.board, this.sideToMove, this._meta())];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.halfmoveClock = 0;
        this.slotJoinedAt = { black: null, white: null };
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

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot, promote) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const meta = this._meta();
        if (!R.isLegalMove(this.board, fromRow, fromCol, toRow, toCol, side, meta, promote)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const applied = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol, meta, null);
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(applied.board, opp);
        const promoteUsed = R.needsPromotion(piece, toRow) ? R.normalizePromote(promote) : null;

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push(this.halfmoveClock);
        this.historyCastling.push(R.copyCastling(this.castling));
        this.historyEnPassant.push(this.enPassant ? { ...this.enPassant } : null);

        this.board = applied.board;
        this.castling = applied.castling;
        this.enPassant = applied.enPassant;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot,
            fromRow, fromCol, toRow, toCol,
            piece, captured: applied.captured || '',
            promote: promoteUsed
        });

        this.halfmoveClock = R.nextHalfmoveClock(this.halfmoveClock, !!applied.captured, applied.wasPawnMove);
        this.sideToMove = opp;
        this.currentPlayer = opp === 'white' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove, this._meta()));

        return { ok: true, gaveCheck, captured: !!applied.captured };
    }

    /** 行棋方无王：直接判负（编辑盘面可能出现；吃王后下一回合也由此触发） */
    _resolveTurnStartLoss() {
        if (this.gameOver) return false;
        const side = this.sideToMove;
        if (R.findKing(this.board, side) == null) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            this._endGame(winnerSlot, side === 'white' ? '白方无王黑胜' : '黑方无王白胜');
            return true;
        }
        return false;
    }

    /** 开局（时间协商完成/双方入座即开始）时判定：编辑盘面某方无王则直接判负 */
    onMatchStarted() {
        this._resolveTurnStartLoss();
    }

    _resolveAfterMove() {
        if (this._resolveTurnStartLoss()) return;
        const side = this.sideToMove;
        const meta = this._meta();
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, side, meta);

        if (!canMove) {
            if (inCheck) {
                const winnerSlot = R.slotFromSide(R.oppositeSide(side));
                const text = side === 'black' ? '白将死黑胜' : '黑将死白胜';
                this._endGame(winnerSlot, text);
            } else {
                this._endGame('draw', '逼和');
            }
            return;
        }

        if (R.isInsufficientMaterial(this.board)) {
            this._endGame('draw', '子力不足作和');
            return;
        }

        const rep = R.judgeRepetition(this.historyKeys);
        if (rep) {
            this._endGame('draw', '三次重复作和');
            return;
        }

        if (this.halfmoveClock >= 100) {
            this._endGame('draw', '五十着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'chess') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要国际象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol; let promote = null;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(?:=([QRNB]))?$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
                if (m[6]) promote = m[6].toLowerCase();
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
                promote = entry.promote || null;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, player, promote);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
            if (this.gameOver) break;
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'black' || /白胜/.test(rt)) this.winner = 'black';
            else if (data.result === 'white' || /黑胜/.test(rt)) this.winner = 'white';
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
                resultText: this.recordResultText
            }
        });
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
            case 'promotePawn': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                const { row, col, promote } = msg;
                if (!Number.isInteger(row) || !Number.isInteger(col)) return;
                if (!this._applyPawnPromotion(row, col, promote)) return;
                this.broadcast({ type: 'broadcast', action: 'promotePawn', ...this.getState() });
                break;
            }
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                // 编辑盘面有底线兵：必须先逐一升变，暂不接受走子
                if (this._pendingPawnPromotion()) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const promote = msg.promote != null ? String(msg.promote).toLowerCase() : null;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot, promote);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'black' ? 'white' : 'black';
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
                    this.recordResultText = slot === 'black' ? '白认输黑胜' : '黑认输白胜';
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
        this.halfmoveClock = this.historyHalfmoves.pop() || 0;
        this.castling = this.historyCastling.pop() || R.defaultCastling();
        this.enPassant = this.historyEnPassant.pop() || null;
        this.moveHistory.pop();
        this.historyKeys.pop();
        const last = this.moveHistory[this.moveHistory.length - 1];
        if (last) {
            this.lastFrom = { row: last.fromRow, col: last.fromCol };
            this.lastTo = { row: last.toRow, col: last.toCol };
        } else {
            this.lastFrom = null;
            this.lastTo = null;
        }
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
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
    R,
    initRoom(room) {
        room.gameLogic = new SimulatedChessRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
