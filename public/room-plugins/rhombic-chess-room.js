window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["rhombic-chess"] = {
    shell: {
        "title": "菱国际象棋",
        "rulesHtml": "基本规则类似国际象棋，采用菱棋盘。<br /><br /><strong>♔/♚</strong>：直走或斜走一格，不可易位。<br /><strong>♖/♜</strong>：直走任意格，路径上不能有其它棋子。<br /><strong>♘/♞</strong>：直走一格后斜走一格，路径上可以有棋子。<br /><strong>♗/♝</strong>：直走一格，或斜走任意格，路径上不能有其它棋子。<br /><strong>♕/♛</strong>：直走或斜走任意格，路径上不能有其它棋子。<br /><strong>♙/♟</strong>：直走一格或斜吃一格，走到底线2行时升变。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 72,
        "boardSizeMax": 72,
        "defaultBoardSize": 72,
        "minLib": 1,
        "recordDownloadPrefix": "菱国际象棋",
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
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const R = (function () {
    'use strict';
    const A = Math.sqrt(3) / 2, B = 0.5;
    const key = (row, col) => row + ',' + col;
    const PIECE_CHAR = {
        wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
        bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
    };
    const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

    // 每行格数（row 0-10）
    const ROW_COUNT = [6, 4, 8, 5, 10, 6, 10, 5, 8, 4, 6];

    function buildBoard() {
        const cells = [];
        for (let row = 0; row < 11; row++) {
            const n = ROW_COUNT[row];
            if (row % 2 === 1) {
                for (let col = 0; col < n; col++) cells.push({ type: 'h', row, col });
            } else {
                const isTop = row < 5;
                for (let col = 0; col < n; col++) {
                    cells.push({ type: (col % 2 === 0) === isTop ? 'l' : 'r', row, col });
                }
            }
        }
        return cells;
    }

    const CELLS = buildBoard();
    const CELL_INDEX = {};
    CELLS.forEach((c, i) => { CELL_INDEX[key(c.row, c.col)] = i; });
    function cellIdOf(row, col) {
        const id = CELL_INDEX[key(row, col)];
        return id === undefined ? -1 : id;
    }
    function cellKeyOfId(id) { const c = CELLS[id]; return key(c.row, c.col); }

    // 半对角向量（实体单位）：长对角线（长边方向）与短对角线
    const HALF = {
        h: { long: [A, 0], short: [0, B] },
        l: { long: [0.5 * A, 0.75], short: [-0.5 * A, 0.25] },
        r: { long: [-0.5 * A, 0.75], short: [-0.5 * A, -0.25] }
    };
    function centerOf(cell) {
        const off = Math.abs(cell.row - 5) / 2;
        const x = cell.type === 'h' ? (2 * cell.col + off) * A : (cell.col + off) * A;
        return [x, (cell.row - 5) * 0.75];
    }
    function vertsOf(cell) {
        const [x, y] = centerOf(cell);
        const u = HALF[cell.type].long, v = HALF[cell.type].short;
        return [
            [x + u[0], y + u[1]],
            [x + v[0], y + v[1]],
            [x - u[0], y - u[1]],
            [x - v[0], y - v[1]]
        ];
    }
    const eq = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;

    // 预计算邻接：共享边 = edgewise；长边方向 = 斜走
    const EDGE_NB = [], DIAG_NB = [];
    for (let i = 0; i < CELLS.length; i++) {
        const c = CELLS[i];
        EDGE_NB.push([]);
        // 斜走邻居：中心沿长对角线方向 ±2×长半向量
        const diagList = [];
        const u = HALF[c.type].long;
        const [cx, cy] = centerOf(c);
        for (const s of [1, -1]) {
            const tx = cx + 2 * u[0] * s, ty = cy + 2 * u[1] * s;
            for (let j = 0; j < CELLS.length; j++) {
                if (j === i) continue;
                const p = centerOf(CELLS[j]);
                if (Math.abs(p[0] - tx) < 1e-6 && Math.abs(p[1] - ty) < 1e-6) { diagList.push(j); break; }
            }
        }
        DIAG_NB.push(diagList);
        const v1 = vertsOf(c);
        for (let j = 0; j < CELLS.length; j++) {
            if (i === j) continue;
            const v2 = vertsOf(CELLS[j]);
            let shared = false;
            for (let a = 0; a < 4 && !shared; a++) {
                for (let b = 0; b < 4; b++) {
                    if ((eq(v1[a], v2[b]) && eq(v1[(a + 1) % 4], v2[(b + 1) % 4])) ||
                        (eq(v1[a], v2[(b + 1) % 4]) && eq(v1[(a + 1) % 4], v2[b]))) { shared = true; break; }
                }
            }
            if (shared) { EDGE_NB[i].push(j); continue; }
        }
    }

    // 直线移动：从 id 沿邻居方向延伸
    function lineMoves(id, nbTable, blockers, side) {
        const out = [];
        for (const n of nbTable[id]) {
            const c = CELLS[id], d = CELLS[n];
            const c1 = centerOf(c), c2 = centerOf(d);
            const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
            let cur = n;
            while (true) {
                const b = blockers[cur];
                if (b) {
                    if (b !== side) out.push(cur);
                    break;
                }
                out.push(cur);
                const cc1 = centerOf(CELLS[cur]);
                const tx = cc1[0] + dx, ty = cc1[1] + dy;
                let next = -1;
                for (const nn of nbTable[cur]) {
                    const n2 = centerOf(CELLS[nn]);
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
        // 白方（底部）
        const whiteRow = ['wr', 'wn', 'wq', 'wk', 'wn', 'wr'];
        for (let c = 0; c < 6; c++) board[key(10, c)] = whiteRow[c];
        board[key(9, 1)] = 'wb'; board[key(9, 2)] = 'wb';
        for (let c = 0; c < 8; c++) board[key(8, c)] = 'wp';
        // 黑方（顶部）
        const blackRow = ['br', 'bn', 'bq', 'bk', 'bn', 'br'];
        for (let c = 0; c < 6; c++) board[key(0, c)] = blackRow[c];
        board[key(1, 1)] = 'bb'; board[key(1, 2)] = 'bb';
        for (let c = 0; c < 8; c++) board[key(2, c)] = 'bp';
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

    // 生成一步的所有合法目标
    function pseudoMoves(board, id, side, ep) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const blockers = {};
        for (const kk in board) {
            if (board[kk] === '' || board[kk] == null) continue;
            blockers[CELL_INDEX[kk]] = pieceSide(board[kk]);
        }
        const out = [];
        const add = (t) => { if (!out.includes(t)) out.push(t); };
        const type = pc[1];
        if (type === 'r' || type === 'q') {
            for (const t of lineMoves(id, EDGE_NB, blockers, side)) add(t);
        }
        if (type === 'b' || type === 'q') {
            for (const t of lineMoves(id, DIAG_NB, blockers, side)) add(t);
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'k') {
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
            for (const n of DIAG_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'n') {
            // 马：先走一个邻格，再走一个斜格（跳过中间格）
            for (const e of EDGE_NB[id]) {
                for (const d of DIAG_NB[e]) { const b = blockers[d]; if (!b || b !== side) add(d); }
            }
        }
        if (type === 'p') {
            const fwd = side === 'white' ? -1 : 1;
            const c1 = centerOf(CELLS[id]);
            const fwdNbs = EDGE_NB[id].filter(n => {
                const n2 = centerOf(CELLS[n]);
                return fwd * (n2[1] - c1[1]) > 0;
            });
            for (const n of fwdNbs) {
                if (blockers[n] === undefined) {
                    add(n);
                    // 首步 2 步：第一步向前一格后，第二步可选左前方或右前方（任一前方向）
                    if (!board[k].hasMoved) {
                        const cc1 = centerOf(CELLS[n]);
                        for (const nn of EDGE_NB[n]) {
                            const n3 = centerOf(CELLS[nn]);
                            if (fwd * (n3[1] - cc1[1]) > 0 && blockers[nn] === undefined) add(nn);
                        }
                    }
                }
            }
            // 斜吃：前方斜一格（长边方向前方）有敌子
            for (const d of DIAG_NB[id]) {
                const d2 = centerOf(CELLS[d]);
                if (fwd * (d2[1] - c1[1]) > 0 && blockers[d] && blockers[d] !== side) add(d);
            }
            // 吃过路兵：敌方兵双步后，可斜吃其经过格
            if (ep && ep.passedId != null && ep.passedId !== id && DIAG_NB[id].includes(ep.passedId)) {
                const d2 = centerOf(CELLS[ep.passedId]);
                if (fwd * (d2[1] - c1[1]) > 0) add(ep.passedId);
            }
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
    function applyMove(board, move, ep) {
        const fromK = cellKeyOfId(move.from);
        const toK = cellKeyOfId(move.to);
        const pc = board[fromK];
        const captured = board[toK];
        delete board[fromK];
        board[toK] = { ...pc, hasMoved: true };
        if (move.promote) board[toK] = board[toK][0] + move.promote;
        // 吃过路兵：吃掉跳越的敌方兵
        if (ep && move.to === ep.passedId && ep.pawnKey) delete board[ep.pawnKey];
        return captured;
    }

    function legalMovesFor(board, id, side, ep) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const promoRow = side === 'white' ? 1 : 9;
        const fwd = side === 'white' ? -1 : 1;
        const raw = pseudoMoves(board, id, side, ep);
        const legal = [];
        for (const t of raw) {
            const move = { from: id, to: t };
            const captured = applyMove(board, move, ep);
            let promote = false;
            if (pc[1] === 'p' && CELLS[t].row === promoRow) {
                promote = true;
                move.promote = 'q';
            }
            // 兵双步标记（记录经过格，供吃过路兵）：两步都向前（可折线）
            if (pc[1] === 'p' && !pc.hasMoved) {
                const c1 = centerOf(CELLS[id]);
                const ct = centerOf(CELLS[t]);
                for (const n of EDGE_NB[id]) {
                    if (!EDGE_NB[t].includes(n)) continue;
                    const cn = centerOf(CELLS[n]);
                    if (fwd * (cn[1] - c1[1]) > 0 && fwd * (ct[1] - cn[1]) > 0) {
                        move.doubleStep = { passed: n };
                        break;
                    }
                }
            }
            let ok = true;
            const kingId = findKing(board, side);
            if (kingId !== -1 && isAttacked(board, kingId, oppositeSide(side))) ok = false;
            // 还原（含吃过路兵删掉的兵）
            const toK = cellKeyOfId(t);
            const fromK = k;
            delete board[toK];
            board[fromK] = pc;
            if (captured !== undefined) board[toK] = captured;
            if (ep && move.to === ep.passedId && ep.pawnKey && !board[ep.pawnKey]) {
                board[ep.pawnKey] = (side === 'white' ? 'b' : 'w') + 'p';
            }
            if (ok) legal.push({ to: t, promote, doubleStep: move.doubleStep || null, enPassant: !!(ep && move.to === ep.passedId) });
        }
        return legal;
    }

    function allLegalMoves(board, side, ep) {
        const out = [];
        for (const k in board) {
            if (pieceSide(board[k]) !== side) continue;
            const id = CELL_INDEX[k];
            for (const m of legalMovesFor(board, id, side, ep)) {
                out.push({ from: id, to: m.to, promote: m.promote || null, doubleStep: m.doubleStep || null, enPassant: m.enPassant });
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
        CELLS, CELL_INDEX, EDGE_NB, DIAG_NB, key, cellIdOf, cellKeyOfId,
        centerOf, vertsOf, PIECE_CHAR, PROMOTE_TYPES, normalizePromote,
        setup, pseudoMoves, legalMovesFor, allLegalMoves, applyMove,
        findKing, isAttacked, isInCheck, hasLegalMove,
        pieceSide, oppositeSide, sideFromSlot, slotFromSide,
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
        const A = Math.sqrt(3) / 2, B = 0.5;

        // 棋盘几何：由格子中心范围推导，正六角形外框（尖顶朝上下）恰好罩住全盘
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const c of R.CELLS) {
            const p = R.centerOf(c);
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        }
        minX -= 0.6; maxX += 0.6; minY -= 0.6; maxY += 0.6;
        const BOARD_CX = (minX + maxX) / 2, BOARD_CY = (minY + maxY) / 2;
        // 正六角形外框尖角朝左右：水平半宽 = R、垂直半高 = 0.866R
        const FRAME_R = Math.max(maxX - BOARD_CX, (maxY - BOARD_CY) / 0.866) * 1.04;
        const SCALE = LOGICAL_SIZE / 2 / FRAME_R * 0.98;
        const OX = LOGICAL_SIZE / 2 - BOARD_CX * SCALE;
        const OY = LOGICAL_SIZE / 2 - BOARD_CY * SCALE;
        const FRAME_CORNER_RADIUS = 12;

        // 格线整体缩小 GRID_SCALE（外框不变），与六角形外框之间留出木边
        const GRID_SCALE = 0.95;
        function toPx(x, y) {
            return {
                x: OX + BOARD_CX * SCALE + (x - BOARD_CX) * SCALE * GRID_SCALE,
                y: OY + BOARD_CY * SCALE + (y - BOARD_CY) * SCALE * GRID_SCALE
            };
        }
        function cellCenter(id) {
            const c = R.CELLS[id];
            if (!c) return { x: 0, y: 0 };
            const p = R.centerOf(c);
            return toPx(p[0], p[1]);
        }
        function cellVerts(id) {
            const c = R.CELLS[id];
            return R.vertsOf(c).map((v) => toPx(v[0], v[1]));
        }

        // 黑方视角：棋盘旋转 180°（黑方坐在对面，看到的是倒置的棋盘）
        function isBlackView() {
            return ps && ps.mySlot === 'white';
        }
        const ROT_ID = (() => {
            const map = [];
            for (let i = 0; i < R.CELLS.length; i++) {
                const p = R.centerOf(R.CELLS[i]);
                const tx = 2 * BOARD_CX - p[0], ty = 2 * BOARD_CY - p[1];
                let found = -1;
                for (let j = 0; j < R.CELLS.length; j++) {
                    const q = R.centerOf(R.CELLS[j]);
                    if (Math.abs(q[0] - tx) < 1e-6 && Math.abs(q[1] - ty) < 1e-6) { found = j; break; }
                }
                map.push(found);
            }
            return map;
        })();
        function displayId(id) {
            if (!isBlackView() || id < 0) return id;
            return ROT_ID[id];
        }

        function tracePoly(verts) {
            ctx2d.beginPath();
            verts.forEach((p, i) => (i === 0 ? ctx2d.moveTo(p.x, p.y) : ctx2d.lineTo(p.x, p.y)));
            ctx2d.closePath();
        }
        function drawRoundedHexagon(vertices, radius) {
            const startPoints = [], endPoints = [];
            for (let i = 0; i < 6; i++) {
                const curr = vertices[i];
                const prev = vertices[(i - 1 + 6) % 6];
                const next = vertices[(i + 1) % 6];
                const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.hypot(v1.x, v1.y), len2 = Math.hypot(v2.x, v2.y);
                startPoints.push({ x: curr.x + (v1.x / len1) * radius, y: curr.y + (v1.y / len1) * radius });
                endPoints.push({ x: curr.x + (v2.x / len2) * radius, y: curr.y + (v2.y / len2) * radius });
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
            ctx2d.stroke();
        }
        function outerFrameVerts() {
            // 尖角朝左右（旋转 90°）
            return [0, 60, 120, 180, 240, 300].map((deg) => {
                const a = deg * Math.PI / 180;
                return { x: LOGICAL_SIZE / 2 + FRAME_R * SCALE * Math.cos(a), y: LOGICAL_SIZE / 2 + FRAME_R * SCALE * Math.sin(a) };
            });
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
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const ps = {
            board: R.setup(),
            sideToMove: 'white',
            mySlot: null,
            gameOver: false,
            winner: null,
            lastFrom: null,
            lastTo: null,
            lastEnPassant: null,
            ws: null,
            slots: { black: false, white: false },
            reconnectTimer: null,
            matchStarted: false,
            matchTime: null,
            selectedId: -1,
            legalTargets: [],
            hoverId: -1,
            inCheck: false,
            pendingPromote: null,
            recordResultText: null,
            waitingScoreConfirm: false
        };

        function pieceAt(id) {
            const c = R.CELLS[id];
            return ps.board[R.key(c.row, c.col)] || '';
        }
        function pieceLabel(piece) {
            if (piece && typeof piece === 'object') piece = piece[0] + piece[1];
            return R.PIECE_CHAR[piece] || piece;
        }
        function sideOf(slot) { return slot === 'black' ? 'white' : 'black'; }
        function isMyTurnNow() {
            return ps.mySlot !== null && ps.matchStarted && !ps.gameOver
                && sideOf(ps.mySlot) === ps.sideToMove && !ps.waitingScoreConfirm;
        }

        function drawBoard() {
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
            // 正六角形木质外框（与六角国际象棋同款）
            ctx2d.shadowBlur = 0;
            ctx2d.shadowOffsetY = 0;
            ctx2d.fillStyle = '#fdcc90';
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 0.5;
            drawRoundedHexagon(outerFrameVerts(), FRAME_CORNER_RADIUS);

            // 格子
            for (let id = 0; id < R.CELLS.length; id++) {
                const did = displayId(id);
                tracePoly(cellVerts(did));
                ctx2d.fillStyle = CELL_COLORS[R.CELLS[did].type];
                ctx2d.fill();
                ctx2d.strokeStyle = '#8a5a3b';
                ctx2d.lineWidth = 1;
                ctx2d.stroke();
            }

            // 上一步标记
            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom.row, ps.lastTo.row].forEach((id) => {
                    if (id >= 0 && id < 72) {
                        tracePoly(cellVerts(displayId(id)));
                        ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                        ctx2d.fill();
                    }
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

            // 合法目标（小方块，参照国际象棋）
            for (const t of ps.legalTargets) {
                const did = displayId(t.to);
                const { x, y } = cellCenter(did);
                if (pieceAt(t.to)) {
                    // 菱形框（与棋格形状/方向一致），比例与标准国际象棋一致（0.76 × 格尺寸）
                    const verts = cellVerts(did).map((v) => ({ x: x + (v.x - x) * 0.76, y: y + (v.y - y) * 0.76 }));
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = 4;
                    tracePoly(verts);
                    ctx2d.stroke();
                } else {
                    const half = SCALE * 0.12;
                    ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
                }
            }

            // 棋子（菱形格较扁，字号略小于格高；黑棋比白棋略大，与国际象棋一致）
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            for (const k in ps.board) {
                const id = R.CELL_INDEX[k];
                const { x, y } = cellCenter(displayId(id));
                const glyph = pieceLabel(ps.board[k]);
                const fontSize = SCALE * 0.7 * (ps.board[k][0] === 'w' ? 1 : 1.05);
                ctx2d.font = `${fontSize}px "XiangqiPiece", "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                if (ps.board[k][0] === 'w') {
                    ctx2d.lineWidth = Math.max(1.5, SCALE * 0.04);
                    ctx2d.strokeStyle = '#1a1a1a';
                    ctx2d.fillStyle = '#f7f7f7';
                    ctx2d.strokeText(glyph, x, y + SCALE * 0.03);
                    ctx2d.fillText(glyph, x, y + SCALE * 0.03);
                } else {
                    ctx2d.fillStyle = '#1a1a1a';
                    ctx2d.fillText(glyph, x, y + SCALE * 0.03);
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
            // 按显示位置命中，返回原始 id
            let best = -1;
            let bestD = SCALE * 1.2;
            for (let id = 0; id < R.CELLS.length; id++) {
                const { x, y } = cellCenter(displayId(id));
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

            if (!ps.tryPlayMode && (ps.gameOver || !isMyTurnNow())) {
                ps.selectedId = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }
            const moveSide = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const piece = pieceAt(id);
            if (piece && piece[0] === (moveSide === 'white' ? 'w' : 'b')) {
                ps.selectedId = id;
                ps.legalTargets = R.allLegalMoves(ps.board, moveSide, ps.lastEnPassant)
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
                } else if (ps.tryPlayMode) {
                    tryPlayMove(ps.selectedId, id, null);
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

        function snapshotFrom(board, side, ep) {
            return {
                board: Object.fromEntries(Object.entries(board).map(([k, v]) => [k, { ...v }])),
                side,
                ep
            };
        }
        function applySnapshot(snap) {
            ps.board = snap.board;
            ps.tryPlaySide = snap.side;
            ps.lastEnPassant = snap.ep;
        }
        function tryPlayMove(fromId, toId, promote) {
            const legals = R.allLegalMoves(ps.board, ps.tryPlaySide, ps.lastEnPassant);
            const target = legals.find((m) => m.from === fromId && m.to === toId);
            if (!target) return false;
            const move = { from: fromId, to: toId };
            if (target.promote && !promote) promote = 'q';
            move.promote = promote || null;
            R.applyMove(ps.board, move, ps.lastEnPassant);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(ps.board, side, ps.lastEnPassant));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = side;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateTryPlayDisplay();
            drawBoard();
            return true;
        }
        function enterTryPlay() {
            if (!ps.tryPlayMode) {
                ps._tryPlayBackup = {
                    board: Object.fromEntries(Object.entries(ps.board).map(([k, v]) => [k, { ...v }])),
                    ep: ps.lastEnPassant,
                    side: ps.sideToMove
                };
            }
            ps.tryPlayMode = true;
            ps.tryPlaySide = ps.sideToMove;
            ps.tryPlaySnapshots = [snapshotFrom(ps.board, ps.sideToMove, ps.lastEnPassant)];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.innerText = '试下结束';
            updateTryPlayDisplay();
            drawBoard();
        }
        function exitTryPlay() {
            ps.tryPlayMode = false;
            ps.tryPlaySide = 'white';
            if (ps._tryPlayBackup) {
                ps.board = ps._tryPlayBackup.board;
                ps.lastEnPassant = ps._tryPlayBackup.ep;
                ps.sideToMove = ps._tryPlayBackup.side;
                ps._tryPlayBackup = null;
            }
            ps.tryPlaySnapshots = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) tryPlayBtn.innerText = '试下';
            updateTryPlayDisplay();
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
            const slider = document.getElementById('replaySlider');
            if (slider && ps.tryPlayMode) {
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
            }
        }
        function commitMove(fromId, toId, promote) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            const fc = R.CELLS[fromId], tc = R.CELLS[toId];
            ps.ws.send(JSON.stringify({ type: 'move', fromRow: fc.row, fromCol: fc.col, toRow: tc.row, toCol: tc.col, promote: promote || null }));
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
                    if (ps.tryPlayMode) {
                        tryPlayMove(from, to, t);
                    } else {
                        commitMove(from, to, t);
                    }
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
            promoBar.style.display = 'flex';
            promoBar.style.left = `${rect.left + x / scale - 100}px`;
            promoBar.style.top = `${rect.top + y / scale + 34}px`;
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
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            ps.inCheck = !!state.inCheck;
            ps.matchStarted = !!state.matchStarted;
            ps.recordResultText = state.recordResultText || null;
            ps.lastFrom = state.lastFrom || null;
            ps.lastTo = state.lastTo || null;
            ps.lastEnPassant = state.lastEnPassant || null;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.slots) ps.slots = state.slots;
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
            if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'exportRecord' }));
        }
        function enterReplayMode() {}
        function updateReplayUI() {}
        function showScoreConfirm() {}

        // 编辑模式：安装公共编辑 UI（点击放置棋子，关闭编辑时提交服务器）
        let editApi = null;
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'flat',
                editTools: config.editTools,
                pickAtClient(clientX, clientY) {
                    const { x, y } = canvasCoordsFromClient(clientX, clientY);
                    const id = getClosestCell(x, y);
                    return id >= 0 ? { index: id } : null;
                },
                drawBoard,
                getBoard: () => R.CELLS.map((c) => ps.board[R.key(c.row, c.col)] || ''),
                setBoard: (arr) => {
                    const nb = {};
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i] !== '') {
                            const c = R.CELLS[i];
                            nb[R.key(c.row, c.col)] = arr[i];
                        }
                    }
                    ps.board = nb;
                },
                emptyBoard: () => new Array(R.CELLS.length).fill('')
            });
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            pageState: ps,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
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
            timeControlDefaults: { mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 },
            slotUi: SLOT_UI,
            boardSeatOverlay: true,
            seatOverlayShape: 'hexagon',
            seatOverlayCornerRadius: FRAME_CORNER_RADIUS,
            getSeatOverlayVertices: () => outerFrameVerts()
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
