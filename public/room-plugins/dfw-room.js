window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["dfw"] = {
    shell: {
        "title": "DFW",
        "rulesHtml": "测试游戏，没有实际功能。",
        "defaultKomiText": "　",
        "boardSizeMin": 64,
        "boardSizeMax": 64,
        "defaultBoardSize": 64,
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
        /** 保留格填充色：比棋盘背景深一号 */
        const KEPT_FILL = '#e0a858';
        const FRAME_MARGIN = 8;
        /** 六角格中心距（逻辑单位，与服务端生成一致） */
        const HEX_R = 2;

        /** DFW 棋盘路数参数：默认取 shell 配置（后续改 shell.defaultBoardSize 即可调整），服务端广播后以服务端为准 */
        let boardSize = (config.defaultBoardSize != null) ? config.defaultBoardSize : 64;
        let V = 0;
        let cellCenters = [];   // 六角格中心（600 画布逻辑坐标）
        let hexPaths = [];      // 每格六角形 Path2D（600 画布逻辑坐标）
        let keptPaths = [];     // 保留格的路径缓存
        let removed = null;     // Uint8Array 或 null（未就绪=全部保留）

        function applyGeometry(n) {
            const sqrt3 = Math.sqrt(3);
            const radius = n - 2;
            const centers = [];
            for (let q = -radius; q <= radius; q++) {
                for (let r = -radius; r <= radius; r++) {
                    if (Math.abs(q + r) > radius) continue;
                    centers.push({ x: HEX_R * 1.5 * q, y: HEX_R * sqrt3 * (r + q / 2) });
                }
            }
            V = centers.length;
            let cx = 0, cy = 0;
            for (const c of centers) { cx += c.x; cy += c.y; }
            cx /= V;
            cy /= V;
            let maxDist = 0;
            for (const c of centers) {
                const d = Math.hypot(c.x - cx, c.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? (FRAME_CENTER - FRAME_MARGIN) / maxDist : 1;
            cellCenters = centers.map(c => ({
                x: FRAME_CENTER + (c.x - cx) * scale,
                y: FRAME_CENTER + (c.y - cy) * scale
            }));
            const rs = HEX_R * scale;
            // 六角形顶点角 60k°（与六角围棋一致）：外接半径 = HEX_R = 中心距的 2/3（q 方向），
            // 内切半径 0.866R > 半中心距 0.75R → 相邻格重叠密铺（蜂窝），无缝隙
            hexPaths = cellCenters.map(c => {
                const p = new Path2D();
                for (let k = 0; k < 6; k++) {
                    const a = (60 * k) * Math.PI / 180;
                    const x = c.x + rs * Math.cos(a);
                    const y = c.y + rs * Math.sin(a);
                    if (k === 0) p.moveTo(x, y);
                    else p.lineTo(x, y);
                }
                p.closePath();
                return p;
            });
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

        applyGeometry(boardSize);

// ======================== 缩放 / 拖动（参照围棋最大 99 路） ========================
        let viewZoom = 1;
        let viewCenterX = FRAME_CENTER;
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
            z = Math.max(1, Math.min(10, z));
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
            const z = Math.max(1, Math.min(10, viewZoom));
            const half = (CANVAS_SIZE / 2) / z;
            const minX = half, maxX = CANVAS_SIZE - half;
            const minY = half, maxY = CANVAS_SIZE - half;
            const spanX = maxX - minX;
            const spanY = maxY - minY;
            sx.value = spanX > 1e-6 ? String(Math.round((viewCenterX - minX) / spanX * 1000)) : '500';
            sy.value = spanY > 1e-6 ? String(Math.round((maxY - viewCenterY) / spanY * 1000)) : '500';
        }

        function drawBoard() {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            // 正方形外框（六角围棋会隐藏正方形外框改画六角形外框；DFW 恢复正方形外框）
            ctx.fillStyle = BOARD_BG;
            ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(0.5, 0.5, CANVAS_SIZE - 1, CANVAS_SIZE - 1);
            // 棋盘随缩放/拖动变换
            const z = Math.max(1, Math.min(10, viewZoom));
            ctx.save();
            if (z > 1) {
                ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
                ctx.scale(z, z);
                ctx.translate(-viewCenterX, -viewCenterY);
            }
            // 保留格：深色填充；格线用棋盘背景色（被移除的格不涂色，显示棋盘背景色）
            ctx.fillStyle = KEPT_FILL;
            ctx.strokeStyle = BOARD_BG;
            ctx.lineWidth = 1.2 / z;
            for (const p of keptPaths) {
                ctx.fill(p);
                ctx.stroke(p);
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
            drawBoard();
        }

        function handleMessage(msg) {
            if (msg.type === 'joined' && msg.state) {
                // 服务端广播的路数为准（后续调整 DFW_LANES 时客户端自动跟随）
                if (msg.state.boardSize && msg.state.boardSize !== boardSize) {
                    boardSize = msg.state.boardSize;
                    applyGeometry(boardSize);
                }
                applyRemoved(msg.state.removed || null);
            } else if (msg.type === 'boardUpdated') {
                applyRemoved(msg.removed || null);
            } else if (msg.type === 'error') {
                if (typeof qiAlert === 'function') qiAlert(msg.message);
            }
        }

        function connectWebSocket() {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${location.host}/qi/ws?game=${gameType}&room=${roomId}`);
            ws.onopen = () => ws.send(JSON.stringify({ type: 'join', password: roomPassword, requestedSlot: null }));
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

// ======================== DOM / 事件 ========================
        const canvas = document.getElementById('goBoard');

        // DFW 无对局、无棋子、无围棋功能：隐藏相关按钮与面板
        ['newGameBtn', 'estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn',
            'importBtn', 'exportBtn', 'vsComputerBtn', 'buryFinishBtn', 'scoreConfirmPanel',
            'replayPanel', 'boardMarkOuter', 'editControls', 'boardSizeSelect', 'styleSelect', 'subGameSelect'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
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

        canvas.addEventListener('wheel', (e) => {
            const z0 = viewZoom;
            const z1 = Math.max(1, Math.min(10, z0 * Math.exp(-e.deltaY * 0.002)));
            if (Math.abs(z1 - z0) < 1e-8) return;
            e.preventDefault();
            const ss = screenPointFromClient(e.clientX, e.clientY);
            applyZoomKeepingScreenPoint(ss.x, ss.y, z1);
            drawBoard();
        }, { passive: false });

        function boardUpdateGrabCursor() {
            if (boardMousePanning) canvas.style.cursor = 'grabbing';
            else canvas.style.cursor = viewZoom > 1 ? 'grab' : 'default';
        }

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || viewZoom <= 1) return;
            boardMousePanning = true;
            boardPanLastScreen = screenPointFromClient(e.clientX, e.clientY);
            boardUpdateGrabCursor();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!boardMousePanning || !boardPanLastScreen) return;
            const p = screenPointFromClient(e.clientX, e.clientY);
            const dx = p.x - boardPanLastScreen.x;
            const dy = p.y - boardPanLastScreen.y;
            viewCenterX -= dx / viewZoom;
            viewCenterY -= dy / viewZoom;
            boardPanLastScreen = p;
            clampBoardView();
            drawBoard();
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
                const zNew = Math.max(1, Math.min(10, pinchStartZoom * (d / pinchStartDist)));
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
                const z = Math.max(1, Math.min(10, viewZoom));
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

        document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
        document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
        document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };

        connectWebSocket();
        drawBoard();
        })();
    }
};
