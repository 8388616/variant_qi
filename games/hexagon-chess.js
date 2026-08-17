const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/**
 * 六角国际象棋（自定义变体）：
 * - 7 路六角棋盘（11 行，行长 6..11..6，共 91 格，棋子下在格内），三色着色 (r+c)%3：深/中/浅，底行深中浅循环、左下角深色
 * - 白方在底部（r=12），黑方在顶部（r=0），双方后都在自己视角的左侧
 * - 车/象/后/王/马走法同金斯基六角国际象棋；兵为自定义走法（见下方说明）
 */
const R = (function () {
'use strict';

const ROWS = 11;
const PIECE_CHAR = {
    wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
    bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
};
const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

/** 行 r 的格数：7..13..7（7 路六角棋盘） */
function rowLen(r) {
    if (r < 0 || r >= ROWS) return 0;
    return 6 + Math.min(r, ROWS - 1 - r);
}
function isValidCoord(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < rowLen(r);
}
function emptyBoard() {
    return Array(ROWS).fill(null).map((_, r) => Array(rowLen(r)).fill(''));
}
function copyBoard(src) {
    return src.map((row) => row.slice());
}

function createInitialBoard() {
    const b = emptyBoard();
    // 白方（底部）：行 10（6 格）车马后王马车；行 9（7 格）兵兵象象象兵兵；行 8（8 格）空兵×6空
    b[10][0] = 'wr'; b[10][1] = 'wn'; b[10][2] = 'wq'; b[10][3] = 'wk';
    b[10][4] = 'wn'; b[10][5] = 'wr';
    b[9][0] = 'wp'; b[9][1] = 'wp'; b[9][2] = 'wb'; b[9][3] = 'wb';
    b[9][4] = 'wb'; b[9][5] = 'wp'; b[9][6] = 'wp';
    b[8][0] = ''; for (let c = 1; c <= 6; c++) b[8][c] = 'wp'; b[8][7] = '';
    // 黑方（顶部，白方视角下后左王右；双方当面下棋左右相同）
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'bq'; b[0][3] = 'bk';
    b[0][4] = 'bn'; b[0][5] = 'br';
    b[1][0] = 'bp'; b[1][1] = 'bp'; b[1][2] = 'bb'; b[1][3] = 'bb';
    b[1][4] = 'bb'; b[1][5] = 'bp'; b[1][6] = 'bp';
    b[2][0] = ''; for (let c = 1; c <= 6; c++) b[2][c] = 'bp'; b[2][7] = '';
    return b;
}

function copyCastling(c) {
    return { white: !!c.white, black: !!c.black };
}
function defaultCastling() {
    return { white: true, black: true };
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
    return isValidCoord(row, col);
}
function findKing(board, side) {
    const code = side === 'white' ? 'wk' : 'bk';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] === code) return { row: r, col: c };
        }
    }
    return null;
}

/**
 * 六角邻居：6 个方向（E/W 水平；上两邻、下两邻按相邻行行长自动错位）。
 * 返回 { E, W, NE, NW, SE, SW } 或 null（越界/不存在）。
 */
function dirNeighbor(r, c, d) {
    if (!isValidCoord(r, c)) return null;
    if (d === 'E') return isValidCoord(r, c + 1) ? { row: r, col: c + 1 } : null;
    if (d === 'W') return isValidCoord(r, c - 1) ? { row: r, col: c - 1 } : null;
    let up, down;
    if (r > 0) {
        up = rowLen(r - 1) > rowLen(r)
            ? [{ row: r - 1, col: c }, { row: r - 1, col: c + 1 }]      // NW, NE
            : [{ row: r - 1, col: c - 1 }, { row: r - 1, col: c }];     // NW, NE
    }
    if (r < ROWS - 1) {
        down = rowLen(r + 1) > rowLen(r)
            ? [{ row: r + 1, col: c }, { row: r + 1, col: c + 1 }]      // SW, SE
            : [{ row: r + 1, col: c - 1 }, { row: r + 1, col: c }];     // SW, SE
    }
    if (d === 'NE') return up && isValidCoord(up[1].row, up[1].col) ? up[1] : null;
    if (d === 'NW') return up && isValidCoord(up[0].row, up[0].col) ? up[0] : null;
    if (d === 'SE') return down && isValidCoord(down[1].row, down[1].col) ? down[1] : null;
    if (d === 'SW') return down && isValidCoord(down[0].row, down[0].col) ? down[0] : null;
    return null;
}

