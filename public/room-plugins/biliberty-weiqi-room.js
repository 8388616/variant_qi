window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['biliberty-weiqi'] = {
    shell: {
        "title": "二气围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每片棋都必须有两口气或以上才能留在棋盘上，否则就要被提掉。<br />",
        "defaultKomiText": "黑贴白2.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 2,
        "recordDownloadPrefix": "二气围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "二气围棋";
        var minLib = config.minLib != null ? config.minLib : 2;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        function bilibertyKomiForSize(boardSize) {
            if (boardSize === 3) return 4.5;
            if (boardSize === 4) return 0.0;
            if (boardSize === 5) return 12.5;
            if (boardSize === 6) return 0.5;
            if (boardSize === 7) return 5.5;
            if (boardSize === 8) return 3.0;
            if (boardSize % 2 === 0) return 3.25;
            return 2.75;
        }

        const ps = {
            BOARD_SIZE: 19,
            KOMI: bilibertyKomiForSize(19),
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

        function bilibertyTryPlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 2
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
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const ob = ps.liveOpeningBoard;
                const o = R().rebuildLiveReplayFromMoveCoords(
                    moveCoords,
                    bilibertyTryPlaceStone,
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
            syncStateBase(state);
            updateEditModeUI();
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
                ps.KOMI = bilibertyKomiForSize(n);
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
        const handleMessage = _weiqiBindings.handleMessage;
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
        connectWebSocket(handleMessage);
        })();
    }
};
