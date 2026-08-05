const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/** 朝鲜将棋规则（内联，无独立 rules 文件） */
const R = (function () {
'use strict';

const BOARD_H = 10;
const BOARD_W = 9;

const PIECE_CHAR = {
    rk: '楚', bk: '漢',
    ra: '士', ba: '士',
    re: '象', be: '象',
    rn: '馬', bn: '馬',
    rr: '車', br: '車',
    rc: '包', bc: '包',
    rp: '兵', bp: '卒'
};

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function createInitialBoard() {
    const b = emptyBoard();
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'ba';
    b[0][5] = 'ba'; b[0][6] = 'be'; b[0][7] = 'bn'; b[0][8] = 'br';
    b[1][4] = 'bk';
    b[2][1] = 'bc'; b[2][7] = 'bc';
    for (let c = 0; c < BOARD_W; c += 2) b[3][c] = 'bp';

    b[9][0] = 'rr'; b[9][1] = 'rn'; b[9][2] = 're'; b[9][3] = 'ra';
    b[9][5] = 'ra'; b[9][6] = 're'; b[9][7] = 'rn'; b[9][8] = 'rr';
    b[8][4] = 'rk';
    b[7][1] = 'rc'; b[7][7] = 'rc';
    for (let c = 0; c < BOARD_W; c += 2) b[6][c] = 'rp';
    return b;
}

/** 开局配置：左右翼马/象可互换的列对；蓝(楚/r)在底行，红(漢/b)在顶行 */
const SETUP_WINGS = [[1, 2], [6, 7]];

function setupBackRow(side) {
    return side === 'red' ? 9 : 0;
}

function isSetupHorseOrElephant(piece, side) {
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    return piece[1] === 'n' || piece[1] === 'e';
}

function canOpeningSwap(board, side, r1, c1, r2, c2) {
    if (r1 !== r2 || r1 !== setupBackRow(side) || c1 === c2) return false;
    const p1 = board[r1][c1];
    const p2 = board[r2][c2];
    if (!isSetupHorseOrElephant(p1, side) || !isSetupHorseOrElephant(p2, side)) return false;
    if (p1[1] === p2[1]) return false;
    return SETUP_WINGS.some((w) => w.includes(c1) && w.includes(c2));
}

function applyOpeningSwap(board, r1, c1, r2, c2) {
    const next = copyBoard(board);
    const tmp = next[r1][c1];
    next[r1][c1] = next[r2][c2];
    next[r2][c2] = tmp;
    return next;
}

function sideColorChar(side) {
    return side === 'red' ? 'r' : 'b';
}

function oppositeSide(side) {
    return side === 'red' ? 'black' : 'red';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'red' : 'black';
}

function slotFromSide(side) {
    return side === 'red' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function inPalace(side, row, col) {
    if (col < 3 || col > 5) return false;
    if (side === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function palaceSideAt(row) {
    return row <= 2 ? 'black' : 'red';
}

/** 两格均在同一九宫且在同一条斜线上 */
function onSamePalaceDiagonal(r1, c1, r2, c2) {
    if (c1 < 3 || c1 > 5 || c2 < 3 || c2 > 5) return false;
    const s1 = palaceSideAt(r1);
    const s2 = palaceSideAt(r2);
    if (s1 !== s2) return false;
    if (s1 === 'black') {
        if (r1 - c1 === -3 && r2 - c2 === -3) return true;
        if (r1 + c1 === 5 && r2 + c2 === 5) return true;
        return false;
    }
    if (r1 - c1 === 4 && r2 - c2 === 4) return true;
    if (r1 + c1 === 12 && r2 + c2 === 12) return true;
    return false;
}

function findKing(board, side) {
    const code = side === 'red' ? 'rk' : 'bk';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            if (board[r][c] === code) return { row: r, col: c };
        }
    }
    return null;
}

function pathClearOrthogonal(board, fromRow, fromCol, toRow, toCol) {
    if (fromRow === toRow) {
        const step = toCol > fromCol ? 1 : -1;
        for (let c = fromCol + step; c !== toCol; c += step) {
            if (board[fromRow][c] !== '') return false;
        }
        return true;
    }
    if (fromCol === toCol) {
        const step = toRow > fromRow ? 1 : -1;
        for (let r = fromRow + step; r !== toRow; r += step) {
            if (board[r][fromCol] !== '') return false;
        }
        return true;
    }
    return false;
}

function pathClearPalaceDiagonal(board, fromRow, fromCol, toRow, toCol) {
    if (!onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) return false;
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (!onSamePalaceDiagonal(fromRow, fromCol, r, c)) return false;
        if (board[r][c] !== '') return false;
        r += dR;
        c += dC;
    }
    return true;
}

/** 炮架计数；遇砲作架返回 -1 */
function countScreens(board, fromRow, fromCol, toRow, toCol, diagonal) {
    let cnt = 0;
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (diagonal && !onSamePalaceDiagonal(fromRow, fromCol, r, c)) return -1;
        const p = board[r][c];
        if (p) {
            if (p[1] === 'c') return -1;
            cnt++;
        }
        r += dR;
        c += dC;
    }
    return cnt;
}

function elephantBlocked(board, fromRow, fromCol, toRow, toCol) {
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    if (aR === 3 && aC === 2) {
        const sR = dR > 0 ? 1 : -1;
        const sC = dC > 0 ? 1 : -1;
        if (board[fromRow + sR][fromCol] !== '') return true;
        if (board[fromRow + 2 * sR][fromCol + sC] !== '') return true;
        return false;
    }
    if (aR === 2 && aC === 3) {
        const sR = dR > 0 ? 1 : -1;
        const sC = dC > 0 ? 1 : -1;
        if (board[fromRow + sR][fromCol] !== '') return true;
        if (board[fromRow][fromCol + sC] !== '') return true;
        return false;
    }
    return true;
}

/** 几何走法（不含将军/应将；将的照面另论） */
function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board) {
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
    const side = color === 'r' ? 'red' : 'black';

    if (type === 'k' || type === 'a') {
        if (!inPalace(side, toRow, toCol)) return false;
        if (aR + aC === 1) return true;
        if (aR === 1 && aC === 1 && onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) return true;
        return false;
    }

    if (type === 'e') {
        if (!((aR === 3 && aC === 2) || (aR === 2 && aC === 3))) return false;
        return !elephantBlocked(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'n') {
        if (aR === 2 && aC === 1) {
            const legR = fromRow + (dR > 0 ? 1 : -1);
            return board[legR][fromCol] === '';
        }
        if (aR === 1 && aC === 2) {
            const legC = fromCol + (dC > 0 ? 1 : -1);
            return board[fromRow][legC] === '';
        }
        return false;
    }

    if (type === 'r') {
        if (fromRow === toRow || fromCol === toCol) {
            return pathClearOrthogonal(board, fromRow, fromCol, toRow, toCol);
        }
        if (onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
            return pathClearPalaceDiagonal(board, fromRow, fromCol, toRow, toCol);
        }
        return false;
    }

    if (type === 'c') {
        if (target && target[1] === 'c') return false;

        if (fromRow === toRow || fromCol === toCol) {
            const cnt = countScreens(board, fromRow, fromCol, toRow, toCol, false);
            return cnt === 1;
        }
        if (onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
            const cnt = countScreens(board, fromRow, fromCol, toRow, toCol, true);
            return cnt === 1;
        }
        return false;
    }

    if (type === 'p') {
        const forward = side === 'red' ? -1 : 1;
        if (dR === forward && dC === 0) return true;
        if (dR === 0 && aC === 1) return true;
        const enemyPalace = side === 'red' ? 'black' : 'red';
        if (inPalace(enemyPalace, fromRow, fromCol) && inPalace(enemyPalace, toRow, toCol)) {
            if (dR === forward && aR === 1 && aC === 1
                && onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
                return true;
            }
        }
        return false;
    }

    return false;
}

function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol) {
    const next = copyBoard(board);
    next[toRow][toCol] = next[fromRow][fromCol];
    next[fromRow][fromCol] = '';
    return next;
}