function hexNeighbors(r, c) {
    const out = [];
    for (const d of ['E', 'W', 'NE', 'NW', 'SE', 'SW']) {
        const n = dirNeighbor(r, c, d);
        if (n) out.push(n);
    }
    return out;
}

const BISHOP_THETAS = [30, 90, 150, 210, 270, 330];

function offsetOf(r) {
    return (5 - Math.min(r, ROWS - 1 - r)) / 2;
}

/** 象线扫描：沿绝对方向 θ 找下一个格点（在格心直线上） */
function bishopNext(r, c, theta) {
    const rad = theta * Math.PI / 180;
    const sinT = Math.sin(rad);
    const cosT = Math.cos(rad);
    if (Math.abs(sinT) < 1e-9) return null;
    const dirR = sinT > 0 ? 1 : -1;
    const x0 = offsetOf(r) + c;
    for (let k = 1; k <= ROWS; k++) {
        const rr = r + dirR * k;
        if (rr < 0 || rr >= ROWS) return null;
        // 线的 x 偏移（cell）：Δx = Δy·cotθ = (dirR·k·0.866)·cos/sin（Δy 带 dirR 符号）
        const dxLine = dirR * k * 0.866 * cosT / sinT;
        const xLine = x0 + dxLine;
        const cFloat = xLine - offsetOf(rr);
        const c1 = Math.round(cFloat);
        // 容差 0.01：0.866×cos/sin 累积的浮点误差（实测 ~4e-5）
        if (Math.abs(cFloat - c1) < 0.01 && isValidCoord(rr, c1)) {
            // 中间格：线上起点与目标之间、与线距离 < 1 的**所有**格
            // （线正好穿过半格处两格中间时，左右两个格都纳入检查）
            const mids = [];
            for (let kk = 1; kk < k; kk++) {
                const r2 = r + dirR * kk;
                const xLine2 = x0 + dirR * kk * 0.866 * cosT / sinT;
                const cf2 = xLine2 - offsetOf(r2);
                for (let cc = Math.floor(cf2 - 0.5); cc <= Math.ceil(cf2 + 0.5); cc++) {
                    if (isValidCoord(r2, cc) && Math.abs(cf2 - cc) < 1) mids.push({ row: r2, col: cc });
                }
            }
            return { row: rr, col: c1, mids };
        }
    }
    return null;
}

/**
 * 象直线（6 绝对方向），含中间格检查。
 * 中间格 = 直线上起点与目标之间的格（线擦过的格，金斯基象不可跳过棋子）。
 */
function bishopLineTargets(board, r, c, color) {
    const out = [];
    for (const th of BISHOP_THETAS) {
        let cur = { row: r, col: c };
        while (true) {
            const step = bishopNext(cur.row, cur.col, th);
            if (!step) break;
            // 半格处左右两格**都有**棋子才阻挡；一边有子不阻挡（线从另一边穿过）
            const blocked = step.mids.length > 0 && step.mids.every((m) => board[m.row][m.col] !== '');
            const targetVal = board[step.row][step.col];
            if (blocked) break;
            if (targetVal !== '') {
                if (targetVal[0] !== color) out.push(step);
                break;
            }
            out.push(step);
            cur = { row: step.row, col: step.col };
        }
    }
    return out;
}

/** 车直线（6 车方向） */
function rookLineTargets(board, r, c, color) {
    const out = [];
    for (const d of ['E', 'W', 'NE', 'NW', 'SE', 'SW']) {
        let cur = { row: r, col: c };
        while (true) {
            const n = dirNeighbor(cur.row, cur.col, d);
            if (!n) break;
            const v = board[n.row][n.col];
            if (v !== '') {
                if (v[0] !== color) out.push(n);
                break;
            }
            out.push(n);
            cur = n;
        }
    }
    return out;
}

