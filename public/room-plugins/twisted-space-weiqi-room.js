window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["twisted-space-weiqi"] = {
    shell: {
        "title": "扭曲空间围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />采用三角棋盘，棋子落在格内。<br /><br />每个点被分配了一个编号。相同编号的格子是相邻的。<br />",
        "defaultKomiText": "黑贴白4.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "扭曲空间围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "扭曲空间围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
let ROWS = 9; // 扭曲空间路数（比三角围棋少一路）
        const KOMI = 4.75;
        const BASE_WIDTH = 500;
        const CENTER_X_REF = 300;
        const TRI_REF_ROWS = 27; // 对应三角围棋路数
        let GRID_ROWS = ROWS + 1; // 三角网点行数

        function gridCornersFromParams(rows, dx, dy, topY, centerX) {
            const rMax = rows - 1;
            const A = { x: centerX, y: topY };
            const leftX = centerX - (rMax * dx) / 2;
            const B = { x: leftX, y: topY + rMax * dy };
            const C = { x: leftX + rMax * dx, y: topY + rMax * dy };
            return { A, B, C };
        }
        function outwardExpandTriangle(A, B, C, margin) {
            const cx = (A.x + B.x + C.x) / 3;
            const cy = (A.y + B.y + C.y) / 3;
            const expand = (P) => {
                const vx = P.x - cx, vy = P.y - cy;
                const len = Math.hypot(vx, vy);
                return { x: P.x + (vx / len) * margin, y: P.y + (vy / len) * margin };
            };
            return { outerA: expand(A), outerB: expand(B), outerC: expand(C) };
        }

        const dxRef = BASE_WIDTH / (TRI_REF_ROWS - 1);
        const dyRef = (Math.sqrt(3) / 2) * dxRef;
        const topYRef = (600 - dyRef * (TRI_REF_ROWS - 1)) / 2;
        const refCorner = gridCornersFromParams(TRI_REF_ROWS, dxRef, dyRef, topYRef, CENTER_X_REF);
        const outer = outwardExpandTriangle(refCorner.A, refCorner.B, refCorner.C, 45);
        const FIXED_OUTER_A = outer.outerA, FIXED_OUTER_B = outer.outerB, FIXED_OUTER_C = outer.outerC;
        const TRI_CENTROID = {
            x: (FIXED_OUTER_A.x + FIXED_OUTER_B.x + FIXED_OUTER_C.x) / 3,
            y: (FIXED_OUTER_A.y + FIXED_OUTER_B.y + FIXED_OUTER_C.y) / 3
        };
        const k27 = Math.hypot(refCorner.A.x - TRI_CENTROID.x, refCorner.A.y - TRI_CENTROID.y)
            / Math.hypot(FIXED_OUTER_A.x - TRI_CENTROID.x, FIXED_OUTER_A.y - TRI_CENTROID.y);

        let DX, DY, TOP_Y, CENTER_X, PADDING;
        function updateBoardGeometry() {
            GRID_ROWS = ROWS + 1;
            PADDING = 50 - 0.3 * GRID_ROWS;
            let factor = k27 * (45 / PADDING);
            if (factor > 1) factor = 1;
            const innerFromOuter = (O) => ({
                x: TRI_CENTROID.x + factor * (O.x - TRI_CENTROID.x),
                y: TRI_CENTROID.y + factor * (O.y - TRI_CENTROID.y)
            });
            const innerA = innerFromOuter(FIXED_OUTER_A);
            const innerB = innerFromOuter(FIXED_OUTER_B);
            const innerC = innerFromOuter(FIXED_OUTER_C);
            DX = (innerC.x - innerB.x) / (GRID_ROWS - 1);
            DY = (innerB.y - innerA.y) / (GRID_ROWS - 1);
            TOP_Y = innerA.y;
            CENTER_X = innerA.x;
        }
        updateBoardGeometry();

        function triPointToPixel(r, c) {
            const y = TOP_Y + r * DY;
            const leftX = CENTER_X - (r * DX) / 2;
            return { x: leftX + c * DX, y };
        }
        function triCellCenter(r, c) {
            if ((c & 1) === 0) {
                const k = c / 2;
                const p1 = triPointToPixel(r, k);
                const p2 = triPointToPixel(r + 1, k);
                const p3 = triPointToPixel(r + 1, k + 1);
                return { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };
            }
            const k = (c - 1) / 2;
            const p1 = triPointToPixel(r, k);
            const p2 = triPointToPixel(r, k + 1);
            const p3 = triPointToPixel(r + 1, k + 1);
            return { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };
        }

        function initBoardArray(rows) {
            return Array(rows).fill().map((_, r) => Array(2 * r + 1).fill(0));
        }
        function isValidCoord(r, c) {
            return r >= 0 && r < ROWS && c >= 0 && c <= 2 * r;
        }
        let cellNumbers = null;
        let pairedLinks = null;
        function buildPairLinksFromNumbers(nums) {
            if (!Array.isArray(nums) || nums.length !== ROWS) return null;
            const links = Array(ROWS).fill().map((_, r) => Array(2 * r + 1).fill().map(() => []));
            const buckets = new Map();
            for (let r = 0; r < ROWS; r++) {
                if (!Array.isArray(nums[r]) || nums[r].length !== 2 * r + 1) return null;
                for (let c = 0; c <= 2 * r; c++) {
                    const v = nums[r][c];
                    if (!Number.isInteger(v) || v <= 0) return null;
                    if (!buckets.has(v)) buckets.set(v, []);
                    buckets.get(v).push([r, c]);
                }
            }
            for (const arr of buckets.values()) {
                if (arr.length < 2) continue;
                for (let i = 0; i < arr.length; i++) {
                    for (let j = i + 1; j < arr.length; j++) {
                        const [r1, c1] = arr[i];
                        const [r2, c2] = arr[j];
                        links[r1][c1].push([r2, c2]);
                        links[r2][c2].push([r1, c1]);
                    }
                }
            }
            return links;
        }
        function setCellNumbers(nums) {
            const built = buildPairLinksFromNumbers(nums);
            if (!built) {
                cellNumbers = null;
                pairedLinks = null;
                return;
            }
            cellNumbers = nums.map(row => row.slice());
            pairedLinks = built;
        }
        function neighbors(r, c) {
            const out = [];
            const seen = new Set();
            const add = (nr, nc) => {
                const k = `${nr},${nc}`;
                if (isValidCoord(nr, nc) && !seen.has(k)) {
                    seen.add(k);
                    out.push([nr, nc]);
                }
            };
            add(r, c - 1);
            add(r, c + 1);
            if ((c & 1) === 0) {
                add(r + 1, c + 1);
            } else {
                add(r - 1, c - 1);
            }
            if (pairedLinks && pairedLinks[r] && pairedLinks[r][c]) {
                for (const [nr, nc] of pairedLinks[r][c]) add(nr, nc);
            }
            return out;
        }

        function deepCopyBoard(src) { return src.map(row => row.slice()); }
        function countGroupLiberties(b, row, col) {
            const color = b[row][col];
            if (color === 0) return 0;
            const q = [[row, col]];
            const vis = new Set([`${row},${col}`]);
            const libs = new Set();
            while (q.length) {
                const [r, c] = q.shift();
                for (const [nr, nc] of neighbors(r, c)) {
                    if (b[nr][nc] === 0) libs.add(`${nr},${nc}`);
                    else if (b[nr][nc] === color) {
                        const k = `${nr},${nc}`;
                        if (!vis.has(k)) { vis.add(k); q.push([nr, nc]); }
                    }
                }
            }
            return libs.size;
        }
        function removeGroup(b, row, col, color) {
            const q = [[row, col]];
            b[row][col] = 0;
            while (q.length) {
                const [r, c] = q.shift();
                for (const [nr, nc] of neighbors(r, c)) {
                    if (b[nr][nc] === color) { b[nr][nc] = 0; q.push([nr, nc]); }
                }
            }
        }
        function tryPlaceStone(boardBefore, row, col, playerVal) {
            if (!isValidCoord(row, col) || boardBefore[row][col] !== 0) return null;
            const b = deepCopyBoard(boardBefore);
            b[row][col] = playerVal;
            for (const [nr, nc] of neighbors(row, col)) {
                if (b[nr][nc] === 3 - playerVal && countGroupLiberties(b, nr, nc) < 1) {
                    removeGroup(b, nr, nc, 3 - playerVal);
                }
            }
            if (countGroupLiberties(b, row, col) < 1) removeGroup(b, row, col, playerVal);
            return b;
        }

        let board = initBoardArray(ROWS), numberOfHands = 1, currentPlayer = 1;
        let mySlot = null, gameOver = false, winner = null, lastMoveMarkers = [];
        let showEstimateActive = false, cachedLiveBoard = null, cachedTerritory = null;
        let waitingScoreConfirm = false, iRejected = false, matchTime = null, matchStarted = false;
        let ws, isMyTurn = false, slots = { black: false, white: false }, reconnectTimer = null;
        let replayMode = false, replayBoards = [], replayMarkers = [], replayStepPlayers = [], replayStep = 0, replayTotalSteps = 0;
        let showMoveNumbers = false, moveLog = [];
        let tryPlayMode = false, tryPlayFromLive = false, tryPlayFromLiveStep = null;
        let tryPlayBaseStep = 0, tryPlayBoards = [], tryPlayMarkers = [], tryPlayCurrentPlayer = 1, tryPlayStep = 0, tryPlayTotalSteps = 0;
        let liveReplayBoards = [], liveReplayMarkers = [], liveReplayStepPlayers = [], liveViewStep = 0, liveFollowLatest = true;
        let updateRecordButtons = () => {};
        let updateRadioStyles = () => {};
        let handleMessage = () => {};
        let userBoardMarks = Object.create(null);
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) {
            QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks);
        }

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
        const sizeSelect = document.getElementById('boardSizeSelect');
        const boardMarkSelect = document.getElementById('boardMarkSelect');
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        let hoverR = -1, hoverC = -1, isHoverValid = false;

