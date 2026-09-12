window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['torus-weiqi'] = {
    shell: {
        "title": "环面围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />棋盘上下相连、左右相连。<br /><br />",
        "defaultKomiText": "黑贴白2.5点",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "环面围棋",
        "standardWeiqiMatchTime": true,
        "features": {
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
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "环面围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 环面外观 ========================
        /**
         * 主棋盘区域（含向外半格）之外的深色底色。
         * 主棋盘区域用棋盘原木色（读取 canvas 的 CSS 底色，默认 #fdcc90）。
         * 想微调外围深浅，改这个常量即可。
         */
        const TORUS_OUTER_BG = '#b69368';

        /** 主棋盘区域底色：取 canvas 的 CSS 背景色（--qi-room-board），读取失败退回 #fdcc90 */
        function mainBoardBg() {
            try {
                const el = document.getElementById('goBoard');
                if (el) {
                    const c = getComputedStyle(el).backgroundColor;
                    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
                }
            } catch (e) { /* ignore */ }
            return '#fdcc90';
        }

// ======================== 环面几何 ========================
        /**
         * 每方向总网格 n+2s+2 条线（编号 0..n+2s+1），实际画 1..D（D = n+2s），
         * 最外两条不画；主棋盘 = 线 s+1..s+n；每侧细线固定 s = 4 条。
         * 显示线 ℓ 与主棋盘坐标 t 等价 ⟺ ℓ ≡ t+s+1 (mod n)。
         */
        function computeTorusGeometry(n) {
            const s = 4; // 外围每侧固定 4 条线
            const D = n + 2 * s;
            // 额外留出坐标标签间距（参照原围棋：格线与外框之间留白）
            const padding = 475 / D + 20;
            const cellSize = (600 - 2 * padding) / (D - 1);
            return { boardSize: n, side: s, lines: D, padding, cellSize, half: cellSize / 2 };
        }

        /** 环面坐标 t 在画布上的所有等价显示线（1..D 内） */
        function torusImages(t, n, s, D) {
            const m = t + s + 1;
            const out = [];
            if (m >= 1 && m <= D) out.push(m);
            if (m - n >= 1) out.push(m - n);
            if (m + n <= D) out.push(m + n);
            return out;
        }

        /** 显示线 ℓ → 环面坐标 */
        function displayLineToTorus(ell, n, s) {
            return ((ell - (s + 1)) % n + n) % n;
        }

// ======================== 客户端环面规则（与 games/torus-weiqi.js 一致） ========================
        const torusRules = {
            neighbors(row, col, n) {
                return [
                    [(row - 1 + n) % n, col],
                    [(row + 1) % n, col],
                    [row, (col - 1 + n) % n],
                    [row, (col + 1) % n]
                ];
            },
            countGroupLiberties(board, row, col, n) {
                const color = board[row][col];
                if (color === 0) return 0;
                const visited = Array(n).fill().map(() => Array(n).fill(false));
                const queue = [[row, col]];
                visited[row][col] = true;
                const liberties = new Set();
                while (queue.length) {
                    const [r, c] = queue.shift();
                    for (const [nr, nc] of this.neighbors(r, c, n)) {
                        if (board[nr][nc] === 0) {
                            liberties.add(nr + ',' + nc);
                        } else if (board[nr][nc] === color && !visited[nr][nc]) {
                            visited[nr][nc] = true;
                            queue.push([nr, nc]);
                        }
                    }
                }
                return liberties.size;
            },
            removeGroup(board, row, col, color, n) {
                const queue = [[row, col]];
                board[row][col] = 0;
                while (queue.length) {
                    const [r, c] = queue.shift();
                    for (const [nr, nc] of this.neighbors(r, c, n)) {
                        if (board[nr][nc] === color) {
                            board[nr][nc] = 0;
                            queue.push([nr, nc]);
                        }
                    }
                }
            },
            tryPlaceStone(boardBefore, row, col, playerVal, n) {
                if (boardBefore[row][col] !== 0) return null;
                const newBoard = boardBefore.map(rowArr => rowArr.slice());
                newBoard[row][col] = playerVal;
                const checkedEnemy = new Set();
                for (const [nr, nc] of this.neighbors(row, col, n)) {
                    if (newBoard[nr][nc] === 3 - playerVal) {
                        const key = `${nr},${nc}`;
                        if (!checkedEnemy.has(key)) {
                            checkedEnemy.add(key);
                            if (this.countGroupLiberties(newBoard, nr, nc, n) < 1)
                                this.removeGroup(newBoard, nr, nc, 3 - playerVal, n);
                        }
                    }
                }
                if (this.countGroupLiberties(newBoard, row, col, n) < 1) {
                    this.removeGroup(newBoard, row, col, playerVal, n);
                }
                return newBoard;
            },
            isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, n) {
                for (const [nr, nc] of this.neighbors(libertyRow, libertyCol, n)) {
                    if (board[nr][nc] === opponentColor) return true;
                }
                return false;
            },
            removeDeadAndDying(srcBoard, n, maxWeakLiberties) {
                let boardCopy = srcBoard.map(row => row.slice());
                let changed = true;
                while (changed) {
                    changed = false;
                    const visited = Array(n).fill().map(() => Array(n).fill(false));
                    for (let r = 0; r < n; r++) {
                        for (let c = 0; c < n; c++) {
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
                                    for (const [nr, nc] of this.neighbors(rr, cc, n)) {
                                        if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                        else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                            visited[nr][nc] = true;
                                            queue.push([nr, nc]);
                                            stones.push([nr, nc]);
                                        }
                                    }
                                }
                                if (liberties.size === 0) {
                                    for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                    changed = true;
                                    continue;
                                }
                                if (liberties.size <= maxWeakLiberties) {
                                    let allControlled = true;
                                    for (const lib of liberties) {
                                        const [lr, lc] = lib.split(',').map(Number);
                                        if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, n)) {
                                            allControlled = false;
                                            break;
                                        }
                                    }
                                    if (allControlled) {
                                        for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
                return boardCopy;
            },
            assignTerritoryWithRange(liveBoard, n) {
                const territory = Array(n).fill().map(() => Array(n).fill(0));
                const maxDist = 4;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (liveBoard[r][c] !== 0) continue;
                        let blackMin = Infinity;
                        let whiteMin = Infinity;
                        const dist = Array(n).fill().map(() => Array(n).fill(Infinity));
                        dist[r][c] = 0;
                        const queue = [[r, c]];
                        let front = 0;
                        while (front < queue.length) {
                            const [cr, cc] = queue[front++];
                            const d = dist[cr][cc];
                            if (d > maxDist) continue;
                            if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                            if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                            for (const [nr, nc] of this.neighbors(cr, cc, n)) {
                                if (dist[nr][nc] === Infinity) {
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
        };

// ======================== 配置 ========================
        const ps = {
            BOARD_SIZE: 9,
            KOMI: 2.5,
            PADDING: 0,
            CELL_SIZE: 0,
            TORUS: null,
            numberOfHands: 1,
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastMoveMarkers: [],
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
            hoverCapture: false,
            /** 棋盘局部缩放（与 qi.js QiWeiqiSquarePageRuntime 视口变换配合） */
            viewZoom: 1,
            viewCenterX: 300,
            viewCenterY: 300
        };
        (function initTorusGeometry() {
            ps.TORUS = computeTorusGeometry(ps.BOARD_SIZE);
            ps.PADDING = ps.TORUS.padding;
            ps.CELL_SIZE = ps.TORUS.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            ps.liveOpeningBoard = null;
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

        function ensureTorusGeometry() {
            if (!ps.TORUS || ps.TORUS.boardSize !== ps.BOARD_SIZE) {
                ps.TORUS = computeTorusGeometry(ps.BOARD_SIZE);
            }
            return ps.TORUS;
        }

        /** 显示线 d（1 在底部、D 在顶部）的像素坐标 */
        function lineX(d, g) { return g.padding + (d - 1) * g.cellSize; }
        function lineY(d, g) { return g.padding + (g.lines - d) * g.cellSize; }

        // 手数序号计算（create 后从运行时取得）
        let computeStoneNumbers = () => [];

        function drawBoard() {
            const g = ensureTorusGeometry();
            const n = ps.BOARD_SIZE;
            const s = g.side;
            const D = g.lines;
            const cs = BOARD_VIEW_CS;
            const d = QiSquareWeiqiCanvas.draw;
            d.clear(ctx, cs);
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
            const invZ = useView ? 1 / z : 1;
            const pad = g.padding;
            const cell = g.cellSize;
            const half = g.half;

            // ---- 底色：整盘先铺深色，再在主棋盘区域（含向外半格）盖回原木色 ----
            // 主棋盘区域 = 线 s+1..s+n 向外各半格（9路即 -0.5 路 ~ 9.5 路）。
            // 整盘单次铺深色可避免分块填充在拼缝处出现细线（HiDPI 反锯齿留缝）。
            const mainMinX = lineX(s + 1, g) - half;
            const mainMaxX = lineX(s + n, g) + half;
            const mainMinY = lineY(s + n, g) - half;
            const mainMaxY = lineY(s + 1, g) + half;
            ctx.fillStyle = TORUS_OUTER_BG;
            ctx.fillRect(0, 0, cs, cs);
            // 主棋盘区域盖回原木色；向外扩展 0.5px 覆盖反锯齿缝
            ctx.fillStyle = mainBoardBg();
            ctx.fillRect(
                mainMinX - 0.5, mainMinY - 0.5,
                (mainMaxX - mainMinX) + 1, (mainMaxY - mainMinY) + 1
            );

            // ---- 网格：全部画线向四周多伸半格（最外侧为开口半格），无粗细之分 ----
            const thinLW = Math.max(0.5, 28 / D * invZ);
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = thinLW;
            for (let c = 1; c <= D; c++) {
                ctx.beginPath();
                ctx.moveTo(lineX(c, g), pad - half);
                ctx.lineTo(lineX(c, g), cs - pad + half);
                ctx.stroke();
            }
            for (let r = 1; r <= D; r++) {
                ctx.beginPath();
                ctx.moveTo(pad - half, lineY(r, g));
                ctx.lineTo(cs - pad + half, lineY(r, g));
                ctx.stroke();
            }

            // ---- 坐标：上方字母、左侧数字（参照原围棋；主棋盘外线标等价线号） ----
            const margin = pad - half;
            ctx.font = `bold ${250 / D}px Arial`;
            ctx.fillStyle = '#3a281c';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            for (let c = 1; c <= D; c++) {
                const t = displayLineToTorus(c, n, s);
                const letter = t < 26
                    ? String.fromCharCode(65 + t)
                    : String.fromCharCode(64 + Math.floor(t / 26)) + String.fromCharCode(65 + t % 26);
                ctx.fillText(letter, lineX(c, g), margin * 0.6);
            }
            for (let r = 1; r <= D; r++) {
                const t = displayLineToTorus(r, n, s);
                ctx.fillText(String(t + 1), margin * 0.5, lineY(r, g));
            }

            // ---- 星位（等价位置同时画出） ----
            const stars = QiSquareWeiqiCanvas.getStarPoints(n);
            ctx.fillStyle = '#3a281c';
            for (const [r, c] of stars) {
                for (const rr of torusImages(r, n, s, D)) {
                    for (const cc of torusImages(c, n, s, D)) {
                        ctx.beginPath();
                        ctx.arc(lineX(cc, g), lineY(rr, g), cell * 0.12, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }
            }

            const stoneRadius = cell * 0.44;
            const markLen = cell * 0.352;
            const lowerMarker = ps.showMoveNumbers || ps.showEstimateActive;
            const gloss = 3 * invZ;
            const shInv = invZ > 0 ? invZ : 1;

            // ---- 最后落子标记（棋子之下：显示序号或形势判断时） ----
            if (lowerMarker) {
                for (const m of ps.lastMoveMarkers || []) {
                    if (m.row == null || m.col == null || m.row < 0 || m.row >= n || m.col < 0 || m.col >= n) continue;
                    for (const rr of torusImages(m.row, n, s, D)) {
                        for (const cc of torusImages(m.col, n, s, D)) {
                            const x = lineX(cc, g);
                            const y = lineY(rr, g);
                            ctx.beginPath();
                            ctx.moveTo(x + stoneRadius, y + stoneRadius);
                            ctx.lineTo(x, y + stoneRadius);
                            ctx.lineTo(x + stoneRadius, y);
                            ctx.closePath();
                            ctx.fillStyle = m.color === 2 ? '#222' : '#fff';
                            ctx.fill();
                        }
                    }
                }
            }

            // ---- 棋子（等价位置同时画出） ----
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const val = ps.board[r][c];
                    if (val !== 1 && val !== 2) continue;
                    for (const rr of torusImages(r, n, s, D)) {
                        for (const cc of torusImages(c, n, s, D)) {
                            const x = lineX(cc, g);
                            const y = lineY(rr, g);
                            ctx.save();
                            ctx.shadowBlur = 6 * shInv;
                            ctx.shadowColor = 'rgba(0,0,0,0.5)';
                            ctx.shadowOffsetY = 2 * shInv;
                            const grad = ctx.createRadialGradient(x - gloss, y - gloss, stoneRadius * 0.2, x, y, stoneRadius * 1.2);
                            if (val === 1) {
                                grad.addColorStop(0, '#444');
                                grad.addColorStop(0.6, '#222');
                                grad.addColorStop(1, '#111');
                            } else {
                                grad.addColorStop(0, '#fff');
                                grad.addColorStop(0.5, '#eee');
                                grad.addColorStop(1, '#aaa');
                            }
                            ctx.beginPath();
                            ctx.arc(x, y, stoneRadius, 0, 2 * Math.PI);
                            ctx.fillStyle = grad;
                            ctx.fill();
                            ctx.restore();
                            if (!ps.showMoveNumbers) {
                                ctx.beginPath();
                                ctx.arc(x - gloss, y - gloss, stoneRadius * 0.15, 0, 2 * Math.PI);
                                ctx.fillStyle = val === 1 ? '#444' : '#fff';
                                ctx.fill();
                            }
                        }
                    }
                }
            }

            // ---- 最后落子标记（棋子之上） ----
            if (!lowerMarker) {
                for (const m of ps.lastMoveMarkers || []) {
                    if (m.row == null || m.col == null || m.row < 0 || m.row >= n || m.col < 0 || m.col >= n) continue;
                    for (const rr of torusImages(m.row, n, s, D)) {
                        for (const cc of torusImages(m.col, n, s, D)) {
                            const x = lineX(cc, g);
                            const y = lineY(rr, g);
                            ctx.beginPath();
                            ctx.moveTo(x, y);
                            ctx.lineTo(x + markLen, y);
                            ctx.lineTo(x, y + markLen);
                            ctx.closePath();
                            ctx.fillStyle = m.color === 2 ? '#222' : '#fff';
                            ctx.fill();
                        }
                    }
                }
            }

            // ---- 用户标记（等价位置同时画出） ----
            const marksVisible = !ps.showEstimateActive;
            for (const key of Object.keys(ps.userBoardMarks || {})) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= n || c < 0 || c >= n) continue;
                if (!marksVisible) continue;
                if (ps.board[r][c] !== 0) continue;
                const ch = ps.userBoardMarks[key];
                for (const rr of torusImages(r, n, s, D)) {
                    for (const cc of torusImages(c, n, s, D)) {
                        const x = lineX(cc, g);
                        const y = lineY(rr, g);
                        ctx.beginPath();
                        ctx.arc(x, y, cell * 0.3, 0, 2 * Math.PI);
                        // 背景色随所在区域：主棋盘区域内用棋盘底色，外围用深色
                        const inMain = x >= mainMinX && x <= mainMaxX && y >= mainMinY && y <= mainMaxY;
                        ctx.fillStyle = inMain ? mainBoardBg() : TORUS_OUTER_BG;
                        ctx.fill();
                        const fontPx = cell * (ch === '🚩' ? 0.6 : 0.66);
                        ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = '#3a281c';
                        ctx.fillText(ch, x, y + 1);
                    }
                }
            }

            // ---- 手数序号 ----
            if (ps.showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (nums[r][c] > 0 && ps.board[r][c] !== 0) {
                            const numStr = String(nums[r][c]);
                            const fontSize = Math.max(9, Math.floor(cell * (numStr.length >= 3 ? 0.34 : 0.44)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = ps.board[r][c] === 1 ? '#fff' : '#000';
                            for (const rr of torusImages(r, n, s, D)) {
                                for (const cc of torusImages(c, n, s, D)) {
                                    ctx.fillText(numStr, lineX(cc, g), lineY(rr, g) + 1);
                                }
                            }
                        }
                    }
                }
            }

            // ---- 悬停预览（等价位置同时画出） ----
            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            const editModeOn = !!(ps.editModeEnabled || (editCb && editCb.checked));
            const canHover = editModeOn || ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn);
            const hr = ps.hoverRow;
            const hc = ps.hoverCol;
            if (canHover && hr >= 0 && hc >= 0 && hr < n && hc < n && ps.isHoverValid) {
                let hoverColor = null;
                if (editModeOn) {
                    const tool = (ps.editTool != null ? ps.editTool : (editSel && editSel.value)) || 'empty';
                    if (tool === 'white') hoverColor = '#fff';
                    else if (tool === 'black') hoverColor = '#222';
                    else if (tool !== 'empty') hoverColor = '#666';
                } else if (ps.board[hr][hc] === 0 && !ps.hoverCapture) {
                    hoverColor = ps.tryPlayMode
                        ? (ps.tryPlayCurrentPlayer === 1 ? '#222' : '#fff')
                        : (ps.mySlot === 'player1' ? '#222' : '#fff');
                }
                if (hoverColor) {
                    ctx.globalAlpha = 0.45;
                    for (const rr of torusImages(hr, n, s, D)) {
                        for (const cc of torusImages(hc, n, s, D)) {
                            ctx.beginPath();
                            ctx.arc(lineX(cc, g), lineY(rr, g), stoneRadius, 0, 2 * Math.PI);
                            ctx.fillStyle = hoverColor;
                            ctx.fill();
                        }
                    }
                    ctx.globalAlpha = 1.0;
                }
            }

            // ---- 提子悬停红圈 ----
            if (ps.hoverCapture && ps.isHoverValid && hr >= 0 && hc >= 0 && hr < n && hc < n
                && (ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn))) {
                ctx.save();
                ctx.strokeStyle = '#d62828';
                ctx.lineWidth = cell * 0.055 * invZ;
                for (const rr of torusImages(hr, n, s, D)) {
                    for (const cc of torusImages(hc, n, s, D)) {
                        ctx.beginPath();
                        ctx.arc(lineX(cc, g), lineY(rr, g), stoneRadius + 1, 0, 2 * Math.PI);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }

            // ---- 形势判断叠加层（死子/归属小方块，等价位置同时画出） ----
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                const dotRadius = cell * 0.18;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        let style = null;
                        if ((ps.board[r][c] === 1 || ps.board[r][c] === 2) && ps.cachedLiveBoard[r][c] === 0)
                            style = ps.board[r][c] === 1 ? '#fff' : '#222';
                        else if (ps.board[r][c] === 0 && ps.cachedTerritory[r][c] === 1)
                            style = '#222';
                        else if (ps.board[r][c] === 0 && ps.cachedTerritory[r][c] === 2)
                            style = '#f0f0f0';
                        if (!style) continue;
                        ctx.fillStyle = style;
                        for (const rr of torusImages(r, n, s, D)) {
                            for (const cc of torusImages(c, n, s, D)) {
                                ctx.fillRect(
                                    lineX(cc, g) - dotRadius, lineY(rr, g) - dotRadius,
                                    dotRadius * 2, dotRadius * 2
                                );
                            }
                        }
                    }
                }
            }

            if (useView) ctx.restore();
            syncScrollbarsFromView();
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
        // 形势判断：Benson 加成（环面邻接）
        function bensonTorusInfo(bd) {
            const RT = window.QiWeiqiSquarePageRuntime;
            const size = ps.BOARD_SIZE;
            return RT.bensonAliveGrid({
                width: size, height: size,
                getNeighbors: (r, c) => torusRules.neighbors(r, c, size),
                isValid: () => true,
                get: (r, c) => bd[r][c]
            });
        }
        function bensonTorusLive(srcBoard) {
            const size = ps.BOARD_SIZE;
            const benson = bensonTorusInfo(srcBoard);
            let live = srcBoard.map((row) => row.slice());
            let changed = true;
            while (changed) {
                changed = false;
                const cleaned = torusRules.removeDeadAndDying(live, size, 2);
                for (let r = 0; r < size; r++) {
                    for (let c = 0; c < size; c++) {
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
        function bensonTorusTerritory(liveBoard) {
            const size = ps.BOARD_SIZE;
            const territory = torusRules.assignTerritoryWithRange(liveBoard, size);
            const secure = bensonTorusInfo(liveBoard);
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
                }
            }
            return territory;
        }
        
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: false,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            tryPlaceStone: (b, r, c, v) => torusRules.tryPlaceStone(b, r, c, v, ps.BOARD_SIZE),
            removeDeadAndDying: bensonTorusLive,
            assignTerritoryWithRange: bensonTorusTerritory,
            drawBoard
        });
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
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
            rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard,
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            syncState: runtimeSyncState,
            commitMove,
            canvasCoordsFromClient,
            boardScreenPointFromClient,
            applyUserBoardMark
        } = page;
        computeStoneNumbers = page.computeStoneNumbers;

        // ---- 环面取点：显示线 → 主棋盘坐标（只记录主棋盘坐标） ----
        function getClosestIntersection(x, y) {
            const g = ensureTorusGeometry();
            const n = ps.BOARD_SIZE;
            const s = g.side;
            const D = g.lines;
            const colD = Math.round((x - g.padding) / g.cellSize) + 1;
            const rowD = D - Math.round((y - g.padding) / g.cellSize);
            if (rowD < 1 || rowD > D || colD < 1 || colD > D) return { row: -1, col: -1 };
            return {
                row: displayLineToTorus(rowD, n, s),
                col: displayLineToTorus(colD, n, s)
            };
        }

        // ---- 棋盘尺寸变化：重算环面几何 ----
        function updateBoardGeometry() {
            ensureTorusGeometry();
            ps.PADDING = ps.TORUS.padding;
            ps.CELL_SIZE = ps.TORUS.cellSize;
            if (typeof ps.viewZoom === 'number' && ps.viewZoom > 1) {
                ps.viewZoom = 1;
                ps.viewCenterX = BOARD_VIEW_CS / 2;
                ps.viewCenterY = BOARD_VIEW_CS / 2;
            }
            drawBoard();
            if (komiInfo) QiWeiqiSquarePageRuntime.writeKomiInfoText(komiInfo, ps.KOMI, ps.BOARD_SIZE * ps.BOARD_SIZE);
        }

        // ---- 棋盘编辑 UI（环面取点；编辑棋盘同样只含主棋盘坐标） ----
        let editApi = null;
        if (QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'grid2d',
                editTools: [
                    { value: 'empty', label: '空' },
                    { value: 'black', label: '黑子' },
                    { value: 'white', label: '白子' }
                ],
                deepCopyBoard: (b) => b.map(row => row.slice()),
                drawBoard,
                emptyBoard: () => QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE),
                pickAtClient(clientX, clientY) {
                    const p = canvasCoordsFromClient(clientX, clientY);
                    return getClosestIntersection(p.x, p.y);
                },
                syncLiveOpening: true
            });
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
                if (editApi && editApi.clearEditModeUi) editApi.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard: drawBoardCore,
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
            syncState(state) {
                runtimeSyncState(state);
                if (editApi) {
                    if (editApi.updateEditModeUI) editApi.updateEditModeUI();
                    if (editApi.restoreLocalEditAfterSync) editApi.restoreLocalEditAfterSync();
                    if (state && state.type === 'editBoardAccepted' && editApi.noteEditBoardAccepted)
                        editApi.noteEditBoardAccepted(state);
                }
            },
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
            onBoardSizeChanged(msg) {
                if (!msg.boardSize) return;
                if (msg.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = msg.boardSize;
                    ps.board = QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
                }
                updateBoardGeometry();
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = String(msg.boardSize);
            },
            onSeatOverlayUpdated({ visible }) {
                if (visible && ps.viewZoom > 1) resetBoardViewZoom();
            }
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
            const g = ensureTorusGeometry();
            // 以主棋盘位置为中心（等价位置在主棋盘 ±n 处）
            ps.viewCenterX = g.padding + (m.col + g.side) * g.cellSize;
            ps.viewCenterY = g.padding + (g.lines - 1 - (m.row + g.side)) * g.cellSize;
            clampBoardView();
            drawBoardCore();
        }

        function handleMessage(msg) {
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
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
                if (ps.board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        drawBoardCore();
                    }
                    return;
                }
                tryPlayMove(row, col);
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
            if (ps.board[row][col] !== 0) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoardCore();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoardCore();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (boardMousePanning) return;
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoardCore(); }
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
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
