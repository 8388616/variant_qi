window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["hexagon-chess"] = {
    shell: {
        "title": "六角国际象棋",
        "rulesHtml": "基本规则类似国际象棋，采用六角棋盘。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 7,
        "boardSizeMax": 7,
        "defaultBoardSize": 7,
        "minLib": 1,
        "recordDownloadPrefix": "六角国际象棋",
        "standardWeiqiMatchTime": true,
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "wq", "label": "♕", "cellValue": "wq", "color": "#222" },
            { "value": "wr", "label": "♖", "cellValue": "wr", "color": "#222" },
            { "value": "wn", "label": "♘", "cellValue": "wn", "color": "#222" },
            { "value": "wb", "label": "♗", "cellValue": "wb", "color": "#222" },
            { "value": "wp", "label": "♙", "cellValue": "wp", "color": "#222" },
            { "value": "wk", "label": "♔", "cellValue": "wk", "color": "#222" },
            { "value": "bq", "label": "♛", "cellValue": "bq", "color": "#222" },
            { "value": "br", "label": "♜", "cellValue": "br", "color": "#222" },
            { "value": "bn", "label": "♞", "cellValue": "bn", "color": "#222" },
            { "value": "bb", "label": "♝", "cellValue": "bb", "color": "#222" },
            { "value": "bp", "label": "♟", "cellValue": "bp", "color": "#222" },
            { "value": "bk", "label": "♚", "cellValue": "bk", "color": "#222" }
        ],
        "editToolGlyphSize": 26,
        "features": {
            "editBoard": true,
            "hideBoardSize": true,
            "transparentCanvas": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "六角国际象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
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

const KNIGHT_DIRS = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
/** 转向方向：首步方向的相邻两方向（d±60°）——远离起点；直行与三个靠近起点的方向排除 */
function knightTurnDirs(d) {
    const i = KNIGHT_DIRS.indexOf(d);
    return [KNIGHT_DIRS[(i + 1) % 6], KNIGHT_DIRS[(i + 5) % 6]];
}
/** 马：先沿某方向走两格，再沿另一方向走一格（转向必须远离起点），沿途允许有棋子——每起点 12 位置 */
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
    for (const d of KNIGHT_DIRS) {
        const p1 = dirNeighbor(r, c, d);
        if (!p1) continue;
        const p2 = dirNeighbor(p1.row, p1.col, d);
        if (!p2) continue;
        for (const t of knightTurnDirs(d)) {
            const s = dirNeighbor(p2.row, p2.col, t);
            if (s) tryAdd(s);
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

        const SLOT_UI = {
            black: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };
        const PROMOTE_LABELS = { q: '♛', r: '♜', n: '♞', b: '♝' };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const LOGICAL_SIZE = 600;
        // 六角棋盘几何：11 行（行长 6..11..6），格距 46.15，棋盘水平中心修正到 300
        const CELL = LOGICAL_SIZE / 13;
        const ROW_H = 0.8660254037844386 * CELL;
        const TOP = (LOGICAL_SIZE - (R.ROWS - 1) * ROW_H) / 2;
        const CX_OFF = LOGICAL_SIZE / 2 - 6 * CELL;   // 棋盘中心 6×CELL → 300
        const HEX_OUTER = CELL / 1.7320508075688772;   // 六角格外接半径（边长）
        const HEX_INNER = CELL * 0.5;
        // 木质外框正六边形（与六角围棋同款）：中心 300,300、外接半径 280、圆角 12
        const FRAME_CENTER = LOGICAL_SIZE / 2;
        const OUTER_HEX_RADIUS = 280;
        const FRAME_CORNER_RADIUS = 12;
        function offsetOfR(r) {
            return (5 - Math.min(r, R.ROWS - 1 - r)) / 2;
        }
        function cellCenter(r, c) {
            return { x: (offsetOfR(r) + c + 1) * CELL + CX_OFF, y: TOP + r * ROW_H };
        }
        // 黑方视角：棋盘旋转 180°（黑方坐在棋盘对面，看到的是倒置的棋盘）
        function isBlackView() {
            return ps && ps.mySlot === 'white';
        }
        function displayPos(r, c) {
            if (!isBlackView()) return { row: r, col: c };
            return { row: R.ROWS - 1 - r, col: R.rowLen(R.ROWS - 1 - r) - 1 - c };
        }
        function tracePoly(verts) {
            ctx2d.beginPath();
            verts.forEach((p, i) => {
                if (i === 0) ctx2d.moveTo(p.x, p.y);
                else ctx2d.lineTo(p.x, p.y);
            });
            ctx2d.closePath();
        }
        function traceHex(x, y, radius) {
            ctx2d.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (30 + i * 60) * Math.PI / 180;
                const px = x + radius * Math.cos(a);
                const py = y + radius * Math.sin(a);
                if (i === 0) ctx2d.moveTo(px, py);
                else ctx2d.lineTo(px, py);
            }
            ctx2d.closePath();
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
        function outerFrameVerts() {
            const angles = [0, 60, 120, 180, 240, 300].map((deg) => deg * Math.PI / 180);
            return angles.map((angle) => ({
                x: FRAME_CENTER + OUTER_HEX_RADIUS * Math.cos(angle),
                y: FRAME_CENTER + OUTER_HEX_RADIUS * Math.sin(angle)
            }));
        }

        function applyHiDpiCanvas(redraw) {
            if (typeof QiWeiqiSquarePageRuntime === 'undefined' || !QiWeiqiSquarePageRuntime.setupHiDpiCanvas) return;
            QiWeiqiSquarePageRuntime.setupHiDpiCanvas(canvas, LOGICAL_SIZE);
            if (redraw) drawBoard();
        }
        applyHiDpiCanvas(false);
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            window.requestAnimationFrame(() => applyHiDpiCanvas(true));
        }
        window.addEventListener('resize', () => applyHiDpiCanvas(true));

        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        // 三色格（沿用国际象棋深浅色 + 中间色）：0 深 / 1 中 / 2 浅
        // 前六行（行 0..5）从顶部计数 (r+c)%3；后六行（行 5..10）从底部计数 (10-r+c)%3；行 5 两公式一致
        const CELL_COLORS = ['#b58863', '#d6b58c', '#f0d9b5'];
        function cellColor(r, c) {
            if (r <= 5) return CELL_COLORS[(r + c) % 3];
            return CELL_COLORS[((R.ROWS - 1 - r) + c) % 3];
        }

        const initMeta = R.createInitialMeta();
        const ps = {
            board: R.createInitialBoard(),
            castling: R.copyCastling(initMeta.castling),
            enPassant: null,
            sideToMove: 'white',
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            gameStarted: false,
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
            selectedRow: -1,
            selectedCol: -1,
            legalTargets: [],
            hoverRow: -1,
            hoverCol: -1,
            inCheck: false,
            checkBannerUntil: 0,
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
            tryPlaySide: 'white',
            recordResultText: null,
            waitingScoreConfirm: false,
            iRejected: false,
            showEstimateActive: false,
            pendingPromote: null,
            pendingPawnPromote: null
        };

        function drawBoard() {
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
            // 六角形木质外框（与六角围棋同款：无阴影、背景 #fdcc90、边线 #3a281c 0.5px）
            ctx2d.shadowBlur = 0;
            ctx2d.shadowOffsetY = 0;
            ctx2d.fillStyle = '#fdcc90';
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 0.5;
            drawRoundedHexagon(outerFrameVerts(), FRAME_CORNER_RADIUS, false);

            // 格子（填充 + 黑色格线；黑方视角旋转 180°）
            for (let r = 0; r < R.ROWS; r++) {
                for (let c = 0; c < R.rowLen(r); c++) {
                    const dp = displayPos(r, c);
                    const { x, y } = cellCenter(dp.row, dp.col);
                    traceHex(x, y, HEX_OUTER);
                    ctx2d.fillStyle = cellColor(r, c);
                    ctx2d.fill();
                    ctx2d.strokeStyle = '#8a5a3b';
                    ctx2d.lineWidth = 1;
                    ctx2d.stroke();
                }
            }

            // 上一步标记
            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom, ps.lastTo].forEach((p) => {
                    if (!R.isValidCoord(p.row, p.col)) return;
                    const dp = displayPos(p.row, p.col);
                    const { x, y } = cellCenter(dp.row, dp.col);
                    traceHex(x, y, HEX_OUTER);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fill();
                });
            }

            // 将军标记
            if (ps.inCheck) {
                const king = R.findKing(ps.board, ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove);
                if (king) {
                    const dp = displayPos(king.row, king.col);
                    const { x, y } = cellCenter(dp.row, dp.col);
                    traceHex(x, y, HEX_OUTER);
                    ctx2d.fillStyle = 'rgba(200,40,40,0.35)';
                    ctx2d.fill();
                }
            }

            // 合法目标（小方块，参照国际象棋）
            for (const t of ps.legalTargets) {
                const dp = displayPos(t.row, t.col);
                const { x, y } = cellCenter(dp.row, dp.col);
                const occupied = !!ps.board[t.row][t.col];
                if (occupied) {
                    const half = CELL * 0.38;
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = 4;
                    ctx2d.strokeRect(x - half, y - half, half * 2, half * 2);
                } else {
                    const half = CELL * 0.12;
                    ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
                }
            }

            // 棋子
            for (let r = 0; r < R.ROWS; r++) {
                for (let c = 0; c < R.rowLen(r); c++) {
                    const piece = ps.board[r][c];
                    if (!piece) continue;
                    const dp = displayPos(r, c);
                    const { x, y } = cellCenter(dp.row, dp.col);
                    const isWhite = piece[0] === 'w';
                    // 黑棋比白棋略大（与国际象棋一致）
                    const fontSize = CELL * 0.8 * (isWhite ? 1 : 1.05);
                    ctx2d.font = `${fontSize}px "XiangqiPiece", "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    const glyph = R.pieceLabel(piece);
                    if (isWhite) {
                        ctx2d.lineWidth = Math.max(1.5, CELL * 0.035);
                        ctx2d.strokeStyle = '#1a1a1a';
                        ctx2d.fillStyle = '#f7f7f7';
                        ctx2d.strokeText(glyph, x, y + CELL * 0.03);
                        ctx2d.fillText(glyph, x, y + CELL * 0.03);
                    } else {
                        ctx2d.fillStyle = '#1a1a1a';
                        ctx2d.fillText(glyph, x, y + CELL * 0.03);
                    }
                }
            }

            // 选中
            if (ps.selectedRow >= 0 && R.isValidCoord(ps.selectedRow, ps.selectedCol)) {
                const dp = displayPos(ps.selectedRow, ps.selectedCol);
                const { x, y } = cellCenter(dp.row, dp.col);
                traceHex(x, y, HEX_OUTER * 0.86);
                ctx2d.strokeStyle = 'rgba(163,92,39,0.95)';
                ctx2d.lineWidth = 2.5;
                ctx2d.stroke();
            }

            drawCheckBanner();
        }

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
            ctx2d.save();
            ctx2d.font = 'bold 56px "Segoe UI Symbol", "Apple Color Emoji", sans-serif';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.lineJoin = 'round';
            ctx2d.lineWidth = 8;
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.fillStyle = '#c62828';
            ctx2d.strokeText('将军！', LOGICAL_SIZE / 2, LOGICAL_SIZE / 2);
            ctx2d.fillText('将军！', LOGICAL_SIZE / 2, LOGICAL_SIZE / 2);
            ctx2d.restore();
        }

        // 升变选择条
        let promoBar = document.getElementById('scPromoteBar');
        if (!promoBar) {
            promoBar = document.createElement('div');
            promoBar.id = 'scPromoteBar';
            promoBar.style.cssText = 'display:none;position:absolute;z-index:40;gap:6px;padding:6px;background:rgba(40,28,16,0.92);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);';
            const wrap = canvas.parentElement || document.body;
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            wrap.appendChild(promoBar);
            R.PROMOTE_TYPES.forEach((t) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = PROMOTE_LABELS[t];
                btn.dataset.promote = t;
                btn.style.cssText = 'width:48px;height:48px;border:1px solid #555;border-radius:6px;background:#f0e6d2;color:#1a1a1a;font:28px "Segoe UI Symbol", "Apple Color Emoji", sans-serif;cursor:pointer;line-height:1;';
                btn.onclick = () => {
                    if (ps.pendingPawnPromote) {
                        const { row, col } = ps.pendingPawnPromote;
                        ps.pendingPawnPromote = null;
                        hidePromote();
                        if (ps.ws && ps.ws.readyState === 1) {
                            ps.ws.send(JSON.stringify({ type: 'promotePawn', row, col, promote: t }));
                        }
                        return;
                    }
                    if (!ps.pendingPromote) return;
                    const { fromRow, fromCol, toRow, toCol, tryPlay } = ps.pendingPromote;
                    hidePromote();
                    if (tryPlay) tryPlayMove(fromRow, fromCol, toRow, toCol, t);
                    else commitMove(fromRow, fromCol, toRow, toCol, t);
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    drawBoard();
                };
                promoBar.appendChild(btn);
            });
        }
        function showPromote(over) {
            if (!promoBar) return;
            const rect = canvas.getBoundingClientRect();
            const scale = LOGICAL_SIZE / rect.width;
            const dp = displayPos(over.row, over.col);
            const { x, y } = cellCenter(dp.row, dp.col);
            const sx = rect.left + x / scale;
            const sy = rect.top + y / scale;
            promoBar.style.display = 'flex';
            promoBar.style.left = `${sx - 100}px`;
            promoBar.style.top = `${sy + 34}px`;
        }
        function hidePromote() {
            if (promoBar) promoBar.style.display = 'none';
        }

        function updateTurn() {
            if (ps.gameOver) {
                let text = '对局结束';
                if (ps.winner === 'draw') text = '和棋';
                else if (ps.winner === 'black') text = '⚪ 白方胜';
                else if (ps.winner === 'white') text = '⚫ 黑方胜';
                if (ps.recordResultText) text = ps.recordResultText;
                turnDisplay.innerText = text;
            } else if (ps.matchStarted) {
                const emoji = ps.sideToMove === 'white' ? '⚪' : '⚫';
                turnDisplay.innerText = `${emoji} ${ps.sideToMove === 'white' ? '白方' : '黑方'}行棋`;
            } else {
                const seated = (ps.slots && ps.slots.black ? 1 : 0) + (ps.slots && ps.slots.white ? 1 : 0);
                turnDisplay.innerText = ps.mySlot ? `等待对手入座(${seated}/2)` : `等待双方入座(${seated}/2)`;
            }
        }
        function refreshColorStatus() {
            if (!colorStatus) return;
            const mySlot = ps.mySlot;
            if (mySlot === 'black') colorStatus.innerText = '您执白';
            else if (mySlot === 'white') colorStatus.innerText = '您执黑';
            else colorStatus.innerText = '观战';
        }

        function getClosestIntersection(px, py) {
            let best = null;
            let bestD = HEX_INNER;
            for (let r = 0; r < R.ROWS; r++) {
                for (let c = 0; c < R.rowLen(r); c++) {
                    const { x, y } = cellCenter(r, c);
                    const d = Math.hypot(px - x, py - y);
                    if (d < bestD) { bestD = d; best = { row: r, col: c }; }
                }
            }
            return best || { row: -1, col: -1 };
        }

        function sideOf(slot) {
            return slot === 'black' ? 'white' : 'black';
        }
        function slotOfSide(side) {
            return side === 'white' ? 'black' : 'white';
        }

        function isMyTurnNow() {
            return ps.mySlot !== null && ps.matchStarted && !ps.gameOver
                && sideOf(ps.mySlot) === ps.sideToMove && !ps.waitingScoreConfirm;
        }

        function commitMove(fromRow, fromCol, toRow, toCol, promote) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            ps.ws.send(JSON.stringify({ type: 'move', fromRow, fromCol, toRow, toCol, promote: promote || null }));
        }
        function snapshotFrom(board, side, castling, enPassant) {
            return { board: R.copyBoard(board), side, castling: R.copyCastling(castling), enPassant };
        }
        function applySnapshot(snap) {
            ps.board = snap.board;
            ps.castling = snap.castling;
            ps.enPassant = snap.enPassant;
            ps.sideToMove = snap.side;
        }
        function tryPlayMove(fromRow, fromCol, toRow, toCol, promote) {
            if (!ps.tryPlayMode || !ps.replayMode) return;
            const meta = { castling: ps.castling, enPassant: ps.enPassant };
            if (!R.isLegalMove(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide, meta, promote || null)) return;
            const applied = R.applyMoveOnBoard(ps.board, fromRow, fromCol, toRow, toCol, meta, promote || null);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(applied.board, side, applied.castling, applied.enPassant));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = side;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateTryPlayDisplay();
            updateReplayUI();
            drawBoard();
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = LOGICAL_SIZE / rect.width;
            return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
        }

        canvas.addEventListener('click', (e) => {
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const hit = getClosestIntersection(x, y);
            let row = hit.row, col = hit.col;
            if (isBlackView() && row >= 0) {
                row = R.ROWS - 1 - row;
                col = R.rowLen(row) - 1 - col;
            }
            if (row < 0 || col < 0) return;

            if (ps.tryPlayMode && ps.replayMode) {
                const piece = ps.board[row][col];
                if (piece && piece[0] === (ps.tryPlaySide === 'white' ? 'w' : 'b')) {
                    ps.selectedRow = row; ps.selectedCol = col;
                    ps.legalTargets = R.generateLegalMoves(ps.board, ps.tryPlaySide,
                        { castling: ps.castling, enPassant: ps.enPassant })
                        .filter((m) => m.fromRow === row && m.fromCol === col)
                        .map((m) => ({ row: m.toRow, col: m.toCol, needsPromote: !!m.promote }));
                    drawBoard();
                    return;
                }
                const t = ps.legalTargets.find((t2) => t2.row === row && t2.col === col);
                if (t) {
                    if (t.needsPromote) {
                        ps.pendingPromote = { fromRow: ps.selectedRow, fromCol: ps.selectedCol, toRow: row, toCol: col, tryPlay: true };
                        showPromote(t);
                    } else {
                        tryPlayMove(ps.selectedRow, ps.selectedCol, row, col, null);
                        ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    }
                    drawBoard();
                } else {
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    drawBoard();
                }
                return;
            }

            if (ps.gameOver || !isMyTurnNow()) return;

            const piece = ps.board[row][col];
            if (piece && piece[0] === (ps.sideToMove === 'white' ? 'w' : 'b')) {
                ps.selectedRow = row; ps.selectedCol = col;
                ps.legalTargets = R.generateLegalMoves(ps.board, ps.sideToMove,
                    { castling: ps.castling, enPassant: ps.enPassant })
                    .filter((m) => m.fromRow === row && m.fromCol === col)
                    .map((m) => ({ row: m.toRow, col: m.toCol, needsPromote: !!m.promote }));
                drawBoard();
                return;
            }
            const t = ps.legalTargets.find((t2) => t2.row === row && t2.col === col);
            if (t) {
                if (t.needsPromote) {
                    ps.pendingPromote = { fromRow: ps.selectedRow, fromCol: ps.selectedCol, toRow: row, toCol: col, tryPlay: false };
                    showPromote(t);
                } else {
                    commitMove(ps.selectedRow, ps.selectedCol, row, col, null);
                }
                ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }
            ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
            drawBoard();
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const hit = getClosestIntersection(x, y);
                let row = hit.row, col = hit.col;
                if (isBlackView() && row >= 0) {
                    row = R.ROWS - 1 - row;
                    col = R.rowLen(row) - 1 - col;
                }
                ps.hoverRow = row; ps.hoverCol = col;
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                ps.hoverRow = -1; ps.hoverCol = -1;
                drawBoard();
            });
        }

        function syncState(state) {
            if (state.board) ps.board = state.board;
            if (state.castling) ps.castling = R.copyCastling(state.castling);
            if (state.enPassant !== undefined) ps.enPassant = state.enPassant ? { ...state.enPassant } : null;
            if (state.sideToMove) ps.sideToMove = state.sideToMove;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            ps.inCheck = !!state.inCheck;
            ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            ps.lastFrom = state.lastFrom || null;
            ps.lastTo = state.lastTo || null;
            if (state.slots) ps.slots = state.slots;
            ps.halfmoveClock = state.halfmoveClock || 0;
            ps.recordResultText = state.recordResultText || null;
            if (state.moveHistory) ps.moveHistory = state.moveHistory;
            if (state.pendingPromotion) {
                ps.pendingPawnPromote = { row: state.pendingPromotion.row, col: state.pendingPromotion.col };
            } else {
                ps.pendingPawnPromote = null;
            }
            ps.isMyTurn = isMyTurnNow();
            updateTurn();
            refreshColorStatus();
            hidePromote();
            drawBoard();
        }

        function enterReplayMode(data) {
            ps.replayMode = true;
            ps.replayTotalSteps = data.moves ? data.moves.length : 0;
            ps.replayStep = ps.replayTotalSteps;
            ps.replaySnapshots = [];
            let board = R.createInitialBoard();
            const snapshots = [R.copyBoard(board)];
            let castling = R.copyCastling(R.defaultCastling());
            let enPassant = null;
            let side = 'white';
            for (const m of data.moves || []) {
                const meta = { castling, enPassant };
                if (!R.isLegalMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol, side, meta, m.promote || null)) break;
                const applied = R.applyMoveOnBoard(board, m.fromRow, m.fromCol, m.toRow, m.toCol, meta, m.promote || null);
                board = applied.board;
                castling = applied.castling;
                enPassant = applied.enPassant;
                side = R.oppositeSide(side);
                snapshots.push(R.copyBoard(board));
            }
            ps.replaySnapshots = snapshots;
            ps.board = R.copyBoard(snapshots[ps.replayStep] || R.createInitialBoard());
            updateTurn();
            drawBoard();
        }
        function exitReplayMode() {
            ps.replayMode = false;
            ps.replaySnapshots = [];
            ps.replayStep = 0;
            ps.replayTotalSteps = 0;
            drawBoard();
        }
        function setReplayStep(step) {
            ps.replayStep = Math.max(0, Math.min(ps.replayTotalSteps, step));
            if (ps.replaySnapshots[ps.replayStep]) ps.board = R.copyBoard(ps.replaySnapshots[ps.replayStep]);
            drawBoard();
        }
        function updateReplayUI() {
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) {
                tryPlayBtn.innerText = ps.tryPlayMode ? '试下结束' : '试下';
                const isPlayer = !!ps.mySlot;
                const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
                tryPlayBtn.style.display = (isPlayer && matchStarted && !ps.replayMode) ? 'none' : '';
            }
        }
        function setLiveViewStep(step) { ps.liveViewStep = step; }
        function enterTryPlay() {
            // 试下从当前局面出发：保存局面，退出时恢复；tryPlayMove 要求 replayMode
            if (!ps.tryPlayMode) {
                ps._tryPlayBackup = {
                    board: R.copyBoard(ps.board),
                    castling: ps.castling,
                    enPassant: ps.enPassant,
                    side: ps.sideToMove
                };
            }
            ps.tryPlayMode = true;
            ps.tryPlaySide = ps.sideToMove;
            ps.replayMode = true;
            ps.tryPlaySnapshots = [snapshotFrom(ps.board, ps.sideToMove, ps.castling, ps.enPassant)];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            drawBoard();
        }
        function exitTryPlay() {
            ps.tryPlayMode = false;
            ps.replayMode = false;
            ps.tryPlaySide = 'white';
            if (ps._tryPlayBackup) {
                ps.board = ps._tryPlayBackup.board;
                ps.castling = ps._tryPlayBackup.castling;
                ps.enPassant = ps._tryPlayBackup.enPassant;
                ps.sideToMove = ps._tryPlayBackup.side;
                ps._tryPlayBackup = null;
            }
            ps.tryPlaySnapshots = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            drawBoard();
        }
        function setTryPlayStep(step) {
            if (!ps.tryPlayMode) return;
            ps.tryPlayStep = Math.max(0, Math.min(ps.tryPlayTotalSteps, step));
            if (ps.tryPlaySnapshots[ps.tryPlayStep]) applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateTryPlayDisplay();
            drawBoard();
        }
        function updateTryPlayDisplay() {
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (ps.tryPlayMode && stepDisplay) {
                stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
            }
        }
        function rebuildLiveReplayFromMoveCoords(moveCoords, openingBoard) {
            const syncedLen = ps.liveSnapshots.length - 1;
            const mcs = moveCoords || [];
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncremental(mcs)) return;
            }
            ps.liveSnapshots = [];
            let board = R.createInitialBoard();
            ps.liveSnapshots.push(R.copyBoard(board));
            let castling = R.copyCastling(R.defaultCastling());
            let enPassant = null;
            let side = 'white';
            for (const m of moveCoords || []) {
                if (m.type !== 'move') continue;
                const meta = { castling, enPassant };
                if (!R.isLegalMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol, side, meta, m.promote || null)) break;
                const applied = R.applyMoveOnBoard(board, m.fromRow, m.fromCol, m.toRow, m.toCol, meta, m.promote || null);
                board = applied.board;
                castling = applied.castling;
                enPassant = applied.enPassant;
                side = R.oppositeSide(side);
                ps.liveSnapshots.push(R.copyBoard(board));
            }
            ps.liveCastling = castling;
            ps.liveEnPassant = enPassant;
            ps.liveSide = side;
        }

        function applyLiveReplayIncremental(moveCoords) {
            const startLen = ps.liveSnapshots.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            let board = R.copyBoard(ps.liveSnapshots[ps.liveSnapshots.length - 1]);
            let castling = ps.liveCastling != null ? ps.liveCastling : R.copyCastling(R.defaultCastling());
            let enPassant = ps.liveEnPassant != null ? ps.liveEnPassant : null;
            let side = ps.liveSide || 'white';
            for (let i = startLen; i < mcs.length; i++) {
                const m = mcs[i];
                if (m.type !== 'move') continue;
                const meta = { castling, enPassant };
                if (!R.isLegalMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol, side, meta, m.promote || null)) return false;
                const applied = R.applyMoveOnBoard(board, m.fromRow, m.fromCol, m.toRow, m.toCol, meta, m.promote || null);
                board = applied.board;
                castling = applied.castling;
                enPassant = applied.enPassant;
                side = R.oppositeSide(side);
                ps.liveSnapshots.push(R.copyBoard(board));
            }
            ps.liveCastling = castling;
            ps.liveEnPassant = enPassant;
            ps.liveSide = side;
            return true;
        }
        function applyLiveViewBoard() {
            if (ps.liveSnapshots[ps.liveViewStep]) ps.board = R.copyBoard(ps.liveSnapshots[ps.liveViewStep]);
            drawBoard();
        }
        function updateLiveReplayPanelUI() {}
        function clearMobileMovePreview() {}
        function mobileTwoStepPlacing() { return false; }
        function downloadRecord(data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${recordDownloadPrefix}-${roomId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
        function showScoreConfirm() {}
        function hideScoreConfirm() {}
        function showEstimate() {}
        function clearEstimate() {}
        function initBoardArray() { return R.emptyBoard(); }
        function updateBoardGeometry() {}

        // 编辑模式：安装公共编辑 UI（点击放置棋子，关闭编辑时提交服务器）
        let editApi = null;
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'grid2d',
                editTools: config.editTools,
                pickAtClient(clientX, clientY) {
                    const { x, y } = canvasCoordsFromClient(clientX, clientY);
                    const hit = getClosestIntersection(x, y);
                    let row = hit.row, col = hit.col;
                    if (isBlackView() && row >= 0) {
                        row = R.ROWS - 1 - row;
                        col = R.rowLen(row) - 1 - col;
                    }
                    return row >= 0 ? { row, col } : null;
                },
                drawBoard,
                getBoard: () => ps.board,
                setBoard: (b) => { ps.board = b; },
                emptyBoard: () => R.emptyBoard()
            });
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {},
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
            getBoardSize: () => 7,
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
            getWaitingScoreConfirm: () => ps.waitingScoreConfirm,
            setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
            syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate,
            hideScoreConfirm,
            showEstimate,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm,
            isMouseDevice,
            standardWeiqiMatchTime,
            timeControlDefaults: { mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 },
            slotUi: SLOT_UI,
            boardSeatOverlay: true,
            seatOverlayShape: 'hexagon',
            seatOverlayCornerRadius: FRAME_CORNER_RADIUS,
            getSeatOverlayVertices: () => outerFrameVerts()
        });
        const handleMessage = _weiqiBindings.handleMessage;

        connectWebSocket(handleMessage);
        function connectWebSocket(onMessage) {
            ps.ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                onMessage,
                colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (ps.reconnectTimer) { clearTimeout(ps.reconnectTimer); ps.reconnectTimer = null; }
                },
                getReconnectTimer: () => ps.reconnectTimer,
                setReconnectTimer: (id) => { ps.reconnectTimer = id; }
            });
        }
        })();
    }
};
