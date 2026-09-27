window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['large-small-circle-weiqi'] = {
    shell: {
        "title": "大小圆围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />落子点分两种。<br /><strong>大圆点：</strong>既在大圆上又在小圆上的点。<br /><strong>小圆点：</strong>只在小圆上的点。<br /><br /><strong>不对称连接：</strong>大圆点只以相邻的空大圆点为气，小圆点以相邻的所有空点为气。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 4,
        "boardSizeMax": 11,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "大小圆围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "zoomScroll": false,
            "editBoard": true,
            "compoundPalette": false
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
 * 大小圆围棋（large-small-circle-weiqi）
 *
 * 棋盘：路数 n（4-11）→ (n-1)×(n-1) 个大圆，上下左右相邻的大圆相切；每个大圆内上下左右四个小圆
 * 与大圆内切、四个对角两两相切（大圆半径 = 小圆半径 ×(1+√2)）。所有切点都是可落子点。
 * 点编号 (宮, 位)：宮 = 大圆槽位（列 + 行×路数），位 0=左大圆点 1=上大圆点 2=左上 3=右上 4=右下 5=左下。
 * 位 0、1 是大圆点（既在大圆又在小圆），位 2~5 是小圆点（只在小圆）。**编号必须与服务器逐点一致**。
 *
 * 内部盘 = 一维「点」数组（0 空 / 1 黑 / 2 白），几何由 circleBoardTable() 给出（与服务器同源）。
 * 规则孪生（试下 / 打谱 / 实况回放都跑本地这份）：气不对称 + 气按连通迭代传递，见 circle* 系列函数。
 *
 * 坐标标签不画（与 WPF 参考实现一致），圆盘外框用木色圆 + 黑细线画大圆/小圆。
 */
        /* ---------------------------- 配置 ---------------------------- */
        const SIZE_MIN = 4;
        const SIZE_MAX = 11;
        const DEFAULT_LANES = 9;
        const KOMI = 3.25;
        const RECORD_PREFIX = '大小圆围棋';
        let LANES = DEFAULT_LANES;
        /** 兼容旧调用点：本棋种只有一种棋盘 */
        function subCfg() { return { prefix: RECORD_PREFIX, komi: () => KOMI }; }

        /* ---------------------------- 统一视图 ---------------------------- */
        const CANVAS_SIZE = 600;
        const FRAME_CENTER = CANVAS_SIZE / 2;
        /** 当前几何（由 GEOMETRY.build(LANES) 生成） */
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

        /* ---------------------------- 大小圆围棋几何 ---------------------------- */
        /* 点编号 (宮, 位) 与服务器 games/large-small-circle-weiqi.js 的 circleBoardTable 必须逐点一致：
           宮 = 大圆槽位（列 + 行×路数，0 .. 路数²-2），位 0=左大圆点 1=上大圆点 2=左上 3=右上 4=右下 5=左下 */
        const KIND_BIG = 1;
        const KIND_SMALL = 2;
        const SEAT_KIND = [KIND_BIG, KIND_BIG, KIND_SMALL, KIND_SMALL, KIND_SMALL, KIND_SMALL];

        function circleBoardTable(lanes) {
            const G = lanes;
            const slots = G * G - 1;
            const bigR = 1 + Math.SQRT2;
            const gap = bigR - 1;
            const valid = (g, s) => {
                if (!Number.isInteger(g) || !Number.isInteger(s)) return false;
                if (g < 0 || g >= slots || s < 0 || s > 5) return false;
                if (g % G === G - 1 && s !== 0) return false;                 // 虚拟右列只留位 0
                if (Math.floor(g / G) === G - 1 && s !== 1) return false;     // 虚拟下行只留位 1
                return true;
            };
            const neighbors = (g, s) => {
                const out = [];
                const push = (a, b) => { if (valid(a, b)) out.push([a, b]); };
                if (s === 0) {
                    push(g, 1); push(g + G, 1); push(g - 1, 1); push(g - 1 + G, 1);
                    push(g, 2); push(g, 5); push(g - 1, 3); push(g - 1, 4);
                } else if (s === 1) {
                    push(g, 0); push(g + 1, 0); push(g - G, 0); push(g - G + 1, 0);
                    push(g, 2); push(g, 3); push(g - G, 4); push(g - G, 5);
                } else if (s === 2) {
                    push(g, 0); push(g, 5); push(g, 1); push(g, 3);
                } else if (s === 3) {
                    push(g, 1); push(g, 2); push(g + 1, 0); push(g, 4);
                } else if (s === 4) {
                    push(g + 1, 0); push(g, 3); push(g + G, 1); push(g, 5);
                } else {
                    push(g + G, 1); push(g, 4); push(g, 0); push(g, 2);
                }
                return out;
            };
            const pos = (g, s) => {
                const cx = (2 * (g % G) + 1) * bigR;
                const cy = (2 * Math.floor(g / G) + 1) * bigR;
                if (s === 0) return { x: cx - bigR, y: cy };
                if (s === 1) return { x: cx, y: cy - bigR };
                if (s === 2) return { x: cx - gap / 2, y: cy - gap / 2 };
                if (s === 3) return { x: cx + gap / 2, y: cy - gap / 2 };
                if (s === 4) return { x: cx + gap / 2, y: cy + gap / 2 };
                return { x: cx - gap / 2, y: cy + gap / 2 };
            };
            return {
                lanes: G, slots, gridW: slots, gridH: 6,
                valid, neighbors, kindOf: (s) => SEAT_KIND[s], pos,
                spanUnits: 2 * bigR * (G - 1), bigR, smallR: 1, gap
            };
        }

        /** 逻辑画布（600×600）里的布局：整盘按外接圆缩放居中 */
        function buildCircleView(lanes) {
            const T = circleBoardTable(lanes);
            const pos = [];
            const koordOf = [];
            const indexByKoord = new Map();
            for (let g = 0; g < T.gridW; g++) {
                for (let s = 0; s < 6; s++) {
                    if (!T.valid(g, s)) continue;
                    indexByKoord.set(g + ',' + s, pos.length);
                    koordOf.push([g, s]);
                    pos.push(T.pos(g, s));
                }
            }
            const neighbors = koordOf.map(([g, s]) => T.neighbors(g, s)
                .map(([a, b]) => indexByKoord.get(a + ',' + b))
                .filter((i) => i !== undefined));
            const pad = lanes >= 10 ? 16 : 22;
            const scale = (CANVAS_SIZE - 2 * pad) / T.spanUnits;
            const transformed = pos.map((p) => ({ x: pad + p.x * scale, y: pad + p.y * scale }));
            const cx = CANVAS_SIZE / 2;
            const cy = CANVAS_SIZE / 2;
            // 棋盘外轮廓是方形（大圆铺满整个方形区域），取点/蒙版都用方形，别用外接圆（会切掉四角的大圆）
            const half = (T.spanUnits / 2) * scale + 4;
            const frame = [
                { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
                { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }
            ];
            // 大圆/小圆（只画真实的 (路数-1)×(路数-1) 个大圆）
            const bigCircles = [];
            const smallCircles = [];
            const at = (ux, uy) => ({ x: pad + ux * scale, y: pad + uy * scale });
            for (let j = 0; j < lanes - 1; j++) {
                for (let i = 0; i < lanes - 1; i++) {
                    const ux = (2 * i + 1) * T.bigR;
                    const uy = (2 * j + 1) * T.bigR;
                    bigCircles.push({ x: pad + ux * scale, y: pad + uy * scale, r: T.bigR * scale });
                    smallCircles.push({ x: pad + (ux - T.gap) * scale, y: pad + uy * scale, r: T.smallR * scale });
                    smallCircles.push({ x: pad + (ux + T.gap) * scale, y: pad + uy * scale, r: T.smallR * scale });
                    smallCircles.push({ x: pad + ux * scale, y: pad + (uy - T.gap) * scale, r: T.smallR * scale });
                    smallCircles.push({ x: pad + ux * scale, y: pad + (uy + T.gap) * scale, r: T.smallR * scale });
                    void at;
                }
            }
            const cellSize = T.smallR * scale;
            return {
                vertexCount: pos.length,
                transformed,
                neighbors,
                koordOf,
                cellSize,
                clickThreshold: Math.max(6, cellSize * 1.2),
                frame,
                table: T,
                bigCircles,
                smallCircles,
                center: { x: cx, y: cy },
                half
            };
        }

        /** 画棋盘骨架：木色圆盘 + 大圆/小圆黑细线（静态层缓存，路数变了才重画） */
        let circleGridLayer = null;
        function circleDrawSkeleton(c2, view) {
            const g = view.geo;
            const dpr = window.devicePixelRatio || 1;
            if (!circleGridLayer || circleGridLayer.__lanes !== LANES || circleGridLayer.__key !== view.vertexCount
                || circleGridLayer.__dpr !== dpr) {
                // 静态层按 dpr 建、再用 setTransform(dpr) 按逻辑坐标画：与其它棋类的静态层同一套做法，
                // 这样线宽和别处一致（1.1/0.9）也不会糊（600px 位图被主画布放大是糊的根因）
                const c = document.createElement('canvas');
                c.width = CANVAS_SIZE * dpr;
                c.height = CANVAS_SIZE * dpr;
                const g2 = c.getContext('2d');
                g2.setTransform(dpr, 0, 0, dpr, 0, 0);
                g2.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
                // 盘底不自己铺：用画布自身的木纹底色（壳按 shell.features.woodTexture 铺），这里只画圆线
                g2.strokeStyle = '#3a281c';
                g2.lineJoin = 'round';
                g2.lineWidth = 1.1;
                for (const ccc of g.bigCircles) {
                    g2.beginPath();
                    g2.arc(ccc.x, ccc.y, ccc.r, 0, Math.PI * 2);
                    g2.stroke();
                }
                g2.lineWidth = 0.9;
                for (const ccc of g.smallCircles) {
                    g2.beginPath();
                    g2.arc(ccc.x, ccc.y, ccc.r, 0, Math.PI * 2);
                    g2.stroke();
                }
                circleGridLayer = c;
                circleGridLayer.__lanes = LANES;
                circleGridLayer.__key = view.vertexCount;
                circleGridLayer.__dpr = dpr;
            }
            c2.drawImage(circleGridLayer, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        /** 取点：先挡掉圆盘外，再取最近的点（容差见 clickThreshold） */
        function circlePick(view, x, y) {
            return vertexPick(view, x, y);
        }

        /* ---------------------------- 几何注册表 ---------------------------- */
        /** 本棋种只有一种棋盘：{ build(lanes), drawSkeleton(ctx, view), pick(view, x, y) } */
        const GEOMETRY = {
            build(lanes) {
                const geo = buildCircleView(lanes);
                return vertexViewFromGeo(geo, lanes, {
                    totalPoints: geo.vertexCount,
                    twoStepPlacing: lanes >= 10,
                    seatOverlayShape: 'square',
                    komi: KOMI,
                    // 相邻两点的最小间距 ≈ 1.85×小圆半径，棋子取 0.8×小圆半径正好不重叠
                    stoneRadius: Math.max(2.5, geo.cellSize * 0.65),
                    estimateMarkScale: 0.55
                });
            },
            drawSkeleton: circleDrawSkeleton,
            pick: circlePick
        };
        /** 桌面端：左缘固定，展开向右；距画布右缘 56px（原 6px 再向左 50px）、距底 6px */
        function updateBoardMarkOuterPosition() {
            const el = document.getElementById('boardMarkOuter');
            if (!el) return;
            // 圆盘按壳默认位置放标记面板
            if (window.matchMedia('(max-width: 700px)').matches) {
                el.style.left = '';
                el.style.top = '';
                el.style.bottom = '';
                el.style.right = '';
                el.style.marginLeft = '';
                return;
            }
        }

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
            circleGridLayer = null;   // 换路数后骨架静态层失效
            const mod = GEOMETRY;
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
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks);
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

        updateBoardMarkOuterPosition();
        window.addEventListener('resize', updateBoardMarkOuterPosition);

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

        // 点类型（按 (宮,位) 的「位」）：位 0、1 是大圆点，位 2~5 是小圆点
        function kindAtVertex(v) {
            const k = VIEW.koordOf[v];
            return (k && (k[1] === 0 || k[1] === 1)) ? KIND_BIG : KIND_SMALL;
        }

        /** 该子按本棋种口径的气：大圆点只看相邻的空大圆点；小圆点看相邻的所有空点 */
        function libertiesOfVertex(boardState, v) {
            const out = [];
            const big = kindAtVertex(v) === KIND_BIG;
            for (const nb of VIEW.neighbors[v]) {
                if (boardState[nb] !== 0) continue;
                if (big && kindAtVertex(nb) !== KIND_BIG) continue;
                out.push(nb);
            }
            return out;
        }

        /** 同色连通闭包（大圆点与小圆点相连算同一组） */
        function groupOfVertex(boardState, start) {
            const color = boardState[start];
            if (!color) return [];
            const seen = new Set([start]);
            const out = [start];
            for (let i = 0; i < out.length; i++) {
                for (const nb of VIEW.neighbors[out[i]]) {
                    if (boardState[nb] !== color || seen.has(nb)) continue;
                    seen.add(nb);
                    out.push(nb);
                }
            }
            return out;
        }

        /**
         * 组里哪些子要提掉：自己有气的算活；气沿连通**迭代传递**
         * （大圆点 → 相邻大圆点/小圆点，小圆点 → 相邻小圆点）；传不到气的提掉（可只提一部分）。
         */
        function doomedOfGroup(boardState, stones) {
            if (!stones.length) return [];
            const alive = new Set();
            const queue = [];
            for (const v of stones) {
                if (libertiesOfVertex(boardState, v).length > 0) { alive.add(v); queue.push(v); }
            }
            const color = boardState[stones[0]];
            for (let i = 0; i < queue.length; i++) {
                const v = queue[i];
                const big = kindAtVertex(v) === KIND_BIG;
                for (const nb of VIEW.neighbors[v]) {
                    if (boardState[nb] !== color || alive.has(nb)) continue;
                    if (!big && kindAtVertex(nb) !== KIND_SMALL) continue;
                    alive.add(nb);
                    queue.push(nb);
                }
            }
            return stones.filter((v) => !alive.has(v));
        }

        /** 一组顶点所在的组（去重） */
        function groupsAroundVertices(boardState, points) {
            const seen = new Set();
            const out = [];
            for (const p of points) {
                if (boardState[p] === 0 || seen.has(p)) continue;
                const grp = groupOfVertex(boardState, p);
                for (const v of grp) seen.add(v);
                out.push(grp);
            }
            return out;
        }

        /** 兼容旧调用点：该位置是否至少有一口气 */
        function hasLiberty(boardState, start) {
            const grp = groupOfVertex(boardState, start);
            return grp.length > 0 && doomedOfGroup(boardState, grp).length === 0;
        }

        /** 兼容旧调用点：把整组提掉 */
        function removeGroup(boardState, start) {
            for (const v of groupOfVertex(boardState, start)) boardState[v] = 0;
        }

        /**
         * 落子（与服务器 tryPlaceStone 同语义）：先判对方（候选组统一判定、一次性提完），
         * 再按提完后的盘面判己方落点所在的整组；允许自杀。
         */
        function tryPlaceStone(boardBefore, vertex, playerVal) {
            if (boardBefore[vertex] !== 0) return null;
            const newBoard = deepCopyBoard(boardBefore);
            newBoard[vertex] = playerVal;
            const enemy = 3 - playerVal;
            const around = [vertex, ...VIEW.neighbors[vertex]];
            const doomed = [];
            for (const grp of groupsAroundVertices(newBoard, around)) {
                if (newBoard[grp[0]] !== enemy) continue;
                doomed.push(...doomedOfGroup(newBoard, grp));
            }
            for (const v of doomed) newBoard[v] = 0;
            const own = groupOfVertex(newBoard, vertex);
            for (const v of doomedOfGroup(newBoard, own)) newBoard[v] = 0;
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
                const ch = userBoardMarks[key];
                const { x, y } = VIEW.pos[v];
                const markBgR = VIEW.markBgRadius(stoneRadius);
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
                ctx.fill();
                const fontPx = VIEW.markFontPx(stoneRadius, ch);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
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
            // 路数可能被服务端改（观战者改路数）：先按 state 校正，再同步局面
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const sizeChanged = Number.isFinite(incomingSize) && incomingSize !== LANES;
            if (sizeChanged) {
                exitTryPlay();
                exitReplayMode();
                clearEstimate();
                LANES = incomingSize;
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
            if (!hasAnyStone && !hasPlayer && !gameOver && mySlot === null)
                sizeSelect.style.display = 'inline-block';
            else
                sizeSelect.style.display = 'none';

            if (showEstimateActive) {
                cachedLiveBoard = removeDeadAndDying(board);
                cachedTerritory = assignTerritory(cachedLiveBoard);
            }
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
            showScoreConfirm,
            onBoardSizeChanged: (msg) => {
                if (msg.boardSize == null) return;
                const bs = Number(msg.boardSize);
                if (Number.isFinite(bs) && bs !== Number(LANES)) {
                    LANES = bs;
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
            get seatOverlayShape() { return 'square'; }
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
            if (board[vertex] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = String(vertex);
            const existing = userBoardMarks[key];
            if (clear) {
                if (existing !== undefined) {
                    delete userBoardMarks[key];
                    drawBoardWithOverlay();
                }
                return;
            }
            if (existing === undefined) {
                userBoardMarks[key] = ch;
            } else if (existing !== ch) {
                userBoardMarks[key] = ch;
            } else {
                delete userBoardMarks[key];
            }
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

        /* ---------------------- 路数下拉与壳文案 ---------------------- */
        function recordPrefix() {
            return RECORD_PREFIX;
        }

        /** 路数下拉（4-11 路） */
        function rebuildSizeSelect() {
            const sel = document.getElementById('boardSizeSelect');
            if (!sel) return;
            sel.innerHTML = '';
            for (let n = SIZE_MIN; n <= SIZE_MAX; n++) {
                const opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n + '路';
                sel.appendChild(opt);
            }
            sel.value = String(LANES);
        }

        /** 壳文案（规则弹层标题/正文、贴目、木纹、标记面板位置） */
        function applySubShellChrome() {
            const rulesTitle = document.getElementById('rulesTitle');
            if (rulesTitle) rulesTitle.textContent = '大小圆围棋';
            const rulesBody = document.getElementById('rulesBody');
            const shell = (window.RoomPlugins['large-small-circle-weiqi'] || {}).shell;
            if (rulesBody && shell) rulesBody.innerHTML = shell.rulesHtml;
            if (typeof QiSquareWeiqiCanvas !== 'undefined' && QiSquareWeiqiCanvas.applyBoardWoodTexture) {
                const canvasEl = document.getElementById('goBoard');
                if (canvasEl) QiSquareWeiqiCanvas.applyBoardWoodTexture(canvasEl);
            }
            updateBoardMarkOuterPosition();
            // 蒙版形状只在「创建蒙版」与窗口 resize 时解析：路数变了补发一次 resize 让壳重画
            try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
            refreshKomiInfo();
            drawBoardWithOverlay();
        }

        (function mountCircleShell() {
            const subSel = document.getElementById('subGameSelect');
            if (subSel) subSel.style.display = 'none';     // 本棋种没有子棋类
            rebuildSizeSelect();
            applySubShellChrome();
        })();

        connectWebSocket();
        })();
    }
};
