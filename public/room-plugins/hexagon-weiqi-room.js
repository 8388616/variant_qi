window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["hexagon-weiqi"] = {
    shell: {
        "title": "六角围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />采用六角棋盘。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 4,
        "boardSizeMax": 11,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "六角围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "transparentCanvas": true
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
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "六角围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
// ======================== 棋盘生成（与后端一致：路数 n，交点数 6(n−1)²） ========================
        const CANVAS_SIZE = 600;
        const FRAME_CENTER = CANVAS_SIZE / 2;
        /** 木质外框正六边形顶点圆（与外接圆同心），与路数无关，保持视觉大小不变 */
        const OUTER_HEX_RADIUS = 280;
        /** 外框圆角半径（px），固定，不随 cellSize 变化 */
        const FRAME_CORNER_RADIUS = 12;

        /** 桌面端：左缘固定，展开向右；距画布右缘 56px（原 6px 再向左 50px）、距底 6px */
        function updateBoardMarkOuterPosition() {
            const el = document.getElementById('boardMarkOuter');
            if (!el) return;
            if (window.matchMedia('(max-width: 700px)').matches) {
                el.style.left = '';
                el.style.top = '';
                el.style.bottom = '';
                el.style.right = '';
                el.style.marginLeft = '';
                return;
            }
            const gapBottom = 6;
            const gapFromCanvasRight = 56;
            const collapsedTabW = 36;
            el.style.left = `calc(100% - 140px)`;
            el.style.right = 'auto';
            el.style.top = 'auto';
            el.style.bottom = `${gapBottom + 36}px`;
            el.style.marginLeft = '0';
        }

        let BOARD_SIZE = 9;
        let V;
        let transformed;
        let neighbors;
        let hexagons;
        let clickThreshold;
        let cellSize;
        let centerX;
        let centerY;

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
                    if (a !== b) {
                        neighborSets[a].add(b);
                        neighborSets[b].add(a);
                    }
                }
            }
            const neighborList = neighborSets.map(set => Array.from(set));

            const PADDING = 72 - 4 * n;
            const R_inner = OUTER_HEX_RADIUS - PADDING;

            let cx = 0, cy = 0;
            for (const v of vertices) {
                cx += v.x;
                cy += v.y;
            }
            cx /= vc;
            cy /= vc;
            let maxDist = 0;
            for (const v of vertices) {
                const d = Math.hypot(v.x - cx, v.y - cy);
                if (d > maxDist) maxDist = d;
            }
            const scale = maxDist > 0 ? R_inner / maxDist : 1;

            const transformedPts = vertices.map(v => ({
                x: FRAME_CENTER + (v.x - cx) * scale,
                y: FRAME_CENTER + (v.y - cy) * scale
            }));

            let totalDist = 0;
            let edgeCount = 0;
            for (const hex of hexList) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i];
                    const b = hex[(i + 1) % 6];
                    const ddx = transformedPts[a].x - transformedPts[b].x;
                    const ddy = transformedPts[a].y - transformedPts[b].y;
                    totalDist += Math.sqrt(ddx * ddx + ddy * ddy);
                    edgeCount++;
                }
            }
            const cs = totalDist / edgeCount;
            const ct = cs * 0.4;

            return {
                vertexCount: vc,
                transformed: transformedPts,
                neighborList,
                hexagons: hexList,
                clickThreshold: ct,
                cellSize: cs,
                centerX: FRAME_CENTER,
                centerY: FRAME_CENTER
            };
        }

        function applyHexGeometry(data) {
            V = data.vertexCount;
            transformed = data.transformed;
            neighbors = data.neighborList;
            hexagons = data.hexagons;
            clickThreshold = data.clickThreshold;
            cellSize = data.cellSize;
            centerX = data.centerX;
            centerY = data.centerY;
        }

        applyHexGeometry(generateHexBoard(BOARD_SIZE));

// ======================== 房间参数 ========================

