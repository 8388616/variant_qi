window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["fog-weiqi"] = {
    shell: {
        "title": "迷雾围棋",
        "rulesHtml": "基本规则同围棋。<br /><br /><strong>棋盘笼罩迷雾</strong>：每个棋子可以提供3×3范围内的视野。<br /><br />在迷雾中点到对方子则落子失败，可另选点。<br /><br />棋子被提时失去视野。<br /><br />观战者仅能看到双方视野的交集。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "迷雾围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "replayPerspective": true
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "迷雾围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const Q = QiWeiqiSquarePageRuntime;
        const C = QiSquareWeiqiCanvas;

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
            showEstimateActive: false,
            cachedLiveBoard: null,
            cachedTerritory: null,
            waitingScoreConfirm: false,
            iRejected: false,
            ws: null,
            isMyTurn: false,
            slots: { black: false, white: false },
            reconnectTimer: null,
            replayMode: false,
            replayBoards: [],
            replayTruthBoards: [],
            replayMarkers: [],
            replayStepPlayers: [],
            replayStep: 0,
            replayTotalSteps: 0,
            replayPerspective: 'both',
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
            liveReplayFullBoards: [],
            /** 与服务器 moveCoords 同步（仅包含客户端有权知道的着手） */
            syncedMoveCoords: [],
            fogCleared: true,
            fogMask: null,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            board: [],
            /** 终局/数点后：每步全局手数编号（双方棋子均有） */
            stoneMoveNumbersHistory: null,
            /** 迷雾中：每步仅己方棋子有全局手数编号 */
            ownStoneMoveNumbersHistory: null,
            /** 导入棋谱回放：与 replayTruthBoards 同步的全局手数历史 */
            replayStoneNumbersHistory: null,
            unknownFogCounts: null,
            unknownFogCountsHistory: null,
            /** 打谱：每步「未知子」统计（与 replayTruthBoards 对齐） */
            replayUnknownFogCounts: null
        };
        (function initSquareGeometry() {
            const g = C.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = C.initBoardArray(ps.BOARD_SIZE);
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

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

        C.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        C.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

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

        function deepCopyBoard(src) { return src.map(row => row.slice()); }

        function emptyBoolGrid() {
            return Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(false));
        }

        function computeVisionFromColor(board, colorVal, size) {
            const n = size != null ? size : ps.BOARD_SIZE;
            const vis = Array(n).fill().map(() => Array(n).fill(false));
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (board[r][c] !== colorVal) continue;
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < n && nc >= 0 && nc < n)
                                vis[nr][nc] = true;
                        }
                    }
                }
            }
            return vis;
        }

        /** 与服务器一致：无视野处的对方子不显示（当作空） */
        function buildMaskedBoardFromFull(fullBoard, slot, size) {
            const n = size != null ? size : ps.BOARD_SIZE;
            const out = Array(n).fill().map(() => Array(n).fill(0));
            if (slot === 'black') {
                const vis = computeVisionFromColor(fullBoard, 1, n);
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const v = fullBoard[r][c];
                        if (v === 0) continue;
                        if (v === 1) out[r][c] = 1;
                        else if (v === 2 && vis[r][c]) out[r][c] = 2;
                    }
                }
                return out;
            }
            if (slot === 'white') {
                const vis = computeVisionFromColor(fullBoard, 2, n);
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const v = fullBoard[r][c];
                        if (v === 0) continue;
                        if (v === 2) out[r][c] = 2;
                        else if (v === 1 && vis[r][c]) out[r][c] = 1;
                    }
                }
                return out;
            }
            const bVis = computeVisionFromColor(fullBoard, 1, n);
            const wVis = computeVisionFromColor(fullBoard, 2, n);
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const v = fullBoard[r][c];
                    if (v === 0) continue;
                    if (bVis[r][c] && wVis[r][c]) out[r][c] = v;
                }
            }
            return out;
        }

        function inferLastMoveFromMaskedDiff(prev, next, n) {
            const candidates = [];
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (prev[r][c] === 0 && (next[r][c] === 1 || next[r][c] === 2))
                        candidates.push({ row: r, col: c, color: next[r][c] });
                }
            }
            if (candidates.length === 1) return candidates[0];
            return null;
        }

        function buildMarkersFromMaskedHistory(boards, boardSize) {
            const n = boardSize != null ? boardSize : ps.BOARD_SIZE;
            const markers = [[]];
            for (let i = 1; i < boards.length; i++) {
                const m = inferLastMoveFromMaskedDiff(boards[i - 1], boards[i], n);
                markers.push(m ? [m] : []);
            }
            return markers;
        }

        function replayStepPlayersFromMoveCoords(coords) {
            const out = [0];
            for (const m of coords || [])
                out.push(m.player === 'black' ? 1 : 2);
            return out;
        }

        function buildFogMaskFromFullBoard(fullBoard, slot, size) {
            const n = size != null ? size : ps.BOARD_SIZE;
            const bVis = computeVisionFromColor(fullBoard, 1, n);
            const wVis = computeVisionFromColor(fullBoard, 2, n);
            const fog = Array(n).fill().map(() => Array(n).fill(false));
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (slot === 'black') fog[r][c] = !bVis[r][c];
                    else if (slot === 'white') fog[r][c] = !wVis[r][c];
                    else fog[r][c] = !(bVis[r][c] && wVis[r][c]);
                }
            }
            return fog;
        }

        /** 打谱黑/白视角：无视野处不画对方子的上一手标记（与遮罩盘面一致） */
        function filterLastMoveMarkersByVisibleStones(markers) {
            if (!markers || !markers.length) return [];
            if (ps.fogCleared || ps.replayPerspective === 'both')
                return markers.map(m => ({ ...m }));
            return markers.filter(m => {
                const { row, col, color } = m;
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return false;
                return ps.board[row][col] === color;
            }).map(m => ({ ...m }));
        }

        function recomputeFogMaskForCurrentView() {
            if (ps.fogCleared) {
                ps.fogMask = emptyBoolGrid();
                return;
            }
            if (ps.replayMode && !ps.tryPlayMode) {
                if (!ps.replayTruthBoards.length || ps.replayStep < 0 || ps.replayStep >= ps.replayTruthBoards.length) {
                    ps.fogMask = emptyBoolGrid();
                    return;
                }
                const full = ps.replayTruthBoards[ps.replayStep];
                if (ps.replayPerspective === 'both') {
                    ps.fogMask = emptyBoolGrid();
                } else {
                    const slot = ps.replayPerspective === 'black' ? 'black' : 'white';
                    ps.fogMask = buildFogMaskFromFullBoard(full, slot);
                }
                return;
            }
            if (ps.replayMode && ps.tryPlayMode) {
                if (!ps.tryPlayBoards.length || ps.tryPlayStep < 0 || ps.tryPlayStep >= ps.tryPlayBoards.length) {
                    ps.fogMask = emptyBoolGrid();
                    return;
                }
                const full = ps.tryPlayBoards[ps.tryPlayStep];
                if (ps.replayPerspective === 'both') {
                    ps.fogMask = emptyBoolGrid();
                } else {
                    const slot = ps.replayPerspective === 'black' ? 'black' : 'white';
                    ps.fogMask = buildFogMaskFromFullBoard(full, slot);
                }
                return;
            }
            if (!ps.liveReplayFullBoards.length || ps.liveViewStep < 0 || ps.liveViewStep >= ps.liveReplayFullBoards.length) {
                ps.fogMask = emptyBoolGrid();
                return;
            }
            ps.fogMask = buildFogMaskFromFullBoard(ps.liveReplayFullBoards[ps.liveViewStep], ps.mySlot);
        }

        /** 黑：白方视野看不到的黑子数；白：黑方视野看不到的白子数（与 fog-weiqi 服务端一致） */
        function countUnknownFogStonesFromFull(fullBoard, size) {
            const n = size != null ? size : ps.BOARD_SIZE;
            const bVis = computeVisionFromColor(fullBoard, 1, n);
            const wVis = computeVisionFromColor(fullBoard, 2, n);
            let black = 0;
            let white = 0;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const v = fullBoard[r][c];
                    if (v === 1 && !wVis[r][c]) black++;
                    if (v === 2 && !bVis[r][c]) white++;
                }
            }
            return { black, white };
        }

        function shouldShowUnknownFogScoreLine() {
            const started = !!(ps.matchStarted || ps.matchStartedOnce || ps.numberOfHands > 1);
            if (!started) return false;
            if (ps.showEstimateActive) return false;
            if (ps.waitingScoreConfirm) return false;
            if (ps.fogCleared) return false;
            return true;
        }

        function getCurrentUnknownFogCounts() {
            if (ps.replayMode && !ps.tryPlayMode) {
                const arr = ps.replayUnknownFogCounts;
                if (arr && ps.replayStep >= 0 && ps.replayStep < arr.length)
                    return arr[ps.replayStep];
                return { black: 0, white: 0 };
            }
            if (ps.replayMode && ps.tryPlayMode) {
                if (ps.tryPlayBoards.length && ps.tryPlayStep >= 0 && ps.tryPlayStep < ps.tryPlayBoards.length)
                    return countUnknownFogStonesFromFull(ps.tryPlayBoards[ps.tryPlayStep], ps.BOARD_SIZE);
                return { black: 0, white: 0 };
            }
            const tl = ps.unknownFogCountsHistory;
            if (tl && tl.length && ps.liveViewStep >= 0 && ps.liveViewStep < tl.length)
                return tl[ps.liveViewStep];
            if (ps.unknownFogCounts)
                return ps.unknownFogCounts;
            return { black: 0, white: 0 };
        }

        function refreshUnknownFogScoreLine() {
            if (!shouldShowUnknownFogScoreLine()) {
                if (ps.showEstimateActive || ps.waitingScoreConfirm) return;
                scoreBoard.innerText = '　';
                return;
            }
            const c = getCurrentUnknownFogCounts();
            scoreBoard.innerText = `未知棋子数量　黑:${c.black} 白:${c.white}`;
        }

        /** 半透明黑雾；必须「合并为一条 path 一次 fill」，勿逐格 fill rgba（共边会叠两次产生暗缝） */
        const FOG_DRAW_ALPHA = 0.5;

        /**
         * 以交叉点为格心、边长 cellSize 的方格；多格合并填充，与网格/棋子坐标一致。
         * 先 clip 棋盘矩形，避免边线半格溢出。
         */
        function drawFogLayerUnion(ctx, padding, boardSize, cellSize, fogMask) {
            if (!fogMask) return;
            const boardSpan = (boardSize - 1) * cellSize;
            const half = cellSize / 2;
            ctx.save();
            ctx.beginPath();
            ctx.rect(padding, padding, boardSpan, boardSpan);
            ctx.clip();
            ctx.beginPath();
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (!fogMask[r][c]) continue;
                    const cx = padding + c * cellSize;
                    const cy = padding + r * cellSize;
                    ctx.rect(cx - half, cy - half, cellSize, cellSize);
                }
            }
            ctx.fillStyle = `rgba(0,0,0,${FOG_DRAW_ALPHA})`;
            ctx.fill();
            ctx.restore();
        }

        function parseRecordMoveFog(entry) {
            if (typeof entry !== 'string') return entry;
            if (entry === 'Bi' || entry === 'Wi') {
                const player = entry === 'Bi' ? 'black' : 'white';
                return { type: 'pass', player };
            }
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }

        function buildFullStoneMoveNumbersHistoryFromMoves(rawMoves, boardSize, initialPosition) {
            const n = boardSize;
            const history = [];
            const handGrid = Array(n).fill().map(() => Array(n).fill(0));
            let curBoard = C.initBoardArray(n);
            if (initialPosition) {
                if (Array.isArray(initialPosition.black)) {
                    for (const pos of initialPosition.black) {
                        if (Array.isArray(pos) && pos.length === 2)
                            curBoard[pos[0]][pos[1]] = 1;
                    }
                }
                if (Array.isArray(initialPosition.white)) {
                    for (const pos of initialPosition.white) {
                        if (Array.isArray(pos) && pos.length === 2)
                            curBoard[pos[0]][pos[1]] = 2;
                    }
                }
            }
            history.push(deepCopyBoard(handGrid));
            for (let i = 0; i < rawMoves.length; i++) {
                const raw = rawMoves[i];
                const m = typeof raw === 'string' ? parseRecordMoveFog(raw) : raw;
                const hand = i + 1;
                if (m.type === 'pass') {
                    history.push(deepCopyBoard(handGrid));
                    continue;
                }
                const playerVal = m.player === 'black' ? 1 : 2;
                const nb = tryPlaceStoneFog(curBoard, m.row, m.col, playerVal);
                if (!nb) {
                    history.push(deepCopyBoard(handGrid));
                    continue;
                }
                curBoard = nb;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (curBoard[r][c] === 0) handGrid[r][c] = 0;
                    }
                }
                if (curBoard[m.row][m.col] === playerVal) handGrid[m.row][m.col] = hand;
                history.push(deepCopyBoard(handGrid));
            }
            return history;
        }

        function filterStoneNumbersToOwnSlot(fullNums, board, mySlot) {
            const n = board.length;
            const nums = Array(n).fill().map(() => Array(n).fill(0));
            if (mySlot === null) return nums;
            const wantBlack = mySlot === 'black';
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const v = board[r][c];
                    if (v === 0) continue;
                    const isBlack = v === 1;
                    if (wantBlack !== isBlack) continue;
                    nums[r][c] = fullNums[r][c];
                }
            }
            return nums;
        }

        function computeStoneNumbersFog() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.mySlot === null) return nums;

            if (ps.replayMode && ps.tryPlayMode)
                return nums;

            if (!ps.replayMode) {
                if (ps.fogCleared && ps.stoneMoveNumbersHistory && ps.stoneMoveNumbersHistory.length) {
                    const step = Math.min(ps.liveViewStep, ps.stoneMoveNumbersHistory.length - 1);
                    const g = ps.stoneMoveNumbersHistory[step];
                    return g ? deepCopyBoard(g) : nums;
                }
                if (!ps.fogCleared && ps.ownStoneMoveNumbersHistory && ps.ownStoneMoveNumbersHistory.length) {
                    const step = Math.min(ps.liveViewStep, ps.ownStoneMoveNumbersHistory.length - 1);
                    const g = ps.ownStoneMoveNumbersHistory[step];
                    return g ? deepCopyBoard(g) : nums;
                }
                return nums;
            }

            if (ps.replayMode && ps.replayStoneNumbersHistory && ps.replayStoneNumbersHistory.length) {
                const step = Math.min(ps.replayStep, ps.replayStoneNumbersHistory.length - 1);
                const g = ps.replayStoneNumbersHistory[step];
                if (!g) return nums;
                if (ps.replayPerspective === 'both')
                    return deepCopyBoard(g);
                return filterStoneNumbersToOwnSlot(g, ps.board, ps.mySlot);
            }
            return nums;
        }

        function isUserBoardMarkVisibleAtFog(r, c) {
            if (ps.showEstimateActive) return false;
            if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            if (ps.board[r][c] !== 0) return false;
            return true;
        }

        let updateReplayUIFn = () => {};
        let showEstimateFog = () => {};
        let updateTurnFog = () => {};

        function tryPlaceStoneFog(boardBefore, row, col, playerVal) {
            return Q.tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, ps.BOARD_SIZE, deepCopyBoard, 1);
        }

        function syncLiveReplayFromServerState(state) {
            const nh = state.numberOfHands || 1;
            const coords = state.moveCoords || [];
            const boardEmpty = !(state.board || []).some(row => row.some(v => v === 1 || v === 2));

            if (nh === 1 && boardEmpty) {
                ps.liveReplayBoards = [deepCopyBoard(state.board)];
                ps.liveReplayMarkers = [[]];
                ps.liveReplayStepPlayers = [0];
                ps.liveReplayFullBoards = [deepCopyBoard(state.board)];
                return;
            }

            if (!ps.liveReplayBoards.length) {
                ps.liveReplayStepPlayers = [];
                ps.liveReplayMarkers = [];
            }

            while (ps.liveReplayBoards.length > nh) {
                ps.liveReplayBoards.pop();
                ps.liveReplayMarkers.pop();
                ps.liveReplayStepPlayers.pop();
            }

            while (ps.liveReplayBoards.length < nh) {
                const idx = ps.liveReplayBoards.length;
                ps.liveReplayBoards.push(deepCopyBoard(state.board));
                if (idx === 0) {
                    ps.liveReplayStepPlayers.push(0);
                    ps.liveReplayMarkers.push([]);
                } else {
                    const m = coords[idx - 1];
                    const pv = m && m.player === 'white' ? 2 : 1;
                    ps.liveReplayStepPlayers.push(pv);
                    const isLast = (idx === nh - 1);
                    ps.liveReplayMarkers.push(isLast ? (state.lastMoveMarkers || []).map(x => ({ ...x })) : []);
                }
            }
            const li = ps.liveReplayBoards.length - 1;
            if (li >= 0) {
                ps.liveReplayBoards[li] = deepCopyBoard(state.board);
                ps.liveReplayMarkers[li] = (state.lastMoveMarkers || []).map(m => ({ ...m }));
            }
        }

        /**
         * @param {object|Array} stateOrCoords — gameState 对象（含 maskedBoardHistory），或仅 moveCoords 数组（终局后）
         */
        function rebuildLiveReplayFog(stateOrCoords) {
            const state = Array.isArray(stateOrCoords) ? { moveCoords: stateOrCoords } : (stateOrCoords || {});
            const moveCoords = state.moveCoords || [];
            if (state.maskedBoardHistory && state.maskedBoardHistory.length) {
                ps.liveReplayFullBoards = state.maskedBoardHistory.map(b => deepCopyBoard(b));
                ps.liveReplayBoards = ps.liveReplayFullBoards.map(b => deepCopyBoard(b));
                ps.liveReplayStepPlayers = (state.replayStepPlayers && state.replayStepPlayers.length)
                    ? state.replayStepPlayers.slice()
                    : replayStepPlayersFromMoveCoords(moveCoords);
                ps.liveReplayMarkers = buildMarkersFromMaskedHistory(ps.liveReplayFullBoards, ps.BOARD_SIZE);
                return;
            }
            const size = ps.BOARD_SIZE;
            ps.liveReplayBoards = [];
            ps.liveReplayMarkers = [];
            ps.liveReplayStepPlayers = [0];
            let curBoard = C.initBoardArray(size);
            ps.liveReplayBoards.push(deepCopyBoard(curBoard));
            ps.liveReplayMarkers.push([]);
            for (const move of moveCoords) {
                const playerVal = move.player === 'black' ? 1 : 2;
                ps.liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStoneFog(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    ps.liveReplayBoards.push(deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    ps.liveReplayBoards.push(deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([]);
                }
            }
            ps.liveReplayFullBoards = ps.liveReplayBoards.map(b => deepCopyBoard(b));
        }

        function updateLiveReplayPanelUIFog() {
            if (ps.replayMode) return;
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = total;
            slider.value = ps.liveViewStep;
            document.getElementById('replayStepDisplay').innerText = `${ps.liveViewStep} / ${total}`;
        }

        function applyLiveViewBoardFog() {
            if (!ps.liveReplayFullBoards.length) {
                ps.board = C.initBoardArray(ps.BOARD_SIZE);
                ps.lastMoveMarkers = [];
                recomputeFogMaskForCurrentView();
                return;
            }
            if (ps.liveViewStep < 0) ps.liveViewStep = 0;
            if (ps.liveViewStep >= ps.liveReplayFullBoards.length) ps.liveViewStep = ps.liveReplayFullBoards.length - 1;
            const full = ps.liveReplayFullBoards[ps.liveViewStep];
            // liveReplayFullBoards：迷雾中来自服务端 maskedBoardHistory（已按座位遮罩）；终局后由完整手顺重放为全棋盘
            ps.board = deepCopyBoard(full);
            ps.lastMoveMarkers = ps.liveReplayMarkers[ps.liveViewStep].map(m => ({ ...m }));
            recomputeFogMaskForCurrentView();
        }

        let page;
        const fogOpts = {
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            enableEditBoard: true,
            drawBoard() {
                const d = C.draw;
                const cs = C.DEFAULT_CANVAS_SIZE;
                const cellSize = ps.CELL_SIZE;
                d.clear(ctx, cs);
                d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
                d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                const stoneRadius = cellSize * 0.44;
                const markLenDefault = cellSize * 0.352;
                const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
                if (lowerLastMoveMarker) {
                    d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius);
                }
                d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
                if (!lowerLastMoveMarker) {
                    d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
                }
                if (!ps.fogCleared && ps.fogMask) {
                    drawFogLayerUnion(ctx, ps.PADDING, ps.BOARD_SIZE, cellSize, ps.fogMask);
                }
                d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAtFog);
                if (ps.showMoveNumbers) {
                    const nums = computeStoneNumbersFog();
                    d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
                }
                d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                    tryPlayMode: ps.tryPlayMode,
                    tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    mySlot: ps.mySlot,
                    isHoverValid: ps.isHoverValid,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool
                });
                if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                    d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
                }
            },
            applyLiveViewBoard: applyLiveViewBoardFog,
            rebuildLiveReplayFromMoveCoords: (coords) => rebuildLiveReplayFog(coords),
            syncState(state) {
                ps.hoverRow = -1;
                ps.hoverCol = -1;
                ps.isHoverValid = false;
                if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = state.boardSize;
                    ps.KOMI = state.komi;
                    ps.board = C.initBoardArray(ps.BOARD_SIZE);
                    ps.userBoardMarks = Object.create(null);
                    ps.liveReplayBoards = [];
                    ps.liveReplayMarkers = [];
                    ps.liveReplayStepPlayers = [];
                    ps.liveReplayFullBoards = [];
                    ps.syncedMoveCoords = [];
                    ps.stoneMoveNumbersHistory = null;
                    ps.ownStoneMoveNumbersHistory = null;
                    ps.unknownFogCounts = null;
                    ps.unknownFogCountsHistory = null;
                    ps.liveViewStep = 0;
                    const g = C.computePaddingAndCell(ps.BOARD_SIZE);
                    ps.PADDING = g.padding;
                    ps.CELL_SIZE = g.cellSize;
                    fogOpts.drawBoard();
                    komiInfo.innerText = `黑贴白${ps.KOMI}点`;
                    const sizeSelect = document.getElementById('boardSizeSelect');
                    if (sizeSelect) sizeSelect.value = ps.BOARD_SIZE;
                }
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer;
                ps.gameOver = state.gameOver || false;
                ps.winner = state.winner || null;
                if (state.moveCoords) {
                    ps.moveLog = state.moveCoords.map(m => m.type === 'move' ? { row: m.row, col: m.col } : null);
                    ps.syncedMoveCoords = state.moveCoords.map(m => ({ ...m }));
                } else {
                    ps.syncedMoveCoords = [];
                }
                if (state.slots)
                    ps.slots = state.slots;

                ps.stoneMoveNumbersHistory = state.stoneMoveNumbersHistory || null;
                ps.ownStoneMoveNumbersHistory = state.ownStoneMoveNumbersHistory || null;
                ps.unknownFogCounts = state.unknownFogCounts != null ? state.unknownFogCounts : null;
                ps.unknownFogCountsHistory = state.unknownFogCountsHistory || null;

                if (!ps.replayMode) {
                    const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                    rebuildLiveReplayFog(state);
                    ps.board = deepCopyBoard(state.board);
                    ps.lastMoveMarkers = state.lastMoveMarkers || [];
                    ps.fogCleared = !!state.fogCleared;
                    if (!state.maskedBoardHistory || !state.maskedBoardHistory.length)
                        syncLiveReplayFromServerState(state);
                    const newTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    if (newTotal === 0) {
                        ps.liveViewStep = 0;
                        ps.liveFollowLatest = true;
                    } else if (wasAtEnd) {
                        ps.liveViewStep = newTotal;
                        ps.liveFollowLatest = true;
                    } else {
                        ps.liveViewStep = Math.min(ps.liveViewStep, newTotal);
                        if (ps.liveViewStep === newTotal)
                            ps.liveFollowLatest = true;
                    }
                    applyLiveViewBoardFog();
                    updateLiveReplayPanelUIFog();
                    recomputeFogMaskForCurrentView();
                } else if (!ps.tryPlayMode) {
                ps.board = state.board;
                    ps.lastMoveMarkers = state.lastMoveMarkers || [];
                    ps.fogCleared = true;
                    ps.fogMask = emptyBoolGrid();
                }

                const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
                const hasPlayer = ps.slots.black || ps.slots.white;
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (!hasAnyStone && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                    sizeSelect.style.display = 'inline-block';
                else
                    sizeSelect.style.display = 'none';

                if (ps.showEstimateActive)
                    showEstimateFog();
                else
                    updateTurnFog();
                updateReplayUIFn();
            },
            enterReplayMode(data) {
                const size = ps.BOARD_SIZE;
                ps.replayBoards = [];
                ps.replayMarkers = [];
                ps.replayStepPlayers = [0];

                let curBoard = Array(size).fill().map(() => Array(size).fill(0));
                if (data.initialPosition) {
                    if (Array.isArray(data.initialPosition.black)) {
                        for (const pos of data.initialPosition.black) {
                            if (Array.isArray(pos) && pos.length === 2)
                                curBoard[pos[0]][pos[1]] = 1;
                        }
                    }
                    if (Array.isArray(data.initialPosition.white)) {
                        for (const pos of data.initialPosition.white) {
                            if (Array.isArray(pos) && pos.length === 2)
                                curBoard[pos[0]][pos[1]] = 2;
                        }
                    }
                }
                ps.replayBoards.push(deepCopyBoard(curBoard));
                ps.replayMarkers.push([]);

                for (const move of (data.moves || [])) {
                    const playerVal = move.player === 'black' ? 1 : 2;
                    ps.replayStepPlayers.push(playerVal);
                    if (move.type === 'move') {
                        const newBoard = tryPlaceStoneFog(curBoard, move.row, move.col, playerVal);
                        if (newBoard) curBoard = newBoard;
                        ps.replayBoards.push(deepCopyBoard(curBoard));
                        ps.replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                    } else if (move.type === 'pass') {
                        ps.replayBoards.push(deepCopyBoard(curBoard));
                        ps.replayMarkers.push([]);
                    }
                }

                ps.replayTotalSteps = ps.replayBoards.length - 1;
                ps.replayMode = true;
                ps.replayTruthBoards = ps.replayBoards.map(b => deepCopyBoard(b));
                ps.replayStoneNumbersHistory = buildFullStoneMoveNumbersHistoryFromMoves(
                    data.moves || [], size, data.initialPosition
                );
                ps.replayUnknownFogCounts = ps.replayTruthBoards.map(b => countUnknownFogStonesFromFull(b, size));
                ps.replayPerspective = 'both';
                const perspBoth = document.getElementById('replayPerspBoth');
                if (perspBoth) perspBoth.checked = true;

                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps);
                page.updateReplayUI();
            },
            exitReplayMode() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                ps.replayMode = false;
                ps.replayBoards = [];
                ps.replayMarkers = [];
                ps.replayStepPlayers = [];
                ps.replayStep = 0;
                ps.replayTotalSteps = 0;
                ps.replayTruthBoards = [];
                ps.replayStoneNumbersHistory = null;
                ps.replayUnknownFogCounts = null;
                ps.replayPerspective = 'both';
                const perspBothEx = document.getElementById('replayPerspBoth');
                if (perspBothEx) perspBothEx.checked = true;
                page.updateReplayUI();
            },
            setReplayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                const full = ps.replayTruthBoards[step];
                if (ps.fogCleared || ps.replayPerspective === 'both') {
                    ps.board = deepCopyBoard(full);
                } else {
                    const slot = ps.replayPerspective === 'black' ? 'black' : 'white';
                    ps.board = buildMaskedBoardFromFull(full, slot, ps.BOARD_SIZE);
                }
                recomputeFogMaskForCurrentView();
                ps.lastMoveMarkers = filterLastMoveMarkersByVisibleStones(ps.replayMarkers[step]);

                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;

                if (step === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${step}手`;
                }
                ps.isMyTurn = false;

                refreshUnknownFogScoreLine();
                if (ps.showEstimateActive) showEstimateFog();
                else fogOpts.drawBoard();
            },
            updateReplayUI() {
                const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
                const replayPanel = document.getElementById('replayPanel');
                const tryPlayBtn = document.getElementById('tryPlayBtn');
                const perspRow = document.getElementById('replayPerspectiveRow');
                const isPlayer = !!ps.mySlot;
                const started = !!(ps.matchStarted || ps.matchStartedOnce || (ps.matchTime && ps.matchTime.settings));
                const showMatchButtons = isPlayer && started && !ps.replayMode;
                for (const id of gameButtonIds) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = showMatchButtons ? '' : 'none';
                }
                replayPanel.style.display = '';
                if (perspRow) perspRow.style.display = ps.replayMode ? '' : 'none';
                tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
                tryPlayBtn.innerText = ps.tryPlayMode ? '试下结束' : '试下';
            },
            enterTryPlay() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = true;
                ps.tryPlayBaseStep = ps.replayStep;
                const truth0 = ps.replayTruthBoards[ps.replayStep];
                ps.tryPlayBoards = [deepCopyBoard(truth0)];
                ps.tryPlayMarkers = [ps.replayMarkers[ps.replayStep].map(m => ({ ...m }))];

                const _fromLive = !ps.replayMode;
                const _RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
                ps.tryPlayCurrentPlayer = _RT && _RT.resolveTryPlaySideToMove
                    ? _RT.resolveTryPlaySideToMove({
                        fromLive: _fromLive,
                        replayStep: ps.replayStep,
                        replayStepPlayers: ps.replayStepPlayers,
                        liveViewStep: ps.liveViewStep,
                        liveReplayStepPlayers: ps.liveReplayStepPlayers,
                        liveReplayBoardsLength: (ps.liveReplayBoards && ps.liveReplayBoards.length) || 0,
                        currentPlayer: ps.currentPlayer
                    })
                    : (ps.replayStep > 0 ? (3 - ps.replayStepPlayers[ps.replayStep]) : ((ps.currentPlayer === 1 || ps.currentPlayer === 2) ? ps.currentPlayer : 1));
                ps.tryPlayBasePlayer = ps.tryPlayCurrentPlayer;
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;

                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
                applyTryPlayDisplayBoardFog();
                page.updateTryPlayDisplay();
                refreshUnknownFogScoreLine();
                page.updateReplayUI();
            },
            exitTryPlay() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;

                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = ps.replayTotalSteps;
                fogOpts.setReplayStep(ps.tryPlayBaseStep);
                page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                const curFull = ps.tryPlayBoards[ps.tryPlayStep];
                if (curFull[row][col] !== 0) return false;
                const playerVal = ps.tryPlayCurrentPlayer;
                const newBoard = tryPlaceStoneFog(curFull, row, col, playerVal);
                if (!newBoard) return false;

                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }

                ps.tryPlayBoards.push(deepCopyBoard(newBoard));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;

                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                applyTryPlayDisplayBoardFog();
                page.updateTryPlayDisplay();
                refreshUnknownFogScoreLine();
                if (ps.showEstimateActive) showEstimateFog();
                else fogOpts.drawBoard();
                return true;
            },
            setTryPlayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;

                const basePlayer = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                ? ps.tryPlayBasePlayer
                : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
                ps.tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);

                document.getElementById('replaySlider').value = step;
                applyTryPlayDisplayBoardFog();
                page.updateTryPlayDisplay();
                refreshUnknownFogScoreLine();
                if (ps.showEstimateActive) showEstimateFog();
                else fogOpts.drawBoard();
            }
        };

        function applyTryPlayDisplayBoardFog() {
            if (!ps.tryPlayMode || !ps.replayMode) return;
            const full = ps.tryPlayBoards[ps.tryPlayStep];
            if (ps.fogCleared || ps.replayPerspective === 'both') {
                ps.board = deepCopyBoard(full);
            } else {
                const slot = ps.replayPerspective === 'black' ? 'black' : 'white';
                ps.board = buildMaskedBoardFromFull(full, slot, ps.BOARD_SIZE);
            }
            recomputeFogMaskForCurrentView();
            const rawMarkers = (ps.tryPlayMarkers[ps.tryPlayStep] || []).map(m => ({ ...m }));
            ps.lastMoveMarkers = filterLastMoveMarkersByVisibleStones(rawMarkers);
        }

        page = Q.create(ps, domPage, fogOpts);

        function clearEstimateFogImpl() {
            ps.cachedLiveBoard = null;
            ps.cachedTerritory = null;
            C.clearWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo);
            fogOpts.drawBoard();
            refreshUnknownFogScoreLine();
        }

        function showEstimateFogImpl() {
            if (!ps.showEstimateActive) { clearEstimateFogImpl(); return; }
            let estInput;
            if (!ps.fogCleared && ps.fogMask && ps.replayMode && ps.tryPlayMode && ps.tryPlayBoards.length
                && ps.tryPlayStep >= 0 && ps.tryPlayStep < ps.tryPlayBoards.length) {
                const full = ps.tryPlayBoards[ps.tryPlayStep];
                estInput = page.initBoardArray(ps.BOARD_SIZE);
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++)
                        estInput[r][c] = !ps.fogMask[r][c] ? full[r][c] : 0;
                }
            } else if (!ps.fogCleared && ps.fogMask && ps.liveReplayFullBoards.length && ps.liveViewStep < ps.liveReplayFullBoards.length) {
                const full = ps.liveReplayFullBoards[ps.liveViewStep];
                estInput = page.initBoardArray(ps.BOARD_SIZE);
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++)
                        estInput[r][c] = !ps.fogMask[r][c] ? full[r][c] : 0;
                }
            } else {
                estInput = deepCopyBoard(ps.board);
            }
            ps.cachedLiveBoard = page.removeDeadAndDying(estInput);
            ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard);
            const { blackTotal, whiteTotal } = page.computeScore(ps.cachedLiveBoard, ps.cachedTerritory);
            const lead = blackTotal - whiteTotal - 2 * ps.KOMI;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${blackTotal.toFixed(0)}　白: ${whiteTotal.toFixed(0)}`;
            leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${lead.toFixed(1)}点`;
            fogOpts.drawBoard();
        }

        function updateTurnFogImpl() {
            if (ps.replayMode) {
                refreshUnknownFogScoreLine();
                fogOpts.drawBoard();
                return;
            }
            if (ps.matchStartedOnce === undefined) ps.matchStartedOnce = false;
            if (ps.matchStarted) ps.matchStartedOnce = true;
            const hasStoneOnBoard = ps.board && ps.board.some(row => row.some(v => v === 1 || v === 2));
            if (ps.numberOfHands > 1 || hasStoneOnBoard) ps.matchStartedOnce = true;
            const liveTotal = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            const browsingLive = ps.liveReplayBoards.length > 0 && ps.liveViewStep < liveTotal;
            if (browsingLive) {
                if (ps.liveViewStep === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = ps.liveReplayStepPlayers[ps.liveViewStep] === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${ps.liveViewStep}手`;
                }
                ps.isMyTurn = false;
                refreshUnknownFogScoreLine();
                fogOpts.drawBoard();
                return;
            }
            if (ps.gameOver) {
                turnDisplay.innerText = '对局结束';
                if (ps.winner === 'black') scoreTitle.innerText = '黑胜';
                else if (ps.winner === 'white') scoreTitle.innerText = '白胜';
                else if (ps.winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '　';
                ps.isMyTurn = false;
                refreshUnknownFogScoreLine();
                fogOpts.drawBoard();
                return;
            }
            const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
            if (!ps.matchStartedOnce && !ps.matchStarted) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                ps.isMyTurn = false;
                refreshUnknownFogScoreLine();
                fogOpts.drawBoard();
                return;
            }
            const total = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            const lastMovePlayer = 3 - ps.currentPlayer;
            const lastMoveNum = ps.numberOfHands - 1;
            if (ps.liveReplayBoards.length === 0) {
                const emptyBoard = !ps.board.some(row => row.some(v => v === 1 || v === 2));
                turnDisplay.innerText = emptyBoard ? '初始局面' : `${lastMovePlayer === 1 ? '⚫' : '⚪'} 第${lastMoveNum}手`;
            } else if (total === 0) {
                const emptyBoard = !ps.board.some(row => row.some(v => v === 1 || v === 2));
                turnDisplay.innerText = emptyBoard ? '初始局面' : `${lastMovePlayer === 1 ? '⚫' : '⚪'} 第${lastMoveNum}手`;
            } else {
                const p = ps.liveReplayStepPlayers[total];
                turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            const started = !!(ps.matchStarted || ps.matchStartedOnce);
            ps.isMyTurn = !!(started && (ps.mySlot !== null)
                && ((ps.mySlot === 'black' && ps.currentPlayer === 1) || (ps.mySlot === 'white' && ps.currentPlayer === 2)));
            refreshUnknownFogScoreLine();
            fogOpts.drawBoard();
        }

        showEstimateFog = showEstimateFogImpl;
        updateTurnFog = updateTurnFogImpl;
        updateReplayUIFn = page.updateReplayUI;

        function setLiveViewStepFog(step) {
            page.clearMobileMovePreview();
            if (ps.replayMode) return;
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= total;
            page.applyLiveViewBoard();
            page.updateLiveReplayPanelUI();
            if (ps.showEstimateActive) showEstimateFogImpl();
            else updateTurnFogImpl();
        }

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            showScoreConfirm,
            hideScoreConfirm,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove,
            setTryPlayStep,
            connectWebSocket,
            syncState,
            commitMove,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            updateBoardGeometry,
            initBoardArray,
            downloadRecord
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: ps,
            drawBoard: fogOpts.drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep: setLiveViewStepFog,
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
            clearEstimate: clearEstimateFogImpl,
            hideScoreConfirm,
            showEstimate: showEstimateFogImpl,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn: updateTurnFogImpl,
            updateReplayUI: page.updateReplayUI,
            showScoreConfirm,
            isMouseDevice,
            onNewGameStarted: () => { ps.userBoardMarks = Object.create(null); },
            onRoomReset: () => { ps.userBoardMarks = Object.create(null); },
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            timeControlMainByoScale: 2
        });

        function handleMessage(msg) {
            if (msg.type === 'scoreAgreed') {
                ps.fogCleared = true;
                ps.fogMask = emptyBoolGrid();
            }
            if (msg.type === 'broadcast' && (msg.action === 'scoreCounting' || msg.action === 'scoreRejected' || msg.action === 'scoreSettled')) {
                syncState(msg);
                _weiqiBindings.updateRadioStyles();
                return;
            }
            _weiqiBindings.handleMessage(msg);
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

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    fogOpts.drawBoard();
                    return;
                }
                const tf = ps.tryPlayBoards[ps.tryPlayStep];
                if (tf[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        fogOpts.drawBoard();
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
                fogOpts.drawBoard();
                return;
            }
            if (ps.board[row][col] !== 0) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    fogOpts.drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    fogOpts.drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; fogOpts.drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                let occ = 0;
                if (ps.tryPlayMode && ps.replayMode) {
                    const tf = ps.tryPlayBoards[ps.tryPlayStep];
                    if (tf && row >= 0 && col >= 0) occ = tf[row][col];
                } else {
                    occ = (row >= 0 && col >= 0) ? ps.board[row][col] : 0;
                }
                ps.isHoverValid = (row >= 0 && col >= 0 && occ === 0);
                fogOpts.drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    fogOpts.drawBoard();
                }
            });
        }

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
                    clearEstimateFogImpl();
                }
                ps.waitingScoreConfirm = false;
            };
        }

        document.querySelectorAll('input[name="replayPerspective"]').forEach((el) => {
            el.addEventListener('change', () => {
                const c = document.querySelector('input[name="replayPerspective"]:checked');
                ps.replayPerspective = c ? c.value : 'both';
                if (ps.replayMode && !ps.tryPlayMode) {
                    fogOpts.setReplayStep(ps.replayStep);
                    refreshUnknownFogScoreLine();
                    if (ps.showEstimateActive) showEstimateFogImpl();
                    else fogOpts.drawBoard();
                } else if (ps.replayMode && ps.tryPlayMode) {
                    applyTryPlayDisplayBoardFog();
                    refreshUnknownFogScoreLine();
                    if (ps.showEstimateActive) showEstimateFogImpl();
                    else fogOpts.drawBoard();
                }
            });
        });

        connectWebSocket(handleMessage);
        })();
    }
};
