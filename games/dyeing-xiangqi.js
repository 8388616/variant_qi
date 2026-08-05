const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

const R = (function () {
'use strict';

const BOARD_H = 10;
const BOARD_W = 9;

const PIECE_CHAR = {
    rk: '帥', ra: '仕', re: '相', rn: '傌', rr: '俥', rc: '炮', rp: '兵',
    bk: '將', ba: '士', be: '象', bn: '馬', br: '車', bc: '砲', bp: '卒'
};

const CATEGORY_OF = {
    k: 'king', a: 'advisor', e: 'elephant', n: 'horse',
    r: 'rook', c: 'cannon', p: 'pawn'
};

const CAP_LIMITS = {
    king: 1, advisor: 2, elephant: 2, horse: 2, rook: 2, cannon: 2, pawn: 5
};

/** 背包展示顺序：帥將俥車傌馬炮砲相象仕士兵卒 */
const DISPLAY_ORDER = [
    'rk', 'bk', 'rr', 'br', 'rn', 'bn', 'rc', 'bc',
    're', 'be', 'ra', 'ba', 'rp', 'bp'
];

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(null));
}

function copyCell(cell) {
    if (!cell) return null;
    return { type: cell.type, owner: cell.owner };
}

function copyBoard(src) {
    return src.map((row) => row.map(copyCell));
}

function emptyBags() {
    return { red: [], green: [] };
}

function copyBags(bags) {
    return {
        red: (bags && bags.red ? bags.red.slice() : []),
        green: (bags && bags.green ? bags.green.slice() : [])
    };
}

function createInitialBoard() {
    const b = emptyBoard();
    const N = 'neutral';
    b[0][0] = { type: 'br', owner: N }; b[0][8] = { type: 'br', owner: N };
    b[0][1] = { type: 'bn', owner: N }; b[0][7] = { type: 'bn', owner: N };
    b[0][2] = { type: 'be', owner: N }; b[0][6] = { type: 'be', owner: N };
    b[0][3] = { type: 'ba', owner: N }; b[0][5] = { type: 'ba', owner: N };
    b[0][4] = { type: 'bk', owner: N };
    b[2][1] = { type: 'bc', owner: N }; b[2][7] = { type: 'bc', owner: N };
    for (let i = 0; i < 5; i++) b[3][2 * i] = { type: 'bp', owner: N };

    b[9][0] = { type: 'rr', owner: N }; b[9][8] = { type: 'rr', owner: N };
    b[9][1] = { type: 'rn', owner: N }; b[9][7] = { type: 'rn', owner: N };
    b[9][2] = { type: 're', owner: N }; b[9][6] = { type: 're', owner: N };
    b[9][3] = { type: 'ra', owner: N }; b[9][5] = { type: 'ra', owner: N };
    b[9][4] = { type: 'rk', owner: N };
    b[7][1] = { type: 'rc', owner: N }; b[7][7] = { type: 'rc', owner: N };
    for (let i = 0; i < 5; i++) b[6][2 * i] = { type: 'rp', owner: N };
    return b;
}

function oppositeSide(side) {
    return side === 'red' ? 'green' : 'red';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'red' : 'green';
}

