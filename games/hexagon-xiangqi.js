const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/** 六角象棋规则（内联，无独立 rules 文件） */
const R = (function () {
'use strict';

const V = 96;
const neighborsRaw = [[1,5,19],[0,2,6],[1,3,9],[2,4],[3,5],[4,0,20],[7,1,23],[6,8,10],[7,9,13],[8,2],[11,7,25],[10,12,14],[11,13,17],[12,8],[15,11,27],[14,16,30],[15,17],[16,12],[19,21,32],[18,0,22],[5,21],[20,18,33],[23,19,36],[22,6,24],[25,23,38],[24,10,26],[27,25,40],[26,14,28],[29,27,42],[28,30,45],[29,15],[32,34,47],[31,18,35],[21,34],[33,31,48],[36,32,51],[35,22,37],[38,36,53],[37,24,39],[40,38,55],[39,26,41],[42,40,57],[41,28,43],[44,42,59],[43,45,62],[44,29],[47,49,65],[46,31,50],[34,49],[48,46],[51,47,64],[50,35,52],[53,51,67],[52,37,54],[55,53,69],[54,39,56],[57,55,71],[56,41,58],[59,57,73],[58,43,60],[61,59,75],[60,62],[61,44],[64,65,78],[63,50,66],[46,63],[67,64,77],[66,52,68],[69,67,80],[68,54,70],[71,69,82],[70,56,72],[73,71,84],[72,58,74],[75,73,86],[74,60],[77,78,89],[76,66,79],[63,76],[80,77,88],[79,68,81],[82,80,91],[81,70,83],[84,82,93],[83,72,85],[86,84,95],[85,74],[88,89],[87,79,90],[76,87],[91,88],[90,81,92],[93,91],[92,83,94],[95,93],[94,85]];
const xs = [5.196,3.464,3.464,5.196,6.928,6.928,1.732,0,0,1.732,-1.732,-3.464,-3.464,-1.732,-5.196,-6.928,-6.928,-5.196,6.928,5.196,8.66,8.66,3.464,1.732,0,-1.732,-3.464,-5.196,-6.928,-8.66,-8.66,8.66,6.928,10.392,10.392,5.196,3.464,1.732,0,-1.732,-3.464,-5.196,-6.928,-8.66,-10.392,-10.392,10.392,8.66,12.124,12.124,6.928,5.196,3.464,1.732,0,-1.732,-3.464,-5.196,-6.928,-8.66,-10.392,-12.124,-12.124,8.66,6.928,10.392,5.196,3.464,1.732,0,-1.732,-3.464,-5.196,-6.928,-8.66,-10.392,6.928,5.196,8.66,3.464,1.732,0,-1.732,-3.464,-5.196,-6.928,-8.66,5.196,3.464,6.928,1.732,0,-1.732,-3.464,-5.196,-6.928];
const ys = [-7,-8,-10,-11,-10,-8,-7,-8,-10,-11,-7,-8,-10,-11,-7,-8,-10,-11,-4,-5,-7,-5,-4,-5,-4,-5,-4,-5,-4,-5,-7,-1,-2,-4,-2,-1,-2,-1,-2,-1,-2,-1,-2,-1,-2,-4,2,1,-1,1,2,1,2,1,2,1,2,1,2,1,2,1,-1,5,4,4,5,4,5,4,5,4,5,4,5,4,8,7,7,8,7,8,7,8,7,8,7,11,10,10,11,10,11,10,11,10];
const hexagons = [[0,1,2,3,4,5],[6,7,8,9,2,1],[10,11,12,13,8,7],[14,15,16,17,12,11],[18,19,0,5,20,21],[22,23,6,1,0,19],[24,25,10,7,6,23],[26,27,14,11,10,25],[28,29,30,15,14,27],[31,32,18,21,33,34],[35,36,22,19,18,32],[37,38,24,23,22,36],[39,40,26,25,24,38],[41,42,28,27,26,40],[43,44,45,29,28,42],[46,47,31,34,48,49],[50,51,35,32,31,47],[52,53,37,36,35,51],[54,55,39,38,37,53],[56,57,41,40,39,55],[58,59,43,42,41,57],[60,61,62,44,43,59],[63,64,50,47,46,65],[66,67,52,51,50,64],[68,69,54,53,52,67],[70,71,56,55,54,69],[72,73,58,57,56,71],[74,75,60,59,58,73],[76,77,66,64,63,78],[79,80,68,67,66,77],[81,82,70,69,68,80],[83,84,72,71,70,82],[85,86,74,73,72,84],[87,88,79,77,76,89],[90,91,81,80,79,88],[92,93,83,82,81,91],[94,95,85,84,83,93]];
const riverDropKeys = ['43,59','41,57','39,55','37,53','35,51','31,47']; // 仅视觉去线，仍可跨河
const neighbors = neighborsRaw;
const RED_BACK = [95,94,93,92,91,90,88,87,89];
const RED_CANNONS = [72, 66]; // 相对原炮位再向前一格
const RED_PAWNS = [60, 58, 54, 50, 46]; // 相对原兵位再向前一格
const RED_PALACE = [83,93,70,82,92,69,81,91,68,80,90,79,88];
const BLACK_PALACE = [11,12,25,10,13,24,7,8,23,6,9,1,2];

const PIECE_CHAR = {
    rk: '帥', ra: '仕', re: '相', rn: '傌', rr: '俥', rc: '炮', rp: '兵',
    bk: '將', ba: '士', be: '象', bn: '馬', br: '車', bc: '砲', bp: '卒'
};

const RED_PALACE_SET = new Set(RED_PALACE);
const BLACK_PALACE_SET = new Set(BLACK_PALACE);
const DIR_TARGETS = [90, 30, -30, -90, -150, 150];

const mirrorOf = (() => {
    const m = new Array(V).fill(-1);
    for (let i = 0; i < V; i++) {
        for (let j = 0; j < V; j++) {
            if (Math.abs(xs[j] - xs[i]) < 0.01 && Math.abs(ys[j] + ys[i]) < 0.01) {
                m[i] = j;
                break;
            }
        }
    }
    return m;
})();

function emptyBoard() {
    return new Array(V).fill('');
}

function copyBoard(src) {
    return src.slice();
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

function approxSameX(a, b) {
    return Math.abs(xs[a] - xs[b]) < 0.01;
}

function dir6(a, b) {
    const ang = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]) * 180 / Math.PI;
    let best = 0;
    let bestD = 999;
    for (let i = 0; i < 6; i++) {
        let d = Math.abs(ang - DIR_TARGETS[i]);
        if (d > 180) d = 360 - d;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

function neighborInDir(v, dir, skip) {
    for (const n of neighbors[v]) {
        if (n === skip) continue;
        if (dir6(v, n) === dir) return n;
    }
    return -1;
}

function isForward(side, a, b) {
    return side === 'red' ? ys[b] < ys[a] : ys[b] > ys[a];
}

function inOwnHalf(side, v) {
    return side === 'red' ? ys[v] >= 1 : ys[v] <= -1;
}

function hasCrossedRiver(side, v) {
    return side === 'red' ? ys[v] < 1 : ys[v] > -1;
}

function palaceSet(side) {
    return side === 'red' ? RED_PALACE_SET : BLACK_PALACE_SET;
}

function createInitialBoard() {
    const b = emptyBoard();
    const redBackPieces = ['rr', 'rn', 're', 'ra', 'rk', 'ra', 're', 'rn', 'rr'];
    const blackBackPieces = ['br', 'bn', 'be', 'ba', 'bk', 'ba', 'be', 'bn', 'br'];
    for (let i = 0; i < RED_BACK.length; i++) {
        b[RED_BACK[i]] = redBackPieces[i];
        b[mirrorOf[RED_BACK[i]]] = blackBackPieces[i];
    }
    for (const v of RED_CANNONS) {
        b[v] = 'rc';
        b[mirrorOf[v]] = 'bc';
    }
    for (const v of RED_PAWNS) {
        b[v] = 'rp';
        b[mirrorOf[v]] = 'bp';
    }
    return b;
}

function findKing(board, side) {
    const code = side === 'red' ? 'rk' : 'bk';
    for (let i = 0; i < V; i++) {
        if (board[i] === code) return i;
    }
    return -1;
}

function kingsFaceEachOther(board) {
    const rk = findKing(board, 'red');
    const bk = findKing(board, 'black');
    if (rk < 0 || bk < 0 || !approxSameX(rk, bk)) return false;
    const minY = Math.min(ys[rk], ys[bk]);
    const maxY = Math.max(ys[rk], ys[bk]);
    for (let v = 0; v < V; v++) {
        if (v === rk || v === bk) continue;
        if (!approxSameX(v, rk)) continue;
        if (ys[v] > minY && ys[v] < maxY && board[v] !== '') return false;
    }
    return true;
}

function addDest(dests, v, board, ch) {
    const occ = board[v];
    if (occ !== '' && occ[0] === ch) return;
    dests.add(v);
}

function isVerticalDir(d) {
    return d === 0 || d === 3;
}

/** 同一竖线上的点（按 y 排序；点之间未必有格边） */
function verticalLineSorted(from) {
    const line = [];
    for (let i = 0; i < V; i++) {
        if (approxSameX(i, from)) line.push(i);
    }
    line.sort((a, b) => ys[a] - ys[b]);
    return line;
}

/**
 * 車/炮竖线：同一竖线任意点，中间（按 y）无子则可走；炮吃子隔一子。
 */
function rookVerticalTargets(from, board, side, mode) {
    const ch = sideColorChar(side);
    const dests = new Set();
    const line = verticalLineSorted(from);
    const idx = line.indexOf(from);
    if (idx < 0) return dests;

    for (const step of [-1, 1]) {
        let screens = 0;
        for (let i = idx + step; i >= 0 && i < line.length; i += step) {
            const v = line[i];
            const occ = board[v];
            if (mode === 'rook') {
                if (occ === '') dests.add(v);
                else {
                    if (occ[0] !== ch) dests.add(v);
                    break;
                }
            } else if (mode === 'cannonMove') {
                if (occ !== '') break;
                dests.add(v);
            } else if (mode === 'cannonCapture') {
                if (screens === 0) {
                    if (occ === '') continue;
                    screens = 1;
                } else if (occ === '') {
                    continue;
                } else {
                    if (occ[0] !== ch) dests.add(v);
                    break;
                }
            }
        }
    }
    return dests;
}

/**
 * 車/炮斜线：只沿左斜/右斜格边走（禁止竖向边），两斜可混用。
 */
function rookDiagonalTargets(from, board, side, mode) {
    const ch = sideColorChar(side);
    const dests = new Set();
    const queue = [{ v: from, prev: -1, screens: 0 }];
    const seen = new Set(['' + from + '|-1|0']);

    while (queue.length) {
        const { v, prev, screens } = queue.shift();
        for (const n of neighbors[v]) {
            if (n === prev) continue;
            if (isVerticalDir(dir6(v, n))) continue;
            const occ = board[n];
            const enqueue = (nextScreens) => {
                const key = n + '|' + v + '|' + nextScreens;
                if (seen.has(key)) return;
                seen.add(key);
                queue.push({ v: n, prev: v, screens: nextScreens });
            };

            if (mode === 'rook') {
                if (occ === '') {
                    dests.add(n);
                    enqueue(0);
                } else if (occ[0] !== ch) {
                    dests.add(n);
                }
            } else if (mode === 'cannonMove') {
                if (occ !== '') continue;
                dests.add(n);
                enqueue(0);
            } else if (mode === 'cannonCapture') {
                if (screens === 0) {
                    if (occ === '') enqueue(0);
                    else enqueue(1);
                } else if (occ === '') {
                    enqueue(1);
                } else if (occ[0] !== ch) {
                    dests.add(n);
                }
            }
        }
    }
    return dests;
}

/**
 * 車/炮：要么只走竖线（含不相邻的同列点），要么只走斜线（左斜+右斜）。
 * mode: rook | cannonMove | cannonCapture
 */
function rookLikeTargets(from, board, side, mode) {
    const dests = rookVerticalTargets(from, board, side, mode);
    rookDiagonalTargets(from, board, side, mode).forEach((v) => dests.add(v));
    return dests;
}

function horseTargets(from, board, side) {
    const ch = sideColorChar(side);
    const dests = new Set();
    for (const b of neighbors[from]) {
        if (board[b] !== '') continue;
        for (const c of neighbors[b]) {
            if (c === from) continue;
            for (const d of neighbors[c]) {
                if (d === from || d === b) continue;
                addDest(dests, d, board, ch);
            }
        }
    }
    return dests;
}

function elephantTargets(from, board, side) {
    const ch = sideColorChar(side);
    const dests = new Set();
    // A→B→C→D→E：第1、3段同向；第2、4段不限；仅 C 须空；B、D 可有子；不过河。
    for (const b of neighbors[from]) {
        if (!inOwnHalf(side, b)) continue;
        const d01 = dir6(from, b);
        for (const c of neighbors[b]) {
            if (c === from || board[c] !== '' || !inOwnHalf(side, c)) continue;
            for (const d of neighbors[c]) {
                if (d === from || d === b || !inOwnHalf(side, d)) continue;
                if (d01 !== dir6(c, d)) continue;
                for (const e of neighbors[d]) {
                    if (e === from || e === b || e === c) continue;
                    if (!inOwnHalf(side, e)) continue;
                    addDest(dests, e, board, ch);
                }
            }
        }
    }
    return dests;
}

function advisorTargets(from, board, side) {
    const palace = palaceSet(side);
    const ch = sideColorChar(side);
    const dests = new Set();
    if (!palace.has(from)) return dests;
    for (const b of neighbors[from]) {
        // 中间点可有子，士跨过即可
        for (const c of neighbors[b]) {
            if (c === from || !palace.has(c)) continue;
            addDest(dests, c, board, ch);
        }
    }
    return dests;
}

function kingTargets(from, board, side) {
    const palace = palaceSet(side);
    const ch = sideColorChar(side);
    const dests = new Set();
    for (const nb of neighbors[from]) {
        if (!palace.has(nb)) continue;
        addDest(dests, nb, board, ch);
    }
    return dests;
}

function pawnTargets(from, board, side) {
    const ch = sideColorChar(side);
    const dests = new Set();
    const crossed = hasCrossedRiver(side, from);
    // dir6: [90,30,-30,-90,-150,150]
    // 红：过河前 前/斜前 = 2,3,4；过河后另加斜后 = 1,5，不可正后 0
    // 黑：过河前 0,1,5；过河后另加 2,4，不可正后 3
    const allowed = crossed
        ? (side === 'red' ? [1, 2, 3, 4, 5] : [0, 1, 2, 4, 5])
        : (side === 'red' ? [2, 3, 4] : [0, 1, 5]);
    for (const nb of neighbors[from]) {
        if (board[nb] !== '' && board[nb][0] === ch) continue;
        if (allowed.indexOf(dir6(from, nb)) >= 0) dests.add(nb);
    }
    return dests;
}

function pseudoTargets(piece, from, board) {
    const side = piece[0] === 'r' ? 'red' : 'black';
    const type = piece[1];
    switch (type) {
        case 'r': return rookLikeTargets(from, board, side, 'rook');
        case 'c': {
            const moves = rookLikeTargets(from, board, side, 'cannonMove');
            const caps = rookLikeTargets(from, board, side, 'cannonCapture');
            caps.forEach((v) => moves.add(v));
            return moves;
        }
        case 'n': return horseTargets(from, board, side);
        case 'e': return elephantTargets(from, board, side);
        case 'a': return advisorTargets(from, board, side);
        case 'k': return kingTargets(from, board, side);
        case 'p': return pawnTargets(from, board, side);
        default: return new Set();
    }
}

function isPseudoLegalMove(piece, from, to, board) {
    if (!piece || from === to || to < 0 || to >= V) return false;
    if (board[to] && board[to][0] === piece[0]) return false;
    return pseudoTargets(piece, from, board).has(to);
}

function applyMoveOnBoard(board, from, to) {
    const next = copyBoard(board);
    next[to] = next[from];
    next[from] = '';
    return next;
}

function isSquareAttackedBy(board, square, bySide) {
    const ch = sideColorChar(bySide);
    for (let i = 0; i < V; i++) {
        const p = board[i];
        if (!p || p[0] !== ch) continue;
        if (isPseudoLegalMove(p, i, square, board)) return true;
    }
    return false;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (king < 0) return true;
    if (kingsFaceEachOther(board)) return true;
    return isSquareAttackedBy(board, king, oppositeSide(side));
}

function isLegalMove(board, from, to, side) {
    const piece = board[from];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, from, to, board)) return false;
    const next = applyMoveOnBoard(board, from, to);
    if (kingsFaceEachOther(next)) return false;
    if (isInCheck(next, side)) return false;
    return true;
}

function generateLegalMoves(board, side) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let from = 0; from < V; from++) {
        const p = board[from];
        if (!p || p[0] !== ch) continue;
        const targets = pseudoTargets(p, from, board);
        for (const to of targets) {
            if (isLegalMove(board, from, to, side)) {
                moves.push({ from, to, capture: board[to] !== '' });
            }
        }
    }
    return moves;
}