/** 两将同列且中间无子（對宫 / 빅장） */
function kingsFaceEachOther(board) {
    const rk = findKing(board, 'red');
    const bk = findKing(board, 'black');
    if (!rk || !bk || rk.col !== bk.col) return false;
    return pathClearOrthogonal(board, rk.row, rk.col, bk.row, bk.col);
}

/** 将沿纵线攻击（照面用，视同车的直线攻击） */
function kingAttacksSquare(board, kingRow, kingCol, row, col) {
    if (kingCol !== col || kingRow === row) return false;
    return pathClearOrthogonal(board, kingRow, kingCol, row, col);
}

function isSquareAttackedBy(board, row, col, bySide, opts) {
    const ignoreFacingKing = !!(opts && opts.ignoreFacingKing);
    const ch = sideColorChar(bySide);
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (p[1] === 'k') {
                if (ignoreFacingKing) continue;
                if (kingAttacksSquare(board, r, c, row, col)) return true;
                continue;
            }
            if (isPseudoLegalMove(p, r, c, row, col, board)) return true;
        }
    }
    return false;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

/** 是否被非「对方将照面」的棋子将军 */
function isInCheckExceptFacingKing(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side), { ignoreFacingKing: true });
}

function isLegalMove(board, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board)) return false;
    const next = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
    const faceBefore = kingsFaceEachOther(board);
    const faceAfter = kingsFaceEachOther(next);
    // 不可被其它子将军；主动造成照面合法，但已照面时必须化解
    if (isInCheckExceptFacingKing(next, side)) return false;
    if (faceBefore && faceAfter) return false;
    return true;
}

