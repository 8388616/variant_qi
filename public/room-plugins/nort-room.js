window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['nort'] = {
    shell: {
        "title": "放牛棋",
        "rulesHtml": "双方轮流落子，只能下在空点上，欠行落败。<br /><br /><strong>小放牛棋：</strong>落子点旁边不能恰好有一颗对方的棋子。<br /><strong>大放牛棋：</strong>落子点周围不能恰好有一颗或两颗对方的棋子。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 5,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "放牛棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "woodTexture": true,
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": false
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "放牛棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const ps = {
            BOARD_SIZE: 9,
            KOMI: 0,
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
            board: null
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        const komiInfo = document.getElementById('komiInfo');
        // 本棋种没有贴目：隐藏贴目位（按 id 取，别按 .komi-info 类——#gameTitleInfo 也带这个类）
        if (komiInfo) {
            komiInfo.hidden = true;
            komiInfo.style.display = 'none';
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
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const dc = (b) => QiSquareWeiqiCanvas.deepCopyBoard(b);
        /* ---------------------------- 子棋类目录 ----------------------------
         * 必须与服务端 games/nort.js 的 SUB_GAMES/SUB_META 完全一致：
         *   snort 小放牛棋：看上下左右四邻、对方棋子**恰好 1 枚禁入**；
         *   lnort 大放牛棋：看上下左右加四个斜角（八邻）、对方棋子**1 枚或 2 枚禁入**。
         * 规则文案与棋谱前缀都按当前子棋类走。 */
        const SUB_GAMES = ['snort', 'lnort'];
        const DEFAULT_SUB_GAME = 'snort';
        const SUB_META = {
            'snort': {
                near: false, forbidLo: 1, forbidHi: 1, name: '小放牛棋',
                rulesHtml: '双方轮流落子，只能下在空点上，落子点旁边不能恰好有一颗对方的棋子，欠行落败。<br /><br />'
            },
            'lnort': {
                near: true, forbidLo: 1, forbidHi: 2, name: '大放牛棋',
                rulesHtml: '双方轮流落子，只能下在空点上，落子点周围不能恰好有一颗或两颗对方的棋子，欠行落败。<br /><br />'
            }
        };
        /** 八邻方向：前四条是上下左右（四邻只用这四条），后四条是斜角 */
        const DIRS8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        let SUB = DEFAULT_SUB_GAME;
        function subMeta() { return SUB_META[SUB] || SUB_META[DEFAULT_SUB_GAME]; }

        /**
         * 放牛棋：只能落在空点，且邻里的**对方棋子**枚数不能落在本子棋类的禁入区间内
         * （小＝四邻恰好 1 枚；大＝八邻 1 枚或 2 枚；不吃子、不判自杀）；与服务端 games/nort.js 同口径。
         */
        function nortTryPlaceStone(boardBefore, row, col, playerVal, boardSize, deepCopy) {
            if (boardBefore[row] === undefined || boardBefore[row][col] !== 0) return null;
            const meta = subMeta();
            const enemy = 3 - playerVal;
            const dirCount = meta.near ? 8 : 4;
            let foe = 0;
            for (let i = 0; i < dirCount; i++) {
                const r = row + DIRS8[i][0];
                const c = col + DIRS8[i][1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (boardBefore[r][c] === enemy) foe++;
            }
            if (foe >= meta.forbidLo && foe <= meta.forbidHi) return null;
            const newBoard = deepCopy(boardBefore);
            newBoard[row][col] = playerVal;
            return { newBoard, capturedOpponent: false };
        }
        const tryPlaceBoardOnly = (b, r, c, p) =>
            (() => { const res = nortTryPlaceStone(b, r, c, p, ps.BOARD_SIZE, dc); return res ? res.newBoard : null; })();

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

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            tryPlaceStone: tryPlaceBoardOnly,
            komiInfoText: '无贴点',
            replayGameButtonIds: ['undoBtn', 'resignBtn', 'drawBtn'],
            tryPlayMove(row, col) {
                if (ps.board[row][col] !== 0) return false;
                const playerVal = ps.tryPlayCurrentPlayer;
                const result = nortTryPlaceStone(ps.board, row, col, playerVal, ps.BOARD_SIZE, dc);
                if (!result) return false;
                const { newBoard } = result;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayBoards.push(dc(newBoard));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = dc(newBoard);
                ps.lastMoveMarkers = [{ row, col, color: playerVal }];
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                page.drawBoard();
                return true;
            },
            updateTryPlayDisplay() {
                const stepDisplay = document.getElementById('replayStepDisplay');
                if (ps.tryPlayMode) {
                    stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                    {
                        const emoji = ps.tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                        turnDisplay.innerText = `${emoji} 试下`;
                    }
                }
            }
        });

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard,
            updateTurn,
            showEstimate,
            clearEstimate,
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
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        /** 规则弹层文案按当前子棋类（壳加载时用的是 shell.rulesHtml＝小放牛棋那份） */
        function applySubShellChrome() {
            const meta = subMeta();
            const rulesTitle = document.getElementById('rulesTitle');
            if (rulesTitle) rulesTitle.textContent = meta.name;
            const rulesBody = document.getElementById('rulesBody');
            if (rulesBody) rulesBody.innerHTML = meta.rulesHtml;
        }

        /** 子棋类下拉框：按当前子棋类校正，开局（有子/有人入座/有手数/已结束）后锁定不可改 */
        function syncSubGameSelect() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            window.QiRoomGameSwitcher.syncSettingsSelect(sel);
            sel.value = SUB;
            window.QiRoomGameSwitcher.syncSettingsSelect(sel);
        }

        /** 棋谱下载文件名前缀按当前子棋类（内容里的 gameType/subGameId 由服务端导出时写好） */
        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, subMeta().name);
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
            boardSeatOverlay: true
        });
        const _baseHandleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        /**
         * 子棋类以服务端为准：任何带 subGameId 的消息（joined 里的 state / gameState / subGameChanged /
         * importSuccess / editBoardAccepted…）都用来校正本地乐观切换的结果——
         * 切换被服务端拒绝时（已入座/已开局）会 sendState 回推，不回推就会与服务端脱钩。
         */
        const handleMessage = (msg) => {
            const before = SUB;
            const incoming = (msg && msg.subGameId) || (msg && msg.state && msg.state.subGameId);
            if (typeof incoming === 'string' && SUB_GAMES.indexOf(incoming) >= 0) SUB = incoming;
            if (before !== SUB) {
                // 切子棋类等于开新局：先退出试下（清掉试下棋子）与打谱、清掉用户标记
                if (ps.tryPlayMode) exitTryPlay();
                if (ps.replayMode) exitReplayMode();
                ps.userBoardMarks = Object.create(null); ps.userStoneMarks = Object.create(null);
                ps.hoverRow = -1;
                ps.hoverCol = -1;
                ps.isHoverValid = false;
            }
            _baseHandleMessage(msg);
            if (before !== SUB) applySubShellChrome();
            syncSubGameSelect();
        };

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
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row;
                ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                ps.isHoverValid = false;
                ps.hoverRow = -1;
                ps.hoverCol = -1;
                drawBoard();
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
        // 子棋类选择器：小放牛棋（四邻）/ 大放牛棋（八邻含斜角），开局前与路数选择器同显（room.html 里的
        // #subGameSelect 是公共占位元素，选项由各棋种自己按需填充，房间号/路径仍走 /rooms/<房间号>）
        (function mountSubGameSelect() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            sel.innerHTML = '';
            for (const id of SUB_GAMES) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = (SUB_META[id] || {}).name || id;
                if (id === SUB) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => {
                const v = sel.value;
                if (!v || v === SUB || SUB_GAMES.indexOf(v) < 0) return;
                // 本地立即切换（乐观更新）；服务端广播 subGameChanged 回来时已相同，
                // 被拒（已入座/已开局）时服务端 sendState 回推，由 handleMessage 校正
                SUB = v;
                if (ps.tryPlayMode) exitTryPlay();
                if (ps.replayMode) exitReplayMode();
                ps.userBoardMarks = Object.create(null); ps.userStoneMarks = Object.create(null);
                applySubShellChrome();
                syncSubGameSelect();
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'setSubGame', subGameId: v }));
                }
                drawBoard();
            });
            applySubShellChrome();
            syncSubGameSelect();
        })();

        connectWebSocket(handleMessage);
        })();
    }
};