function hasLegalMove(board, side) {
    return generateLegalMoves(board, side).length > 0;
}

function isInsufficientMaterial(board) {
    for (let i = 0; i < V; i++) {
        const p = board[i];
        if (!p) continue;
        const t = p[1];
        if (t === 'r' || t === 'n' || t === 'c' || t === 'p') return false;
    }
    return true;
}

function positionKey(board, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'b|';
    for (let i = 0; i < V; i++) {
        s += board[i] || '.';
        s += ',';
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

function generateBoardPayload() {
    return {
        V,
        neighbors,
        xs,
        ys,
        hexagons,
        riverDropKeys,
        RED_PALACE,
        BLACK_PALACE
    };
}

return {
    V,
    VERTEX_COUNT: V,
    neighbors,
    xs,
    ys,
    hexagons,
    riverDropKeys,
    RED_PALACE,
    BLACK_PALACE,
    PIECE_CHAR,
    emptyBoard,
    copyBoard,
    createInitialBoard,
    sideColorChar,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    dir6,
    findKing,
    kingsFaceEachOther,
    isPseudoLegalMove,
    applyMoveOnBoard,
    isInCheck,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    isInsufficientMaterial,
    positionKey,
    nextHalfmoveState,
    judgeRepetition,
    pieceLabel,
    generateBoardPayload
};
})();