if (sizeSelect) {
            sizeSelect.addEventListener('change', () => {
                const n = parseInt(sizeSelect.value, 10);
                if (Number.isInteger(n) && ws) {
                    ws.send(JSON.stringify({ type: 'setBoardSize', size: n }));
                }
            });
        }

        function removeDeadGroups(src) {
            let b = deepCopyBoard(src), changed = true;
            while (changed) {
                changed = false;
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c <= 2 * r; c++) {
                        if (b[r][c] !== 0 && countGroupLiberties(b, r, c) === 0) {
                            removeGroup(b, r, c, b[r][c]);
                            changed = true;
                        }
                    }
                }
            }
            return b;
        }
        function shortestToColor(liveBoard, sr, sc, targetColor) {
            const q = [[sr, sc]];
            const vis = new Set([`${sr},${sc}`]);
            let head = 0;
            while (head < q.length) {
                const [r, c, d = 0] = q[head++];
                if (liveBoard[r][c] === targetColor) return d;
                for (const [nr, nc] of neighbors(r, c)) {
                    const k = `${nr},${nc}`;
                    if (!vis.has(k)) { vis.add(k); q.push([nr, nc, d + 1]); }
                }
            }
            return Infinity;
        }
        function assignTerritory(liveBoard) {
            const territory = initBoardArray(ROWS);
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c <= 2 * r; c++) {
                    if (liveBoard[r][c] !== 0) continue;
                    const b = shortestToColor(liveBoard, r, c, 1);
                    const w = shortestToColor(liveBoard, r, c, 2);
                    territory[r][c] = b < w ? 1 : (w < b ? 2 : 3);
                }
            }
            return territory;
        }
        function computeScore(liveBoard, territory) {
            let bs = 0, ws = 0, bt = 0, wt = 0, pt = 0;
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c <= 2 * r; c++) {
                    const v = liveBoard[r][c];
                    if (v === 1) bs++;
                    else if (v === 2) ws++;
                    else if (territory[r][c] === 1) bt++;
                    else if (territory[r][c] === 2) wt++;
                    else if (territory[r][c] === 3) pt++;
                }
            }
            return { blackTotal: bs + bt + pt / 2, whiteTotal: ws + wt + pt / 2 };
        }
        function updateEstimateData() {
            cachedLiveBoard = removeDeadGroups(board);
            cachedTerritory = assignTerritory(cachedLiveBoard);
            const s = computeScore(cachedLiveBoard, cachedTerritory);
            const lead = s.blackTotal - s.whiteTotal - 2 * KOMI;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${s.blackTotal.toFixed(0)}　白: ${s.whiteTotal.toFixed(0)}`;
            leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${lead.toFixed(1)}点`;
        }

        function getClosestCell(px, py) {
            let best = { row: -1, col: -1, dist: Infinity };
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c <= 2 * r; c++) {
                    const p = triCellCenter(r, c);
                    const d = Math.hypot(px - p.x, py - p.y);
                    if (d < best.dist) best = { row: r, col: c, dist: d };
                }
            }
            return { row: best.row, col: best.col };
        }

        function computeStoneNumbers() {
            const nums = initBoardArray(ROWS);
            if (replayMode && tryPlayMode) {
                for (let i = 1; i <= tryPlayStep; i++) {
                    const m = tryPlayMarkers[i] && tryPlayMarkers[i][0];
                    if (m && board[m.row][m.col] !== 0) nums[m.row][m.col] = i;
                }
            } else if (replayMode) {
                for (let i = 1; i <= replayStep; i++) {
                    const m = replayMarkers[i] && replayMarkers[i][0];
                    if (m && board[m.row][m.col] !== 0) nums[m.row][m.col] = i;
                }
            } else {
                for (let i = 0; i < moveLog.length; i++) {
                    const m = moveLog[i];
                    if (m && board[m.row][m.col] !== 0) nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function rightEdgeLabel(r) {
            let n = r + 1;
            let s = '';
            while (n > 0) {
                const rem = (n - 1) % 26;
                s = String.fromCharCode(65 + rem) + s;
                n = Math.floor((n - 1) / 26);
            }
            return s;
        }

        function rebuildLiveReplayFromMoveCoords(moveCoords, openingBoard) {
            liveReplayBoards = [];
            liveReplayMarkers = [];
            liveReplayStepPlayers = [0];
            let cur = openingBoard ? deepCopyBoard(openingBoard) : initBoardArray(ROWS);
            liveReplayBoards.push(deepCopyBoard(cur));
            liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const p = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(p);
                if (move.type === 'move') {
                    const nb = tryPlaceStone(cur, move.row, move.col, p);
                    if (nb) cur = nb;
                    liveReplayBoards.push(deepCopyBoard(cur));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: p }]);
                } else {
                    liveReplayBoards.push(deepCopyBoard(cur));
                    liveReplayMarkers.push([]);
                }
            }
        }
        function applyLiveViewBoard() {
            if (!liveReplayBoards.length) {
                board = initBoardArray(ROWS);
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

        function drawBoard() {
            ctx.clearRect(0, 0, 600, 600);
            ctx.save();
            ctx.shadowBlur = 20;
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowOffsetY = 8;
            ctx.fillStyle = '#edbc80';
            ctx.strokeStyle = '#6b4a2e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(FIXED_OUTER_A.x, FIXED_OUTER_A.y);
            ctx.lineTo(FIXED_OUTER_B.x, FIXED_OUTER_B.y);
            ctx.lineTo(FIXED_OUTER_C.x, FIXED_OUTER_C.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            ctx.lineWidth = 1.1;
            ctx.strokeStyle = '#3a281c';
            for (let r = 0; r < GRID_ROWS; r++) {
                const s = triPointToPixel(r, 0), e = triPointToPixel(r, r);
                ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            }
            for (let c = 0; c < GRID_ROWS; c++) {
                const s = triPointToPixel(c, c), e = triPointToPixel(GRID_ROWS - 1, c);
                ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            }
            for (let s = 0; s < GRID_ROWS; s++) {
                const p1 = triPointToPixel(s, 0), p2 = triPointToPixel(GRID_ROWS - 1, GRID_ROWS - 1 - s);
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            }

            // 坐标：放在左右斜边外侧，并与“横格中线”（r + 0.5）对齐
            const coordYOffset = 0;
            const coordPadX = 12.4 - 0.2 * ROWS;
            const coordFontPx = Math.max(4, 0.24 * DX);
            ctx.font = `bold ${coordFontPx}px Arial`;
            ctx.fillStyle = '#3a281c';
            ctx.textBaseline = 'middle';
            for (let r = 0; r < ROWS; r++) {
                const y = TOP_Y + (r + 0.5) * DY + coordYOffset;
                const xLeftEdge = CENTER_X - ((r + 0.5) * DX) / 2;
                const xRightEdge = CENTER_X + ((r + 0.5) * DX) / 2;

                ctx.textAlign = 'right';
                ctx.fillText(String(r + 1), xLeftEdge - coordPadX, y);

                ctx.textAlign = 'left';
                ctx.fillText(rightEdgeLabel(r), xRightEdge + coordPadX, y);
            }

            const stoneRadius = Math.max(4, DX * 0.24);
            const hideAllCellNumbers = showEstimateActive || showMoveNumbers;
            // 与权重围棋相同：最后落子标记在棋子之前绘制，三角形顶点相对棋子中心为右下象限
            for (const m of lastMoveMarkers) {
                if (!isValidCoord(m.row, m.col)) continue;
                const p = triCellCenter(m.row, m.col);
                ctx.beginPath();
                ctx.moveTo(p.x + stoneRadius, p.y + stoneRadius);
                ctx.lineTo(p.x, p.y + stoneRadius);
                ctx.lineTo(p.x + stoneRadius, p.y);
                ctx.closePath();
                ctx.fillStyle = m.color === 1 ? '#fff' : '#222';
                ctx.fill();
            }
            if (cellNumbers && !hideAllCellNumbers) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c <= 2 * r; c++) {
                        if (board[r][c] !== 0) continue;
                        const p = triCellCenter(r, c);
                        const t = String(cellNumbers[r][c]);
                        const fz = Math.max(5, Math.floor(1.0 * stoneRadius));
                        ctx.font = `bold ${fz}px Arial`;
                        ctx.fillText(t, p.x, p.y);
                    }
                }
            }
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c <= 2 * r; c++) {
                    const v = board[r][c];
                    if (v === 0) continue;
                    const p = triCellCenter(r, c);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, stoneRadius, 0, 2 * Math.PI);
                    const g = ctx.createRadialGradient(p.x - 2, p.y - 2, stoneRadius * 0.2, p.x, p.y, stoneRadius * 1.2);
                    if (v === 1) { g.addColorStop(0, '#444'); g.addColorStop(1, '#111'); }
                    else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#aaa'); }
                    ctx.fillStyle = g;
                    ctx.fill();
                    if (cellNumbers && !hideAllCellNumbers) {
                        const t = String(cellNumbers[r][c]);
                        const fz = Math.max(5, Math.floor(1.0 * stoneRadius));
                        ctx.font = `bold ${fz}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = v === 1 ? '#ffffff' : '#111111';
                        ctx.fillText(t, p.x, p.y + 1);
                    }
                }
            }

            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c <= 2 * r; c++) {
                        if (nums[r][c] > 0 && board[r][c] !== 0) {
                            const p = triCellCenter(r, c);
                            ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                            ctx.font = `bold ${Math.max(8, Math.floor(stoneRadius * 1))}px Arial`;
                            ctx.fillText(String(nums[r][c]), p.x, p.y + 1);
                        }
                    }
                }
            }

            for (const key of Object.keys(userBoardMarks)) {
                const [r, c] = key.split(',').map(Number);
                if (!isValidCoord(r, c) || board[r][c] !== 0) continue;
                const ch = userBoardMarks[key];
                const p = triCellCenter(r, c);
                const markBgR = stoneRadius * 0.9;
                ctx.beginPath();
                ctx.arc(p.x, p.y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#edbc80';
                ctx.fill();
                const fontPx = stoneRadius * (ch === '🚩' ? 1.1 : 1.2);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, p.x, p.y + 1);
            }

            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            const editing = !!(editCb && editCb.checked);
            const canHover = editing || tryPlayMode || (!gameOver && isMyTurn);
            if ((isMouseDevice || mobileTwoStepPlacing()) && canHover && isHoverValid && isValidCoord(hoverR, hoverC) && (editing || board[hoverR][hoverC] === 0)) {
                let hoverColor = null;
                if (editing) {
                    const t = (editSel && editSel.value) || 'empty';
                    if (t === 'white') hoverColor = '#fff';
                    else if (t === 'black') hoverColor = '#222';
                    else if (t !== 'empty') hoverColor = '#666';
                } else if (tryPlayMode) hoverColor = tryPlayCurrentPlayer === 1 ? '#222' : '#ddd';
                else hoverColor = mySlot === 'black' ? '#222' : '#ddd';
                if (hoverColor) {
                    const p = triCellCenter(hoverR, hoverC);
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, stoneRadius, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }

            // 形势判断叠加层：死子/归属小方块
            if (showEstimateActive && cachedLiveBoard && cachedTerritory) {
                const dotSize = Math.max(3, Math.floor(stoneRadius * 0.36));
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c <= 2 * r; c++) {
                        const p = triCellCenter(r, c);
                        // 死子标记：原盘有子，活盘为空
                        if (board[r][c] !== 0 && cachedLiveBoard[r][c] === 0) {
                            ctx.fillStyle = board[r][c] === 1 ? '#ffffff' : '#222222';
                            ctx.fillRect(p.x - dotSize, p.y - dotSize, dotSize * 2, dotSize * 2);
                            continue;
                        }
                        // 领地归属：仅空格显示
                        if (board[r][c] !== 0) continue;
                        if (cachedTerritory[r][c] === 1) {
                            ctx.fillStyle = '#222222';
                            ctx.fillRect(p.x - dotSize, p.y - dotSize, dotSize * 2, dotSize * 2);
                        } else if (cachedTerritory[r][c] === 2) {
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(p.x - dotSize, p.y - dotSize, dotSize * 2, dotSize * 2);
                        }
                    }
                }
            }
        }
        function drawBoardWithOverlay() { drawBoard(); }
        function clearEstimate() { cachedLiveBoard = null; cachedTerritory = null; scoreTitle.innerText = '　'; scoreBoard.innerText = '　'; leadInfo.innerText = '　'; drawBoardWithOverlay(); }
        function showEstimate() { if (!showEstimateActive) return clearEstimate(); updateEstimateData(); drawBoardWithOverlay(); }
        function showScoreConfirm(lead) { QiSquareWeiqiCanvas.fillScoreConfirmText(scoreConfirmText, lead); scoreConfirmPanel.style.display = 'block'; }
        function hideScoreConfirm() { scoreConfirmPanel.style.display = 'none'; }
        function downloadRecord(data) { QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix); }
        function mobileTwoStepPlacing() {
            return !isMouseDevice && ROWS > 9;
        }
        function clearMobileMovePreview() {
            hoverR = -1;
            hoverC = -1;
            isHoverValid = false;
        }
        function updateBoardMarkOuterPosition() {}

        function syncState(state) {
            clearMobileMovePreview();
            const prevMatchStarted = matchStarted;
            if (state.boardSize && state.boardSize !== ROWS) {
                ROWS = state.boardSize;
                board = initBoardArray(ROWS);
                setCellNumbers(null);
                updateBoardGeometry();
                document.getElementById('boardSizeSelect').value = ROWS;
            }
            numberOfHands = state.numberOfHands || 1;
            currentPlayer = state.currentPlayer;
            gameOver = !!state.gameOver;
            winner = state.winner || null;
            matchTime = state.matchTime || null;
            matchStarted = !!state.matchStarted;
            if (state.moveCoords) moveLog = state.moveCoords.map(m => m.type === 'move' ? { row: m.row, col: m.col } : null);
            if (state.slots) slots = state.slots;
            setCellNumbers(state.cellNumbers || null);
            if (!replayMode) {
                const prevTotal = Math.max(0, liveReplayBoards.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                rebuildLiveReplayFromMoveCoords(state.moveCoords || [], ((typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.pickRichestBoard) ? QiWeiqiSquarePageRuntime.pickRichestBoard(state.initialBoard, state.board) : (state.initialBoard || state.board)));
                const newTotal = Math.max(0, liveReplayBoards.length - 1);
                if (newTotal === 0) {
                    liveViewStep = 0;
                    liveFollowLatest = true;
                } else if (wasAtEnd) {
                    liveViewStep = newTotal;
                    liveFollowLatest = true;
                } else {
                    liveViewStep = Math.min(liveViewStep, newTotal);
                    if (liveViewStep === newTotal) liveFollowLatest = true;
                }
                applyLiveViewBoard();
                updateLiveReplayPanelUI();
            } else if (!(tryPlayMode && tryPlayFromLive)) {
                board = state.board || board;
                lastMoveMarkers = state.lastMoveMarkers || [];
            }
            const hasAnyStone = board.some(row => row.some(v => v !== 0));
            const hasPlayer = slots.black || slots.white;
            if (!hasAnyStone && !hasPlayer && !gameOver && mySlot === null) sizeSelect.style.display = 'inline-block';
            else sizeSelect.style.display = 'none';
            const nowMatchStarted = !!matchStarted;
            if (tryPlayMode && tryPlayFromLive && mySlot && nowMatchStarted && !prevMatchStarted) {
                exitTryPlay();
            }
            updateTurn();
        }
        function updateTurn() {
            if (replayMode) {
                if (tryPlayMode) {
                    if (showEstimateActive) updateEstimateData();
                    drawBoardWithOverlay();
                    return;
                }
                if (replayStep === 0) turnDisplay.innerText = '初始局面';
                else turnDisplay.innerText = `第${replayStep}手`;
                isMyTurn = false;
                if (showEstimateActive) updateEstimateData();
                drawBoardWithOverlay();
                return;
            }
            const liveTotal = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            const browsingLive = liveReplayBoards.length > 0 && liveViewStep < liveTotal;
            if (browsingLive) {
                if (liveViewStep === 0) turnDisplay.innerText = '初始局面';
                else turnDisplay.innerText = `第${liveViewStep}手`;
                isMyTurn = false;
                if (showEstimateActive) updateEstimateData();
                drawBoardWithOverlay();
                return;
            }
            const hasStoneOnBoard = board.some(row => row.some(v => v === 1 || v === 2));
            const liveHasMoves = liveReplayBoards.length > 1;
            const matchStartedOnce = !!matchStarted || numberOfHands > 1 || hasStoneOnBoard || liveHasMoves;

            function fillTurnDisplayHandsOnly() {
                if (liveReplayBoards.length === 0) {
                    turnDisplay.innerText = hasStoneOnBoard ? `第${numberOfHands}手` : '第1手';
                } else if (liveTotal === 0) {
                    turnDisplay.innerText = '第1手';
                } else {
                    turnDisplay.innerText = `第${liveTotal}手`;
                }
            }

            if (gameOver) {
                turnDisplay.innerText = '对局结束';
                scoreTitle.innerText = winner === 'black' ? '黑胜' : (winner === 'white' ? '白胜' : (winner === 'draw' ? '和棋' : '　'));
                isMyTurn = false;
            } else if (!matchStarted) {
                if (matchStartedOnce) {
                    fillTurnDisplayHandsOnly();
                    isMyTurn = false;
                } else {
                    turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                    isMyTurn = false;
                }
            } else {
                fillTurnDisplayHandsOnly();
                isMyTurn = (mySlot === 'black' && currentPlayer === 1) || (mySlot === 'white' && currentPlayer === 2);
            }
            if (showEstimateActive) updateEstimateData();
            drawBoardWithOverlay();
        }

        function updateReplayUI() {
            const panel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
            panel.style.display = '';
            const isPlayer = !!mySlot;
            const matchStartedEff = !!(matchStarted || (matchTime && matchTime.settings));
            const showMatchControlButtons = isPlayer && matchStartedEff && !replayMode;
            const showTryPlayButton = !showMatchControlButtons;
            tryPlayBtn.style.display = showTryPlayButton ? '' : 'none';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
            for (const id of gameButtonIds) {
                const btn = document.getElementById(id);
                if (!btn) continue;
                btn.style.display = showMatchControlButtons ? '' : 'none';
            }
            updateRecordButtons();
        }
        function setReplayStep(step) {
            if (!replayMode) return;
            if (step < 0) step = 0;
            if (step > replayTotalSteps) step = replayTotalSteps;
            replayStep = step;
            board = deepCopyBoard(replayBoards[step]);
            lastMoveMarkers = replayMarkers[step].map(m => ({ ...m }));
            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;
            updateTurn();
        }
        function enterReplayMode(data) {
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [0];
            let cur = initBoardArray(ROWS);
            if (data.cellNumbers) setCellNumbers(data.cellNumbers);
            replayBoards.push(deepCopyBoard(cur));
            replayMarkers.push([]);
            for (const move of (data.moves || [])) {
                const p = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(p);
                if (move.type === 'move') {
                    const nb = tryPlaceStone(cur, move.row, move.col, p);
                    if (nb) cur = nb;
                    replayBoards.push(deepCopyBoard(cur));
                    replayMarkers.push([{ row: move.row, col: move.col, color: p }]);
                } else {
                    replayBoards.push(deepCopyBoard(cur));
                    replayMarkers.push([]);
                }
            }
            replayTotalSteps = replayBoards.length - 1;
            replayMode = true;
            tryPlayMode = false;
            tryPlayFromLive = false;
            tryPlayFromLiveStep = null;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
        }
        function exitReplayMode() {
            replayMode = false;
            tryPlayMode = false;
            tryPlayFromLive = false;
            tryPlayFromLiveStep = null;
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [];
            replayStep = 0;
            replayTotalSteps = 0;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            document.getElementById('replayStepDisplay').innerText = '0 / 0';
            updateReplayUI();
            updateTurn();
        }
        function updateTryPlayDisplay() {
            if (!tryPlayMode) return;
            document.getElementById('replayStepDisplay').innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
            turnDisplay.innerText = `${tryPlayCurrentPlayer === 1 ? '⚫' : '⚪'} 试下`;
        }
        function enterTryPlay() {
            clearMobileMovePreview();
            if (!replayMode) {
                tryPlayFromLive = true;
                tryPlayFromLiveStep = liveViewStep || 0;
                replayMode = true;
                replayBoards = [deepCopyBoard(board)];
                replayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
                replayStepPlayers = [currentPlayer === 1 ? 2 : 1];
                replayStep = 0;
                replayTotalSteps = 0;
            } else {
                tryPlayFromLive = false;
            }
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
            if (replayStep === 0) tryPlayCurrentPlayer = 1;
            else tryPlayCurrentPlayer = replayStepPlayers[replayStep] === 1 ? 2 : 1;
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            drawBoardWithOverlay();
        }
        function exitTryPlay() {
            clearMobileMovePreview();
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
                    lastMoveMarkers = snapMarkers.map(m => ({ ...m }));
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
                if (showEstimateActive) showEstimate();
                else updateTurn();
            } else {
                slider.max = replayTotalSteps;
                setReplayStep(tryPlayBaseStep);
            }
            updateReplayUI();
        }
        function tryPlayMove(row, col) {
            if (!tryPlayMode || !isValidCoord(row, col) || board[row][col] !== 0) return false;
            const nb = tryPlaceStone(board, row, col, tryPlayCurrentPlayer);
            if (!nb) return false;
            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
            }
            tryPlayBoards.push(deepCopyBoard(nb));
            tryPlayMarkers.push([{ row, col, color: tryPlayCurrentPlayer }]);
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            board = deepCopyBoard(nb);
            lastMoveMarkers = [{ row, col, color: tryPlayCurrentPlayer }];
            tryPlayCurrentPlayer = 3 - tryPlayCurrentPlayer;
            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            drawBoardWithOverlay();
            return true;
        }
        function setTryPlayStep(step) {
            if (!tryPlayMode) return;
            if (step < 0) step = 0;
            if (step > tryPlayTotalSteps) step = tryPlayTotalSteps;
            tryPlayStep = step;
            board = deepCopyBoard(tryPlayBoards[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));
            const basePlayer = tryPlayBaseStep === 0 ? 1 : (3 - replayStepPlayers[tryPlayBaseStep]);
            tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);
            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            drawBoardWithOverlay();
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
            updateTurn();
        }

        function connectWebSocket() {
            ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                onMessage: handleMessage,
                colorStatus: document.getElementById('colorStatus') || colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => reconnectTimer,
                setReconnectTimer: (id) => { reconnectTimer = id; }
            });
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: {
                get mySlot() { return mySlot; },
                set mySlot(v) { mySlot = v; },
                get slots() { return slots; },
                set slots(v) { slots = v; },
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
                set showMoveNumbers(v) { showMoveNumbers = v; },
                get matchTime() { return matchTime; },
                set matchTime(v) { matchTime = v; },
                get matchStarted() { return matchStarted; },
                set matchStarted(v) { matchStarted = !!v; },
                get userBoardMarks() { return userBoardMarks; }
            },
            drawBoard: drawBoardWithOverlay,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => ROWS,
            setBoardSize: (n) => { ROWS = n; },
            getKomi: () => KOMI,
            setKomi: () => {},
            getBoard: () => board,
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
            showScoreConfirm,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            seatOverlayShape: 'triangle',
            onBoardSizeChanged: (msg) => {
                if (!msg.boardSize) return;
                const bs = msg.boardSize;
                if (bs !== ROWS) {
                    ROWS = bs;
                    board = initBoardArray(ROWS);
                    setCellNumbers(null);
                    updateBoardGeometry();
                }
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = String(msg.boardSize);
                drawBoardWithOverlay();
            }
        });
        handleMessage = _weiqiBindings.handleMessage;
        updateRecordButtons = _weiqiBindings.updateRecordButtons;
        updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMove(row, col) {
            if (gameOver) return false;
            if (!isMyTurn) return false;
            if (!isValidCoord(row, col) || board[row][col] !== 0) return false;
            if (!ws || ws.readyState !== WebSocket.OPEN) return false;
            ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            return {
                x: (clientX - rect.left) * scale,
                y: (clientY - rect.top) * scale
            };
        }

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const v = boardMarkSelect.value;
            if (v === '') return { clear: true, ch: '' };
            return { clear: false, ch: v };
        }

        function applyUserBoardMark(row, col) {
            if (!isValidCoord(row, col)) return;
            if (board[row][col] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = row + ',' + col;
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
            const { row, col } = getClosestCell(x, y);
            applyUserBoardMark(row, col);
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
                const { row, col } = getClosestCell(x, y);
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

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestCell(x, y);
            if (tryPlayMode && replayMode) {
                if (row < 0 || col < 0 || !isValidCoord(row, col)) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardWithOverlay();
                    return;
                }
                if (board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (hoverR === row && hoverC === col && isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        hoverR = row;
                        hoverC = col;
                        isHoverValid = true;
                        drawBoardWithOverlay();
                    }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            if (gameOver) return;
            if (!isMyTurn) return;
            if (waitingScoreConfirm) return;
            if (row < 0 || col < 0 || !isValidCoord(row, col)) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoardWithOverlay();
                return;
            }
            if (board[row][col] !== 0) return;
            if (mobileTwoStepPlacing()) {
                if (hoverR === row && hoverC === col && isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoardWithOverlay();
                } else {
                    hoverR = row;
                    hoverC = col;
                    isHoverValid = true;
                    drawBoardWithOverlay();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (waitingScoreConfirm) {
                    if (isHoverValid) { isHoverValid = false; hoverR = -1; hoverC = -1; drawBoardWithOverlay(); }
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestCell(x, y);
                hoverR = row; hoverC = col;
                const editing = !!(document.getElementById('editModeCheckbox') || {}).checked;
                isHoverValid = (row >= 0 && col >= 0 && isValidCoord(row, col) && (editing || board[row][col] === 0));
                drawBoardWithOverlay();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!waitingScoreConfirm) {
                    isHoverValid = false;
                    hoverR = -1; hoverC = -1;
                    drawBoardWithOverlay();
                }
            });
        }

        if (scoreConfirmYes) {
            scoreConfirmYes.onclick = () => {
                if (ws) ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
                hideScoreConfirm();
            };
            scoreConfirmNo.onclick = () => {
                iRejected = true;
                if (ws) ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (showEstimateActive) {
                    showEstimateActive = false;
                    clearEstimate();
                }
                waitingScoreConfirm = false;
            };
        }

        /* board edit UI (triangular cells) */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            const _editPs = {
                get board() { return board; },
                set board(v) { board = v; },
                get gameOver() { return gameOver; },
                get mySlot() { return mySlot; },
                get gameStarted() { return numberOfHands > 1 || !!matchStarted; },
                set gameStarted(v) { /* derived */ },
                editModeEnabled: false,
                editTool: 'empty',
                get hoverRow() { return hoverR; },
                set hoverRow(v) { hoverR = v == null ? -1 : v; },
                get hoverCol() { return hoverC; },
                set hoverCol(v) { hoverC = v == null ? -1 : v; },
                get isHoverValid() { return isHoverValid; },
                set isHoverValid(v) { isHoverValid = !!v; },
                get ws() { return ws; }
            };
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: _editPs,
                canvas,
                mode: 'grid2d',
                pickAtClient(clientX, clientY) {
                    const p = canvasCoordsFromClient(clientX, clientY);
                    return getClosestCell(p.x, p.y);
                },
                drawBoard: drawBoardWithOverlay,
                getBoard() { return board; },
                setBoard(b) { board = b; },
                emptyBoard() { return initBoardArray(ROWS); }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) _editPs.gameStarted = (state.numberOfHands || 1) > 1 || !!state.matchStarted;
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

        connectWebSocket();
        updateReplayUI();
        drawBoardWithOverlay();
        })();
    }
};