function slotFromSide(side) {
    return side === 'red' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function categoryOfType(type) {
    if (!type || type.length < 2) return null;
    return CATEGORY_OF[type[1]] || null;
}

function countCategory(bag, cat) {
    let n = 0;
    for (let i = 0; i < bag.length; i++) {
        if (categoryOfType(bag[i]) === cat) n++;
    }
    return n;
}

function canOccupy(bags, side, type) {
    const cat = categoryOfType(type);
    if (!cat) return false;
    return countCategory(bags[side] || [], cat) < CAP_LIMITS[cat];
}

function sortedBag(bag) {
    const list = bag ? bag.slice() : [];
    list.sort((a, b) => {
        const ia = DISPLAY_ORDER.indexOf(a);
        const ib = DISPLAY_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return list;
}

function inPalace(camp, row, col) {
    if (col < 3 || col > 5) return false;
    if (camp === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function findKings(board) {
    const kings = [];
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (p && p.type && p.type[1] === 'k') {
                kings.push({ row: r, col: c, type: p.type, owner: p.owner });
            }
        }
    }
    return kings;
}

function findOwnedKing(board, side) {
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (p && p.type && p.type[1] === 'k' && p.owner === side) {
                return { row: r, col: c, type: p.type, owner: p.owner };
            }
        }
    }
    return null;
}

function kingsFaceEachOther(board) {
    let rk = null;
    let bk = null;
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            if (p.type === 'rk') rk = { row: r, col: c };
            if (p.type === 'bk') bk = { row: r, col: c };
        }
    }
    if (!rk || !bk || rk.col !== bk.col) return false;
    const minR = Math.min(rk.row, bk.row);
    const maxR = Math.max(rk.row, bk.row);
    for (let r = minR + 1; r < maxR; r++) {
        if (board[r][rk.col]) return false;
    }
    return true;
}

/**
 * 几何走法（阵营约束按 type 前缀；炮吃子看目标是否有子）。
 * 「不能吃己方」由 isLegalMove / isPseudoLegalMove 按行棋方判定。
 */
function isGeometryLegal(pieceType, fromRow, fromCol, toRow, toCol, board) {
    if (!pieceType || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    const color = pieceType[0];
    const kind = pieceType[1];
    const target = board[toRow][toCol];
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    const camp = color === 'r' ? 'red' : 'black';

    if (kind === 'k') {
        if (aR + aC !== 1) return false;
        return inPalace(camp, toRow, toCol);
    }
    if (kind === 'a') {
        if (!(aR === 1 && aC === 1)) return false;
        return inPalace(camp, toRow, toCol);
    }
    if (kind === 'e') {
        if (!(aR === 2 && aC === 2)) return false;
        const midR = fromRow + dR / 2;
        const midC = fromCol + dC / 2;
        if (board[midR][midC]) return false;
        if (camp === 'red') return toRow >= 5;
        return toRow <= 4;
    }
    if (kind === 'n') {
        if (aR === 2 && aC === 1) {
            const legR = fromRow + (dR > 0 ? 1 : -1);
            return !board[legR][fromCol];
        }
        if (aR === 1 && aC === 2) {
            const legC = fromCol + (dC > 0 ? 1 : -1);
            return !board[fromRow][legC];
        }
        return false;
    }
    if (kind === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        if (fromRow === toRow) {
            const step = toCol > fromCol ? 1 : -1;
            for (let c = fromCol + step; c !== toCol; c += step) {
                if (board[fromRow][c]) return false;
            }
            return true;
        }
        const step = toRow > fromRow ? 1 : -1;
        for (let r = fromRow + step; r !== toRow; r += step) {
            if (board[r][fromCol]) return false;
        }
        return true;
    }
    if (kind === 'c') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        let cnt = 0;
        if (fromRow === toRow) {
            const step = toCol > fromCol ? 1 : -1;
            for (let c = fromCol + step; c !== toCol; c += step) {
                if (board[fromRow][c]) cnt++;
            }
        } else {
            const step = toRow > fromRow ? 1 : -1;
            for (let r = fromRow + step; r !== toRow; r += step) {
                if (board[r][fromCol]) cnt++;
            }
        }
        if (!target) return cnt === 0;
        return cnt === 1;
    }
    if (kind === 'p') {
        const forward = camp === 'red' ? -1 : 1;
        const crossed = camp === 'red' ? fromRow <= 4 : fromRow >= 5;
        if (dR === forward && dC === 0) return true;
        if (crossed && aR === 0 && aC === 1) return true;
        return false;
    }
    return false;
}

