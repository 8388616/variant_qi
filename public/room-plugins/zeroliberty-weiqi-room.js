window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['zeroliberty-weiqi'] = {
    shell: {
        "title": "零气围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />没有气的棋子不会自动被提，需要花一手棋来提掉。提子的时候会提掉整片棋。<br /><br />行棋方可以点击想要提掉的棋子来提子。",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 0,
        "recordDownloadPrefix": "零气围棋",
        "standardWeiqiMatchTime": true,
        "features": {
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "零气围棋";
        var minLib = config.minLib != null ? config.minLib : 0;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
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
            hoverCapture: false
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

        function zlTryPlaceStone(boardBefore, row, col, playerVal) {
            if (boardBefore[row][col] !== 0) return null;
            const nb = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            nb[row][col] = playerVal;
            return nb;
        }

        function tryCaptureBoardZL(boardBefore, row, col) {
            const size = ps.BOARD_SIZE;
            if (boardBefore[row][col] === 0) return null;
            if (QiWeiqiSquarePageRuntime.countGroupLiberties(boardBefore, row, col, size) !== 0) return null;
            const nb = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            QiWeiqiSquarePageRuntime.removeGroup(nb, row, col, boardBefore[row][col], size);
            return nb;
        }

        function zlRebuildLiveReplayFromMoveCoords(moveCoords, openingBoard) {
            let curBoard = openingBoard
                ? QiSquareWeiqiCanvas.deepCopyBoard(openingBoard)
                : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
            const liveReplayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(curBoard)];
            const liveReplayMarkers = [[]];
            const liveReplayStepPlayers = [0];
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = zlTryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'capture') {
                    const capColor = curBoard[move.row][move.col];
                    const newBoard = tryCaptureBoardZL(curBoard, move.row, move.col);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    liveReplayMarkers.push(capColor ? [{ row: move.row, col: move.col, color: capColor }] : []);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
            }
            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
        }
        function zlApplyLiveReplayIncremental(moveCoords) {
            const startLen = ps.liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            let curBoard = QiSquareWeiqiCanvas.deepCopyBoard(ps.liveReplayBoards[ps.liveReplayBoards.length - 1]);
            for (let i = startLen; i < mcs.length; i++) {
                const move = mcs[i];
                const playerVal = move.player === 'black' ? 1 : 2;
                ps.liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = zlTryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'capture') {
                    const capColor = curBoard[move.row][move.col];
                    const newBoard = tryCaptureBoardZL(curBoard, move.row, move.col);
                    if (newBoard) curBoard = newBoard;
                    ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push(capColor ? [{ row: move.row, col: move.col, color: capColor }] : []);
                } else if (move.type === 'pass') {
                    ps.liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([]);
                } else { return false; }
            }
            return true;
        }

        function zlSyncLiveReplayFromState(state) {
            const mcs = state.moveCoords || [];
            const syncedLen = ps.liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (zlApplyLiveReplayIncremental(mcs)) return;
            }
            zlRebuildLiveReplayFromMoveCoords(mcs, (ps.liveOpeningBoard != null ? ps.liveOpeningBoard : state.initialBoard));
        }

        function zlBuildReplayFromImportData(data) {
            let curBoard = QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
            if (data.initialPosition && Array.isArray(data.initialPosition)) {
                QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, ps.BOARD_SIZE, data.initialPosition);
            }
            const replayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(curBoard)];
            const replayMarkers = [[]];
            const replayStepPlayers = [0];
            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = zlTryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'capture') {
                    const capColor = curBoard[move.row][move.col];
                    const newBoard = tryCaptureBoardZL(curBoard, move.row, move.col);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    replayMarkers.push(capColor ? [{ row: move.row, col: move.col, color: capColor }] : []);
                } else if (move.type === 'pass') {
                    replayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                    replayMarkers.push([]);
                }
            }
            return {
                replayBoards,
                replayMarkers,
                replayStepPlayers,
                replayTotalSteps: replayBoards.length - 1
            };
        }

        function zlEnterReplayMode(data, pageHolder) {
            const built = zlBuildReplayFromImportData(data);
            ps.replayBoards = built.replayBoards;
            ps.replayMarkers = built.replayMarkers;
            ps.replayStepPlayers = built.replayStepPlayers;
            ps.replayTotalSteps = built.replayTotalSteps;
            ps.replayMode = true;
            const slider = document.getElementById('replaySlider');
            slider.max = ps.replayTotalSteps;
            pageHolder.page.setReplayStep(ps.replayTotalSteps);
            pageHolder.page.updateReplayUI();
        }

        function zlTryPlayMove(row, col, pageHolder) {
            const page = pageHolder.page;
            let newBoard;
            let markers;
            if (ps.board[row][col] === 0) {
                const playerVal = ps.tryPlayCurrentPlayer;
                newBoard = page.tryPlaceStone(ps.board, row, col, playerVal);
                if (!newBoard) return false;
                markers = [{ row, col, color: playerVal }];
            } else {
                const capColor = ps.board[row][col];
                newBoard = tryCaptureBoardZL(ps.board, row, col);
                if (!newBoard) return false;
                markers = [{ row, col, color: capColor }];
            }
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
            }
            ps.tryPlayBoards.push(page.deepCopyBoard(newBoard));
            ps.tryPlayMarkers.push(markers);
            ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
            ps.board = page.deepCopyBoard(newBoard);
            ps.lastMoveMarkers = markers.map(m => ({ ...m }));
            const slider = document.getElementById('replaySlider');
            slider.max = ps.tryPlayTotalSteps;
            slider.value = ps.tryPlayStep;
            page.updateTryPlayDisplay();
            if (ps.showEstimateActive) page.showEstimate();
            else page.drawBoard();
            return true;
        }

        function commitCapture(row, col) {
            if (ps.gameOver) return false;
            if (!ps.isMyTurn) return false;
            if (ps.board[row][col] === 0) return false;
            if (QiWeiqiSquarePageRuntime.countGroupLiberties(ps.board, row, col, ps.BOARD_SIZE) !== 0) return false;
            ps.ws.send(JSON.stringify({ type: 'capture', row, col }));
            return true;
        }

        function zeroLibertySyncState(state, pageHolder) {
            const page = pageHolder.page;
            const incomingMoveLen = (state.moveCoords && state.moveCoords.length) || 0;
            const prevSyncedLen = ps._syncMoveCoordsLen;
            const incomingNH = state.numberOfHands || 1;
            const incomingGO = state.gameOver || false;
            const sizeWillChange = !!(state.boardSize && state.boardSize !== ps.BOARD_SIZE);
            const handsChanged = incomingNH !== ps.numberOfHands;
            const gameOverChanged = incomingGO !== ps.gameOver;
            const playerChanged = state.currentPlayer !== undefined && state.currentPlayer !== ps.currentPlayer;
            const moveListChanged = incomingMoveLen !== (prevSyncedLen !== undefined ? prevSyncedLen : -1);
            if (sizeWillChange || handsChanged || gameOverChanged || playerChanged || moveListChanged)
                page.clearMobileMovePreview();
            if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = state.boardSize;
                if (state.komi != null) ps.KOMI = state.komi;
                ps.board = page.initBoardArray(ps.BOARD_SIZE);
                page.updateBoardGeometry();
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (sizeSelect) sizeSelect.value = ps.BOARD_SIZE;
            }
            ps.numberOfHands = state.numberOfHands || 1;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            if (state.moveCoords) {
                ps.moveLog = state.moveCoords.map(m => {
                    if (m.type === 'move') return { row: m.row, col: m.col };
                    if (m.type === 'capture') return { capture: true, row: m.row, col: m.col };
                    return null;
                });
            }
            if (state.slots)
                ps.slots = state.slots;
            if (state.matchTime !== undefined)
                ps.matchTime = state.matchTime;
            if (state.matchStarted !== undefined)
                ps.matchStarted = !!state.matchStarted;
            if (ps.matchStarted) ps.matchStartedOnce = true;
            if (
                ps.numberOfHands <= 1
                && !ps.gameOver
                && !(ps.slots && ps.slots.black && ps.slots.white)
                && !(ps.matchTime && ps.matchTime.settings)
            ) {
                ps.matchStartedOnce = false;
            }

            if (!ps.replayMode) {
                const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                zlSyncLiveReplayFromState(state);;
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
                if (!ps.tryPlayMode) {
                    page.applyLiveViewBoard();
                    page.updateLiveReplayPanelUI();
                }
            } else if (!ps.tryPlayMode) {
                ps.board = state.board;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (!hasAnyStone && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                sizeSelect.style.display = 'inline-block';
            else
                sizeSelect.style.display = 'none';

            if (ps.showEstimateActive) {
                ps.cachedLiveBoard = page.removeDeadAndDying(ps.board);
                ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard);
                page.showEstimate();
            } else {
                page.updateTurn();
            }
            page.updateReplayUI();
            ps._syncMoveCoordsLen = incomingMoveLen;
        }

        const pageHolder = {};

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
            tryPlaceStone: zlTryPlaceStone,
            removeDeadAndDying: (src) => QiSquareWeiqiCanvas.deepCopyBoard(src),
            rebuildLiveReplayFromMoveCoords: (m, opening) => zlRebuildLiveReplayFromMoveCoords(m, opening),
            enterReplayMode: (data) => zlEnterReplayMode(data, pageHolder),
            // enter/exit/setTryPlayStep 走公共试下；仅落子需支持「点零气子提子」
            tryPlayMove: (row, col) => zlTryPlayMove(row, col, pageHolder),
            syncState: (state) => zeroLibertySyncState(state, pageHolder)
        });
        pageHolder.page = page;
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
            countGroupLiberties,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
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
            standardWeiqiMatchTime,
            boardSeatOverlay: true
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
            const m2 = mobileTwoStepPlacing();

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (m2) { clearMobileMovePreview(); drawBoard(); }
                    return;
                }
                const canPlace = ps.board[row][col] === 0;
                const canCap = ps.board[row][col] !== 0 && countGroupLiberties(ps.board, row, col) === 0;
                if (!canPlace && !canCap) return;
                if (m2) {
                    const cap = canCap;
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid && ps.hoverCapture === cap) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        ps.hoverCapture = cap;
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
                if (m2) { clearMobileMovePreview(); drawBoard(); }
                return;
            }
            if (ps.board[row][col] === 0) {
                if (m2) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid && !ps.hoverCapture) {
                        clearMobileMovePreview();
                        commitMove(row, col);
                        drawBoard();
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        ps.hoverCapture = false;
                        drawBoard();
                    }
                    return;
                }
                commitMove(row, col);
            } else {
                const canCap = countGroupLiberties(ps.board, row, col) === 0;
                if (!canCap) {
                    if (m2) { clearMobileMovePreview(); drawBoard(); }
                    return;
                }
                if (m2) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid && ps.hoverCapture) {
                        clearMobileMovePreview();
                        commitCapture(row, col);
                        drawBoard();
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        ps.hoverCapture = true;
                        drawBoard();
                    }
                    return;
                }
                commitCapture(row, col);
            }
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) {
                        ps.isHoverValid = false;
                        ps.hoverCapture = false;
                        ps.hoverRow = -1;
                        ps.hoverCol = -1;
                        drawBoard();
                    }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row;
                ps.hoverCol = col;
                ps.hoverCapture = false;
                if (row >= 0 && col >= 0) {
                    if (ps.board[row][col] === 0) {
                        ps.isHoverValid = true;
                    } else if (countGroupLiberties(ps.board, row, col) === 0) {
                        ps.isHoverValid = true;
                        ps.hoverCapture = true;
                    } else {
                        ps.isHoverValid = false;
                    }
                } else {
                    ps.isHoverValid = false;
                }
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverCapture = false;
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    drawBoard();
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