function generateLegalMoves(board, side) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (isLegalMove(board, fr, fc, tr, tc, side)) {
                        moves.push({
                            fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                            capture: !!board[tr][tc]
                        });
                    }
                }
            }
        }
    }
    return moves;
}

function hasLegalMove(board, side) {
    return generateLegalMoves(board, side).length > 0;
}

function isInsufficientMaterial(board) {
    let majors = 0;
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p[1];
            if (t === 'r' || t === 'n' || t === 'c' || t === 'p') return false;
            if (t === 'e') majors++;
        }
    }
    return majors <= 2;
}

function positionKey(board, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'b|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            s += board[r][c] || '.';
            s += ',';
        }
        s += ';';
    }
    return s;
}

function nextHalfmoveState(prev, moveWasCapture, gaveCheck, moverSide) {
    const base = prev || { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
    if (moveWasCapture) {
        return { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
    }
    let { halfmoveClock, checksRed, checksBlack, skipNext } = base;
    if (skipNext) {
        return { halfmoveClock, checksRed, checksBlack, skipNext: false };
    }
    if (gaveCheck) {
        if (moverSide === 'red') {
            if (checksRed < 10) {
                checksRed++;
                halfmoveClock++;
                return { halfmoveClock, checksRed, checksBlack, skipNext: false };
            }
            return { halfmoveClock, checksRed, checksBlack, skipNext: true };
        }
        if (checksBlack < 10) {
            checksBlack++;
            halfmoveClock++;
            return { halfmoveClock, checksRed, checksBlack, skipNext: false };
        }
        return { halfmoveClock, checksRed, checksBlack, skipNext: true };
    }
    halfmoveClock++;
    return { halfmoveClock, checksRed, checksBlack, skipNext: false };
}

function judgeRepetition(historyKeys, checkFlags) {
    if (!historyKeys || historyKeys.length < 3) return null;
    const cur = historyKeys[historyKeys.length - 1];
    const indices = [];
    for (let i = 0; i < historyKeys.length; i++) {
        if (historyKeys[i] === cur) indices.push(i);
    }
    if (indices.length < 3) return null;

    const i2 = indices[indices.length - 1];
    const i1 = indices[indices.length - 2];
    if (i2 - i1 < 2) return { result: 'draw', reason: 'repetition' };

    const stats = { red: { moves: 0, checks: 0 }, black: { moves: 0, checks: 0 } };
    for (let j = i1; j < i2; j++) {
        const mover = historyKeys[j][0] === 'r' ? 'red' : 'black';
        stats[mover].moves++;
        if (checkFlags && checkFlags[j]) stats[mover].checks++;
    }

    const redPerp = stats.red.moves > 0 && stats.red.checks === stats.red.moves;
    const blackPerp = stats.black.moves > 0 && stats.black.checks === stats.black.moves;
    if (redPerp && !blackPerp) return { result: 'loss', loserSide: 'red', reason: 'perpetualCheck' };
    if (blackPerp && !redPerp) return { result: 'loss', loserSide: 'black', reason: 'perpetualCheck' };
    return { result: 'draw', reason: 'repetition' };
}

function pieceLabel(code) {
    return PIECE_CHAR[code] || '?';
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    emptyBoard,
    copyBoard,
    createInitialBoard,
    SETUP_WINGS,
    setupBackRow,
    isSetupHorseOrElephant,
    canOpeningSwap,
    applyOpeningSwap,
    sideColorChar,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    inPalace,
    findKing,
    kingsFaceEachOther,
    isPseudoLegalMove,
    applyMoveOnBoard,
    isInCheck,
    isInCheckExceptFacingKing,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    isInsufficientMaterial,
    positionKey,
    nextHalfmoveState,
    judgeRepetition,
    pieceLabel
};
})();

/**
 * 协议座位：black=蓝方(先手)，white=红方(后手)
 */
class JanggiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
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
                this.recordResultText = lostSlot === 'black' ? '蓝超时红胜' : '红超时蓝胜';
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

    _beginOpeningSetup() {
        this.openingSetup = 'white'; // 红方先配置
        this.setupBoard = null;
        this.sideToMove = 'red';
        this.currentPlayer = 1;
        this.lastFrom = null;
        this.lastTo = null;
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this._activeClockSlot(), Date.now());
            if (typeof this._broadcastClock === 'function') this._broadcastClock();
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
            this._startClockTicker();
        } else {
            this.tcClock = null;
        }
        this._beginOpeningSetup();
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null,
            ...this.getState()
        });
    }

    _activeClockSlot() {
        if (this.openingSetup) return this.openingSetup;
        return R.slotFromSide(this.sideToMove);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        if (this.openingSetup) return slot === this.openingSetup;
        return slot === R.slotFromSide(this.sideToMove);
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== this._activeClockSlot()) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'black' ? '蓝超时红胜' : '红超时蓝胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this._activeClockSlot(), Date.now());
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
            currentPlayer: this.sideToMove === 'red' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'red' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmove.halfmoveClock,
            inCheck: !this.openingSetup && R.isInCheck(this.board, this.sideToMove),
            moveHistory: this.moveHistory.map((m) => ({ ...m })),
            moveCoords: this.wireMoveCoords(),
            openingSetup: this.openingSetup,
            setupBoard: this.setupBoard ? R.copyBoard(this.setupBoard) : null,
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
        return this.moveHistory.map((m) => {
            if (m.pass || m.type === 'pass') {
                return { type: 'pass', player: m.player };
            }
            return {
                type: 'move',
                player: m.player,
                fromRow: m.fromRow,
                fromCol: m.fromCol,
                toRow: m.toRow,
                toCol: m.toCol,
                piece: m.piece,
                captured: m.captured || ''
            };
        });
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '朝鲜将棋',
            gameId: 'janggi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            setupBoard: this.setupBoard ? R.copyBoard(this.setupBoard) : R.copyBoard(this.board),
            moves: this.moveHistory.map((m) => (
                (m.pass || m.type === 'pass')
                    ? `${m.player[0].toUpperCase()}p`
                    : `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
            )),
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
        this.setupBoard = null;
        this.openingSetup = null;
        this.sideToMove = 'red';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyHalfmoves = [];
        this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
        this.checkFlags = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.halfmove = { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
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

    _applyPassCore(slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };

        // 对方造成照面时，虚着即接受作和
        if (R.kingsFaceEachOther(this.board)) {
            return { ok: true, faceDraw: true };
        }

        const opp = R.oppositeSide(side);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory.push({
            player: slot,
            type: 'pass',
            pass: true,
            fromRow: -1, fromCol: -1, toRow: -1, toCol: -1,
            piece: '', captured: ''
        });

        this.halfmove = R.nextHalfmoveState(this.halfmove, false, false, side);
        this.sideToMove = opp;
        this.currentPlayer = opp === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove));
        this.checkFlags.push(false);

        const prev = this.moveHistory[this.moveHistory.length - 2];
        if (prev && (prev.pass || prev.type === 'pass')) {
            return { ok: true, doublePassDraw: true };
        }

        return { ok: true };
    }

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!R.isLegalMove(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] || '';
        const nextBoard = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(nextBoard, opp);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.board = nextBoard;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot,
            fromRow, fromCol, toRow, toCol,
            piece, captured
        });

        this.halfmove = R.nextHalfmoveState(this.halfmove, !!captured, gaveCheck, side);
        this.sideToMove = opp;
        this.currentPlayer = opp === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove));
        this.checkFlags.push(gaveCheck);

        return { ok: true, gaveCheck, captured: !!captured };
    }

    _resolveAfterMove() {
        const side = this.sideToMove;
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, side);
        const faceOnly = R.kingsFaceEachOther(this.board) && !R.isInCheckExceptFacingKing(this.board, side);

        if (!canMove) {
            // 纯照面且无法化解：不判将死，由虚着接受作和
            if (faceOnly) return;
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            const text = inCheck
                ? (side === 'black' ? '蓝将死红胜' : '红将死蓝胜')
                : (side === 'black' ? '蓝困毙红胜' : '红困毙蓝胜');
            this._endGame(winnerSlot, text);
            return;
        }

        if (R.isInsufficientMaterial(this.board)) {
            this._endGame('draw', '子力不足作和');
            return;
        }

        const rep = R.judgeRepetition(this.historyKeys, this.checkFlags);
        if (rep) {
            if (rep.result === 'draw') {
                this._endGame('draw', '循环局面作和');
                return;
            }
            if (rep.result === 'loss') {
                const loserSlot = R.slotFromSide(rep.loserSide);
                const winnerSlot = loserSlot === 'black' ? 'white' : 'black';
                this._endGame(winnerSlot, rep.loserSide === 'red' ? '蓝长将红胜' : '红长将蓝胜');
                return;
            }
        }

        if (this.halfmove.halfmoveClock >= 120) {
            this._endGame('draw', '自然限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'janggi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要朝鲜将棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        if (data.setupBoard && Array.isArray(data.setupBoard) && data.setupBoard.length === R.BOARD_H) {
            this.board = R.copyBoard(data.setupBoard);
            this.setupBoard = R.copyBoard(data.setupBoard);
            this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
        }
        this.openingSetup = null;
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            let isPass = false;
            if (typeof entry === 'string') {
                const mp = entry.match(/^([BW])p$/i);
                if (mp) {
                    isPass = true;
                    player = mp[1].toUpperCase() === 'B' ? 'black' : 'white';
                } else {
                    const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                    if (!m) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                    player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                    fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
                }
            } else {
                player = entry.player;
                if (entry.type === 'pass' || entry.pass) {
                    isPass = true;
                } else {
                    fromRow = entry.fromRow; fromCol = entry.fromCol;
                    toRow = entry.toRow; toCol = entry.toCol;
                }
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = isPass
                ? this._applyPassCore(player)
                : this._applyMoveCore(fromRow, fromCol, toRow, toCol, player);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (r.faceDraw) {
                this._endGame('draw', '照面作和');
                break;
            }
            if (r.doublePassDraw) {
                this._endGame('draw', '双方虚着作和');
                break;
            }
            this._resolveAfterMove();
            if (this.gameOver) break;
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'black' || /蓝胜/.test(rt)) this.winner = 'black';
            else if (data.result === 'white' || /红胜/.test(rt)) this.winner = 'white';
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
            case 'move': {
                if (this.gameOver || this.openingSetup) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'pass': {
                if (this.gameOver || this.openingSetup) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const r = this._applyPassCore(slot);
                if (!r.ok) return;
                if (r.faceDraw) {
                    this._endGame('draw', '照面作和');
                    this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                    return;
                }
                if (r.doublePassDraw) {
                    this._endGame('draw', '双方虚着作和');
                    this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                    return;
                }
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                break;
            }
            case 'setupSwap': {
                if (this.gameOver || !this.openingSetup || !slot) return;
                if (slot !== this.openingSetup) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const side = R.sideFromSlot(slot);
                if (!R.canOpeningSwap(this.board, side, fromRow, fromCol, toRow, toCol)) return;
                this.board = R.applyOpeningSwap(this.board, fromRow, fromCol, toRow, toCol);
                this.lastFrom = null;
                this.lastTo = null;
                this.broadcast({ type: 'broadcast', action: 'setupSwap', ...this.getState() });
                break;
            }
            case 'setupDone': {
                if (this.gameOver || !this.openingSetup || !slot) return;
                if (slot !== this.openingSetup) return;
                if (!this._drainClockBeforeMove(slot)) return;
                if (this.openingSetup === 'white') {
                    this.openingSetup = 'black';
                } else {
                    this.openingSetup = null;
                    this.setupBoard = R.copyBoard(this.board);
                    this.sideToMove = 'red';
                    this.currentPlayer = 1;
                    this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
                    this.lastFrom = null;
                    this.lastTo = null;
                }
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'setupDone', ...this.getState() });
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
                    this.recordResultText = slot === 'black' ? '蓝认输红胜' : '红认输蓝胜';
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
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.halfmove = this.historyHalfmoves.pop() || { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.checkFlags.pop();
        const last = this.moveHistory[this.moveHistory.length - 1];
        if (last && !(last.pass || last.type === 'pass') && last.fromRow >= 0) {
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
    initRoom(room) {
        room.gameLogic = new JanggiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        // overlay 会替换 _finalizeTimeControl / _handleTimeControlAccept，需在其后挂上开局配置
        const gl = room.gameLogic;
        const baseFinalize = gl._finalizeTimeControl.bind(gl);
        gl._finalizeTimeControl = function (valid) {
            baseFinalize(valid);
            this._beginOpeningSetup();
            this.broadcast({
                ...this.getState(),
                type: 'timeControlAgreed',
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : null
            });
        };
        room.maxPlayers = 2;
    },
    _rules: R
};
