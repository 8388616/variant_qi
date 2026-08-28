window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["dfw"] = {
    shell: {
        "title": "DFW",
        "rulesHtml": "测试游戏，无实际功能。",
        "defaultKomiText": "　",
        "boardSizeMin": 32,
        "boardSizeMax": 32,
        "defaultBoardSize": 32,
        "recordDownloadPrefix": "DFW",
        "features": {
            "zoomScroll": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};

        (function () {
// ======================== 棋盘几何（与后端一致：n 路 = 3n²−9n+7 个六角格） ========================
        const CANVAS_SIZE = 600;
        const FRAME_CENTER = CANVAS_SIZE / 2;
        /** 棋盘背景色（正方形外框底色，也是格线颜色） */
        const BOARD_BG = '#fdcc90';
        /** 普通点亮格填充色：白色（带属性的格由属性背景覆盖） */
        const KEPT_FILL = '#ffffff';
        const FRAME_MARGIN = 8;
        /** 六角格中心距（逻辑单位，与服务端生成一致） */
        const HEX_R = 2;
        /** 每座位的棋子（座位 0-2 红方，3-5 蓝方） */
        const SEAT_PIECES = ['♜', '♞', '♝', '♜', '♞', '♝'];
        /** 红蓝两色 */
        const SEAT_COLORS = ['#c03030', '#c03030', '#c03030', '#3050c0', '#3050c0', '#3050c0'];

        /** 地图形状定义表（新增形状：加一项并实现下列字段即可，其余代码按表驱动）：
         *  dirs: 方向表（索引 = 方向编号，与服务端一致）；angles: 方向 → 画布角度；
         *  coordKey/coordDelta: 格坐标键 / 沿方向移动后的坐标键；
         *  step: 相邻格中心距（格半尺寸倍数：六角 = √3、四角 = 2）；
         *  norm: 缩放距离范数（中心到最远格的距离度量——决定最外圈与棋盘外框的间距：
         *        六角最远点在 6 个方向用欧氏、四角最外圈是边（非角）用切比雪夫）；
         *  path: 画格外形（参数 r = 格半尺寸：六角外接半径 / 四角半边长）；
         *  genCenters: 生成格中心与坐标表（n = 每边路数，遍历顺序与服务端一致）；
         *  vision: 视野（以 v0 为中心 ≤5 步）；fontScale: 格内字符放大系数；
         *  turnPoly: 行动顺序条的格形点串（R = 外接半径）。 */
        const CELL_SHAPES = {
            hex: {
                dirs: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]],
                angles: { 3: -90, 2: 90, 1: 210, 4: -30, 5: 150, 0: 30 },
                coordKey: (c) => `${c.q},${c.r}`,
                coordDelta: (c, dx, dy) => `${c.q + dx},${c.r + dy}`,
                step: Math.sqrt(3),
                norm: (x, y) => Math.hypot(x, y),
                path: (cx, cy, r) => {
                    const p = new Path2D();
                    for (let k = 0; k < 6; k++) {
                        const a = (60 * k) * Math.PI / 180;
                        const x = cx + r * Math.cos(a);
                        const y = cy + r * Math.sin(a);
                        if (k === 0) p.moveTo(x, y);
                        else p.lineTo(x, y);
                    }
                    p.closePath();
                    return p;
                },
                genCenters(n) {
                    const sqrt3 = Math.sqrt(3);
                    const radius = n - 2;
                    const centers = [];
                    const newCoords = [];
                    const newCoordIdx = new Map();
                    for (let q = -radius; q <= radius; q++) {
                        for (let r = -radius; r <= radius; r++) {
                            if (Math.abs(q + r) > radius) continue;
                            centers.push({ x: HEX_R * 1.5 * q, y: HEX_R * sqrt3 * (r + q / 2) });
                            newCoordIdx.set(`${q},${r}`, newCoords.length);
                            newCoords.push({ q, r });
                        }
                    }
                    return { centers, coords: newCoords, coordIdx: newCoordIdx };
                },
                vision(v0, coords, coordIdx, add) {
                    const cq = coords[v0].q, cr = coords[v0].r;
                    for (let dq = -5; dq <= 5; dq++) {
                        for (let dr = -5; dr <= 5; dr++) {
                            if (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr) > 10) continue;   // 六角距离 ≤ 5
                            const v = coordIdx.get((cq + dq) + ',' + (cr + dr));
                            if (v !== undefined) add(v);
                        }
                    }
                },
                fontScale: 1,
                turnPoly: (R) => {
                    const pts = [];
                    for (let k = 0; k < 6; k++) {
                        const a = (60 * k - 90) * Math.PI / 180;   // 尖顶（顶点在上）
                        pts.push((R + R * Math.cos(a)).toFixed(1) + ',' + (R + R * Math.sin(a)).toFixed(1));
                    }
                    return pts.join(' ');
                },
            },
            square: {
                dirs: [[0, -1], [1, 0], [0, 1], [-1, 0]],
                angles: { 0: -90, 1: 0, 2: 90, 3: 180 },
                coordKey: (c) => `${c.x},${c.y}`,
                coordDelta: (c, dx, dy) => `${c.x + dx},${c.y + dy}`,
                step: 2,
                norm: (x, y) => Math.max(Math.abs(x), Math.abs(y)),
                path: (cx, cy, r) => {
                    const p = new Path2D();
                    p.moveTo(cx - r, cy - r);
                    p.lineTo(cx + r, cy - r);
                    p.lineTo(cx + r, cy + r);
                    p.lineTo(cx - r, cy + r);
                    p.closePath();
                    return p;
                },
                genCenters(n) {
                    // 四角格：n×n 行优先（第 y 行第 x 列 → 索引 y*n+x，与服务端一致）；边长 = 2*HEX_R
                    const centers = [];
                    const newCoords = [];
                    const newCoordIdx = new Map();
                    for (let y = 0; y < n; y++) {
                        for (let x = 0; x < n; x++) {
                            centers.push({ x: 2 * HEX_R * x, y: 2 * HEX_R * y });
                            newCoordIdx.set(`${x},${y}`, newCoords.length);
                            newCoords.push({ x, y });
                        }
                    }
                    return { centers, coords: newCoords, coordIdx: newCoordIdx };
                },
                vision(v0, coords, coordIdx, add) {
                    // 四角：曼哈顿距离 ≤ 5
                    const cx = coords[v0].x, cy = coords[v0].y;
                    for (let dx = -5; dx <= 5; dx++) {
                        for (let dy = -5; dy <= 5; dy++) {
                            if (Math.abs(dx) + Math.abs(dy) > 5) continue;
                            const v = coordIdx.get((cx + dx) + ',' + (cy + dy));
                            if (v !== undefined) add(v);
                        }
                    }
                },
                fontScale: 1.2,
                turnPoly: (R) => {
                    const pts = [];
                    for (const [ox, oy] of [[-0.72, 0], [0, -0.72], [0.72, 0], [0, 0.72]]) {
                        pts.push((R + R * ox).toFixed(1) + ',' + (R + R * oy).toFixed(1));
                    }
                    return pts.join(' ');
                },
            },
        };
        /** 当前地图形状定义（mapType 变化时由 applyGeometry 更新） */
        let cellShape = CELL_SHAPES.hex;

        /** 画方向箭头：从格中心到目标格中心的连线，取 (0.25, 0.75) 段画线 + 箭头（头朝目标格） */
        function drawArrow(ctx, cx, cy, ang, color, z) {
            const a = ang * Math.PI / 180;
            const ux = Math.cos(a), uy = Math.sin(a);
            const D = cellShape.step * hexR;   // 相邻格中心距离（六角 = √3*hexR；四角 = 边长 = 2*hexR）
            const x1 = cx + ux * D * 0.25, y1 = cy + uy * D * 0.25;
            const x2 = cx + ux * D * 0.75, y2 = cy + uy * D * 0.75;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, hexR * 0.12) / z;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // 箭头头（在 0.75 端，朝目标格）
            const hl = D * 0.25 * 0.9;
            for (const da of [0.55, -0.55]) {
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - Math.cos(a + da) * hl, y2 - Math.sin(a + da) * hl);
                ctx.stroke();
            }
        }

        /** DFW 棋盘路数参数：默认取 shell 配置，服务端广播后以服务端为准 */
        let boardSize = (config.defaultBoardSize != null) ? config.defaultBoardSize : 32;
        /** 地图形状：'hex' 六角（默认）/ 'square' 四角——服务端广播后以服务端为准 */
        let mapType = 'hex';
        let V = 0;
        let hexR = 0;           // 六角格外接半径（逻辑单位，棋子按格大小绘制）
        let cellCenters = [];   // 六角格中心（600 画布逻辑坐标）
        let hexPaths = [];      // 每格六角形 Path2D（600 画布逻辑坐标）
        let keptPaths = [];     // 保留格的路径缓存
        let removed = null;     // Uint8Array 或 null（未就绪=全部保留）
        let coords = [];           // 格子索引 -> 坐标（六角 {q,r} / 四角 {x,y}）
        let coordIdx = new Map();  // 坐标键 -> 格子索引

        /** a→b 的方向索引（六角 0-5 / 四角 0-3），非邻居返回 -1 */
        function dirIndex(a, b) {
            const DIRS = cellShape.dirs;
            const kb = cellShape.coordKey(coords[b]);
            for (let d = 0; d < DIRS.length; d++) {
                if (cellShape.coordDelta(coords[a], DIRS[d][0], DIRS[d][1]) === kb) return d;
            }
            return -1;
        }

        /** v 的点亮邻居（排除 exclude） */
        function litNeighborDirs(v, exclude) {
            const out = [];
            const DIRS = cellShape.dirs;
            for (let d = 0; d < DIRS.length; d++) {
                const nb = coordIdx.get(cellShape.coordDelta(coords[v], DIRS[d][0], DIRS[d][1]));
                if (nb === undefined || nb === exclude) continue;
                if (removed && removed[nb]) continue;
                out.push(nb);
            }
            return out;
        }

        function applyGeometry(n, type) {
            cellShape = CELL_SHAPES[type] || CELL_SHAPES.hex;
            const { centers, coords: newCoords, coordIdx: newCoordIdx } = cellShape.genCenters(n);
            V = centers.length;
            coords = newCoords;
            coordIdx = newCoordIdx;
            let cx = 0, cy = 0;
            for (const c of centers) { cx += c.x; cy += c.y; }
            cx /= V;
            cy /= V;
            // 缩放范数按形状：四角最外圈是边（非角），用切比雪夫——与六角一致地让最外圈贴边框
            let maxDist = 0;
            for (const c of centers) {
                const d = cellShape.norm(c.x - cx, c.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? (FRAME_CENTER - FRAME_MARGIN) / maxDist : 1;
            cellCenters = centers.map(c => ({
                x: FRAME_CENTER + (c.x - cx) * scale,
                y: FRAME_CENTER + (c.y - cy) * scale
            }));
            const rs = HEX_R * scale;
            hexR = rs;   // 语义：格半尺寸（六角外接半径 / 四角半边长）
            hexPaths = cellCenters.map(c => cellShape.path(c.x, c.y, rs));
            buildKeptPaths();
        }

        /** 按 removed 状态构建保留格的路径缓存（removed 为 null 时全部保留） */
        function buildKeptPaths() {
            keptPaths = [];
            for (let v = 0; v < V; v++) {
                if (removed && removed[v]) continue;
                keptPaths.push(hexPaths[v]);
            }
        }

        applyGeometry(boardSize, mapType);

// ======================== 缩放 / 拖动 ========================
        let viewZoom = 1;
        let viewCenterX = FRAME_CENTER;
        let currentMovePos = {};   // 逐格移动动画：座位 -> 当前动画格（动画中覆盖 piecePositions）
        let lastFrom = {};         // 座位 -> 上一步的格子（箭头按新格计算：排除来向）
        let viewCenterY = FRAME_CENTER;
        let boardMousePanning = false;
        let boardPanLastScreen = null;
        let pinchGesture = false;
        let pinchStartDist = 1;
        let pinchStartZoom = 1;
        let touchPanLastScreen = null;

        function clampBoardView() {
            let z = viewZoom;
            if (!Number.isFinite(z)) z = 1;
            z = Math.max(0.5, Math.min(10, z));
            viewZoom = z;
            if (z <= 1) {
                viewCenterX = FRAME_CENTER;
                viewCenterY = FRAME_CENTER;
                return;
            }
            const half = (CANVAS_SIZE / 2) / z;
            viewCenterX = Math.min(CANVAS_SIZE - half, Math.max(half, viewCenterX));
            viewCenterY = Math.min(CANVAS_SIZE - half, Math.max(half, viewCenterY));
        }

        function applyZoomKeepingScreenPoint(ssx, ssy, zNew) {
            const z0 = viewZoom;
            const Lx = (ssx - CANVAS_SIZE / 2) / z0 + viewCenterX;
            const Ly = (ssy - CANVAS_SIZE / 2) / z0 + viewCenterY;
            viewZoom = zNew;
            viewCenterX = Lx - (ssx - CANVAS_SIZE / 2) / zNew;
            viewCenterY = Ly - (ssy - CANVAS_SIZE / 2) / zNew;
            clampBoardView();
        }

        function screenPointFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const s = CANVAS_SIZE / rect.width;
            return { x: (clientX - rect.left) * s, y: (clientY - rect.top) * s };
        }

        function touchDistanceScreen(touches) {
            const a = screenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = screenPointFromClient(touches[1].clientX, touches[1].clientY);
            return Math.hypot(b.x - a.x, b.y - a.y);
        }

        function touchMidpointScreen(touches) {
            const a = screenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = screenPointFromClient(touches[1].clientX, touches[1].clientY);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }

// ======================== 绘制 ========================
        function syncScrollbars() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            if (viewZoom <= 1) { sx.style.display = 'none'; sy.style.display = 'none'; return; }
            sx.style.display = 'block';
            sy.style.display = 'block';
            const z = Math.max(0.5, Math.min(10, viewZoom));
            const half = (CANVAS_SIZE / 2) / z;
            const minX = half, maxX = CANVAS_SIZE - half;
            const minY = half, maxY = CANVAS_SIZE - half;
            const spanX = maxX - minX;
            const spanY = maxY - minY;
            sx.value = spanX > 1e-6 ? String(Math.round((viewCenterX - minX) / spanX * 1000)) : '500';
            sy.value = spanY > 1e-6 ? String(Math.round((maxY - viewCenterY) / spanY * 1000)) : '500';
        }

        /** 当前 6 人状态（服务端广播） */
        let gameState = null;

        /** 按背景 rgb 亮度决定字符颜色：亮度 < 128 用白字，否则黑字 */
        function isDarkBg(rgb) {
            const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb || '');
            if (!m) return false;
            return (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 < 128;
        }

        let visionCells = null;   // 本页玩家所在方的视野格集合（每角色 6 路大六角形并集）；观战 = null（全图可见）

        /** 计算本页玩家所在方的视野：每个角色提供以当前格为中心、6 路大六角形（六角距离 ≤6）的视野 */
        /** 本页玩家所在方的视野格集合（每角色 5 路大六角形并集）；观战 = 双方交集 */
        function computeVision() {
            // 移动动画进行中 / 排队中 / 骰子转动中：保持移动前的视野——移动到目标格后才更新
            if (moveTimer != null || animatingMove || diceAnim) return;
            visionCells = null;
            if (!gameState || !gameState.piecePositions) return;
            if (gameState.mySeat == null || gameState.mySeat < 0) {
                const visRed = visionOfSide(0);
                const visBlue = visionOfSide(1);
                const inter = new Set();
                for (const v of visRed) if (visBlue.has(v)) inter.add(v);
                visionCells = inter;   // 观战：双方都能看到的格（交集）
                return;
            }
            visionCells = visionOfSide(gameState.mySeat < 3 ? 0 : 1);
        }
        /** 某方（0=红、1=蓝）的视野格集合：3 个角色的 5 路大六角形 ∪ 本方占领格的 5 路视野 */
        function visionOfSide(side) {
            const vis = new Set();
            if (!gameState || !gameState.piecePositions) return vis;
            const addVision = (v0) => {
                if (v0 == null || v0 < 0 || v0 >= V || !coords[v0]) return;
                cellShape.vision(v0, coords, coordIdx, (v) => vis.add(v));
            };
            for (let s = 0; s < 6; s++) {
                if ((s < 3 ? 0 : 1) !== side) continue;
                addVision(gameState.piecePositions[s]);
            }
            // 占领的格也提供视野（范围与角色相同）
            const props = animPropsSnapshot ? animPropsSnapshot.cellProps : (gameState.cellProps || null);
            if (props) {
                for (let v = 0; v < V; v++) {
                    const cp = props[v];
                    if (!cp) continue;
                    const own = (cp.type === 'redLandA' || cp.type === 'redLandB') ? 0
                        : ((cp.type === 'blueLandA' || cp.type === 'blueLandB') ? 1 : -1);
                    if (own === side) addVision(v);
                }
            }
            return vis;
        }

        /** 绘制六枚棋子（含移动动画位置、悬停预览、方向箭头）——迷雾/蒙版之上也调用（角色不被覆盖） */
        function drawPieces() {
            if (!gameState || !gameState.piecePositions) return;
            const ctx = canvas.getContext('2d');
            const z = Math.max(0.5, Math.min(10, viewZoom));
            for (let i = 0; i < 6; i++) {
                const mv = currentMovePos ? currentMovePos[i] : null;
                const v = (mv != null) ? mv : gameState.piecePositions[i];
                if (v == null || v < 0 || v >= V) continue;
                const c = cellCenters[v];
                ctx.fillStyle = SEAT_COLORS[i];
                const fs = hexR * cellShape.fontScale;   // 棋子在一格内（四角字体 1.2 倍），无最小字体限制
                ctx.font = fs + 'px serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(SEAT_PIECES[i], c.x, c.y);
                // 悬停预览：轮到本页玩家行动时，鼠标悬停在候选目标格上——半透明显示角色（参考围棋落子预览）
                if (hoverCell >= 0 && hoverCell === v && gameState.mySeat != null && gameState.mySeat === i &&
                    gameState.phase === 'playing' && gameState.currentSeat === i &&
                    gameState.reachable && gameState.reachable.includes(hoverCell)) {
                    ctx.globalAlpha = 0.4;
                    ctx.fillText(SEAT_PIECES[i], c.x, c.y);
                    ctx.globalAlpha = 1;
                }
                // 方向箭头：移动动画中的棋子不显示；到达后按新格计算——
                //   排除来向后所有点亮邻居都是可选方向，每个方向画一个箭头；
                //   死路（除来向外无邻居）则指向来向；未移动过的棋子用服务端方向（开局强制）
                if (gameState && gameState.pieceDirs && !(currentMovePos && currentMovePos[i] != null)) {
                    const angMap = cellShape.angles;
                    let angles = [];
                    const from = lastFrom[i];
                    if (from == null) {
                        angles = [angMap[gameState.pieceDirs[i]]];
                    } else {
                        // 箭头 = 指向所有可选邻格（排除来向）；死路（无可选邻格）不画箭头——不允许往回走
                        for (const nb of litNeighborDirs(v, from)) angles.push(angMap[dirIndex(v, nb)]);
                    }
                    for (const ang of angles) {
                        if (ang != null) drawArrow(ctx, c.x, c.y, ang, SEAT_COLORS[i], z);
                    }
                }
            }
        }

        let animatingMove = false;      // 移动动画进行中（独立标记——moveTimer 会被 clearTimeout 清掉，不可靠）
        let blinkTimer = null;          // 当前格框闪烁定时器（人类行动时 500ms 闪烁）
        let blinkOn = true;             // 当前闪烁状态（false = 该半周期不画框）
        function startBlink() {
            if (blinkTimer) return;
            blinkTimer = setInterval(() => { blinkOn = !blinkOn; drawBoard(); }, 500);
        }
        function stopBlink() {
            if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
            blinkOn = true;
        }
        let animPropsSnapshot = null;   // 移动动画期间的地图属性快照（占领/mine 等地图更新在动画完成后才显示）
        let hoverCell = -1;   // 悬停的候选目标格（-1 = 无）——轮到本页玩家行动时预览角色
        let hoverTravelSide = null;   // 悬停游历框的一方（0=红、1=蓝、null=无）——棋盘显示该方经过的格
        let travelHideTimer = null;   // 手机上点击游历框后 5 秒自动隐藏的定时器

        // 悬停提示框（mine 剩余财富点）：DOM 在 buildUI 挂载，逻辑在此（mousemove/click 共用）
        let tipEl = null, tipTimer = null, tipCellShow = -1;
        function showTip(text, cx, cy) {
            if (!tipEl) return;
            tipEl.textContent = text;
            tipEl.style.display = 'block';
            const bcRect = document.getElementById('goBoard') ? document.getElementById('goBoard').getBoundingClientRect() : null;
            let lx = cx, ly = cy;
            if (bcRect) { lx = cx - bcRect.left + 12; ly = cy - bcRect.top - 10; }
            tipEl.style.left = lx + 'px';
            tipEl.style.top = ly + 'px';
        }
        function hideTip() {
            if (tipEl) tipEl.style.display = 'none';
            tipCellShow = -1;
            if (tipTimer) clearTimeout(tipTimer);
        }

        // 座位栏（buildUI 创建）：红/蓝两组，按"己方在右"排列；窄屏时移到棋盘上方一行
        let seatsLeftEl = null, seatsRightEl = null, redSideEl = null, blueSideEl = null, mobMQObj = null;
        function renderSidePanels() {
            if (!seatsLeftEl || !seatsRightEl || !redSideEl || !blueSideEl) return;
            let leftSide, rightSide;
            if (gameState && gameState.phase === 'playing') {
                // 正式开始后：己方在右（红方玩家看红在右、蓝方/观战看蓝在右）
                rightSide = (gameState.mySeat != null && gameState.mySeat < 3) ? redSideEl : blueSideEl;
                leftSide = (rightSide === redSideEl) ? blueSideEl : redSideEl;
            } else {
                // 开局前保持原样：红左蓝右
                leftSide = redSideEl;
                rightSide = blueSideEl;
            }
            seatsLeftEl.innerHTML = '';
            seatsRightEl.innerHTML = '';
            seatsLeftEl.appendChild(leftSide);
            seatsRightEl.appendChild(rightSide);
            applyMobileSeats();
        }
        function applyMobileSeats() {
            if (!seatsLeftEl || !seatsRightEl) return;
            const board = document.getElementById('goBoard');
            if (!board) return;
            const skillsEl = document.getElementById('dfwSkills');
            if (mobMQObj && mobMQObj.matches) {
                board.style.position = 'relative';
                seatsLeftEl.classList.add('dfw-seats-mobile');
                seatsRightEl.classList.add('dfw-seats-mobile');
                board.insertBefore(seatsRightEl, board.firstChild);
                board.insertBefore(seatsLeftEl, board.firstChild);
                // 手机上技能框显示在地图下方
                if (skillsEl) {
                    skillsEl.classList.add('dfw-skills-mobile');
                    board.appendChild(skillsEl);
                }
            } else {
                seatsLeftEl.classList.remove('dfw-seats-mobile');
                seatsRightEl.classList.remove('dfw-seats-mobile');
                const leftRail = document.querySelector('.left-rail');
                const rightRail = document.querySelector('.main-area-right');
                if (leftRail) leftRail.appendChild(seatsLeftEl);
                if (rightRail) rightRail.appendChild(seatsRightEl);
                // 宽屏：技能框回到 dfwSeatsRight 下方
                if (skillsEl) {
                    skillsEl.classList.remove('dfw-skills-mobile');
                    if (rightRail) rightRail.appendChild(skillsEl);
                }
            }
        }

        function drawBoard() {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            // 正方形外框
            ctx.fillStyle = BOARD_BG;
            ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(0.5, 0.5, CANVAS_SIZE - 1, CANVAS_SIZE - 1);
            // 棋盘随缩放/拖动变换
            const z = Math.max(0.5, Math.min(10, viewZoom));
            ctx.save();
            if (z !== 1) {
                ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
                ctx.scale(z, z);
                ctx.translate(-viewCenterX, -viewCenterY);
            }
            computeVision();   // 每帧按当前棋子位置计算本页玩家所在方的视野（迷雾）
            // 保留格：空格背景用 emptyBg（服务端 CELL_PROPS.empty.bg），格线用棋盘背景色
            ctx.fillStyle = (gameState && gameState.emptyBg) || KEPT_FILL;
            ctx.strokeStyle = BOARD_BG;
            ctx.lineWidth = 1.2 / z;
            for (const p of keptPaths) {
                ctx.fill(p);
                ctx.stroke(p);
            }
            // 格属性：带属性的格改背景色并写符号（字符颜色按背景亮度）；
            //   移动动画期间用动画前的属性快照（地图更新（占领/mine 等）在动画完成后才显示）
            if (!moveTimer && !animatingMove && animPropsSnapshot) animPropsSnapshot = null;   // 动画结束：清除快照
            const props = animPropsSnapshot ? animPropsSnapshot.cellProps : (gameState ? gameState.cellProps : null);
            if (props) {
                const pfs = hexR * 0.8 * cellShape.fontScale;   // 属性符号比棋子小一号（四角同倍放大）
                ctx.font = pfs + 'px serif';   // emoji 由系统彩色 emoji 字体渲染（保持彩色）
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let v = 0; v < V; v++) {
                    const prop = props[v];
                    if (!prop || removed[v]) continue;
                    ctx.fillStyle = prop.bg;
                    ctx.fill(hexPaths[v]);
                    // 属性格同样画格线（棋盘背景色），与空格一致
                    ctx.strokeStyle = BOARD_BG;
                    ctx.lineWidth = 1.2 / z;
                    ctx.stroke(hexPaths[v]);
                    // 字符颜色：fg 指定则直接用；否则按背景亮度；无 symbol 不写字符
                    if (prop.symbol) {
                        ctx.fillStyle = prop.fg || (isDarkBg(prop.bg) ? '#ffffff' : '#000000');
                        ctx.fillText(prop.symbol, cellCenters[v].x, cellCenters[v].y);   // 单色字体渲染 = 纯色
                    }
                }
            }
            // 迷雾：视野外的格显示为纯灰色——先铺棋盘底色（边框带），再画小一圈的灰六角形，
            //   边缘露出浅橙格线（与白格相同，不是白色）；双方棋子不受影响（后画）
            if (visionCells) {
                const shr = hexR * 0.92;   // 缩小 8%——留出边框带
                for (let v = 0; v < V; v++) {
                    if (removed[v] || visionCells.has(v)) continue;
                    ctx.fillStyle = BOARD_BG;   // 先铺棋盘底色（边框带位置）
                    ctx.fill(hexPaths[v]);
                    ctx.fillStyle = '#a0a0a0';
                    const c0 = cellCenters[v];
                    ctx.fill(cellShape.path(c0.x, c0.y, shr));
                }
            }
            // 六枚棋子（♜♞♝ 红蓝）——迷雾之上，双方位置始终可见
            drawPieces();
            // 当前玩家的可选目标格：阵营色六角形框（画在格内部，比格小；骰子动画结束后才显示）
            if (showTargets && gameState && gameState.phase === 'playing' && gameState.reachable && gameState.reachable.length) {
                const curSeat = gameState.currentSeat;
                ctx.strokeStyle = curSeat < 3 ? '#c03030' : '#3050c0';
                ctx.lineWidth = Math.max(0.6, hexR * 0.09);   // 按格大小比例（随缩放同比例变化）
                const ir = hexR * 0.8;   // 内缩格框（在格内）
                for (const v of gameState.reachable) {
                    const c0 = cellCenters[v];
                    ctx.stroke(cellShape.path(c0.x, c0.y, ir));
                }
            }
            // 当前行动玩家的当前位置框（与目标格框同样式；开始移动后移除）。
            // 人类行动时闪烁（500ms 交替显示/隐藏）；AI 行动常亮
            if (curFrameSeat != null && gameState && gameState.phase === 'playing' && gameState.piecePositions) {
                const humanTurn = gameState.seats && gameState.seats[curFrameSeat] != null;
                if (humanTurn && !blinkOn) { /* 闪烁关闭半周期：不画框 */ }
                else {
                const v = gameState.piecePositions[curFrameSeat];
                if (v != null && v >= 0 && v < V && cellCenters[v]) {
                    ctx.strokeStyle = curFrameSeat < 3 ? '#c03030' : '#3050c0';
                    ctx.lineWidth = Math.max(0.6, hexR * 0.09);
                    const c0 = cellCenters[v];
                    ctx.stroke(cellShape.path(c0.x, c0.y, hexR * 0.8));
                }
                }
            }
            // 悬停游历点（画在最上层，不被位置框/目标框覆盖——独立框）：
            // 先给每个点亮格盖白色半透明蒙版（75%——没有格子的地方/灭掉的格不加），
            // 再在蒙版之上用绿色框显示该方所有经过的格（与目标格框同大小同粗细）
            if (hoverTravelSide != null && gameState && gameState.visitedCells) {
                const list = gameState.visitedCells[hoverTravelSide];
                if (list && list.length) {
                    ctx.fillStyle = 'rgba(255,255,255,0.75)';
                    for (let v = 0; v < V; v++) {
                        if (removed[v] || !hexPaths[v]) continue;
                        ctx.fill(hexPaths[v]);
                    }
                    ctx.strokeStyle = '#2e8b2e';
                    ctx.lineWidth = Math.max(0.6, hexR * 0.09);
                    const ir = hexR * 0.8;
                    for (const v of list) {
                        if (removed[v] || !cellCenters[v]) continue;
                        const c0 = cellCenters[v];
                        ctx.stroke(cellShape.path(c0.x, c0.y, ir));
                    }
                    drawPieces();   // 角色画在蒙版之上（悬停游历时棋子不被蒙版覆盖）
                }
            }
            ctx.restore();
            syncScrollbars();
        }