/**
 * 协议座位：black=红方(先手)，white=黑方(后手)
 */
class HexagonXiangqiRoom extends QiTwoPlayerRoomBase {
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
                this.recordResultText = lostSlot === 'black' ? '红超时黑胜' : '黑超时红胜';
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
            this.recordResultText = lostSlot === 'black' ? '红超时黑胜' : '黑超时红胜';
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
            vertexCount: R.V,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'red' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo != null ? [{ vertex: this.lastTo, color: this.sideToMove === 'red' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmove.halfmoveClock,
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
            from: m.from,
            to: m.to,
            piece: m.piece,
            captured: m.captured || ''
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '六角象棋',
            gameId: 'hexagon-xiangqi',
            vertexCount: R.V,
            moves: this.moveHistory.map((m) => (
                `${m.player[0].toUpperCase()}${m.from}-${m.to}`
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

    _applyMoveCore(from, to, slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!R.isLegalMove(this.board, from, to, side)) return { ok: false };

        const piece = this.board[from];
        const captured = this.board[to] || '';
        const nextBoard = R.applyMoveOnBoard(this.board, from, to);
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(nextBoard, opp);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.board = nextBoard;
        this.lastFrom = from;
        this.lastTo = to;
        this.moveHistory.push({
            player: slot,
            from, to,
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

        if (!canMove) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            const text = inCheck
                ? (side === 'black' ? '红将死黑胜' : '黑将死红胜')
                : (side === 'black' ? '红困毙黑胜' : '黑困毙红胜');
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
                this._endGame(winnerSlot, rep.loserSide === 'red' ? '红长将黑胜' : '黑长将红胜');
                return;
            }
        }

        if (this.halfmove.halfmoveClock >= 120) {
            this._endGame('draw', '自然限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'hexagon-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要六角象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let from; let to;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+)-(\d+)$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                from = +m[2];
                to = +m[3];
            } else {
                player = entry.player;
                from = entry.from;
                to = entry.to;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(from, to, player);
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
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { from, to } = msg;
                if (![from, to].every((n) => Number.isInteger(n))) return;
                const r = this._applyMoveCore(from, to, slot);
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
                    this.recordResultText = slot === 'black' ? '红认输黑胜' : '黑认输红胜';
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
        if (last) {
            this.lastFrom = last.from;
            this.lastTo = last.to;
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
        room.gameLogic = new HexagonXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    _rules: R,
    generateHexBoardData: R.generateBoardPayload
};
