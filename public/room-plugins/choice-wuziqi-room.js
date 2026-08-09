window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["choice-wuziqi"] = {
    shell: {
        "title": "选点五子棋",
        "rulesHtml": "基本规则同五子棋。\n<br /><br />每手棋只能落子在系统随机生成的三个候选点上。<br />",
        "defaultKomiText": "无禁手",
        "boardSizeMin": 7,
        "boardSizeMax": 15,
        "defaultBoardSize": 13,
        "minLib": 1,
        "recordDownloadPrefix": "选点五子棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "选点五子棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
// 解析房间信息

let BOARD_SIZE = 13;
        let PADDING;
        let CELL_SIZE;
        (function initChoiceGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(BOARD_SIZE);
            PADDING = g.padding;
            CELL_SIZE = g.cellSize;
        })();

        // 游戏状态
        let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        let currentPlayer = 'black';
        let mySlot = null;
        let gameOver = false;
        let winner = null;
        let matchStarted = false;
        let matchTime = null;
        let candidates = [];          // 当前回合的三个候选点
        let serverCandidatesSnapshot = []; // 服务器本回合候选（回放到最新时恢复）
        let numberOfHands = 1;
        let lastMoveMarkers = [];

        let replayMode = false;
        let replaySnapshots = [];
        let replayStep = 0;
        let replayTotalSteps = 0;
        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBoards = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 1;
        let tryPlayStep = 0;
        let tryPlayTotalSteps = 0;
        let tryPlayMeta = [];

        let showMoveNumbers = false;
        let serverMoveLog = [];
        let liveSnapshots = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;
        let replayMovesForNumbers = [];

        let userBoardMarks = Object.create(null);
        const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        let ws;
        let isMyTurn = false;
        let slots = { black: false, white: false };
        let reconnectTimer = null;
        let roomJoined = false;
        const goTimerPanel = document.getElementById('goTimerPanel');

        // 悬停预览
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        let hoverRow = -1, hoverCol = -1;
        let isHoverValid = false;

        function mobileTwoStepPlacing() {
            return !isMouseDevice && BOARD_SIZE > 9;
        }
        function clearMobileMovePreview() {
            hoverRow = -1;
            hoverCol = -1;
            isHoverValid = false;
        }

        // DOM
        const canvas = document.getElementById('goBoard');
        const ctx = canvas.getContext('2d');
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        scoreTitle.innerText = '　';
        scoreBoard.innerText = '';
        leadInfo.innerText = '';

        function isUserBoardMarkVisibleAt(r, c) {
            if (typeof showEstimateActive !== 'undefined' && showEstimateActive) return false;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
            if (board[r][c] !== 0) return false;
            if (!tryPlayMode && !gameOver && candidates.length > 0 &&
                candidates.some(p => p.row === r && p.col === c)) return false;
            if (isMouseDevice && tryPlayMode && replayMode && !gameOver && isHoverValid &&
                hoverRow === r && hoverCol === c) return false;
            return true;
        }

        function initBoardArray(size) {
            return QiSquareWeiqiCanvas.initBoardArray(size);
        }

        function updateBoardGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(BOARD_SIZE);
            PADDING = g.padding;
            CELL_SIZE = g.cellSize;
        }

        function deepCopyBoard(src) {
            return QiSquareWeiqiCanvas.deepCopyBoard(src);
        }

        function countStonesOnBoard(brd) {
            let n = 0;
            for (let r = 0; r < brd.length; r++)
                for (let c = 0; c < brd[r].length; c++)
                    if (brd[r][c] !== 0) n++;
            return n;
        }

        function computeMoveNumbers() {
            const nums = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
            if (replayMode && tryPlayMode) {
                // 与围棋一致：打谱试下时只标注试下手顺（1,2,3…），不延续主棋谱手数
                for (let i = 1; i <= tryPlayStep; i++) {
                    const markers = tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < BOARD_SIZE && m.col < BOARD_SIZE && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (replayMode) {
                const stones = countStonesOnBoard(board);
                for (let i = 0; i < stones; i++) {
                    const m = normalizeChoiceRecordMove(replayMovesForNumbers[i]);
                    if (m && board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            } else if (liveSnapshots.length && liveViewStep < liveSnapshots.length - 1) {
                const stones = countStonesOnBoard(board);
                for (let i = 0; i < stones; i++) {
                    const m = serverMoveLog[i];
                    if (m && board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            } else {
                for (let i = 0; i < serverMoveLog.length; i++) {
                    const m = serverMoveLog[i];
                    if (m && board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        /**
         * 与 choice_wuziqi.js 一致：紧凑串 W5,8@5,7;5,8;5,9 或旧版 { player, row, col, candidatesBefore }
         */
        function normalizeChoiceRecordMove(entry) {
            if (entry && typeof entry === 'object' && entry.player != null) {
                const row = Number(entry.row);
                const col = Number(entry.col);
                if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
                const cb = entry.candidatesBefore;
                if (!Array.isArray(cb) || cb.length < 1) return null;
                const candidatesBefore = [];
                for (const c of cb) {
                    if (!c) return null;
                    const cr = Number(c.row);
                    const cc = Number(c.col);
                    if (!Number.isFinite(cr) || !Number.isFinite(cc)) return null;
                    candidatesBefore.push({ row: cr, col: cc });
                }
                const pl = entry.player === 'black' || entry.player === 'white' ? entry.player : null;
                if (!pl) return null;
                return { player: pl, row, col, candidatesBefore };
            }
            if (typeof entry !== 'string') return null;
            const at = entry.indexOf('@');
            if (at === -1) return null;
            const head = entry.slice(0, at);
            const tail = entry.slice(at + 1).trim();
            if (head.length < 3 || (head[0] !== 'B' && head[0] !== 'W')) return null;
            const comma = head.indexOf(',');
            if (comma <= 1) return null;
            const row = Number(head.slice(1, comma));
            const col = Number(head.slice(comma + 1));
            if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
            const player = head[0] === 'B' ? 'black' : 'white';
            const candidatesBefore = [];
            for (const seg of tail.split(';')) {
                const s = seg.trim();
                if (!s) continue;
                const parts = s.split(',');
                if (parts.length !== 2) return null;
                const r = Number(parts[0].trim());
                const c = Number(parts[1].trim());
                if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
                candidatesBefore.push({ row: r, col: c });
            }
            if (candidatesBefore.length < 1) return null;
            return { player, row, col, candidatesBefore };
        }

        /** 与服务器回放一致：由 moves + boardSize 重建每步棋盘与候选点 */
        function checkWinBoardReplay(brd, row, col, colorVal, size) {
            return QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(brd, row, col, colorVal, size);
        }

        function buildChoiceReplaySnapshotsFromMoves(moves, boardSize) {
            const size = boardSize;
            const snapshots = [];
            let brd = initBoardArray(size);
            let lastMoveMarkers = [];

            if (!moves || moves.length === 0) {
                snapshots.push({
                    board: brd.map(r => r.slice()),
                    currentPlayer: 'black',
                    candidates: [],
                    lastMoveMarkers: [],
                    gameOver: false,
                    winner: null
                });
                return snapshots;
            }

            snapshots.push({
                board: brd.map(r => r.slice()),
                currentPlayer: 'black',
                candidates: [],
                lastMoveMarkers: [],
                gameOver: false,
                winner: null
            });

            for (let i = 0; i < moves.length; i++) {
                const m = normalizeChoiceRecordMove(moves[i]);
                if (!m) return null;
                const cb = (m.candidatesBefore || []).map(c => ({ row: c.row, col: c.col }));
                if (cb.length && !cb.some(c => c.row === m.row && c.col === m.col))
                    return null;
                const playerVal = m.player === 'black' ? 1 : 2;

                snapshots.push({
                    board: brd.map(r => r.slice()),
                    currentPlayer: m.player,
                    candidates: cb.map(c => ({ ...c })),
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                    gameOver: false,
                    winner: null
                });

                brd[m.row][m.col] = playerVal;
                lastMoveMarkers = [{ row: m.row, col: m.col, color: playerVal }];

                let gOver = false;
                let win = null;
                if (checkWinBoardReplay(brd, m.row, m.col, playerVal, size)) {
                    gOver = true;
                    win = m.player;
                } else {
                    let full = true;
                    for (let r = 0; r < size && full; r++)
                        for (let c = 0; c < size; c++)
                            if (brd[r][c] === 0) { full = false; break; }
                    if (full) {
                        gOver = true;
                        win = 'draw';
                    }
                }

                const nextPlayer = m.player === 'black' ? 'white' : 'black';
                snapshots.push({
                    board: brd.map(r => r.slice()),
                    currentPlayer: nextPlayer,
                    candidates: [],
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                    gameOver: gOver,
                    winner: gOver ? win : null
                });
                if (gOver) break;
            }
            return snapshots;
        }

        function applyLiveViewStep(step) {
            if (!liveSnapshots.length) return;
            if (step < 0) step = 0;
            if (step > liveSnapshots.length - 1) step = liveSnapshots.length - 1;
            liveViewStep = step;
            const snap = liveSnapshots[step];
            if (!snap) return;
            board = deepCopyBoard(snap.board);
            currentPlayer = snap.currentPlayer || 'black';
            candidates = (snap.candidates || []).map(c => ({ row: c.row, col: c.col }));
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;
            numberOfHands = 1 + countStonesOnBoard(board);
        }

        function updateLiveReplayPanelUI() {
            if (replayMode) return;
            const total = Math.max(0, liveSnapshots.length - 1);
            const slider = document.getElementById('replaySlider');
            psBindings._suppressReplaySliderInput = true;
            slider.min = 0;
            slider.max = total;
            slider.value = liveViewStep;
            psBindings._suppressReplaySliderInput = false;
            document.getElementById('replayStepDisplay').innerText = `${liveViewStep} / ${total}`;
        }

        function restoreServerCandidatesAtLiveTip() {
            const total = Math.max(0, liveSnapshots.length - 1);
            if (liveViewStep < total) return;
            candidates = serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }));
            if (liveSnapshots[total]) {
                liveSnapshots[total] = Object.assign({}, liveSnapshots[total], {
                    candidates: serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }))
                });
            }
        }

        function setLiveViewStep(step) {
            if (replayMode) return;
            const total = Math.max(0, liveSnapshots.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            liveFollowLatest = step >= total;
            applyLiveViewStep(step);
            // 末帧快照不含「当前回合服务器随机候选」，必须从 snapshot 补回
            if (step >= total) restoreServerCandidatesAtLiveTip();
            else candidates = (liveSnapshots[step] && liveSnapshots[step].candidates || []).map(c => ({ row: c.row, col: c.col }));
            psBindings.liveViewStep = liveViewStep;
            updateLiveReplayPanelUI();
            updateTurn();
        }

        // 规则弹框
        const modal = document.getElementById('rulesModal');
        const helpBtn = document.getElementById('helpBtn');
        const closeRulesBtn = document.getElementById('closeRulesBtn');
        function showRules() { modal.style.display = 'flex'; }
        function hideRules() { modal.style.display = 'none'; }
        helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showRules(); });
        closeRulesBtn.addEventListener('click', hideRules);
        modal.addEventListener('click', (e) => { if (e.target === modal) hideRules(); });
        document.addEventListener('click', (e) => {
            if (modal.style.display === 'flex' && !modal.contains(e.target) && e.target !== helpBtn) hideRules();
        });
        helpBtn.addEventListener('click', (e) => e.stopPropagation());

        function updateRadioStyles() {
            updateRecordButtons();
        }

        function updateRecordButtons() {
            const importBtn = document.getElementById('importBtn');
            const exportBtn = document.getElementById('exportBtn');
            if (!importBtn || !exportBtn) return;
            if (replayMode) {
                importBtn.style.display = 'none';
                exportBtn.style.display = 'none';
            } else {
                const hasAnyStone = board.some(row => row.some(v => v !== 0));
                const noPlayers = !slots.black && !slots.white;
                if (noPlayers && !hasAnyStone) {
                    importBtn.style.display = '';
                    exportBtn.style.display = 'none';
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }
        }

        function drawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, BOARD_SIZE, PADDING, cellSize, cs);
            d.starPoints(ctx, BOARD_SIZE, PADDING, cellSize);
            d.coordLabels(ctx, BOARD_SIZE, PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = showMoveNumbers;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, lastMoveMarkers, PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(ctx, board, BOARD_SIZE, PADDING, cellSize, stoneRadius, showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, lastMoveMarkers, PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(ctx, userBoardMarks, BOARD_SIZE, PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (showMoveNumbers) {
                const nums = computeMoveNumbers();
                d.moveNumbersOnStones(ctx, nums, board, BOARD_SIZE, PADDING, cellSize);
            }
            if (!tryPlayMode && !gameOver && candidates.length > 0) {
                ctx.globalAlpha = 0.7;
                const playerColor = currentPlayer === 'black' ? '#222' : '#fff';
                const squareHalf = cellSize * 0.18;
                candidates.forEach(({ row, col }) => {
                    const x = PADDING + col * cellSize;
                    const y = PADDING + row * cellSize;
                    ctx.fillStyle = playerColor;
                    ctx.fillRect(x - squareHalf, y - squareHalf, squareHalf * 2, squareHalf * 2);
                });
                ctx.globalAlpha = 1.0;
            }
            if (isMouseDevice && isMyTurn && !gameOver && !replayMode && mySlot === currentPlayer && isHoverValid && hoverRow >= 0 && hoverCol >= 0) {
                if (candidates.some(c => c.row === hoverRow && c.col === hoverCol)) {
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.fillStyle = mySlot === 'black' ? '#222' : '#ddd';
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }
            if (isMouseDevice && tryPlayMode && replayMode && !gameOver && isHoverValid && hoverRow >= 0 && hoverCol >= 0 && board[hoverRow][hoverCol] === 0) {
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                ctx.fillStyle = tryPlayCurrentPlayer === 1 ? '#222' : '#ddd';
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
        }

        function updateTurn()
        {
            if (replayMode && tryPlayMode) {
                updateTryPlayDisplay();
                isMyTurn = !gameOver;
                drawBoard();
                return;
            }
            if (replayMode && !tryPlayMode) {
                isMyTurn = false;
                drawBoard();
                return;
            }
            const liveTotal = liveSnapshots.length > 0 ? liveSnapshots.length - 1 : 0;
            const browsingLive = !replayMode && liveSnapshots.length > 0 && liveViewStep < liveTotal;
            if (browsingLive) {
                const stones = countStonesOnBoard(board);
                if (stones === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const pl = serverMoveLog[stones - 1].player;
                    turnDisplay.innerText = `${pl === 'black' ? '⚫' : '⚪'} 第${stones}手`;
                }
                scoreTitle.innerText = gameOver
                    ? (winner === 'black' ? '黑胜' : (winner === 'white' ? '白胜' : (winner === 'draw' ? '和棋' : '')))
                    : '　';
                isMyTurn = false;
                drawBoard();
                return;
            }
            if (gameOver)
            {
                turnDisplay.innerText = '对局结束';
                scoreTitle.innerText = winner === 'black' ? '黑胜' : (winner === 'white' ? '白胜' : (winner === 'draw' ? '和棋' : ''));
                isMyTurn = false;
                drawBoard();
                return;
            }

            const started = !!matchStarted || !!psBindings.matchStarted;
            if (!started) {
                const bothSelected = slots.black && slots.white;
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoard();
                return;
            }

            const n = serverMoveLog.length;
            if (n === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const pl = serverMoveLog[n - 1].player;
                turnDisplay.innerText = `${pl === 'black' ? '⚫' : '⚪'} 第${n}手`;
            }
            scoreTitle.innerText = '　';
            isMyTurn = (mySlot === currentPlayer && !gameOver);
            psBindings.isMyTurn = isMyTurn;
            drawBoard();
        }

        function normalizeClientBoardSize(raw) {
            const n = parseInt(raw, 10);
            return Number.isFinite(n) && n >= 7 && n <= 15 ? n : null;
        }

        const psBindings = {
            ws: null,
            mySlot: null,
            slots: { black: false, white: false },
            gameOver: false,
            winner: null,
            matchStarted: false,
            matchTime: null,
            replayMode: false,
            tryPlayMode: false,
            replayStep: 0,
            tryPlayStep: 0,
            liveViewStep: 0,
            isMyTurn: false
        };
        Object.defineProperty(psBindings, 'showMoveNumbers', {
            get: () => showMoveNumbers,
            set: (v) => { showMoveNumbers = !!v; }
        });
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: psBindings,
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => BOARD_SIZE,
            setBoardSize: (n) => { BOARD_SIZE = n; },
            getKomi: () => 0,
            setKomi: () => {},
            getBoard: () => board,
            setBoard: (b) => { board = b; },
            getSlots: () => slots,
            setSlots: (s) => { slots = s; psBindings.slots = s; },
            getMySlot: () => mySlot,
            setMySlot: (s) => { mySlot = s; psBindings.mySlot = s; },
            getGameOver: () => gameOver,
            setGameOver: (v) => { gameOver = v; psBindings.gameOver = !!v; },
            getWinner: () => winner,
            setWinner: (w) => { winner = w; psBindings.winner = w; },
            getReplayMode: () => replayMode,
            getShowEstimateActive: () => false,
            setShowEstimateActive: () => {},
            getWaitingScoreConfirm: () => false,
            setWaitingScoreConfirm: () => {},
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            showScoreConfirm: () => {},
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });
        const baseRoomHandleMessage = _weiqiBindings.handleMessage;

        // ---------- WebSocket ----------

        function connectWebSocket() {
            const storedPassword = sessionStorage.getItem(`roomPassword_${roomId}`);
            if (storedPassword) roomPassword = storedPassword;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => reconnectTimer,
                setReconnectTimer: (id) => { reconnectTimer = id; },
                onMessage: handleMessage
            });
            psBindings.ws = ws;
            const prevOnClose = ws.onclose;
            ws.onclose = function (event) {
                if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
                roomJoined = false;
                if (prevOnClose) prevOnClose.call(ws, event);
            };
        }

        function handleMessage(msg)
        {
            baseRoomHandleMessage(msg);
        }

        function syncState(state)
        {
            const sz = state.boardSize != null ? normalizeClientBoardSize(state.boardSize) : null;
            if (sz != null && sz !== Number(BOARD_SIZE)) {
                BOARD_SIZE = sz;
                board = initBoardArray(BOARD_SIZE);
                updateBoardGeometry();
                const bs = document.getElementById('boardSizeSelect');
                if (bs) bs.value = String(BOARD_SIZE);
            }
            numberOfHands = state.numberOfHands != null ? state.numberOfHands : 1;
            if (state.slots) slots = state.slots;
            psBindings.slots = slots;
            serverMoveLog = state.moveLog || [];
            matchStarted = !!state.matchStarted;
            matchTime = state.matchTime || null;
            psBindings.matchStarted = matchStarted;
            psBindings.matchTime = matchTime;

            if (!replayMode) {
                const prevTotal = Math.max(0, liveSnapshots.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                const built = buildChoiceReplaySnapshotsFromMoves(serverMoveLog, BOARD_SIZE);
                liveSnapshots = (built && built.length)
                    ? built
                    : [{
                        board: initBoardArray(BOARD_SIZE),
                        currentPlayer: 'black',
                        candidates: [],
                        lastMoveMarkers: [],
                        gameOver: false,
                        winner: null
                    }];
                const newTotal = Math.max(0, liveSnapshots.length - 1);
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
                applyLiveViewStep(liveViewStep);
                const edgeTotal = Math.max(0, liveSnapshots.length - 1);
                serverCandidatesSnapshot = (state.candidates || []).map(c => ({ row: c.row, col: c.col }));
                // 最后一格对应当前局面：候选点由服务器随机生成，不在 moveLog 里，必须用 state 覆盖快照
                if (liveViewStep === edgeTotal) {
                    board = deepCopyBoard(state.board);
                    currentPlayer = state.currentPlayer;
                    candidates = serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }));
                    lastMoveMarkers = (state.lastMoveMarkers || []).map(m => ({ ...m }));
                    gameOver = !!state.gameOver;
                    winner = state.winner != null ? state.winner : null;
                    psBindings.gameOver = gameOver;
                    psBindings.winner = winner;
                    numberOfHands = state.numberOfHands != null ? state.numberOfHands : 1;
                    liveSnapshots[edgeTotal] = {
                        board: deepCopyBoard(board),
                        currentPlayer,
                        candidates: serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col })),
                        lastMoveMarkers: lastMoveMarkers.map(m => ({ ...m })),
                        gameOver,
                        winner
                    };
                }
                updateLiveReplayPanelUI();
            } else {
                board = state.board;
                currentPlayer = state.currentPlayer;
                gameOver = state.gameOver || false;
                winner = state.winner || null;
                psBindings.gameOver = gameOver;
                psBindings.winner = winner;
                candidates = (state.candidates || []).map(c => ({ row: c.row, col: c.col }));
                serverCandidatesSnapshot = candidates.map(c => ({ row: c.row, col: c.col }));
                lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = board.some(row => row.some(v => v !== 0));
            const hasPlayer = slots.black || slots.white;
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (sizeSelect && !hasAnyStone && !hasPlayer && !gameOver && mySlot === null && !replayMode)
                sizeSelect.style.display = 'inline-block';
            else if (sizeSelect) sizeSelect.style.display = 'none';

            updateTurn();
            psBindings.replayMode = replayMode;
            psBindings.tryPlayMode = tryPlayMode;
            psBindings.replayStep = replayStep;
            psBindings.tryPlayStep = tryPlayStep;
            psBindings.liveViewStep = liveViewStep;
            psBindings.mySlot = mySlot;
            updateRecordButtons();
            updateReplayUI();
        }

        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix);
        }

        function enterReplayMode(data) {
            let snapshots = null;
            if (data && Array.isArray(data.snapshots) && data.snapshots.length > 0)
                snapshots = data.snapshots;
            else {
                const bs = (data && data.boardSize != null) ? data.boardSize : BOARD_SIZE;
                const mv = (data && data.moves) ? data.moves : [];
                snapshots = buildChoiceReplaySnapshotsFromMoves(mv, bs);
            }
            if (!snapshots || snapshots.length === 0) return;
            replayMovesForNumbers = (data && Array.isArray(data.moves)) ? data.moves : [];
            replaySnapshots = snapshots;
            replayTotalSteps = replaySnapshots.length - 1;
            replayMode = true;
            const slider = document.getElementById('replaySlider');
            slider.max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
            updateRecordButtons();
        }

        function exitReplayMode() {
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayMeta = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            replayMode = false;
            replaySnapshots = [];
            replayStep = 0;
            replayTotalSteps = 0;
            replayMovesForNumbers = [];
            updateReplayUI();
            updateRecordButtons();
        }

        function setReplayStep(step) {
            if (step < 0) step = 0;
            if (step > replayTotalSteps) step = replayTotalSteps;
            replayStep = step;
            psBindings.replayStep = replayStep;
            const snap = replaySnapshots[step];
            if (!snap) return;
            const sz = snap.board.length;
            if (sz !== Number(BOARD_SIZE)) {
                BOARD_SIZE = sz;
                updateBoardGeometry();
            }
            board = deepCopyBoard(snap.board);
            currentPlayer = snap.currentPlayer || 'black';
            candidates = (snap.candidates || []).map(c => ({ row: c.row, col: c.col }));
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;
            numberOfHands = 1;

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;
            if (step === 0)
                turnDisplay.innerText = '初始局面';
            else
                turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps}`;
            if (gameOver) {
                scoreTitle.innerText = winner === 'black' ? '黑胜' : (winner === 'white' ? '白胜' : (winner === 'draw' ? '和棋' : ''));
            } else {
                scoreTitle.innerText = '　';
            }
            isMyTurn = false;
            drawBoard();
        }

        function updateReplayUI() {
            const hideIds = ['undoBtn', 'resignBtn', 'drawBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!mySlot;
            const started = !!(matchStarted || psBindings.matchStarted || (matchTime && matchTime.settings));
            const showMatchButtons = isPlayer && started && !replayMode;
            hideIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = showMatchButtons ? '' : 'none'; });
            replayPanel.style.display = '';
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
        }

        function checkWinLocal(brd, row, col, colorVal) {
            return QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(brd, row, col, colorVal, BOARD_SIZE);
        }

        function enterTryPlay() {
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [lastMoveMarkers.map(m => ({ ...m }))];
            tryPlayMeta = [{ gameOver: false, winner: null }];
            const snap = replaySnapshots[replayStep];
            tryPlayCurrentPlayer = (snap && !snap.gameOver && snap.currentPlayer === 'white') ? 2 : 1;
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            gameOver = false;
            winner = null;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            updateTurn();
        }

        function exitTryPlay() {
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayMeta = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = replayTotalSteps;
            setReplayStep(tryPlayBaseStep);
            updateReplayUI();
            updateTurn();
        }

        function tryPlayMove(row, col) {
            if (board[row][col] !== 0 || gameOver) return;
            const playerVal = tryPlayCurrentPlayer;
            board[row][col] = playerVal;
            lastMoveMarkers = [{ row, col, color: playerVal }];
            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
                tryPlayMeta.length = tryPlayStep + 1;
            }
            let gOver = false;
            let win = null;
            if (checkWinLocal(board, row, col, playerVal)) {
                gOver = true;
                win = playerVal === 1 ? 'black' : 'white';
            } else {
                let full = true;
                for (let r = 0; r < BOARD_SIZE && full; r++)
                    for (let c = 0; c < BOARD_SIZE; c++)
                        if (board[r][c] === 0) { full = false; break; }
                if (full) {
                    gOver = true;
                    win = 'draw';
                }
            }
            tryPlayBoards.push(deepCopyBoard(board));
            tryPlayMarkers.push(lastMoveMarkers.map(m => ({ ...m })));
            tryPlayMeta.push({ gameOver: gOver, winner: win });
            gameOver = gOver;
            winner = win;
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = tryPlayCurrentPlayer === 1 ? 2 : 1;
            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            updateTurn();
            drawBoard();
        }

        function setTryPlayStep(step) {
            if (step < 0) step = 0;
            if (step > tryPlayTotalSteps) step = tryPlayTotalSteps;
            tryPlayStep = step;
            psBindings.tryPlayStep = tryPlayStep;
            board = deepCopyBoard(tryPlayBoards[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));
            const meta = tryPlayMeta[step] || { gameOver: false, winner: null };
            gameOver = meta.gameOver;
            winner = meta.winner;
            const baseSnap = replaySnapshots[tryPlayBaseStep];
            const startPl = (baseSnap && !baseSnap.gameOver && baseSnap.currentPlayer === 'white') ? 2 : 1;
            tryPlayCurrentPlayer = step % 2 === 0 ? startPl : (3 - startPl);
            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            updateTurn();
            drawBoard();
        }

        function updateTryPlayDisplay() {
            if (tryPlayMode) {
                document.getElementById('replayStepDisplay').innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
                const emoji = tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
            }
        }

        // 坐标转换
        function getClosestIntersection(x, y) {
            return QiSquareWeiqiCanvas.getClosestIntersection(x, y, BOARD_SIZE, PADDING, CELL_SIZE);
        }

        function canvasCoordsFromClient(clientX, clientY) {
            return QiSquareWeiqiCanvas.canvasCoordsFromClient(clientX, clientY, canvas);
        }

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const v = boardMarkSelect.value;
            if (v === '') return { clear: true, ch: '' };
            return { clear: false, ch: v };
        }

        function applyUserBoardMark(row, col) {
            if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return;
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
            if (existing === undefined) userBoardMarks[key] = ch;
            else if (existing !== ch) userBoardMarks[key] = ch;
            else delete userBoardMarks[key];
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

        // 鼠标移动悬停
        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                hoverRow = row;
                hoverCol = col;
                isHoverValid = true;
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                isHoverValid = false;
                hoverRow = -1;
                hoverCol = -1;
                drawBoard();
            });
        }

        // 点击落子
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
            if (tryPlayMode && replayMode) {
                if (row >= 0 && col >= 0) tryPlayMove(row, col);
                return;
            }
            if (replayMode && !tryPlayMode) return;
            if (gameOver) return;
            if (!isMyTurn) return;
            if (mySlot !== currentPlayer) return;
            // 只能选择候选点
            if (candidates.some(c => c.row === row && c.col === col)) {
                ws.send(JSON.stringify({ type: 'move', row, col }));
            }
        });

        /* board edit UI */
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
                get ws() { return typeof ws !== 'undefined' ? ws : null; }
            };
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: _editPs,
                canvas: document.getElementById('goBoard'),
                mode: 'grid2d',
                pickAtClient(clientX, clientY) {
                    if (typeof canvasCoordsFromClient === 'function' && typeof getClosestIntersection === 'function') {
                        const p = canvasCoordsFromClient(clientX, clientY);
                        return getClosestIntersection(p.x, p.y);
                    }
                    if (typeof pickIntersectionAtCanvas === 'function') {
                        const canvasEl = document.getElementById('goBoard');
                        const rect = canvasEl.getBoundingClientRect();
                        const scale = canvasEl.width / rect.width;
                        return pickIntersectionAtCanvas((clientX - rect.left) * scale, (clientY - rect.top) * scale);
                    }
                    return null;
                },
                drawBoard: typeof drawBoard === 'function' ? drawBoard : function () {},
                getBoard() { return board; },
                setBoard(b) { board = b; },
                emptyBoard() {
                    const n = (typeof BOARD_SIZE !== 'undefined' ? BOARD_SIZE
                        : (typeof ROWS !== 'undefined' ? ROWS : board.length));
                    return Array(n).fill(null).map(function () { return Array(n).fill(0); });
                }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) _editPs.gameStarted = (state.numberOfHands || 1) > 1;
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

        connectWebSocket();
        })();
    }
};
