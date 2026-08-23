window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["snub-quadrangle-weiqi"] = {
    shell: {
        "title": "扭棱四角围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />采用扭棱四角棋盘。<br />",
        "defaultKomiText": "黑贴白2点",
        "boardSizeMin": 3,
        "boardSizeMax": 8,
        "defaultBoardSize": 7,
        "minLib": 1,
        "recordDownloadPrefix": "扭棱四角围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "扭棱四角围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
// ======================== 配置 ========================
        let BOARD_LANES = 7;
        let GRID_W = 3 * BOARD_LANES - 2;
        let GRID_H = 3 * BOARD_LANES - 2;
        function komiForLanes(lanes) {
            return lanes === 3 ? 3 : 2;
        }
        let KOMI = komiForLanes(BOARD_LANES);
        let vertexPos = new Map();
        let boardEdgePath = null;
        let hoverDrawPending = false;

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
                for (const [a, b] of arr) {
                    if (Snub.isValidVertex(a, b, gridW, gridH)) out.push([a, b]);
                }
                return out;
            }
        };

        function initGridBoard() {
            const w = GRID_W, h = GRID_H;
            const b = Array(w).fill().map(() => Array(h).fill(-1));
            for (let r = 0; r < w; r++)
                for (let c = 0; c < h; c++)
                    if (Snub.isValidVertex(r, c, w, h)) b[r][c] = 0;
            return b;
        }

        // 全局状态
        let board = initGridBoard();
        let numberOfHands = 1;
        let currentPlayer = 1;
        let mySlot = null;
        let gameOver = false;
        let winner = null;
        let lastMoveMarkers = [];
        let showEstimateActive = false;
        let cachedLiveBoard = null;
        let cachedTerritory = null;
        let waitingScoreConfirm = false; // 数点确认等待中
        let iRejected = false;

        let ws;
        let isMyTurn = false;
        let slots = { black: false, white: false };
        let matchStarted = false;
        let matchStartedOnce = false;
        /** 与 qi.js 限时协商一致：由 syncState / 限时消息更新 */
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

        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBoards = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 1;
        let tryPlayBasePlayer = 1;
        let tryPlayStep = 0;
        let tryPlayTotalSteps = 0;
        let tryPlayFromLive = false;
        let tryPlayFromLiveStep = null;

        let liveReplayBoards = [];
        let liveReplayMarkers = [];
        let liveReplayStepPlayers = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;

        /** 本地棋盘标记（仅本机显示）坐标键 "r,c" → 标记字符 */
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

        let hoverRow = -1, hoverCol = -1, isHoverValid = false;
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        function mobileTwoStepPlacing() {
            return !isMouseDevice && BOARD_LANES >= 5;
        }
        function clearMobileMovePreview() {
            hoverRow = -1;
            hoverCol = -1;
            isHoverValid = false;
        }

        // ======================== 扭棱图 + 围棋规则（与标准围棋相同：无气提子，允许自杀，禁全同） ========================
        function deepCopyBoard(src) { return src.map(row => row.slice()); }

        function countGroupLiberties(bd, row, col) {
            const color = bd[row][col];
            if (color !== 1 && color !== 2) return 0;
            const visited = Array(GRID_W).fill().map(() => Array(GRID_H).fill(false));
            const queue = [[row, col]];
            visited[row][col] = true;
            const liberties = new Set();
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [nr, nc] of Snub.getNeighbors(r, c, GRID_W, GRID_H)) {
                    if (bd[nr][nc] === 0) liberties.add(nr + ',' + nc);
                    else if (bd[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }
            return liberties.size;
        }

        function removeGroup(bd, row, col, color) {
            const queue = [[row, col]];
            bd[row][col] = 0;
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [nr, nc] of Snub.getNeighbors(r, c, GRID_W, GRID_H)) {
                    if (nr >= 0 && nr < GRID_W && nc >= 0 && nc < GRID_H && bd[nr][nc] === color) {
                        bd[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function tryPlaceStone(boardBefore, row, col, playerVal) {
            if (!Snub.isValidVertex(row, col, GRID_W, GRID_H) || boardBefore[row][col] !== 0) return null;
            const newBoard = deepCopyBoard(boardBefore);
            newBoard[row][col] = playerVal;
            const enemyColor = 3 - playerVal;
            const checkedEnemy = new Set();
            for (const [nr, nc] of Snub.getNeighbors(row, col, GRID_W, GRID_H)) {
                if (newBoard[nr][nc] === enemyColor) {
                    const key = `${nr},${nc}`;
                    if (!checkedEnemy.has(key)) {
                        checkedEnemy.add(key);
                        if (countGroupLiberties(newBoard, nr, nc) < 1)
                            removeGroup(newBoard, nr, nc, enemyColor);
                    }
                }
            }
            if (countGroupLiberties(newBoard, row, col) < 1)
                removeGroup(newBoard, row, col, playerVal);
            return newBoard;
        }

        // ======================== 形势判断========================
        function removeDeadAndDying(srcBoard) {
            let boardCopy = deepCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                const visited = Array(GRID_W).fill().map(() => Array(GRID_H).fill(false));
                for (let r = 0; r < GRID_W; r++) {
                    for (let c = 0; c < GRID_H; c++) {
                        if (!Snub.isValidVertex(r, c, GRID_W, GRID_H)) continue;
                        const val = boardCopy[r][c];
                        if ((val === 1 || val === 2) && !visited[r][c]) {
                            const color = val;
                            const queue = [[r, c]];
                            visited[r][c] = true;
                            const stones = [[r, c]];
                            const liberties = new Set();
                            let idx = 0;
                            while (idx < queue.length) {
                                const [rr, cc] = queue[idx++];
                                for (const [nr, nc] of Snub.getNeighbors(rr, cc, GRID_W, GRID_H)) {
                                    if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                    else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                        visited[nr][nc] = true;
                                        queue.push([nr, nc]);
                                        stones.push([nr, nc]);
                                    }
                                }
                            }
                            if (liberties.size === 0) {
                                for (let [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                                continue;
                            }
                        }
                    }
                }
            }
            return boardCopy;
        }

        function assignTerritoryWithRange(liveBoard) {
            const territory = Array(GRID_W).fill().map(() => Array(GRID_H).fill(0));
            for (let r = 0; r < GRID_W; r++) {
                for (let c = 0; c < GRID_H; c++) {
                    if (!Snub.isValidVertex(r, c, GRID_W, GRID_H) || liveBoard[r][c] !== 0) continue;
                    const maxDist = (r <= 1 || r >= GRID_W - 2 || c <= 1 || c >= GRID_H - 2) ? 5 : 4;
                    let blackMin = Infinity, whiteMin = Infinity;
                    const dist = Array(GRID_W).fill().map(() => Array(GRID_H).fill(Infinity));
                    dist[r][c] = 0;
                    const queue = [[r, c]];
                    let front = 0;
                    while (front < queue.length) {
                        const [cr, cc] = queue[front++];
                        const d = dist[cr][cc];
                        if (d > maxDist) continue;
                        if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                        if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                        for (const [nr, nc] of Snub.getNeighbors(cr, cc, GRID_W, GRID_H)) {
                            if (liveBoard[nr][nc] !== -1 && dist[nr][nc] === Infinity) {
                                dist[nr][nc] = d + 1;
                                queue.push([nr, nc]);
                            }
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

        function computeScore(liveBoard, territory) {
            let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let r = 0; r < GRID_W; r++) {
                for (let c = 0; c < GRID_H; c++) {
                    if (!Snub.isValidVertex(r, c, GRID_W, GRID_H)) continue;
                    if (liveBoard[r][c] === 1) blackStones++;
                    else if (liveBoard[r][c] === 2) whiteStones++;
                    else if (liveBoard[r][c] === 0) {
                        if (territory[r][c] === 1) blackTerritory++;
                        else if (territory[r][c] === 2) whiteTerritory++;
                        else if (territory[r][c] === 3) publicTerritory++;
                    }
                }
            }
            const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
            const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
            return { blackTotal, whiteTotal };
        }

        function computeScoreFromBoard(srcBoard) {
            const liveBoard = removeDeadAndDying(srcBoard);
            const territory = assignTerritoryWithRange(liveBoard);
            return computeScore(liveBoard, territory);
        }

        // 计算当前形势领先（黑方）
        function computeLead() {
            const { blackTotal, whiteTotal } = computeScoreFromBoard(board);
            return blackTotal - whiteTotal - 2 * KOMI;
        }

        /** 本地标记：仅空点显示；形势判断开启时整盘隐藏（数据仍保留，关闭后恢复） */
        function isUserBoardMarkVisibleAt(r, c) {
            if (showEstimateActive) return false;
            if (!Snub.isValidVertex(r, c, GRID_W, GRID_H)) return false;
            if (board[r][c] !== 0) return false;
            return true;
        }

        // ======================== 绘制 ========================
        function computeStoneNumbers() {
            const nums = Array(GRID_W).fill().map(() => Array(GRID_H).fill(0));
            if (replayMode && tryPlayMode) {
                for (let i = 1; i <= tryPlayStep; i++) {
                    const markers = tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < GRID_W && m.col < GRID_H && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (replayMode) {
                for (let i = 1; i <= replayStep; i++) {
                    const markers = replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < GRID_W && m.col < GRID_H && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (liveReplayBoards.length && liveViewStep < liveReplayBoards.length - 1) {
                for (let i = 1; i <= liveViewStep; i++) {
                    const markers = liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < GRID_W && m.col < GRID_H && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else {
                for (let i = 0; i < moveLog.length; i++) {
                    const m = moveLog[i];
                    if (m && m.row < GRID_W && m.col < GRID_H && board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function buildVertexLayout(lanes) {
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
            const pad = 60 - 5 * BOARD_LANES;
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
                pos.set(`${v.r},${v.c}`, p);
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

        /** 应用棋盘路数与尺寸：更新布局、棋盘与贴目。 */
        function updateKomiInfo() {
            const el = document.getElementById('komiInfo');
            if (el) el.textContent = '黑贴白' + KOMI + '点';
        }

        function applyBoardDimensions(lanes, w, h) {
            BOARD_LANES = lanes;
            KOMI = komiForLanes(lanes);
            GRID_W = w;
            GRID_H = h;
            board = initGridBoard();
            rebuildLayout();
            updateKomiInfo();
        }

        let coordLabelPos = null;
        function computeCoordLabelPos() {
            const gw = GRID_W, gh = GRID_H;
            const colX = [], rowY = [];
            for (let c = 0; c < gh; c++) {
                let topX = Infinity, topY = Infinity;
                for (let r = 0; r < gw; r++) {
                    if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                    const pt = vertexPos.get(`${r},${c}`);
                    if (!pt) continue;
                    if (pt.y < topY) { topY = pt.y; topX = pt.x; }
                }
                colX.push(isFinite(topX) ? topX : null);
            }
            for (let r = 0; r < gw; r++) {
                let leftX = Infinity, leftY = Infinity;
                for (let c = 0; c < gh; c++) {
                    if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                    const pt = vertexPos.get(`${r},${c}`);
                    if (!pt) continue;
                    if (pt.x < leftX) { leftX = pt.x; leftY = pt.y; }
                }
                rowY.push(isFinite(leftY) ? leftY : null);
            }
            return { colX, rowY };
        }

        function rebuildLayout() {
            const built = buildVertexLayout(BOARD_LANES);
            vertexPos = built.pos;
            boardEdgePath = built.edgePath;
            coordLabelPos = computeCoordLabelPos();
            rebuildGridLayer();
        }

        function scheduleHoverDraw() {
            if (hoverDrawPending) return;
            hoverDrawPending = true;
            requestAnimationFrame(() => {
                hoverDrawPending = false;
                drawBoard();
            });
        }

        function pixelAt(row, col) {
            return vertexPos.get(`${row},${col}`) || { x: 0, y: 0 };
        }

        /** 坐标标签：行号 1..H 在左侧（同一竖直线），列字母在上方（同一水平线），与 VariantQi 一致。 */
        function drawCoordsTo(tctx) {
            if (!coordLabelPos) return;
            const gw = GRID_W, gh = GRID_H;
            tctx.font = `bold ${Math.max(9, Math.round(170 / gw))}px Arial`;
            tctx.fillStyle = '#3a281c';
            tctx.textAlign = 'center';
            tctx.textBaseline = 'middle';
            const pad = 60 - 5 * BOARD_LANES;
            const labelX = 0.5 * pad;   // 行号统一 x
            const labelY = 0.6 * pad;   // 列字母统一 y
            for (let c = 0; c < gh; c++) {
                const topX = coordLabelPos.colX[c];
                if (topX == null) continue;
                let letter = String.fromCharCode(65 + (gw - 1 - c));
                if (gw - 1 - c >= 26) letter = String.fromCharCode(64 + Math.floor((gw - 1 - c) / 26)) + String.fromCharCode(65 + (gw - 1 - c) % 26);
                tctx.fillText(letter, topX, labelY);
            }
            for (let r = 0; r < gw; r++) {
                const leftY = coordLabelPos.rowY[r];
                if (leftY == null) continue;
                tctx.fillText((r + 1).toString(), labelX, leftY);
            }
        }

        /** 棋子离屏 sprite 缓存：阴影 + 渐变只绘制一次，重绘时直接 drawImage（大幅提速）。 */
        let stoneSpriteCache = Object.create(null);
        function getStoneSprite(color, r) {
            const key = color + '_' + r.toFixed(2);
            if (stoneSpriteCache[key]) return stoneSpriteCache[key];
            const size = Math.ceil(r * 2 + 10);
            const c = document.createElement('canvas');
            c.width = c.height = size;
            const g = c.getContext('2d');
            const cx = size / 2, cy = size / 2;
            g.shadowBlur = 6;
            g.shadowColor = 'rgba(0,0,0,0.5)';
            g.shadowOffsetY = 2;
            const grad = g.createRadialGradient(cx - 3, cy - 3, r * 0.2, cx, cy, r * 1.2);
            if (color === 1) {
                grad.addColorStop(0, '#444');
                grad.addColorStop(0.6, '#222');
                grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.5, '#eee');
                grad.addColorStop(1, '#aaa');
            }
            g.beginPath();
            g.arc(cx, cy, r, 0, 2 * Math.PI);
            g.fillStyle = grad;
            g.fill();
            g.shadowBlur = 0;
            g.shadowOffsetY = 0;
            g.beginPath();
            g.arc(cx - 3, cy - 3, r * 0.15, 0, 2 * Math.PI);
            g.fillStyle = color === 1 ? '#444' : '#fff';
            g.fill();
            stoneSpriteCache[key] = c;
            return c;
        }

        /** 格线 + 坐标静态层：布局不变时合成一次，重绘直接 drawImage（大幅提速）。 */
        let gridLayerCanvas = null;
        function rebuildGridLayer() {
            const dpr = window.devicePixelRatio || 1;
            const c = document.createElement('canvas');
            c.width = 600 * dpr;
            c.height = 600 * dpr;
            const g = c.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.lineWidth = 1.5;
            g.strokeStyle = '#3a281c';
            if (boardEdgePath) g.stroke(boardEdgePath);
            drawCoordsTo(g);
            gridLayerCanvas = c;
        }

        function drawBoard() {
            if (!vertexPos || vertexPos.size === 0) rebuildLayout();
            ctx.clearRect(0, 0, 600, 600);
            const stoneR = 75 / (BOARD_LANES - 1) + 1.32;
            const gw = GRID_W, gh = GRID_H;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#3a281c';
            if (gridLayerCanvas) {
                ctx.drawImage(gridLayerCanvas, 0, 0, 600, 600);
            } else if (boardEdgePath) {
                ctx.stroke(boardEdgePath);
                drawCoordsTo(ctx);
            }

            const markLenDefault = stoneR * 0.8;
            const lowerLastMoveMarker = showMoveNumbers || showEstimateActive;
            if (lowerLastMoveMarker) {
                for (let { row, col, color } of lastMoveMarkers) {
                    const { x, y } = pixelAt(row, col);
                    ctx.beginPath();
                    ctx.moveTo(x + stoneR, y + stoneR);
                    ctx.lineTo(x, y + stoneR);
                    ctx.lineTo(x + stoneR, y);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.fill();
                }
            }

            const spriteCache = getStoneSprite;
            for (let r = 0; r < gw; r++) {
                for (let c = 0; c < gh; c++) {
                    const val = board[r][c];
                    if (val !== 1 && val !== 2) continue;
                    const { x, y } = pixelAt(r, c);
                    const sp = spriteCache(val, stoneR);
                    ctx.drawImage(sp, x - sp.width / 2, y - sp.height / 2);
                    if (!showMoveNumbers) {
                        ctx.beginPath();
                        ctx.arc(x - 2, y - 2, stoneR * 0.18, 0, 2 * Math.PI);
                        ctx.fillStyle = val === 1 ? '#444' : '#fff';
                        ctx.fill();
                    }
                }
            }
            if (!lowerLastMoveMarker) {
                const markLen = markLenDefault;
                for (let { row, col, color } of lastMoveMarkers) {
                    const { x, y } = pixelAt(row, col);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + markLen, y);
                    ctx.lineTo(x, y + markLen);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.fill();
                }
            }
            for (const key of Object.keys(userBoardMarks)) {
                const [r, c] = key.split(',').map(Number);
                if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                if (!isUserBoardMarkVisibleAt(r, c)) continue;
                const ch = userBoardMarks[key];
                const { x, y } = pixelAt(r, c);
                const markBgR = stoneR * 0.56;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
                ctx.fill();
                const fontPx = stoneR * (ch === '🚩' ? 1.2 : 1.32);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }
            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < gw; r++) {
                    for (let c = 0; c < gh; c++) {
                        if (nums[r][c] > 0 && board[r][c] !== 0) {
                            const { x, y } = pixelAt(r, c);
                            const numStr = nums[r][c].toString();
                            const fontSize = Math.max(8, Math.floor(stoneR * (numStr.length >= 3 ? 0.85 : 1.05)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                            ctx.fillText(numStr, x, y + 1);
                        }
                    }
                }
            }
            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            const editing = !!(editCb && editCb.checked);
            const canHover = editing || tryPlayMode || (!gameOver && isMyTurn);
            if (canHover && isHoverValid && hoverRow >= 0 && hoverCol >= 0 && (editing || board[hoverRow][hoverCol] === 0)) {
                let hoverColor = null;
                if (editing) {
                    const t = (editSel && editSel.value) || 'empty';
                    if (t === 'white') hoverColor = '#fff';
                    else if (t === 'black') hoverColor = '#222';
                    else if (t !== 'empty') hoverColor = '#666';
                } else if (tryPlayMode) hoverColor = tryPlayCurrentPlayer === 1 ? '#222' : '#fff';
                else hoverColor = mySlot === 'black' ? '#222' : '#fff';
                if (hoverColor) {
                    const { x, y } = pixelAt(hoverRow, hoverCol);
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(x, y, stoneR, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }
            if (showEstimateActive && cachedLiveBoard && cachedTerritory) {
                const dotRadius = 0.4 * stoneR;
                for (let r = 0; r < gw; r++) {
                    for (let c = 0; c < gh; c++) {
                        if (!Snub.isValidVertex(r, c, gw, gh)) continue;
                        const { x, y } = pixelAt(r, c);
                        if (board[r][c] !== 0 && cachedLiveBoard[r][c] === 0) {
                            ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#222';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        } else if (board[r][c] === 0 && cachedTerritory[r][c] === 1) {
                            ctx.fillStyle = '#222';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        } else if (board[r][c] === 0 && cachedTerritory[r][c] === 2) {
                            ctx.fillStyle = '#f0f0f0';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        }
                    }
                }
            }
        }

        function updateTurn() {
            if (replayMode) {
                drawBoard();
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
                drawBoard();
                return;
            }
            if (gameOver) {
                turnDisplay.innerText = '对局结束';
                if (winner === 'black') scoreTitle.innerText = '黑胜';
                else if (winner === 'white') scoreTitle.innerText = '白胜';
                else if (winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoard();
                return;
            }
            if (matchStartedOnce === undefined) matchStartedOnce = false;
            if (matchStarted) matchStartedOnce = true;
            const bothSelected = !!(slots && slots.black && slots.white);
            const hasStoneOnBoard = board.some((row, r) => row.some((v, c) => Snub.isValidVertex(r, c, GRID_W, GRID_H) && (v === 1 || v === 2)));
            const matchReady = !!(matchStarted || matchStartedOnce);
            if (bothSelected && matchReady) matchStartedOnce = true;
            if (numberOfHands > 1 || hasStoneOnBoard) matchStartedOnce = true;
            if (!matchStarted) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                isMyTurn = false;
                drawBoard();
                return;
            }
            const total = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            if (liveReplayBoards.length === 0) {
                const emptyBoard = !board.some(row => row.some(v => v === 1 || v === 2));
                turnDisplay.innerText = emptyBoard ? '初始局面' : `${currentPlayer === 1 ? '⚫' : '⚪'} 第${numberOfHands}手`;
            } else if (total === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const p = liveReplayStepPlayers[total];
                turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            isMyTurn = !!(matchStarted && (mySlot !== null)
                && ((mySlot === 'black' && currentPlayer === 1) || (mySlot === 'white' && currentPlayer === 2)));
            drawBoard();
        }

        function showEstimate()
        {
            if (!showEstimateActive) { clearEstimate(); return; }
            const r = QiSquareWeiqiCanvas.computeWeiqiEstimateCaches(
                board, removeDeadAndDying, assignTerritoryWithRange, computeScore, KOMI
            );
            cachedLiveBoard = r.cachedLiveBoard;
            cachedTerritory = r.cachedTerritory;
            QiSquareWeiqiCanvas.fillWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo, r.blackTotal, r.whiteTotal, r.lead);
            drawBoard();
        }

        function clearEstimate()
        {
            cachedLiveBoard = null;
            cachedTerritory = null;
            QiSquareWeiqiCanvas.clearWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo);
            drawBoard();
        }

        function downloadRecord(data) {
            const now = new Date();
            const pad = n => n.toString().padStart(2, '0');
            const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const lanes = data.boardLanes != null ? data.boardLanes : data.boardSize;
            const filename = `扭棱四角围棋_${lanes}路_${dateStr}.json`;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function showScoreConfirm(lead) {
            QiSquareWeiqiCanvas.fillScoreConfirmText(scoreConfirmText, lead);
            scoreConfirmPanel.style.display = 'block';
        }

        function hideScoreConfirm() {
            scoreConfirmPanel.style.display = 'none';
        }

        // ======================== 打谱模式 ========================
        function enterReplayMode(data) {
            clearMobileMovePreview();
            const lanes = data.boardLanes != null ? data.boardLanes : BOARD_LANES;
            applyBoardDimensions(lanes, data.gridWidth, data.gridHeight);

            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [0];

            let curBoard = initGridBoard();
            if (Array.isArray(data.initialPosition)) {
                for (const s of data.initialPosition) {
                    if (typeof s !== 'string' || s.length < 4) continue;
                    const p = s[0];
                    if (p !== 'B' && p !== 'W') continue;
                    const comma = s.indexOf(',');
                    if (comma <= 1) continue;
                    const r = parseInt(s.slice(1, comma), 10);
                    const c = parseInt(s.slice(comma + 1), 10);
                    if (!Number.isInteger(r) || !Number.isInteger(c) || !isValidCoord(r, c)) continue;
                    curBoard[r][c] = p === 'B' ? 1 : 2;
                }
            }
            replayBoards.push(deepCopyBoard(curBoard));
            replayMarkers.push([]);

            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
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
            else drawBoard();
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
        }

        // ======================== 试下模式 ========================
        function enterTryPlay() {
            clearMobileMovePreview();
            const fromLive = !replayMode;
            const RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
            const startPlayer = RT && RT.resolveTryPlaySideToMove
                ? RT.resolveTryPlaySideToMove({
                    fromLive,
                    replayStep,
                    replayStepPlayers,
                    replayBoardsLength: (replayBoards && replayBoards.length) || 0,
                    liveViewStep,
                    liveReplayStepPlayers,
                    liveReplayBoardsLength: (liveReplayBoards && liveReplayBoards.length) || 0,
                    currentPlayer
                })
                : (fromLive
                    ? ((liveViewStep > 0 && liveReplayStepPlayers[liveViewStep])
                        ? (3 - liveReplayStepPlayers[liveViewStep])
                        : ((currentPlayer === 1 || currentPlayer === 2) ? currentPlayer : 1))
                    : (replayStep > 0 ? (3 - replayStepPlayers[replayStep]) : 1));
            if (fromLive) {
                tryPlayFromLive = true;
                tryPlayFromLiveStep = liveViewStep || 0;
                replayMode = true;
                replayBoards = [deepCopyBoard(board)];
                replayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
                replayStepPlayers = [startPlayer === 1 ? 2 : 1];
                replayStep = 0;
                replayTotalSteps = 0;
            } else {
                tryPlayFromLive = false;
            }
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBasePlayer = startPlayer;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
            tryPlayCurrentPlayer = startPlayer;
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            drawBoard();
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
            tryPlayBasePlayer = 1;
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
            if (!Snub.isValidVertex(row, col, GRID_W, GRID_H)) return false;
            if (board[row][col] !== 0) return false;
            const playerVal = tryPlayCurrentPlayer;
            const newBoard = tryPlaceStone(board, row, col, playerVal);
            if (!newBoard) return false;

            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
            }

            tryPlayBoards.push(deepCopyBoard(newBoard));
            tryPlayMarkers.push([{ row, col, color: playerVal }]);
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = 3 - tryPlayCurrentPlayer;

            board = deepCopyBoard(newBoard);
            lastMoveMarkers = [{ row, col, color: playerVal }];

            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            if (showEstimateActive) showEstimate();
            else drawBoard();
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
            else drawBoard();
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
            let curBoard = initGridBoard();
            if (openingBoard && Array.isArray(openingBoard) && Array.isArray(openingBoard[0])
                && openingBoard.length === curBoard.length && openingBoard[0].length === curBoard[0].length)
                curBoard = deepCopyBoard(openingBoard);
            liveReplayBoards.push(deepCopyBoard(curBoard));
            liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
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
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
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
                board = initGridBoard();
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
            const prevMatchStarted = matchStarted;
            if (state.boardLanes != null && state.gridWidth != null && state.gridHeight != null) {
                if (state.boardLanes !== BOARD_LANES || state.gridWidth !== GRID_W || state.gridHeight !== GRID_H)
                    applyBoardDimensions(state.boardLanes, state.gridWidth, state.gridHeight);
            } else if (state.boardSize != null) {
                const lanes = state.boardSize;
                const w = 3 * lanes - 2;
                const h = 3 * lanes - 2;
                if (lanes !== BOARD_LANES || w !== GRID_W || h !== GRID_H)
                    applyBoardDimensions(lanes, w, h);
            }
            if (state.boardLanes != null) {
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (sizeSelect) sizeSelect.value = state.boardLanes;
            }
            if (state.komi != null && Number.isFinite(state.komi)) {
                KOMI = state.komi;
                updateKomiInfo();
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
            if (state.moveCoords)
                moveLog = state.moveCoords.map(m => m.type === 'move' ? { row: m.row, col: m.col } : null);
            if (state.slots)
                slots = state.slots;
            if (state.matchTime !== undefined)
                matchTime = state.matchTime;

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

            if (tryPlayMode && tryPlayFromLive && mySlot && matchStarted && !prevMatchStarted)
                exitTryPlay();

            const hasAnyStone = board.some((row, r) => row.some((v, c) => Snub.isValidVertex(r, c, GRID_W, GRID_H) && (v === 1 || v === 2)));
            const hasPlayer = slots.black || slots.white;
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (!hasAnyStone && !hasPlayer && !gameOver && mySlot === null)
                sizeSelect.style.display = 'inline-block';
            else
                sizeSelect.style.display = 'none';

            if (showEstimateActive)
            {
                cachedLiveBoard = removeDeadAndDying(board);
                cachedTerritory = assignTerritoryWithRange(cachedLiveBoard);
                showEstimate();
            } else {
                updateTurn();
            }
            updateReplayUI();
        }

        let updateRecordButtons = () => {};
        let updateRadioStyles = () => {};
        let handleMessage = () => {};
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: {
                get board() { return board; },
                get mySlot() { return mySlot; },
                set mySlot(v) { mySlot = v; },
                get slots() { return slots; },
                set slots(v) { slots = v; },
                get matchStarted() { return matchStarted; },
                set matchStarted(v) { matchStarted = !!v; if (matchStarted) matchStartedOnce = true; },
                get matchStartedOnce() { return matchStartedOnce; },
                set matchStartedOnce(v) { matchStartedOnce = !!v; },
                get matchTime() { return matchTime; },
                set matchTime(v) { matchTime = v; },
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
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => BOARD_LANES,
            setBoardSize: (n) => {
                const lanes = Number(n);
                KOMI = komiForLanes(lanes);
                updateKomiInfo();
                applyBoardDimensions(lanes, 3 * lanes - 2, 3 * lanes - 2);
            },
            getKomi: () => KOMI,
            setKomi: (n) => { KOMI = n; updateKomiInfo(); },
            // 公共 updateRecordButtons 需要二维棋盘，传入过滤 -1 的兼容视图。
            getBoard: () => board.map((row, r) => row.map((v, c) => (
                Snub.isValidVertex(r, c, GRID_W, GRID_H) ? v : 0
            ))),
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
            updateBoardGeometry: rebuildLayout,
            initBoardArray: () => initGridBoard(),
            exitReplayMode,
            clearEstimate,
            hideScoreConfirm,
            showEstimate,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            showScoreConfirm,
            onNewGameStarted: () => {
                colorStatus.innerText = '未选择阵营';
            },
            onBoardSizeChanged: (msg) => {
                syncState(msg);
            },
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });
        handleMessage = _weiqiBindings.handleMessage;
        updateRecordButtons = _weiqiBindings.updateRecordButtons;
        updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMove(row, col) {
            if (gameOver) return false;
            if (!isMyTurn) return false;
            if (!Snub.isValidVertex(row, col, GRID_W, GRID_H)) return false;
            if (board[row][col] !== 0) return false;
            ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        function getClosestIntersection(x, y) {
            let bestR = -1, bestC = -1, bestD = 26;
            for (let r = 0; r < GRID_W; r++) {
                for (let c = 0; c < GRID_H; c++) {
                    if (!Snub.isValidVertex(r, c, GRID_W, GRID_H)) continue;
                    const p = pixelAt(r, c);
                    const d = Math.hypot(x - p.x, y - p.y);
                    if (d < bestD) { bestD = d; bestR = r; bestC = c; }
                }
            }
            return { row: bestR, col: bestC };
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
            if (!Snub.isValidVertex(row, col, GRID_W, GRID_H)) return;
            if (board[row][col] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = row + ',' + col;
            const existing = userBoardMarks[key];
            if (clear) {
                if (existing !== undefined) {
                    delete userBoardMarks[key];
                    drawBoard();
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
            drawBoard();
        }

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
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
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            if (tryPlayMode) {
                if (row < 0 || col < 0 || !Snub.isValidVertex(row, col, GRID_W, GRID_H)) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
                    return;
                }
                if (board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (hoverRow === row && hoverCol === col && isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        hoverRow = row;
                        hoverCol = col;
                        isHoverValid = true;
                        drawBoard();
                    }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            if (gameOver) return;
            if (!isMyTurn) return;
            if (waitingScoreConfirm) return;
            if (row < 0 || col < 0 || !Snub.isValidVertex(row, col, GRID_W, GRID_H)) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoard();
                return;
            }
            if (board[row][col] !== 0) return;
            if (mobileTwoStepPlacing()) {
                if (hoverRow === row && hoverCol === col && isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    hoverRow = row;
                    hoverCol = col;
                    isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (waitingScoreConfirm) {
                    if (isHoverValid) { isHoverValid = false; hoverRow = -1; hoverCol = -1; drawBoard(); }
                    return;
                }
                const canHover = tryPlayMode || (!gameOver && isMyTurn);
                if (!canHover) {
                    if (isHoverValid || hoverRow >= 0 || hoverCol >= 0) {
                        isHoverValid = false;
                        hoverRow = -1;
                        hoverCol = -1;
                        drawBoard();
                    }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                hoverRow = row; hoverCol = col;
                isHoverValid = (row >= 0 && col >= 0 && Snub.isValidVertex(row, col, GRID_W, GRID_H) && board[row][col] === 0);
                scheduleHoverDraw();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!waitingScoreConfirm) {
                    isHoverValid = false;
                    hoverRow = -1; hoverCol = -1;
                    drawBoard();
                }
            });
        }

        // 数点确认按钮事件
        if (scoreConfirmYes)
        {
            scoreConfirmYes.onclick = () => {
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
                get hoverRow() { return hoverRow; },
                set hoverRow(v) { hoverRow = v == null ? -1 : v; },
                get hoverCol() { return hoverCol; },
                set hoverCol(v) { hoverCol = v == null ? -1 : v; },
                get isHoverValid() { return isHoverValid; },
                set isHoverValid(v) { isHoverValid = !!v; },
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