/** 马：车 1 步 + 象 1 步（可跳，12 位置） */
function knightTargets(board, r, c, color) {
    const out = [];
    const seen = new Set();
    const tryAdd = (n) => {
        if (!n || !isValidCoord(n.row, n.col)) return;
        const key = n.row + ',' + n.col;
        if (seen.has(key)) return;
        const v = board[n.row][n.col];
        if (v !== '' && v[0] === color) return;
        seen.add(key);
        out.push(n);
    };
    // 先车后象
    for (const d of ['E', 'W', 'NE', 'NW', 'SE', 'SW']) {
        const m1 = dirNeighbor(r, c, d);
        if (!m1) continue;
        for (const th of BISHOP_THETAS) {
            const s = bishopNext(m1.row, m1.col, th);
            if (s) tryAdd(s);
        }
    }
    // 先象后车
    for (const th of BISHOP_THETAS) {
        const s = bishopNext(r, c, th);
        if (!s) continue;
        for (const d of ['E', 'W', 'NE', 'NW', 'SE', 'SW']) {
            const m2 = dirNeighbor(s.row, s.col, d);
            if (m2) tryAdd(m2);
        }
    }
    return out;
}

/**
 * 兵：
 * - 直走：左前 / 右前（白：NW/NE；黑：SW/SE）移动到相邻格
 * - 斜吃：左前格的左侧格 / 右前格的右侧格（白：NW 的 W、NE 的 E；黑：SW 的 W？——黑方"左前格的左侧格"）
 * - 起始行兵可走两步（LL/LR/RL/RR，LR 与 RL 同目标）
 * - 吃过路兵：上一步对方兵两步走，己方斜吃目标 = 对方第一步格时可按吃子走到该格
 */
function pawnMoves(board, r, c, color, meta) {
    const out = [];
    const side = color === 'w' ? 'white' : 'black';
    const forwardDirs = side === 'white' ? ['NW', 'NE'] : ['SW', 'SE'];
    // 黑方视角的"左前/右前"：黑方朝下，黑方左前 = 白方视角的 SW？——黑方视角左 = 白方视角右：
    // 黑方"左前" = 朝下 + 黑方左 = 白方右下 = SE？——统一：白方左前 = NW、右前 = NE；黑方左前 = SW、右前 = SE？
    // （黑方面朝下时左右与白方相同（棋盘不翻转）——黑方左前 = 白方视角的左下 = SW、右前 = SE）
    // ——但用户定义"斜吃 = 左前格的左侧格"——黑方左前格 (SW) 的"左侧格"（黑方视角左 = 白方视角右 = E 方向）
    const FL = forwardDirs[0], FR = forwardDirs[1];
    const startRows = side === 'white' ? [8, 9] : [1, 2];
    const ep = meta && meta.enPassant;

    const one = dirNeighbor(r, c, FL);
    if (one) {
        if (board[one.row][one.col] === '') out.push({ row: one.row, col: one.col, kind: 'single' });
        // 斜吃：左前格的左侧格（当面下棋双方左右相同：左 = W）
        const bite = dirNeighbor(one.row, one.col, 'W');
        if (bite) {
            const v = board[bite.row][bite.col];
            if (v && v[0] !== color) out.push({ row: bite.row, col: bite.col, kind: 'cap' });
            if (ep && ep.row === bite.row && ep.col === bite.col) out.push({
                row: bite.row, col: bite.col, kind: 'ep',
                epRow: one.row, epCol: one.col,
                targetRow: ep.targetRow, targetCol: ep.targetCol
            });
        }
    }
    const one2 = dirNeighbor(r, c, FR);
    if (one2) {
        if (board[one2.row][one2.col] === '') out.push({ row: one2.row, col: one2.col, kind: 'single' });
        const bite = dirNeighbor(one2.row, one2.col, 'E');
        if (bite) {
            const v = board[bite.row][bite.col];
            if (v && v[0] !== color) out.push({ row: bite.row, col: bite.col, kind: 'cap' });
            if (ep && ep.row === bite.row && ep.col === bite.col) out.push({
                row: bite.row, col: bite.col, kind: 'ep',
                epRow: one2.row, epCol: one2.col,
                targetRow: ep.targetRow, targetCol: ep.targetCol
            });
        }
    }
    // 两步兵（起始行）：LL / LR / RL / RR（LR 与 RL 同目标）
    if (startRows.indexOf(r) >= 0) {
        const twoStep = [
            [FL, FL], [FL, FR], [FR, FL], [FR, FR]
        ];
        const seen = new Set();
        for (const [d1, d2] of twoStep) {
            const m1 = dirNeighbor(r, c, d1);
            if (!m1 || board[m1.row][m1.col] !== '') continue;
            const m2 = dirNeighbor(m1.row, m1.col, d2);
            if (!m2 || board[m2.row][m2.col] !== '') continue;
            const key = m2.row + ',' + m2.col;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ row: m2.row, col: m2.col, kind: 'double', midRow: m1.row, midCol: m1.col });
        }
    }
    return out;
}

