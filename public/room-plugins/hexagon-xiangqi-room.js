window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["hexagon-xiangqi"] = {
    shell: {
        title: "六角象棋",
        rulesHtml: "基本规则类似象棋，采用六角棋盘。<br /><br /><strong>帥/將</strong>：走一段边，但不能出十三宮，且不能和对方的將/帥照面。<br /><strong>俥/車</strong>：沿竖向走任意格(可以跨六角形)，或沿斜向走任意段边，路径上不能有其它棋子，。<br /><strong>傌/馬</strong>：走三段边，第一段终点不能有棋子。<br /><strong>炮/砲</strong>：走法同俥/車，但需隔一子吃子。<br /><strong>相/象</strong>：走四段边，其中第一段和第三段的方向必须相同，第二段终点不能有棋子，且不能过河。<br /><strong>仕/士</strong>：走两段边，但不能出十三宮。<br /><strong>兵/卒</strong>: 走一段边，过河前只能向前，过河后可斜向后。<br /><br />",
        defaultKomiText: "红先",
        boardSizeMin: 5,
        boardSizeMax: 5,
        defaultBoardSize: 5,
        recordDownloadPrefix: "六角象棋",
        standardWeiqiMatchTime: true,
        features: { editBoard: false, xiangqi: true, hexagonXiangqi: true, hideBoardSize: true, transparentCanvas: true }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "六角象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
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

        const SLOT_UI = {
            black: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };

        const CANVAS_SIZE = 600;
        const FRAME_CENTER = CANVAS_SIZE / 2;
        const OUTER_HEX_RADIUS = 280;
        const FRAME_CORNER_RADIUS = 12;
        const BOARD_SIZE = 5;

        const canvas = document.getElementById('goBoard');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = CANVAS_SIZE * dpr;
        canvas.height = CANVAS_SIZE * dpr;
        const ctx2d = canvas.getContext('2d');
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        let transformed;
        let clickThreshold;
        let cellSize;
        let centerX;
        let centerY;
        const riverDropSet = new Set(R.riverDropKeys);

        let checkBannerTimer = null;

        function triggerCheckBanner() {
            ps.checkBannerUntil = Date.now() + 2000;
            if (checkBannerTimer) clearTimeout(checkBannerTimer);
            checkBannerTimer = setTimeout(() => {
                checkBannerTimer = null;
                ps.checkBannerUntil = 0;
                drawBoard();
            }, 2000);
            drawBoard();
        }

        function drawCheckBanner() {
            if (!ps.checkBannerUntil || Date.now() >= ps.checkBannerUntil) return;
            const cx = FRAME_CENTER;
            const cy = FRAME_CENTER;
            const fontSize = Math.max(48, cellSize * 2.0);
            // 勿用 bold：xiangqi.ttf 仅 Regular，请求粗体时浏览器会回退到系统字体
            const fontSpec = `${fontSize}px XiangqiPiece`;
            ctx2d.save();
            ctx2d.font = fontSpec;
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.lineJoin = 'round';
            ctx2d.lineWidth = Math.max(4, fontSize * 0.12);
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.fillStyle = '#c62828';
            ctx2d.strokeText('将军！', cx, cy);
            ctx2d.fillText('将军！', cx, cy);
            ctx2d.restore();
        }

        function edgeKey(a, b) {
            return a < b ? `${a},${b}` : `${b},${a}`;
        }

        function buildHexGeometry() {
            const vertices = [];
            for (let i = 0; i < R.V; i++) {
                vertices.push({ x: R.xs[i], y: R.ys[i] });
            }
            const PADDING = 72 - 4 * BOARD_SIZE;
            const R_inner = OUTER_HEX_RADIUS - PADDING;

            let cx = 0, cy = 0;
            for (const v of vertices) { cx += v.x; cy += v.y; }
            cx /= R.V;
            cy /= R.V;
            let maxDist = 0;
            for (const v of vertices) {
                const d = Math.hypot(v.x - cx, v.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? R_inner / maxDist : 1;

            transformed = vertices.map(v => ({
                x: FRAME_CENTER + (v.x - cx) * scale,
                y: FRAME_CENTER + (v.y - cy) * scale
            }));
            centerX = FRAME_CENTER;
            centerY = FRAME_CENTER;

            let totalDist = 0;
            let edgeCount = 0;
            for (const hex of R.hexagons) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i];
                    const b = hex[(i + 1) % 6];
                    const ddx = transformed[a].x - transformed[b].x;
                    const ddy = transformed[a].y - transformed[b].y;
                    totalDist += Math.hypot(ddx, ddy);
                    edgeCount++;
                }
            }
            cellSize = totalDist / edgeCount;
            clickThreshold = cellSize * 0.4;
        }

        buildHexGeometry();

        const ps = {
            board: R.createInitialBoard(),
            sideToMove: 'red',
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastFrom: null,
            lastTo: null,
            ws: null,
            isMyTurn: false,
            slots: { black: false, white: false },
            reconnectTimer: null,
            replayMode: false,
            tryPlayMode: false,
            matchStarted: false,
            matchTime: null,
            selectedVertex: -1,
            legalTargets: [],
            inCheck: false,
            halfmoveClock: 0,
            moveHistory: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            liveSnapshots: [],
            replaySnapshots: [],
            replayStep: 0,
            replayTotalSteps: 0,
            tryPlayBaseStep: 0,
            tryPlaySnapshots: [],
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            tryPlaySide: 'red',
            recordResultText: null,
            checkBannerUntil: 0
        };

        function sideOfSlot(slot) { return R.sideFromSlot(slot); }
        function slotOfSide(side) { return R.slotFromSide(side); }

        function boardFlipped() {
            return ps.mySlot === 'white';
        }

        function displayPos(v) {
            const p = transformed[v];
            if (!boardFlipped()) return p;
            return {
                x: 2 * centerX - p.x,
                y: 2 * centerY - p.y
            };
        }

        function refreshLegalTargets() {
            ps.legalTargets = [];
            if (ps.selectedVertex < 0) return;
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            for (let v = 0; v < R.V; v++) {
                if (R.isLegalMove(ps.board, ps.selectedVertex, v, side))
                    ps.legalTargets.push(v);
            }
        }

        function drawRoundedHexagon(vertices, radius, skipStroke) {
            if (vertices.length !== 6) return;
            const startPoints = [];
            const endPoints = [];
            for (let i = 0; i < 6; i++) {
                const curr = vertices[i];
                const prev = vertices[(i - 1 + 6) % 6];
                const next = vertices[(i + 1) % 6];
                const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.hypot(v1.x, v1.y);
                const len2 = Math.hypot(v2.x, v2.y);
                const dx1 = v1.x / len1;
                const dy1 = v1.y / len1;
                const dx2 = v2.x / len2;
                const dy2 = v2.y / len2;
                startPoints.push({ x: curr.x + dx1 * radius, y: curr.y + dy1 * radius });
                endPoints.push({ x: curr.x + dx2 * radius, y: curr.y + dy2 * radius });
            }
            ctx2d.beginPath();
            ctx2d.moveTo(startPoints[0].x, startPoints[0].y);
            for (let i = 0; i < 6; i++) {
                ctx2d.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                if (i < 5) ctx2d.lineTo(startPoints[i + 1].x, startPoints[i + 1].y);
            }
            ctx2d.lineTo(startPoints[0].x, startPoints[0].y);
            ctx2d.closePath();
            ctx2d.fill();
            if (!skipStroke) ctx2d.stroke();
        }

        function drawRiverLabels() {
            const band = [];
            for (let v = 0; v < R.V; v++) {
                if (Math.abs(R.ys[v]) <= 1.5) band.push(v);
            }
            if (!band.length) return;
            const pts = band.map(v => displayPos(v)).sort((a, b) => a.x - b.x);
            const midX = (pts[0].x + pts[pts.length - 1].x) / 2;
            const span = pts[pts.length - 1].x - pts[0].x;
            // 参考象棋：约在河界中线左右 1/4 处，而非贴边
            const chuX = midX - span * 0.25;
            const hanX = midX + span * 0.25;
            const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            ctx2d.fillStyle = '#5a3a1e';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.font = `${cellSize * 0.55}px XiangqiPiece, "Segoe UI", sans-serif`;
            if (boardFlipped()) {
                ctx2d.fillText('楚河', hanX, y);
                ctx2d.fillText('漢界', chuX, y);
            } else {
                ctx2d.fillText('楚河', chuX, y);
                ctx2d.fillText('漢界', hanX, y);
            }
        }

        function drawBoard() {
            ctx2d.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            const angles = [0, 60, 120, 180, 240, 300].map(deg => deg * Math.PI / 180);
            const outerVerts = angles.map(angle => ({
                x: FRAME_CENTER + OUTER_HEX_RADIUS * Math.cos(angle),
                y: FRAME_CENTER + OUTER_HEX_RADIUS * Math.sin(angle)
            }));
            // 木质外框与 weiqi 统一：无阴影、背景 #fdcc90、边线 #3a281c 0.5px
            ctx2d.shadowBlur = 0;
            ctx2d.shadowOffsetY = 0;
            ctx2d.fillStyle = '#fdcc90';
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 0.5;
            drawRoundedHexagon(outerVerts, FRAME_CORNER_RADIUS, false);


            ctx2d.lineWidth = 1.5;
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineJoin = 'miter';
            for (const hex of R.hexagons) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i];
                    const b = hex[(i + 1) % 6];
                    if (riverDropSet.has(edgeKey(a, b))) continue;
                    const pa = displayPos(a);
                    const pb = displayPos(b);
                    ctx2d.beginPath();
                    ctx2d.moveTo(pa.x, pa.y);
                    ctx2d.lineTo(pb.x, pb.y);
                    ctx2d.stroke();
                }
            }

            drawRiverLabels();

            if (ps.lastFrom != null && ps.lastTo != null) {
                [ps.lastFrom, ps.lastTo].forEach((v) => {
                    if (v == null || v < 0) return;
                    const { x, y } = displayPos(v);
                    ctx2d.beginPath();
                    ctx2d.arc(x, y, cellSize * 0.45, 0, Math.PI * 2);
                    ctx2d.strokeStyle = 'rgba(255,255,255,0.75)';
                    ctx2d.lineWidth = 2;
                    ctx2d.stroke();
                });
            }

            for (const v of ps.legalTargets) {
                const { x, y } = displayPos(v);
                const half = cellSize * 0.1;
                ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
            }

            for (let v = 0; v < R.V; v++) {
                const piece = ps.board[v];
                if (!piece) continue;
                const { x, y } = displayPos(v);
                const radius = cellSize * 0.42;
                // 与普通象棋相同视觉比例：半径≈25 时约等于 offsetY=5、blur=10
                ctx2d.shadowOffsetY = radius * 0.2;
                ctx2d.shadowBlur = radius * 0.4;
                ctx2d.shadowColor = 'rgba(0,0,0,0.45)';
                ctx2d.beginPath();
                ctx2d.arc(x, y, radius, 0, Math.PI * 2);
                ctx2d.fillStyle = '#e8d2a0';
                ctx2d.fill();
                ctx2d.shadowBlur = 0;
                ctx2d.shadowOffsetY = 0;
                ctx2d.strokeStyle = '#c49c6a';
                ctx2d.lineWidth = 1.5;
                ctx2d.stroke();
                const color = piece[0] === 'r' ? '#932c13' : '#222';
                ctx2d.fillStyle = color;
                ctx2d.font = `${cellSize * 0.52}px XiangqiPiece, "Segoe UI", sans-serif`;
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';
                ctx2d.fillText(R.pieceLabel(piece), x, y + cellSize * 0.02);
                ctx2d.beginPath();
                ctx2d.arc(x, y, radius * 0.78, 0, Math.PI * 2);
                ctx2d.strokeStyle = color;
                ctx2d.lineWidth = 1.2;
                ctx2d.stroke();
            }

            if (ps.selectedVertex >= 0) {
                const { x, y } = displayPos(ps.selectedVertex);
                ctx2d.beginPath();
                ctx2d.arc(x, y, cellSize * 0.45, 0, Math.PI * 2);
                ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                ctx2d.lineWidth = 2;
                ctx2d.stroke();
            }

            drawCheckBanner();
        }

        function updateTurn() {
            if (ps.gameOver) {
                let text = '对局结束';
                if (ps.winner === 'draw') text = '和棋';
                else if (ps.winner === 'black') text = '🔴 红方胜';
                else if (ps.winner === 'white') text = '⚫ 黑方胜';
                if (ps.recordResultText) text = ps.recordResultText;
                turnDisplay.innerText = text;
                scoreTitle.innerText = '结果';
                scoreBoard.innerText = text;
                leadInfo.innerText = ps.inCheck ? '' : '　';
                return;
            }
            const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (!matchStarted && !ps.tryPlayMode && !ps.replayMode) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                scoreTitle.innerText = '　';
                scoreBoard.innerText = '　';
                leadInfo.innerText = '　';
                return;
            }
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const label = side === 'red' ? '🔴 红方行棋' : '⚫ 黑方行棋';
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label;
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            leadInfo.innerText = ps.halfmoveClock > 60 ? `未吃子 ${ps.halfmoveClock}/120` : '　';
        }

        function syncState(state) {
            if (!state) return;
            if (state.board) ps.board = R.copyBoard(state.board);
            if (state.sideToMove) {
                ps.sideToMove = state.sideToMove;
                ps.currentPlayer = state.sideToMove === 'red' ? 1 : 2;
            } else if (state.currentPlayer) {
                ps.currentPlayer = state.currentPlayer;
                ps.sideToMove = state.currentPlayer === 1 ? 'red' : 'black';
            }
            ps.gameOver = !!state.gameOver;
            ps.winner = state.winner != null ? state.winner : null;
            ps.lastFrom = state.lastFrom != null ? state.lastFrom : null;
            ps.lastTo = state.lastTo != null ? state.lastTo : null;
            ps.inCheck = !!state.inCheck;
            ps.halfmoveClock = state.halfmoveClock || 0;
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) {
                ps.moveHistory = state.moveHistory.slice();
            } else if (state.moveCoords) {
                ps.moveHistory = state.moveCoords.filter((m) => m.type === 'move').map((m) => ({
                    player: m.player,
                    from: m.from,
                    to: m.to,
                    piece: m.piece,
                    captured: m.captured || ''
                }));
            }
            if (state.recordResultText) ps.recordResultText = state.recordResultText;
            if (state.showCheck) triggerCheckBanner();
            rebuildLiveSnapshots();
            if (!ps.replayMode && !ps.tryPlayMode && ps.liveFollowLatest) {
                ps.liveViewStep = Math.max(0, ps.liveSnapshots.length - 1);
            }
            ps.selectedVertex = -1;
            ps.legalTargets = [];
            updateIsMyTurn();
            updateTurn();
            drawBoard();
            updateReplayUI();
        }

        function updateIsMyTurn() {
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (ps.gameOver || ps.replayMode || ps.tryPlayMode || !matchStarted || !ps.mySlot) {
                ps.isMyTurn = false;
            } else {
                ps.isMyTurn = ps.mySlot === slotOfSide(ps.sideToMove);
            }
            updateMatchControlButtons();
        }

        function updateMatchControlButtons() {
            const isPlayer = !!ps.mySlot;
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            const showMatch = isPlayer && matchStarted && !ps.replayMode;
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = showMatch ? '' : 'none';
            });
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) {
                tryPlayBtn.style.display = showMatch ? 'none' : '';
                tryPlayBtn.textContent = ps.tryPlayMode ? '试下结束' : '试下';
            }
            updateRecordButtons();
        }

        function snapshotFromBoard(board, side, lastFrom, lastTo) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                lastFrom,
                lastTo
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFromBoard(R.createInitialBoard(), 'red', null, null)];
            let b = R.createInitialBoard();
            let side = 'red';
            for (const m of ps.moveHistory) {
                const from = m.from;
                const to = m.to;
                if (!R.isLegalMove(b, from, to, side)) break;
                b = R.applyMoveOnBoard(b, from, to);
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, side, from, to));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'red' ? 1 : 2;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = R.isInCheck(ps.board, ps.sideToMove);
            ps.selectedVertex = -1;
            ps.legalTargets = [];
            updateTurn();
            drawBoard();
        }

        function setLiveViewStep(step) {
            if (!ps.liveSnapshots.length) return;
            const max = ps.liveSnapshots.length - 1;
            step = Math.max(0, Math.min(max, step));
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= max;
            if (!ps.replayMode && !ps.tryPlayMode) applySnapshot(ps.liveSnapshots[step]);
            updateReplayUI();
        }

        function updateReplayUI() {
            const slider = document.getElementById('replaySlider');
            const stepDisp = document.getElementById('replayStepDisplay');
            let total = 0, cur = 0;
            if (ps.tryPlayMode) {
                total = ps.tryPlayTotalSteps;
                cur = ps.tryPlayStep;
            } else if (ps.replayMode) {
                total = ps.replayTotalSteps;
                cur = ps.replayStep;
            } else {
                total = Math.max(0, ps.liveSnapshots.length - 1);
                cur = ps.liveViewStep;
            }
            if (slider) { slider.max = total; slider.value = cur; }
            if (stepDisp) stepDisp.textContent = `${cur} / ${total}`;
            updateMatchControlButtons();
        }

        function downloadRecord(data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${recordDownloadPrefix}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function enterReplayMode(data) {
            const moves = data.moves || [];
            const snaps = [snapshotFromBoard(R.createInitialBoard(), 'red', null, null)];
            let b = R.createInitialBoard();
            let side = 'red';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+)-(\d+)$/i);
                    if (!mt) continue;
                    m = { from: +mt[2], to: +mt[3] };
                }
                if (!R.isLegalMove(b, m.from, m.to, side)) break;
                b = R.applyMoveOnBoard(b, m.from, m.to);
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, side, m.from, m.to));
            }
            ps.replaySnapshots = snaps;
            ps.replayTotalSteps = snaps.length - 1;
            ps.replayMode = true;
            ps.tryPlayMode = false;
            setReplayStep(ps.replayTotalSteps);
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.textContent = '试下';
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }

        function exitReplayMode() {
            ps.replayMode = false;
            ps.tryPlayMode = false;
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.textContent = '试下';
            if (ps.liveSnapshots.length) setLiveViewStep(ps.liveSnapshots.length - 1);
            else {
                ps.board = R.createInitialBoard();
                ps.sideToMove = 'red';
                updateTurn();
                drawBoard();
            }
        }

        function setReplayStep(step) {
            step = Math.max(0, Math.min(ps.replayTotalSteps, step));
            ps.replayStep = step;
            applySnapshot(ps.replaySnapshots[step]);
            updateReplayUI();
        }

        function enterTryPlay() {
            if (!ps.replayMode) {
                rebuildLiveSnapshots();
                ps.tryPlayBaseStep = ps.liveViewStep;
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFromBoard(ps.board, ps.sideToMove, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
            }
            ps.tryPlayMode = true;
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            ps.tryPlaySide = ps.tryPlaySnapshots[0].sideToMove;
            applySnapshot(ps.tryPlaySnapshots[0]);
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.textContent = '退出试下';
            updateReplayUI();
        }

        function exitTryPlay() {
            ps.tryPlayMode = false;
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.textContent = '试下';
            if (ps.replayMode) setReplayStep(ps.tryPlayBaseStep);
            else setLiveViewStep(ps.tryPlayBaseStep);
        }

        function setTryPlayStep(step) {
            step = Math.max(0, Math.min(ps.tryPlayTotalSteps, step));
            ps.tryPlayStep = step;
            const s = ps.tryPlaySnapshots[step];
            ps.tryPlaySide = s.sideToMove;
            applySnapshot(s);
            updateReplayUI();
        }

        function tryPlayMove(from, to) {
            if (!R.isLegalMove(ps.board, from, to, ps.tryPlaySide)) return false;
            const next = R.applyMoveOnBoard(ps.board, from, to);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFromBoard(next, side, from, to));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = side;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(from, to) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            ps.ws.send(JSON.stringify({ type: 'move', from, to }));
        }

        function getNearestVertex(canvasX, canvasY) {
            let minDist = Infinity;
            let best = -1;
            for (let v = 0; v < R.V; v++) {
                const { x, y } = displayPos(v);
                const d = Math.hypot(canvasX - x, canvasY - y);
                if (d < minDist) {
                    minDist = d;
                    best = v;
                }
            }
            return minDist < clickThreshold ? best : -1;
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = CANVAS_SIZE / rect.width;
            return {
                x: (clientX - rect.left) * scale,
                y: (clientY - rect.top) * scale
            };
        }

        function handleBoardClick(clientX, clientY) {
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { x, y } = canvasCoordsFromClient(clientX, clientY);
            const v = getNearestVertex(x, y);
            if (v < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const ch = R.sideColorChar(side);

            if (ps.selectedVertex < 0) {
                const p = ps.board[v];
                if (p && p[0] === ch) {
                    ps.selectedVertex = v;
                    refreshLegalTargets();
                    drawBoard();
                }
                return;
            }

            if (v === ps.selectedVertex) {
                ps.selectedVertex = -1;
                ps.legalTargets = [];
                drawBoard();
                return;
            }

            const p2 = ps.board[v];
            if (p2 && p2[0] === ch) {
                ps.selectedVertex = v;
                refreshLegalTargets();
                drawBoard();
                return;
            }

            const from = ps.selectedVertex;
            if (ps.tryPlayMode) {
                if (tryPlayMove(from, v)) {
                    ps.selectedVertex = -1;
                    ps.legalTargets = [];
                }
                return;
            }
            if (R.isLegalMove(ps.board, from, v, side)) {
                commitMove(from, v);
                ps.selectedVertex = -1;
                ps.legalTargets = [];
                drawBoard();
            }
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            seatOverlayShape: 'hexagon',
            slotUi: SLOT_UI,
            timeControlDefaults: { mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 },
            roomId,
            gameType,
            pageState: ps,
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ps.ws,
            getBoardSize: () => BOARD_SIZE,
            setBoardSize: () => {},
            getKomi: () => 0,
            setKomi: () => {},
            getBoard: () => ps.board,
            setBoard: (b) => { ps.board = b; },
            getSlots: () => ps.slots,
            setSlots: (s) => { ps.slots = s; },
            getMySlot: () => ps.mySlot,
            setMySlot: (s) => { ps.mySlot = s; },
            getGameOver: () => ps.gameOver,
            setGameOver: (v) => { ps.gameOver = v; },
            getWinner: () => ps.winner,
            setWinner: (w) => { ps.winner = w; },
            getReplayMode: () => ps.replayMode,
            getShowEstimateActive: () => false,
            setShowEstimateActive: () => {},
            getWaitingScoreConfirm: () => false,
            setWaitingScoreConfirm: () => {},
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
            syncState,
            updateBoardGeometry: () => {},
            initBoardArray: () => R.createInitialBoard(),
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview: () => {},
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm: () => {},
            isMouseDevice,
            onSeatOverlayUpdated() { drawBoard(); }
        });

        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;

        function connectWebSocket() {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const url = `${proto}://${location.host}/qi/ws?game=${encodeURIComponent(gameType)}&room=${encodeURIComponent(roomId)}`;
            const ws = new WebSocket(url);
            ps.ws = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', password: roomPassword || '' }));
            };
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                handleMessage(msg);
                if (msg.type === 'timeControlAgreed' || msg.type === 'colorAssigned' || msg.type === 'colorsFinalized'
                    || msg.type === 'gameState' || msg.type === 'broadcast' || msg.type === 'joined'
                    || msg.type === 'newGameStarted' || msg.type === 'roomReset') {
                    updateIsMyTurn();
                    drawBoard();
                    updateTurn();
                    updateReplayUI();
                }
                if (msg.type === 'gameRecord') downloadRecord(msg.data);
            };
            ws.onclose = () => {
                if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
                if (ps.reconnectTimer) return;
                ps.reconnectTimer = setTimeout(() => {
                    ps.reconnectTimer = null;
                    connectWebSocket();
                }, 1200);
            };
        }

        connectWebSocket();
        if (document.fonts && document.fonts.load) {
            document.fonts.load('48px XiangqiPiece').then(() => drawBoard()).catch(() => {});
        }

        canvas.addEventListener('click', (e) => handleBoardClick(e.clientX, e.clientY));

        const tryPlayBtn = document.getElementById('tryPlayBtn');
        if (tryPlayBtn) {
            tryPlayBtn.onclick = () => {
                if (ps.tryPlayMode) exitTryPlay();
                else enterTryPlay();
                updateMatchControlButtons();
            };
        }
        const replayBackBtn = document.getElementById('replayBackBtn');
        if (replayBackBtn) {
            replayBackBtn.onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                else if (ps.replayMode) setReplayStep(ps.replayStep - 1);
                else setLiveViewStep(ps.liveViewStep - 1);
            };
        }
        const replayForwardBtn = document.getElementById('replayForwardBtn');
        if (replayForwardBtn) {
            replayForwardBtn.onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                else if (ps.replayMode) setReplayStep(ps.replayStep + 1);
                else setLiveViewStep(ps.liveViewStep + 1);
            };
        }
        const replaySlider = document.getElementById('replaySlider');
        if (replaySlider) {
            replaySlider.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10);
                if (ps.tryPlayMode) setTryPlayStep(v);
                else if (ps.replayMode) setReplayStep(v);
                else setLiveViewStep(v);
            });
        }

        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) helpBtn.onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
        const closeRulesBtn = document.getElementById('closeRulesBtn');
        if (closeRulesBtn) closeRulesBtn.onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
        const backToLobbyBtn = document.getElementById('backToLobbyBtn');
        if (backToLobbyBtn) backToLobbyBtn.onclick = () => { location.href = '/qi'; };

        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
