window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['short-liberty-weiqi'] = {
    shell: {
        "title": "短气围棋",
        "rulesHtml": "基本规则同围棋，但是每块气必须有n口气或以上才能留在棋盘上，否则就要被提掉。<br /><br /><strong>二气</strong>：n=2。<br /><strong>三气</strong>：n=3。<br /><strong>四气</strong>：n=4。<br />",
        "defaultKomiText": "黑贴白2.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 2,
        "recordDownloadPrefix": "短气围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "zoomScroll": false,
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "短气围棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        // 子棋类：bi 二气 / tri 三气 / quad 四气（subGameId 沿用旧棋类 id）
        let LIBERTY = 'bi';
        const SUB_GAME_ID = { bi: 'biliberty-weiqi', tri: 'triliberty-weiqi', quad: 'quadriliberty-weiqi' };
        const MIN_LIB = { bi: 2, tri: 3, quad: 4 };

        /** 二气围棋贴目（按路数） */
        function komiForSizeBi(boardSize) {
            if (boardSize === 3) return 4.5;
            if (boardSize === 4) return 0.0;
            if (boardSize === 5) return 12.5;
            if (boardSize === 6) return 0.5;
            if (boardSize === 7) return 5.5;
            if (boardSize === 8) return 3.0;
            if (boardSize % 2 === 0) return 3.25;
            return 2.75;
        }

        /** 三气围棋贴目（按路数）；其余奇数路数默认 2.75 */
        function komiForSizeTri(boardSize) {
            switch (boardSize) {
                case 3:
                    return 4.5;
                case 4:
                case 6:
                    return 0.0;
                case 5:
                case 7:
                case 9:
                case 11:
                    return 2.5;
                case 8:
                case 10:
                    return 2.0;
                default:
                    if (boardSize % 2 == 0)
                        return 2.25;
                    return 2.75;
            }
        }

        /** 客户端显示贴目（与后端 _komi 一致）：二气/三气按尺寸查表（各自不同），四气固定 3.25 */
        function komiForLiberty(liberty, boardSize) {
            if (liberty === 'tri') return komiForSizeTri(boardSize);
            if (liberty === 'quad') return 3.25;
            return komiForSizeBi(boardSize);
        }

        const ps = {
            BOARD_SIZE: 9,
            KOMI: komiForLiberty('bi', 9),
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
            liveOpeningBoard: null,
            gameStarted: false,
            editModeEnabled: false,
            editTool: 'empty'
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
        const R = () => QiWeiqiSquarePageRuntime;

        function shortLibertyTryPlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), MIN_LIB[LIBERTY]
            );
        }

        /** 死棋判定（数点预览/估目）：随子棋类动态取 minLib，避免 create 时闭包固定值在切换后失配 */
        function shortLibertyRemoveDeadAndDying(srcBoard) {
            return R().removeDeadAndDying(
                srcBoard, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), MIN_LIB[LIBERTY]
            );
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
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix,
            minLib: MIN_LIB[LIBERTY],
            maxWeakLiberties: MIN_LIB[LIBERTY],
            tryPlaceStone: shortLibertyTryPlaceStone,
            removeDeadAndDying: shortLibertyRemoveDeadAndDying,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const syncedLen = ps.liveReplayBoards.length - 1;
                const mcs = moveCoords || [];
                if (syncedLen >= 0 && mcs.length > syncedLen) {
                    const inc = R().applyLiveReplayIncrementalBoards(
                        ps.liveReplayBoards, ps.liveReplayMarkers, ps.liveReplayStepPlayers,
                        mcs, shortLibertyTryPlaceStone, QiSquareWeiqiCanvas.deepCopyBoard);
                    if (inc.ok) return;
                }
                const ob = ps.liveOpeningBoard;
                const o = R().rebuildLiveReplayFromMoveCoords(
                    moveCoords,
                    shortLibertyTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    () => ob ? QiSquareWeiqiCanvas.deepCopyBoard(ob) : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE)
                );
                ps.liveReplayBoards = o.liveReplayBoards;
                ps.liveReplayMarkers = o.liveReplayMarkers;
                ps.liveReplayStepPlayers = o.liveReplayStepPlayers;
            }
        });
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
            syncState: syncStateBase,
            commitMove,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            updateEditModeUI,
            clearEditModeUi
        } = page;

        function syncState(state) {
            ps.gameStarted = (state.numberOfHands || 1) > 1;
            if (state.liberty && state.liberty !== LIBERTY) {
                LIBERTY = state.liberty;
                const sel = document.getElementById('subGameSelect');
                if (sel) sel.value = LIBERTY;
                refreshKomiInfo();
            }
            // 棋盘尺寸变化由 syncStateBase 统一处理（内部重建棋盘并更新几何/贴目显示），
            // 切勿在此先改 ps.BOARD_SIZE——会跳过 syncStateBase 的几何更新导致换路数后棋格不变化
            syncStateBase(state);
            updateEditModeUI();
            // 子棋类选择器显示时机与路数选择器一致（开局前可改）
            updateSubGameSelectVisibility();
        }

        function updateSubGameSelectVisibility() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            // 有子棋类：始终显示；开局（有子/有人入座/对局结束）后锁定不可改，新局时恢复可用
            sel.style.display = 'inline-block';
            sel.disabled = hasAnyStone || hasPlayer || ps.gameOver;
        }

        function refreshKomiInfo() {
            ps.KOMI = komiForLiberty(LIBERTY, ps.BOARD_SIZE);
            const el = document.getElementById('komiInfo');
            if (el) el.textContent = `黑贴白${ps.KOMI}点`;
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
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
            setBoardSize: (n) => {
                ps.BOARD_SIZE = n;
                ps.KOMI = komiForLiberty(LIBERTY, n);
            },
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
            onNewGameStarted() {
                clearEditModeUi();
            }
        });
        const _baseHandleMessage = _weiqiBindings.handleMessage;
        const updateVsComputerBtn = _weiqiBindings.updateVsComputerBtn;
        const handleMessage = (msg) => {
            if (msg && msg.type === 'libertyChanged') {
                // 子棋类变更广播（带完整 state）：全量同步
                syncState(msg);
                // 切换二/三/四气后「与电脑对弈」可用性立即更新（服务端已按新子棋类重查引擎）
                if (Object.prototype.hasOwnProperty.call(msg, 'katagoAvailable'))
                    ps.katagoAvailable = !!msg.katagoAvailable;
                if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                    ps.computerSlot = msg.computerSlot || null;
                if (typeof updateVsComputerBtn === 'function') updateVsComputerBtn();
                return;
            }
            _baseHandleMessage(msg);
        };
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

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

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
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
        // 子棋类选择器：二气/三气/四气（开局前与路数选择器同显）
        const subGameSelect = document.getElementById('subGameSelect');
        if (subGameSelect) {
            subGameSelect.innerHTML = '';
            const opts = [
                { value: 'bi', label: '二气' },
                { value: 'tri', label: '三气' },
                { value: 'quad', label: '四气' }
            ];
            for (const o of opts) {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                if (o.value === LIBERTY) opt.selected = true;
                subGameSelect.appendChild(opt);
            }
            subGameSelect.addEventListener('change', () => {
                const v = subGameSelect.value;
                if (!v || v === LIBERTY) return;
                // 本地立即切换（乐观更新）；服务器广播 libertyChanged 回来时已相同
                LIBERTY = v;
                refreshKomiInfo();
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'setLiberty', liberty: v }));
                }
                drawBoard();
            });
        }
        connectWebSocket(handleMessage);
        })();
    }
};