function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, moverSide) {
    if (!piece || !piece.type) return false;
    const side = moverSide || piece.owner;
    if (side !== 'red' && side !== 'green') return false;
    const target = board[toRow] && board[toRow][toCol];
    if (target && target.owner === side) return false;
    return isGeometryLegal(piece.type, fromRow, fromCol, toRow, toCol, board);
}

function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, newOwner) {
    const next = copyBoard(board);
    const piece = next[fromRow][fromCol];
    next[toRow][toCol] = {
        type: piece.type,
        owner: newOwner != null ? newOwner : piece.owner
    };
    next[fromRow][fromCol] = null;
    return next;
}

function isSquareAttackedBy(board, row, col, bySide) {
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p.owner !== bySide) continue;
            if (isPseudoLegalMove(p, r, c, row, col, board, bySide)) return true;
        }
    }
    return false;
}

/**
 * 己方已占领的将帅被将军才算被将；叫吃中立将帅不算将军。
 */
function isInCheck(board, side) {
    const king = findOwnedKing(board, side);
    if (!king) return false;
    if (kingsFaceEachOther(board)) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

/**
 * 盘面胜负：仅剩一枚将帅且已被占领 → 占领方胜；无将帅 → 和。
 * 唯一将帅仍中立时未终局。
 */
function evaluateOutcome(board) {
    const kings = findKings(board);
    if (kings.length === 0) return { over: true, winner: 'draw' };
    if (kings.length === 1) {
        const k = kings[0];
        if (k.owner === 'red' || k.owner === 'green') {
            return { over: true, winner: k.owner };
        }
        return { over: false };
    }
    return { over: false };
}

function simulateMove(board, bags, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece) return null;
    const occupying = piece.owner === 'neutral';
    const newOwner = occupying ? side : piece.owner;
    const nextBoard = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, newOwner);
    const nextBags = copyBags(bags);
    if (occupying) nextBags[side].push(piece.type);
    return { board: nextBoard, bags: nextBags, occupying, newOwner, pieceType: piece.type };
}

function isLegalMove(board, bags, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || !piece.type) return false;
    if (piece.owner !== side && piece.owner !== 'neutral') return false;

    const occupying = piece.owner === 'neutral';
    if (occupying && !canOccupy(bags, side, piece.type)) return false;

    const target = board[toRow] && board[toRow][toCol];
    if (target && target.owner === side) return false;
    if (!isGeometryLegal(piece.type, fromRow, fromCol, toRow, toCol, board)) return false;

    const sim = simulateMove(board, bags, fromRow, fromCol, toRow, toCol, side);
    if (!sim) return false;

    const outcome = evaluateOutcome(sim.board);
    // 立即获胜（占领唯一将帅等）允许「送将」
    if (outcome.over && outcome.winner === side) return true;

    if (kingsFaceEachOther(sim.board)) return false;
    if (isInCheck(sim.board, side)) return false;
    return true;
}

function generateLegalMoves(board, bags, side) {
    const moves = [];
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || (p.owner !== side && p.owner !== 'neutral')) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (isLegalMove(board, bags, fr, fc, tr, tc, side)) {
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

function hasLegalMove(board, bags, side) {
    return generateLegalMoves(board, bags, side).length > 0;
}

function positionKey(board, bags, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'g|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) s += '.';
            else s += p.type + (p.owner === 'red' ? 'R' : p.owner === 'green' ? 'G' : 'N');
            s += ',';
        }
        s += ';';
    }
    s += '|B:' + (bags.red || []).join('') + '/' + (bags.green || []).join('');
    return s;
}

function pieceLabel(type) {
    return PIECE_CHAR[type] || '?';
}