// ======================== 消息 / 连接 ========================
        let ws;
        let reconnectTimer = null;

        function applyRemoved(arr) {
            removed = arr ? new Uint8Array(arr) : null;
            buildKeptPaths();
        }

        let lastDiceKey = null;   // 记录已播放的骰子（turnIndex:dicePoint），避免重复动画
        let moveAnimKey = null;   // 已播放/播放中的移动路径（seat:path），避免重复动画
        let moveTimer = null;     // 逐格移动动画定时器
        let lastViewSeat = null;  // 视角已居中的行动玩家
        let lockView = false;     // 锁定视角：勾选后不再自动移动视角到行动方
        let mapTypeSel = null;    // 地图形状选择器（六角/四角；buildUI 创建，renderMask 控制显示）
        let turnPolys = [];       // 行动顺序条的多边形元素（renderTurnBar 按 cellShape 切形状）
        let turnR = 18;           // 行动顺序格外接半径（buildUI 设置）
        let curFrameSeat = null;  // 显示当前位置框的行动玩家（选择移动后移除）

        /** 逐格移动动画：沿 path 每格停留 200ms（不走最短路线，按骰子点数的格数走）。
         *  动画期间该棋子不显示方向箭头；到达后按新格重新计算方向（记录来向）。
         *  动画开始即移除当前位置框；骰子（右下角缩小版）保持显示直至行动完毕。
         *  骰子未转完（diceAnim 活跃）时排队等待——保证前一轮骰子播完才开始行动。 */
        function playMoveAnimation(path, seat, onDone) {
            if (diceAnim) {   // 骰子还在转：等转完再开始移动
                moveTimer = setTimeout(() => playMoveAnimation(path, seat, onDone), 150);
                return;
            }
            if (moveTimer) clearTimeout(moveTimer);
            animatingMove = true;   // 动画进行中——视野/地图更新冻结到动画完成
            stopBlink();            // 移动开始：停止闪烁
            showTargets = false;   // 移动动画期间不显示目标格
            curFrameSeat = null;   // 选择后开始移动：移除当前位置框
            currentMovePos[seat] = path[0];
            drawBoard();
            let idx = 0;
            const step = () => {
                idx++;
                if (idx >= path.length) {
                    currentMovePos[seat] = null;
                    lastFrom[seat] = path[path.length - 2];   // 记录来向（新箭头方向按此计算）
                    moveTimer = null;              // 动画完成：立即清除动画标记
                    animatingMove = false;         // 动画结束——视野/地图更新解冻（角色已到目标格）
                    animPropsSnapshot = null;      // 立即显示新地图（♜ 占领 / mine 等——不等下一手）
                    drawBoard();
                    if (onDone) onDone();
                    return;
                }
                currentMovePos[seat] = path[idx];
                drawBoard();
                moveTimer = setTimeout(step, 150);   // 每格停留 150ms
            };
            moveTimer = setTimeout(step, 150);
        }

        function hideDice() {
            const de = document.getElementById('dfwDice');
            if (de) de.style.display = 'none';
        }

        let viewAnimTimer = null;   // 视角过渡动画定时器

        /** 视角平滑移动到 (tx, ty)（600ms easeInOut，逐帧重绘），完成后回调 */
        function animateViewTo(tx, ty, onDone) {
            if (viewAnimTimer) clearTimeout(viewAnimTimer);
            const sx = viewCenterX, sy = viewCenterY;
            const DUR = 600;
            const t0 = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - t0) / DUR);
                const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOut
                viewCenterX = sx + (tx - sx) * e;
                viewCenterY = sy + (ty - sy) * e;
                clampBoardView();
                drawBoard();
                if (t < 1) viewAnimTimer = setTimeout(() => step(performance.now()), 16);
                else if (onDone) onDone();
            };
            step(t0);
        }

        /** 先转视角到行动玩家（平滑过渡），转完视角后回调（再摇骰）；锁定视角时不移动 */
        function centerViewToSeat(seat, onDone) {
            if (lockView) { if (onDone) onDone(); return; }   // 锁定视角：跳过自动移动
            if (seat == null || !gameState || !gameState.piecePositions) { if (onDone) onDone(); return; }
            const p0 = gameState.piecePositions[seat];
            if (p0 == null || p0 < 0 || p0 >= V || !cellCenters[p0]) { if (onDone) onDone(); return; }
            lastViewSeat = seat;
            if (viewZoom < 2) viewZoom = 2;
            const tx = cellCenters[p0].x, ty = cellCenters[p0].y;
            if (Math.abs(tx - viewCenterX) < 1 && Math.abs(ty - viewCenterY) < 1) {
                clampBoardView();
                drawBoard();
                if (onDone) onDone();   // 已在目标位置：直接继续
            } else {
                animateViewTo(tx, ty, onDone);
            }
        }

        function applyState(state) {
            if (!state) return;
            if (state.boardSize && state.boardSize !== boardSize) {
                boardSize = state.boardSize;
                applyGeometry(boardSize, mapType);
            }
            if (state.mapType && state.mapType !== mapType) {
                // 地图形状切换（开局前）：重新生成几何、复位视角、同步选择器
                mapType = state.mapType;
                viewCenterX = FRAME_CENTER;
                viewCenterY = FRAME_CENTER;
                viewZoom = 1;
                lastViewSeat = null;
                moveAnimKey = null;
                lastDiceKey = null;
                hideDice();
                applyGeometry(boardSize, mapType);
                const sel = document.getElementById('dfwMapTypeSelect');
                if (sel && sel.value !== mapType) sel.value = mapType;
            }
            if (state.removed) applyRemoved(state.removed);
            const prevProps = gameState ? gameState.cellProps : null;
            const prevMine = gameState ? gameState.mineWealth : null;
            const prevLand = gameState ? gameState.landValue : null;
            gameState = state;
            const willMove = state.movePath && state.movePath.length >= 2 &&
                state.movePathSeat + ':' + state.movePath.join(',') !== moveAnimKey;
            if (willMove) animPropsSnapshot = { cellProps: prevProps, mineWealth: prevMine, landValue: prevLand };
            // 动画完成后清除快照（drawBoard 判断 moveTimer 结束）
            const diceKey = (state.turnIndex != null ? state.turnIndex : -1) + ':' + (state.dicePoint != null ? state.dicePoint : '');
            const hasNewDice = state.phase === 'playing' && state.dicePoint != null && diceKey !== lastDiceKey;
            // movePath 与下一轮的 dicePoint 常在同一广播里——先播移动动画（每格 500ms），动画结束再摇骰 + 切换视角
            const mpKey = (state.movePath && state.movePath.length >= 2) ? state.movePathSeat + ':' + state.movePath.join(',') : null;
            const hasNewMove = mpKey != null && mpKey !== moveAnimKey;
            if (hasNewMove) {
                moveAnimKey = mpKey;
                playMoveAnimation(state.movePath, state.movePathSeat, () => {
                    if (hasNewDice) {
                        // 移动完成：先给当前位置加框 → 转视角（平滑）→ 转完再摇骰
                        curFrameSeat = state.currentSeat;
                        lastDiceKey = diceKey;
                        centerViewToSeat(state.currentSeat, () => playDice());
                    } else {
                        lastDiceKey = null;
                        hideDice();
                    }
                });
            } else {
                if (hasNewDice) {
                    // 轮到新玩家：先给当前位置加框 → 转视角（平滑）→ 转完再摇骰
                    curFrameSeat = state.currentSeat;
                    lastDiceKey = diceKey;
                    centerViewToSeat(state.currentSeat, () => playDice());
                } else if (state.phase !== 'playing' || state.dicePoint == null) {
                    lastDiceKey = null;
                    hideDice();
                }
                if (state.phase !== 'playing') { lastViewSeat = null; curFrameSeat = null; }
            }
            renderSeats();
            renderStats();
            renderSidePanels && renderSidePanels();
            renderMask();
            renderPlayerId();
            renderTurnBar();
            drawBoard();
        }

        function handleMessage(msg) {
            if (msg.type === 'dfwState') {
                applyState(msg.state);
            } else if (msg.type === 'error') {
                if (typeof qiAlert === 'function') qiAlert(msg.message);
            }
        }

        function connectWebSocket() {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${location.host}/qi/ws?game=${gameType}&room=${roomId}`);
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', password: roomPassword, requestedSlot: null }));
                ws.send(JSON.stringify({ type: 'dfwEnter' }));
            };
            ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
            ws.onclose = (ev) => {
                if (ev.code === 1008 && String(ev.reason || '').includes('房间')) {
                    if (typeof qiAlert === 'function') qiAlert('房间不存在');
                    window.location.href = '/qi';
                    return;
                }
                reconnectTimer = setTimeout(connectWebSocket, 2000);
            };
        }

// ======================== 6 人 UI：ID / 座位 / 蒙版 ========================
        function buildUI() {
            // 隐藏不需要的公共面板
            [
                'newGameBtn', 'estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn',
                'importBtn', 'exportBtn', 'vsComputerBtn', 'buryFinishBtn', 'scoreConfirmPanel',
                'replayPanel', 'boardMarkOuter', 'editControls', 'boardSizeSelect', 'styleSelect', 'subGameSelect',
                'goTimerPanel', 'roomChat', 'replayMinesRow', 'showLibertyStonesLabel'
            ].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            const bp = document.querySelector('.button-panel');
            if (bp) bp.style.display = 'none';
            const snl = document.querySelector('.show-numbers-label');
            if (snl) snl.style.display = 'none';
            // 左右侧栏容器保留（用于放座位），只隐藏其原有内容
            const mar = document.querySelector('.main-area-right');
            if (mar) {
                const infoPanel = mar.querySelector('.info-panel');
                if (infoPanel) infoPanel.style.display = 'none';
                mar.style.display = '';
            }
            const sideSelect = document.getElementById('sideSelect');
            if (sideSelect) sideSelect.hidden = true;
            const colorStatus = document.getElementById('colorStatus');
            if (colorStatus) colorStatus.style.display = 'none';
            const komiInfo = document.getElementById('komiInfo');
            if (komiInfo) komiInfo.style.display = 'none';
            const showNumbersCheck = document.getElementById('showNumbersCheck');
            if (showNumbersCheck) { showNumbersCheck.checked = false; showNumbersCheck.style.display = 'none'; }
            const gameTitleInfo = document.getElementById('gameTitleInfo');
            if (gameTitleInfo) gameTitleInfo.textContent = 'DFW';

            // 样式
            const style = document.createElement('style');
            style.textContent = `
                #dfwPlayerId { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px;
                    border-radius: 999px; background: rgba(255, 250, 241, 0.92);
                    border: 1px solid var(--qi-room-line, #d8c9b0); color: var(--qi-room-ink, #3a281c);
                    font-weight: 500; margin-left: 10px; }
                #dfwPlayerId span { color: var(--qi-room-accent-strong, #8a5a2b); }
                #dfwSeatsLeft, #dfwSeatsRight { display: flex; flex-direction: column; gap: 10px;
                    align-items: center; }
                #dfwSeatsLeft { padding: 10px 0; }
                #dfwSeatsRight { padding: 10px 0; }
                .dfw-side { display: flex; flex-direction: column; align-items: center; gap: 6px; }
                .dfw-stats { display: flex; flex-direction: column; gap: 4px; }   /* 财富/游历各占一行 */
                .dfw-stat { padding: 3px 14px; border-radius: 999px; font-size: 15px; font-weight: 700;
                    user-select: none; white-space: nowrap; width: 192px; box-sizing: border-box;
                    display: flex; align-items: center; justify-content: space-between; }
                    /* 胶囊形：左右圆、中间直；与座位框等宽，名字在左、数字靠右 */
                .dfw-stat-gold { background: #fdf3d0; border: 2px solid #d4a017; color: #b8860b; }
                .dfw-stat-travel { background: #e2f5e0; border: 2px solid #2e8b2e; color: #2e8b2e; }
                #dfwSkills { display: none; flex-direction: row; flex-wrap: wrap; gap: 8px; margin-top: 8px;
                    padding: 8px; border: 2px solid #d8c9b0; border-radius: 12px; background: rgba(255,250,241,0.6);
                    justify-content: center; max-width: 220px; }
                /* 手机上：技能框显示在地图下方，占满宽度 */
                @media (max-width: 900px) {
                    #dfwSkills.dfw-skills-mobile { position: absolute; top: calc(100% + 8px); left: 6px; right: 6px;
                        max-width: none; margin-top: 0; justify-content: flex-start; }
                }
                .dfw-skill { width: 56px; height: 56px; border-radius: 10px; border: 2px solid #8a5a2b;
                    background: #fff8ec; color: #8a5a2b; font-size: 13px; font-weight: 700; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; user-select: none; }
                .dfw-skill:disabled { background: #e8e4dc; border-color: #b8b0a4; color: #b8b0a4; cursor: default; }
                /* 手机/窄屏：六座位一行显示在棋盘上方（左三右三，中间留间距），座位缩小 */
                @media (max-width: 900px) {
                    #dfwSeatsLeft.dfw-seats-mobile, #dfwSeatsRight.dfw-seats-mobile {
                        position: absolute; top: -146px; flex-direction: row; gap: 8px;
                        margin: 0; padding: 0; z-index: 30; }
                    #dfwSeatsLeft.dfw-seats-mobile { left: 6px; }
                    #dfwSeatsRight.dfw-seats-mobile { right: 6px; }
                    .dfw-side { gap: 3px; }
                    .dfw-stat { font-size: 11px; padding: 1px 7px; width: 96px; }
                    .dfw-seat { width: 96px; min-height: 56px; font-size: 12px; gap: 2px; }
                    .dfw-seat .dfw-seat-piece { font-size: 24px; }
                    .dfw-seat .dfw-seat-name { max-width: 90px; font-size: 11px; }
                }
                .dfw-seat { width: 192px; min-height: 132px; border: 2px solid #aaa; border-radius: 12px;
                    background: rgba(255,255,255,0.75); display: flex; flex-direction: column; align-items: center;
                    justify-content: center; gap: 4px; cursor: pointer; user-select: none; font-size: 20px; }
                .dfw-seat .dfw-seat-piece { font-size: 48px; line-height: 1; }
                .dfw-seat .dfw-seat-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .dfw-seat.dfw-seat-red { border-color: #c03030; color: #c03030; }
                .dfw-seat.dfw-seat-blue { border-color: #3050c0; color: #3050c0; }
                .dfw-seat.dfw-seat-empty { border-style: dashed; opacity: 0.75; }
                .dfw-seat.dfw-seat-mine { background: rgba(255,240,150,0.9); box-shadow: 0 0 6px rgba(200,150,0,0.6); }
                #dfwMask { position: absolute; inset: 0; background: transparent; z-index: 40;
                    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
                    pointer-events: none; }
                #dfwMask .qi-seat-overlay-btn { pointer-events: auto; }
                #dfwMask .dfw-wait-btn { color: #999; opacity: 1 !important; }   /* disabled 默认 opacity 0.45，等待按钮不透明 */
                #dfwTurnBar { display: none; justify-content: center; gap: 6px; margin-top: 10px;
                    grid-column: 2; z-index: 30; }
                .dfw-turn-cell { flex-shrink: 0; display: block; }
                #dfwDice { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
                    display: none; z-index: 45; }
                /* 开始按钮直接复用棋类的 qi-seat-overlay-btn 样式（room.css 已定义） */
            `;
            document.head.appendChild(style);

            // ID 显示（gameTitleInfo 右边）+ 锁定视角选项
            const titleEl = document.getElementById('gameTitleInfo');
            if (titleEl) {
                const idSpan = document.createElement('span');
                idSpan.id = 'dfwPlayerId';
                idSpan.innerHTML = 'ID：<span></span>';
                titleEl.insertAdjacentElement('afterend', idSpan);
                const lockLabel = document.createElement('label');
                lockLabel.id = 'dfwLockView';
                lockLabel.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; margin-left: 10px;' +
                    'font-size: 13px; color: var(--qi-room-ink, #3a281c); cursor: pointer; user-select: none;';
                lockLabel.innerHTML = '<input type="checkbox"> 锁定视角';
                const lockInput = lockLabel.querySelector('input');
                lockInput.addEventListener('change', () => { lockView = lockInput.checked; });
                idSpan.insertAdjacentElement('afterend', lockLabel);
                // 地图形状选择（六角 / 四角）：仅在开局前显示（renderMask 控制），
                // 样式与围棋类游戏的棋盘大小选择器一致（board-size-select）；切换即通知服务端重新生成
                mapTypeSel = document.createElement('select');
                mapTypeSel.id = 'dfwMapTypeSelect';
                mapTypeSel.className = 'board-size-select';
                mapTypeSel.style.cssText = 'margin-left: 10px; font-size: 13px; display: none;';
                mapTypeSel.innerHTML = '<option value="hex">六角</option><option value="square">四角</option>';
                mapTypeSel.addEventListener('change', () => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'dfwSetMapType', mapType: mapTypeSel.value }));
                    }
                });
                // 锁定视角的左边
                lockLabel.insertAdjacentElement('beforebegin', mapTypeSel);
            }

            // 座位容器：红/蓝两组（每组 = 财富框 + 游历框 + 3 座位），按"己方在右"排列：
            //   红方玩家 → 右栏红组；蓝方玩家/观战者 → 右栏蓝组。中途坐下也会重排（renderSidePanels）。
            seatsLeftEl = document.createElement('div');
            seatsLeftEl.id = 'dfwSeatsLeft';
            seatsRightEl = document.createElement('div');
            seatsRightEl.id = 'dfwSeatsRight';
            redSideEl = document.createElement('div');
            redSideEl.className = 'dfw-side';
            redSideEl.dataset.side = '0';
            blueSideEl = document.createElement('div');
            blueSideEl.className = 'dfw-side';
            blueSideEl.dataset.side = '1';
            for (let g = 0; g < 2; g++) {
                const sideEl = g === 0 ? redSideEl : blueSideEl;
                const statsEl = document.createElement('div');
                statsEl.className = 'dfw-stats';
                const goldEl = document.createElement('div');
                goldEl.className = 'dfw-stat dfw-stat-gold';
                goldEl.innerHTML = '<span>💰</span><span>1000</span>';
                const travelEl = document.createElement('div');
                travelEl.className = 'dfw-stat dfw-stat-travel';
                travelEl.innerHTML = '<span>👣</span><span>0</span>';
                travelEl.addEventListener('mouseenter', () => { hoverTravelSide = g; drawBoard(); });
                travelEl.addEventListener('mouseleave', () => { if (hoverTravelSide === g) { hoverTravelSide = null; drawBoard(); } });
                // 点击（手机上）：显示经过格，5 秒后或再次点击消失
                travelEl.addEventListener('click', () => {
                    if (hoverTravelSide === g) {
                        hoverTravelSide = null;
                        if (travelHideTimer) clearTimeout(travelHideTimer);
                    } else {
                        hoverTravelSide = g;
                        if (travelHideTimer) clearTimeout(travelHideTimer);
                        travelHideTimer = setTimeout(() => { hoverTravelSide = null; drawBoard(); }, 5000);
                    }
                    drawBoard();
                });
                statsEl.appendChild(goldEl);
                statsEl.appendChild(travelEl);
                sideEl.appendChild(statsEl);
                for (let k = 0; k < 3; k++) {
                    const i = g * 3 + k;
                    const seatEl = document.createElement('div');
                    seatEl.className = 'dfw-seat dfw-seat-empty ' + (i < 3 ? 'dfw-seat-red' : 'dfw-seat-blue');
                    seatEl.dataset.seat = String(i);
                    seatEl.innerHTML = '<div class="dfw-seat-piece">' + SEAT_PIECES[i] + '</div><div class="dfw-seat-name">空</div>';
                    seatEl.addEventListener('click', () => onSeatClick(i));
                    sideEl.appendChild(seatEl);
                }
            }
            mobMQObj = window.matchMedia('(max-width: 900px)');
            mobMQObj.addEventListener('change', () => { renderSidePanels(); drawBoard(); });
            renderSidePanels();

            // 技能框（右下角 dfwSeatsRight 下方——仅玩家页面显示；观战者不显示）
            const skillsEl = document.createElement('div');
            skillsEl.id = 'dfwSkills';
            skillsEl.innerHTML = '<button id="dfwSkillBackpack" class="dfw-skill" disabled>背包</button>' +
                '<button id="dfwSkillResurrect" class="dfw-skill">重生</button>';
            const skillRes = skillsEl.querySelector('#dfwSkillResurrect');
            skillRes.addEventListener('click', () => {
                if (typeof qiConfirm === 'function') {
                    qiConfirm('是否确认重生？').then((ok) => {
                        if (ok && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resurrect' }));
                    });
                } else if (window.confirm('是否确认重生？')) {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resurrect' }));
                }
            });
            const skillRail = document.querySelector('.main-area-right');
            if (skillRail) skillRail.appendChild(skillsEl);

            // 行动顺序条（棋盘正下方、水平居中：6 个固定尺寸 SVG 格，按行动顺序填棋子，轮到涂黄；
            // 格子形状随地图形状：六角=正六边形、四角=菱形）
            const turnBar = document.createElement('div');
            turnBar.id = 'dfwTurnBar';
            const R_T = 18;   // 格外接半径（固定，不随容器缩放）
            turnR = R_T;
            const NS = 'http://www.w3.org/2000/svg';
            turnPolys = [];
            for (let k = 0; k < 6; k++) {
                const svg = document.createElementNS(NS, 'svg');
                svg.setAttribute('width', String(R_T * 2));
                svg.setAttribute('height', String(R_T * 2));
                svg.setAttribute('class', 'dfw-turn-cell');
                const poly = document.createElementNS(NS, 'polygon');
                poly.setAttribute('points', cellShape.turnPoly(R_T));
                poly.setAttribute('fill', '#ffffff');
                poly.setAttribute('stroke', '#c8b89a');
                poly.setAttribute('stroke-width', '1.2');
                turnPolys.push(poly);
                svg.appendChild(poly);
                const txt = document.createElementNS(NS, 'text');
                txt.setAttribute('x', String(R_T));
                txt.setAttribute('y', String(R_T));
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('dominant-baseline', 'central');
                txt.setAttribute('font-size', '16');
                txt.setAttribute('font-family', 'serif');
                svg.appendChild(txt);
                turnBar.appendChild(svg);
            }
            if (boardContainer) boardContainer.after(turnBar);

            // 骰子：Three.js 圆角立方体（renderer 动态挂载），棋盘中央 overlay
            const diceEl = document.createElement('div');
            diceEl.id = 'dfwDice';
            if (boardContainer) boardContainer.appendChild(diceEl);

            // 悬停提示框（mine 剩余财富点 / 手机上点击显示，5 秒后或再次点击消失）
            tipEl = document.createElement('div');
            tipEl.id = 'dfwTooltip';
            tipEl.style.cssText = 'position: absolute; background: rgba(40,30,20,0.92); color: #fff;' +
                'padding: 4px 10px; border-radius: 6px; font-size: 13px; pointer-events: none;' +
                'z-index: 60; display: none; white-space: nowrap;';
            if (boardContainer) boardContainer.appendChild(tipEl);

            // 蒙版（开局前不可取消）
            const mask = document.createElement('div');
            mask.id = 'dfwMask';
            mask.innerHTML = '<div id="dfwMaskText">等待玩家(0/6)</div>';
            if (boardContainer) boardContainer.appendChild(mask);

            // 帮助按钮说明
            document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
            document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
            document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };
        }

        function onSeatClick(seat) {
            if (!gameState) return;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (gameState.mySeat === seat) {
                ws.send(JSON.stringify({ type: 'leaveSeat' }));
            } else if (gameState.seats[seat] == null) {
                ws.send(JSON.stringify({ type: 'takeSeat', seat }));
            }
        }

        function renderSeats() {
            const seats = gameState ? gameState.seats : null;
            if (!seats) return;
            for (let i = 0; i < 6; i++) {
                const el = document.querySelector('.dfw-seat[data-seat="' + i + '"]');
                if (!el) continue;
                const name = seats[i];
                const mine = gameState.mySeat === i;
                el.classList.toggle('dfw-seat-empty', !name);
                el.classList.toggle('dfw-seat-mine', mine);
                const pieceEl = el.querySelector('.dfw-seat-piece');
                const nameEl = el.querySelector('.dfw-seat-name');
                if (pieceEl) pieceEl.textContent = SEAT_PIECES[i];
                if (nameEl) nameEl.textContent = name || (mine ? '点击离座' : '空');
            }
        }

        /** 技能按钮状态：轮到当前玩家且已摇骰（摇骰后）→ 重生可用；平常灰色禁用；观战不显示 */
        function updateSkills() {
            const el = document.getElementById('dfwSkills');
            if (!el) return;
            const show = gameState && gameState.mySeat != null && gameState.mySeat >= 0;
            el.style.display = show ? 'flex' : 'none';
            if (!show) return;
            const canUse = gameState.phase === 'playing' &&
                gameState.currentSeat === gameState.mySeat &&
                gameState.dicePoint != null;
            const rs = document.getElementById('dfwSkillResurrect');
            if (rs) rs.disabled = !canUse;
            const bk = document.getElementById('dfwSkillBackpack');
            if (bk) bk.disabled = true;   // 背包暂不实现
        }

        /** 财富/游历框：财富 = 服务端广播的每方财富（初始 1000 + mine 收益）；游历 = 经过格集合数量 */
        function renderStats() {
            updateSkills();
            if (!gameState) return;
            for (let g = 0; g < 2; g++) {
                if (gameState.wealth) {
                    const goldEl = document.querySelector('.dfw-side[data-side="' + g + '"] .dfw-stat-gold');
                    if (goldEl) {
                        const val = goldEl.querySelector('span:last-child');
                        if (val) val.textContent = String(gameState.wealth[g] != null ? gameState.wealth[g] : 1000);
                    }
                }
                if (gameState.visitedCells) {
                    const travelEl = document.querySelector('.dfw-side[data-side="' + g + '"] .dfw-stat-travel');
                    if (travelEl) {
                        const val = travelEl.querySelector('span:last-child');
                        if (val) val.textContent = String(gameState.visitedCells[g] ? gameState.visitedCells[g].length : 0);
                    }
                }
            }
        }

        function renderMask() {
            const mask = document.getElementById('dfwMask');
            if (!mask) return;
            // 地图形状选择器只在开局前显示
            if (mapTypeSel) mapTypeSel.style.display = (!gameState || gameState.phase !== 'lobby') ? 'none' : 'inline-block';
            if (!gameState || gameState.phase !== 'lobby') {
                mask.style.display = 'none';
                return;
            }
            mask.style.display = 'flex';
            const seated = (gameState.seats || []).filter((s) => s != null).length;
            const isHost = gameState.myId && gameState.myId === gameState.hostId;
            if (isHost) {
                // 房主：直接显示开始按钮（即便没有坐满也可以开始）
                mask.innerHTML = '<button id="dfwStartBtn" class="qi-seat-overlay-btn">开始游戏</button>';
                document.getElementById('dfwStartBtn').addEventListener('click', () => {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'startGame' }));
                });
                return;
            }
            // 非房主：等待文字用与开始按钮相同样式，文字灰色（disabled 按钮）
            if (seated < 6) {
                mask.innerHTML = '<button class="qi-seat-overlay-btn dfw-wait-btn" disabled>等待玩家加入(' + seated + '/6)</button>';
                return;
            }
            mask.innerHTML = '<button class="qi-seat-overlay-btn dfw-wait-btn" disabled>等待房主开始游戏</button>';
        }

        /** 行动顺序条：6 个六角格按 turnOrder 填棋子，轮到当前格涂黄 */
        function renderTurnBar() {
            const bar = document.getElementById('dfwTurnBar');
            if (!bar) return;
            if (!gameState || gameState.phase !== 'playing' || !gameState.turnOrder) {
                bar.style.display = 'none';
                return;
            }
            bar.style.display = 'flex';
            const pts = cellShape.turnPoly(turnR);
            const cells = bar.children;
            for (let k = 0; k < 6 && k < cells.length; k++) {
                const seat = gameState.turnOrder[k];
                const svg = cells[k];
                const poly = turnPolys[k] || svg.querySelector('polygon');
                if (poly) poly.setAttribute('points', pts);
                const txt = svg.querySelector('text');
                poly.setAttribute('fill', k === gameState.turnIndex ? '#ffd54a' : '#ffffff');
                txt.textContent = SEAT_PIECES[seat];
                txt.setAttribute('fill', seat < 3 ? '#c03030' : '#3050c0');
            }
        }

        let diceTimer = null;
        let diceAnim = null;
        let showTargets = false;   // 骰子动画结束后才置 true（显示目标格框选）

        /** Three.js 圆角骰子（three.min.js + RoundedBoxGeometry 本地引用） */
        let threeDice = null;
        let threeLoading = null;

        function loadThreeScripts() {
            if (window.THREE && window.THREE.RoundedBoxGeometry) return Promise.resolve();
            if (threeLoading) return threeLoading;
            threeLoading = new Promise((resolve, reject) => {
                const s1 = document.createElement('script');
                s1.src = '/qi/vendor/three.min.js';
                s1.onload = () => {
                    const s2 = document.createElement('script');
                    s2.src = '/qi/vendor/RoundedBoxGeometry.js';
                    s2.onload = () => {
                        const s3 = document.createElement('script');
                        s3.src = '/qi/vendor/RoundedOctahedronGeometry.js';
                        s3.onload = () => resolve();
                        s3.onerror = () => reject(new Error('RoundedOctahedronGeometry 加载失败'));
                        document.head.appendChild(s3);
                    };
                    s2.onerror = () => reject(new Error('RoundedBoxGeometry 加载失败'));
                    document.head.appendChild(s2);
                };
                s1.onerror = () => reject(new Error('three.min.js 加载失败'));
                document.head.appendChild(s1);
            });
            return threeLoading;
        }

        /** 生成 d8 三角面圆点纹理（CanvasTexture：浅黄底圆点）。
         *  纹理三角占满画布（顶点 (128,0) 底 (0,256)-(256,256)），切角六边形面区域：
         *  顶边 y 33、底边 y 223（rCut=0.13），半宽 16.6 → 94.7；
         *  行围绕六边形中心（y 171）对称分布，点数居中在面上。 */
        function makePipsTexture(num) {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 256;
            const g = c.getContext('2d');
            g.fillStyle = '#fffae0';   // 很浅很浅的黄色
            g.fillRect(0, 0, 256, 256);
            g.fillStyle = '#3a281c';
            // 三角形面（UV：等边三角形（与面片相似）——A→(0.5,0.9) B→(0.1535,0.3) C→(0.8465,0.3)，
            // 重心 (0.5,0.5) 面中心居中；等边保证纹理圆点映射到面上保持正圆不拉长）。
            const rad = 9;    // 直径 18px——行距 19px（6/7/8 点同列行距）> 直径——不粘连
            if (num === 3 || num === 6) {
                // 3 点：等边三角形（顶点在上）——底距 2w = 44px，高 h = w√3 = 38px
                // 6 点：同一三角形的三个顶点 + 顶点两两的中点（三个中点）——间距为 3 点的 1.5 倍
                const w3 = num === 6 ? 26 : 22, h3 = Math.round(w3 * Math.sqrt(3));   // 6 点：底距 52（1.2 倍）、高 45
                const yTop = 128 - h3 / 2, yBot = 128 + h3 / 2;
                const A = [128, yTop], B = [128 - w3, yBot], C = [128 + w3, yBot];
                const triPts = num === 3
                    ? [A, B, C]
                    : [A, B, C,
                       [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2],
                       [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2],
                       [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2]];
                for (const [x, y] of triPts) {
                    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
                }
                return new THREE.CanvasTexture(c);
            }
            // 行 i=0 在上（v 大），行距均匀围绕中心；每行内点间距统一为 P（2 点行与 3 点行同间距）；
            // 单独的点数 2（一行两个）间距加宽（P+6）。
            const rows = { 1: [1], 2: [2], 4: [1, 3], 5: [2, 3], 6: [1, 2, 3], 7: [1, 3, 3], 8: [2, 3, 3] }[num] || [1];
            const nR = rows.length;
            const P = 22;     // 行内点间距（3 点行 x=106/128/150，2 点行 x=117/139——同间距紧凑）
            const P2 = 28;    // 点数 2 的两个点间距加宽（x=114/142）
            for (let i = 0; i < nR; i++) {
                // 7/8 点行高与 6 点相同（6 点三角形点阵的行位置 y=105.5/128/150.5——行距 22.5px）、点距同 6 点（26px）
                const v = (num === 7 || num === 8) ? [0.588, 0.5, 0.412][i] : 0.67 - 0.33 * (i + 0.5) / nR;
                const y = (1 - v) * 256;
                const cnt = rows[i];
                const step = (num === 7 || num === 8) ? 26 : ((num === 2 && cnt === 2) ? P2 : P);
                for (let k = 0; k < cnt; k++) {
                    const x = 128 + step * (k - (cnt - 1) / 2);
                    g.beginPath();
                    g.arc(x, y, rad, 0, Math.PI * 2);
                    g.fill();
                }
            }
            return new THREE.CanvasTexture(c);
        }

        /** 生成骰子面纹理（CanvasTexture：浅黄面 + 圆点） */
        function makeFaceTexture(n) {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 256;
            const g = c.getContext('2d');
            g.fillStyle = '#fffae0';   // 很浅很浅的黄色
            g.fillRect(0, 0, 256, 256);
            g.fillStyle = '#3a281c';
            // 网格 -1..1（中心 128，间距 52——范围 76..180，点在面中央区域）
            const PIPS = {
                1: [[0, 0]],
                2: [[-1, 1], [1, -1]],
                3: [[-1, 1], [0, 0], [1, -1]],
                4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
                5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
                6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]]
            };
            for (const [u, v] of PIPS[n]) {
                g.beginPath();
                g.arc(128 + u * 52, 128 + v * 52, 24, 0, Math.PI * 2);   // 半径 1.5 倍（圆心不变）
                g.fill();
            }
            return new THREE.CanvasTexture(c);
        }

                /** 初始化骰子场景（type: 'd6' 圆角立方体 / 'd8' 切角八面体）——
         *  统一 MeshStandardMaterial + 灯光；d8 = 切角八面体（8 六边形大面 + 6 角面），
         *  顶点法线平滑 = 圆角感，保持八面骰形状。 */
        function initThreeDice(type) {
            const container = document.getElementById('dfwDice');
            if (!container) return;
            container.innerHTML = '';
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(180, 180);
            renderer.setClearColor(0x000000, 0);   // 透明背景
            container.appendChild(renderer.domElement);
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
            camera.position.set(0, 0, 4.5);
            camera.lookAt(0, 0, 0);
            scene.add(new THREE.AmbientLight(0xffffff, 0.65));
            const dl = new THREE.DirectionalLight(0xffffff, 0.85);
            dl.position.set(3, 4, 5);
            scene.add(dl);
            let mesh;
            let targetFor;
            if (type === 'd8') {
                // 测试：只显示面（缩小留边——面片之间空出棱的位置——面与棱/角分离）+ 法线
                const k = 1 - 0.2 * Math.sqrt(3) / 1.725;
                const geo = new THREE.OctahedronGeometry(1.725, 0);
                // 面片缩小（每面沿重心缩 0.8——留 20% 边距——面与面分离）
                {
                    const posA2 = geo.attributes.position;
                    for (let i = 0; i < posA2.count; i += 3) {
                        const cx = (posA2.getX(i) + posA2.getX(i + 1) + posA2.getX(i + 2)) / 3;
                        const cy = (posA2.getY(i) + posA2.getY(i + 1) + posA2.getY(i + 2)) / 3;
                        const cz = (posA2.getZ(i) + posA2.getZ(i + 1) + posA2.getZ(i + 2)) / 3;
                        for (let kk = 0; kk < 3; kk++) {
                            posA2.setXYZ(i + kk,
                                cx + (posA2.getX(i + kk) - cx) * 0.8,
                                cy + (posA2.getY(i + kk) - cy) * 0.8,
                                cz + (posA2.getZ(i + kk) - cz) * 0.8);
                        }
                    }
                }
                const normToNum = {
                    '1,1,1': 1, '-1,-1,-1': 5,
                    '1,1,-1': 6, '-1,-1,1': 7,
                    '1,-1,1': 3, '-1,1,-1': 2,
                    '-1,1,1': 4, '1,-1,-1': 8
                };
                const DV = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
                const FACES = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
                const faceNormals = FACES.map((f) => {
                    const n = [DV[f[0]][0] + DV[f[1]][0] + DV[f[2]][0], DV[f[0]][1] + DV[f[1]][1] + DV[f[2]][1], DV[f[0]][2] + DV[f[1]][2] + DV[f[2]][2]];
                    const l = Math.hypot(n[0], n[1], n[2]) || 1;
                    return [n[0] / l, n[1] / l, n[2] / l];
                });
                // 每母面点数：细分面归属 8 个母面（法线匹配）+ UV 重心坐标 + groups
                {
                    const posA = geo.attributes.position;
                    const nFaces = posA.count / 3;
                    const uvs = new Float32Array(posA.count * 2);
                    for (let i = 0; i < nFaces; i++) {
                        const cx = (posA.getX(i * 3) + posA.getX(i * 3 + 1) + posA.getX(i * 3 + 2)) / 3;
                        const cy = (posA.getY(i * 3) + posA.getY(i * 3 + 1) + posA.getY(i * 3 + 2)) / 3;
                        const cz = (posA.getZ(i * 3) + posA.getZ(i * 3 + 1) + posA.getZ(i * 3 + 2)) / 3;
                        let best = 0, bestDot = -Infinity;
                        for (let m = 0; m < 8; m++) {
                            const d = cx * faceNormals[m][0] + cy * faceNormals[m][1] + cz * faceNormals[m][2];
                            if (d > bestDot) { bestDot = d; best = m; }
                        }
                        const A = DV[FACES[best][0]], B = DV[FACES[best][1]], C = DV[FACES[best][2]];
                        for (let k = 0; k < 3; k++) {
                            // 直接解重心（面片顶点在母面平面内，1.725 尺度——Σ(la,lb,lc)≈1.725；
                            // 不能归一化到单位球——面片顶点不在单位球上，归一化偏离平面使 UV 重心偏移）
                            const px = posA.getX(i * 3 + k), py = posA.getY(i * 3 + k), pz = posA.getZ(i * 3 + k);
                            const M = [
                                [A[0], B[0], C[0], px],
                                [A[1], B[1], C[1], py],
                                [A[2], B[2], C[2], pz]
                            ];
                            for (let col = 0; col < 3; col++) {
                                let piv = col;
                                for (let r2 = col + 1; r2 < 3; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
                                const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
                                for (let r2 = 0; r2 < 3; r2++) {
                                    if (r2 === col) continue;
                                    const f = M[r2][col] / M[col][col];
                                    for (let k2 = col; k2 < 4; k2++) M[r2][k2] -= f * M[col][k2];
                                }
                            }
                            const la = M[0][3] / M[0][0], lb = M[1][3] / M[1][1], lc = M[2][3] / M[2][2];
                            // 除以总和归一化（Σ≈1.725→1；缩放绕原点但重心 (1/3,1/3,1/3) 不变——UV 重心精确 (0.5,0.5)）。
                            // UV 三角形为等边（与面片相似——底/高 = 2/√3）：A→(0.5,0.9) B→(0.1535,0.3) C→(0.8465,0.3)
                            // ——纹理圆点映射到面上保持正圆（此前扁三角形把点上下拉长成椭圆）
                            const S = la + lb + lc;
                            uvs[(i * 3 + k) * 2] = (0.5 * la + 0.1535 * lb + 0.8465 * lc) / S;
                            uvs[(i * 3 + k) * 2 + 1] = (0.9 * la + 0.3 * lb + 0.3 * lc) / S;
                        }
                        geo.addGroup(i * 3, 3, best);
                    }
                    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
                }
                // 材质按母面索引排列（groups 的 materialIndex = 母面索引——与点数顺序不同！）
                const materials = FACES.map((_, f) => {
                    const n = faceNormals[f];
                    const key = [n[0] > 0 ? 1 : -1, n[1] > 0 ? 1 : -1, n[2] > 0 ? 1 : -1].join(',');
                    return new THREE.MeshStandardMaterial({ map: makePipsTexture(normToNum[key]), roughness: 0.45, metalness: 0 });
                });
                mesh = new THREE.Mesh(geo, materials);
                // 公共几何（棱弧/角球共用）：内缩角、面法线、棱-面表
                const N3 = 4;
                const DV3 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
                const FACES3 = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
                const corner3 = DV3.map((v) => [v[0] * 1.725 * k, v[1] * 1.725 * k, v[2] * 1.725 * k]);
                const fn3 = FACES3.map((f) => {
                    const n = [DV3[f[0]][0] + DV3[f[1]][0] + DV3[f[2]][0], DV3[f[0]][1] + DV3[f[1]][1] + DV3[f[2]][1], DV3[f[0]][2] + DV3[f[1]][2] + DV3[f[2]][2]];
                    const l = Math.hypot(n[0], n[1], n[2]) || 1;
                    return [n[0] / l, n[1] / l, n[2] / l];
                });
                const edgeF3 = {};
                FACES3.forEach((f, fi) => {
                    for (let q = 0; q < 3; q++) {
                        const a = f[q], b = f[(q + 1) % 3];
                        const key = Math.min(a, b) + ',' + Math.max(a, b);
                        (edgeF3[key] = edgeF3[key] || []).push(fi);
                    }
                });
                // 棱弧（12 条圆柱弧——绕内缩棱、半径 r=0.2——外推棱；角不显示——端点悬空）
                {
                    const vArr3 = [];
                    const seen3 = new Set();
                    for (let a = 0; a < 6; a++) {
                        for (let b = a + 1; b < 6; b++) {
                            const key = a + ',' + b;
                            if (!edgeF3[key]) continue;
                            if (seen3.has(key)) continue;
                            seen3.add(key);
                            const F = edgeF3[key][0], G = edgeF3[key][1];
                            if (G === undefined) continue;
                            const cA = corner3[a], cB = corner3[b];
                            const nF = fn3[F], nG = fn3[G];
                            const cosT = Math.max(-1, Math.min(1, nF[0] * nG[0] + nF[1] * nG[1] + nF[2] * nG[2]));
                            const theta = Math.acos(cosT);
                            const mRaw = [nG[0] - nF[0] * cosT, nG[1] - nF[1] * cosT, nG[2] - nF[2] * cosT];
                            const mL = Math.hypot(mRaw[0], mRaw[1], mRaw[2]) || 1;
                            const m = [mRaw[0] / mL, mRaw[1] / mL, mRaw[2] / mL];
                            const pt3 = (s, u) => {
                                const dS = [
                                    nF[0] * Math.cos(theta * s) + m[0] * Math.sin(theta * s),
                                    nF[1] * Math.cos(theta * s) + m[1] * Math.sin(theta * s),
                                    nF[2] * Math.cos(theta * s) + m[2] * Math.sin(theta * s)
                                ];
                                const axis = [
                                    cA[0] + (cB[0] - cA[0]) * u,
                                    cA[1] + (cB[1] - cA[1]) * u,
                                    cA[2] + (cB[2] - cA[2]) * u
                                ];
                                return [axis[0] + dS[0] * 0.2, axis[1] + dS[1] * 0.2, axis[2] + dS[2] * 0.2];
                            };
                            for (let si = 0; si < N3; si++) {
                                for (let ui = 0; ui < N3; ui++) {
                                    const p0 = pt3(si / N3, ui / N3), p1 = pt3(si / N3, (ui + 1) / N3);
                                    const p2 = pt3((si + 1) / N3, ui / N3), p3 = pt3((si + 1) / N3, (ui + 1) / N3);
                                    vArr3.push(...p0, ...p1, ...p2, ...p1, ...p3, ...p2);
                                }
                            }
                        }
                    }
                    // 三角强制法线朝外（远离原点——背面剔除下 12 条棱都可见）
                    for (let qi = 0; qi < vArr3.length; qi += 9) {
                        const p0x = vArr3[qi], p0y = vArr3[qi + 1], p0z = vArr3[qi + 2];
                        const p1x = vArr3[qi + 3], p1y = vArr3[qi + 4], p1z = vArr3[qi + 5];
                        const p2x = vArr3[qi + 6], p2y = vArr3[qi + 7], p2z = vArr3[qi + 8];
                        const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z;
                        const vx = p2x - p0x, vy = p2y - p0y, vz = p2z - p0z;
                        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                        const cx = (p0x + p1x + p2x) / 3, cy = (p0y + p1y + p2y) / 3, cz = (p0z + p1z + p2z) / 3;
                        if (nx * cx + ny * cy + nz * cz < 0) {
                            for (let qk = 0; qk < 3; qk++) {
                                const t = vArr3[qi + qk]; vArr3[qi + qk] = vArr3[qi + 3 + qk]; vArr3[qi + 3 + qk] = t;
                            }
                        }
                    }
                    const lg3 = new THREE.BufferGeometry();
                    lg3.setAttribute('position', new THREE.Float32BufferAttribute(vArr3, 3));
                    lg3.computeVertexNormals();
                    // 棱弧颜色与面一致（浅黄——参照六面骰）
                    mesh.add(new THREE.Mesh(lg3, new THREE.MeshStandardMaterial({ color: 0xfffae0, roughness: 0.45 })));
                }
                // 角球（6 个——球面绕内缩角、半径 0.2——连接 4 条棱弧端点——浅黄）
                {
                    const neighC = Array.from({ length: 6 }, () => []);
                    for (const f of FACES3) for (const a of f) for (const b of f) {
                        if (a !== b && !neighC[a].includes(b)) neighC[a].push(b);
                    }
                    const vArrC = [];
                    for (let a = 0; a < 6; a++) {
                        const ua = DV3[a];
                        // 邻居环排序（绕 ua 角度）
                        const refN = neighC[a][0];
                        const refP = DV3[refN];
                        const ddot = refP[0] * ua[0] + refP[1] * ua[1] + refP[2] * ua[2];
                        const refD = [refP[0] - ua[0] * ddot, refP[1] - ua[1] * ddot, refP[2] - ua[2] * ddot];
                        const vx = ua[1] * refD[2] - ua[2] * refD[1];
                        const vy = ua[2] * refD[0] - ua[0] * refD[2];
                        const vz = ua[0] * refD[1] - ua[1] * refD[0];
                        neighC[a].sort((b1, b2) => {
                            const p1 = DV3[b1], p2 = DV3[b2];
                            const d1 = p1[0] * ua[0] + p1[1] * ua[1] + p1[2] * ua[2];
                            const d2 = p2[0] * ua[0] + p2[1] * ua[1] + p2[2] * ua[2];
                            const q1 = [p1[0] - ua[0] * d1, p1[1] - ua[1] * d1, p1[2] - ua[2] * d1];
                            const q2 = [p2[0] - ua[0] * d2, p2[1] - ua[1] * d2, p2[2] - ua[2] * d2];
                            return Math.atan2(q1[0] * vx + q1[1] * vy + q1[2] * vz, q1[0] * refD[0] + q1[1] * refD[1] + q1[2] * refD[2])
                                - Math.atan2(q2[0] * vx + q2[1] * vy + q2[2] * vz, q2[0] * refD[0] + q2[1] * refD[1] + q2[2] * refD[2]);
                        });
                        const Oc = corner3[a];
                        // 边界环（每棱 5 点：与棱弧网格相同的 dS 插值（s=0..1）——与棱弧端点严丝合缝）
                        const ring = [];
                        for (const nb of neighC[a]) {
                            const key = Math.min(a, nb) + ',' + Math.max(a, nb);
                            const F = edgeF3[key][0], G = edgeF3[key][1];
                            const nF = fn3[F], nG = fn3[G];
                            const cosT = Math.max(-1, Math.min(1, nF[0] * nG[0] + nF[1] * nG[1] + nF[2] * nG[2]));
                            const theta = Math.acos(cosT);
                            const mRaw = [nG[0] - nF[0] * cosT, nG[1] - nF[1] * cosT, nG[2] - nF[2] * cosT];
                            const mL = Math.hypot(mRaw[0], mRaw[1], mRaw[2]) || 1;
                            const m = [mRaw[0] / mL, mRaw[1] / mL, mRaw[2] / mL];
                            for (let si = 0; si <= N3; si++) {
                                const s = si / N3;
                                const dS = [
                                    nF[0] * Math.cos(theta * s) + m[0] * Math.sin(theta * s),
                                    nF[1] * Math.cos(theta * s) + m[1] * Math.sin(theta * s),
                                    nF[2] * Math.cos(theta * s) + m[2] * Math.sin(theta * s)
                                ];
                                ring.push([Oc[0] + dS[0] * 0.2, Oc[1] + dS[1] * 0.2, Oc[2] + dS[2] * 0.2]);
                            }
                        }
                        // 环排序（绕 ua）
                        ring.sort((p1, p2) => {
                            const d1 = p1[0] * ua[0] + p1[1] * ua[1] + p1[2] * ua[2];
                            const d2 = p2[0] * ua[0] + p2[1] * ua[1] + p2[2] * ua[2];
                            const q1 = [p1[0] - ua[0] * d1, p1[1] - ua[1] * d1, p1[2] - ua[2] * d1];
                            const q2 = [p2[0] - ua[0] * d2, p2[1] - ua[1] * d2, p2[2] - ua[2] * d2];
                            return Math.atan2(q1[0] * vx + q1[1] * vy + q1[2] * vz, q1[0] * refD[0] + q1[1] * refD[1] + q1[2] * refD[2])
                                - Math.atan2(q2[0] * vx + q2[1] * vy + q2[2] * vz, q2[0] * refD[0] + q2[1] * refD[1] + q2[2] * refD[2]);
                        });
                        // 相邻重复点去重（同一面法线端点被相邻两棱共用——排序后必相邻）
                        const uni = [];
                        for (const p of ring) {
                            const last = uni[uni.length - 1];
                            if (!last || last[0] !== p[0] || last[1] !== p[1] || last[2] !== p[2]) uni.push(p);
                        }
                        ring.length = 0;
                        ring.push(...uni);
                        // 球面顶点（角方向）
                        const cSph = [Oc[0] + ua[0] * 0.2, Oc[1] + ua[1] * 0.2, Oc[2] + ua[2] * 0.2];
                        // 层（球面上向顶点滑动）
                        const lay = (pts, s) => pts.map((p) => {
                            const dx = p[0] - Oc[0], dy = p[1] - Oc[1], dz = p[2] - Oc[2];
                            const ex = cSph[0] - Oc[0], ey = cSph[1] - Oc[1], ez = cSph[2] - Oc[2];
                            const ix = dx + (ex - dx) * s, iy = dy + (ey - dy) * s, iz = dz + (ez - dz) * s;
                            const l = Math.hypot(ix, iy, iz) || 1;
                            return [Oc[0] + ix / l * 0.2, Oc[1] + iy / l * 0.2, Oc[2] + iz / l * 0.2];
                        });
                        const L1 = lay(ring, 0.45), L2 = lay(ring, 0.8);
                        for (let k = 0; k < ring.length; k++) {
                            const k2 = (k + 1) % ring.length;
                            vArrC.push(...ring[k], ...ring[k2], ...L1[k], ...ring[k2], ...L1[k2], ...L1[k]);
                            vArrC.push(...L1[k], ...L1[k2], ...L2[k], ...L1[k2], ...L2[k2], ...L2[k]);
                            vArrC.push(...L2[k], ...L2[k2], ...cSph);
                        }
                    }
                    // 三角强制法线朝外（远离原点）
                    for (let qi = 0; qi < vArrC.length; qi += 9) {
                        const p0x = vArrC[qi], p0y = vArrC[qi + 1], p0z = vArrC[qi + 2];
                        const p1x = vArrC[qi + 3], p1y = vArrC[qi + 4], p1z = vArrC[qi + 5];
                        const p2x = vArrC[qi + 6], p2y = vArrC[qi + 7], p2z = vArrC[qi + 8];
                        const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z;
                        const vx = p2x - p0x, vy = p2y - p0y, vz = p2z - p0z;
                        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                        const cx = (p0x + p1x + p2x) / 3, cy = (p0y + p1y + p2y) / 3, cz = (p0z + p1z + p2z) / 3;
                        if (nx * cx + ny * cy + nz * cz < 0) {
                            for (let qk = 0; qk < 3; qk++) {
                                const t = vArrC[qi + qk]; vArrC[qi + qk] = vArrC[qi + 3 + qk]; vArrC[qi + 3 + qk] = t;
                            }
                        }
                    }
                    const lgC = new THREE.BufferGeometry();
                    lgC.setAttribute('position', new THREE.Float32BufferAttribute(vArrC, 3));
                    lgC.computeVertexNormals();
                    mesh.add(new THREE.Mesh(lgC, new THREE.MeshStandardMaterial({ color: 0xfffae0, roughness: 0.45 })));
                }
                targetFor = (p) => {
                    let n = null;
                    for (const [key, num] of Object.entries(normToNum)) {
                        if (num === p) { n = key.split(',').map(Number); break; }
                    }
                    if (!n) return [0, 0];
                    const q = new THREE.Quaternion().setFromUnitVectors(
                        new THREE.Vector3(n[0], n[1], n[2]).normalize(),
                        new THREE.Vector3(0, 0, 1)
                    );
                    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
                    return [e.x, e.y, e.z];
                };
            } else {
                // 圆角立方体（六面骰）
                const geo = new THREE.RoundedBoxGeometry(2, 2, 2, 6, 0.4);
                const faceMap = [5, 2, 3, 4, 1, 6];   // 材质顺序 +X,-X,+Y,-Y,+Z,-Z → 点数
                const materials = faceMap.map((n) => new THREE.MeshStandardMaterial({ map: makeFaceTexture(n), roughness: 0.45, metalness: 0 }));
                mesh = new THREE.Mesh(geo, materials);
                targetFor = (p) => ({
                    1: [0, 0], 2: [0, Math.PI / 2], 3: [Math.PI / 2, 0],
                    4: [-Math.PI / 2, 0], 5: [0, -Math.PI / 2], 6: [0, Math.PI]
                }[p] || [0, 0]);
            }
            scene.add(mesh);
            threeDice = { renderer, scene, camera, mesh, type, targetFor };
            threeDice.renderer.render(scene, camera);
        }

        /** 掷骰子动画：Three.js 圆角立方体旋转 2 秒（多圈翻滚）→ 停 1 秒 → 消失。
         *  先定结果（点数），起姿态随机偏移多圈，终姿态 = 目标面朝前（+Z 朝向相机）。 */
        function playDice() {
            const wrap = document.getElementById('dfwDice');
            if (!wrap || !gameState) return;
            // 立即同步关闭目标格（骰子组件异步加载期间也不能显示——否则"没开始转就显示目标格"）
            showTargets = false;
            if (diceTimer) clearTimeout(diceTimer);
            const p = gameState.dicePoint || 1;
            const isRook = (gameState.currentSeat === 0 || gameState.currentSeat === 3);   // ♜ 玩家用八角骰子
            const type = isRook ? 'd8' : 'd6';
            loadThreeScripts().then(() => {
                if (!threeDice || threeDice.type !== type) initThreeDice(type);
                // 容器复位（居中 180，absolute 相对棋盘容器）
                wrap.style.position = 'absolute';
                wrap.style.top = '50%';
                wrap.style.left = '50%';
                wrap.style.right = 'auto';
                wrap.style.bottom = 'auto';
                wrap.style.transform = 'translate(-50%,-50%)';
                threeDice.renderer.setSize(180, 180);
                wrap.style.display = 'flex';
                // 目标姿态（目标面朝前）——必须用完整欧拉（含 z）！只取 x/y 会丢掉 z 分量，
                // 骰子棱朝前、正面显示错误的点数（曾导致"摇出 5 却像 8"）
                const [tX, tY, tZ] = threeDice.targetFor(p);
                const zT = tZ || 0;   // d6 的 targetFor 只返回 [x,y]——z 恒为 0
                const extra = (2 + Math.floor(Math.random() * 2)) * Math.PI;
                const sX = tX + (Math.random() < 0.5 ? -1 : 1) * extra;
                const sY = tY + (Math.random() < 0.5 ? -1 : 1) * extra;
                const sZ = zT + (Math.random() < 0.5 ? -1 : 1) * extra;
                const t0 = performance.now();
                const DUR = 2000;
                if (diceAnim) cancelAnimationFrame(diceAnim);
                if (diceTimer) clearTimeout(diceTimer);
                const step = (now) => {
                    const t = Math.min(1, (now - t0) / DUR);
                    const e = 1 - Math.pow(1 - t, 3);
                    threeDice.mesh.rotation.x = sX + (tX - sX) * e;
                    threeDice.mesh.rotation.y = sY + (tY - sY) * e;
                    threeDice.mesh.rotation.z = sZ + (zT - sZ) * e;
                    threeDice.renderer.render(threeDice.scene, threeDice.camera);
                    if (t < 1) {
                        diceAnim = requestAnimationFrame(step);
                    } else {
                        diceAnim = null;   // 旋转结束标记（playMoveAnimation 排队检查用）
                        // 停止：先保持 180px 展示点数 700ms，再缩小 50% 移到棋盘容器右下角
                        // （absolute 贴容器底）——缩小后保持显示直至行动完毕
                        diceTimer = setTimeout(() => {
                            threeDice.renderer.setSize(90, 90);
                            wrap.style.position = 'absolute';
                            wrap.style.top = 'auto';
                            wrap.style.left = 'auto';
                            wrap.style.right = '16px';
                            wrap.style.bottom = '0px';
                            wrap.style.transform = 'none';
                            threeDice.renderer.render(threeDice.scene, threeDice.camera);
                            showTargets = true;   // 骰子已转完：显示目标格框选（骰子仍停在右下角）
                            if (curFrameSeat != null && gameState && gameState.seats && gameState.seats[curFrameSeat] != null) {
                                startBlink();   // 人类行动：当前格框 500ms 闪烁
                            }
                            drawBoard();
                        }, 700);
                    }
                };
                requestAnimationFrame(step);
            }).catch((err) => {
                if (typeof qiAlert === 'function') qiAlert('骰子组件加载失败：' + err.message);
            });
        }

        /** 点击目标格 → 移动 */
        function onCanvasClick(e) {
            if (!gameState || gameState.phase !== 'playing') return;
            if (gameState.mySeat !== gameState.currentSeat) return;   // 只能自己回合行动
            if (!gameState.reachable || !gameState.reachable.length) return;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const p = screenPointFromClient(e.clientX, e.clientY);
            let bx = p.x, by = p.y;
            if (viewZoom !== 1) {
                bx = (p.x - CANVAS_SIZE / 2) / viewZoom + viewCenterX;
                by = (p.y - CANVAS_SIZE / 2) / viewZoom + viewCenterY;
            }
            const ctx2 = canvas.getContext('2d');
            for (const v of gameState.reachable) {
                if (ctx2.isPointInPath(hexPaths[v], bx, by)) {
                    ws.send(JSON.stringify({ type: 'move', to: v }));
                    return;   // 候选目标格：优先移动，不显示 tooltip
                }
            }
            // 非候选格：点击 mine / 占领地 → 显示/隐藏 tooltip（手机上点击显示，5 秒后消失）
            const cProps = animPropsSnapshot ? animPropsSnapshot.cellProps : (gameState ? gameState.cellProps : null);
            const cMines = animPropsSnapshot ? animPropsSnapshot.mineWealth : (gameState ? gameState.mineWealth : null);
            const cLands = animPropsSnapshot ? animPropsSnapshot.landValue : (gameState ? gameState.landValue : null);
            if (cProps) {
                for (let v = 0; v < V; v++) {
                    if (removed[v] || !hexPaths[v]) continue;
                    const cp = cProps[v];
                    if (!cp) continue;
                    const isMine = cp.type === 'mine' && cMines && cMines[v] > 0;
                    const isLand = /^(redLand|blueLand)[AB]$/.test(cp.type) && cLands && cLands[v] > 0;
                    if (ctx2.isPointInPath(hexPaths[v], bx, by) && (isMine || isLand)) {
                        if (tipCellShow === v) {
                            hideTip();
                        } else {
                            tipCellShow = v;
                            if (cp.type === 'mine') showTip('剩余' + cMines[v] + '财富点', e.clientX, e.clientY);
                            else showTip('占领的土地，每回合获取' + cLands[v] + '财富点', e.clientX, e.clientY);
                            if (tipTimer) clearTimeout(tipTimer);
                            tipTimer = setTimeout(hideTip, 5000);   // 5 秒后消失
                        }
                        return;
                    }
                }
            }
        }

        function renderPlayerId() {
            const el = document.getElementById('dfwPlayerId');
            if (!el) return;
            const val = el.querySelector('span');
            if (!val) return;
            el.style.display = (gameState && gameState.myId) ? '' : 'none';
            val.textContent = (gameState && gameState.myId) ? gameState.myId : '';
        }

// ======================== DOM / 事件 ========================
        const canvas = document.getElementById('goBoard');
        buildUI();

        canvas.addEventListener('wheel', (e) => {
            const z0 = viewZoom;
            const z1 = Math.max(0.5, Math.min(10, z0 * Math.exp(-e.deltaY * 0.002)));
            if (Math.abs(z1 - z0) < 1e-8) return;
            e.preventDefault();
            const ss = screenPointFromClient(e.clientX, e.clientY);
            applyZoomKeepingScreenPoint(ss.x, ss.y, z1);
            drawBoard();
        }, { passive: false });

        function boardUpdateGrabCursor() {
            canvas.style.cursor = 'default';   // 不用手形指针（grab/grabbing）——默认指针
        }

        canvas.addEventListener('click', onCanvasClick);

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || viewZoom <= 1) return;
            boardMousePanning = true;
            boardPanLastScreen = screenPointFromClient(e.clientX, e.clientY);
            boardUpdateGrabCursor();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (boardMousePanning && boardPanLastScreen) {
                const p = screenPointFromClient(e.clientX, e.clientY);
                const dx = p.x - boardPanLastScreen.x;
                const dy = p.y - boardPanLastScreen.y;
                viewCenterX -= dx / viewZoom;
                viewCenterY -= dy / viewZoom;
                boardPanLastScreen = p;
                clampBoardView();
                drawBoard();
                return;
            }
            // 悬停检测：轮到本页玩家行动时，鼠标在候选目标格上 → 预览角色（drawBoard 画半透明棋子）
            const canAct = gameState && gameState.phase === 'playing' &&
                gameState.mySeat != null && gameState.mySeat === gameState.currentSeat &&
                gameState.reachable && gameState.reachable.length;
            const hp = screenPointFromClient(e.clientX, e.clientY);
            let hx = hp.x, hy = hp.y;
            if (viewZoom !== 1) {
                hx = (hp.x - CANVAS_SIZE / 2) / viewZoom + viewCenterX;
                hy = (hp.y - CANVAS_SIZE / 2) / viewZoom + viewCenterY;
            }
            let h = -1;
            if (canAct) {
                const hctx = canvas.getContext('2d');
                for (const v of gameState.reachable) {
                    if (hctx.isPointInPath(hexPaths[v], hx, hy)) { h = v; break; }
                }
            }
            if (h !== hoverCell) { hoverCell = h; drawBoard(); }
            // 悬停 mine / 占领地格（任何时刻都检测——包括动画播放时/未轮到己方时）：
            // tooltip 显示剩余财富 / 占领收入（动画期间用快照属性）
            let tipV = -1;
            const tipProps = animPropsSnapshot ? animPropsSnapshot.cellProps : (gameState ? gameState.cellProps : null);
            const tipMines = animPropsSnapshot ? animPropsSnapshot.mineWealth : (gameState ? gameState.mineWealth : null);
            const tipLands = animPropsSnapshot ? animPropsSnapshot.landValue : (gameState ? gameState.landValue : null);
            if (tipProps) {
                for (let v = 0; v < V; v++) {
                    if (removed[v] || !cellCenters[v]) continue;
                    const tp = tipProps[v];
                    if (!tp) continue;
                    const isMine = tp.type === 'mine' && tipMines && tipMines[v] > 0;
                    const isLand = /^(redLand|blueLand)[AB]$/.test(tp.type) && tipLands && tipLands[v] > 0;
                    if (Math.abs(hx - cellCenters[v].x) < hexR && Math.abs(hy - cellCenters[v].y) < hexR && (isMine || isLand)) { tipV = v; break; }
                }
            }
            if (tipV >= 0) {
                if (tipCellShow !== tipV) {
                    tipCellShow = tipV;
                    const tp = tipProps[tipV];
                    if (tp.type === 'mine') showTip('剩余' + tipMines[tipV] + '财富点', e.clientX, e.clientY);
                    else showTip('占领的土地，每回合获取' + tipLands[tipV] + '财富点', e.clientX, e.clientY);
                }
            } else if (tipCellShow >= 0) hideTip();
        });

        window.addEventListener('mouseup', () => {
            if (!boardMousePanning) return;
            boardMousePanning = false;
            boardPanLastScreen = null;
            boardUpdateGrabCursor();
        });

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 2) {
                pinchGesture = true;
                pinchStartDist = Math.max(1e-6, touchDistanceScreen(e.touches));
                pinchStartZoom = viewZoom;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && viewZoom > 1) {
                touchPanLastScreen = screenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { capture: true, passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (pinchGesture && e.touches.length >= 2) {
                e.preventDefault();
                const d = touchDistanceScreen(e.touches);
                const zNew = Math.max(0.5, Math.min(10, pinchStartZoom * (d / pinchStartDist)));
                const mid = touchMidpointScreen(e.touches);
                applyZoomKeepingScreenPoint(mid.x, mid.y, zNew);
                touchPanLastScreen = null;
                drawBoard();
                return;
            }
            if (!pinchGesture && e.touches.length === 1 && viewZoom > 1 && touchPanLastScreen) {
                const p = screenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
                viewCenterX -= (p.x - touchPanLastScreen.x) / viewZoom;
                viewCenterY -= (p.y - touchPanLastScreen.y) / viewZoom;
                touchPanLastScreen = p;
                clampBoardView();
                drawBoard();
            }
        }, { capture: true, passive: false });

        canvas.addEventListener('touchend', () => {
            pinchGesture = false;
            touchPanLastScreen = null;
        });
        canvas.addEventListener('touchcancel', () => {
            pinchGesture = false;
            touchPanLastScreen = null;
        });

        (function initBoardScrollbars() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            function applyFromSliders() {
                if (viewZoom <= 1) return;
                const z = Math.max(0.5, Math.min(10, viewZoom));
                const half = (CANVAS_SIZE / 2) / z;
                const minX = half, maxX = CANVAS_SIZE - half;
                const minY = half, maxY = CANVAS_SIZE - half;
                const tx = Number(sx.value) / 1000;
                const ty = 1 - Number(sy.value) / 1000;
                viewCenterX = minX + tx * (maxX - minX);
                viewCenterY = minY + ty * (maxY - minY);
                clampBoardView();
                drawBoard();
            }
            sx.addEventListener('input', applyFromSliders);
            sy.addEventListener('input', applyFromSliders);
        })();

        connectWebSocket();
        drawBoard();
        })();
    }
};
