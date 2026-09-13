window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["weight-weiqi"] = {
    shell: {
        "title": "权重围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每个格有不同的权重，在数点时算作对应的点数。<br /><br />请在格中落子。<br />",
        "defaultKomiText": "黑贴白1048点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "权重围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "权重围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const C = QiSquareWeiqiCanvas;

        const ps = {
            boardSize: 19,
            KOMI: 1048,
            PADDING: 0,
            CELL_SIZE: 0,
            board: [],
            weights: [],
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
            isHoverValid: false
        };
        (function initSquareGeometry() {
            const n = ps.BOARD_SIZE;
            const padding = 63 - 2 * n;
            const cellSize = (600 - 2 * padding) / n;
            ps.PADDING = padding;
            ps.CELL_SIZE = cellSize;
            ps.board = C.initBoardArray(n);
            ps.weights = C.initBoardArray(n);
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

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
        const komiInfo = document.getElementById('komiInfo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        C.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        C.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        function normalizeReplayInitialPayload(initialPosition) {
            if (!initialPosition) return [];
            if (Array.isArray(initialPosition)) return initialPosition;
            if (typeof initialPosition !== 'object') return [];
            const out = [];
            for (const pos of initialPosition.black || []) {
                if (Array.isArray(pos) && pos.length === 2) out.push(`B${pos[0]},${pos[1]}`);
            }
            for (const pos of initialPosition.white || []) {
                if (Array.isArray(pos) && pos.length === 2) out.push(`W${pos[0]},${pos[1]}`);
            }
            return out;
        }

        function normalizeWeightMatrix(rawWeights, boardSize) {
            const normalized = C.initBoardArray(boardSize);
            if (!Array.isArray(rawWeights)) return normalized;
            for (let r = 0; r < boardSize; r++) {
                if (!Array.isArray(rawWeights[r])) continue;
                for (let c = 0; c < boardSize; c++) {
                    const value = rawWeights[r][c];
                    if (Number.isFinite(value)) normalized[r][c] = value;
                }
            }
            return normalized;
        }

        function safeWeightAt(weights, r, c) {
            const row = Array.isArray(weights) ? weights[r] : null;
            const value = Array.isArray(row) ? row[c] : 0;
            return Number.isFinite(value) ? value : 0;
        }

        function weightedComputeScore(liveBoard, territory) {
            const n = ps.BOARD_SIZE;
            let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const weight = safeWeightAt(ps.weights, r, c);
                    if (liveBoard[r][c] === 1) blackStones += weight;
                    else if (liveBoard[r][c] === 2) whiteStones += weight;
                    else if (liveBoard[r][c] === 0) {
                        if (territory[r][c] === 1) blackTerritory += weight;
                        else if (territory[r][c] === 2) whiteTerritory += weight;
                        else if (territory[r][c] === 3) publicTerritory += weight;
                    }
                }
            }
            const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
            const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
            return { blackTotal, whiteTotal };
        }

        function drawBoardWeight() {
            const boardSize = ps.BOARD_SIZE;
            const PADDING = ps.PADDING;
            const CELL_SIZE = ps.CELL_SIZE;
            const board = ps.board;
            const weights = ps.weights;
            function isUserBoardMarkVisibleAt(r, c) {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return false;
                if (board[r][c] !== 0) return false;
                return true;
            }
            function computeStoneNumbers() {
                const nums = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
                if (ps.replayMode && ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const markers = ps.tryPlayMarkers[i];
                        if (markers && markers.length > 0) {
                            const m = markers[0];
                            if (m.row < boardSize && m.col < boardSize && board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = i;
                        }
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const markers = ps.replayMarkers[i];
                        if (markers && markers.length > 0) {
                            const m = markers[0];
                            if (m.row < boardSize && m.col < boardSize && board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = i;
                        }
                    }
                } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                    for (let i = 1; i <= ps.liveViewStep; i++) {
                        const markers = ps.liveReplayMarkers[i];
                        if (markers && markers.length > 0) {
                            const m = markers[0];
                            if (m.row < boardSize && m.col < boardSize && board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = i;
                        }
                    }
                } else {
                    for (let i = 0; i < ps.moveLog.length; i++) {
                        const m = ps.moveLog[i];
                        if (m && m.row < boardSize && m.col < boardSize && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i + 1;
                    }
                }
                return nums;
            }

            ctx.clearRect(0, 0, 600, 600);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#3a281c';
            for (let i = 0; i <= boardSize; i++) {
                ctx.beginPath();
                ctx.moveTo(PADDING + i * CELL_SIZE, PADDING);
                ctx.lineTo(PADDING + i * CELL_SIZE, 600 - PADDING);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(PADDING, PADDING + i * CELL_SIZE);
                ctx.lineTo(600 - PADDING, PADDING + i * CELL_SIZE);
                ctx.stroke();
            }

            const totalCells = boardSize * boardSize;
            // 高权重格着色:默认涂最高的 ceil(N²/4) 格(权重/角重);心重涂 floor(N²/4) 格。
            // 阈值 = N² − 涂色格数,判 > 阈值。池子子类(二/三权重)走各自分支,不受此影响。
            const shadedCount = currentSubGame === 'centre-focused-weiqi'
                ? Math.floor(totalCells / 4)
                : Math.ceil(totalCells / 4);
            const highWeightThresh = totalCells - shadedCount;
            if (!ps.showEstimateActive) {
                if (WEIGHT_ARRANGEMENTS.includes(currentSubGame)) {
                    // 排列型(权重/角重/心重,1..N²):高权重格着色(张数见 shadedCount)
                    for (let r = 0; r < boardSize; r++) {
                        for (let c = 0; c < boardSize; c++) {
                            if (safeWeightAt(weights, r, c) > highWeightThresh) {
                                ctx.fillStyle = 'rgba(208, 144, 64, 0.8)';
                                ctx.fillRect(1 + PADDING + c * CELL_SIZE, 1 + PADDING + (boardSize - 1 - r) * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
                            }
                        }
                    }
                }
				else if (currentSubGame === 'biweight-weiqi' || currentSubGame === 'triweight-weiqi')
				{
                    const wc = { 2: 'rgba(224, 128, 96, 0.8)', 3: 'rgba(192, 48, 32, 0.8)'};
                    for (let r = 0; r < boardSize; r++) {
                        for (let c = 0; c < boardSize; c++) {
                            const w = safeWeightAt(weights, r, c);
                            if (w >= 2 && w <= 3) {
                                ctx.fillStyle = wc[w];
                                ctx.fillRect(1 + PADDING + c * CELL_SIZE, 1 + PADDING + (boardSize - 1 - r) * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
                            }
                        }
                    }
                }
            }

            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                for (let r = 0; r < boardSize; r++) {
                    for (let c = 0; c < boardSize; c++) {
                        if (board[r][c] !== 0) continue;
                        const t = ps.cachedTerritory[r][c];
                        if (t === 1) {
                            ctx.fillStyle = '#000';
                            ctx.fillRect(1 + PADDING + c * CELL_SIZE, 1 + PADDING + (boardSize - 1 - r) * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
                        } else if (t === 2) {
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(1 + PADDING + c * CELL_SIZE, 1 + PADDING + (boardSize - 1 - r) * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
                            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(1 + PADDING + c * CELL_SIZE, 1 + PADDING + (boardSize - 1 - r) * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
                        }
                    }
                }
            }

            ctx.font = `bold ${17 - 0.2 * boardSize}px Arial`;
            ctx.fillStyle = '#3a281c';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let c = 0; c < boardSize; c++) {
                const letter = String.fromCharCode(65 + c);
                const x = PADDING + c * CELL_SIZE + CELL_SIZE / 2;
                const y = 0.6 * PADDING;
                ctx.fillText(letter, x, y);
            }
            for (let r = 0; r < boardSize; r++) {
                // 左侧坐标自下而上递增：底部为 1、顶部为 boardSize
                const number = (r + 1).toString();
                const x = 0.5 * PADDING;
                const y = PADDING + (boardSize - 1 - r) * CELL_SIZE + CELL_SIZE / 2;
                ctx.fillText(number, x, y);
            }

            const stoneRadius = CELL_SIZE * 0.38;
            for (let { row, col, color } of ps.lastMoveMarkers) {
                const x = PADDING + col * CELL_SIZE + CELL_SIZE / 2;
                const y = PADDING + (boardSize - 1 - row) * CELL_SIZE + CELL_SIZE / 2;
                ctx.beginPath();
                ctx.moveTo(x + stoneRadius, y + stoneRadius);
                ctx.lineTo(x, y + stoneRadius);
                ctx.lineTo(x + stoneRadius, y);
                ctx.closePath();
                ctx.fillStyle = color === 1 ? '#fff' : '#222';
                ctx.fill();
            }

            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = board[r][c];
                    if (val === 0) continue;
                    const x = PADDING + c * CELL_SIZE + CELL_SIZE / 2;
                    const y = PADDING + (boardSize - 1 - r) * CELL_SIZE + CELL_SIZE / 2;
                    const radius = stoneRadius;
                    ctx.save();
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowOffsetY = 2;
                    const grad = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
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
                    ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    ctx.restore();
                    if (!ps.showMoveNumbers) {
                        ctx.beginPath();
                        ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                        ctx.fillStyle = val === 1 ? '#444' : '#fff';
                        ctx.fill();
                    }
                }
            }

            // 权重数字:排列型(权重/角重/心重,1..N²)逐格显示;
            // 池子子类(二/三权重):格子只有颜色填充,不画数字
            if (!ps.showMoveNumbers && WEIGHT_ARRANGEMENTS.includes(currentSubGame)) {
                for (let r = 0; r < boardSize; r++) {
                    for (let c = 0; c < boardSize; c++) {
                        const val = board[r][c];
                        const w = safeWeightAt(weights, r, c);
                        if (w === 0)
                            continue;
                        const mk = r + ',' + c;
                        if (ps.userBoardMarks[mk] !== undefined && isUserBoardMarkVisibleAt(r, c)) continue;
                        ctx.font = `bold ${Math.floor(CELL_SIZE * 0.35)}px Arial`;
                        
                        const x = PADDING + c * CELL_SIZE + 0.5 * CELL_SIZE;
                        const y = PADDING + (boardSize - 1 - r) * CELL_SIZE + 0.5 * CELL_SIZE;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        if (ps.showEstimateActive && ps.cachedTerritory && val === 0) {
                            const t = ps.cachedTerritory[r][c];
                            if (t === 1) ctx.fillStyle = '#fff';
                            else if (t === 2) ctx.fillStyle = '#111';
                            else ctx.fillStyle = '#2c1f15';
                        } else {
                            ctx.fillStyle = '#2c1f15';
                            if (val === 1) ctx.fillStyle = '#fff';
                            else if (val === 2) ctx.fillStyle = '#444';
                        }
                        ctx.fillText(w.toString(), x, y);
                    }
                }
            }

            for (const key of Object.keys(ps.userBoardMarks)) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (!isUserBoardMarkVisibleAt(r, c)) continue;
                const ch = ps.userBoardMarks[key];
                const x = PADDING + c * CELL_SIZE + CELL_SIZE / 2;
                const y = PADDING + (boardSize - 1 - r) * CELL_SIZE + CELL_SIZE / 2;
                const fontPx = CELL_SIZE * (ch === '🚩' ? 0.6 : 0.66);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }

            if (ps.showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < boardSize; r++) {
                    for (let c = 0; c < boardSize; c++) {
                        if (nums[r][c] > 0 && board[r][c] !== 0) {
                            const sx = PADDING + c * CELL_SIZE + CELL_SIZE / 2;
                            const sy = PADDING + (boardSize - 1 - r) * CELL_SIZE + CELL_SIZE / 2;
                            const numStr = nums[r][c].toString();
                            const fontSize = Math.max(9, Math.floor(CELL_SIZE * (numStr.length >= 3 ? 0.308 : 0.396)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                            ctx.fillText(numStr, sx, sy + 1);
                        }
                    }
                }
            }

            const editing = !!ps.editModeEnabled;
            const canHover = editing || ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn);
            if (canHover && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0
                && (editing || board[ps.hoverRow][ps.hoverCol] === 0)) {
                let hoverColor = null;
                if (editing) {
                    const t = ps.editTool || 'empty';
                    if (t === 'white') hoverColor = '#fff';
                    else if (t === 'black') hoverColor = '#222';
                    else if (t !== 'empty') hoverColor = '#666';
                } else {
                    hoverColor = ps.tryPlayMode ? (ps.tryPlayCurrentPlayer === 1 ? '#222' : '#ddd')
                        : (ps.mySlot === 'player1' ? '#222' : '#ddd');
                }
                if (hoverColor) {
                    ctx.globalAlpha = 0.45;
                    const x = PADDING + ps.hoverCol * CELL_SIZE + CELL_SIZE / 2;
                    // 行 0 在底：悬停 y 需与落子/棋子绘制同一反转，否则悬停显示到上下对称格
                    const y = PADDING + (ps.BOARD_SIZE - 1 - ps.hoverRow) * CELL_SIZE + CELL_SIZE / 2;
                    ctx.beginPath();
                    ctx.arc(x, y, CELL_SIZE * 0.38, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }

            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                const half = CELL_SIZE * 0.22;
                ctx.strokeStyle = '#c62828';
                ctx.lineWidth = Math.max(1.2, CELL_SIZE * 0.06);
                ctx.lineCap = 'round';
                for (let r = 0; r < boardSize; r++) {
                    for (let c = 0; c < boardSize; c++) {
                        if (board[r][c] !== 0 && ps.cachedLiveBoard[r][c] === 0) {
                            const x = PADDING + c * CELL_SIZE + CELL_SIZE / 2;
                            const y = PADDING + (boardSize - 1 - r) * CELL_SIZE + CELL_SIZE / 2;
                            ctx.beginPath();
                            ctx.moveTo(x - half, y - half);
                            ctx.lineTo(x + half, y + half);
                            ctx.moveTo(x + half, y - half);
                            ctx.lineTo(x - half, y + half);
                            ctx.stroke();
                        }
                    }
                }
            }
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

        // 权重围棋家族(主棋类 weight-weiqi,subGameId 区分子棋类):
        // weight-weiqi:1..N² 随机排列;角重/心重:1..N² 固定排布;二/三权重:每点按权重池独立随机。
        // 贴目:排列型用原公式,池子子类用固定值。
        const WEIGHT_SUB_GAMES = ['weight-weiqi', 'biweight-weiqi', 'triweight-weiqi', 'corner-focused-weiqi', 'centre-focused-weiqi'];
        const WEIGHT_ARRANGEMENTS = ['weight-weiqi', 'corner-focused-weiqi', 'centre-focused-weiqi'];   // 逐格显示权重数字(1..N²)的排布型
        const WEIGHT_SUB_POOLS = {
            'biweight-weiqi': [1, 1, 2],
            'triweight-weiqi': [1, 1, 1, 1, 2, 2, 3]
        };
        const WEIGHT_FIXED_KOMI = {
            'biweight-weiqi': 5.25, 'triweight-weiqi': 6.25
        };
        let currentSubGame = 'weight-weiqi';
        // 计分总点数(weight-weiqi 排列的闭式,Σ1..N²)
        function weightScoreTotalPoints(n) {
            return n * n * (n * n + 1) / 2;
        }
        // 当前权重表实际求和(komiInfo 辅助文本用)
        function weightsTotalNow() {
            let sum = 0;
            const w = ps.weights;
            for (let r = 0; r < w.length; r++) {
                const row = w[r];
                if (!row) continue;
                for (let c = 0; c < row.length; c++) sum += Number(row[c]) || 0;
            }
            return sum;
        }
        // 子棋类贴目:固定值;weight-weiqi 沿用原公式
        function weightKomiForSize(n) {
            const f = WEIGHT_FIXED_KOMI[currentSubGame];
            if (f != null) return f;
            return Math.floor(0.008 * (1 + n * n) * n * n);
        }
        // 固定排布(角重/心重):与服务器 generateFixedWeights 一致——先按屏幕方向排,
        // 再换算到站点坐标(row 0 = 屏幕最下面一行)
        function genFixedWeightsLocal(n, kind) {
            const disp = Array.from({ length: n }, () => new Array(n).fill(0));
            if (kind === 'corner') {
                const cells = [];
                for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) cells.push([dr, dc]);
                cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[0] - b[0]);
                cells.forEach(([dr, dc], k) => { disp[dr][dc] = k + 1; });
            } else {
                let top = 0, bottom = n - 1, left = 0, right = n - 1, k = 1;
                while (top <= bottom && left <= right) {
                    for (let dc = left; dc <= right; dc++) disp[top][dc] = k++;
                    top++;
                    for (let dr = top; dr <= bottom; dr++) disp[dr][right] = k++;
                    right--;
                    if (top <= bottom) { for (let dc = right; dc >= left; dc--) disp[bottom][dc] = k++; bottom--; }
                    if (left <= right) { for (let dr = bottom; dr >= top; dr--) disp[dr][left] = k++; left++; }
                }
            }
            const out = Array.from({ length: n }, () => new Array(n).fill(0));
            for (let dr = 0; dr < n; dr++) {
                for (let dc = 0; dc < n; dc++) out[n - 1 - dr][dc] = disp[dr][dc];
            }
            return out;
        }
        // 本地生成权重(乐观切换用,与服务器一致)
        function genWeightsLocal(n) {
            if (currentSubGame === 'corner-focused-weiqi') return genFixedWeightsLocal(n, 'corner');
            if (currentSubGame === 'centre-focused-weiqi') return genFixedWeightsLocal(n, 'center');
            const pool = WEIGHT_SUB_POOLS[currentSubGame];
            const out = Array.from({ length: n }, () => new Array(n).fill(0));
            if (!pool) {
                const total = n * n;
                const arr = Array.from({ length: total }, (_, i) => i + 1);
                for (let i = arr.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
                }
                let idx = 0;
                for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r][c] = arr[idx++];
                return out;
            }
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) out[r][c] = pool[Math.floor(Math.random() * pool.length)];
            }
            return out;
        }
        function refreshKomiInfoLocal() {
            if (!komiInfo) return;
            komiInfo.innerText = QiWeiqiSquarePageRuntime.formatKomiInfoText(
                weightKomiForSize(ps.BOARD_SIZE), weightsTotalNow() || weightScoreTotalPoints(ps.BOARD_SIZE));
        }
        function syncSubGameSelect() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            sel.value = currentSubGame;
            sel.disabled = (ps.numberOfHands || 1) > 1 || !!ps.matchStarted || !!ps.gameOver;
        }
        ps.KOMI = weightKomiForSize(ps.BOARD_SIZE);

                // 标准/变体围棋形势判断：Benson 无条件活加成（保活 + 确定领地覆盖）
        function bensonRemoveDead(srcBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            const size = ps.BOARD_SIZE;
            const copy = (b) => QiSquareWeiqiCanvas.deepCopyBoard(b);
            const benson = RT.bensonAlive(srcBoard, size);
            let live = copy(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                const cleaned = RT.removeDeadAndDying(live, size, copy, 2);
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
        function bensonTerritory(liveBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            const size = ps.BOARD_SIZE;
            const territory = RT.assignTerritoryWithRange(liveBoard, size);
            const secure = RT.bensonAlive(liveBoard, size);
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
                }
            }
            return territory;
        }