/** 王：6 方向 1 步 + 易位（王与左侧车：王左移 2、车右移 2） */
function kingMoves(board, r, c, color, meta) {
    const out = [];
    const side = color === 'w' ? 'white' : 'black';
    for (const d of ['E', 'W', 'NE', 'NW', 'SE', 'SW']) {
        const n = dirNeighbor(r, c, d);
        if (!n) continue;
        const v = board[n.row][n.col];
        if (v === '' || v[0] !== color) out.push({ row: n.row, col: n.col });
    }
    // 易位：王向左移 2 格、车向右移 2 格
    const castling = (meta && meta.castling) || defaultCastling();
    if (isInCheck(board, side)) return out;
    if (side === 'white') {
        if (r !== 10 || c !== 3 || !castling.white) return out;
        if (board[10][0] !== 'wr') return out;
        if (board[10][1] !== '' || board[10][2] !== '') return out;
        if (isSquareAttackedBy(board, 10, 2, 'black')) return out;
        if (isSquareAttackedBy(board, 10, 1, 'black')) return out;
        out.push({ row: 10, col: 1, castling: true });
    } else {
        // 黑方视角的左侧 = 白方视角的左侧（当面下棋左右相同）；黑王 (0,3)、左车 (0,0)
        if (r !== 0 || c !== 3 || !castling.black) return out;
        if (board[0][0] !== 'br') return out;
        if (board[0][1] !== '' || board[0][2] !== '') return out;
        if (isSquareAttackedBy(board, 0, 2, 'white')) return out;
        if (isSquareAttackedBy(board, 0, 1, 'white')) return out;
        out.push({ row: 0, col: 1, castling: true });
    }
    return out;
}

