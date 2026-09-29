window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['custom-weiqi'] = {
    shell: {
        "title": "自定义围棋",
        "rulesHtml": "基本规则同围棋，可点击「自定义规则」按钮修改规则。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 99,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "自定义围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "handicap": true,
            "showEstimate": true,
            "zoomScroll": true,
            "editBoard": true,
            "compoundPalette": false
        },
        "editTools": [
            {
                "value": "empty",
                "label": "空"
            },
            {
                "value": "black",
                "label": "黑子"
            },
            {
                "value": "white",
                "label": "白子"
            },
            {
                "value": "hole",
                "label": "洞"
            },
            {
                "value": "neutral",
                "label": "中立子"
            },
            {
                "value": "bridge",
                "label": "桥"
            },
            {
                "value": "mine",
                "label": "雷"
            }
        ]
    },
    mount: function (ctx) {
        var ctxRef = ctx;
        var seatOverlayDefault = ctx.boardSeatOverlay !== false;
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "自定义围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        // ======================== 规则核心（与 games/custom-weiqi.js 的 CustomWeiqiRules 等价）========================
        const HOLE = -1, BRIDGE = -2, MINE = -3, NEUTRAL = 10000;
        const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const EXTRA_KEYS = ['hole', 'bridge', 'neutral', 'mine'];

        /** 棋盘形状（与 games/custom-weiqi.js 的 BOARD_SHAPES 一致） */
        const BOARD_SHAPES = ['square', 'triangle', 'snub', 'cairo', 'floret', 'hexagon'];
        /** 各形状的路数范围/默认值（与 games/custom-weiqi.js 的 SHAPE_META 一致） */
        const SHAPE_META = {
            square: { label: '四角', min: 7, max: 99, def: 19 },
            triangle: { label: '三角', min: 3, max: 11, def: 9 },
            snub: { label: '扭棱四角', min: 3, max: 9, def: 7 },
            cairo: { label: '开罗五角', min: 3, max: 9, def: 7 },
            floret: { label: '花形五角', min: 3, max: 9, def: 7 },
            hexagon: { label: '六角', min: 4, max: 11, def: 9 }
        };
        function shapeMetaOf(shape) { return SHAPE_META[shape] || SHAPE_META.square; }

        /** 七种对称与「启用的对称」——须与 games/custom-weiqi.js 一致 */
        const SYMMETRY_TYPES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
        const ENABLED_SYMMETRIES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
        const OPENING_SYMMETRIES = ['diag1', 'diag2'];
        /** 「不邻前手」四模式 + 无 */
        const PREV_RULES = {
            none: { own: false, near: false, label: '无' },
            adjacent: { own: false, near: false, label: '不邻前手' },
            'adjacent-own': { own: true, near: false, label: '不邻己方前手' },
            near: { own: false, near: true, label: '不近前手' },
            'near-own': { own: true, near: true, label: '不近己方前手' }
        };
        const PREV_RULE_KEYS = Object.keys(PREV_RULES);

        function defaultCustomConfig() {
            return {
                minLib: 1,
                magnetism: 'none',
                extras: { hole: false, bridge: false, neutral: false, mine: false },
                greedy: false,
                symmetry: false,
                prevRule: 'none',
                boardShape: 'square'
            };
        }

        /** 容错解析服务端下发的规则（非法项退回默认） */
        function normalizeCustomConfig(raw) {
            const out = defaultCustomConfig();
            if (!raw || typeof raw !== 'object') return out;
            const n = Number(raw.minLib);
            if (Number.isInteger(n) && n >= 1 && n <= 4) out.minLib = n;
            if (raw.magnetism === 'none' || raw.magnetism === 'weak' || raw.magnetism === 'medium' || raw.magnetism === 'strong') {
                out.magnetism = raw.magnetism;
            }
            if (raw.extras && typeof raw.extras === 'object') {
                for (const key of EXTRA_KEYS) out.extras[key] = !!raw.extras[key];
            }
            out.greedy = !!raw.greedy;
            out.symmetry = !!raw.symmetry;
            if (PREV_RULE_KEYS.indexOf(raw.prevRule) >= 0) out.prevRule = raw.prevRule;
            if (BOARD_SHAPES.indexOf(raw.boardShape) >= 0) out.boardShape = raw.boardShape;
            return out;
        }

        function configKey(cfg) {
            if (!cfg) return '';
            return [cfg.minLib, cfg.magnetism, EXTRA_KEYS.map(k => (cfg.extras[k] ? 1 : 0)).join(''), cfg.greedy ? 1 : 0,
                cfg.symmetry ? 1 : 0, cfg.prevRule || 'none', cfg.boardShape || 'square'].join('|');
        }

        /** 非方格棋盘几何缓存（服务端下发 shapeGeometry；键 = 形状:路数） */
        const shapeGeomCache = new Map();
        function shapeGeomFor(shape, lanes) {
            return shapeGeomCache.get(shape + ':' + lanes) || null;
        }
        /** 收下服务端下发的几何，转成规则核心与绘制共用的对象 */
        function installShapeGeometry(payload) {
            if (!payload || !Array.isArray(payload.points) || !Array.isArray(payload.coord)) return null;
            const rows = Number(payload.rows) || 0, cols = Number(payload.cols) || 0;
            const index = new Map();
            for (let i = 0; i < payload.coord.length; i++) index.set(payload.coord[i][0] * cols + payload.coord[i][1], i);
            const symById = new Map();
            for (const sy of (payload.symmetries || [])) symById.set(sy.id, sy);
            const geom = {
                shape: payload.shape,
                lanes: payload.lanes,
                rows, cols,
                count: payload.coord.length,
                coord: payload.coord,
                points: payload.points,
                neighbors: payload.neighbors,
                symmetries: payload.symmetries || [],
                openingAxes: payload.openingAxes || [],
                centerCell: payload.centerCell || payload.coord[0],
                index,
                symById,
                isValid(r, c) { return r >= 0 && c >= 0 && r < this.rows && c < this.cols && this.index.has(r * this.cols + c); },
                indexOf(r, c) { const i = this.index.get(r * this.cols + c); return i === undefined ? -1 : i; },
                coordOf(i) { return this.coord[i]; },
                neighborsOf(r, c) {
                    const i = this.index.get(r * this.cols + c);
                    return i === undefined ? [] : this.neighbors[i].map((j) => this.coord[j]);
                },
                symImage(i, id) { const sy = this.symById.get(id); return sy ? sy.perm[i] : -1; }
            };
            shapeGeomCache.set(payload.shape + ':' + payload.lanes, geom);
            return geom;
        }

        /* ---------- 非方格棋盘：视口 / 木框 / 取点 / 绘制 ----------
         * 版面照着各棋种搬：
         *   三角（六角三角）—— 三角围棋的固定外框 FIXED_OUTER_HEX（参考 27 路）+ 缩放用 innerVerts，
         *                       隐藏壳统一的方形木纹，只画六角形木框；
         *   六角            —— 非四角围棋：木框半径 280、圆角 12，盘面按质心居中、缩放到 280−PADDING；
         *   花形五角        —— 木框半径 420（不画，仅用于点击范围），盘面缩放到 420−max(32,144−16n)；
         *   开罗/扭棱       —— 不画木框，用壳的方形木纹，盘面按 pad = 60−5·路数 居中缩放。
         */

        const SHAPE_CANVAS = 600;
        const SHAPE_CENTER = 300;

        /** 圆角多边形（照非四角围棋的 drawRoundedPolygon） */
        function shapeRoundedPolygon(g, vertices, radius, skipStroke) {
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
                const len1 = Math.hypot(v1.x, v1.y) || 1;
                const len2 = Math.hypot(v2.x, v2.y) || 1;
                startPoints.push({ x: curr.x + (v1.x / len1) * radius, y: curr.y + (v1.y / len1) * radius });
                endPoints.push({ x: curr.x + (v2.x / len2) * radius, y: curr.y + (v2.y / len2) * radius });
            }
            g.beginPath();
            g.moveTo(startPoints[0].x, startPoints[0].y);
            for (let i = 0; i < n; i++) {
                g.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                if (i < n - 1) g.lineTo(startPoints[i + 1].x, startPoints[i + 1].y);
            }
            g.lineTo(startPoints[0].x, startPoints[0].y);
            g.closePath();
            g.fill();
            if (!skipStroke) g.stroke();
        }

        function shapePointInPolygon(px, py, verts) {
            let inside = false;
            for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
                const xi = verts[i].x, yi = verts[i].y;
                const xj = verts[j].x, yj = verts[j].y;
                if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
            }
            return inside;
        }

        /** 六角外框向外扩 margin（照三角围棋的 outwardExpandHexagon） */
        function shapeOutwardExpandHexagon(verts, margin) {
            const cx = verts.reduce((s, p) => s + p.x, 0) / verts.length;
            const cy = verts.reduce((s, p) => s + p.y, 0) / verts.length;
            return verts.map((P) => {
                const vx = P.x - cx, vy = P.y - cy;
                const len = Math.hypot(vx, vy) || 1;
                return { x: P.x + (vx / len) * margin, y: P.y + (vy / len) * margin };
            });
        }

        // ---- 三角：照三角围棋的固定外框（参考 27 路，BASE_WIDTH 500、外扩 22、圆角 3） ----
        const TRI_BASE_WIDTH = 500;
        const TRI_ROWS_REF = 27;
        const TRI_FRAME_CORNER_RADIUS = 3;
        const TRI_REF_HEX = (() => {
            const R = (TRI_ROWS_REF - 1) / 2;
            const dx = TRI_BASE_WIDTH / (TRI_ROWS_REF - 1);
            const dy = dx * Math.sqrt(3) / 2;
            const topY = (SHAPE_CANVAS - dy * (TRI_ROWS_REF - 1)) / 2;
            const L = (r) => R + 1 + Math.min(r, 2 * R - r);
            const xOf = (r, c) => SHAPE_CENTER + (c - (L(r) - 1) / 2) * dx;
            const yOf = (r) => topY + r * dy;
            return [
                { x: xOf(0, 0), y: yOf(0) },
                { x: xOf(R, 0), y: yOf(R) },
                { x: xOf(2 * R, 0), y: yOf(2 * R) },
                { x: xOf(2 * R, L(2 * R) - 1), y: yOf(2 * R) },
                { x: xOf(R, L(R) - 1), y: yOf(R) },
                { x: xOf(0, L(0) - 1), y: yOf(0) }
            ];
        })();
        const TRI_OUTER_HEX = shapeOutwardExpandHexagon(TRI_REF_HEX, 22);
        const TRI_CENTROID = {
            x: TRI_OUTER_HEX.reduce((s, p) => s + p.x, 0) / TRI_OUTER_HEX.length,
            y: TRI_OUTER_HEX.reduce((s, p) => s + p.y, 0) / TRI_OUTER_HEX.length
        };
        const TRI_K = Math.hypot(TRI_REF_HEX[0].x - TRI_CENTROID.x, TRI_REF_HEX[0].y - TRI_CENTROID.y)
            / Math.hypot(TRI_OUTER_HEX[0].x - TRI_CENTROID.x, TRI_OUTER_HEX[0].y - TRI_CENTROID.y);

        // ---- 六角 / 花形：木框半径（照非四角围棋） ----
        const HEX_FRAME_RADIUS = 280;
        const HEX_FRAME_CORNER_RADIUS = 12;
        const FLORET_FRAME_RADIUS = 420;

        function shapeHexFrameVerts(radius) {
            return Array.from({ length: 6 }, (_, i) => {
                const a = i * Math.PI / 3;
                return { x: SHAPE_CENTER + radius * Math.cos(a), y: SHAPE_CENTER + radius * Math.sin(a) };
            });
        }

        /** 按形状算视口：每个点的像素坐标 + 格宽 + 木框（frame 也用于点击范围） */
        function buildShapeView(geom, canvasSize) {
            const shape = geom.shape;
            const cs = canvasSize || SHAPE_CANVAS;
            const s = cs / SHAPE_CANVAS;   // 画布逻辑尺寸缩放（正常为 1）
            const pos = new Array(geom.count);
            const rowLenOf = (r) => {
                let n = 0;
                for (let c = 0; c < geom.cols; c++) if (geom.isValid(r, c)) n++;
                return n;
            };
            let frame = null;
            let cornerRadius = 0;
            let cellSize = 12;
            if (shape === 'triangle') {
                const PADDING = 24.6 - 0.1 * geom.rows;
                const factor = Math.min(1, TRI_K * (22 / PADDING));
                const inner = TRI_OUTER_HEX.map((P) => ({
                    x: TRI_CENTROID.x + factor * (P.x - TRI_CENTROID.x),
                    y: TRI_CENTROID.y + factor * (P.y - TRI_CENTROID.y)
                }));
                const R = (geom.rows - 1) / 2;
                const DX = (inner[5].x - inner[0].x) / R;
                const DY = (inner[1].y - inner[0].y) / R;
                const TOP_Y = inner[0].y;
                const CX = (inner[0].x + inner[5].x) / 2;
                for (let i = 0; i < geom.count; i++) {
                    const rc = geom.coord[i];
                    const r = rc[0], c = rc[1];
                    pos[i] = { x: CX + (c - (rowLenOf(r) - 1) / 2) * DX, y: TOP_Y + (geom.rows - 1 - r) * DY };
                }
                cellSize = Math.abs(DX);
                frame = TRI_OUTER_HEX;
                cornerRadius = TRI_FRAME_CORNER_RADIUS;
            } else if (shape === 'hexagon' || shape === 'floret') {
                const outerR = shape === 'hexagon' ? HEX_FRAME_RADIUS : FLORET_FRAME_RADIUS;
                const PADDING = shape === 'hexagon' ? (72 - 4 * geom.lanes) : Math.max(32, 144 - 16 * geom.lanes);
                let cx = 0, cy = 0;
                for (const p of geom.points) { cx += p[0] / geom.count; cy += p[1] / geom.count; }
                let maxDist = 0;
                for (const p of geom.points) maxDist = Math.max(maxDist, Math.hypot(p[0] - cx, p[1] - cy));
                const scale = maxDist > 0 ? (outerR - PADDING) / maxDist : 1;
                for (let i = 0; i < geom.count; i++) {
                    pos[i] = { x: SHAPE_CENTER + (geom.points[i][0] - cx) * scale, y: SHAPE_CENTER + (geom.points[i][1] - cy) * scale };
                }
                cellSize = scale * (geom.count > 60 ? 0.866 : 1);
                // 只有六角用六角框做点击范围；花形是方形木纹上的花，用外接六角会把 16 个花瓣尖判成框外点不到
                frame = shape === 'hexagon' ? shapeHexFrameVerts(outerR) : null;
                cornerRadius = shape === 'hexagon' ? HEX_FRAME_CORNER_RADIUS : 6;
            } else {   // 开罗 / 扭棱：不画框，按 pad = 60 − 5·路数 居中缩放
                const pad = 60 - 5 * geom.lanes;
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const p of geom.points) {
                    if (p[0] < minX) minX = p[0];
                    if (p[0] > maxX) maxX = p[0];
                    if (p[1] < minY) minY = p[1];
                    if (p[1] > maxY) maxY = p[1];
                }
                const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
                const scale = Math.min((SHAPE_CANVAS - 2 * pad) / w, (SHAPE_CANVAS - 2 * pad) / h);
                const offsetX = (SHAPE_CANVAS - w * scale) / 2 - minX * scale;
                const offsetY = (SHAPE_CANVAS - h * scale) / 2 - minY * scale;
                for (let i = 0; i < geom.count; i++) {
                    pos[i] = { x: offsetX + geom.points[i][0] * scale, y: offsetY + geom.points[i][1] * scale };
                }
                cellSize = scale * (geom.shape === 'cairo' ? 0.866 : 0.8);
                frame = null;
            }
            if (s !== 1) for (const p of pos) { p.x *= s; p.y *= s; }
            let sum = 0, n = 0;
            for (let i = 0; i < geom.count; i++) {
                for (const j of geom.neighbors[i]) {
                    if (j < i) continue;
                    sum += Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y);
                    n++;
                }
            }
            if (n) cellSize = sum / n;   // 格宽取真实平均边长（棋子半径/对称符号按它算）
            const center = { x: 0, y: 0 };
            for (const p of pos) { center.x += p.x / pos.length; center.y += p.y / pos.length; }
            return { geom, canvasSize: canvasSize, pos, cellSize, center, frame, cornerRadius };
        }

        let shapeViewCache = null;
        function shapeView() {
            const geom = ps.rules && ps.rules.geom;
            if (!geom) return null;
            if (!shapeViewCache || shapeViewCache.geom !== geom || shapeViewCache.canvasSize !== BOARD_VIEW_CS) {
                shapeViewCache = buildShapeView(geom, BOARD_VIEW_CS);
            }
            return shapeViewCache;
        }

        /** 屏幕坐标 → 盘上最近的点（框外或 0.45 格宽外算没点中） */
        function shapeHitTest(x, y) {
            const v = shapeView();
            if (!v) return { row: -1, col: -1 };
            if (v.frame && !shapePointInPolygon(x, y, v.frame)) return { row: -1, col: -1 };
            const lim = v.cellSize * 0.45;
            let best = -1, bestD = lim * lim;
            for (let i = 0; i < v.pos.length; i++) {
                const dx = v.pos[i].x - x, dy = v.pos[i].y - y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= bestD) { bestD = d2; best = i; }
            }
            if (best < 0) return { row: -1, col: -1 };
            const rc = v.geom.coordOf(best);
            return { row: rc[0], col: rc[1] };
        }

        /** 行列 → 屏幕坐标（不在盘上返回 null） */
        function shapePointAt(row, col) {
            const v = shapeView();
            if (!v) return null;
            const i = v.geom.indexOf(row, col);
            return i < 0 ? null : v.pos[i];
        }

        /** 一枚棋子（与方格盘同款渐变+阴影） */
        function shapeDrawStone(g, x, y, radius, colorVal) {
            g.save();
            g.shadowBlur = 6;
            g.shadowColor = 'rgba(0,0,0,0.5)';
            g.shadowOffsetY = 2;
            const grad = g.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.2, x, y, radius * 1.2);
            if (colorVal === 1) {
                grad.addColorStop(0, '#444');
                grad.addColorStop(0.6, '#222');
                grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.5, '#eee');
                grad.addColorStop(1, '#aaa');
            }
            g.beginPath();
            g.arc(x, y, radius, 0, 2 * Math.PI);
            g.fillStyle = grad;
            g.fill();
            g.restore();
        }

        /**
         * 木质外框可见性：三角/六角自画六角框，要隐藏壳统一的方形木纹；
         * 其它形状（含四角）用壳的方形木纹——从三角/六角切回来时必须恢复，否则棋盘没有木框。
         */
        let woodFrameHidden = null;
        function syncWoodFrameVisibility() {
            const geom = ps.rules && ps.rules.geom;
            const hide = !!(geom && (geom.shape === 'triangle' || geom.shape === 'hexagon'));
            if (woodFrameHidden === hide) return;
            woodFrameHidden = hide;
            // 壳统一的方形木纹是画布上的 inline 背景（applyBoardWoodTexture 铺的），
            // 只加 class 盖不住——隐藏时必须把 inline 样式清掉（照非四角围棋的 applySubWoodFrame）
            if (document && document.body && document.body.classList) {
                document.body.classList.toggle('qi-room-transparent-canvas', hide);
            }
            const C = QiSquareWeiqiCanvas;
            if (hide) {
                if (canvas && canvas.style) {
                    canvas.style.backgroundImage = '';
                    canvas.style.backgroundSize = '';
                    canvas.style.backgroundRepeat = '';
                    canvas.style.backgroundPosition = '';
                }
            } else if (C && typeof C.applyBoardWoodTexture === 'function' && canvas) {
                // 先摘掉 transparent 类再铺木纹：木纹底色取画布自身的 background-color，
                // 带着「透明」类去铺会得到一张全黑的纹理
                try { C.applyBoardWoodTexture(canvas); } catch (e) { /* ignore */ }
            }
        }

        /** 非方格棋盘的完整绘制（木框 → 格线 → 附加物 → 棋子 → 序号 → 标记 → 对称轴 → 悬停/候选点） */
        function drawShapeBoard() {
            const C = QiSquareWeiqiCanvas;
            const d = C.draw;
            const cs = BOARD_VIEW_CS;
            const v = shapeView();
            const geom = v && v.geom;
            d.clear(ctx, cs);
            if (!v || !geom) return;
            syncWoodFrameVisibility();   // 三角/六角隐藏壳统一木纹（只画自己的六角框）
            const zRaw = ps.viewZoom;
            const z = typeof zRaw === 'number' && zRaw >= 1 ? Math.min(10, zRaw) : 1;
            const vcx = typeof ps.viewCenterX === 'number' ? ps.viewCenterX : cs / 2;
            const vcy = typeof ps.viewCenterY === 'number' ? ps.viewCenterY : cs / 2;
            const useView = z > 1;
            if (useView) {
                ctx.save();
                ctx.translate(cs / 2, cs / 2);
                ctx.scale(z, z);
                ctx.translate(-vcx, -vcy);
            }
            const wood = typeof C.getWoodFill === 'function' ? C.getWoodFill(ctx, canvas, cs) : null;
            const cellSize = v.cellSize;
            // 1) 六角木框（三角/六角：填木纹；花形只留框线以外不加框，开罗/扭棱无框）
            if (v.frame && geom.shape !== 'floret') {
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = wood || '#fdcc90';
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 0.5;
                shapeRoundedPolygon(ctx, v.frame, v.cornerRadius, false);
                ctx.restore();
            }
            // 2) 格线：相邻点连线
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = (geom.shape === 'triangle') ? 1.2 : 1.5;
            ctx.beginPath();
            for (let i = 0; i < geom.count; i++) {
                for (const j of geom.neighbors[i]) {
                    if (j < i) continue;
                    ctx.moveTo(v.pos[i].x, v.pos[i].y);
                    ctx.lineTo(v.pos[j].x, v.pos[j].y);
                }
            }
            ctx.stroke();
            // 3) 附加物：复用公共运行时的画法（传「假行列」让屏幕坐标正好落在点上）
            const RT = window.QiWeiqiSquarePageRuntime;
            const fake = (p) => [-p.y / cellSize, p.x / cellSize];
            for (let r = 0; r < geom.rows; r++) {
                for (let c = 0; c < geom.cols; c++) {
                    const val = ps.board[r] ? ps.board[r][c] : 0;
                    if (!isExtraVal(val)) continue;
                    const pt = shapePointAt(r, c);
                    if (!pt) continue;
                    const fr = fake(pt);
                    if (val === HOLE) { if (RT.drawRedBlockHole) RT.drawRedBlockHole(fr[0], fr[1], ctx, 0, cellSize, 1); }
                    else if (val === BRIDGE) { if (RT.drawBridge) RT.drawBridge(fr[0], fr[1], ctx, 0, cellSize, 1); }
                    else if (val === NEUTRAL) { if (RT.drawNeutralStone) RT.drawNeutralStone(fr[0], fr[1], ctx, 0, cellSize, 1); }
                    else if (val === MINE) { if (RT.drawMine) RT.drawMine(fr[0], fr[1], ctx, 0, cellSize, 1); }
                }
            }
            // 4) 棋子
            const stoneRadius = cellSize * 0.44;
            for (let r = 0; r < geom.rows; r++) {
                for (let c = 0; c < geom.cols; c++) {
                    const val = ps.board[r] ? ps.board[r][c] : 0;
                    if (val !== 1 && val !== 2) continue;
                    const pt = shapePointAt(r, c);
                    if (!pt) continue;
                    shapeDrawStone(ctx, pt.x, pt.y, stoneRadius, val);
                }
            }
            // 4.5) 显示序号
            if (ps.showMoveNumbers) {
                const nums = computeCustomStoneNumbers();
                const fontPx = Math.max(7, cellSize * 0.52);
                ctx.save();
                ctx.font = `${fontPx}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < geom.rows; r++) {
                    for (let c = 0; c < geom.cols; c++) {
                        const n = nums && nums[r] ? Number(nums[r][c]) : 0;
                        if (!n) continue;
                        const pt = shapePointAt(r, c);
                        if (!pt) continue;
                        ctx.fillStyle = (ps.board[r] && ps.board[r][c] === 1) ? '#fff' : '#222';
                        ctx.fillText(String(n), pt.x, pt.y);
                    }
                }
                ctx.restore();
            }
            // 5) 最后手标记（与方格盘同款：棋子上一个小三角，不是圆）
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            const markLen = cellSize * 0.352;
            for (const m of (ps.lastMoveMarkers || [])) {
                const pt = shapePointAt(m.row, m.col);
                if (!pt) continue;
                const color = m.color === 2 ? '#222' : '#fff';
                ctx.beginPath();
                if (lowerLastMoveMarker) {
                    ctx.moveTo(pt.x + stoneRadius, pt.y + stoneRadius);
                    ctx.lineTo(pt.x, pt.y + stoneRadius);
                    ctx.lineTo(pt.x + stoneRadius, pt.y);
                } else {
                    ctx.moveTo(pt.x, pt.y);
                    ctx.lineTo(pt.x + markLen, pt.y);
                    ctx.lineTo(pt.x, pt.y + markLen);
                }
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
            }
            // 5.5) 形势判断标记：被提的死子画己色小方块、空地按归属画小方块
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                const markSize = cellSize * 0.18;
                for (let i = 0; i < geom.count; i++) {
                    const rc = geom.coordOf(i);
                    const v = ps.board[rc[0]] ? ps.board[rc[0]][rc[1]] : 0;
                    const live = ps.cachedLiveBoard[rc[0]] ? ps.cachedLiveBoard[rc[0]][rc[1]] : 0;
                    const terr = ps.cachedTerritory[rc[0]] ? ps.cachedTerritory[rc[0]][rc[1]] : 0;
                    let fill = null;
                    if (v === 1 || v === 2) {
                        if (live === 0) fill = v === 1 ? '#ffffff' : '#222222';
                    } else if (terr === 1 || terr === 2) {
                        fill = terr === 1 ? '#222' : '#f0f0f0';
                    }
                    if (!fill) continue;
                    ctx.fillStyle = fill;
                    ctx.fillRect(v.pos[i].x - markSize, v.pos[i].y - markSize, markSize * 2, markSize * 2);
                }
            }
            // 5.8) 禁点灰叉
            drawBannedCrosses(ctx, cellSize, (row, col) => shapePointAt(row, col));
            // 6) 对称轴（镜像线 / 中心弧+箭头）
            drawShapeSymmetryAxis(ctx, v);
            // 7) 贪吃候选点
            if (mustCaptureActive()) {
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = ps.currentPlayer === 1 ? '#222' : '#fff';
                const sh = cellSize * 0.18;
                for (const cand of ps.candidates) {
                    const pt = shapePointAt(cand.row, cand.col);
                    if (!pt) continue;
                    ctx.fillRect(pt.x - sh, pt.y - sh, sh * 2, sh * 2);
                }
                ctx.globalAlpha = 1;
            }
            // 8) 悬停预览（只在自己该走 / 试下时画；含对称点第二子）
            // 编辑模式一律不画落子预览（编辑是「按工具改盘面」，预览走第 9 步；工具=空时什么都不画）
            const hr = ps.hoverRow, hc = ps.hoverCol;
            const canHover = !ps.editModeEnabled && (ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn));
            if (canHover && hr >= 0 && hc >= 0 && ps.isHoverValid && ps.board[hr]) {
                const cellVal = ps.board[hr][hc];
                const playerVal = ps.tryPlayMode ? ps.tryPlayCurrentPlayer : ps.currentPlayer;
                const drawHoverAt = (row, col, val) => {
                    const pt = shapePointAt(row, col);
                    if (!pt) return;
                    if (val === 0) {
                        // 与方格盘同款：0.45 半透明实心圆（无阴影、无渐变）
                        ctx.globalAlpha = 0.45;
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, stoneRadius, 0, 2 * Math.PI);
                        ctx.fillStyle = ps.tryPlayMode
                            ? (ps.tryPlayCurrentPlayer === 1 ? '#222' : '#fff')
                            : (ps.mySlot === 'player1' ? '#222' : '#fff');
                        ctx.fill();
                        ctx.globalAlpha = 1.0;
                    } else if (val === MINE) {
                        const RT2 = window.QiWeiqiSquarePageRuntime;
                        if (RT2 && RT2.stoneDanger && RT2.stoneDanger.drawRing) {
                            RT2.stoneDanger.drawRing(ctx, pt.x, pt.y, stoneRadius, '#d62828', cellSize * 0.055);
                        } else {
                            ctx.save();
                            ctx.strokeStyle = '#d62828';
                            ctx.lineWidth = Math.max(1.5, cellSize * 0.055);
                            ctx.beginPath();
                            ctx.arc(pt.x, pt.y, stoneRadius, 0, 2 * Math.PI);
                            ctx.stroke();
                            ctx.restore();
                        }
                    }
                };
                if (cellVal === 0 || cellVal === MINE) {
                    drawHoverAt(hr, hc, cellVal);
                    if (ps.customRules && ps.customRules.symmetry) {
                        const axis = ps.tryPlayMode ? tryPlayAxisForStep(ps.tryPlayStep) : ps.symmetryAxis;
                        const sp = axis && ps.rules ? ps.rules.getSymmetryPoint(hr, hc, axis) : null;
                        if (sp && !(sp.row === hr && sp.col === hc)) {
                            const sv = ps.board[sp.row] ? ps.board[sp.row][sp.col] : 1;
                            drawHoverAt(sp.row, sp.col, sv);
                        }
                    }
                }
            }
            // 9) 编辑模式：按当前工具画悬停预览（照方格盘 hoverPreviewStone 的口径）
            if (ps.editModeEnabled && hr >= 0 && hc >= 0 && ps.isHoverValid) {
                const tool = ps.editTool || 'empty';
                const toolVal = tool === 'black' ? 1
                    : (tool === 'white' ? 2
                        : (tool === 'hole' ? HOLE
                            : (tool === 'bridge' ? BRIDGE
                                : (tool === 'neutral' ? NEUTRAL : (tool === 'mine' ? MINE : 0)))));
                const pt = shapePointAt(hr, hc);
                if (pt && toolVal !== 0) {
                    const RT = window.QiWeiqiSquarePageRuntime;
                    // 附加物用公共画法：传「假行列」让屏幕坐标正好落在点上（与第 3 步同款）
                    const fake = [-pt.y / cellSize, pt.x / cellSize];
                    ctx.save();
                    ctx.globalAlpha = 0.45;
                    if (toolVal === 1 || toolVal === 2) {
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, stoneRadius, 0, 2 * Math.PI);
                        ctx.fillStyle = toolVal === 1 ? '#222' : '#fff';
                        ctx.fill();
                    } else if (toolVal === HOLE) {
                        if (RT && RT.drawRedBlockHole) RT.drawRedBlockHole(fake[0], fake[1], ctx, 0, cellSize, 1);
                    } else if (toolVal === BRIDGE) {
                        if (RT && RT.drawBridge) RT.drawBridge(fake[0], fake[1], ctx, 0, cellSize, 1);
                    } else if (toolVal === NEUTRAL) {
                        if (RT && RT.drawNeutralStone) RT.drawNeutralStone(fake[0], fake[1], ctx, 0, cellSize, 1);
                    } else if (toolVal === MINE) {
                        if (RT && RT.drawMine) RT.drawMine(fake[0], fake[1], ctx, 0, cellSize, 1);
                    }
                    ctx.restore();
                }
            }
            if (useView) ctx.restore();
        }

        /** 非方格棋盘的对称轴符号：镜轴画过盘心的整条直线，旋转画中心弧 + 箭头（尺寸与四角同口径） */
        function drawShapeSymmetryAxis(g, v) {
            if (!ps.customRules || !ps.customRules.symmetry) return;
            const axis = ps.symmetryAxis;
            if (!axis || ps.showEstimateActive) return;
            const sy = v.geom.symById.get(axis);
            if (!sy) return;
            const color = ps.currentPlayer === 1 ? '#000000' : '#ffffff';
            g.save();
            g.lineWidth = 3;
            g.strokeStyle = color;
            g.fillStyle = color;
            g.shadowBlur = 4;
            g.shadowColor = ps.currentPlayer === 1 ? '#aaa' : '#333';
            g.shadowOffsetY = 1;
            g.setLineDash([]);
            const cellSize = v.cellSize;
            const cx = v.center.x, cy = v.center.y;
            const D = Math.PI / 180;
            if (sy.kind === 'mirror') {
                const th = sy.angleDeg * D;
                const ux = Math.cos(th), uy = Math.sin(th);
                let reach = 0;
                for (const p of v.pos) reach = Math.max(reach, Math.abs((p.x - cx) * ux + (p.y - cy) * uy));
                reach = reach * 0.98 + cellSize * 0.3;
                g.beginPath();
                g.moveTo(cx - ux * reach, cy - uy * reach);
                g.lineTo(cx + ux * reach, cy + uy * reach);
                g.stroke();
                g.restore();
                return;
            }
            // 旋转：6 点钟出发，顺逆中取角度较大的方向，终点 = 6 点钟转过该角度
            const start = Math.PI / 2;                       // 画布 6 点钟（y 轴向下）
            const deg = ((sy.angleDeg % 360) + 360) % 360;
            const end = start + deg * D;
            const anticlockwise = deg <= 180;                // 大方向：≤180 走逆时针绕远，>180 顺时针
            const r = cellSize * 2.6;
            g.beginPath();
            g.arc(cx, cy, r, start, end, anticlockwise);
            g.stroke();
            const sign = anticlockwise ? -1 : 1;
            const tx = sign * -Math.sin(end), ty = sign * Math.cos(end);
            const bx = cx + Math.cos(end) * r, by = cy + Math.sin(end) * r;
            const nx = -ty, ny = tx;
            const AL = cellSize * 0.68, AW = cellSize * 0.52;
            g.beginPath();
            g.moveTo(bx + tx * AL, by + ty * AL);
            g.lineTo(bx + nx * (AW / 2), by + ny * (AW / 2));
            g.lineTo(bx - nx * (AW / 2), by - ny * (AW / 2));
            g.closePath();
            g.fill();
            g.restore();
        }

        function isExtraVal(v) {
            return v === HOLE || v === BRIDGE || v === MINE || v === NEUTRAL;
        }
        function isPieceVal(v) {
            return v === 1 || v === 2 || v === NEUTRAL;
        }

        /**
         * 规则核心：短气（minLib）、磁性、附加物（洞/桥/中立子/雷）、贪吃。
         * numGrid 非空时同步搬运/清除手数编号（显示序号用）。
         */
        class CustomRules {
            constructor(boardSize, cfg) {
                const c = normalizeCustomConfig(cfg);
                this.boardSize = boardSize;
                this.minLib = c.minLib;
                this.magnetism = c.magnetism;
                this.extras = c.extras;
                this.greedy = c.greedy;
                this.symmetry = c.symmetry;
                this.prevRule = c.prevRule;
                this.shape = BOARD_SHAPES.indexOf(c.boardShape) >= 0 ? c.boardShape : 'square';
                // 非方格棋盘的几何由服务端下发（按 形状:路数 缓存）；还没收到时先按方格退避
                this.geom = this.shape === 'square' ? null : shapeGeomFor(this.shape, boardSize);
            }

            // ---------- 棋盘几何（方格与非方格统一走这里；与服务端 CustomWeiqiRules 同款） ----------

            get rows() { return this.geom ? this.geom.rows : this.boardSize; }
            get cols() { return this.geom ? this.geom.cols : this.boardSize; }
            get pointCount() { return this.geom ? this.geom.count : this.boardSize * this.boardSize; }
            emptyBoard() {
                const g = [];
                for (let r = 0; r < this.rows; r++) {
                    const row = [];
                    for (let c = 0; c < this.cols; c++) row.push(this.inBounds(r, c) ? 0 : -1);
                    g.push(row);
                }
                return g;
            }
            newGrid(fill) {
                const g = [];
                for (let r = 0; r < this.rows; r++) {
                    const row = [];
                    for (let c = 0; c < this.cols; c++) row.push(fill);
                    g.push(row);
                }
                return g;
            }
            keyOf(r, c) { return r * this.cols + c; }
            keyRow(key) { return Math.floor(key / this.cols); }
            keyCol(key) { return key % this.cols; }
            triRowLen(r) {
                const l = this.boardSize;
                return (r < 0 || r > 2 * l - 2) ? 0 : l + Math.min(r, 2 * l - 2 - r);
            }
            get rayDirs() { return this.shape === 'square' ? 4 : (this.shape === 'triangle' ? 6 : 0); }
            stepDir(row, col, d) {
                if (this.shape !== 'triangle') {
                    const dd = DIRS[d] || DIRS[0];
                    return [row + dd[0], col + dd[1]];
                }
                if (d === 0) return [row, col + 1];
                if (d === 3) return [row, col - 1];
                const down = (d === 1 || d === 2);
                const nr = down ? row - 1 : row + 1;
                if (nr < 0 || nr >= 2 * this.boardSize - 1) return null;
                const longer = this.triRowLen(nr) > this.triRowLen(row);
                const right = (d === 1 || d === 5);
                return [nr, right ? (longer ? col + 1 : col) : (longer ? col : col - 1)];
            }
            oppositeDir(d) {
                if (this.shape !== 'triangle') return d ^ 1;
                return (d + 3) % 6;
            }
            baseNeighbors(row, col) {
                if (this.geom) return this.inBounds(row, col) ? this.geom.neighborsOf(row, col) : [];
                const out = [];
                for (let d = 0; d < 4; d++) {
                    const p = this.stepDir(row, col, d);
                    if (this.inBounds(p[0], p[1])) out.push(p);
                }
                return out;
            }

            key() {
                return this.boardSize + '#' + configKey(this);
            }

            inBounds(r, c) {
                if (this.geom) return this.geom.isValid(r, c);
                return r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize;
            }

            /** 沿方向 dirIdx 前进；连续桥格直接跳过（桥是通道） */
            resolveBridgeStep(board, row, col, dirIdx) {
                let cur = [row, col];
                for (;;) {
                    const nxt = this.stepDir(cur[0], cur[1], dirIdx);
                    if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
                    if (board[nxt[0]][nxt[1]] === BRIDGE) { cur = nxt; continue; }
                    return nxt;
                }
            }

            /** 邻接（全规则唯一的邻接口径）：方格四向、三角六向，都可跨桥；其它形状取几何邻居表 */
            getBridgeNeighbors(board, row, col) {
                const n = this.rayDirs;
                if (!n) return this.baseNeighbors(row, col);
                const out = [];
                const seen = new Set();
                for (let d = 0; d < n; d++) {
                    const p = this.resolveBridgeStep(board, row, col, d);
                    if (!p) continue;
                    const key = this.keyOf(p[0], p[1]);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push(p);
                }
                return out;
            }

            collectGroup(board, row, col, color, visited) {
                const group = [];
                if (!this.inBounds(row, col) || board[row][col] !== color) return group;
                const seen = visited || new Set();
                const stack = [[row, col]];
                while (stack.length) {
                    const [r, c] = stack.pop();
                    const key = this.keyOf(r, c);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (!this.inBounds(r, c) || board[r][c] !== color) continue;
                    group.push([r, c]);
                    for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                        if (board[nr][nc] === color) stack.push([nr, nc]);
                    }
                }
                return group;
            }

            /** 一组棋的气点集合（key = r*size+c）：洞/桥/中立子不算气；空点与雷算气 */
            groupLiberties(board, group) {
                const libs = new Set();
                for (const [r, c] of group) {
                    for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                        const nv = board[nr][nc];
                        if (nv === 0 || nv === MINE) libs.add(this.keyOf(nr, nc));
                    }
                }
                return libs;
            }

            countLiberties(board, row, col) {
                const color = board[row][col];
                if (!isPieceVal(color)) return 0;
                return this.groupLiberties(board, this.collectGroup(board, row, col, color)).size;
            }

            removeGroup(board, row, col, color, numGrid) {
                for (const [r, c] of this.collectGroup(board, row, col, color)) {
                    board[r][c] = 0;
                    if (numGrid) numGrid[r][c] = 0;
                }
            }

            isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
                for (const [nr, nc] of this.getBridgeNeighbors(board, libertyRow, libertyCol)) {
                    if (board[nr][nc] === opponentColor) return true;
                }
                return false;
            }

            // ---------- 磁力 ----------

            /** 射线扫描时各类格的语义：block 挡住射线 / pass 穿透 / target 可被推动的棋子 */
            rayAction(v) {
                if (v === 0) return 'pass';
                if (v === HOLE) return 'block';
                if (v === NEUTRAL) return this.magnetism === 'weak' ? 'block' : 'pass';
                if (v === BRIDGE || v === MINE) return 'pass';
                return 'target';
            }

            rayTargets(board, row, col, dirIdx) {
                const out = [];
                let cur = [row, col];
                for (let step = 1; ; step++) {
                    const nxt = this.stepDir(cur[0], cur[1], dirIdx);
                    if (!nxt || !this.inBounds(nxt[0], nxt[1])) break;
                    cur = nxt;
                    const v = board[cur[0]][cur[1]];
                    const action = this.rayAction(v);
                    if (action === 'block') break;
                    if (action === 'target') out.push({ r: cur[0], c: cur[1], step, dirIdx, color: v });
                }
                return out;
            }

            nearestTarget(board, row, col, dirIdx) {
                let cur = [row, col];
                for (let step = 1; ; step++) {
                    const nxt = this.stepDir(cur[0], cur[1], dirIdx);
                    if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
                    cur = nxt;
                    const v = board[cur[0]][cur[1]];
                    const action = this.rayAction(v);
                    if (action === 'block') return null;
                    if (action === 'target') return { r: cur[0], c: cur[1], step, dirIdx, color: v };
                }
            }

            /** 被推动棋子的落脚点：可跨连续桥格；洞/中立子/雷/子/出界都算停住 */
            shiftDestination(board, r, c, dirIdx) {
                let cur = [r, c];
                for (;;) {
                    const nxt = this.stepDir(cur[0], cur[1], dirIdx);
                    if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
                    if (board[nxt[0]][nxt[1]] === BRIDGE) { cur = nxt; continue; }
                    return board[nxt[0]][nxt[1]] === 0 ? [nxt[0], nxt[1]] : null;
                }
            }

            shiftPiece(board, numGrid, r, c, dirIdx) {
                const dest = this.shiftDestination(board, r, c, dirIdx);
                if (!dest) return false;
                const color = board[r][c];
                board[dest[0]][dest[1]] = color;
                board[r][c] = 0;
                if (numGrid) {
                    numGrid[dest[0]][dest[1]] = numGrid[r][c];
                    numGrid[r][c] = 0;
                }
                return true;
            }

            applyMagnetism(board, row, col, playerVal, numGrid) {
                if (this.magnetism === 'none') return board;
                if (this.magnetism === 'weak') {
                    for (let d = 0; d < this.rayDirs; d++) {
                        const target = this.nearestTarget(board, row, col, d);
                        if (!target) continue;
                        this.shiftPiece(board, numGrid, target.r, target.c, target.color === playerVal ? d : this.oppositeDir(d));
                    }
                    return board;
                }
                if (this.magnetism === 'strong') {
                    let guard = 0;
                    const maxRounds = this.geom ? this.pointCount * 4 + 1000 : this.boardSize * this.boardSize * this.boardSize * 8 + 1000;
                    while (this.applyOneMagneticRound(board, row, col, playerVal, numGrid)) {
                        if (++guard > maxRounds) break;
                    }
                    return board;
                }
                this.applyOneMagneticRound(board, row, col, playerVal, numGrid);
                return board;
            }

            applyOneMagneticRound(board, row, col, playerVal, numGrid) {
                const ownList = [];
                const oppList = [];
                for (let dirIdx = 0; dirIdx < this.rayDirs; dirIdx++) {
                    for (const item of this.rayTargets(board, row, col, dirIdx)) {
                        const entry = { r: item.r, c: item.c, step: item.step, dirIdx, color: item.color };
                        if (item.color === playerVal) ownList.push(entry);
                        else oppList.push(entry);
                    }
                }
                ownList.sort((a, b) => b.step - a.step || a.dirIdx - b.dirIdx);
                oppList.sort((a, b) => a.step - b.step || a.dirIdx - b.dirIdx);
                let movedAny = false;
                const tryShift = (item) => {
                    const { r, c, dirIdx, color } = item;
                    if (board[r][c] !== color) return;
                    // 己方远离落子点、对方靠近落子点
                    const d = color === playerVal ? dirIdx : this.oppositeDir(dirIdx);
                    if (this.shiftPiece(board, numGrid, r, c, d)) movedAny = true;
                };
                for (const item of ownList) tryShift(item);
                for (const item of oppList) tryShift(item);
                return movedAny;
            }

            // ---------- 对称点（与 games/custom-weiqi.js 的 CustomWeiqiRules 逐条等价） ----------

            /** 本手的对称轴：第 1、2 手固定 diag1/diag2，之后从启用集合随机 */
            static nextSymmetryAxis(handNumber) {
                if (handNumber === 1) return OPENING_SYMMETRIES[0];
                if (handNumber === 2) return OPENING_SYMMETRIES[1];
                const pool = (ps.enabledSymmetries && ps.enabledSymmetries.length) ? ps.enabledSymmetries
                    : (ENABLED_SYMMETRIES.length ? ENABLED_SYMMETRIES : SYMMETRY_TYPES);
                return pool[Math.floor(Math.random() * pool.length)];
            }

            /** 本手的对称轴：非方格按几何（前几手固定开手对称，之后在实测成立的对称里随机） */
            nextSymmetryAxis(handNumber) {
                const geom = this.geom;
                if (!geom) return CustomRules.nextSymmetryAxis(handNumber);
                const opening = geom.openingAxes || [];
                if (handNumber <= opening.length) return opening[handNumber - 1];
                const pool = geom.symmetries.map((sy) => sy.id);
                if (!pool.length) return opening.length ? opening[0] : null;
                return pool[Math.floor(Math.random() * pool.length)];
            }

            /** 对称点映射（last = 路数−1，屏幕视角 row 0 在下、col 0 在左） */
            static getSymmetryPoint(boardSize, row, col, axis) {
                const last = boardSize - 1;
                if (axis === 'horizontal') return { row: last - row, col };
                if (axis === 'vertical') return { row, col: last - col };
                if (axis === 'diag1') return { row: col, col: row };
                if (axis === 'diag2') return { row: last - col, col: last - row };
                if (axis === 'rotate90cw') return { row: last - col, col: row };
                if (axis === 'rotate90ccw') return { row: col, col: last - row };
                if (axis === 'rotate180') return { row: last - row, col: last - col };
                return { row, col };
            }

            getSymmetryPoint(row, col, axis) {
                if (this.geom) {
                    const i = this.geom.indexOf(row, col);
                    const j = i < 0 ? -1 : this.geom.symImage(i, axis);
                    if (j < 0) return { row, col };
                    const rc = this.geom.coordOf(j);
                    return { row: rc[0], col: rc[1] };
                }
                return CustomRules.getSymmetryPoint(this.boardSize, row, col, axis);
            }

            /** 对称点这一格：'place' 落子 / 'mine' 踩雷（消雷不留子）/ 'skip' 洞·桥·中立子·已有子 */
            symmetryPointAction(board, r, c) {
                const v = board[r][c];
                if (v === MINE) return 'mine';
                if (v !== 0) return 'skip';
                return 'place';
            }

            /** 不邻前手禁点：与参考点（上一手实际落下的棋子）相邻/相近 */
            /** 相邻两步的方向角（mod π） */
            stepAngle(pr, pc, qr, qc) {
                if (this.geom) {
                    const ip = this.geom.indexOf(pr, pc);
                    const iq = this.geom.indexOf(qr, qc);
                    if (ip < 0 || iq < 0) return 0;
                    const p = this.geom.points[ip];
                    const q = this.geom.points[iq];
                    return Math.atan2(q[1] - p[1], q[0] - p[0]) % Math.PI;
                }
                return Math.atan2(-(qr - pr), qc - pc) % Math.PI;
            }

            static sameLineAngle(a1, a2) {
                return Math.abs(Math.sin(a1 - a2)) < 1e-6;
            }

            /** 禁点集合（与服务端同款）：邻点 = 组的相邻口径；近点 = 拐个方向的两步可达点（含邻点） */
            bannedKeySet(board, prevPoints) {
                const meta = PREV_RULES[this.prevRule] || PREV_RULES.none;
                if (this.prevRule === 'none' || meta.own === undefined) return null;
                const refs = (prevPoints || []).filter((p) => p && Number.isInteger(p.row) && Number.isInteger(p.col) && this.inBounds(p.row, p.col));
                if (!refs.length) return null;
                const banned = new Set();
                for (const p of refs) {
                    const refKey = this.keyOf(p.row, p.col);
                    const refNb = this.getBridgeNeighbors(board, p.row, p.col);
                    const refNbKeys = new Set(refNb.map((xy) => this.keyOf(xy[0], xy[1])));
                    for (const k of refNbKeys) banned.add(k);
                    if (!meta.near) continue;
                    for (const [br, bc] of refNb) {
                        const a1 = this.stepAngle(p.row, p.col, br, bc);
                        for (const [cr, cc] of this.getBridgeNeighbors(board, br, bc)) {
                            const k = this.keyOf(cr, cc);
                            if (k === refKey || refNbKeys.has(k)) continue;
                            const a2 = this.stepAngle(br, bc, cr, cc);
                            if (CustomRules.sameLineAngle(a1, a2)) continue;
                            banned.add(k);
                        }
                    }
                }
                return banned;
            }

            isBannedByPrev(board, r, c, prevPoints) {
                const set = this.bannedKeySet(board, prevPoints);
                return !!(set && set.has(this.keyOf(r, c)));
            }

            /** 单源位移场（只让 (sr,sc) 施加磁力，用唯一编号跟踪每颗棋子） */
            displacementField(board, sr, sc, playerVal) {
                const b = QiSquareWeiqiCanvas.deepCopyBoard(board);
                const idGrid = this.newGrid(0);
                const pieces = [];
                let id = 0;
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (isPieceVal(board[r][c])) {
                            id += 1;
                            idGrid[r][c] = id;
                            pieces.push({ id, r, c, color: board[r][c] });
                        }
                    }
                }
                this.applyMagnetism(b, sr, sc, playerVal, idGrid);
                const pos = new Map();
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (idGrid[r][c]) pos.set(idGrid[r][c], [r, c]);
                    }
                }
                const field = new Map();
                for (const p of pieces) {
                    const end = pos.get(p.id) || [p.r, p.c];
                    field.set(p.id, { id: p.id, fromR: p.r, fromC: p.c, toR: end[0], toC: end[1], color: p.color });
                }
                return field;
            }

            /** 两颗子同时落下：位移矢量和 + 同点按多数色合并/抵消（用户口径，与服务端一致） */
            applyPairedMagnetism(board, placed, playerVal, numGrid) {
                const fieldA = this.displacementField(board, placed[0][0], placed[0][1], playerVal);
                const fieldB = this.displacementField(board, placed[1][0], placed[1][1], playerVal);
                const key = (r, c) => this.keyOf(r, c);
                const movers = [];
                for (const [id, ea] of fieldA) {
                    const eb = fieldB.get(id);
                    const dr = (ea.toR - ea.fromR) + (eb ? eb.toR - eb.fromR : 0);
                    const dc = (ea.toC - ea.fromC) + (eb ? eb.toC - eb.fromC : 0);
                    if (!dr && !dc) continue;
                    movers.push({
                        id, fromR: ea.fromR, fromC: ea.fromC, toR: ea.fromR + dr, toC: ea.fromC + dc,
                        color: ea.color, num: numGrid ? (Number(numGrid[ea.fromR][ea.fromC]) || 0) : 0
                    });
                }
                if (!movers.length) return;
                const canStop = (r, c) => this.inBounds(r, c) && board[r][c] === 0;
                const excluded = new Set();
                let movable = [];
                for (const m of movers) {
                    if (canStop(m.toR, m.toC)) movable.push(m);
                    else excluded.add(key(m.fromR, m.fromC));
                }
                for (;;) {
                    const next = movable.filter((m) => !excluded.has(key(m.toR, m.toC)));
                    if (next.length === movable.length) break;
                    for (const m of movable) if (next.indexOf(m) < 0) excluded.add(key(m.fromR, m.fromC));
                    movable = next;
                }
                if (!movable.length) return;
                const nums = new Map();
                for (const m of movable) nums.set(m.id, m.num);
                for (const m of movable) {
                    board[m.fromR][m.fromC] = 0;
                    if (numGrid) numGrid[m.fromR][m.fromC] = 0;
                }
                const byTarget = new Map();
                for (const m of movable) {
                    const k = key(m.toR, m.toC);
                    if (!byTarget.has(k)) byTarget.set(k, { r: m.toR, c: m.toC, groups: new Map() });
                    const t = byTarget.get(k);
                    if (!t.groups.has(m.color)) t.groups.set(m.color, []);
                    t.groups.get(m.color).push(m);
                }
                for (const t of byTarget.values()) {
                    const counts = new Map();
                    for (const [color, list] of t.groups) counts.set(color, list.length);
                    const winner = CustomRules.majorityColor(counts);
                    if (!winner) continue;
                    board[t.r][t.c] = winner;
                    if (numGrid) numGrid[t.r][t.c] = nums.get(t.groups.get(winner)[0].id) || 0;
                }
            }

            /** 多颗棋子到同一点：哪一色多留哪一色，一样多返回 0（一起消失） */
            static majorityColor(counts) {
                let best = 0, bestN = 0, tie = false;
                for (const [color, n] of counts) {
                    if (n > bestN) { best = color; bestN = n; tie = false; }
                    else if (n === bestN) tie = true;
                }
                return tie ? 0 : best;
            }

            // ---------- 提子 ----------

            /** 只处理本次落子/磁力推动波及到的组；先提它组，最后判落子组自身（对称点会落两颗子） */
            settleCaptures(boardBefore, board, placedPoints, numGrid) {
                const placedGroups = new Set();
                const placedList = (placedPoints || []).filter(([pr, pc]) => isPieceVal(board[pr][pc]));
                for (const [pr, pc] of placedList) {
                    for (const [r, c] of this.collectGroup(board, pr, pc, board[pr][pc])) placedGroups.add(this.keyOf(r, c));
                }
                const reps = [];
                const pushed = new Set();
                const pushRep = (r, c) => {
                    if (!isPieceVal(board[r][c])) return;
                    const key = this.keyOf(r, c);
                    if (pushed.has(key)) return;
                    pushed.add(key);
                    reps.push([r, c]);
                };
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (board[r][c] === boardBefore[r][c]) continue;
                        pushRep(r, c);
                        for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) pushRep(nr, nc);
                    }
                }
                for (const [r, c] of reps) {
                    const v = board[r][c];
                    if (!isPieceVal(v) || placedGroups.has(this.keyOf(r, c))) continue;
                    if (this.countLiberties(board, r, c) < this.minLib) this.removeGroup(board, r, c, v, numGrid);
                }
                const toRemove = [];
                for (const [pr, pc] of placedList) {
                    const v = board[pr][pc];
                    if (isPieceVal(v) && this.countLiberties(board, pr, pc) < this.minLib) toRemove.push([pr, pc]);
                }
                for (const [pr, pc] of toRemove) {
                    const v = board[pr][pc];
                    if (isPieceVal(v)) this.removeGroup(board, pr, pc, v, numGrid);
                }
                return board;
            }

            // ---------- 落子 / 贪吃 ----------

            placeStone(boardBefore, row, col, playerVal, opts) {
                const o = opts || {};
                if (!this.inBounds(row, col) || boardBefore[row][col] !== 0) return null;
                const prevPoints = o.prevPoints || [];
                if (this.isBannedByPrev(boardBefore, row, col, prevPoints)) return null;
                const board = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
                const numGrid = o.numGrid ? o.numGrid.map(r => r.slice()) : null;
                board[row][col] = playerVal;
                if (numGrid) numGrid[row][col] = Number(o.moveNum) || 0;
                const placed = [[row, col]];
                let clearedMine = null;
                if (this.symmetry && o.symmetryAxis) {
                    const sp = this.getSymmetryPoint(row, col, o.symmetryAxis);
                    if (!(sp.row === row && sp.col === col)) {
                        const action = this.symmetryPointAction(board, sp.row, sp.col);
                        if (action === 'place') {
                            if (!this.isBannedByPrev(boardBefore, sp.row, sp.col, prevPoints)) {
                                board[sp.row][sp.col] = playerVal;
                                if (numGrid) numGrid[sp.row][sp.col] = Number(o.moveNum) || 0;
                                placed.push([sp.row, sp.col]);
                            }
                        } else if (action === 'mine') {
                            board[sp.row][sp.col] = 0;      // 对称点是雷：消雷、不留子
                            clearedMine = [sp.row, sp.col];
                        }
                    }
                }
                if (placed.length === 2 && this.magnetism !== 'none') this.applyPairedMagnetism(board, placed, playerVal, numGrid);
                else this.applyMagnetism(board, row, col, playerVal, numGrid);
                this.settleCaptures(boardBefore, board, placed, numGrid);
                if (this.greedy && !o.skipGreedy) {
                    const myCap = this.countCaptures(boardBefore, board, playerVal);
                    if (this.hasStrictlyBetterCapture(boardBefore, playerVal, myCap, row, col, o.historyBoardSet, o)) return null;
                }
                return { board, numGrid, placed, clearedMine };
            }

            tryPlaceStone(boardBefore, row, col, playerVal, opts) {
                const placed = this.placeStone(boardBefore, row, col, playerVal, opts);
                return placed ? placed.board : null;
            }

            /** 提子数：对方棋子 + 中立子 */
            countCaptures(boardBefore, boardAfter, playerVal) {
                const enemy = 3 - playerVal;
                let before = 0, after = 0;
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        const bv = boardBefore[r][c];
                        if (bv === enemy || bv === NEUTRAL) before++;
                        const av = boardAfter[r][c];
                        if (av === enemy || av === NEUTRAL) after++;
                    }
                }
                return before - after;
            }

            hasStrictlyBetterCapture(boardBefore, playerVal, myCap, skipRow, skipCol, historyBoardSet, probeOpts) {
                const extra = { symmetryAxis: (probeOpts || {}).symmetryAxis, prevPoints: (probeOpts || {}).prevPoints };
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (!this.inBounds(r, c) || boardBefore[r][c] !== 0) continue;
                        if (r === skipRow && c === skipCol) continue;
                        const nb = this.tryPlaceStone(boardBefore, r, c, playerVal, { skipGreedy: true, ...extra });
                        if (!nb) continue;
                        if (historyBoardSet && historyBoardSet.has(nb.map(row => row.join(',')).join(';'))) continue;
                        if (this.countCaptures(boardBefore, nb, playerVal) > myCap) return true;
                    }
                }
                return false;
            }

            // ---------- 形势判断 / 数点 ----------

            removeDeadAndDying(srcBoard) {
                const maxWeakLiberties = Math.max(2, this.minLib);
                let board = QiSquareWeiqiCanvas.deepCopyBoard(srcBoard);
                let changed = true;
                while (changed) {
                    changed = false;
                    const visited = new Set();
                    for (let r = 0; r < this.rows; r++) {
                        for (let c = 0; c < this.cols; c++) {
                            const val = board[r][c];
                            if (!isPieceVal(val) || visited.has(this.keyOf(r, c))) continue;
                            const group = this.collectGroup(board, r, c, val, visited);
                            if (!group.length) continue;
                            const liberties = this.groupLiberties(board, group);
                            let dead = liberties.size === 0;
                            if (!dead && liberties.size <= maxWeakLiberties) {
                                dead = true;
                                for (const key of liberties) {
                                    const lr = this.keyRow(key), lc = this.keyCol(key);
                                    const enemies = val === NEUTRAL ? [1, 2] : [3 - val];
                                    if (!enemies.some(color => this.isLibertySurroundedByOpponent(board, lr, lc, color))) { dead = false; break; }
                                }
                            }
                            if (dead) {
                                for (const [rr, cc] of group) board[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
                return board;
            }

            /** 数点：子 + 领地（非方格按几何遍历） */
            computeScore(liveBoard, territory) {
                if (!this.geom) {
                    const RT = window.QiWeiqiSquarePageRuntime;
                    return RT.computeScore ? RT.computeScore(liveBoard, territory, this.boardSize)
                        : { blackTotal: 0, whiteTotal: 0 };
                }
                let blackTotal = 0, whiteTotal = 0;
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (!this.inBounds(r, c)) continue;
                        const v = liveBoard[r][c];
                        if (v === 1) blackTotal++;
                        else if (v === 2) whiteTotal++;
                        if (v === 0 && territory && territory[r]) {
                            if (territory[r][c] === 1) blackTotal++;
                            else if (territory[r][c] === 2) whiteTotal++;
                        }
                    }
                }
                return { blackTotal, whiteTotal };
            }

            /** 归属（限定步数内更近者得，更远算公共） */
            assignTerritory(liveBoard) {
                const territory = this.newGrid(0);
                const stepNeighbors = (row, col) => {
                    const out = [];
                    const seen = new Set();
                    const n = this.rayDirs;
                    for (let d = 0; d < n; d++) {
                        const p = this.resolveBridgeStep(liveBoard, row, col, d);
                        if (!p) continue;
                        if (isExtraVal(liveBoard[p[0]][p[1]])) continue;
                        const key = this.keyOf(p[0], p[1]);
                        if (seen.has(key)) continue;
                        seen.add(key);
                        out.push(p);
                    }
                    return out;
                };
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        if (!this.inBounds(r, c) || liveBoard[r][c] !== 0) continue;
                        const maxDist = (r <= 1 || r >= this.rows - 2 || c <= 1 || c >= this.cols - 2) ? 5 : 4;
                        let blackMin = Infinity, whiteMin = Infinity;
                        const dist = this.newGrid(Infinity);
                        dist[r][c] = 0;
                        const queue = [[r, c]];
                        let front = 0;
                        while (front < queue.length) {
                            const [cr, cc] = queue[front++];
                            const d = dist[cr][cc];
                            if (d > maxDist) continue;
                            if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                            if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                            for (const [nr, nc] of stepNeighbors(cr, cc)) {
                                if (dist[nr][nc] !== Infinity) continue;
                                dist[nr][nc] = d + 1;
                                queue.push([nr, nc]);
                            }
                        }
                        if (blackMin <= maxDist && whiteMin <= maxDist) {
                            if (blackMin < whiteMin) territory[r][c] = 1;
                            else if (whiteMin < blackMin) territory[r][c] = 2;
                            else territory[r][c] = 3;
                        } else if (blackMin <= maxDist) territory[r][c] = 1;
                        else if (whiteMin <= maxDist) territory[r][c] = 2;
                        else territory[r][c] = 3;
                    }
                }
                return territory;
            }
        }

// ======================== 页面状态 ========================
        const ps = {
            BOARD_SIZE: 19,
            KOMI: 3.25,
            PADDING: 0,
            CELL_SIZE: 0,
            numberOfHands: 1,
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastMoveMarkers: [],
            /** 「对称点」本手用的对称轴（服务端下发）与启用的对称集合 */
            symmetryAxis: null,
            enabledSymmetries: null,
            /** 试下分支里本地推演的对称轴（试下的第二子/禁点用） */
            tryPlayAxis: null,
            showEstimateActive: false,
            cachedLiveBoard: null,
            cachedTerritory: null,
            waitingScoreConfirm: false,
            iRejected: false,
            ws: null,
            isMyTurn: false,
            slots: { player1: false, player2: false },
            reconnectTimer: null,
            replayMode: false,
            replayBoards: [],
            replayMarkers: [],
            replayStepPlayers: [],
            replayStep: 0,
            replayTotalSteps: 0,
            showMoveNumbers: false,
            moveLog: [],
            tryPlayMode: false,
            tryPlayBaseStep: 0,
            tryPlayBoards: [],
            tryPlayMarkers: [],
            tryPlayCurrentPlayer: 1,
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            liveReplayBoards: [],
            liveReplayMarkers: [],
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            /** 棋盘局部缩放（与自定义围棋的视口变换配合） */
            viewZoom: 1,
            viewCenterX: 300,
            viewCenterY: 300,
            /** 自定义规则配置（服务端下发）+ 规则核心实例 */
            customRules: defaultCustomConfig(),
            rules: null,
            /** 贪吃：必须走的提子最多点（服务端下发） */
            candidates: [],
            /** 显示序号/回放用：完整着法序列 */
            moveCoordsFull: [],
            replayMovesFull: null
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.rules = new CustomRules(ps.BOARD_SIZE, ps.customRules);
            if (ps.rules.geom) {
                ps.board = ps.rules.emptyBoard();
                shapeViewCache = null;
                const v = shapeView();
                if (v) { ps.PADDING = 0; ps.CELL_SIZE = v.cellSize; }
            } else {
                ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            }
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        // DOM
        const komiInfo = document.getElementById('komiInfo');
        const canvas = document.getElementById('goBoard');
        const ctx = canvas.getContext('2d');
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
        const scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');
        const customRulesBtn = document.getElementById('customRulesBtn');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const BOARD_VIEW_CS = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
        let boardScrollbarProgrammatic = false;

        function viewCenterBoundsForScrollbars() {
            const z = Math.max(1, Math.min(10, ps.viewZoom || 1));
            const half = (BOARD_VIEW_CS / 2) / z;
            return {
                minX: half,
                maxX: BOARD_VIEW_CS - half,
                minY: half,
                maxY: BOARD_VIEW_CS - half
            };
        }

        function clampBoardView() {
            let z = ps.viewZoom;
            if (!Number.isFinite(z)) z = 1;
            z = Math.max(1, Math.min(10, z));
            ps.viewZoom = z;
            if (z <= 1) {
                ps.viewCenterX = BOARD_VIEW_CS / 2;
                ps.viewCenterY = BOARD_VIEW_CS / 2;
                return;
            }
            const half = (BOARD_VIEW_CS / 2) / z;
            ps.viewCenterX = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterX));
            ps.viewCenterY = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterY));
        }

        /** 落座蒙版显示时不允许缩放（含对局中途再入座） */
        function boardViewZoomAllowed() {
            const o = document.querySelector('.board-container > .qi-seat-overlay');
            return !(o && !o.hidden);
        }

        function resetBoardViewZoom() {
            ps.viewZoom = 1;
            ps.viewCenterX = BOARD_VIEW_CS / 2;
            ps.viewCenterY = BOARD_VIEW_CS / 2;
            syncScrollbarsFromView();
            boardUpdateGrabCursor();
        }

        function applyZoomKeepingScreenPoint(ssx, ssy, zNew) {
            const z0 = ps.viewZoom;
            const cs = BOARD_VIEW_CS;
            const Lx = (ssx - cs / 2) / z0 + ps.viewCenterX;
            const Ly = (ssy - cs / 2) / z0 + ps.viewCenterY;
            ps.viewZoom = zNew;
            ps.viewCenterX = Lx - (ssx - cs / 2) / zNew;
            ps.viewCenterY = Ly - (ssy - cs / 2) / zNew;
            clampBoardView();
        }

        function syncScrollbarsFromView() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            if (ps.viewZoom <= 1) {
                sx.style.display = 'none';
                sy.style.display = 'none';
                return;
            }
            sx.style.display = 'block';
            sy.style.display = 'block';
            const b = viewCenterBoundsForScrollbars();
            const spanX = b.maxX - b.minX;
            const spanY = b.maxY - b.minY;
            boardScrollbarProgrammatic = true;
            sx.value = spanX > 1e-6 ? String(Math.round((ps.viewCenterX - b.minX) / spanX * 1000)) : '500';
            sy.value = spanY > 1e-6 ? String(Math.round((b.maxY - ps.viewCenterY) / spanY * 1000)) : '500';
            boardScrollbarProgrammatic = false;
        }

        const domPage = {
            turnDisplay,
            scoreTitle,
            scoreBoard,
            leadInfo,
            scoreConfirmPanel,
            scoreConfirmText,
            komiInfo,
            canvas,
            ctx,
            boardMarkSelect,
            colorStatus
        };

        function rebuildRules(force) {
            const next = new CustomRules(ps.BOARD_SIZE, ps.customRules);
            if (!force && ps.rules && ps.rules.key() === next.key()) return false;
            ps.rules = next;
            shapeViewCache = null;
            if (ps.rules.geom) {
                const v = shapeView();
                if (v) { ps.PADDING = 0; ps.CELL_SIZE = v.cellSize; }
            }
            return true;
        }

        // ---------------- 形势判断（自定义规则版 + Benson 加成） ----------------
        const bensonCopyBoard = (b) => b.map((row) => row.slice());
        function bensonLiveBoardLocal(srcBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            if (ps.rules && ps.rules.geom) {
                // 非方格：直接用规则核心的去死子（Benson 与几何无关的近似口径）
                return ps.rules.removeDeadAndDying(srcBoard);
            }
            const isWall = (r, c) => isExtraVal(srcBoard[r][c]);
            const benson = RT.bensonAliveWithHoles(srcBoard, ps.BOARD_SIZE, isWall);
            let live = bensonCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                const cleaned = ps.rules.removeDeadAndDying(live);
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        const v = srcBoard[r][c];
                        if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                            cleaned[r][c] = v;
                            changed = true;
                        }
                    }
                }
                live = cleaned;
            }
            return live;
        }
        function assignTerritoryLocal(liveBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            if (ps.rules && ps.rules.geom) return ps.rules.assignTerritory(liveBoard);
            const territory = ps.rules.assignTerritory(liveBoard);
            const secure = RT.bensonAliveWithHoles(liveBoard, ps.BOARD_SIZE, (r, c) => isExtraVal(liveBoard[r][c]));
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
                }
            }
            return territory;
        }

        // ---------------- 手数编号（磁性会移动棋子，编号要跟着子走） ----------------
        function emptyNumGrid(n) {
            if (ps.rules && ps.rules.geom) return ps.rules.newGrid(0);
            return Array(n).fill().map(() => Array(n).fill(0));
        }
        function openingBoardForReplay() {
            const n = ps.BOARD_SIZE;
            const ob = ps.liveOpeningBoard;
            if (ps.rules && ps.rules.geom && ps.rules.rows) {
                const rows = ps.rules.rows;
                if (Array.isArray(ob) && ob.length === rows) return QiSquareWeiqiCanvas.deepCopyBoard(ob);
                return ps.rules.emptyBoard();
            }
            if (Array.isArray(ob) && ob.length === n && Array.isArray(ob[0]) && ob[0].length === n) {
                return QiSquareWeiqiCanvas.deepCopyBoard(ob);
            }
            return QiSquareWeiqiCanvas.initBoardArray(n);
        }
        /**
         * 重放棋谱到第 `upto` 手（不含）时，本手（下标 idx）的「不邻前手」参考点：
         * 取该手之前**实际落下**的棋子（己方模式取该方最近一手实际落子的），没落子 → 无参考。
         */
        function replayBanRefPoints(moves, idx, playerVal) {
            if (!ps.customRules || ps.customRules.prevRule === 'none') return [];
            const meta = PREV_RULES[ps.customRules.prevRule] || PREV_RULES.none;
            const slot = playerVal === 2 ? 'player2' : 'player1';
            for (let i = idx - 1; i >= 0; i--) {
                const m = moves[i];
                if (!m) continue;
                if (meta.own && m.player !== slot) continue;
                if (m.type !== 'move') return [];
                const out = [{ row: m.row, col: m.col }];
                if (Number.isInteger(m.symRow) && Number.isInteger(m.symCol)) out.push({ row: m.symRow, col: m.symCol });
                return out;
            }
            return [];
        }

        /**
         * 实战回放（左侧历史、试下基准）：与「序号」重放同源，逐手用棋谱里记下的对称轴与参考点，
         * 这样带对称点时回放出的盘面也与实战一致（含对称点第二子、踩雷消雷）。
         */
        function rebuildLiveCustom(moveCoords) {
            const shape = ps.customRules && ps.customRules.boardShape;
            // 异形盘但几何还没下发：先别重建（否则会按方盘建出小一圈的盘面，落子时越界）
            if (shape && shape !== 'square' && !(ps.rules && ps.rules.geom)) return;
            const mcs = moveCoords || [];
            ps.liveReplayBoards = [];
            ps.liveReplayMarkers = [];
            ps.liveReplayStepPlayers = [0];
            let cur = openingBoardForReplay();
            ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(cur));
            ps.liveReplayMarkers.push([]);
            for (let i = 0; i < mcs.length; i++) {
                const mv = mcs[i];
                if (!mv) continue;
                const pv = mv.player === 'player1' ? 1 : 2;
                ps.liveReplayStepPlayers.push(pv);
                if (mv.type === 'move') {
                    const extra = {
                        symmetryAxis: mv.symmetryAxis || null,
                        prevPoints: replayBanRefPoints(mcs, i, pv)
                    };
                    const res = ps.rules.placeStone(cur, mv.row, mv.col, pv, { skipGreedy: true, ...extra });
                    if (res && res.board) cur = res.board;
                    const mk = [{ row: mv.row, col: mv.col, color: pv }];
                    if (extra.symmetryAxis) {
                        const sp = ps.rules.getSymmetryPoint(mv.row, mv.col, extra.symmetryAxis);
                        if (!(sp.row === mv.row && sp.col === mv.col) && cur[sp.row] && cur[sp.row][sp.col] === pv) {
                            mk.push({ row: sp.row, col: sp.col, color: pv });
                        }
                    }
                    ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(cur));
                    ps.liveReplayMarkers.push(mk);
                } else if (mv.type === 'mineHit') {
                    cur = QiSquareWeiqiCanvas.deepCopyBoard(cur);
                    if (cur[mv.row] && cur[mv.row][mv.col] === MINE) cur[mv.row][mv.col] = 0;
                    ps.liveReplayBoards.push(cur);
                    ps.liveReplayMarkers.push([{ row: mv.row, col: mv.col, color: pv }]);
                } else {
                    ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(cur));
                    ps.liveReplayMarkers.push([]);
                }
            }
        }

        function applyMoveSequenceForNumbers(moves, upTo) {
            const shape = ps.customRules && ps.customRules.boardShape;
            if (shape && shape !== 'square' && !(ps.rules && ps.rules.geom)) return ps.rules ? ps.rules.newGrid(0) : [];
            const n = ps.BOARD_SIZE;
            let numGrid = emptyNumGrid(n);
            let board = openingBoardForReplay();
            let mi = 0;
            const lim = upTo == null ? moves.length : upTo;
            for (let j = 0; j < lim; j++) {
                const mv = moves[j];
                if (!mv) continue;
                if (mv.type === 'pass') continue;
                if (mv.type === 'mineHit') {
                    const row = board[mv.row];
                    if (row && row[mv.col] === MINE) {
                        board = QiSquareWeiqiCanvas.deepCopyBoard(board);
                        board[mv.row][mv.col] = 0;
                    }
                    continue;
                }
                if (mv.type !== 'move') continue;
                mi++;
                const pv = mv.player === 'player1' ? 1 : 2;
                // 对称点：用棋谱里记下的本手对称轴；「不邻前手」按棋谱前缀给出参考点
                const extra = {
                    symmetryAxis: mv.symmetryAxis || null,
                    prevPoints: replayBanRefPoints(moves, j, pv)
                };
                const res = ps.rules.placeStone(board, mv.row, mv.col, pv, { numGrid, moveNum: mi, skipGreedy: true, ...extra });
                if (res && res.board) { board = res.board; numGrid = res.numGrid || numGrid; }
            }
            return numGrid;
        }
        function computeCustomStoneNumbers() {
            if (ps.replayMode && ps.tryPlayMode) {
                let board = openingBoardForReplay();
                let numGrid = emptyNumGrid(ps.BOARD_SIZE);
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        const res = ps.rules.placeStone(board, m.row, m.col, m.color, { numGrid, moveNum: i, skipGreedy: true });
                        if (res && res.board) { board = res.board; numGrid = res.numGrid || numGrid; }
                    }
                }
                return numGrid;
            }
            if (ps.replayMode) return applyMoveSequenceForNumbers(ps.replayMovesFull || [], ps.replayStep);
            if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                return applyMoveSequenceForNumbers(ps.moveCoordsFull || [], ps.liveViewStep);
            }
            return applyMoveSequenceForNumbers(ps.moveCoordsFull || [], null);
        }

        // ---------------- 贪吃：必须走的提子最多点（服务端下发） ----------------
        function browsingLiveHistory() {
            const tip = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            return !ps.replayMode && ps.liveReplayBoards.length > 0 && ps.liveViewStep < tip;
        }
        function mustCaptureActive() {
            return !!ps.customRules.greedy && !ps.tryPlayMode && !ps.gameOver && !ps.showEstimateActive
                && !browsingLiveHistory() && ps.candidates.length > 0;
        }
        function isCandidatePoint(row, col) {
            return ps.candidates.some(p => p.row === row && p.col === col);
        }

        // ---------------- 绘制 ----------------
        /**
         * 「对称点」的当前对称轴：四种轴对称画贯穿棋盘的镜像线，三种旋转在棋盘中心画弧 + 箭头。
         * 圆/箭头尺寸随格宽缩放（19 路时≈对称围棋的观感：半径 ≈80px、箭头 20×16px）。
         */
        function drawSymmetryAxis(g, cellSize) {
            if (!ps.customRules || !ps.customRules.symmetry) return;
            const axis = ps.symmetryAxis;
            if (!axis || ps.showEstimateActive) return;
            const last = ps.BOARD_SIZE - 1;
            const P = ps.PADDING;
            const color = ps.currentPlayer === 1 ? '#000000' : '#ffffff';
            g.save();
            g.lineWidth = 3;
            g.strokeStyle = color;
            g.fillStyle = color;
            g.shadowBlur = 4;
            g.shadowColor = ps.currentPlayer === 1 ? '#aaa' : '#333';
            g.shadowOffsetY = 1;
            g.setLineDash([]);
            const show = (r, c) => ({ x: P + c * cellSize, y: P + (last - r) * cellSize });
            if (axis.indexOf('rotate') !== 0) {
                let pa = null, pb = null;
                const mid = last / 2;
                if (axis === 'horizontal') { pa = show(mid, 0); pb = show(mid, last); }
                else if (axis === 'vertical') { pa = show(0, mid); pb = show(last, mid); }
                else if (axis === 'diag1') { pa = show(0, 0); pb = show(last, last); }
                else if (axis === 'diag2') { pa = show(0, last); pb = show(last, 0); }
                if (pa && pb) {
                    g.beginPath();
                    g.moveTo(pa.x, pa.y);
                    g.lineTo(pb.x, pb.y);
                    g.stroke();
                }
                g.restore();
                return;
            }
            // 三种旋转：中心画弧 + 终点箭头（根部对齐弧终点）
            const cx = P + last * cellSize / 2;
            const cy = P + last * cellSize / 2;
            const r = cellSize * 2.6;
            const D = Math.PI / 180;
            const h2a = (h) => (h - 3) * 30 * D;      // 点钟 → 画布角度（y 轴向下）
            let start, end, anticlockwise;
            if (axis === 'rotate90cw') { start = h2a(6); end = h2a(9); anticlockwise = true; }
            else if (axis === 'rotate90ccw') { start = h2a(6); end = h2a(3); anticlockwise = false; }
            else { start = h2a(6); end = h2a(12); anticlockwise = true; }   // rotate180：6 点起逆时针到 12 点
            g.beginPath();
            g.arc(cx, cy, r, start, end, anticlockwise);
            g.stroke();
            const sign = anticlockwise ? -1 : 1;
            const tx = sign * -Math.sin(end), ty = sign * Math.cos(end);
            const bx = cx + Math.cos(end) * r, by = cy + Math.sin(end) * r;
            const nx = -ty, ny = tx;
            const AL = cellSize * 0.68, AW = cellSize * 0.52;
            g.beginPath();
            g.moveTo(bx + tx * AL, by + ty * AL);
            g.lineTo(bx + nx * (AW / 2), by + ny * (AW / 2));
            g.lineTo(bx - nx * (AW / 2), by - ny * (AW / 2));
            g.closePath();
            g.fill();
            g.restore();
        }

        function customDrawBoard() {
            syncWoodFrameVisibility();
            if (ps.rules && ps.rules.geom) {    // 非方格形状：整盘自绘（几何来自服务端下发）
                drawShapeBoard();
                syncScrollbarsFromView();
                return;
            }
            const C = QiSquareWeiqiCanvas;
            const d = C.draw;
            const cs = BOARD_VIEW_CS;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            const zRaw = ps.viewZoom;
            const z = typeof zRaw === 'number' && zRaw >= 1 ? Math.min(10, zRaw) : 1;
            const vcx = typeof ps.viewCenterX === 'number' ? ps.viewCenterX : cs / 2;
            const vcy = typeof ps.viewCenterY === 'number' ? ps.viewCenterY : cs / 2;
            const useView = z > 1;
            const invZ = useView ? 1 / z : 1;
            if (useView) {
                ctx.save();
                ctx.translate(cs / 2, cs / 2);
                ctx.scale(z, z);
                ctx.translate(-vcx, -vcy);
            }
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs, useView ? invZ : undefined);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            drawSymmetryAxis(ctx, cellSize);
            // 附加物（照全家福围棋：洞/桥/中立子/雷）
            const RT = window.QiWeiqiSquarePageRuntime;
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    const v = ps.board[r][c];
                    if (v === HOLE) {
                        if (RT.drawRedBlockHole) RT.drawRedBlockHole(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE);
                    } else if (v === BRIDGE) {
                        if (RT.drawBridge) RT.drawBridge(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE);
                    } else if (v === NEUTRAL) {
                        if (RT.drawNeutralStone) RT.drawNeutralStone(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE);
                    } else if (v === MINE) {
                        if (RT.drawMine) RT.drawMine(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE);
                    }
                }
            }
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers, useView ? invZ : undefined);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, (r, c) => {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                if (mustCaptureActive() && isCandidatePoint(r, c)) return false;
                return true;
            });
            if (ps.showMoveNumbers) {
                d.moveNumbersOnStones(ctx, computeCustomStoneNumbers(), ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            drawBannedCrosses(ctx, cellSize, (row, col) => ({
                x: ps.PADDING + col * cellSize,
                y: ps.PADDING + (ps.BOARD_SIZE - 1 - row) * cellSize
            }));
            if (mustCaptureActive()) {
                ctx.globalAlpha = 0.7;
                const playerColor = ps.currentPlayer === 1 ? '#222' : '#fff';
                const sh = cellSize * 0.18;
                for (const { row, col } of ps.candidates) {
                    const x = ps.PADDING + col * cellSize;
                    const y = ps.PADDING + (ps.BOARD_SIZE - 1 - row) * cellSize;
                    ctx.fillStyle = playerColor;
                    ctx.fillRect(x - sh, y - sh, sh * 2, sh * 2);
                }
                ctx.globalAlpha = 1;
            }
            const hr = ps.hoverRow, hc = ps.hoverCol;
            const hoverCell = hr >= 0 && hc >= 0 ? ps.board[hr][hc] : null;
            const hoverValidCell = hr >= 0 && hc >= 0 && (hoverCell === 0 || hoverCell === MINE);
            const hoverStoneValidEmpty = hr >= 0 && hc >= 0 && hoverCell === 0 && ps.isHoverValid && hoverValidCell;
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: hoverStoneValidEmpty,
                hoverCapture: !!ps.hoverCapture,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool
            });
            if (hoverValidCell && hoverCell === MINE && ps.isHoverValid && !ps.hoverCapture) {
                const canMineHover = ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn);
                if (canMineHover) {
                    // 数据 row 0 在底边 → y 要按 (路数−1−row) 换算（原先直接乘 row，环画在了上下镜像的位置）
                    const cx = ps.PADDING + hc * cellSize;
                    const cy = ps.PADDING + (ps.BOARD_SIZE - 1 - hr) * cellSize;
                    QiWeiqiSquarePageRuntime.stoneDanger.drawRing(ctx, cx, cy, cellSize * 0.44, '#d62828', cellSize * 0.055);
                }
            }
            // 对称点同步悬停（用本手的对称轴；空点画预览子、雷画危险环、洞/桥/中立子/已有子不画）
            if (hoverStoneValidEmpty && ps.customRules && ps.customRules.symmetry && ps.symmetryAxis) {
                const sp = ps.rules.getSymmetryPoint(hr, hc, ps.symmetryAxis);
                const spCell = (ps.board[sp.row] || [])[sp.col];
                if (!(sp.row === hr && sp.col === hc)) {
                    if (spCell === 0) {
                        d.hoverPreviewStone(ctx, sp.row, sp.col, ps.board, ps.PADDING, cellSize, {
                            tryPlayMode: ps.tryPlayMode,
                            tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                            gameOver: ps.gameOver,
                            isMyTurn: ps.isMyTurn,
                            mySlot: ps.mySlot,
                            isHoverValid: true,
                            hoverCapture: false,
                            pageState: ps,
                            editModeEnabled: !!ps.editModeEnabled,
                            editTool: ps.editTool
                        });
                    } else if (spCell === MINE) {
                        const scx = ps.PADDING + sp.col * cellSize;
                        const scy = ps.PADDING + (ps.BOARD_SIZE - 1 - sp.row) * cellSize;
                        QiWeiqiSquarePageRuntime.stoneDanger.drawRing(ctx, scx, scy, cellSize * 0.44, '#d62828', cellSize * 0.055);
                    }
                }
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
            if (useView) ctx.restore();
        }

        const pageHolder = {};
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            removeDeadAndDying: bensonLiveBoardLocal,
            assignTerritoryWithRange: assignTerritoryLocal,
            // 数点：非方格按几何；方格仍走公共运行时的口径（避免动到平盘行为）
            computeScore: (liveBoard, territory) => (ps.rules && ps.rules.geom
                ? ps.rules.computeScore(liveBoard, territory)
                : QiWeiqiSquarePageRuntime.computeScore(liveBoard, territory, ps.BOARD_SIZE)),
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            // 试下不受贪吃限制（与贪吃围棋一致）；正式落子由服务端裁判
            // 对称点：试下用「本手轴 + 试下分支里本地推演的轴」同时落两子（分支里的轴是本地猜的，实战轴由服务端下发）
            tryPlaceStone: (boardBefore, row, col, playerVal) => {
                const extra = ps.tryPlayMode
                    ? { symmetryAxis: tryPlayAxisForStep(ps.tryPlayStep), prevPoints: [] }
                    : { symmetryAxis: ps.symmetryAxis, prevPoints: banRefPointsFor(playerVal) };
                return ps.rules.tryPlaceStone(boardBefore, row, col, playerVal, { skipGreedy: true, ...extra });
            },
            // 实战回放自建一份：逐手带上棋谱里记下的对称轴（否则回放会漏掉对称点第二子）
            rebuildLiveReplayFromMoveCoords: (moveCoords) => rebuildLiveCustom(moveCoords),
            drawBoard: customDrawBoard,
            // 编辑盘面的取点：非方格形状必须按几何取点（公共默认是方格交叉点算法，异形盘会错位/悬停失灵）
            editPickAtCanvas: (x, y) => ((ps.rules && ps.rules.geom) ? shapeHitTest(x, y) : getClosestIntersectionSquare(x, y)),
            komiInfoText: (p) => `黑贴白${p.KOMI}点`,
            getTotalPoints: () => {
                let specials = 0;
                const bd = ps.board;
                if (Array.isArray(bd)) {
                    for (const row of bd) {
                        if (!Array.isArray(row)) continue;
                        for (const v of row) if (v === HOLE || v === BRIDGE) specials++;
                    }
                }
                if (ps.rules && ps.rules.geom) return ps.rules.pointCount - specials;   // 非方格：盘上有效点数
                return ps.BOARD_SIZE * ps.BOARD_SIZE - specials;
            },
            afterDrawBoard: syncScrollbarsFromView,
            enterReplayMode(data) {
                ps.replayMovesFull = data.moves || [];
                // 导入回放：逐手带上棋谱里记下的对称轴与「不邻前手」参考点（builder 只对 move 项回调，故用 move 序号）
                const replayMoves = ps.replayMovesFull;
                let mi = 0;
                const extras = [];
                replayMoves.forEach((mv, idx) => {
                    if (!mv || mv.type !== 'move') return;
                    const pv = mv.player === 'player1' ? 1 : 2;
                    extras.push({ symmetryAxis: mv.symmetryAxis || null, prevPoints: replayBanRefPoints(replayMoves, idx, pv) });
                });
                const built = QiWeiqiSquarePageRuntime.buildReplayFromImportData(
                    data,
                    (boardBefore, row, col, playerVal) => {
                        const extra = extras[mi++] || {};
                        return ps.rules.tryPlaceStone(boardBefore, row, col, playerVal, { skipGreedy: true, ...extra });
                    },
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    () => openingBoardForReplay(),
                    { isValid: (r, cc) => !!(ps.rules && ps.rules.inBounds(r, cc)) }
                );
                ps.replayBoards = built.replayBoards;
                ps.replayMarkers = built.replayMarkers;
                ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps;
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                pageHolder.page.setReplayStep(ps.replayTotalSteps);
                pageHolder.page.updateReplayUI();
            }
        });
        pageHolder.page = page;
        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard: drawBoardCore,
            updateTurn,
            showEstimate,
            clearEstimate,
            downloadRecord,
            showScoreConfirm,
            hideScoreConfirm,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            updateReplayUI,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove: tryPlayMoveBase,
            setTryPlayStep,
            updateTryPlayDisplay,
            rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard,
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState: syncStateBase,
            commitMove,
            getClosestIntersection: getClosestIntersectionSquare,
            canvasCoordsFromClient,
            boardScreenPointFromClient,
            applyUserBoardMark,
            updateEditModeUI,
            clearEditModeUi
        } = page;

        /** 取点：非方格形状按几何最近点，方格走原来的方格算法 */
        function getClosestIntersection(x, y) {
            if (ps.rules && ps.rules.geom) return shapeHitTest(x, y);
            return getClosestIntersectionSquare(x, y);
        }

        // ---------------- 试下 / 正式落子的踩雷处理（照全家福围棋） ----------------
        function customTryPlayMove(row, col) {
            if (ps.board[row][col] === MINE) {
                const playerVal = ps.tryPlayCurrentPlayer;
                const nb = QiSquareWeiqiCanvas.deepCopyBoard(ps.board);
                nb[row][col] = 0;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(nb));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = nb;
                ps.lastMoveMarkers = [{ row, col, color: playerVal }];
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                updateTryPlayDisplay();
                if (ps.showEstimateActive) showEstimate();
                else drawBoardCore();
                return true;
            }
            return tryPlayMoveBase(row, col);
        }
        /** 「不邻前手」参考点：上一手**实际落下**的棋子（己方模式取该方最近一手实际落子的） */
        function banRefPointsFor(playerVal) {
            if (!ps.customRules || ps.customRules.prevRule === 'none') return [];
            const mcs = ps.moveCoordsFull || [];
            const meta = PREV_RULES[ps.customRules.prevRule] || PREV_RULES.none;
            const slot = playerVal === 2 ? 'player2' : 'player1';
            for (let i = mcs.length - 1; i >= 0; i--) {
                const m = mcs[i];
                if (!m) continue;
                if (meta.own && m.player !== slot) continue;
                if (m.type !== 'move') return [];
                const out = [{ row: m.row, col: m.col }];
                if (Number.isInteger(m.symRow) && Number.isInteger(m.symCol)) out.push({ row: m.symRow, col: m.symCol });
                return out;
            }
            return [];
        }

        /** 试下分支里第 step 步用的对称轴：第 0 步 = 实战下一手的轴，之后本地随机（每步缓存，避免重绘时变来变去） */
        function tryPlayAxisForStep(step) {
            if (!ps.customRules || !ps.customRules.symmetry) return null;
            if (!Array.isArray(ps.tryPlayAxisCache) || step === 0) ps.tryPlayAxisCache = [];
            if (!ps.tryPlayAxisCache[step]) {
                ps.tryPlayAxisCache[step] = step === 0
                    ? (ps.symmetryAxis || (ps.rules && ps.rules.geom ? ps.rules.nextSymmetryAxis(3) : CustomRules.nextSymmetryAxis(3)))
                    : CustomRules.nextSymmetryAxis(3);
            }
            return ps.tryPlayAxisCache[step];
        }

        /** 本手是否触犯「不邻前手」（服务端会静默拒绝，客户端先挡） */
        function isBannedCell(row, col) {
            if (!ps.customRules || ps.customRules.prevRule === 'none') return false;
            if (!ps.rules) return false;
            const playerVal = ps.currentPlayer === 2 ? 2 : 1;
            return ps.rules.isBannedByPrev(ps.board, row, col, banRefPointsFor(playerVal));
        }

        function canPlayCell(row, col) {
            const v = ps.board[row][col];
            if (!(v === 0 || v === MINE)) return false;
            if (!ps.tryPlayMode && isBannedCell(row, col)) return false;
            return true;
        }
        function customCommitMove(row, col) {
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return false;
            if (!canPlayCell(row, col)) return false;
            // 贪吃：必须走提子最多的点（踩雷也等同虚着，一并受限，与服务端同口径）
            if (mustCaptureActive() && !isCandidatePoint(row, col)) {
                if (typeof qiAlert === 'function') qiAlert('必须提子');
                return false;
            }
            ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        // ---------------- 自定义规则对话框 ----------------
        let rulesModal = null;
        let rulesModalUi = null;

        function rulesGateLocked() {
            return !!(ps.gameOver || ps.slots.player1 || ps.slots.player2
                || ps.numberOfHands > 1
                || ps.board.some(row => row.some(v => v === 1 || v === 2)));
        }

        function updateCustomRulesButton() {
            if (!customRulesBtn) return;
            // 开局后按钮仍可点开（只是对话框里的选项全部不可改）
            customRulesBtn.disabled = false;
            customRulesBtn.title = rulesGateLocked()
                ? '查看当前规则（开局后不能修改）'
                : '设置短气／磁性／附加物／贪吃';
        }

        function ensureRulesModal() {
            if (rulesModal) return rulesModal;
            const wrap = document.createElement('div');
            wrap.className = 'qi-time-control-modal custom-rules-modal';
            wrap.innerHTML = `
<div class="qi-time-control-dialog" role="dialog" aria-modal="true">
  <button type="button" class="qi-time-control-close" id="customRulesClose" aria-label="关闭">&times;</button>
  <h3 class="qi-time-control-title">自定义规则</h3>
  <div class="custom-rules-row"><span class="custom-rules-label">棋盘形状</span>
    <select id="customBoardShape" class="board-size-select">
      <option value="square">四角</option>
      <option value="triangle">三角</option>
      <option value="snub">扭棱四角</option>
      <option value="cairo">开罗五角</option>
      <option value="floret">花形五角</option>
      <option value="hexagon">六角</option>
    </select>
  </div>
  <div class="custom-rules-row"><span class="custom-rules-label">短气</span>
    <select id="customShortLiberty" class="board-size-select">
      <option value="1">无</option>
      <option value="2">短一气</option>
      <option value="3">短二气</option>
      <option value="4">短三气</option>
    </select>
  </div>
  <div class="custom-rules-row"><span class="custom-rules-label">磁性</span>
    <select id="customMagnetism" class="board-size-select">
      <option value="none">无</option>
      <option value="weak">弱磁性</option>
      <option value="medium">中磁性</option>
      <option value="strong">强磁性</option>
    </select>
  </div>
  <div class="custom-rules-extras">
    <label class="custom-rules-check"><input type="checkbox" id="customExtraHole"> 添加洞</label>
    <label class="custom-rules-check"><input type="checkbox" id="customExtraBridge"> 添加桥</label>
    <label class="custom-rules-check"><input type="checkbox" id="customExtraNeutral"> 添加中立子</label>
    <label class="custom-rules-check"><input type="checkbox" id="customExtraMine"> 添加雷</label>
  </div>
  <div class="custom-rules-row">
    <label class="custom-rules-check"><input type="checkbox" id="customGreedy"> 贪吃</label>
    <label class="custom-rules-check"><input type="checkbox" id="customSymmetry"> 对称点</label>
  </div>
  <div class="custom-rules-row"><span class="custom-rules-label">不邻前手</span>
    <select id="customPrevRule" class="board-size-select">
      <option value="none">无</option>
      <option value="adjacent">不邻前手</option>
      <option value="adjacent-own">不邻己方前手</option>
      <option value="near">不近前手</option>
      <option value="near-own">不近己方前手</option>
    </select>
  </div>
  <div class="qi-time-control-footer">
    <button type="button" class="qi-time-control-primary" id="customRulesOk">确定</button>
    <button type="button" class="qi-time-control-secondary" id="customRulesCancel">取消</button>
  </div>
</div>`;
            document.body.appendChild(wrap);
            rulesModal = wrap;
            rulesModalUi = {
                boardShape: wrap.querySelector('#customBoardShape'),
                shortLiberty: wrap.querySelector('#customShortLiberty'),
                magnetism: wrap.querySelector('#customMagnetism'),
                hole: wrap.querySelector('#customExtraHole'),
                bridge: wrap.querySelector('#customExtraBridge'),
                neutral: wrap.querySelector('#customExtraNeutral'),
                mine: wrap.querySelector('#customExtraMine'),
                greedy: wrap.querySelector('#customGreedy'),
                symmetry: wrap.querySelector('#customSymmetry'),
                prevRule: wrap.querySelector('#customPrevRule'),
                ok: wrap.querySelector('#customRulesOk'),
                cancel: wrap.querySelector('#customRulesCancel'),
                close: wrap.querySelector('#customRulesClose')
            };
            rulesModalUi.cancel.onclick = hideRulesModal;
            rulesModalUi.close.onclick = hideRulesModal;
            rulesModalUi.ok.onclick = submitRulesModal;
            wrap.addEventListener('click', (e) => { if (e.target === wrap) hideRulesModal(); });
            return wrap;
        }

        function showRulesModal() {
            ensureRulesModal();
            const ui = rulesModalUi;
            const cfg = normalizeCustomConfig(ps.customRules);
            ui.boardShape.value = BOARD_SHAPES.indexOf(cfg.boardShape) >= 0 ? cfg.boardShape : 'square';
            ui.shortLiberty.value = String(cfg.minLib);
            ui.magnetism.value = cfg.magnetism;
            ui.hole.checked = !!cfg.extras.hole;
            ui.bridge.checked = !!cfg.extras.bridge;
            ui.neutral.checked = !!cfg.extras.neutral;
            ui.mine.checked = !!cfg.extras.mine;
            ui.greedy.checked = !!cfg.greedy;
            ui.symmetry.checked = !!cfg.symmetry;
            ui.prevRule.value = PREV_RULE_KEYS.indexOf(cfg.prevRule) >= 0 ? cfg.prevRule : 'none';
            const locked = rulesGateLocked();
            // 开局后：对话框照常打开，但所有选项与「确定」都不可用（只读查看）
            const fields = [ui.boardShape, ui.shortLiberty, ui.magnetism, ui.hole, ui.bridge,
                ui.neutral, ui.mine, ui.greedy, ui.symmetry, ui.prevRule];
            for (const el of fields) {
                if (!el) continue;
                el.disabled = locked;      // input/select 都支持；开局后只读查看
            }
            ui.ok.disabled = locked;
            ui.cancel.textContent = locked ? '关闭' : '取消';
            rulesModal.style.display = 'flex';
        }

        function hideRulesModal() {
            if (rulesModal) rulesModal.style.display = 'none';
        }

        function submitRulesModal() {
            if (rulesGateLocked()) return;
            const ui = rulesModalUi;
            const cfg = {
                boardShape: ui.boardShape.value,
                minLib: parseInt(ui.shortLiberty.value, 10) || 1,
                magnetism: ui.magnetism.value,
                extras: {
                    hole: !!ui.hole.checked,
                    bridge: !!ui.bridge.checked,
                    neutral: !!ui.neutral.checked,
                    mine: !!ui.mine.checked
                },
                greedy: !!ui.greedy.checked,
                symmetry: !!ui.symmetry.checked,
                prevRule: ui.prevRule.value
            };
            if (ps.ws && ps.ws.readyState === WebSocket.OPEN) {
                ps.ws.send(JSON.stringify({ type: 'setCustomRules', config: cfg }));
            }
            hideRulesModal();
        }

        if (customRulesBtn) {
            customRulesBtn.hidden = false;
            customRulesBtn.addEventListener('click', showRulesModal);
            updateCustomRulesButton();
        }

        // ---------------- 状态同步 ----------------
        /** 按当前形状重建「路数」下拉（范围/默认值随形状变；不带路数的形状沿用该形状上次的值） */
        function rebuildBoardSizeOptions(selected) {
            const sel = document.getElementById('boardSizeSelect');
            if (!sel) return;
            const meta = shapeMetaOf(ps.customRules.boardShape);
            const cur = Number.isInteger(selected) ? selected : (Number(sel.value) || meta.def);
            const keep = Array.from(sel.options).map((o) => parseInt(o.value, 10)).join(',');
            const want = (() => {
                const a = [];
                for (let n = meta.min; n <= meta.max; n++) a.push(n);
                return a;
            })();
            if (keep !== want.join(',')) {
                sel.innerHTML = '';
                for (const n of want) {
                    const opt = document.createElement('option');
                    opt.value = String(n);
                    opt.textContent = n + '路';
                    sel.appendChild(opt);
                }
            }
            const v = Math.min(meta.max, Math.max(meta.min, cur));
            sel.value = String(v);
        }


        /**
         * 自画的木质外框（只有三角/六角的框是画出来的、且隐藏了壳的方形木纹）。
         * 开罗/扭棱没有框，花形的框只用于点击范围、木纹仍是壳的方形木纹——这三者蒙版都用四角。
         */
        function drawnShapeFrame() {
            const v = shapeView();
            if (!v || !v.frame) return null;
            const shape = v.geom && v.geom.shape;
            if (shape !== 'triangle' && shape !== 'hexagon') return null;
            return { verts: v.frame, cornerRadius: v.cornerRadius || 0 };
        }

        /** 当前行棋方的禁点（不邻前手）：邻点/近点都标灰叉 */
        function computeBannedPoints() {
            if (!ps.customRules || ps.customRules.prevRule === 'none') return [];
            if (ps.replayMode && !ps.tryPlayMode) return [];
            if (!ps.rules || !ps.board) return [];
            const playerVal = ps.tryPlayMode
                ? (ps.tryPlayCurrentPlayer === 2 ? 2 : 1)
                : (ps.currentPlayer === 2 ? 2 : 1);
            const set = ps.rules.bannedKeySet(ps.board, banRefPointsFor(playerVal));
            if (!set || !set.size) return [];
            const out = [];
            for (let r = 0; r < ps.rules.rows; r++) {
                for (let cc = 0; cc < ps.rules.cols; cc++) {
                    if (!ps.rules.inBounds(r, cc)) continue;
                    if (ps.board[r][cc] !== 0) continue;
                    if (set.has(ps.rules.keyOf(r, cc))) out.push({ row: r, col: cc });
                }
            }
            return out;
        }

        /** 禁点灰叉（照不邻前手围棋：木纹上黑白两方都看得清） */
        function drawBannedCrosses(g, cellSize, pointAt) {
            if (ps.showEstimateActive || ps.gameOver || ps.editModeEnabled) return;
            const banned = computeBannedPoints();
            if (!banned.length) return;
            const half = cellSize * 0.16;
            g.save();
            g.globalAlpha = 0.75;
            g.strokeStyle = '#3a281c';
            g.lineWidth = Math.max(1.5, cellSize * 0.055);
            for (const b of banned) {
                const pt = pointAt(b.row, b.col);
                if (!pt) continue;
                g.beginPath();
                g.moveTo(pt.x - half, pt.y - half);
                g.lineTo(pt.x + half, pt.y + half);
                g.moveTo(pt.x + half, pt.y - half);
                g.lineTo(pt.x - half, pt.y + half);
                g.stroke();
            }
            g.restore();
        }

        /** 换形状后让壳按新的蒙版多边形重画落座蒙版 */
        function refreshSeatOverlayIfAny() {
            // 壳只在创建蒙版与窗口 resize 时解析蒙版形状：换形状后补发一次 resize（照非四角围棋的做法）
            try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
        }

        /** 形状或路数变化：重建规则核心、棋盘与路数下拉；缺几何时向服务端要 */
        function onShapeOrSizeChanged(state) {
            const before = ps.rules ? ps.rules.key() : null;
            const changed = rebuildRules(true);
            if (ps.rules && ps.rules.geom) {
                ps.board = (ps.lastSyncedBoard && ps.lastSyncedBoard.length === ps.rules.rows)
                    ? ps.lastSyncedBoard : ps.rules.emptyBoard();
            } else if (ps.customRules.boardShape !== 'square') {
                ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            }
            rebuildBoardSizeOptions(ps.BOARD_SIZE);
            requestShapeGeometryIfNeeded();
            refreshSeatOverlayIfAny();
            return changed || before !== (ps.rules && ps.rules.key());
        }

        /** 非方格形状缺几何时向服务端要一份（服务端按 形状:路数 下发） */
        function requestShapeGeometryIfNeeded() {
            const shape = ps.customRules && ps.customRules.boardShape;
            if (!shape || shape === 'square') return;
            if (shapeGeomFor(shape, ps.BOARD_SIZE)) return;
            if (ps.ws && ps.ws.readyState === WebSocket.OPEN) {
                ps.ws.send(JSON.stringify({ type: 'requestShapeGeometry' }));
            }
        }

        function syncState(state) {
            if (state && state.customRules) ps.customRules = normalizeCustomConfig(state.customRules);
            if (state && Array.isArray(state.candidates)) {
                ps.candidates = state.candidates.map(c => ({ row: c.row, col: c.col }));
            }
            if (state && Array.isArray(state.moveCoords)) ps.moveCoordsFull = state.moveCoords;
            if (state && Object.prototype.hasOwnProperty.call(state, 'symmetryAxis')) {
                ps.symmetryAxis = state.symmetryAxis || null;
            }
            if (state && Array.isArray(state.enabledSymmetries)) ps.enabledSymmetries = state.enabledSymmetries.slice();

            const sizeBefore = ps.BOARD_SIZE;
            const shapeBefore = ps.rules && ps.rules.shape;
            if (shapeBefore && (state && state.customRules) && normalizeCustomConfig(state.customRules).boardShape !== shapeBefore) {
                ps.lastSyncedBoard = null;   // 换形状：旧盘面在新棋盘上不存在
            }
            syncStateBase(state);
            const shapeNow = ps.customRules.boardShape || 'square';
            if (shapeBefore !== shapeNow) {
                onShapeOrSizeChanged(state);          // 换形状：整盘重建 + 重铺路数下拉 + 请求几何
            } else {
                rebuildRules(false);
                if (sizeBefore !== ps.BOARD_SIZE) {
                    rebuildBoardSizeOptions(ps.BOARD_SIZE);
                    if (ps.rules.geom) ps.board = ps.rules.emptyBoard();
                }
            }
            if (state && Array.isArray(state.board)) ps.lastSyncedBoard = state.board;
            // 非方格形状：盘面直接用服务端下发的掩码盘（方格盘的尺寸/直播回放机制不适用于它）
            if (ps.rules && ps.rules.geom && state && Array.isArray(state.board)) {
                ps.board = state.board;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }
            requestShapeGeometryIfNeeded();
            if (sizeBefore !== ps.BOARD_SIZE || shapeBefore !== shapeNow) drawBoardCore();
            updateCustomRulesButton();
            if (typeof updateEditModeUI === 'function') updateEditModeUI();
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
                ps.candidates = [];
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard: drawBoardCore,
            boardSeatOverlay: true,
            // 落座蒙版与木质外框完全重合：三角/六角 = 自画的六角框（顶点直接给壳），其余 = 四角
            getSeatOverlayVertices: () => {
                const f = drawnShapeFrame();
                return f ? f.verts : null;
            },
            get seatOverlayShape() {
                const geom = ps.rules && ps.rules.geom;
                return (geom && (geom.shape === 'triangle' || geom.shape === 'hexagon')) ? 'hexagon' : 'square';
            },
            get seatOverlayCornerRadius() {
                const f = drawnShapeFrame();
                return f ? f.cornerRadius : 0;
            },
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ps.ws,
            getBoardSize: () => ps.BOARD_SIZE,
            setBoardSize: (n) => { ps.BOARD_SIZE = n; },
            getKomi: () => ps.KOMI,
            setKomi: (n) => { ps.KOMI = n; },
            getBoard: () => ps.board.map(row => row.map(v => (isExtraVal(v) ? 0 : v))),
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
            getShowEstimateActive: () => ps.showEstimateActive,
            setShowEstimateActive: (v) => { ps.showEstimateActive = v; },
            getWaitingScoreConfirm: () => ps.waitingScoreConfirm,
            setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
            getIRejected: () => ps.iRejected,
            setIRejected: (v) => { ps.iRejected = v; },
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
            boardSeatOverlay: true,
            onSeatOverlayUpdated({ visible }) {
                if (visible && ps.viewZoom > 1) resetBoardViewZoom();
            },
            onBoardSizeChanged(msg) { syncState(msg); }
        });
        const weiqiHandleMessageInner = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function lastMoveMarkerKey() {
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return '';
            return `${m.row},${m.col},${m.color}`;
        }

        function maybeCenterViewOnOpponentMove(msg, keyBefore) {
            if (ps.viewZoom <= 1 || !ps.mySlot || ps.replayMode || ps.tryPlayMode) return;
            if (msg.type !== 'broadcast' && msg.type !== 'gameState') return;
            if (msg.type === 'broadcast' && msg.action !== 'move') return;
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return;
            if (lastMoveMarkerKey() === keyBefore) return;
            const oppColor = ps.mySlot === 'player1' ? 2 : 1;
            if (m.color !== oppColor) return;
            ps.viewCenterX = ps.PADDING + m.col * ps.CELL_SIZE;
            ps.viewCenterY = ps.PADDING + m.row * ps.CELL_SIZE;
            clampBoardView();
            drawBoardCore();
        }

        /** 把服务端下发的盘面直接当作开局/展示盘面（改规则、开新局这类「无着法」的状态） */
        function adoptServerBoard(msg) {
            if (!msg || !Array.isArray(msg.board)) return;
            const copy = QiSquareWeiqiCanvas.deepCopyBoard(msg.board);
            ps.liveOpeningBoard = copy;
            ps.liveReplayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(msg.board)];
            ps.liveReplayMarkers = [[]];
            ps.liveReplayStepPlayers = [0];
            ps.liveViewStep = 0;
            ps.liveFollowLatest = true;
            ps.lastSyncedBoard = msg.board;
            if (!ps.tryPlayMode && !ps.replayMode) ps.board = msg.board;
            if (typeof rebuildLiveCustom === 'function' && Array.isArray(msg.moveCoords) && msg.moveCoords.length) {
                rebuildLiveCustom(msg.moveCoords);   // 有棋谱时按棋谱重建（新规则下的重演）
            }
        }

        function handleMessage(msg) {
            if (msg && msg.type === 'shapeGeometry') {
                const geom = installShapeGeometry(msg.geometry);
                if (geom && ps.customRules.boardShape === geom.shape && Number(ps.BOARD_SIZE) === Number(geom.lanes)) {
                    rebuildRules(true);
                    // 盘面用最近一次服务端下发的（尺寸对得上就用它，否则先给空盘等下一次同步）
                    if (ps.lastSyncedBoard && ps.lastSyncedBoard.length === ps.rules.rows) ps.board = ps.lastSyncedBoard;
                    else ps.board = ps.rules.emptyBoard();
                    shapeViewCache = null;
                    if (Array.isArray(ps.moveCoordsFull) && ps.moveCoordsFull.length) {
                        try { rebuildLiveCustom(ps.moveCoordsFull); } catch (e) { /* ignore */ }
                    }
                    refreshSeatOverlayIfAny();
                    drawBoardCore();
                }
                return;
            }
            if (msg && msg.type === 'customRulesChanged') {
                syncState(msg);
                // 改规则（尤其附加物）后：服务端下发的盘面就是权威盘面，
                // 否则壳的「最丰富开局盘」会挑中改规则前的旧盘面，洞/桥要等下次同步才出现
                adoptServerBoard(msg);
                drawBoardCore();
                return;
            }
            if (msg && msg.type === 'newGameStarted') {
                weiqiHandleMessageInner(msg);
                adoptServerBoard(msg);   // 开新局：附加物重随机，同样以服务端盘面为准
                drawBoardCore();
                return;
            }
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
            if (msg && msg.type === 'boardSizeChanged') updateRadioStyles();
            maybeCenterViewOnOpponentMove(msg, mkBefore);
        }

        let suppressCanvasClickAfterLongMark = false;
        let suppressCanvasClickAfterPan = false;

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }

        (function initWeiqiBoardScrollbars() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            function applyFromSliders() {
                if (boardScrollbarProgrammatic) return;
                if (ps.viewZoom <= 1) return;
                const b = viewCenterBoundsForScrollbars();
                const tx = Number(sx.value) / 1000;
                const ty = 1 - Number(sy.value) / 1000;
                ps.viewCenterX = b.minX + tx * (b.maxX - b.minX);
                ps.viewCenterY = b.minY + ty * (b.maxY - b.minY);
                clampBoardView();
                drawBoardCore();
            }
            sx.addEventListener('input', applyFromSliders);
            sy.addEventListener('input', applyFromSliders);
        })();

        canvas.addEventListener('wheel', (e) => {
            if (!boardViewZoomAllowed()) return;
            const z0 = ps.viewZoom;
            const z1 = Math.max(1, Math.min(10, z0 * Math.exp(-e.deltaY * 0.002)));
            if (Math.abs(z1 - z0) < 1e-8) return;
            e.preventDefault();
            const ss = boardScreenPointFromClient(e.clientX, e.clientY);
            applyZoomKeepingScreenPoint(ss.x, ss.y, z1);
            drawBoardCore();
        }, { passive: false });

        let boardMousePanning = false;
        let boardPanLastScreen = null;

        function boardUpdateGrabCursor() {
            if (boardMousePanning) {
                canvas.style.cursor = 'grabbing';
            } else {
                canvas.style.cursor = ps.viewZoom > 1 ? 'grab' : 'default';
            }
        }

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || ps.viewZoom <= 1) return;
            boardMousePanning = true;
            boardPanLastScreen = boardScreenPointFromClient(e.clientX, e.clientY);
            boardUpdateGrabCursor();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!boardMousePanning || !boardPanLastScreen) return;
            const p = boardScreenPointFromClient(e.clientX, e.clientY);
            const dx = p.x - boardPanLastScreen.x;
            const dy = p.y - boardPanLastScreen.y;
            ps.viewCenterX -= dx / ps.viewZoom;
            ps.viewCenterY -= dy / ps.viewZoom;
            boardPanLastScreen = p;
            clampBoardView();
            drawBoardCore();
        });

        window.addEventListener('mouseup', () => {
            if (!boardMousePanning) return;
            boardMousePanning = false;
            boardPanLastScreen = null;
            boardUpdateGrabCursor();
        });

        let pinchGesture = false;
        let pinchStartDist = 1;
        let pinchStartZoom = 1;
        let touchPanLastScreen = null;
        let touchDidPan = false;

        function touchDistanceScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return Math.hypot(b.x - a.x, b.y - a.y);
        }

        function touchMidpointScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 2) {
                if (!boardViewZoomAllowed()) return;
                clearLongMarkTouch();
                pinchGesture = true;
                pinchStartDist = Math.max(1e-6, touchDistanceScreen(e.touches));
                pinchStartZoom = ps.viewZoom;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { capture: true, passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (pinchGesture && e.touches.length >= 2) {
                if (!boardViewZoomAllowed()) {
                    pinchGesture = false;
                    return;
                }
                e.preventDefault();
                const d = touchDistanceScreen(e.touches);
                const z1 = Math.max(1, Math.min(10, pinchStartZoom * (d / pinchStartDist)));
                const mid = touchMidpointScreen(e.touches);
                applyZoomKeepingScreenPoint(mid.x, mid.y, z1);
                drawBoardCore();
                return;
            }
            if (!pinchGesture && e.touches.length === 1 && ps.viewZoom > 1 && touchPanLastScreen) {
                const cur = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
                const dx = cur.x - touchPanLastScreen.x;
                const dy = cur.y - touchPanLastScreen.y;
                if (dx * dx + dy * dy > 9) {
                    touchDidPan = true;
                    e.preventDefault();
                    ps.viewCenterX -= dx / ps.viewZoom;
                    ps.viewCenterY -= dy / ps.viewZoom;
                    touchPanLastScreen = cur;
                    clampBoardView();
                    drawBoardCore();
                }
            }
        }, { passive: false });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        });

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            longMarkStart = { x: t.clientX, y: t.clientY };
            longMarkTimer = setTimeout(() => {
                longMarkTimer = null;
                if (!longMarkStart) return;
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                const { row, col } = getClosestIntersection(x, y);
                applyUserBoardMark(row, col);
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

        function onCanvasTouchEnd(e) {
            clearLongMarkTouch();
            if (e.touches.length < 2) pinchGesture = false;
            if (e.touches.length === 0) {
                if (touchDidPan) {
                    suppressCanvasClickAfterPan = true;
                    setTimeout(() => { suppressCanvasClickAfterPan = false; }, 450);
                }
                touchDidPan = false;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }
        canvas.addEventListener('touchend', onCanvasTouchEnd);
        canvas.addEventListener('touchcancel', () => {
            clearLongMarkTouch();
            pinchGesture = false;
            touchPanLastScreen = null;
            touchDidPan = false;
        });

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark || suppressCanvasClickAfterPan) {
                e.preventDefault();
                return;
            }
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardCore();
                    return;
                }
                if (!canPlayCell(row, col)) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        customTryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        drawBoardCore();
                    }
                    return;
                }
                customTryPlayMove(row, col);
                return;
            }
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (ps.waitingScoreConfirm) return;

            if (row < 0 || col < 0) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoardCore();
                return;
            }
            if (!canPlayCell(row, col)) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    customCommitMove(row, col);
                    drawBoardCore();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoardCore();
                }
                return;
            }
            customCommitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (boardMousePanning) return;
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoardCore(); }
                    return;
                }
                // 编辑模式：悬停命中和「工具预览」由公共编辑 UI 按几何取点负责（见第 9 步），这里不插手
                if (ps.editModeEnabled) {
                    boardUpdateGrabCursor();
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                const cellOk = row >= 0 && col >= 0 && canPlayCell(row, col);
                ps.isHoverValid = cellOk && (!mustCaptureActive() || isCandidatePoint(row, col));
                boardUpdateGrabCursor();
                drawBoardCore();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    if (!boardMousePanning) boardUpdateGrabCursor();
                    drawBoardCore();
                }
            });
        }

        // 数点确认按钮事件
        if (scoreConfirmYes)
        {
            scoreConfirmYes.onclick = () => {
                ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
                hideScoreConfirm();
            };
            scoreConfirmNo.onclick = () => {
                ps.iRejected = true;
                ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (ps.showEstimateActive) {
                    ps.showEstimateActive = false;
                    clearEstimate();
                }
                ps.waitingScoreConfirm = false;
            };
        }
        connectWebSocket(handleMessage);
        })();
    }
};
