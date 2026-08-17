window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["rhombic-chess"] = {
    shell: {
        "title": "菱国际象棋",
        "rulesHtml": "基本规则类似国际象棋，采用菱棋盘。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 72,
        "boardSizeMax": 72,
        "defaultBoardSize": 72,
        "minLib": 1,
        "recordDownloadPrefix": "菱国际象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "hideBoardSize": true,
            "transparentCanvas": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "菱国际象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const R = (function () {
    'use strict';
    const A = Math.sqrt(3) / 2, B = 0.5;
    const key = (type, I, J) => type + ',' + I + ',' + J;
    const PIECE_CHAR = {
        wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
        bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
    };
    const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

    function buildBoard() {
        const cells = [];
        const add = (type, I, J, row) => cells.push({ type, I, J, row });
        // 行 1（黑大子）
        add('l', 3, -6, 1); add('r', 3, -6, 1);
        add('l', 5, -6, 1); add('r', 5, -6, 1);
        add('l', 7, -6, 1); add('r', 7, -6, 1);
        // 行 2（黑象）
        add('h', 2, -6, 2); add('h', 4, -6, 2); add('h', 6, -6, 2); add('h', 8, -6, 2);
        // 行 3（黑兵）
        for (let k = 0; k < 4; k++) { add('l', 0 + 2 * k, -3, 3); add('r', 0 + 2 * k, -3, 3); }
        // 行 4
        for (let k = 0; k < 5; k++) add('h', 1 + 2 * k, -3, 4);
        // 行 5
        for (let k = 0; k < 5; k++) { add('l', 1 + 2 * k, 0, 5); add('r', 1 + 2 * k, 0, 5); }
        // 行 6
        for (let k = 0; k < 6; k++) add('h', 2 * k, 0, 6);
        // 行 7（从竖右开始）
        for (let k = 0; k < 5; k++) add('r', 0 + 2 * k, 3, 7);
        for (let k = 0; k < 5; k++) add('l', 2 + 2 * k, 3, 7);
        // 行 8
        for (let k = 0; k < 5; k++) add('h', 1 + 2 * k, 3, 8);
        // 行 9（白兵）
        for (let k = 0; k < 4; k++) add('r', 1 + 2 * k, 6, 9);
        for (let k = 0; k < 4; k++) add('l', 3 + 2 * k, 6, 9);
        // 行 10（白象）
        for (let k = 0; k < 4; k++) add('h', 2 + 2 * k, 6, 10);
        // 行 11（白大子，从竖右开始）
        add('r', 2, 9, 11); add('l', 4, 9, 11);
        add('r', 4, 9, 11); add('l', 6, 9, 11);
        add('r', 6, 9, 11); add('l', 8, 9, 11);
        cells.forEach((c, i) => { c.id = i; });
        return cells;
    }

    const CELLS = buildBoard();
    const CELL_INDEX = {};
    CELLS.forEach((c) => { CELL_INDEX[key(c.type, c.I, c.J)] = c.id; });

    function verts(type, I, J) {
        if (type === 'h') return [[I - 1, J], [I, J - 1], [I + 1, J], [I, J + 1]];
        if (type === 'l') return [[I - 1, J - 3], [I, J - 2], [I, J], [I - 1, J - 1]];
        return [[I + 1, J - 3], [I + 1, J - 1], [I, J], [I, J - 2]];
    }
    const eq = (p, q) => p[0] === q[0] && p[1] === q[1];
    function center(type, I, J) {
        if (type === 'h') return [I * A, J * B];
        if (type === 'l') return [(I - 0.5) * A, (J - 1.5) * B];
        return [(I + 0.5) * A, (J - 1.5) * B];
    }

    // 预计算邻接
    const EDGE_NB = [], PT_NB = [];
    for (let i = 0; i < CELLS.length; i++) {
        const c = CELLS[i];
        EDGE_NB.push([]);
        PT_NB.push([]);
        const v1 = verts(c.type, c.I, c.J);
        const c1 = center(c.type, c.I, c.J);
        for (let j = 0; j < CELLS.length; j++) {
            if (i === j) continue;
            const d = CELLS[j];
            const v2 = verts(d.type, d.I, d.J);
            let shared = false;
            for (let a = 0; a < 4 && !shared; a++) {
                for (let b = 0; b < 4; b++) {
                    if ((eq(v1[a], v2[b]) && eq(v1[(a + 1) % 4], v2[(b + 1) % 4])) ||
                        (eq(v1[a], v2[(b + 1) % 4]) && eq(v1[(a + 1) % 4], v2[b]))) { shared = true; break; }
                }
            }
            if (shared) { EDGE_NB[i].push(j); continue; }
            // pointwise：穿过 60° 角（中心 = 2v - 本格中心）
            const c2 = center(d.type, d.I, d.J);
            let sharp = [];
            if (c.type === 'h') sharp = [[c.I, c.J - 1], [c.I, c.J + 1]];
            else if (c.type === 'l') sharp = [[c.I, c.J - 1], [c.I - 1, c.J - 2]];
            else sharp = [[c.I, c.J - 1], [c.I + 1, c.J - 2]];
            for (const v of sharp) {
                const tv = [2 * v[0] * A - c1[0], 2 * v[1] * B - c1[1]];
                if (Math.abs(tv[0] - c2[0]) < 1e-6 && Math.abs(tv[1] - c2[1]) < 1e-6) {
                    PT_NB[i].push(j);
                    break;
                }
            }
        }
    }

    // 直线移动：从 id 沿邻居方向延伸
    function lineMoves(id, nbTable, blockers, side) {
        const out = [];
        for (const n of nbTable[id]) {
            const c = CELLS[id], d = CELLS[n];
            const c1 = center(c.type, c.I, c.J), c2 = center(d.type, d.I, d.J);
            const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
            let cur = n;
            while (true) {
                const cc = CELLS[cur];
                const b = blockers[cc.id];
                if (b) {
                    if (b !== side) out.push(cur);
                    break;
                }
                out.push(cur);
                const cc1 = center(cc.type, cc.I, cc.J);
                const tx = cc1[0] + dx, ty = cc1[1] + dy;
                let next = -1;
                for (const nn of nbTable[cur]) {
                    const n2 = center(CELLS[nn].type, CELLS[nn].I, CELLS[nn].J);
                    if (Math.abs(n2[0] - tx) < 1e-6 && Math.abs(n2[1] - ty) < 1e-6) { next = nn; break; }
                }
                if (next === -1) break;
                cur = next;
            }
        }
        return out;
    }

    function setup() {
        const board = {};
        const whiteRow11 = ['r,2,9', 'l,4,9', 'r,4,9', 'l,6,9', 'r,6,9', 'l,8,9'];
        const whitePieces = ['wr', 'wn', 'wq', 'wk', 'wn', 'wr'];
        for (let k = 0; k < 6; k++) board[whiteRow11[k]] = whitePieces[k];
        board['h,4,6'] = 'wb'; board['h,6,6'] = 'wb';
        const whitePawns = ['r,1,6', 'l,3,6', 'r,3,6', 'l,5,6', 'r,5,6', 'l,7,6', 'r,7,6', 'l,9,6'];
        for (const k of whitePawns) board[k] = 'wp';
        const blackRow1 = ['l,3,-6', 'r,3,-6', 'l,5,-6', 'r,5,-6', 'l,7,-6', 'r,7,-6'];
        const blackPieces = ['br', 'bn', 'bq', 'bk', 'bn', 'br'];
        for (let k = 0; k < 6; k++) board[blackRow1[k]] = blackPieces[k];
        board['h,4,-6'] = 'bb'; board['h,6,-6'] = 'bb';
        const blackPawns = ['l,0,-3', 'r,0,-3', 'l,2,-3', 'r,2,-3', 'l,4,-3', 'r,4,-3', 'l,6,-3', 'r,6,-3'];
        for (const k of blackPawns) board[k] = 'bp';
        return board;
    }

    function pieceSide(pc) { return pc[0] === 'w' ? 'white' : 'black'; }
    function oppositeSide(side) { return side === 'white' ? 'black' : 'white'; }
    function sideFromSlot(slot) { return slot === 'black' ? 'white' : 'black'; }
    function slotFromSide(side) { return side === 'white' ? 'black' : 'white'; }
    function normalizePromote(p) {
        p = String(p || '').toLowerCase();
        if (PROMOTE_TYPES.includes(p)) return p;
        return 'q';
    }
    function cellKeyOfId(id) { const c = CELLS[id]; return key(c.type, c.I, c.J); }

    // 生成一步的所有合法目标
    function pseudoMoves(board, id, side) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const blockers = {};
        for (const kk in board) blockers[CELL_INDEX[kk]] = pieceSide(board[kk]);
        const out = [];
        const add = (t) => { if (!out.includes(t)) out.push(t); };
        const type = pc[1];
        if (type === 'r' || type === 'q') {
            for (const t of lineMoves(id, EDGE_NB, blockers, side)) add(t);
        }
        if (type === 'b' || type === 'q') {
            for (const t of lineMoves(id, PT_NB, blockers, side)) add(t);
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'k') {
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
            for (const n of PT_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'n') {
            for (const e of EDGE_NB[id]) {
                for (const p of PT_NB[e]) { const b = blockers[p]; if (!b || b !== side) add(p); }
            }
            for (const p of PT_NB[id]) {
                for (const e of EDGE_NB[p]) { const b = blockers[e]; if (!b || b !== side) add(e); }
            }
        }
        if (type === 'p') {
            const fwd = side === 'white' ? -1 : 1;
            const c1 = center(CELLS[id].type, CELLS[id].I, CELLS[id].J);
            const fwdNbs = EDGE_NB[id].filter(n => {
                const n2 = center(CELLS[n].type, CELLS[n].I, CELLS[n].J);
                return fwd * (n2[1] - c1[1]) > 0;
            });
            for (const n of fwdNbs) {
                if (blockers[n] === undefined) {
                    add(n);
                    // 首步 2 步
                    if (!board[k].hasMoved) {
                        const cc = CELLS[n];
                        const cc1 = center(cc.type, cc.I, cc.J);
                        const dx = cc1[0] - c1[0], dy = cc1[1] - c1[1];
                        const tx = cc1[0] + dx, ty = cc1[1] + dy;
                        for (const nn of EDGE_NB[n]) {
                            const n3 = center(CELLS[nn].type, CELLS[nn].I, CELLS[nn].J);
                            if (Math.abs(n3[0] - tx) < 1e-6 && Math.abs(n3[1] - ty) < 1e-6 && blockers[nn] === undefined) add(nn);
                        }
                    }
                }
            }
            // 直走直吃（同移动，无斜吃）——上面已含
        }
        return out;
    }

    function findKing(board, side) {
        for (const k in board) {
            if (board[k] === (side === 'white' ? 'wk' : 'bk')) return CELL_INDEX[k];
        }
        return -1;
    }

    function isAttacked(board, id, bySide) {
        for (const k in board) {
            const pc = board[k];
            if (pieceSide(pc) !== bySide) continue;
            const from = CELL_INDEX[k];
            if (pseudoMoves(board, from, bySide).includes(id)) return true;
        }
        return false;
    }

    // 应用一步，返回被吃子
    function applyMove(board, move) {
        const fromK = cellKeyOfId(move.from);
        const toK = cellKeyOfId(move.to);
        const pc = board[fromK];
        const captured = board[toK];
        delete board[fromK];
        board[toK] = { ...pc, hasMoved: true };
        if (move.promote) board[toK] = board[toK][0] + move.promote;
        return captured;
    }

    function legalMovesFor(board, id, side) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const promoRow = side === 'white' ? 3 : 9;
        const raw = pseudoMoves(board, id, side);
        const legal = [];
        for (const t of raw) {
            const move = { from: id, to: t };
            const captured = applyMove(board, move);
            let promote = false;
            if (pc[1] === 'p' && CELLS[t].row === promoRow) {
                promote = true;
                move.promote = 'q';
            }
            let ok = true;
            const kingId = findKing(board, side);
            if (kingId !== -1 && isAttacked(board, kingId, oppositeSide(side))) ok = false;
            // 还原
            const toK = cellKeyOfId(t);
            const fromK = k;
            delete board[toK];
            board[fromK] = pc;
            if (captured !== undefined) board[toK] = captured;
            if (ok) legal.push({ to: t, promote });
        }
        return legal;
    }

    function allLegalMoves(board, side) {
        const out = [];
        for (const k in board) {
            if (pieceSide(board[k]) !== side) continue;
            const id = CELL_INDEX[k];
            for (const m of legalMovesFor(board, id, side)) {
                out.push({ from: id, to: m.to, promote: m.promote || null });
            }
        }
        return out;
    }

    function isInCheck(board, side) {
        const kingId = findKing(board, side);
        if (kingId === -1) return false;
        return isAttacked(board, kingId, oppositeSide(side));
    }

    function hasLegalMove(board, side) {
        return allLegalMoves(board, side).length > 0;
    }

    return {
        CELLS, CELL_INDEX, EDGE_NB, PT_NB, key, center, verts,
        PIECE_CHAR, PROMOTE_TYPES, normalizePromote,
        setup, pseudoMoves, legalMovesFor, allLegalMoves, applyMove,
        findKing, isAttacked, isInCheck, hasLegalMove,
        pieceSide, oppositeSide, sideFromSlot, slotFromSide,
        cellKeyOfId,
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
        // 菱形棋盘几何：实体单位 (A, B)，画布缩放
        const A = Math.sqrt(3) / 2, B = 0.5;
        const SCALE = 46;
        // 棋盘实体范围 x ≈ -0.9..8.7、y ≈ -4.5..4.5 → 宽 9.6、高 9
        const BOARD_W = 10.6, BOARD_H = 10.2;
        const OX = (LOGICAL_SIZE - BOARD_W * SCALE) / 2 + 0.9 * SCALE;
        const OY = (LOGICAL_SIZE - BOARD_H * SCALE) / 2 + 4.5 * SCALE;
        const FRAME_CORNER_RADIUS = 12;

        function toPx(x, y) {
            return { x: OX + x * SCALE, y: OY + y * SCALE };
        }
        // 格中心实体坐标
        function cellCenter(id) {
            const c = R.CELLS[id];
            const p = R.center(c.type, c.I, c.J);
            return toPx(p[0], p[1]);
        }
        // 格多边形顶点（实体 → px）
        function cellVerts(id) {
            const c = R.CELLS[id];
            return R.verts(c.type, c.I, c.J).map((v) => toPx(v[0] * A, v[1] * B));
        }

        // 棋盘外轮廓（1 次边环）
        function buildOutline() {
            const edgeUse = new Map();
            const edgeOf = (id, a, b) => {
                const p = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
                return p[0][0] + ',' + p[0][1] + '-' + p[1][0] + ',' + p[1][1];
            };
            for (const c of R.CELLS) {
                const v = R.verts(c.type, c.I, c.J);
                for (let i = 0; i < 4; i++) {
                    const k = edgeOf(c.id, v[i], v[(i + 1) % 4]);
                    const list = edgeUse.get(k) || [];
                    list.push(c.id);
                    edgeUse.set(k, list);
                }
            }
            const one = [];
            for (const [k, list] of edgeUse) if (list.length === 1) one.push(k);
            // 连接成环
            const pts = one.map((k) => k.split('-').map((p) => p.split(',').map(Number)));
            const used = new Set();
            const ring = [];
            let cur = pts[0];
            used.add(0);
            ring.push(cur[0]);
            while (ring.length < pts.length + 1) {
                const tail = ring[ring.length - 1];
                let found = -1;
                for (let i = 0; i < pts.length; i++) {
                    if (used.has(i)) continue;
                    if (pts[i][0][0] === tail[0] && pts[i][0][1] === tail[1]) { found = i; break; }
                    if (pts[i][1][0] === tail[0] && pts[i][1][1] === tail[1]) { pts[i] = [pts[i][1], pts[i][0]]; found = i; break; }
                }
                if (found === -1) break;
                used.add(found);
                ring.push(pts[found][1]);
            }
            return ring.map((p) => toPx(p[0] * A, p[1] * B));
        }
        const OUTLINE = buildOutline();

        // 黑方视角：棋盘旋转 180°（黑方坐在对面）
        let rotated = false;
        const ROT_ID = (() => {
            const map = [];
            const cx = 5 * A, cy = 0; // 棋盘中心（行 6 横带中点）
            for (let i = 0; i < R.CELLS.length; i++) {
                const c = R.CELLS[i];
                const p = R.center(c.type, c.I, c.J);
                const tx = 2 * cx - p[0], ty = 2 * cy - p[1];
                let found = -1;
                for (let j = 0; j < R.CELLS.length; j++) {
                    const q = R.center(R.CELLS[j].type, R.CELLS[j].I, R.CELLS[j].J);
                    if (Math.abs(q[0] - tx) < 1e-6 && Math.abs(q[1] - ty) < 1e-6) { found = j; break; }
                }
                map.push(found);
            }
            return map;
        })();
        function displayId(id) {
            if (!rotated || id < 0) return id;
            return ROT_ID[id];
        }

        function tracePoly(verts) {
            ctx2d.beginPath();
            verts.forEach((p, i) => {
                if (i === 0) ctx2d.moveTo(p.x, p.y);
                else ctx2d.lineTo(p.x, p.y);
            });
            ctx2d.closePath();
        }
        function drawRoundedPolygon(vertices, radius) {
            if (vertices.length < 3) return;
            const startPoints = [];
            const endPoints = [];
            for (let i = 0; i < vertices.length; i++) {
                const curr = vertices[i];
                const prev = vertices[(i - 1 + vertices.length) % vertices.length];
                const next = vertices[(i + 1) % vertices.length];
                const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.hypot(v1.x, v1.y);
                const len2 = Math.hypot(v2.x, v2.y);
                startPoints.push({ x: curr.x + (v1.x / len1) * radius, y: curr.y + (v1.y / len1) * radius });
                endPoints.push({ x: curr.x + (v2.x / len2) * radius, y: curr.y + (v2.y / len2) * radius });
            }
            ctx2d.beginPath();
            ctx2d.moveTo(startPoints[0].x, startPoints[0].y);
            for (let i = 0; i < vertices.length; i++) {
                ctx2d.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                if (i < vertices.length - 1) ctx2d.lineTo(startPoints[i + 1].x, startPoints[i + 1].y);
            }
            ctx2d.lineTo(startPoints[0].x, startPoints[0].y);
            ctx2d.closePath();
            ctx2d.fill();
            ctx2d.stroke();
        }

        // 三色菱形：横=中、竖左=深、竖右=浅
        const CELL_COLORS = { h: '#d6b58c', l: '#b58863', r: '#f0d9b5' };

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

        const ps = {
            board: R.setup(),
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
            matchStarted: false,
            matchTime: null,
            selectedId: -1,
            legalTargets: [],
            hoverId: -1,
            inCheck: false,
            moveHistory: [],
            pendingPromote: null,
            recordResultText: null,
            waitingScoreConfirm: false,
            showEstimateActive: false
        };

        function pieceAt(id) {
            const c = R.CELLS[id];
            return ps.board[R.key(c.type, c.I, c.J)] || '';
        }
        function pieceLabel(piece) {
            return R.PIECE_CHAR[piece] || piece;
        }
        function sideOf(slot) { return slot === 'black' ? 'white' : 'black'; }
        function slotOfSide(side) { return side === 'white' ? 'black' : 'white'; }
        function isMyTurnNow() {
            return ps.mySlot !== null && ps.matchStarted && !ps.gameOver
                && sideOf(ps.mySlot) === ps.sideToMove && !ps.waitingScoreConfirm;
        }

        function drawBoard() {
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
            // 木质外框（锯齿六角形轮廓）
            ctx2d.shadowBlur = 0;
            ctx2d.shadowOffsetY = 0;
            ctx2d.fillStyle = '#fdcc90';
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 1.5;
            drawRoundedPolygon(OUTLINE, FRAME_CORNER_RADIUS);

            // 格子
            for (let id = 0; id < R.CELLS.length; id++) {
                const did = displayId(id);
                const verts = cellVerts(did);
                tracePoly(verts);
                ctx2d.fillStyle = CELL_COLORS[R.CELLS[did].type];
                ctx2d.fill();
                ctx2d.strokeStyle = 'rgba(58,40,28,0.55)';
                ctx2d.lineWidth = 1;
                ctx2d.stroke();
            }

            // 上一步标记
            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom.row, ps.lastTo.row].forEach((id) => {
                    if (id < 0 || id >= 72) return;
                    tracePoly(cellVerts(displayId(id)));
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fill();
                });
            }

            // 将军标记
            if (ps.inCheck) {
                const kingId = R.findKing(ps.board, ps.sideToMove);
                if (kingId >= 0) {
                    tracePoly(cellVerts(displayId(kingId)));
                    ctx2d.fillStyle = 'rgba(200,40,40,0.35)';
                    ctx2d.fill();
                }
            }

            // 合法目标
            for (const t of ps.legalTargets) {
                const did = displayId(t);
                const c = cellCenter(did);
                if (pieceAt(t)) {
                    tracePoly(cellVerts(did));
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.95)';
                    ctx2d.lineWidth = 4;
                    ctx2d.stroke();
                } else {
                    ctx2d.beginPath();
                    ctx2d.arc(c.x, c.y, SCALE * 0.16, 0, 2 * Math.PI);
                    ctx2d.fillStyle = 'rgba(163,92,39,0.95)';
                    ctx2d.fill();
                }
            }

            // 棋子
            for (const k in ps.board) {
                const id = R.CELL_INDEX[k];
                const did = displayId(id);
                const { x, y } = cellCenter(did);
                const piece = ps.board[k];
                const isWhite = piece[0] === 'w';
                const fontSize = SCALE * 1.05;
                ctx2d.font = `${fontSize}px "XiangqiPiece", "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';
                const glyph = pieceLabel(piece);
                if (isWhite) {
                    ctx2d.lineWidth = Math.max(1.5, SCALE * 0.05);
                    ctx2d.strokeStyle = '#1a1a1a';
                    ctx2d.fillStyle = '#f7f7f7';
                    ctx2d.strokeText(glyph, x, y + SCALE * 0.04);
                    ctx2d.fillText(glyph, x, y + SCALE * 0.04);
                } else {
                    ctx2d.fillStyle = '#1a1a1a';
                    ctx2d.fillText(glyph, x, y + SCALE * 0.04);
                }
            }

            // 选中
            if (ps.selectedId >= 0) {
                tracePoly(cellVerts(displayId(ps.selectedId)));
                ctx2d.strokeStyle = 'rgba(163,92,39,0.95)';
                ctx2d.lineWidth = 2.5;
                ctx2d.stroke();
            }
        }

        function getClosestCell(px, py) {
            let best = -1;
            let bestD = SCALE * 1.2;
            for (let id = 0; id < R.CELLS.length; id++) {
                const { x, y } = cellCenter(id);
                const d = Math.hypot(px - x, py - y);
                if (d < bestD) { bestD = d; best = id; }
            }
            return best;
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = LOGICAL_SIZE / rect.width;
            return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
        }

        canvas.addEventListener('click', (e) => {
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const id = getClosestCell(x, y);
            if (id < 0) return;

            if (ps.gameOver || !isMyTurnNow()) {
                ps.selectedId = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }

            const piece = pieceAt(id);
            if (piece && piece[0] === (ps.sideToMove === 'white' ? 'w' : 'b')) {
                ps.selectedId = id;
                ps.legalTargets = R.allLegalMoves(ps.board, ps.sideToMove)
                    .filter((m) => m.from === id)
                    .map((m) => ({ to: m.to, needsPromote: !!m.promote }));
                drawBoard();
                return;
            }
            const t = ps.legalTargets.find((t2) => t2.to === id);
            if (t) {
                if (t.needsPromote) {
                    ps.pendingPromote = { from: ps.selectedId, to: id };
                    showPromote(id);
                } else {
                    commitMove(ps.selectedId, id, null);
                }
                ps.selectedId = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }
            ps.selectedId = -1; ps.legalTargets = [];
            drawBoard();
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                ps.hoverId = getClosestCell(x, y);
            });
        }

        function commitMove(fromId, toId, promote) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            ps.ws.send(JSON.stringify({ type: 'move', fromRow: fromId, fromCol: 0, toRow: toId, toCol: 0, promote: promote || null }));
        }

        let promoBar = document.getElementById('scPromoteBar');
        if (!promoBar) {
            promoBar = document.createElement('div');
            promoBar.id = 'scPromoteBar';
            promoBar.style.cssText = 'display:none;position:absolute;z-index:40;gap:6px;padding:6px;background:rgba(40,28,16,0.92);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);';
            const wrap = document.getElementById('boardWrap') || canvas.parentElement;
            if (wrap) wrap.appendChild(promoBar);
        }
        ['q', 'r', 'n', 'b'].forEach((t) => {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:44px;height:44px;font-size:26px;line-height:1;color:#f7f7f7;background:#5a3d1e;border:1px solid #8a6a3f;border-radius:6px;cursor:pointer;';
            btn.innerText = PROMOTE_LABELS[t];
            btn.onclick = () => {
                if (ps.pendingPromote) {
                    const { from, to } = ps.pendingPromote;
                    ps.pendingPromote = null;
                    hidePromote();
                    commitMove(from, to, t);
                    ps.selectedId = -1; ps.legalTargets = [];
                    drawBoard();
                }
            };
            promoBar.appendChild(btn);
        });
        function showPromote(id) {
            if (!promoBar) return;
            const rect = canvas.getBoundingClientRect();
            const scale = LOGICAL_SIZE / rect.width;
            const { x, y } = cellCenter(displayId(id));
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

        function syncState(state) {
            if (state.board) ps.board = state.board;
            if (state.sideToMove) ps.sideToMove = state.sideToMove;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            ps.inCheck = !!state.inCheck;
            ps.matchStarted = !!state.matchStarted;
            ps.recordResultText = state.recordResultText || null;
            ps.lastFrom = state.lastFrom || null;
            ps.lastTo = state.lastTo || null;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.slots) ps.slots = state.slots;
            if (state.pendingPromotion) {
                ps.pendingPromote = { from: state.pendingPromotion.row, to: state.pendingPromotion.row };
            } else if (state.pendingPromotion === null) {
                ps.pendingPromote = null;
            }
            updateTurn();
            refreshColorStatus();
            drawBoard();
        }

        function updateBoardGeometry() {}
        function initBoardArray() { return R.setup(); }
        function exitReplayMode() {}
        function clearEstimate() {}
        function hideScoreConfirm() {}
        function showEstimate() {}
        function clearMobileMovePreview() {}
        function downloadRecord() {
            if (ps.ws && ps.ws.readyState === 1) {
                ps.ws.send(JSON.stringify({ type: 'exportRecord' }));
            }
        }
        function enterReplayMode() {}
        function updateReplayUI() {}
        function showScoreConfirm() {}

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            pageState: ps,
            getWs: () => ps.ws,
            getBoardSize: () => 72,
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
            getReplayMode: () => false,
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
            slotUi: SLOT_UI,
            boardSeatOverlay: true,
            seatOverlayShape: 'polygon',
            seatOverlayCornerRadius: FRAME_CORNER_RADIUS,
            getSeatOverlayVertices: () => OUTLINE
        });
        const handleMessage = _weiqiBindings.handleMessage;

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
        connectWebSocket(handleMessage);
        })();
    }
};
