window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['non-rectangular-weiqi'] = {
    shell: {
        "title": "非四角围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />采用非四角棋盘。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 4,
        "boardSizeMax": 11,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "非四角围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "zoomScroll": false,
            "editBoard": true,
            "compoundPalette": false,
            "transparentCanvas": true
        },
        "editTools": [
            { "value": "empty", "label": "空" },
            { "value": "black", "label": "黑子" },
            { "value": "white", "label": "白子" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
/* ============================================================================
 * 非四角围棋（non-rectangular-weiqi）：一个插件，四个子棋类（subGameId = 原棋种 id）
 *   六角围棋 hexagon-weiqi / 花形五角围棋 floret-pentagon-weiqi /
 *   开罗五角围棋 cairo-pentagon-weiqi / 扭棱四角围棋 snub-quadrangle-weiqi
 *
 * 统一模型：内部盘 = 一维「点」数组（0/1/2），每种子棋类只提供几何（GEOMETRY[SUB]）：
 *   VIEW = { vertexCount, pos[i]={x,y}, neighbors[i]=[i…], koordOf[i]=[行,列],
 *            indexOf(行,列)->i, cellSize, clickThreshold, frame?, komi, totalPoints,
 *            twoStepPlacing, seatOverlayShape, pick(x,y)->i }
 *   规则（气/提子/禁全同/Benson/数点）、回放、试下、编辑盘面、棋子与标记绘制只写一份，
 *   全部跑在 VIEW 上；协议与棋谱一律用坐标 行,列（boardFromWire/wireBoard 里换算）。
 * ========================================================================== */

        /* ---------------------------- 子棋类目录 ---------------------------- */
        /** 每种子棋类的壳配置：名称、路数范围与默认路数、贴目、规则说明、棋谱前缀 */
        const SUB_META = {
            'hexagon-weiqi': {
                name: '六角围棋', min: 4, max: 11, def: 9,
                komi: (lanes) => (lanes >= 9 ? 7.5 : [0, 0, 0, 12, 7, 4.5, 5.5, 6.5, 7.5][lanes]),
                rulesHtml: '基本规则同标准围棋。<br /><br />采用六角棋盘。<br />',
                prefix: '六角围棋'
            },
            'floret-pentagon-weiqi': {
                name: '花形五角围棋', min: 3, max: 9, def: 7,
                komi: () => 3.25,
                rulesHtml: '基本规则同标准围棋。<br /><br />采用花形五角棋盘。<br />',
                prefix: '花形五角围棋'
            },
            'cairo-pentagon-weiqi': {
                name: '开罗五角围棋', min: 3, max: 9, def: 7,
                komi: (lanes) => (lanes === 3 ? 2 : 3),
                rulesHtml: '基本规则同围棋。<br /><br />采用开罗五角棋盘。<br />',
                prefix: '开罗五角围棋'
            },
            'snub-quadrangle-weiqi': {
                name: '扭棱四角围棋', min: 3, max: 9, def: 7,
                komi: (lanes) => (lanes === 3 ? 3 : 2),
                rulesHtml: '基本规则同围棋。<br /><br />采用扭棱四角棋盘。<br />',
                prefix: '扭棱四角围棋'
            }
        };
        const SUB_GAMES = Object.keys(SUB_META);
        const DEFAULT_SUB_GAME = 'hexagon-weiqi';

        /** 当前子棋类、当前路数、各子棋类上次用的路数（首次进入某子棋类用它自己的默认路数） */
        let SUB = DEFAULT_SUB_GAME;
        let LANES = SUB_META[SUB].def;
        const sizeBySubGame = Object.create(null);
        function subCfg() { return SUB_META[SUB] || SUB_META[DEFAULT_SUB_GAME]; }
        function recordSize() { sizeBySubGame[SUB] = LANES; }
        function rememberedOrDef(subGameId) {
            const v = sizeBySubGame[subGameId];
            return Number.isInteger(v) ? v : (SUB_META[subGameId] || SUB_META[DEFAULT_SUB_GAME]).def;
        }

        /* ---------------------------- 统一视图 ---------------------------- */
        const CANVAS_SIZE = 600;
        const FRAME_CENTER = CANVAS_SIZE / 2;
        /** 当前子棋类的几何（由 GEOMETRY[SUB].build(LANES) 生成） */
        let VIEW = null;

        /** 顶点型棋盘（六角/花形）→ 统一视图 */
        function vertexViewFromGeo(geo, lanes, extra) {
            const V = geo.vertexCount;
            const koordOf = geo.koordOf;
            const indexByKoord = new Map();
            for (let i = 0; i < V; i++) indexByKoord.set(koordOf[i][0] + ',' + koordOf[i][1], i);
            return Object.assign({
                vertexCount: V,
                pos: geo.transformed,
                neighbors: geo.neighbors,
                koordOf,
                indexOf: (row, col) => {
                    const i = indexByKoord.get(Number(row) + ',' + Number(col));
                    return i === undefined ? -1 : i;
                },
                cellSize: geo.cellSize,
                clickThreshold: geo.clickThreshold,
                frame: geo.frame || null,
                geo
            }, extra || {});
        }

        /** 掩码网格棋盘（开罗/扭棱）→ 统一视图 */
        function gridViewFromSpec(spec, lanes, extra) {
            const pos = [];
            const koordOf = [];
            const indexByKoord = new Map();
            for (let r = 0; r < spec.gridW; r++) {
                for (let c = 0; c < spec.gridH; c++) {
                    if (!spec.isValid(r, c)) continue;
                    indexByKoord.set(r + ',' + c, pos.length);
                    koordOf.push([r, c]);
                    pos.push(spec.unitPos(r, c));
                }
            }
            const neighbors = koordOf.map(([r, c]) => {
                const out = [];
                for (const [nr, nc] of spec.neighborList(r, c)) {
                    const i = indexByKoord.get(nr + ',' + nc);
                    if (i !== undefined) out.push(i);
                }
                return out;
            });
            return Object.assign({
                vertexCount: pos.length,
                pos,
                neighbors,
                koordOf,
                indexOf: (row, col) => {
                    const i = indexByKoord.get(Number(row) + ',' + Number(col));
                    return i === undefined ? -1 : i;
                },
                frame: null,
                geo: spec
            }, extra || {});
        }

        /* ---------------------------- 共用绘图小件 ---------------------------- */
        function drawRoundedPolygon(ctx2, vertices, radius, skipStroke) {
            const n = vertices.length;
            if (n < 3) return;
            const startPoints = [];
            const endPoints = [];
            for (let i = 0; i < n; i++) {
                const curr = vertices[i];
                const prev = vertices[(i - 1 + n) % n];
                const next = vertices[(i + 1) % n];
                const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.hypot(v1.x, v1.y), len2 = Math.hypot(v2.x, v2.y);
                startPoints.push({ x: curr.x + (v1.x / len1) * radius, y: curr.y + (v1.y / len1) * radius });
                endPoints.push({ x: curr.x + (v2.x / len2) * radius, y: curr.y + (v2.y / len2) * radius });
            }
            ctx2.beginPath();
            ctx2.moveTo(startPoints[0].x, startPoints[0].y);
            for (let i = 0; i < n; i++) {
                ctx2.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                if (i < n - 1) ctx2.lineTo(startPoints[i + 1].x, startPoints[i + 1].y);
            }
            ctx2.lineTo(startPoints[0].x, startPoints[0].y);
            ctx2.closePath();
            ctx2.fill();
            if (!skipStroke) ctx2.stroke();
        }

        function pointInPolygon(px, py, verts) {
            let inside = false;
            for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
                const xi = verts[i].x, yi = verts[i].y;
                const xj = verts[j].x, yj = verts[j].y;
                if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        /** 顶点型棋盘的选点：先在木框内（若有框），再取阈值内最近顶点 */
        function vertexPick(view, x, y) {
            if (view.frame && !pointInPolygon(x, y, view.frame)) return -1;
            let minDist = Infinity, best = -1;
            for (let i = 0; i < view.vertexCount; i++) {
                const p = view.pos[i];
                const dx = p.x - x, dy = p.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) { minDist = dist; best = i; }
            }
            return minDist < view.clickThreshold ? best : -1;
        }

        /** 正多边形木框（按中心与半径等分取点） */
        function polygonFrame(radius, sides, rotateDeg) {
            const rot = (rotateDeg || 0) * Math.PI / 180;
            return Array.from({ length: sides }, (_, i) => {
                const a = rot + (i * 2 * Math.PI) / sides;
                return { x: FRAME_CENTER + radius * Math.cos(a), y: FRAME_CENTER + radius * Math.sin(a) };
            });
        }

        /* ---------------------------- 六角围棋几何 ---------------------------- */
        const HEX_OUTER_HEX_RADIUS = 280;
        const HEX_FRAME_CORNER_RADIUS = 12;
        function hexFrameVerts() {
            return Array.from({ length: 6 }, (_, i) => {
                const a = i * Math.PI / 3;
                return {
                    x: FRAME_CENTER + HEX_OUTER_HEX_RADIUS * Math.cos(a),
                    y: FRAME_CENTER + HEX_OUTER_HEX_RADIUS * Math.sin(a)
                };
            });
        }

        /** 六角棋盘：蜂窝密铺的顶点图（与后端 generateHexBoardData 同源，另算屏幕坐标与木框） */
        function generateHexBoard(n) {
            const S = n - 1;
            const R = 2;
            const sqrt3 = Math.sqrt(3);
            const vertexMap = new Map();
            const vertices = [];
            const hexList = [];
            const dx = [R, R / 2, -R / 2, -R, -R / 2, R / 2];
            const dy = [0, R * sqrt3 / 2, R * sqrt3 / 2, 0, -R * sqrt3 / 2, -R * sqrt3 / 2];

            for (let q = -(S - 1); q <= S - 1; q++) {
                for (let r = -(S - 1); r <= S - 1; r++) {
                    const s = -q - r;
                    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > S - 1) continue;
                    const cx = R * (3 / 2) * q;
                    const cy = R * sqrt3 * (r + q / 2);
                    const hexIds = [];
                    for (let j = 0; j < 6; j++) {
                        const x = cx + dx[j];
                        const y = cy + dy[j];
                        const key = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
                        if (!vertexMap.has(key)) {
                            vertexMap.set(key, vertices.length);
                            vertices.push({ x, y });
                        }
                        hexIds.push(vertexMap.get(key));
                    }
                    hexList.push(hexIds);
                }
            }
            for (let i = 0; i < vertices.length; i++) {
                const { x, y } = vertices[i];
                vertices[i] = { x: -y, y: x };
            }
            const vc = vertices.length;
            const neighborSets = Array.from({ length: vc }, () => new Set());
            for (const hex of hexList) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i];
                    const b = hex[(i + 1) % 6];
                    if (a !== b) { neighborSets[a].add(b); neighborSets[b].add(a); }
                }
            }
            const PADDING = 72 - 4 * n;
            const R_inner = HEX_OUTER_HEX_RADIUS - PADDING;
            let cx = 0, cy = 0;
            for (const v of vertices) { cx += v.x; cy += v.y; }
            cx /= vc; cy /= vc;
            let maxDist = 0;
            for (const v of vertices) {
                const d = Math.hypot(v.x - cx, v.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? R_inner / maxDist : 1;
            const transformed = vertices.map(v => ({
                x: FRAME_CENTER + (v.x - cx) * scale,
                y: FRAME_CENTER - (v.y - cy) * scale   // 棋盘显示上下翻折(y 镜像)
            }));
            let totalDist = 0, edgeCount = 0;
            for (const hex of hexList) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i], b = hex[(i + 1) % 6];
                    totalDist += Math.hypot(transformed[a].x - transformed[b].x, transformed[a].y - transformed[b].y);
                    edgeCount++;
                }
            }
            const cellSize = totalDist / edgeCount;
            // 显示坐标表：行 0 = 屏幕最上面一行（显示 y 已翻折，按 y 从小到大排行），列 = 行内自左往右
            const rows = [];
            for (let v = 0; v < vc; v++) {
                const y = transformed[v].y;
                let row = rows.find(r => Math.abs(r.y - y) < 0.01);
                if (!row) { row = { y, pts: [] }; rows.push(row); }
                row.pts.push(v);
            }
            rows.sort((a, b) => a.y - b.y);
            const koordOf = new Array(vc);
            rows.forEach((row, ri) => {
                row.pts.sort((a, b) => transformed[a].x - transformed[b].x);
                row.pts.forEach((v, ci) => { koordOf[v] = [ri, ci]; });
            });
            return {
                vertexCount: vc,
                transformed,
                neighbors: neighborSets.map(set => Array.from(set)),
                hexagons: hexList,
                clickThreshold: cellSize * 0.4,
                cellSize,
                koordOf,
                frame: hexFrameVerts()
            };
        }

        function hexDrawSkeleton(c2, view) {
            c2.lineWidth = 0.5;
            c2.strokeStyle = '#3a281c';
            c2.fillStyle = QiSquareWeiqiCanvas.getWoodFill(c2, document.getElementById('goBoard')) || '#fdcc90';
            drawRoundedPolygon(c2, hexFrameVerts(), HEX_FRAME_CORNER_RADIUS, false);
            c2.lineWidth = 1.5;
            c2.strokeStyle = '#3a281c';
            c2.lineJoin = 'miter';
            for (const hex of view.geo.hexagons) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i], b = hex[(i + 1) % 6];
                    c2.beginPath();
                    c2.moveTo(view.pos[a].x, view.pos[a].y);
                    c2.lineTo(view.pos[b].x, view.pos[b].y);
                    c2.stroke();
                }
            }
        }


        /* ---------------------------- 花形五角围棋几何 ---------------------------- */
        const FLORET_OUTER_HEX_RADIUS = 420;
        const FLORET_FRAME_CORNER_RADIUS = 12;
        const FLORET_SQRT3 = Math.sqrt(3);
        const FLORET_SIGMA = FLORET_SQRT3 / 2;
        const FLORET_PENT_UNSCALED = {
            A: [0, 0], B: [-1, FLORET_SQRT3], C: [-2, FLORET_SQRT3], D: [-2.5, FLORET_SQRT3 / 2], E: [-2, 0]
        };
        /** 各路数的总点数（与后端生成器实测一致；含 √3 浮点边界，无简洁闭式，写死） */
        const FLORET_TOTAL_POINTS = {
            3: 106, 4: 214, 5: 427, 6: 712, 7: 1069, 8: 1375,
            9: 1858, 10: 2413, 11: 3040, 12: 3544, 13: 4297
        };

        function floretRotPt(p, r) {
            const c = Math.cos(r), s = Math.sin(r);
            return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
        }
        function floretOneFlower(ox, oy) {
            const out = [];
            for (let pet = 0; pet < 6; pet++) {
                const pts = {};
                for (const key of Object.keys(FLORET_PENT_UNSCALED)) {
                    let q = floretRotPt(FLORET_PENT_UNSCALED[key], pet * Math.PI / 3 - Math.atan(FLORET_SQRT3 / 9));
                    q = [q[0] * FLORET_SIGMA, q[1] * FLORET_SIGMA];
                    pts[key] = [q[0] + ox, q[1] + oy];
                }
                out.push(pts);
            }
            return out;
        }
        function floretVertexKey(x, y) {
            return `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
        }

        /** 花形五角棋盘：六个花瓣五边形铺一格；返回顶点、边、屏幕坐标与显示坐标表 */
        function generateFloretBoard(n) {
            const ux = 1.5 * Math.sqrt(7), uy = 0, vx = 0, vy = 1.5 * Math.sqrt(21);
            const vertexMap = new Map();
            const vertices = [];
            const edgeSet = new Set();
            function addVertex(x, y) {
                const k = floretVertexKey(x, y);
                if (!vertexMap.has(k)) { vertexMap.set(k, vertices.length); vertices.push({ x, y }); }
                return vertexMap.get(k);
            }
            function addEdge(a, b) { if (a !== b) edgeSet.add(a < b ? a + ',' + b : b + ',' + a); }
            function addFlowerAtGrid(px, py) {
                const ox = px * ux + py * vx, oy = px * uy + py * vy;
                for (const P of floretOneFlower(ox, oy)) {
                    const ids = ['A', 'B', 'C', 'D', 'E'].map(k => addVertex(P[k][0], P[k][1]));
                    for (let k = 0; k < 5; k++) addEdge(ids[k], ids[(k + 1) % 5]);
                }
            }
            for (let i = 0; i <= FLORET_SQRT3 * n - 3; i++)
                for (let j = 0; j <= n - 2; j++) addFlowerAtGrid(i, j);
            for (let i = 0; i <= FLORET_SQRT3 * n - 4; i++)
                for (let j = 0; j <= n - 3; j++) addFlowerAtGrid(i + 0.5, j + 0.5);

            // 与后端、旧插件一致：整体旋转 90°（x,y → -y,x），棋盘显示方向才对
            for (let i = 0; i < vertices.length; i++) {
                const { x, y } = vertices[i];
                vertices[i] = { x: -y, y: x };
            }
            const vc = vertices.length;
            const pairs = [];
            for (const e of edgeSet) { const [a, b] = e.split(',').map(Number); pairs.push([a, b]); }
            const PADDING = Math.max(32, 144 - 16 * n);
            const R_inner = FLORET_OUTER_HEX_RADIUS - PADDING;
            let cx = 0, cy = 0;
            for (const v of vertices) { cx += v.x; cy += v.y; }
            cx /= vc; cy /= vc;
            let maxDist = 0;
            for (const v of vertices) {
                const d = Math.hypot(v.x - cx, v.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? R_inner / maxDist : 1;
            const transformed = vertices.map(v => ({
                x: FRAME_CENTER + (v.x - cx) * scale,
                y: FRAME_CENTER - (v.y - cy) * scale   // 棋盘显示上下翻折(y 镜像)
            }));
            let totalDist = 0;
            for (const [a, b] of pairs)
                totalDist += Math.hypot(transformed[a].x - transformed[b].x, transformed[a].y - transformed[b].y);
            const cellSize = pairs.length ? totalDist / pairs.length : 12;
            const neighborSets = Array.from({ length: vc }, () => new Set());
            for (const [a, b] of pairs) { neighborSets[a].add(b); neighborSets[b].add(a); }
            // 显示坐标表：行 0 = 屏幕最上面一行（按显示 y 从小到大），列 = 行内自左往右
            const rows = [];
            for (let v = 0; v < vc; v++) {
                const y = transformed[v].y;
                let row = rows.find(r => Math.abs(r.y - y) < 0.01);
                if (!row) { row = { y, pts: [] }; rows.push(row); }
                row.pts.push(v);
            }
            rows.sort((a, b) => a.y - b.y);
            const koordOf = new Array(vc);
            rows.forEach((row, ri) => {
                row.pts.sort((a, b) => transformed[a].x - transformed[b].x);
                row.pts.forEach((v, ci) => { koordOf[v] = [ri, ci]; });
            });
            return {
                vertexCount: vc,
                transformed,
                neighbors: neighborSets.map(set => Array.from(set)),
                edgePairs: pairs,
                clickThreshold: cellSize * 0.4,
                cellSize,
                koordOf,
                frame: polygonFrame(FLORET_OUTER_HEX_RADIUS, 6, 0)
            };
        }

        let floretGridLayer = null;
        function floretDrawSkeleton(c2, view) {
            if (!floretGridLayer) {
                const dpr = window.devicePixelRatio || 1;
                const c = document.createElement('canvas');
                c.width = CANVAS_SIZE * dpr;
                c.height = CANVAS_SIZE * dpr;
                const g = c.getContext('2d');
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                g.lineWidth = 1.5;
                g.strokeStyle = '#3a281c';
                g.lineJoin = 'miter';
                const path = new Path2D();
                for (const [a, b] of view.geo.edgePairs) {
                    path.moveTo(view.pos[a].x, view.pos[a].y);
                    path.lineTo(view.pos[b].x, view.pos[b].y);
                }
                g.stroke(path);
                floretGridLayer = c;
            }
            c2.drawImage(floretGridLayer, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        /* ---------------------------- 开罗五角围棋几何 ---------------------------- */
        /** 网格合法性/邻接：与后端 CairoPentagonWeiqiRoom 一致 */
        const Cairo = {
            gridDims(lanes) { return { gw: 4 * lanes - 5, gh: 4 * lanes - 3 }; },
            isValidVertex(row, col, gw, gh) {
                if (row < 0 || col < 0 || row >= gw || col >= gh) return false;
                return !((row & 1) === 1 && (col & 1) === 0);
            },
            getNeighbors(row, col, gw, gh) {
                const arr = [];
                if ((col & 1) === 1) arr.push([row - 1, col], [row + 1, col]);
                if ((row & 1) === 0) arr.push([row, col - 1], [row, col + 1]);
                const rm = row & 3, cm = col & 3;
                if (rm === 1) {
                    if (cm === 1) arr.push([row, col + 2]);
                    else if (cm === 3) arr.push([row, col - 2]);
                } else if (rm === 3) {
                    if (cm === 3) arr.push([row, col + 2]);
                    else if (cm === 1) arr.push([row, col - 2]);
                }
                if (cm === 0) {
                    if (rm === 0) arr.push([row + 2, col]);
                    else if (rm === 2) arr.push([row - 2, col]);
                } else if (cm === 2) {
                    if (rm === 2) arr.push([row + 2, col]);
                    else if (rm === 0) arr.push([row - 2, col]);
                }
                const out = [];
                for (const [a, b] of arr) if (Cairo.isValidVertex(a, b, gw, gh)) out.push([a, b]);
                return out;
            }
        };

        function vertexUnitPos(row, col) {
            const dx = Math.sqrt(3) / 2, dy = Math.sqrt(3) / 2, WG = 0.5;
            let y = row * dy;
            if ((row & 1) === 0) {
                const rm = row & 3, cm = col & 3;
                if (rm === 0) { if (cm === 2) y -= WG; else if (cm === 0) y += WG; }
                else if (rm === 2) { if (cm === 0) y -= WG; else if (cm === 2) y += WG; }
            }
            let x = col * dx;
            if ((col & 1) === 1) {
                const rm = row & 3, cm = col & 3;
                if (cm === 1) { if (rm === 3) x -= WG; else if (rm === 1) x += WG; }
                else if (cm === 3) { if (rm === 3) x += WG; else if (rm === 1) x -= WG; }
            }
            return { x, y };
        }

        function buildCairoLayout(lanes) {
            const gw = 4 * lanes - 5;   // 行数
            const gh = 4 * lanes - 3;   // 列数
            const raw = [];
            for (let r = 0; r < gw; r++) {
                for (let c = 0; c < gh; c++) {
                    if (!Cairo.isValidVertex(r, c, gw, gh)) continue;
                    const u = vertexUnitPos(gw - 1 - r, c);   // row=0 在底部:物理位置按翻转行计算
                    raw.push({ r, c, x: u.x, y: u.y });
                }
            }
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const v of raw) {
                minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
                maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
            }
            const pad = 60 - 5 * lanes;
            const scale = Math.min((600 - 2 * pad) / (maxX - minX || 1), (600 - 2 * pad) / (maxY - minY || 1));
            // 水平/垂直均居中：内容未占满画布时，两侧留白相等（否则格线会整体偏上/偏左）
            const contentW = (maxX - minX) * scale;
            const contentH = (maxY - minY) * scale;
            const offsetX = pad + (600 - 2 * pad - contentW) / 2;
            const offsetY = pad + (600 - 2 * pad - contentH) / 2;
            const pos = new Map();
            for (const v of raw) {
                pos.set(`${v.r},${v.c}`, { x: offsetX + (v.x - minX) * scale, y: offsetY + (v.y - minY) * scale });
            }
            // 均匀基准线（坐标标签用）：行号沿行距均匀分布，列字母沿列距均匀分布（与格线同基准）
            const rowLines = [];
            for (let r1 = 1; r1 <= gw; r1++)
                rowLines.push(offsetY + ((r1 - 1) * (Math.sqrt(3) / 2) - minY) * scale);
            const colLines = [];
            for (let c1 = 1; c1 <= gh; c1++)
                colLines.push(offsetX + ((c1 - 1) * (Math.sqrt(3) / 2) - minX) * scale);
            const edgePath = new Path2D();
            const edgeSeen = new Set();
            for (let r = 0; r < gw; r++) {
                for (let c = 0; c < gh; c++) {
                    if (!Cairo.isValidVertex(r, c, gw, gh)) continue;
                    const p0 = pos.get(`${r},${c}`);
                    for (const [nr, nc] of Cairo.getNeighbors(r, c, gw, gh)) {
                        const k = r < nr || (r === nr && c < nc) ? `${r},${c}|${nr},${nc}` : `${nr},${nc}|${r},${c}`;
                        if (edgeSeen.has(k)) continue;
                        edgeSeen.add(k);
                        const p1 = pos.get(`${nr},${nc}`);
                        edgePath.moveTo(p0.x, p0.y);
                        edgePath.lineTo(p1.x, p1.y);
                    }
                }
            }
            return { pos, edgePath, rowLines, colLines, gridW: gw, gridH: gh };
        }

        /** 坐标标签：行号 1..H 在左（沿均匀行线），列字母 A.. 在上（沿均匀列线） */
        function cairoDrawCoords(tctx, lanes, gridW, gridH, rowLines, colLines) {
            if (rowLines.length === 0 || colLines.length === 0) return;
            const pad = 60 - 5 * lanes;
            tctx.font = `bold ${Math.max(9, Math.round(170 / gridW))}px Arial`;
            tctx.fillStyle = '#3a281c';
            tctx.textAlign = 'center';
            tctx.textBaseline = 'middle';
            for (let c = 0; c < gridH; c++) {
                let letter = String.fromCharCode(65 + c);
                if (c >= 26) letter = String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + c % 26);
                tctx.fillText(letter, colLines[c], 0.9 * pad);
            }
            for (let r = 0; r < gridW; r++) tctx.fillText((gridW - r).toString(), 0.5 * pad, rowLines[r]);
        }

        let cairoGridLayer = null;
        function cairoDrawSkeleton(c2, view) {
            if (!cairoGridLayer || cairoGridLayer.__lanes !== LANES) {
                const dpr = window.devicePixelRatio || 1;
                const c = document.createElement('canvas');
                c.width = CANVAS_SIZE * dpr;
                c.height = CANVAS_SIZE * dpr;
                const g = c.getContext('2d');
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                g.lineWidth = 1.5;
                g.strokeStyle = '#3a281c';
                g.stroke(view.geo.edgePath);
                cairoDrawCoords(g, LANES, view.geo.gridW, view.geo.gridH, view.geo.rowLines, view.geo.colLines);
                c.__lanes = LANES;
                cairoGridLayer = c;
            }
            c2.drawImage(cairoGridLayer, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        /** 选点：最近的合法交点（阈值 26px，与旧开罗插件一致） */
        function cairoPick(view, x, y) {
            let best = -1, bestD = 26;
            for (let i = 0; i < view.vertexCount; i++) {
                const p = view.pos[i];
                const d = Math.hypot(x - p.x, y - p.y);
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }

        /* ---------------------------- 扭棱四角围棋几何 ---------------------------- */
        /** 网格合法性/邻接：与后端 SnubQuadrangleWeiqiRoom 一致 */
        const Snub = {
            gridDims(lanes) { return { w: 3 * lanes - 2, h: 3 * lanes - 2 }; },
            isValidVertex(row, col, gridW, gridH) {
                if (row < 0 || col < 0 || row >= gridW || col >= gridH) return false;
                if (row % 3 === 2 && col % 3 === 2) return false;
                if (row === gridW - 1 && row % 3 === 0 && col % 3 === 1) return false;
                if (col === gridH - 1 && row % 3 === 0 && col % 3 === 0) return false;
                return true;
            },
            getNeighbors(row, col, gridW, gridH) {
                let arr = [];
                if (row % 3 === 0 && col % 3 === 0) arr = [[row - 1, col], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, col]];
                else if (row % 3 === 1 && col % 3 === 0) arr = [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col]];
                else if (row % 3 === 2 && col % 3 === 0) arr = [[row - 1, col - 1], [row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col]];
                else if (row % 3 === 0 && col % 3 === 1) arr = [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col], [1 + row, 1 + col]];
                else if (row % 3 === 1 && col % 3 === 1) arr = [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, col]];
                else if (row % 3 === 2 && col % 3 === 1) arr = [[row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col], [1 + row, 1 + col]];
                else if (row % 3 === 0 && col % 3 === 2) arr = [[row - 1, col - 1], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, 1 + col]];
                else if (row % 3 === 1 && col % 3 === 2) arr = [[row - 1, col - 1], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, 1 + col]];
                const out = [];
                for (const [a, b] of arr) if (Snub.isValidVertex(a, b, gridW, gridH)) out.push([a, b]);
                return out;
            }
        };

        function buildSnubLayout(lanes) {
            const gw = 3 * lanes - 2, gh = gw;
            const SM = 1;
            const MID = Math.sqrt(3) * SM;
            const LG = 2 * SM;
            const colW = i => (i % 3 === 2) ? LG : MID;
            const rowH = i => (i % 3 === 2) ? LG : MID;
            const cumCol = (k) => {
                let s = 0;
                for (let i = 0; i < k; i++) s += colW(i);
                return s;
            };
            const cumRow = (k) => {
                let s = 0;
                for (let i = 0; i < k; i++) s += rowH(i);
                return s;
            };
            const cellW = (gc, span) => {
                let w = 0;
                for (let i = 0; i < span; i++) w += colW(gc + i);
                return w;
            };
            const cellH = (gr, span) => {
                let h = 0;
                for (let i = 0; i < span; i++) h += rowH(gr + i);
                return h;
            };
            function cellSpan(r, c) {
                let colOff = 0, colSpan = 1, rowOff = 0, rowSpan = 1;
                if (r % 3 === 0 && c % 3 !== 1) {
                    colOff = -1; colSpan = 2; rowOff = 0; rowSpan = 1;
                }
                if (r % 3 >= 1 && c % 3 === 0) {
                    colOff = -1; colSpan = 2; rowOff = -1; rowSpan = 2;
                }
                if (r % 3 !== 1 && c % 3 === 1) {
                    colOff = 0; colSpan = 1; rowOff = 0; rowSpan = 1;
                }
                if (r % 3 === 1 && c % 3 >= 1) {
                    colOff = 0; colSpan = 1; rowOff = -1; rowSpan = 2;
                }
                return { colOff, colSpan, rowOff, rowSpan };
            }
            function margins(r, c) {
                const a = r % 3, b = c % 3;
                if (a === 0 && b === 0) return { L: MID, T: SM, R: MID, B: MID - SM };
                if (a === 0 && b === 1) return { L: SM, T: SM, R: MID - SM, B: SM };
                if (a === 0 && b === 2) return { L: MID, T: MID - SM, R: MID, B: SM };
                if (a === 1 && b === 0) return { L: MID, T: MID, R: LG, B: MID };
                if (a === 1 && b === 1) return { L: SM, T: MID, R: SM, B: LG };
                if (a === 1 && b === 2) return { L: SM, T: LG, R: SM, B: MID };
                if (a === 2 && b === 0) return { L: LG, T: MID, R: MID, B: MID };
                if (a === 2 && b === 1) return { L: MID - SM, T: SM, R: SM, B: SM };
                return null;
            }
            function centerInCell(Wp, Hp, L, T, R, B) {
                return { x: L + (Wp - L - R) / 2, y: T + (Hp - T - B) / 2 };
            }
            const raw = [];
            for (let r = 0; r < gw; r++) {
                for (let c = 0; c < gh; c++) {
                    if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                    const sp = cellSpan(r, c);
                    const gridCol = 1 + sp.colOff + r;
                    const gridRow = 1 + sp.rowOff + c;
                    const Wp = cellW(gridCol, sp.colSpan);
                    const Hp = cellH(gridRow, sp.rowSpan);
                    const m = margins(r, c);
                    if (!m) continue;
                    const cen = centerInCell(Wp, Hp, m.L, m.T, m.R, m.B);
                    raw.push({ r, c, x: cumCol(gridCol) + cen.x, y: cumRow(gridRow) + cen.y });
                }
            }
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const v of raw) {
                minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
                maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
            }
            const pad = 60 - 5 * lanes;
            const scale = Math.min((600 - 2 * pad) / (maxX - minX || 1), (600 - 2 * pad) / (maxY - minY || 1));
            const cx0 = 300, cy0 = 300;
            function rotCW90(px, py) {
                return { x: cx0 - (py - cy0), y: cy0 + (px - cx0) };
            }
            const pos = new Map();
            for (const v of raw) {
                const px = pad + (v.x - minX) * scale;
                const py = pad + (v.y - minY) * scale;
                const p = rotCW90(px, py);
                // 棋盘显示上下翻折：物理 y 镜像（600 为画布逻辑尺寸），坐标语义不变
                pos.set(`${v.r},${v.c}`, { x: p.x, y: 600 - p.y });
            }
            const edgePath = new Path2D();
            const edgeSeen = new Set();
            for (let r = 0; r < gw; r++) {
                for (let c = 0; c < gh; c++) {
                    if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                    const p0 = pos.get(`${r},${c}`);
                    for (const [nr, nc] of Snub.getNeighbors(r, c, gw, gh)) {
                        const k = r < nr || (r === nr && c < nc) ? `${r},${c}|${nr},${nc}` : `${nr},${nc}|${r},${c}`;
                        if (edgeSeen.has(k)) continue;
                        edgeSeen.add(k);
                        const p1 = pos.get(`${nr},${nc}`);
                        edgePath.moveTo(p0.x, p0.y);
                        edgePath.lineTo(p1.x, p1.y);
                    }
                }
            }
            return { pos, edgePath };
        }

        /** 坐标标签锚点：每列取最上面的点、每行取最左的点（与旧扭棱插件一致） */
        function computeSnubCoordLabelPos(view) {
            const gw = view.geo.gridW, gh = view.geo.gridH;
            const colX = [], rowY = [];
            for (let c = 0; c < gh; c++) {
                let topX = Infinity, topY = Infinity;
                for (let r = 0; r < gw; r++) {
                    const i = view.indexOf(r, c);
                    if (i < 0) continue;
                    const pt = view.pos[i];
                    if (pt.y < topY) { topY = pt.y; topX = pt.x; }
                }
                colX.push(isFinite(topX) ? topX : null);
            }
            for (let r = 0; r < gw; r++) {
                let leftX = Infinity, leftY = Infinity;
                for (let c = 0; c < gh; c++) {
                    const i = view.indexOf(r, c);
                    if (i < 0) continue;
                    const pt = view.pos[i];
                    if (pt.x < leftX) { leftX = pt.x; leftY = pt.y; }
                }
                rowY.push(isFinite(leftY) ? leftY : null);
            }
            return { colX, rowY };
        }

        /** 坐标标签：列字母 A.. 在上、行号 19..1 在左（与旧扭棱插件一致） */
        function snubDrawCoords(tctx, view, lanes, labelPos) {
            if (!labelPos) return;
            const gw = view.geo.gridW, gh = view.geo.gridH;
            tctx.font = `bold ${Math.max(9, Math.round(170 / gw))}px Arial`;
            tctx.fillStyle = '#3a281c';
            tctx.textAlign = 'center';
            tctx.textBaseline = 'middle';
            const pad = 60 - 5 * lanes;
            for (let c = 0; c < gh; c++) {
                const topX = labelPos.colX[c];
                if (topX == null) continue;
                let idx = gw - 1 - c;
                let letter = String.fromCharCode(65 + idx);
                if (idx >= 26) letter = String.fromCharCode(64 + Math.floor(idx / 26)) + String.fromCharCode(65 + idx % 26);
                tctx.fillText(letter, topX, 0.6 * pad);
            }
            for (let r = 0; r < gw; r++) {
                const leftY = labelPos.rowY[r];
                if (leftY == null) continue;
                tctx.fillText((r + 1).toString(), 0.5 * pad, leftY);
            }
        }

        let snubGridLayer = null;
        function snubDrawSkeleton(c2, view) {
            if (!snubGridLayer || snubGridLayer.__lanes !== LANES) {
                const dpr = window.devicePixelRatio || 1;
                const c = document.createElement('canvas');
                c.width = CANVAS_SIZE * dpr;
                c.height = CANVAS_SIZE * dpr;
                const g = c.getContext('2d');
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                g.lineWidth = 1.5;
                g.strokeStyle = '#3a281c';
                g.stroke(view.geo.edgePath);
                snubDrawCoords(g, view, LANES, computeSnubCoordLabelPos(view));
                c.__lanes = LANES;
                snubGridLayer = c;
            }
            c2.drawImage(snubGridLayer, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        /** 选点：最近的合法交点（阈值 26px，与旧扭棱插件一致） */
        function snubPick(view, x, y) {
            let best = -1, bestD = 26;
            for (let i = 0; i < view.vertexCount; i++) {
                const p = view.pos[i];
                const d = Math.hypot(x - p.x, y - p.y);
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }

        /* ---------------------------- 几何注册表 ---------------------------- */
        /** 子棋类 id → { build(lanes), drawSkeleton(ctx, view), pick(view, x, y) } */
        const GEOMETRY = {
            'hexagon-weiqi': {
                build(lanes) {
                    const geo = generateHexBoard(lanes);
                    return vertexViewFromGeo(geo, lanes, {
                        totalPoints: 6 * (lanes - 1) * (lanes - 1),
                        twoStepPlacing: lanes > 9,
                        seatOverlayShape: 'hexagon',
                        komi: subCfg().komi(lanes)
                    });
                },
                drawSkeleton: hexDrawSkeleton,
                pick: vertexPick
            },
            'floret-pentagon-weiqi': {
                build(lanes) {
                    const geo = generateFloretBoard(lanes);
                    return vertexViewFromGeo(geo, lanes, {
                        totalPoints: FLORET_TOTAL_POINTS[lanes] || geo.vertexCount,
                        twoStepPlacing: lanes > 11,
                        seatOverlayShape: 'square',
                        komi: subCfg().komi(lanes),
                        stoneRadius: geo.cellSize * 0.35
                    });
                },
                drawSkeleton: floretDrawSkeleton,
                pick: vertexPick
            },
            'cairo-pentagon-weiqi': {
                build(lanes) {
                    const layout = buildCairoLayout(lanes);
                    const spec = {
                        gridW: layout.gridW, gridH: layout.gridH,
                        isValid: (r, c) => Cairo.isValidVertex(r, c, layout.gridW, layout.gridH),
                        neighborList: (r, c) => Cairo.getNeighbors(r, c, layout.gridW, layout.gridH),
                        unitPos: (r, c) => layout.pos.get(r + ',' + c),
                        edgePath: layout.edgePath, rowLines: layout.rowLines, colLines: layout.colLines
                    };
                    const stoneR = 54 / (lanes - 1);
                    return gridViewFromSpec(spec, lanes, {
                        totalPoints: 12 * (lanes - 1) * (lanes - 1),
                        twoStepPlacing: false,
                        seatOverlayShape: 'square',
                        komi: subCfg().komi(lanes),
                        stoneRadius: stoneR,
                        markLen: (r) => r * 0.8,
                        markBgRadius: (r) => r * 0.56,
                        markFontPx: (r, ch) => r * (ch === '🚩' ? 1.2 : 1.32),
                        numberFontPx: (r, len) => r * (len >= 3 ? 0.85 : 1.05),
                        estimateMarkScale: 0.4
                    });
                },
                drawSkeleton: cairoDrawSkeleton,
                pick: cairoPick
            },
            'snub-quadrangle-weiqi': {
                build(lanes) {
                    const layout = buildSnubLayout(lanes);
                    const dims = Snub.gridDims(lanes);
                    const spec = {
                        gridW: dims.w, gridH: dims.h,
                        isValid: (r, c) => Snub.isValidVertex(r, c, dims.w, dims.h),
                        neighborList: (r, c) => Snub.getNeighbors(r, c, dims.w, dims.h),
                        unitPos: (r, c) => layout.pos.get(r + ',' + c),
                        edgePath: layout.edgePath
                    };
                    const stoneR = 75 / (lanes - 1) + 1.32;
                    return gridViewFromSpec(spec, lanes, {
                        totalPoints: 4 * (2 * lanes - 1) * (lanes - 1),
                        twoStepPlacing: false,
                        seatOverlayShape: 'square',
                        komi: subCfg().komi(lanes),
                        stoneRadius: stoneR,
                        markLen: (r) => r * 0.8,
                        markBgRadius: (r) => r * 0.56,
                        markFontPx: (r, ch) => r * (ch === '🚩' ? 1.2 : 1.32),
                        numberFontPx: (r, len) => r * (len >= 3 ? 0.85 : 1.05),
                        estimateMarkScale: 0.4
                    });
                },
                drawSkeleton: snubDrawSkeleton,
                pick: snubPick
            }
        };

        /* ---------------------- 视图构建与坐标换算（四种棋盘共用） ---------------------- */
        /** 生成当前子棋类的几何；改路数/切子棋类后都要调用 */
        /** 默认棋子：黑/白径向渐变圆（六角/花形用；开罗/扭棱自带精灵画法） */
        function defaultDrawStone(c2, x, y, radius, color) {
            const grad = c2.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
            if (color === 1) {
                grad.addColorStop(0, '#444');
                grad.addColorStop(0.6, '#222');
                grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.5, '#eee');
                grad.addColorStop(1, '#aaa');
            }
            c2.beginPath();
            c2.arc(x, y, radius, 0, 2 * Math.PI);
            c2.fillStyle = grad;
            c2.fill();
        }

        /** 共享绘制需要的尺寸/画法：子棋类没给就按顶格棋盘的常规值补上 */
        function applyViewDefaults() {
            const cs = VIEW.cellSize || 12;
            const r = VIEW.stoneRadius != null ? VIEW.stoneRadius : cs * 0.44;
            VIEW.stoneRadius = r;
            VIEW.markLen = VIEW.markLen || ((radius) => radius * 0.68);
            VIEW.markBgRadius = VIEW.markBgRadius || ((radius) => radius * 0.68);
            VIEW.markFontPx = VIEW.markFontPx || ((radius, ch) => radius * (ch === '🚩' ? 1.36 : 1.5));
            VIEW.numberFontPx = VIEW.numberFontPx || ((radius, len) => cs * (len >= 3 ? 0.28 : 0.36));
            VIEW.stoneDotFactor = VIEW.stoneDotFactor != null ? VIEW.stoneDotFactor : 0.15;
            // 形势判断/数点的小方块边长系数（× 棋子半径）：顶点类沿用 0.2×格距，网格类 0.4×棋子半径
            VIEW.estimateMarkScale = VIEW.estimateMarkScale != null ? VIEW.estimateMarkScale : 0.2 / 0.44;
            VIEW.drawStone = VIEW.drawStone || defaultDrawStone;
            VIEW.hoverAlpha = VIEW.hoverAlpha != null ? VIEW.hoverAlpha : 0.45;
        }

        function buildView() {
            floretGridLayer = null;   // 换棋盘后格线静态层失效
            cairoGridLayer = null;
            snubGridLayer = null;
            const mod = GEOMETRY[SUB];
            VIEW = mod.build(LANES);
            VIEW.pick = mod.pick;
            VIEW.drawSkeleton = mod.drawSkeleton;
            applyViewDefaults();
            refreshKomiInfo();
        }

        /** 贴目条文案（按当前子棋类） */
        function refreshKomiInfo() {
            QiWeiqiSquarePageRuntime.writeKomiInfoText(document.getElementById('komiInfo'), VIEW.komi, VIEW.totalPoints);
        }

        /** 协议里的掩码二维盘 board[行][列]（-1 无效点）→ 一维点数组 */
        function boardFromWire(wire) {
            const flat = Array(VIEW.vertexCount).fill(0);
            if (!Array.isArray(wire)) return flat;
            for (let r = 0; r < wire.length; r++) {
                const line = wire[r];
                if (!Array.isArray(line)) continue;
                for (let c = 0; c < line.length; c++) {
                    const i = VIEW.indexOf(r, c);
                    if (i >= 0) flat[i] = line[c];
                }
            }
            return flat;
        }

        /** 协议二维盘的行数/列数：几何提供，缺省按坐标表推算 */
        function wireRows() {
            if (VIEW.geo && VIEW.geo.gridW) return VIEW.geo.gridW;
            let maxR = 0;
            for (const rc of VIEW.koordOf) if (rc[0] > maxR) maxR = rc[0];
            return maxR + 1;
        }
        function wireCols() {
            if (VIEW.geo && VIEW.geo.gridH) return VIEW.geo.gridH;
            let maxC = 0;
            for (const rc of VIEW.koordOf) if (rc[1] > maxC) maxC = rc[1];
            return maxC + 1;
        }

        /** 一维点数组 → 掩码二维盘（编辑盘面提交用；无效点写 -1） */
        function wireBoard(flat) {
            const rows = Array.from({ length: wireRows() }, () => new Array(wireCols()).fill(-1));
            for (let i = 0; i < VIEW.vertexCount; i++) {
                const rc = VIEW.koordOf[i];
                rows[rc[0]][rc[1]] = flat[i];
            }
            return rows;
        }

        /** 协议里的着手列表 [{row,col}] → 内部 [{vertex}] */
        function wireMoveCoordsToVertices(list) {
            return (list || []).map((m) => {
                if (m == null || m.type !== 'move' || m.row == null) return Object.assign({}, m);
                return { type: 'move', player: m.player, vertex: VIEW.indexOf(m.row, m.col) };
            });
        }

        /** 协议里的最近一手标记 [{row,col,color}] → 内部 [{vertex,color}] */
        function markersFromWire(list) {
            return (list || []).map((m) => {
                if (m == null) return null;
                if (m.vertex != null) return { vertex: m.vertex, color: m.color };
                const v = VIEW.indexOf(m.row, m.col);
                return v < 0 ? null : { vertex: v, color: m.color };
            }).filter(Boolean);
        }

        buildView();

// ======================== 房间参数 ========================

// ======================== 游戏状态 ========================
        let board = Array(VIEW.vertexCount).fill(0);
        let numberOfHands = 1;
        let currentPlayer = 1;
        let mySlot = null;               // 'player1' or 'player2'
        let gameOver = false;
        let winner = null;
        let lastMoveMarkers = [];
        let showEstimateActive = false;
        let cachedLiveBoard = null;
        let cachedTerritory = null;
        let waitingScoreConfirm = false;
        let iRejected = false;

        let ws;
        let isMyTurn = false;
        let slots = { player1: false, player2: false };
        let matchStarted = false;
        let matchStartedOnce = false;
        let matchTime = null;
        let reconnectTimer = null;

        let replayMode = false;
        let replayBoards = [];
        let replayMarkers = [];
        let replayStepPlayers = [];
        let replayStep = 0;
        let replayTotalSteps = 0;

        let showMoveNumbers = false;
        let moveLog = [];
        let moveCoordsFull = [];

        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBasePlayer = 1;
        let tryPlayBoards = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 1;
        let tryPlayStep = 0;
        let tryPlayTotalSteps = 0;
        let tryPlayFromLive = false;
        let tryPlayFromLiveStep = null;

        let liveReplayBoards = [];
        let liveReplayMarkers = [];
        let liveReplayStepPlayers = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;

        /** 本地标记：键为顶点索引字符串 "0".."VIEW.vertexCount-1" */
        let userBoardMarks = Object.create(null);
        let userStoneMarks = Object.create(null);   // 子层：棋子上的标记
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks, userStoneMarks);
        const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        // DOM
        const canvas = document.getElementById('goBoard');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 600 * dpr;
        canvas.height = 600 * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const komiInfo = document.getElementById('komiInfo');
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
        const scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        let hoverVertex = -1;
        let isHoverValid = false;
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        function mobileTwoStepPlacing() {
            return !isMouseDevice && !!VIEW.twoStepPlacing;
        }
        function clearMobileMovePreview() {
            hoverVertex = -1;
            isHoverValid = false;
        }

        // ======================== 工具函数 ========================
        function formatScore(num) {
            let str = num.toFixed(2);
            return str.replace(/\.?0+$/, '');
        }

        function isUserBoardMarkVisibleAtVertex(v) {
            if (showEstimateActive) return false;
            if (v < 0 || v >= VIEW.vertexCount) return false;
            if (board[v] !== 0) return false;
            return true;
        }

        function deepCopyBoard(src) { return src.slice(); }

        // 气计算
        function hasLiberty(boardState, start, visited = null) {
            const color = boardState[start];
            if (color === 0) return false;
            const queue = [start];
            const visitedLocal = visited || new Array(VIEW.vertexCount).fill(false);
            visitedLocal[start] = true;
            let idx = 0;
            while (idx < queue.length) {
                const v = queue[idx++];
                for (let nb of VIEW.neighbors[v]) {
                    if (boardState[nb] === 0) return true;
                    if (boardState[nb] === color && !visitedLocal[nb]) {
                        visitedLocal[nb] = true;
                        queue.push(nb);
                    }
                }
            }
            return false;
        }

        function removeGroup(boardState, start) {
            const color = boardState[start];
            if (color === 0) return;
            const queue = [start];
            boardState[start] = 0;
            let idx = 0;
            while (idx < queue.length) {
                const v = queue[idx++];
                for (let nb of VIEW.neighbors[v]) {
                    if (boardState[nb] === color) {
                        boardState[nb] = 0;
                        queue.push(nb);
                    }
                }
            }
        }

        function tryPlaceStone(boardBefore, vertex, playerVal) {
            if (boardBefore[vertex] !== 0) return null;
            let newBoard = deepCopyBoard(boardBefore);
            newBoard[vertex] = playerVal;

            // 移除对方无气棋子
            for (let v = 0; v < VIEW.vertexCount; v++) {
                if (newBoard[v] === 3 - playerVal && !hasLiberty(newBoard, v)) {
                    removeGroup(newBoard, v);
                }
            }

            // 允许自杀：己方无气则提掉己方块
            if (!hasLiberty(newBoard, vertex)) removeGroup(newBoard, vertex);
            return newBoard;
        }

        // 形势判断函数（复用原代码中的）
        function isLibertySurroundedByOpponent(boardState, libertyVertex, opponentColor) {
            for (let nb of VIEW.neighbors[libertyVertex]) {
                if (boardState[nb] === opponentColor) return true;
            }
            return false;
        }

        function removeDeadAndDying(srcBoard) {
            let newBoard = deepCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                let visited = new Array(VIEW.vertexCount).fill(false);
                for (let v = 0; v < VIEW.vertexCount; v++) {
                    if (newBoard[v] !== 0 && !visited[v]) {
                        let color = newBoard[v];
                        let queue = [v];
                        visited[v] = true;
                        let stones = [v];
                        let liberties = new Set();
                        let idx = 0;
                        while (idx < queue.length) {
                            let cur = queue[idx++];
                            for (let nb of VIEW.neighbors[cur]) {
                                if (newBoard[nb] === 0) liberties.add(nb);
                                else if (newBoard[nb] === color && !visited[nb]) {
                                    visited[nb] = true;
                                    queue.push(nb);
                                    stones.push(nb);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (let s of stones) newBoard[s] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= 2) {
                            let allControlled = true;
                            for (let lib of liberties) {
                                if (!isLibertySurroundedByOpponent(newBoard, lib, 3 - color)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (let s of stones) newBoard[s] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
            return newBoard;
        }

        /**
         * 领地归属（与后端 gridGraphWeiqiRules.assignTerritoryWithRange 同一套算法）：
         * 每个空点只在其 maxDist 步内找最近的黑/白子——靠边的行/列给 5 步、其余 4 步；
         * 双方都超出范围就该点算公共（3），不会「无论多远都按最近的子归属」。
         */
        function assignTerritory(liveBoard) {
            const rows = wireRows(), cols = wireCols();
            const territory = new Array(VIEW.vertexCount).fill(0);
            const dist = new Array(VIEW.vertexCount).fill(-1);
            const queue = new Array(VIEW.vertexCount);
            for (let start = 0; start < VIEW.vertexCount; start++) {
                if (liveBoard[start] !== 0) continue;
                const rc = VIEW.koordOf[start];
                const maxDist = (rc[0] <= 1 || rc[0] >= rows - 2 || rc[1] <= 1 || rc[1] >= cols - 2) ? 5 : 4;
                let blackMin = Infinity, whiteMin = Infinity;
                let head = 0, tail = 0;
                dist.fill(-1);
                dist[start] = 0;
                queue[tail++] = start;
                while (head < tail) {
                    const cur = queue[head++];
                    const d = dist[cur];
                    if (d > maxDist) continue;
                    const val = liveBoard[cur];
                    if (val === 1 && d < blackMin) blackMin = d;
                    else if (val === 2 && d < whiteMin) whiteMin = d;
                    for (const nb of VIEW.neighbors[cur]) {
                        if (dist[nb] === -1) { dist[nb] = d + 1; queue[tail++] = nb; }
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[start] = 1;
                    else if (whiteMin < blackMin) territory[start] = 2;
                    else territory[start] = 3;
                } else if (blackMin <= maxDist) territory[start] = 1;
                else if (whiteMin <= maxDist) territory[start] = 2;
                else territory[start] = 3;
            }
            return territory;
        }

        function computeScore(liveBoard, territory) {
            let blackStones = 0, whiteStones = 0;
            let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let v = 0; v < VIEW.vertexCount; v++) {
                if (liveBoard[v] === 1) blackStones++;
                else if (liveBoard[v] === 2) whiteStones++;
                else {
                    if (territory[v] === 1) blackTerritory++;
                    else if (territory[v] === 2) whiteTerritory++;
                    else if (territory[v] === 3) publicTerritory++;
                }
            }
            let blackTotal = blackStones + blackTerritory + publicTerritory / 2;
            let whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
            return { blackTotal, whiteTotal };
        }

        // Benson 加成（顶点图棋盘：沿用本棋种邻接）
        function bensonInfoVertex(bd) {
            return window.QiWeiqiSquarePageRuntime.bensonAliveGraph({
                n: VIEW.vertexCount,
                neighbors: (i) => VIEW.neighbors[i] || [],
                get: (i) => bd[i]
            });
        }
        function bensonRemoveDeadVertex(srcBoard) {
            const benson = bensonInfoVertex(srcBoard);
            let live = srcBoard.slice();
            let changed = true;
            while (changed) {
                changed = false;
                const cleaned = removeDeadAndDying(live);
                for (let i = 0; i < VIEW.vertexCount; i++) {
                    const v = srcBoard[i];
                    if (benson.alive[i] && (v === 1 || v === 2) && cleaned[i] !== v) {
                        cleaned[i] = v;
                        changed = true;
                    }
                }
                live = cleaned;
            }
            return live;
        }
        function bensonTerritoryVertex(liveBoard) {
            const territory = assignTerritory(liveBoard);
            const secure = bensonInfoVertex(liveBoard);
            for (let i = 0; i < VIEW.vertexCount; i++) {
                if (liveBoard[i] === 0 && secure.territory[i]) territory[i] = secure.territory[i];
            }
            return territory;
        }

        function computeScoreFromBoard(srcBoard) {
            let liveBoard = bensonRemoveDeadVertex(srcBoard);
            let territory = bensonTerritoryVertex(liveBoard);
            return computeScore(liveBoard, territory);
        }

        function computeLead() {
            let { blackTotal, whiteTotal } = computeScoreFromBoard(board);
            return blackTotal - whiteTotal - 2 * VIEW.komi;
        }

        function computeStoneNumbers() {
            const nums = new Array(VIEW.vertexCount).fill(0);
            if (replayMode && tryPlayMode) {
                for (let i = 1; i <= tryPlayStep; i++) {
                    const markers = tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.vertex !== undefined && board[m.vertex] !== 0)
                            nums[m.vertex] = i;
                    }
                }
            } else if (replayMode) {
                for (let i = 1; i <= replayStep; i++) {
                    const markers = replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.vertex !== undefined && board[m.vertex] !== 0)
                            nums[m.vertex] = i;
                    }
                }
            } else if (liveReplayBoards.length && liveViewStep < liveReplayBoards.length - 1) {
                for (let i = 1; i <= liveViewStep; i++) {
                    const markers = liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.vertex !== undefined && board[m.vertex] !== 0)
                            nums[m.vertex] = i;
                    }
                }
            } else {
                for (let i = 0; i < moveLog.length; i++) {
                    const m = moveLog[i];
                    if (m && m.vertex !== undefined && board[m.vertex] !== 0)
                        nums[m.vertex] = i + 1;
                }
            }
            return nums;
        }

        // ======================== 绘制函数 ========================
        function drawRoundedHexagon(ctx, vertices, radius, skipStroke) {
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
            ctx.beginPath();
            ctx.moveTo(startPoints[0].x, startPoints[0].y);
            for (let i = 0; i < 6; i++) {
                ctx.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                if (i < 5) ctx.lineTo(startPoints[i + 1].x, startPoints[i + 1].y);
            }
            ctx.lineTo(startPoints[0].x, startPoints[0].y);
            ctx.closePath();
            ctx.fill();
            if (!skipStroke) ctx.stroke();
        }

        function drawEstimateOverlay(liveBoard, territory) {
            const markSize = VIEW.stoneRadius * VIEW.estimateMarkScale;
            for (let v = 0; v < VIEW.vertexCount; v++) {
                if (board[v] !== 0 && liveBoard[v] === 0) {
                    let { x, y } = VIEW.pos[v];
                    ctx.fillStyle = board[v] === 1 ? '#ffffff' : '#222222';
                    ctx.fillRect(x - markSize, y - markSize, markSize * 2, markSize * 2);
                }
            }
            for (let v = 0; v < VIEW.vertexCount; v++) {
                if (board[v] !== 0) continue;
                let owner = territory[v];
                if (owner === 0 || owner === 3) continue;
                ctx.fillStyle = owner === 1 ? '#222' : '#f0f0f0';
                let { x, y } = VIEW.pos[v];
                ctx.fillRect(x - markSize, y - markSize, markSize * 2, markSize * 2);
            }
        }

        function drawBoard() {
            ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            // 木框、格线、坐标标签由各子棋类的几何模块画；棋子/标记/手数/形势判断由下面共享逻辑画
            VIEW.drawSkeleton(ctx, VIEW);

            const stoneRadius = VIEW.stoneRadius;
            const markSize = VIEW.markLen(stoneRadius);
            const lowerLastMoveMarker = showMoveNumbers || showEstimateActive;
            if (lowerLastMoveMarker) {
                for (let { vertex, color } of lastMoveMarkers) {
                    if (vertex === undefined) continue;
                    const { x, y } = VIEW.pos[vertex];
                    ctx.beginPath();
                    ctx.moveTo(x + stoneRadius, y + stoneRadius);
                    ctx.lineTo(x, y + stoneRadius);
                    ctx.lineTo(x + stoneRadius, y);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.fill();
                }
            }

            for (let v = 0; v < VIEW.vertexCount; v++) {
                if (board[v] === 0) continue;
                const radius = stoneRadius;
                const { x, y } = VIEW.pos[v];
                ctx.shadowBlur = 6;
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowOffsetY = 2;
                VIEW.drawStone(ctx, x, y, radius, board[v]);
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                if (!showMoveNumbers) {
                    ctx.beginPath();
                    ctx.arc(x - 3, y - 3, radius * VIEW.stoneDotFactor, 0, 2 * Math.PI);
                    ctx.fillStyle = board[v] === 1 ? '#444' : '#fff';
                    ctx.fill();
                }
            }
            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let v = 0; v < VIEW.vertexCount; v++) {
                    if (nums[v] > 0 && board[v] !== 0) {
                        const { x, y } = VIEW.pos[v];
                        const numStr = nums[v].toString();
                        const fontSize = Math.max(8, Math.floor(VIEW.numberFontPx(stoneRadius, numStr.length)));
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.fillStyle = board[v] === 1 ? '#fff' : '#000';
                        ctx.fillText(numStr, x, y + 1);
                    }
                }
            }
            if (!lowerLastMoveMarker) {
                for (let { vertex, color } of lastMoveMarkers) {
                    if (vertex === undefined) continue;
                    const { x, y } = VIEW.pos[vertex];
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + markSize, y);
                    ctx.lineTo(x, y + markSize);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.fill();
                }
            }
            for (const key of Object.keys(userBoardMarks)) {
                const v = parseInt(key, 10);
                if (Number.isNaN(v) || !isUserBoardMarkVisibleAtVertex(v)) continue;
                if (QiSquareWeiqiCanvas.isStoneCellValue(board[v])) continue;   // 被棋子盖住：保留不画
                const ch = userBoardMarks[key];
                const { x, y } = VIEW.pos[v];
                QiSquareWeiqiCanvas.draw.boardMarkGap(ctx, x, y, stoneRadius * 2.27);   // 留白：半径=0.68×棋子半径（0.3×2.27）
                const fontPx = VIEW.markFontPx(stoneRadius, ch);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }
            if (userStoneMarks && !replayMode && !tryPlayMode && !showEstimateActive) {
                for (const key of Object.keys(userStoneMarks)) {
                    const v = parseInt(key, 10);
                    if (Number.isNaN(v) || v < 0 || v >= VIEW.vertexCount) continue;
                    const sv = board[v];
                    if (!QiSquareWeiqiCanvas.isStoneCellValue(sv)) continue;
                    const { x, y } = VIEW.pos[v];
                    QiSquareWeiqiCanvas.draw.boardMarkGlyph(ctx, x, y, stoneRadius * 2.27, userStoneMarks[key], sv === 2 ? 'dark' : 'light');
                }
            }
            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            const editing = !!(editCb && editCb.checked);
            const canHover = editing || tryPlayMode || (!gameOver && isMyTurn);
            if ((isMouseDevice || mobileTwoStepPlacing()) && canHover && isHoverValid && hoverVertex >= 0 && (editing || board[hoverVertex] === 0)) {
                let hoverColor = null;
                if (editing) {
                    const t = (editSel && editSel.value) || 'empty';
                    if (t === 'white') hoverColor = '#fff';
                    else if (t === 'black') hoverColor = '#222';
                    else if (t !== 'empty') hoverColor = '#666';
                } else if (tryPlayMode) hoverColor = tryPlayCurrentPlayer === 1 ? '#222' : '#fff';
                else hoverColor = mySlot === 'player1' ? '#222' : '#fff';
                if (hoverColor) {
                    const { x, y } = VIEW.pos[hoverVertex];
                    ctx.globalAlpha = VIEW.hoverAlpha;
                    ctx.beginPath();
                    // 悬停预览与棋子同径（三角五子棋/围棋一致）
                    ctx.arc(x, y, stoneRadius, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }
            if (showEstimateActive && cachedLiveBoard && cachedTerritory) {
                drawEstimateOverlay(cachedLiveBoard, cachedTerritory);
            }
        }

        function drawBoardWithOverlay() {
            drawBoard();
        }

        function showEstimate()
        {
            if (!showEstimateActive) { clearEstimate(); return; }
            cachedLiveBoard = bensonRemoveDeadVertex(board);
            cachedTerritory = bensonTerritoryVertex(cachedLiveBoard);
            let { blackTotal, whiteTotal } = computeScore(cachedLiveBoard, cachedTerritory);
            let lead = blackTotal - whiteTotal - 2 * VIEW.komi;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${formatScore(blackTotal)} | 白: ${formatScore(whiteTotal)}`;
            leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${formatScore(lead)}点`;
            drawBoardWithOverlay();
        }

        function clearEstimate()
        {
            showEstimateActive = false;   // 关形势判断：标志与缓存一起清，避免下次状态同步又算回来
            cachedLiveBoard = null;
            cachedTerritory = null;
            scoreTitle.innerText = '　';
            scoreBoard.innerText = '　';
            leadInfo.innerText = '　';
            drawBoardWithOverlay();
        }

        function updateTurn()
        {
            if (replayMode) {
                isMyTurn = false;
                if (showEstimateActive) showEstimate();
                else drawBoardWithOverlay();
                return;
            }
            const liveTotal = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            const browsingLive = liveReplayBoards.length > 0 && liveViewStep < liveTotal;
            if (browsingLive) {
                if (liveViewStep === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = liveReplayStepPlayers[liveViewStep] === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${liveViewStep}手`;
                }
                isMyTurn = false;
                if (showEstimateActive) showEstimate();
                else drawBoardWithOverlay();
                return;
            }
            if (gameOver) {
                turnDisplay.innerText = '对局结束';
                if (winner === 'player1') scoreTitle.innerText = '黑胜';
                else if (winner === 'player2') scoreTitle.innerText = '白胜';
                else if (winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoardWithOverlay();
                return;
            }
            if (tryPlayMode) {
                if (showEstimateActive) showEstimate();
                else drawBoardWithOverlay();
                return;
            }
            if (matchStartedOnce === undefined) matchStartedOnce = false;
            if (matchStarted) matchStartedOnce = true;
            const bothSelected = !!(slots && slots.player1 && slots.player2);
            const hasStoneOnBoard = board.some(v => v !== 0);
            const matchReady = !!(matchStarted || matchStartedOnce);
            if (bothSelected && matchReady) matchStartedOnce = true;
            if (numberOfHands > 1 || hasStoneOnBoard) matchStartedOnce = true;
            if (!matchStarted) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                isMyTurn = false;
                if (showEstimateActive) showEstimate();
                else drawBoardWithOverlay();
                return;
            }
            const total = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            if (liveReplayBoards.length === 0) {
                const n = moveCoordsFull.length;
                if (n === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const lastPl = moveCoordsFull[n - 1].player === 'player1' ? 1 : 2;
                    turnDisplay.innerText = `${lastPl === 1 ? '⚫' : '⚪'} 第${n}手`;
                }
            } else if (total === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const p = liveReplayStepPlayers[total];
                turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            isMyTurn = !!(matchStarted && (mySlot !== null)
                && ((mySlot === 'player1' && currentPlayer === 1) || (mySlot === 'player2' && currentPlayer === 2)));
            if (showEstimateActive) showEstimate();
            else drawBoardWithOverlay();
        }

        function showScoreConfirm(lead) {
            QiSquareWeiqiCanvas.fillScoreConfirmText(scoreConfirmText, lead);
            scoreConfirmPanel.style.display = 'block';
        }

        function hideScoreConfirm() {
            scoreConfirmPanel.style.display = 'none';
        }

        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordPrefix());
        }

        function enterReplayMode(data) {
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [0];

            let curBoard = Array(VIEW.vertexCount).fill(0);
            if (data.initialPosition) {
                if (Array.isArray(data.initialPosition)) {
                    for (const s of data.initialPosition) {
                        if (typeof s !== 'string' || s.length < 2) continue;
                        const p = s[0];
                        if (p !== 'B' && p !== 'W') continue;
                        const mm = /^(d+),(d+)$/.exec(s.slice(1));
                        if (!mm) continue;
                        const vi = VIEW.indexOf(Number(mm[1]), Number(mm[2]));
                        if (vi < 0 || vi >= VIEW.vertexCount) continue;
                        curBoard[vi] = p === 'B' ? 1 : 2;
                    }
                } else if (Array.isArray(data.initialPosition.black)) {
                    for (const pos of data.initialPosition.black) {
                        const vi = typeof pos === 'number' ? pos : pos[0];
                        if (vi >= 0 && vi < VIEW.vertexCount) curBoard[vi] = 1;
                    }
                }
                if (Array.isArray(data.initialPosition.white)) {
                    for (const pos of data.initialPosition.white) {
                        const vi = typeof pos === 'number' ? pos : pos[0];
                        if (vi >= 0 && vi < VIEW.vertexCount) curBoard[vi] = 2;
                    }
                }
            }
            replayBoards.push(deepCopyBoard(curBoard));
            replayMarkers.push([]);

            for (const move of wireMoveCoordsToVertices(data.moves)) {
                const playerVal = move.player === 'player1' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.vertex, playerVal);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([{ vertex: move.vertex, color: playerVal }]);
                } else if (move.type === 'pass') {
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([]);
                }
            }

            replayTotalSteps = replayBoards.length - 1;
            replayMode = true;

            const slider = document.getElementById('replaySlider');
            slider.max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
        }

        function exitReplayMode() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            replayMode = false;
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [];
            replayStep = 0;
            replayTotalSteps = 0;
            updateReplayUI();
        }

        function setReplayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > replayTotalSteps) step = replayTotalSteps;
            replayStep = step;
            board = deepCopyBoard(replayBoards[step]);
            lastMoveMarkers = replayMarkers[step].map(m => ({ ...m }));

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;

            if (step === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const emoji = replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 第${step}手`;
            }
            isMyTurn = false;

            if (showEstimateActive) showEstimate();
            else drawBoardWithOverlay();
        }

        function updateReplayUI() {
            const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!mySlot;
            const started = !!(matchStarted || (matchTime && matchTime.settings));
            const showMatchButtons = isPlayer && started && !replayMode;
            for (const id of gameButtonIds)
                document.getElementById(id).style.display = showMatchButtons ? '' : 'none';
            replayPanel.style.display = '';
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
            updateRecordButtons();
        }

        function enterTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [lastMoveMarkers.map(m => ({ ...m }))];

            const _fromLive = !replayMode;
            const _RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
            const _startPlayer = _RT && _RT.resolveTryPlaySideToMove
                ? _RT.resolveTryPlaySideToMove({
                    fromLive: _fromLive,
                    replayStep,
                    replayStepPlayers,
                    liveViewStep,
                    liveReplayStepPlayers,
                    liveReplayBoardsLength: (liveReplayBoards && liveReplayBoards.length) || 0,
                    currentPlayer
                })
                : (replayStep > 0 ? (3 - replayStepPlayers[replayStep]) : ((currentPlayer === 1 || currentPlayer === 2) ? currentPlayer : 1));
            tryPlayBasePlayer = _startPlayer;
            tryPlayCurrentPlayer = _startPlayer;
            // 与公共 enterTryPlay 一致：从直播局面进入试下时挂 replayMode 脚手架。
            // 点击/绘制均以 replayMode && tryPlayMode 判断，缺了它试下点击无反应
            if (_fromLive) {
                tryPlayFromLive = true;
                tryPlayFromLiveStep = liveViewStep || 0;
                replayMode = true;
                replayBoards = [deepCopyBoard(board)];
                replayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
                replayStepPlayers = [tryPlayCurrentPlayer === 1 ? 2 : 1];
                replayStep = 0;
                replayTotalSteps = 0;
            } else {
                tryPlayFromLive = false;
            }
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
        }

        function exitTryPlay() {
            if (!tryPlayMode) return;   // 不在试下状态时不动任何局面（公共层开新局也会调用它）
            clearMobileMovePreview();
            // 与公共 exitTryPlay 一致：从直播进入试下的要退回直播局面，而不是走打谱 setReplayStep
            const fromLive = !!tryPlayFromLive;
            const savedLiveStep = tryPlayFromLiveStep != null ? tryPlayFromLiveStep : liveViewStep;
            const snapBoard = fromLive && tryPlayBoards.length > 0 ? deepCopyBoard(tryPlayBoards[0]) : null;
            const snapMarkers = fromLive && tryPlayMarkers.length > 0 && tryPlayMarkers[0]
                ? tryPlayMarkers[0].map(m => ({ ...m }))
                : [];
            tryPlayMode = false;
            tryPlayFromLive = false;
            tryPlayFromLiveStep = null;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            if (fromLive) {
                replayMode = false;
                replayBoards = [];
                replayMarkers = [];
                replayStepPlayers = [];
                replayStep = 0;
                replayTotalSteps = 0;
                if (snapBoard) {
                    board = snapBoard;
                    lastMoveMarkers = snapMarkers;
                    if (liveReplayBoards.length > 0) {
                        const step = Math.min(Math.max(0, savedLiveStep), liveReplayBoards.length - 1);
                        liveReplayBoards[step] = deepCopyBoard(snapBoard);
                        if (!liveReplayMarkers[step]) liveReplayMarkers[step] = [];
                        liveReplayMarkers[step] = snapMarkers.map(m => ({ ...m }));
                        liveViewStep = step;
                    } else {
                        liveReplayBoards = [deepCopyBoard(snapBoard)];
                        liveReplayMarkers = [snapMarkers.map(m => ({ ...m }))];
                        liveReplayStepPlayers = [0];
                        liveViewStep = 0;
                    }
                } else {
                    applyLiveViewBoard();
                }
                updateLiveReplayPanelUI();
                updateTurn();
            } else {
                slider.max = replayTotalSteps;
                setReplayStep(tryPlayBaseStep);
            }
            updateReplayUI();
        }

        function tryPlayMove(vertex) {
            if (board[vertex] !== 0) return false;
            const playerVal = tryPlayCurrentPlayer;
            const newBoard = tryPlaceStone(board, vertex, playerVal);
            if (!newBoard) return false;

            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
            }

            tryPlayBoards.push(deepCopyBoard(newBoard));
            tryPlayMarkers.push([{ vertex, color: playerVal }]);
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = 3 - tryPlayCurrentPlayer;

            board = deepCopyBoard(newBoard);
            lastMoveMarkers = [{ vertex, color: playerVal }];

            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            if (showEstimateActive) showEstimate();
            else drawBoardWithOverlay();
            return true;
        }

        /** 试下：虚着一手（棋盘不变、本步无落子标记），供公共的「虚着」按钮调用 */
        function tryPlayPass() {
            if (!tryPlayMode) return false;
            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
            }

            tryPlayBoards.push(deepCopyBoard(board));
            tryPlayMarkers.push([]);
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = 3 - tryPlayCurrentPlayer;

            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            if (showEstimateActive) showEstimate();
            else drawBoardWithOverlay();
            return true;
        }

        function setTryPlayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > tryPlayTotalSteps) step = tryPlayTotalSteps;
            tryPlayStep = step;
            board = deepCopyBoard(tryPlayBoards[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));

            const basePlayer = (tryPlayBasePlayer === 1 || tryPlayBasePlayer === 2)
                ? tryPlayBasePlayer
                : (tryPlayBaseStep === 0 ? 1 : (3 - replayStepPlayers[tryPlayBaseStep]));
            tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);

            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            if (showEstimateActive) showEstimate();
            else drawBoardWithOverlay();
        }

        function updateTryPlayDisplay() {
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (tryPlayMode) {
                stepDisplay.innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
                const emoji = tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
            }
        }

        function rebuildLiveReplayFromMoveCoords(moveCoords, openingBoard) {
            liveReplayBoards = [];
            liveReplayMarkers = [];
            liveReplayStepPlayers = [0];
            let curBoard = (openingBoard && openingBoard.length === VIEW.vertexCount) ? deepCopyBoard(openingBoard) : Array(VIEW.vertexCount).fill(0);
            liveReplayBoards.push(deepCopyBoard(curBoard));
            liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'player1' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.vertex, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ vertex: move.vertex, color: playerVal }]);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
            }
        }
 
        function applyLiveReplayIncremental(moveCoords) {
            const startLen = liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            let curBoard = deepCopyBoard(liveReplayBoards[liveReplayBoards.length - 1]);
            for (let i = startLen; i < mcs.length; i++) {
                const move = mcs[i];

                const playerVal = move.player === 'player1' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.vertex, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ vertex: move.vertex, color: playerVal }]);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
                else { return false; }
            }
            return true;
        }

        function syncLiveReplayFromState(state) {
            const mcs = wireMoveCoordsToVertices(state.moveCoords);
            const syncedLen = liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncremental(mcs)) return;
            }
            rebuildLiveReplayFromMoveCoords(mcs, Array.isArray(state.initialBoard) && Array.isArray(state.initialBoard[0]) ? boardFromWire(state.initialBoard) : state.initialBoard);
        }

        function applyLiveViewBoard() {
            if (!liveReplayBoards.length) {
                board = Array(VIEW.vertexCount).fill(0);
                lastMoveMarkers = [];
                return;
            }
            if (liveViewStep < 0) liveViewStep = 0;
            if (liveViewStep >= liveReplayBoards.length) liveViewStep = liveReplayBoards.length - 1;
            board = deepCopyBoard(liveReplayBoards[liveViewStep]);
            lastMoveMarkers = liveReplayMarkers[liveViewStep].map(m => ({ ...m }));
        }

        function updateLiveReplayPanelUI() {
            if (replayMode) return;
            const total = Math.max(0, liveReplayBoards.length - 1);
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = total;
            slider.value = liveViewStep;
            document.getElementById('replayStepDisplay').innerText = `${liveViewStep} / ${total}`;
        }

        function setLiveViewStep(step) {
            clearMobileMovePreview();
            if (replayMode) return;
            const total = Math.max(0, liveReplayBoards.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            liveViewStep = step;
            liveFollowLatest = step >= total;
            applyLiveViewBoard();
            updateLiveReplayPanelUI();
            if (showEstimateActive) showEstimate();
            else updateTurn();
        }

        let updateRecordButtons = () => {};

        // ======================== WebSocket ========================

        function connectWebSocket() {
            ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                onMessage: handleMessage,
                colorStatus: document.getElementById('colorStatus') || colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (typeof reconnectTimer !== 'undefined' && reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => reconnectTimer,
                setReconnectTimer: (id) => {
                    reconnectTimer = id;
                }
            });
        }



        function syncState(state)
        {
            clearMobileMovePreview();
            // 子棋类与路数都可能被服务端改（观战者切子棋类 / 改路数）：先按 state 校正，再同步局面
            const incomingSub = (state.subGameId && SUB_META[state.subGameId]) ? state.subGameId : null;
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const subChanged = !!incomingSub && incomingSub !== SUB;
            const sizeChanged = Number.isFinite(incomingSize) && incomingSize !== LANES;
            if (subChanged || sizeChanged) {
                if (subChanged) {
                    // 别人切了子棋类（或自己切的回声）：同样按开新局处理
                    exitTryPlay();
                    exitReplayMode();
                    clearEstimate();
                    SUB = incomingSub;
                }
                LANES = Number.isFinite(incomingSize) ? incomingSize : rememberedOrDef(SUB);
                syncSubGameSelect();
                rebuildSizeSelect();
                buildView();
                applySubShellChrome();
            }
            numberOfHands = state.numberOfHands || 1;
            currentPlayer = state.currentPlayer;
            gameOver = state.gameOver || false;
            winner = state.winner || null;
            if (state.matchStarted !== undefined) {
                matchStarted = !!state.matchStarted;
                if (matchStarted) matchStartedOnce = true;
                else if ((state.numberOfHands || 1) <= 1) matchStartedOnce = false;
            }
            if (state.moveCoords !== undefined) {
                moveCoordsFull = wireMoveCoordsToVertices(state.moveCoords);
                moveLog = moveCoordsFull.map(m => m.type === 'move' ? { vertex: m.vertex } : null);
            }
            if (state.slots)
                slots = state.slots;

            if (!replayMode) {
                const prevTotal = Math.max(0, liveReplayBoards.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                syncLiveReplayFromState(state);
                const newTotal = Math.max(0, liveReplayBoards.length - 1);
                if (newTotal === 0) {
                    liveViewStep = 0;
                    liveFollowLatest = true;
                } else if (wasAtEnd) {
                    liveViewStep = newTotal;
                    liveFollowLatest = true;
                } else {
                    liveViewStep = Math.min(liveViewStep, newTotal);
                    if (liveViewStep === newTotal)
                        liveFollowLatest = true;
                }
                if (!tryPlayMode) {
                    applyLiveViewBoard();
                    updateLiveReplayPanelUI();
                }
            } else if (!tryPlayMode) {
                board = boardFromWire(state.board);
                lastMoveMarkers = markersFromWire(state.lastMoveMarkers);
            }

            const hasAnyStone = board.some(v => v !== 0);
            const hasPlayer = slots.player1 || slots.player2;
            const sizeSelect = document.getElementById('boardSizeSelect');
            window.QiRoomGameSwitcher.syncSettingsSelect(sizeSelect);

            if (showEstimateActive) {
                cachedLiveBoard = removeDeadAndDying(board);
                cachedTerritory = assignTerritory(cachedLiveBoard);
            }
            syncSubGameSelect();
            updateTurn();
            updateReplayUI();
        }

        let updateRadioStyles = () => {};
        let handleMessage = () => {};
        function initHexBoardArray() {
            return Array(VIEW.vertexCount).fill(0);
        }
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            // 物理总点数（顶点数）：开局前对局设置的默认时间按总点数推算
            getTotalPoints: () => VIEW.vertexCount,
            recordPointToCanvas: (row, col) => {
                const index = VIEW.indexOf(row, col), p = VIEW.pos[index];
                return p ? { ...p, cell: VIEW.cellSize, size: CANVAS_SIZE } : null;
            },
            recordPointFromClient: (clientX, clientY) => {
                const p = canvasCoordsFromClient(clientX, clientY);
                const index = getNearestVertex(p.x, p.y), coord = VIEW.koordOf[index];
                return coord ? { row: coord[0], col: coord[1] } : null;
            },
            pageState: {
                get mySlot() { return mySlot; },
                set mySlot(v) { mySlot = v; },
                get slots() { return slots; },
                set slots(v) { slots = v; },
                get matchStarted() { return matchStarted; },
                set matchStarted(v) { matchStarted = !!v; if (matchStarted) matchStartedOnce = true; },
                get matchStartedOnce() { return matchStartedOnce; },
                set matchStartedOnce(v) { matchStartedOnce = !!v; },
                get isMyTurn() { return isMyTurn; },
                set isMyTurn(v) { isMyTurn = v; },
                get gameOver() { return gameOver; },
                set gameOver(v) { gameOver = v; },
                get waitingScoreConfirm() { return waitingScoreConfirm; },
                set waitingScoreConfirm(v) { waitingScoreConfirm = v; },
                get showEstimateActive() { return showEstimateActive; },
                set showEstimateActive(v) { showEstimateActive = v; },
                get replayMode() { return replayMode; },
                set replayMode(v) { replayMode = v; },
                get tryPlayMode() { return tryPlayMode; },
                set tryPlayMode(v) { tryPlayMode = v; },
                get tryPlayStep() { return tryPlayStep; },
                set tryPlayStep(v) { tryPlayStep = v; },
                get replayStep() { return replayStep; },
                set replayStep(v) { replayStep = v; },
                get liveViewStep() { return liveViewStep; },
                set liveViewStep(v) { liveViewStep = v; },
                get ws() { return ws; },
                set ws(v) { ws = v; },
                get showMoveNumbers() { return showMoveNumbers; },
                set showMoveNumbers(v) { showMoveNumbers = v; }
            },
            drawBoard: drawBoardWithOverlay,
            exitTryPlay,
            enterTryPlay,
            tryPlayPass,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => LANES,
            setBoardSize: (n) => {
                LANES = n;
                recordSize();
                buildView();
            },
            getKomi: () => VIEW.komi,
            setKomi: () => {},
            // 公共 updateRecordButtons 期望二维数组，这里提供兼容视图即可复用其逻辑。
            getBoard: () => board.map(v => [v]),
            setBoard: (b) => { board = b; },
            getSlots: () => slots,
            setSlots: (s) => { slots = s; },
            getMySlot: () => mySlot,
            setMySlot: (s) => { mySlot = s; },
            getGameOver: () => gameOver,
            setGameOver: (v) => { gameOver = v; },
            getWinner: () => winner,
            setWinner: (w) => { winner = w; },
            getReplayMode: () => replayMode,
            getShowEstimateActive: () => showEstimateActive,
            setShowEstimateActive: (v) => { showEstimateActive = v; },
            getWaitingScoreConfirm: () => waitingScoreConfirm,
            setWaitingScoreConfirm: (v) => { waitingScoreConfirm = v; },
            getIRejected: () => iRejected,
            setIRejected: (v) => { iRejected = v; },
            colorStatus,
            scoreTitle,
            turnDisplay,
komiInfo,
            syncState,
            updateBoardGeometry: drawBoardWithOverlay,
            initBoardArray: initHexBoardArray,
            exitReplayMode,
            clearEstimate,
            hideScoreConfirm,
            showEstimate,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,   // 传给公共 bindings：座位/限时变化时回调它同步按钮显隐
            showScoreConfirm,
            onBoardSizeChanged: (msg) => {
                if (msg.boardSize == null) return;
                const bs = Number(msg.boardSize);
                if (Number.isFinite(bs) && bs !== Number(LANES)) {
                    LANES = bs;
                    recordSize();
                    buildView();
                    rebuildSizeSelect();
                    board = Array(VIEW.vertexCount).fill(0);
                }
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = String(msg.boardSize);
                drawBoardWithOverlay();
            },
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            get seatOverlayShape() { return VIEW.seatOverlayShape || 'square'; }
        });
        handleMessage = _weiqiBindings.handleMessage;
        updateRecordButtons = _weiqiBindings.updateRecordButtons;
        updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMove(vertex) {
            if (gameOver) return false;
            if (!isMyTurn) return false;
            if (board[vertex] !== 0) return false;
            const rc = VIEW.koordOf[vertex];
            if (!rc) return false;
            ws.send(JSON.stringify({ type: 'move', row: rc[0], col: rc[1] }));
            return true;
        }

        /** 木质外框六边形顶点（与 drawBoard 中 outerVerts 一致），用于棋盘内点击判定 */

        /** 点在多边形内判定（ray casting，顶点按 {x,y} 数组） */

        function getNearestVertex(x, y) {
            // 「点到哪一点」由各子棋类的几何模块决定（木框内的最近点等）
            return VIEW.pick(VIEW, x, y);
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = CANVAS_SIZE / rect.width;
            return {
                x: (clientX - rect.left) * scale,
                y: (clientY - rect.top) * scale
            };
        }

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const val = boardMarkSelect.value;
            if (val === '') return { clear: true, ch: '' };
            return { clear: false, ch: val };
        }

        function applyUserBoardMark(vertex) {
            if (vertex < 0 || vertex >= VIEW.vertexCount) return;
            const layer = QiSquareWeiqiCanvas.boardMarkCellKind(board[vertex]) === 'stone' ? 'stone' : 'point';
            const { clear, ch } = getSelectedBoardMark();
            const key = String(vertex);
            if (QiSquareWeiqiCanvas.toggleUserBoardMark(userBoardMarks, userStoneMarks, key, layer, ch, clear, false))
                drawBoardWithOverlay();
        }

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const v = getNearestVertex(x, y);
            applyUserBoardMark(v);
        });

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            longMarkStart = { x: t.clientX, y: t.clientY };
            longMarkTimer = setTimeout(() => {
                longMarkTimer = null;
                if (!longMarkStart) return;
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                const v = getNearestVertex(x, y);
                applyUserBoardMark(v);
                suppressCanvasClickAfterLongMark = true;
                setTimeout(() => { suppressCanvasClickAfterLongMark = false; }, 450);
                longMarkStart = null;
            }, LONG_MARK_MS);
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - longMarkStart.x;
            const dy = t.clientY - longMarkStart.y;
            if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
        }, { passive: true });

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        // 事件绑定
        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const scale = CANVAS_SIZE / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const v = getNearestVertex(x, y);
            if (tryPlayMode && replayMode) {
                if (waitingScoreConfirm) return;
                if (v === -1) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardWithOverlay();
                    return;
                }
                if (board[v] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (hoverVertex === v && isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(v);
                    } else {
                        hoverVertex = v;
                        isHoverValid = true;
                        drawBoardWithOverlay();
                    }
                    return;
                }
                tryPlayMove(v);
                return;
            }
            if (gameOver) return;
            if (!isMyTurn) return;
            if (waitingScoreConfirm) return;
            if (v === -1) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoardWithOverlay();
                return;
            }
            if (board[v] !== 0) return;
            if (mobileTwoStepPlacing()) {
                if (hoverVertex === v && isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(v);
                    drawBoardWithOverlay();
                } else {
                    hoverVertex = v;
                    isHoverValid = true;
                    drawBoardWithOverlay();
                }
                return;
            }
            commitMove(v);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) =>
            {
                if (waitingScoreConfirm) {
                    if (isHoverValid) { isHoverValid = false; hoverVertex = -1; drawBoardWithOverlay(); }
                    return;
                }
                const __editing = !!(document.getElementById('editModeCheckbox') || {}).checked;
                const canHover = __editing || tryPlayMode || (!gameOver && isMyTurn);
                if (!canHover) {
                    if (isHoverValid) { isHoverValid = false; hoverVertex = -1; drawBoardWithOverlay(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = CANVAS_SIZE / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const v = getNearestVertex(x, y);
                hoverVertex = v;
                isHoverValid = (v !== -1 && (__editing || board[v] === 0));
                drawBoardWithOverlay();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!waitingScoreConfirm) {
                    hoverVertex = -1;
                    isHoverValid = false;
                    drawBoardWithOverlay();
                }
            });
        }

        if (scoreConfirmYes)
        {
            scoreConfirmYes.onclick = () =>
            {
                ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
                hideScoreConfirm();
            };
            scoreConfirmNo.onclick = () => {
                iRejected = true;
                ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (showEstimateActive) {
                    showEstimateActive = false;
                    clearEstimate();
                }
                waitingScoreConfirm = false;
            };
        }

        updateRecordButtons();

        /* board edit UI (flat vertices) */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            const _editPs = {
                get board() { return board; },
                set board(v) { board = v; },
                get gameOver() { return typeof gameOver !== 'undefined' ? gameOver : false; },
                get mySlot() { return typeof mySlot !== 'undefined' ? mySlot : null; },
                get gameStarted() {
                    if (typeof gameStarted !== 'undefined') return !!gameStarted;
                    return (typeof numberOfHands !== 'undefined' ? numberOfHands : 1) > 1;
                },
                set gameStarted(v) { if (typeof gameStarted !== 'undefined') gameStarted = !!v; },
                editModeEnabled: false,
                editTool: 'empty',
                get hoverRow() { return typeof hoverVertex !== 'undefined' ? hoverVertex : -1; },
                set hoverRow(v) { if (typeof hoverVertex !== 'undefined') hoverVertex = (v == null ? -1 : v); },
                get hoverCol() { return 0; },
                set hoverCol(_v) {},
                get isHoverValid() { return typeof isHoverValid !== 'undefined' ? isHoverValid : false; },
                set isHoverValid(v) { if (typeof isHoverValid !== 'undefined') isHoverValid = !!v; },
                get ws() { return typeof ws !== 'undefined' ? ws : null; }
            };
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: _editPs,
                canvas: document.getElementById('goBoard'),
                mode: 'flat',
                sendBoard(bd) {
                    /* 编辑提交走坐标：一维点数组 → 掩码二维盘 board[行][列]（无效点 -1） */
                    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'editBoard', board: wireBoard(bd) }));
                    }
                },

                pickAtClient(clientX, clientY) {
                    const canvasEl = document.getElementById('goBoard');
                    if (!canvasEl) return null;
                    const rect = canvasEl.getBoundingClientRect();
                    const scale = (typeof CANVAS_SIZE !== 'undefined' ? CANVAS_SIZE : canvasEl.width) / rect.width;
                    const x = (clientX - rect.left) * scale;
                    const y = (clientY - rect.top) * scale;
                    let i = -1;
                    if (typeof getNearestVertex === 'function') i = getNearestVertex(x, y);
                    else if (typeof pickNearestVertex === 'function') i = pickNearestVertex(x, y);
                    return (i != null && i >= 0) ? { index: i } : null;
                },
                drawBoard: (typeof drawBoardWithOverlay === 'function' ? drawBoardWithOverlay
                    : (typeof drawBoard === 'function' ? drawBoard : function () {})),
                getBoard() { return board; },
                setBoard(b) { board = b; },
                emptyBoard() { return Array((typeof VIEW.vertexCount !== 'undefined' ? VIEW.vertexCount : board.length)).fill(0); }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) {
                        _editPs.gameStarted = (state.numberOfHands || 1) > 1;
                        if (state.initialBoard && Array.isArray(state.initialBoard)) {
                            /* keep opening for client-side if needed */
                        }
                    }
                    _sync0(state);
                    if (typeof ws !== 'undefined') { /* refresh ws ref via getter */ }
                    _editApi.updateEditModeUI();
                };
            }
        }

        /* ---------------------- 子棋类：下拉、路数下拉与壳文案 ---------------------- */
        /** 棋谱/下载文件前缀按当前子棋类 */
        function recordPrefix() {
            return subCfg().prefix;
        }

        /** 路数下拉按当前子棋类的范围重建 */
        function rebuildSizeSelect() {
            const sel = document.getElementById('boardSizeSelect');
            if (!sel) return;
            const cfg = subCfg();
            sel.innerHTML = '';
            for (let n = cfg.min; n <= cfg.max; n++) {
                const opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n + '路';
                sel.appendChild(opt);
            }
            sel.value = String(LANES);
        }

        /** 子棋类下拉：显示当前项；开局/落座后禁用（服务端也会拒绝） */
        function syncSubGameSelect() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            sel.value = SUB;
            window.QiRoomGameSwitcher.syncSettingsSelect(sel);
        }

        /**
         * 木纹外框按子棋类切换：
         *   六角围棋 —— 隐藏壳统一的方形木纹（body 加 qi-room-transparent-canvas），只画自己的六角形木框；
         *   其余三种 —— 去掉该 class，并把方形木纹铺回画布（它们的骨架只画格线与坐标标签）。
         */
        function applySubWoodFrame() {
            const hexagon = SUB === 'hexagon-weiqi';
            document.body.classList.toggle('qi-room-transparent-canvas', hexagon);
            const canvasEl = document.getElementById('goBoard');
            if (!canvasEl) return;
            if (hexagon) {
                canvasEl.style.backgroundImage = '';
                canvasEl.style.backgroundSize = '';
                canvasEl.style.backgroundRepeat = '';
                canvasEl.style.backgroundPosition = '';
            } else if (typeof QiSquareWeiqiCanvas !== 'undefined' && QiSquareWeiqiCanvas.applyBoardWoodTexture) {
                QiSquareWeiqiCanvas.applyBoardWoodTexture(canvasEl);
            }
            drawBoardWithOverlay();
        }

        /** 规则弹层与贴目文案按当前子棋类 */
        function applySubShellChrome() {
            const cfg = subCfg();
            const rulesTitle = document.getElementById('rulesTitle');
            if (rulesTitle) rulesTitle.textContent = cfg.name;
            const rulesBody = document.getElementById('rulesBody');
            if (rulesBody) rulesBody.innerHTML = cfg.rulesHtml;
            applySubWoodFrame();
            // 蒙版形状在「创建蒙版」与「窗口 resize」时才会重新解析：换子棋类后补发一次 resize，
            // 让壳按当前的 ctx.seatOverlayShape（六角=六边形，其余=方形）重画蒙版
            try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
            refreshKomiInfo();
        }

        (function mountSubGameSelect() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            sel.innerHTML = '';
            for (const id of SUB_GAMES) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = SUB_META[id].name;
                sel.appendChild(opt);
            }
            sel.style.display = 'inline-block';
            sel.addEventListener('change', () => {
                const v = sel.value;
                if (!SUB_META[v] || v === SUB) return;
                // 乐观切换：本地先换几何/路数/贴目并清盘重绘；服务端 subGameChanged 回来再校正
                // 切子棋类等于开新局：先退出试下（清掉试下棋子）、打谱与形势判断，再换棋盘
                exitTryPlay();
                exitReplayMode();
                clearEstimate();
                recordSize();
                SUB = v;
                LANES = rememberedOrDef(v);
                rebuildSizeSelect();
                buildView();
                applySubShellChrome();
                board = Array(VIEW.vertexCount).fill(0);
                lastMoveMarkers = [];
                userBoardMarks = Object.create(null); userStoneMarks = Object.create(null);
                if (typeof ws !== 'undefined' && ws && ws.readyState === 1)
                    ws.send(JSON.stringify({ type: 'setSubGame', subGameId: v }));
                drawBoardWithOverlay();
                syncSubGameSelect();
            });
            syncSubGameSelect();
            applySubShellChrome();
        })();

        connectWebSocket();
        })();
    }
};