// ======================== 游戏状态 ========================
        let board = Array(V).fill(0);
        let numberOfHands = 1;
        let currentPlayer = 1;
        let mySlot = null;               // 'black' or 'white'
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
        let slots = { black: false, white: false };
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

        /** 本地标记：键为顶点索引字符串 "0".."V-1" */
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
            return !isMouseDevice && BOARD_SIZE > 9;
        }
        function clearMobileMovePreview() {
            hoverVertex = -1;
            isHoverValid = false;
        }

        // ======================== 工具函数 ========================
        const KOMI = 3.25;

        function formatScore(num) {
            let str = num.toFixed(2);
            return str.replace(/\.?0+$/, '');
        }

        function isUserBoardMarkVisibleAtVertex(v) {
            if (showEstimateActive) return false;
            if (v < 0 || v >= V) return false;
            if (board[v] !== 0) return false;
            return true;
        }

        function deepCopyBoard(src) { return src.slice(); }

        // 气计算
        function hasLiberty(boardState, start, visited = null) {
            const color = boardState[start];
            if (color === 0) return false;
            const queue = [start];
            const visitedLocal = visited || new Array(V).fill(false);
            visitedLocal[start] = true;
            let idx = 0;
            while (idx < queue.length) {
                const v = queue[idx++];
                for (let nb of neighbors[v]) {
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
                for (let nb of neighbors[v]) {
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
            for (let v = 0; v < V; v++) {
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
            for (let nb of neighbors[libertyVertex]) {
                if (boardState[nb] === opponentColor) return true;
            }
            return false;
        }

        function removeDeadAndDying(srcBoard) {
            let newBoard = deepCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                let visited = new Array(V).fill(false);
                for (let v = 0; v < V; v++) {
                    if (newBoard[v] !== 0 && !visited[v]) {
                        let color = newBoard[v];
                        let queue = [v];
                        visited[v] = true;
                        let stones = [v];
                        let liberties = new Set();
                        let idx = 0;
                        while (idx < queue.length) {
                            let cur = queue[idx++];
                            for (let nb of neighbors[cur]) {
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

        function multiSourceBFS(liveBoard, color) {
            let dist = new Array(V).fill(Infinity);
            let queue = [];
            for (let v = 0; v < V; v++) {
                if (liveBoard[v] === color) {
                    dist[v] = 0;
                    queue.push(v);
                }
            }
            let head = 0;
            while (head < queue.length) {
                let cur = queue[head++];
                for (let nb of neighbors[cur]) {
                    if (dist[nb] > dist[cur] + 1) {
                        dist[nb] = dist[cur] + 1;
                        queue.push(nb);
                    }
                }
            }
            return dist;
        }

        function assignTerritory(liveBoard) {
            let territory = new Array(V).fill(0);
            let blackCount = 0, whiteCount = 0;
            for (let v = 0; v < V; v++) {
                if (liveBoard[v] === 1) blackCount++;
                else if (liveBoard[v] === 2) whiteCount++;
            }
            if (blackCount === 0 && whiteCount === 0) return territory;
            if (blackCount === 0) {
                for (let v = 0; v < V; v++) if (liveBoard[v] === 0) territory[v] = 2;
                return territory;
            }
            if (whiteCount === 0) {
                for (let v = 0; v < V; v++) if (liveBoard[v] === 0) territory[v] = 1;
                return territory;
            }
            let distBlack = multiSourceBFS(liveBoard, 1);
            let distWhite = multiSourceBFS(liveBoard, 2);
            for (let v = 0; v < V; v++) {
                if (liveBoard[v] !== 0) continue;
                if (distBlack[v] < distWhite[v]) territory[v] = 1;
                else if (distWhite[v] < distBlack[v]) territory[v] = 2;
                else territory[v] = 3;
            }
            return territory;
        }

        function computeScore(liveBoard, territory) {
            let blackStones = 0, whiteStones = 0;
            let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let v = 0; v < V; v++) {
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

        function computeScoreFromBoard(srcBoard) {
            let liveBoard = removeDeadAndDying(srcBoard);
            let territory = assignTerritory(liveBoard);
            return computeScore(liveBoard, territory);
        }

        function computeLead() {
            let { blackTotal, whiteTotal } = computeScoreFromBoard(board);
            return blackTotal - whiteTotal - 2 * KOMI;
        }

        function computeStoneNumbers() {
            const nums = new Array(V).fill(0);
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
            const markSize = cellSize * 0.2;
            for (let v = 0; v < V; v++) {
                if (board[v] !== 0 && liveBoard[v] === 0) {
                    let { x, y } = transformed[v];
                    ctx.fillStyle = board[v] === 1 ? '#ffffff' : '#222222';
                    ctx.fillRect(x - markSize, y - markSize, markSize * 2, markSize * 2);
                }
            }
            for (let v = 0; v < V; v++) {
                if (board[v] !== 0) continue;
                let owner = territory[v];
                if (owner === 0 || owner === 3) continue;
                ctx.fillStyle = owner === 1 ? '#222' : '#f0f0f0';
                let { x, y } = transformed[v];
                ctx.fillRect(x - markSize, y - markSize, markSize * 2, markSize * 2);
            }
        }

        function drawBoard() {
            ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            const angles = [0, 60, 120, 180, 240, 300].map(deg => deg * Math.PI / 180);
            const outerVerts = angles.map(angle => ({
                x: FRAME_CENTER + OUTER_HEX_RADIUS * Math.cos(angle),
                y: FRAME_CENTER + OUTER_HEX_RADIUS * Math.sin(angle)
            }));
            // 木质外框与 weiqi 统一：无阴影、背景 #fdcc90、边线 #3a281c 0.5px
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = '#fdcc90';
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = 0.5;
            drawRoundedHexagon(ctx, outerVerts, FRAME_CORNER_RADIUS, false);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#3a281c';
            ctx.lineJoin = 'miter';
            for (let hex of hexagons) {
                for (let i = 0; i < 6; i++) {
                    const a = hex[i];
                    const b = hex[(i + 1) % 6];
                    ctx.beginPath();
                    ctx.moveTo(transformed[a].x, transformed[a].y);
                    ctx.lineTo(transformed[b].x, transformed[b].y);
                    ctx.stroke();
                }
            }

            const markSize = cellSize * 0.3;
            const stoneRadius = cellSize * 0.44;
            const lowerLastMoveMarker = showMoveNumbers || showEstimateActive;
            if (lowerLastMoveMarker) {
                for (let { vertex, color } of lastMoveMarkers) {
                    if (vertex === undefined) continue;
                    const { x, y } = transformed[vertex];
                    ctx.beginPath();
                    ctx.moveTo(x + stoneRadius, y + stoneRadius);
                    ctx.lineTo(x, y + stoneRadius);
                    ctx.lineTo(x + stoneRadius, y);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.fill();
                }
            }

            for (let v = 0; v < V; v++) {
                if (board[v] === 0) continue;
                const radius = stoneRadius;
                const { x, y } = transformed[v];
                ctx.shadowBlur = 6;
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowOffsetY = 2;
                const gradient = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
                if (board[v] === 1) {
                    gradient.addColorStop(0, '#444');
                    gradient.addColorStop(0.6, '#222');
                    gradient.addColorStop(1, '#111');
                } else {
                    gradient.addColorStop(0, '#fff');
                    gradient.addColorStop(0.5, '#eee');
                    gradient.addColorStop(1, '#aaa');
                }
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = gradient;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                if (!showMoveNumbers) {
                    ctx.beginPath();
                    ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                    ctx.fillStyle = board[v] === 1 ? '#444' : '#fff';
                    ctx.fill();
                }
            }
            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let v = 0; v < V; v++) {
                    if (nums[v] > 0 && board[v] !== 0) {
                        const { x, y } = transformed[v];
                        const numStr = nums[v].toString();
                        const fontSize = Math.max(8, Math.floor(cellSize * (numStr.length >= 3 ? 0.28 : 0.36)));
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.fillStyle = board[v] === 1 ? '#fff' : '#000';
                        ctx.fillText(numStr, x, y + 1);
                    }
                }
            }
            if (!lowerLastMoveMarker) {
                for (let { vertex, color } of lastMoveMarkers) {
                    if (vertex === undefined) continue;
                    const { x, y } = transformed[vertex];
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
                const { x, y } = transformed[v];
                const markBgR = cellSize * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
                ctx.fill();
                const fontPx = cellSize * (ch === '🚩' ? 0.6 : 0.66);
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
                else hoverColor = mySlot === 'black' ? '#222' : '#fff';
                if (hoverColor) {
                    const { x, y } = transformed[hoverVertex];
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(x, y, cellSize * 0.42, 0, 2 * Math.PI);
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
            cachedLiveBoard = removeDeadAndDying(board);
            cachedTerritory = assignTerritory(cachedLiveBoard);
            let { blackTotal, whiteTotal } = computeScore(cachedLiveBoard, cachedTerritory);
            let lead = blackTotal - whiteTotal - 2 * KOMI;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${formatScore(blackTotal)} | 白: ${formatScore(whiteTotal)}`;
            leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${formatScore(lead)}点`;
            drawBoardWithOverlay();
        }

        function clearEstimate()
        {
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
                if (winner === 'black') scoreTitle.innerText = '黑胜';
                else if (winner === 'white') scoreTitle.innerText = '白胜';
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
            const bothSelected = !!(slots && slots.black && slots.white);
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
                    const lastPl = moveCoordsFull[n - 1].player === 'black' ? 1 : 2;
                    turnDisplay.innerText = `${lastPl === 1 ? '⚫' : '⚪'} 第${n}手`;
                }
            } else if (total === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const p = liveReplayStepPlayers[total];
                turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            isMyTurn = !!(matchStarted && (mySlot !== null)
                && ((mySlot === 'black' && currentPlayer === 1) || (mySlot === 'white' && currentPlayer === 2)));
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
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix);
        }

        function enterReplayMode(data) {
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [0];

            let curBoard = Array(V).fill(0);
            if (data.initialPosition) {
                if (Array.isArray(data.initialPosition)) {
                    for (const s of data.initialPosition) {
                        if (typeof s !== 'string' || s.length < 2) continue;
                        const p = s[0];
                        if (p !== 'B' && p !== 'W') continue;
                        const vi = parseInt(s.slice(1), 10);
                        if (!Number.isInteger(vi) || vi < 0 || vi >= V) continue;
                        curBoard[vi] = p === 'B' ? 1 : 2;
                    }
                } else if (Array.isArray(data.initialPosition.black)) {
                    for (const pos of data.initialPosition.black) {
                        const vi = typeof pos === 'number' ? pos : pos[0];
                        if (vi >= 0 && vi < V) curBoard[vi] = 1;
                    }
                }
                if (Array.isArray(data.initialPosition.white)) {
                    for (const pos of data.initialPosition.white) {
                        const vi = typeof pos === 'number' ? pos : pos[0];
                        if (vi >= 0 && vi < V) curBoard[vi] = 2;
                    }
                }
            }
            replayBoards.push(deepCopyBoard(curBoard));
            replayMarkers.push([]);

            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
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
            let curBoard = (openingBoard && openingBoard.length === V) ? deepCopyBoard(openingBoard) : Array(V).fill(0);
            liveReplayBoards.push(deepCopyBoard(curBoard));
            liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
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

                const playerVal = move.player === 'black' ? 1 : 2;
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
            const mcs = state.moveCoords || [];
            const syncedLen = liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncremental(mcs)) return;
            }
            rebuildLiveReplayFromMoveCoords(mcs, state.initialBoard);
        }

        function applyLiveViewBoard() {
            if (!liveReplayBoards.length) {
                board = Array(V).fill(0);
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
                    } else if (typeof ps !== 'undefined' && ps && ps.reconnectTimer) {
                        clearTimeout(ps.reconnectTimer);
                        ps.reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => (typeof reconnectTimer !== 'undefined' ? reconnectTimer : (ps && ps.reconnectTimer)),
                setReconnectTimer: (id) => {
                    if (typeof reconnectTimer !== 'undefined') reconnectTimer = id;
                    else if (ps) ps.reconnectTimer = id;
                }
            });
        }



        function syncState(state)
        {
            clearMobileMovePreview();
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const sizeNum = Number(BOARD_SIZE);
            const needGeometry =
                Number.isFinite(incomingSize) &&
                (incomingSize !== sizeNum || (state.board && state.board.length !== V));
            if (needGeometry) {
                BOARD_SIZE = incomingSize;
                applyHexGeometry(generateHexBoard(BOARD_SIZE));
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (sizeSelect) sizeSelect.value = String(BOARD_SIZE);
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
                moveCoordsFull = state.moveCoords || [];
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
                board = state.board;
                lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = board.some(v => v !== 0);
            const hasPlayer = slots.black || slots.white;
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
            return Array(V).fill(0);
        }
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
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
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => BOARD_SIZE,
            setBoardSize: (n) => {
                BOARD_SIZE = n;
                applyHexGeometry(generateHexBoard(BOARD_SIZE));
            },
            getKomi: () => KOMI,
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
                if (Number.isFinite(bs) && bs !== Number(BOARD_SIZE)) {
                    BOARD_SIZE = bs;
                    applyHexGeometry(generateHexBoard(BOARD_SIZE));
                    board = Array(V).fill(0);
                }
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = String(msg.boardSize);
                drawBoardWithOverlay();
            },
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            seatOverlayShape: 'hexagon'
        });
        handleMessage = _weiqiBindings.handleMessage;
        updateRecordButtons = _weiqiBindings.updateRecordButtons;
        updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMove(vertex) {
            if (gameOver) return false;
            if (!isMyTurn) return false;
            if (board[vertex] !== 0) return false;
            ws.send(JSON.stringify({ type: 'move', vertex }));
            return true;
        }

        /** 木质外框六边形顶点（与 drawBoard 中 outerVerts 一致），用于棋盘内点击判定 */
        function outerFrameVerts() {
            return [0, 60, 120, 180, 240, 300].map(deg => {
                const a = deg * Math.PI / 180;
                return {
                    x: FRAME_CENTER + OUTER_HEX_RADIUS * Math.cos(a),
                    y: FRAME_CENTER + OUTER_HEX_RADIUS * Math.sin(a)
                };
            });
        }

        /** 点在多边形内判定（ray casting，顶点按 {x,y} 数组） */
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

        function getNearestVertex(x, y) {
            // 点在六边形棋盘之外时无效：避免正方形画布内的外部点击吸附到邻近顶点
            if (!pointInPolygon(x, y, outerFrameVerts())) return -1;
            let minDist = Infinity, best = -1;
            for (let v = 0; v < V; v++) {
                const { x: vx, y: vy } = transformed[v];
                const dx = vx - x, dy = vy - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
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

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const val = boardMarkSelect.value;
            if (val === '') return { clear: true, ch: '' };
            return { clear: false, ch: val };
        }

        function applyUserBoardMark(vertex) {
            if (vertex < 0 || vertex >= V) return;
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
                const canHover = tryPlayMode || (!gameOver && isMyTurn);
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
                isHoverValid = (v !== -1 && board[v] === 0);
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
                emptyBoard() { return Array((typeof V !== 'undefined' ? V : board.length)).fill(0); }
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

        connectWebSocket();
        })();
    }
};