/** 攻击判定（不含易位） */
function attacksSquare(piece, fromRow, fromCol, toRow, toCol, board) {
    if (!piece || !isValidCoord(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const type = piece[1];
    const color = piece[0];
    if (type === 'k') {
        return !!dirNeighbor(fromRow, fromCol, 'E') && dirNeighbor(fromRow, fromCol, 'E').row === toRow && dirNeighbor(fromRow, fromCol, 'E').col === toCol
            || !!dirNeighbor(fromRow, fromCol, 'W') && dirNeighbor(fromRow, fromCol, 'W').row === toRow && dirNeighbor(fromRow, fromCol, 'W').col === toCol
            || !!dirNeighbor(fromRow, fromCol, 'NE') && dirNeighbor(fromRow, fromCol, 'NE').row === toRow && dirNeighbor(fromRow, fromCol, 'NE').col === toCol
            || !!dirNeighbor(fromRow, fromCol, 'NW') && dirNeighbor(fromRow, fromCol, 'NW').row === toRow && dirNeighbor(fromRow, fromCol, 'NW').col === toCol
            || !!dirNeighbor(fromRow, fromCol, 'SE') && dirNeighbor(fromRow, fromCol, 'SE').row === toRow && dirNeighbor(fromRow, fromCol, 'SE').col === toCol
            || !!dirNeighbor(fromRow, fromCol, 'SW') && dirNeighbor(fromRow, fromCol, 'SW').row === toRow && dirNeighbor(fromRow, fromCol, 'SW').col === toCol;
    }
    if (type === 'n') {
        for (const t of knightTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'p') {
        // 兵的攻击格 = 斜吃目标（不含过路兵；当面下棋双方左右相同）
        const side = color === 'w' ? 'white' : 'black';
        const FL = side === 'white' ? 'NW' : 'SW';
        const FR = side === 'white' ? 'NE' : 'SE';
        const one = dirNeighbor(fromRow, fromCol, FL);
        if (one) {
            const bite = dirNeighbor(one.row, one.col, 'W');
            if (bite && bite.row === toRow && bite.col === toCol) return true;
        }
        const one2 = dirNeighbor(fromRow, fromCol, FR);
        if (one2) {
            const bite = dirNeighbor(one2.row, one2.col, 'E');
            if (bite && bite.row === toRow && bite.col === toCol) return true;
        }
        return false;
    }
    if (type === 'r' || type === 'q') {
        for (const t of rookLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        if (type === 'r') return false;
    }
    if (type === 'b' || type === 'q') {
        for (const t of bishopLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    return false;
}

function isSquareAttackedBy(board, row, col, bySide) {
    const ch = sideColorChar(bySide);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < board[r].length; c++) {
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

function needsPromotion(piece, toRow) {
    if (!piece || piece[1] !== 'p') return false;
    if (piece[0] === 'w') return toRow === 0;
    return toRow === ROWS - 1;
}

function normalizePromote(promote) {
    if (!promote) return 'q';
    const t = String(promote).toLowerCase();
    return PROMOTE_TYPES.indexOf(t) >= 0 ? t : 'q';
}

function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta) {
    if (!piece || !isValidCoord(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const color = piece[0];
    const type = piece[1];
    const target = board[toRow][toCol];
    if (target && target[0] === color) return false;

    if (type === 'n') {
        for (const t of knightTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'r') {
        for (const t of rookLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'b') {
        for (const t of bishopLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'q') {
        for (const t of rookLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        for (const t of bishopLineTargets(board, fromRow, fromCol, color)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'k') {
        for (const t of kingMoves(board, fromRow, fromCol, color, meta)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    if (type === 'p') {
        for (const t of pawnMoves(board, fromRow, fromCol, color, meta)) {
            if (t.row === toRow && t.col === toCol) return true;
        }
        return false;
    }
    return false;
}

/**
 * 执行走子，返回 { board, castling, enPassant, captured, wasPawnMove, wasDouble }
 */
function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote) {
    const next = copyBoard(board);
    const piece = next[fromRow][fromCol];
    const castling = copyCastling((meta && meta.castling) || defaultCastling());
    const ep = meta && meta.enPassant;
    let captured = next[toRow][toCol] || '';
    let newEp = null;
    const wasPawnMove = piece && piece[1] === 'p';
    let wasDouble = false;

    // 找到这步的类型（兵两步/过路兵/易位）
    let moveKind = null;
    if (piece && piece[1] === 'p') {
        const side = piece[0] === 'w' ? 'white' : 'black';
        for (const t of pawnMoves(next, fromRow, fromCol, piece[0], meta)) {
            if (t.row === toRow && t.col === toCol) { moveKind = t; break; }
        }
        if (moveKind && moveKind.kind === 'ep') {
            // 吃掉的是刚走两步的兵（在目标格 targetRow/targetCol），走到的是第一步格 epRow/epCol
            captured = next[moveKind.targetRow][moveKind.targetCol] || '';
            next[moveKind.targetRow][moveKind.targetCol] = '';
        }
        if (moveKind && moveKind.kind === 'double') wasDouble = true;
    } else if (piece && piece[1] === 'k' && Math.abs(toCol - fromCol) === 2) {
        moveKind = { kind: 'castling' };
    }

    // 易位：挪车（王左移 2、车右移 2）
    if (moveKind && moveKind.kind === 'castling') {
        if (piece[0] === 'w') {
            next[10][2] = next[10][0];
            next[10][0] = '';
        } else {
            next[0][2] = next[0][0];
            next[0][0] = '';
        }
    }

    next[toRow][toCol] = piece;
    next[fromRow][fromCol] = '';

    // 升变
    if (needsPromotion(piece, toRow)) {
        const t = normalizePromote(promote);
        next[toRow][toCol] = piece[0] + t;
    }

    // 更新易位权
    if (piece === 'wk') castling.white = false;
    if (piece === 'bk') castling.black = false;
    if (piece === 'wr' && fromRow === 10 && fromCol === 0) castling.white = false;
    if (piece === 'br' && fromRow === 0 && fromCol === 0) castling.black = false;
    if (captured === 'wr' && toRow === 10 && toCol === 0) castling.white = false;
    if (captured === 'br' && toRow === 0 && toCol === 0) castling.black = false;

    // 新过路兵格（两步兵：记录第一步格 + 兵的目标格）
    if (wasDouble) {
        newEp = { row: moveKind.midRow, col: moveKind.midCol, targetRow: toRow, targetCol: toCol };
    }

    return {
        board: next,
        castling,
        enPassant: newEp,
        captured,
        wasPawnMove,
        wasDouble
    };
}

function isLegalMove(board, fromRow, fromCol, toRow, toCol, side, meta, promote) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta)) return false;
    if (needsPromotion(piece, toRow)) {
        const t = promote == null ? 'q' : String(promote).toLowerCase();
        if (PROMOTE_TYPES.indexOf(t) < 0) return false;
    }
    const applied = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, side, meta) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < ROWS; fr++) {
        for (let fc = 0; fc < board[fr].length; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            // 枚举所有目标格
            for (let tr = 0; tr < ROWS; tr++) {
                for (let tc = 0; tc < board[tr].length; tc++) {
                    if (!isPseudoLegalMove(p, fr, fc, tr, tc, board, meta)) continue;
                    if (needsPromotion(p, tr)) {
                        for (const promo of PROMOTE_TYPES) {
                            if (isLegalMove(board, fr, fc, tr, tc, side, meta, promo)) {
                                moves.push({
                                    fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                                    promote: promo,
                                    capture: !!board[tr][tc] || !!(meta && meta.enPassant
                                        && meta.enPassant.row === tr && meta.enPassant.col === tc)
                                });
                            }
                        }
                    } else if (isLegalMove(board, fr, fc, tr, tc, side, meta, null)) {
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

/** 子力不足：仅王（+ 同色象/马） */
function isInsufficientMaterial(board) {
    const pieces = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < board[r].length; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p[1];
            if (t === 'k') continue;
            if (t === 'q' || t === 'p') return false;
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
        // 六角棋盘 3 色：象所在格颜色 (r+c)%3
        const color0 = (pieces[0].row + pieces[0].col) % 3;
        const color1 = (pieces[1].row + pieces[1].col) % 3;
        return color0 === color1;
    }
    return false;
}

function positionKey(board, sideToMove, meta) {
    let s = sideToMove === 'white' ? 'w|' : 'b|';
    const castling = (meta && meta.castling) || defaultCastling();
    s += (castling.white ? 'W' : '') + (castling.black ? 'B' : '') + '|';
    const ep = meta && meta.enPassant;
    s += ep ? `${ep.row},${ep.col}|` : '-|';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < board[r].length; c++) {
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
    ROWS,
    PIECE_CHAR,
    PROMOTE_TYPES,
    rowLen,
    isValidCoord,
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
class HexagonalChessRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.editBoardAllowedValues = ['', 'wp', 'wb', 'wn', 'wr', 'wq', 'wk', 'bp', 'bb', 'bn', 'br', 'bq', 'bk'];
        this.boardRows = R.ROWS;
        this.boardCols = R.ROWS;
        this.resetToEmpty();
    }

    /** 编辑盘面若有兵已在对方底线，须先逐一升变才能走棋 */
    _pendingPawnPromotion() {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const row = this.sideToMove === 'white' ? 0 : R.ROWS - 1;
        for (let c = 0; c < R.rowLen(row); c++) {
            if (this.board[row][c] === pawn) return { row, col: c };
        }
        return null;
    }

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

    /** 编辑棋盘：客户端提交锯齿二维数组（各行长 rowLen(r)，'' 或棋子码） */
    applyEditBoard(ws, msg) {
        const edited = msg.board;
        if (!Array.isArray(edited) || edited.length !== R.ROWS) {
            ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
            return;
        }
        const allowed = this.editBoardAllowedValues;
        const next = [];
        for (let r = 0; r < R.ROWS; r++) {
            const row = edited[r];
            if (!Array.isArray(row) || row.length !== R.rowLen(r)) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return;
            }
            for (let c = 0; c < row.length; c++) {
                if (row[c] !== '' && !allowed.includes(row[c])) {
                    ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                    return;
                }
            }
            next.push(row.slice());
        }
        this.board = next;
        this.historyBoards = [JSON.stringify(this.board)];
        this.moveHistory = [];
        this.moveCoords = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.sideToMove = 'white';
        this.halfmoveClock = 0;
        this.openingBoard = JSON.parse(JSON.stringify(this.board));
        this.broadcast({ type: 'editBoardAccepted', ...this.getState() });
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
            boardSize: 7,
            boardRows: R.ROWS,
            boardCols: R.ROWS,
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
            gameType: '六角国际象棋',
            gameId: 'hexagon-chess',
            boardRows: R.ROWS,
            boardCols: R.ROWS,
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
        const applied = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol, meta, promote);
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
        if (!data || data.gameId !== 'hexagon-chess') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要六角国际象棋棋谱）。' }));
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
    initRoom(room) {
        room.gameLogic = new HexagonalChessRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