function ownerColorHex(owner) {
    if (owner === 'red') return '#932c13';
    if (owner === 'green') return '#1c7353';
    return '#2c2c2c';
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    CAP_LIMITS,
    DISPLAY_ORDER,
    emptyBoard,
    copyBoard,
    copyBags,
    emptyBags,
    createInitialBoard,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    categoryOfType,
    countCategory,
    canOccupy,
    sortedBag,
    findKings,
    findOwnedKing,
    kingsFaceEachOther,
    isGeometryLegal,
    isPseudoLegalMove,
    applyMoveOnBoard,
    simulateMove,
    isSquareAttackedBy,
    isInCheck,
    evaluateOutcome,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    positionKey,
    pieceLabel,
    ownerColorHex
};
})();

/**
 * 协议座位：black=红方(先手)，white=绿方(后手)
 */
class DyeingXiangqiRoom extends QiTwoPlayerRoomBase {
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
                this.recordResultText = lostSlot === 'black' ? '红超时绿胜' : '绿超时红胜';
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
            this.recordResultText = lostSlot === 'black' ? '红超时绿胜' : '绿超时红胜';
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
            bags: {
                red: R.sortedBag(this.bags.red),
                green: R.sortedBag(this.bags.green)
            },
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
            inCheck: R.isInCheck(this.board, this.sideToMove),
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
            captured: m.captured || null,
            occupying: !!m.occupying
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '染色象棋',
            gameId: 'dyeing-xiangqi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => (
                `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
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
        this.bags = R.emptyBags();
        this.sideToMove = 'red';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBags = [];
        this.historySides = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.hostWs = null;
        this._stopClockTicker();
    }

    _endGame(winnerSlotOrSide, resultText) {
        this.gameOver = true;
        if (winnerSlotOrSide === 'draw') this.winner = 'draw';
        else if (winnerSlotOrSide === 'red' || winnerSlotOrSide === 'green') {
            this.winner = R.slotFromSide(winnerSlotOrSide);
        } else {
            this.winner = winnerSlotOrSide;
        }
        this.recordResultText = resultText;
        this._stopClockTicker();
    }

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!R.isLegalMove(this.board, this.bags, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] ? { ...this.board[toRow][toCol] } : null;
        const sim = R.simulateMove(this.board, this.bags, fromRow, fromCol, toRow, toCol, side);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historyBags.push(R.copyBags(this.bags));
        this.historySides.push(this.sideToMove);

        this.board = sim.board;
        this.bags = sim.bags;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot,
            fromRow, fromCol, toRow, toCol,
            piece: { type: piece.type, owner: piece.owner },
            captured,
            occupying: sim.occupying
        });

        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;

        // isInCheck 仅对已占领的红/绿将帅成立，叫吃中立将帅不算
        const gaveCheck = R.isInCheck(this.board, this.sideToMove);
        return { ok: true, occupying: sim.occupying, captured: !!captured, gaveCheck };
    }

    _resolveAfterMove() {
        const outcome = R.evaluateOutcome(this.board);
        if (outcome.over) {
            if (outcome.winner === 'draw') {
                this._endGame('draw', '和棋');
            } else if (outcome.winner === 'red') {
                this._endGame('red', '红胜');
            } else {
                this._endGame('green', '绿胜');
            }
            return;
        }

        const side = this.sideToMove;
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, this.bags, side);
        if (!canMove) {
            const winnerSide = R.oppositeSide(side);
            const text = inCheck
                ? (side === 'green' ? '红将死绿，红胜' : '绿将死红，绿胜')
                : (side === 'green' ? '红困毙绿，红胜' : '绿困毙红，绿胜');
            this._endGame(winnerSide, text);
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'dyeing-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要染色象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, player);
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
            else if (data.result === 'black' || /红胜/.test(rt)) this.winner = 'black';
            else if (data.result === 'white' || /绿胜/.test(rt)) this.winner = 'white';
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
                if (this.gameOver) return;
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
                    this.recordResultText = slot === 'black' ? '红认输绿胜' : '绿认输红胜';
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
        this.bags = this.historyBags.pop() || R.emptyBags();
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.moveHistory.pop();
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
    initRoom(room) {
        room.gameLogic = new DyeingXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