const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            removeDeadAndDying: bensonRemoveDead,
            editPickCell: true,   // 棋子落在格内：编辑点击/悬停按格子命中（公共运行时据此处理）
            assignTerritoryWithRange: bensonTerritory,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            drawBoard: drawBoardWeight,
            totalPoints: (p) => p.BOARD_SIZE * p.BOARD_SIZE,
            totalScorePoints: (p) => weightScoreTotalPoints(p.BOARD_SIZE)});

        function applyWeightSyncExtras(state) {
            const n = ps.BOARD_SIZE;
            if (state && WEIGHT_SUB_GAMES.includes(state.subGameId)) currentSubGame = state.subGameId;
            ps.weights = normalizeWeightMatrix(state.weights || ps.weights, n);
            if (state && typeof state.komi === 'number' && Number.isFinite(state.komi)) ps.KOMI = state.komi;
            else ps.KOMI = weightKomiForSize(n);
            syncSubGameSelect();
        }

        page.updateBoardGeometry = function weightSquareCellGeometry() {
            const n = ps.BOARD_SIZE;
            const padding = 63 - 2 * n;
            ps.PADDING = padding;
            ps.CELL_SIZE = (600 - 2 * padding) / n;
            page.drawBoard();

            refreshKomiInfoLocal();
        };

        const _wSyncState = page.syncState;
        page.syncState = function weightSyncState(state) {
            const incomingSize = Number.isInteger(state.boardSize) ? state.boardSize : ps.BOARD_SIZE;
            ps.weights = normalizeWeightMatrix(state.weights || ps.weights, incomingSize);
            _wSyncState(state);
            applyWeightSyncExtras(state);
            const n = ps.BOARD_SIZE;
            ps.PADDING = 63 - 2 * n;
            ps.CELL_SIZE = (600 - 2 * ps.PADDING) / n;
            page.drawBoard();
        };

        page.showEstimate = function weightShowEstimate() {
            if (!ps.showEstimateActive) {
                page.clearEstimate();
                return;
            }
            if (ps.ws && ps.ws.readyState === WebSocket.OPEN && !ps.replayMode && !ps.tryPlayMode) {
                ps.ws.send(JSON.stringify({ type: 'estimate' }));
                return;
            }
            const r = C.computeWeiqiEstimateCaches(
                ps.board, page.removeDeadAndDying, page.assignTerritoryWithRange, weightedComputeScore, ps.KOMI
            );
            ps.cachedLiveBoard = r.cachedLiveBoard;
            ps.cachedTerritory = r.cachedTerritory;
            C.fillWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo, r.blackTotal, r.whiteTotal, r.lead);
            page.drawBoard();
        };

        const _wEnterReplay = page.enterReplayMode;
        page.enterReplayMode = function weightEnterReplay(data) {
            ps.weights = (data.weights || ps.weights).map(row => row.slice());
            if (data.initialPosition && typeof data.initialPosition === 'object' && !Array.isArray(data.initialPosition))
                data.initialPosition = normalizeReplayInitialPayload(data.initialPosition);
            _wEnterReplay(data);
        };

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard,
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
            updateBoardGeometry,
            syncState,
            commitMove,
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        function updateEstimate(msg) {
            ps.cachedLiveBoard = msg.liveBoard;
            ps.cachedTerritory = msg.territory;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${Number(msg.blackTotal.toFixed(2))}　白: ${Number(msg.whiteTotal.toFixed(2))}`;
            leadInfo.innerText = `黑${msg.lead >= 0 ? '+' : ''}${msg.lead.toFixed(1)}点`;
            drawBoard();
        }

        function getClosestCell(x, y) {
            let minDist = Infinity, bestR = -1, bestC = -1;
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    const cx = ps.PADDING + c * ps.CELL_SIZE + ps.CELL_SIZE / 2;
                    const cy = ps.PADDING + (ps.BOARD_SIZE - 1 - r) * ps.CELL_SIZE + ps.CELL_SIZE / 2;
                    const d = Math.hypot(x - cx, y - cy);
                    if (d < minDist) { minDist = d; bestR = r; bestC = c; }
                }
            }
            return { row: bestR, col: bestC };
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard,
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
            timeControlMainByoScale: 1.5
        });

        function handleMessage(msg) {
            if (msg.type === 'estimateResult') {
                updateEstimate(msg);
                return;
            }
            _weiqiBindings.handleMessage(msg);
            if (msg && msg.type === 'subGameChanged') {
                if (WEIGHT_SUB_GAMES.includes(msg.subGameId)) currentSubGame = msg.subGameId;
                const n = ps.BOARD_SIZE;
                ps.weights = normalizeWeightMatrix(msg.weights || ps.weights, n);
                if (typeof msg.komi === 'number' && Number.isFinite(msg.komi)) ps.KOMI = msg.komi;
                syncSubGameSelect();
                refreshKomiInfoLocal();
                drawBoard();
            }
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
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestCell(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
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
                        drawBoard();
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
                drawBoard();
                return;
            }
            if (ps.board[row][col] !== 0) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestCell(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0
                    && (ps.editModeEnabled || ps.board[row][col] === 0));
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    drawBoard();
                }
            });
        }

        if (scoreConfirmYes) {
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
        // 子棋类选择器(权重/二权重/三权重/角重/心重围棋)
        const subGameSelectEl = document.getElementById('subGameSelect');
        if (subGameSelectEl) {
            subGameSelectEl.innerHTML = '';
            const subOpts = [
                { value: 'weight-weiqi', label: '权重' },
                { value: 'biweight-weiqi', label: '二权重' },
                { value: 'triweight-weiqi', label: '三权重' },
                { value: 'corner-focused-weiqi', label: '角重' },
                { value: 'centre-focused-weiqi', label: '心重' }
            ];
            for (const o of subOpts) {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                subGameSelectEl.appendChild(opt);
            }
            subGameSelectEl.style.display = 'inline-block';
            subGameSelectEl.addEventListener('change', () => {
                const v = subGameSelectEl.value;
                if (!v || v === currentSubGame) return;
                // 乐观切换:本地立即生成权重/贴目并重绘;服务器 subGameChanged 回来校正
                currentSubGame = v;
                ps.weights = genWeightsLocal(ps.BOARD_SIZE);
                ps.KOMI = weightKomiForSize(ps.BOARD_SIZE);
                refreshKomiInfoLocal();
                if (ps.ws && ps.ws.readyState === 1)
                    ps.ws.send(JSON.stringify({ type: 'setSubGame', subGameId: v }));
                drawBoard();
            });
        }

        connectWebSocket(handleMessage);
        })();
    }
};
