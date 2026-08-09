window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['greedy-weiqi'] = {
    shell: {
        "title": "贪吃围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />有提子时必须提子；若有多个可提子点，则必须走提子数量最多的点；若有多个最多的点，可任选其一。<br /><br />",
        "defaultKomiText": "黑贴白2.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "贪吃围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "贪吃围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        function greedyKomiForSize(boardSize) {
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
            KOMI: greedyKomiForSize(19),
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
            candidates: [],
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

        function countOpponentCaptures(boardBefore, boardAfter, playerVal) {
            const enemy = 3 - playerVal;
            let before = 0;
            let after = 0;
            const n = ps.BOARD_SIZE;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (boardBefore[r][c] === enemy) before++;
                    if (boardAfter[r][c] === enemy) after++;
                }
            }
            return before - after;
        }

        function basePlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 1
            );
        }

        function boardToString(brd) {
            return brd.map(row => row.join(',')).join(';');
        }

        function hasStrictlyBetterCapture(boardBefore, playerVal, myCap, skipRow, skipCol, histSet) {
            const n = ps.BOARD_SIZE;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (boardBefore[r][c] !== 0) continue;
                    if (r === skipRow && c === skipCol) continue;
                    const nb = basePlaceStone(boardBefore, r, c, playerVal);
                    if (!nb) continue;
                    if (histSet && histSet.has(boardToString(nb))) continue;
                    if (countOpponentCaptures(boardBefore, nb, playerVal) > myCap) return true;
                }
            }
            return false;
        }

        function greedyTryPlaceStone(boardBefore, row, col, playerVal, histSet) {
            const newBoard = basePlaceStone(boardBefore, row, col, playerVal);
            if (!newBoard) return null;
            const myCap = countOpponentCaptures(boardBefore, newBoard, playerVal);
            if (hasStrictlyBetterCapture(boardBefore, playerVal, myCap, row, col, histSet || null)) return null;
            return newBoard;
        }

        // 供 create() 使用：正式对局走贪吃规则；试下同普通围棋（不强制有提必提）
        function greedyTryPlaceStoneForPage(boardBefore, row, col, playerVal) {
            if (ps.tryPlayMode) return basePlaceStone(boardBefore, row, col, playerVal);
            return greedyTryPlaceStone(boardBefore, row, col, playerVal, null);
        }

        function computeMaxCaptureCandidates(boardBefore, playerVal, histSet) {
            const n = ps.BOARD_SIZE;
            let maxCap = 0;
            const scored = [];
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (boardBefore[r][c] !== 0) continue;
                    const nb = basePlaceStone(boardBefore, r, c, playerVal);
                    if (!nb) continue;
                    if (histSet && histSet.has(boardToString(nb))) continue;
                    const cap = countOpponentCaptures(boardBefore, nb, playerVal);
                    if (cap > 0) scored.push({ row: r, col: c, cap });
                    if (cap > maxCap) maxCap = cap;
                }
            }
            if (maxCap <= 0) return [];
            return scored.filter(p => p.cap === maxCap).map(p => ({ row: p.row, col: p.col }));
        }

        function browsingLiveHistory() {
            const tip = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            return !ps.replayMode && ps.liveReplayBoards.length > 0 && ps.liveViewStep < tip;
        }

        function mustCaptureActive() {
            return !ps.tryPlayMode && !ps.gameOver && !ps.showEstimateActive
                && !browsingLiveHistory() && ps.candidates.length > 0;
        }

        function isCandidatePoint(row, col) {
            return ps.candidates.some(p => p.row === row && p.col === col);
        }

        function refreshCandidatesFromBoard() {
            if (ps.gameOver || ps.tryPlayMode || browsingLiveHistory()) {
                ps.candidates = [];
                return;
            }
            const playerVal = ps.currentPlayer === 1 ? 1 : 2;
            ps.candidates = computeMaxCaptureCandidates(ps.board, playerVal, null);
        }

        function drawBoardGreedy() {
            const C = QiSquareWeiqiCanvas;
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
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, (r, c) => {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                if (mustCaptureActive() && isCandidatePoint(r, c)) return false;
                return true;
            });
            if (ps.showMoveNumbers) {
                const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
                if (ps.replayMode && ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const markers = ps.tryPlayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const markers = ps.replayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                } else {
                    const upto = ps.liveViewStep || 0;
                    for (let i = 1; i <= upto; i++) {
                        const markers = ps.liveReplayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                }
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            if (mustCaptureActive()) {
                ctx.globalAlpha = 0.7;
                const playerColor = ps.currentPlayer === 1 ? '#222' : '#fff';
                const sh = cellSize * 0.18;
                for (const { row, col } of ps.candidates) {
                    const x = ps.PADDING + col * cellSize;
                    const y = ps.PADDING + row * cellSize;
                    ctx.fillStyle = playerColor;
                    ctx.fillRect(x - sh, y - sh, sh * 2, sh * 2);
                }
                ctx.globalAlpha = 1;
            }
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid,
                hoverCapture: !!ps.hoverCapture,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool
            });
            if (ps.hoverCapture) {
                d.hoverCaptureRing(ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                    tryPlayMode: ps.tryPlayMode,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture
                });
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
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
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            tryPlaceStone: greedyTryPlaceStoneForPage,
            drawBoard: drawBoardGreedy,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const ob = ps.liveOpeningBoard;
                const createEmpty = () => ob
                    ? QiSquareWeiqiCanvas.deepCopyBoard(ob)
                    : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
                let curBoard = createEmpty();
                const histSet = new Set([boardToString(curBoard)]);
                const liveReplayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(curBoard)];
                const liveReplayMarkers = [[]];
                const liveReplayStepPlayers = [0];
                for (const move of (moveCoords || [])) {
                    const playerVal = move.player === 'black' ? 1 : 2;
                    liveReplayStepPlayers.push(playerVal);
                    if (move.type === 'move') {
                        const newBoard = greedyTryPlaceStone(curBoard, move.row, move.col, playerVal, histSet);
                        if (newBoard) {
                            curBoard = newBoard;
                            histSet.add(boardToString(curBoard));
                        }
                        liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                        liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                    } else if (move.type === 'pass') {
                        liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(curBoard));
                        liveReplayMarkers.push([]);
                    }
                }
                ps.liveReplayBoards = liveReplayBoards;
                ps.liveReplayMarkers = liveReplayMarkers;
                ps.liveReplayStepPlayers = liveReplayStepPlayers;
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
            if (Array.isArray(state.candidates)) {
                ps.candidates = state.candidates.map(c => ({ row: c.row, col: c.col }));
            } else {
                refreshCandidatesFromBoard();
            }
            updateEditModeUI();
        }

        function setLiveViewStepGreedy(step) {
            setLiveViewStep(step);
            drawBoard();
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
            setLiveViewStep: setLiveViewStepGreedy,
            getWs: () => ps.ws,
            getBoardSize: () => ps.BOARD_SIZE,
            setBoardSize: (n) => {
                ps.BOARD_SIZE = n;
                ps.KOMI = greedyKomiForSize(n);
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

        const passBtn = document.getElementById('passBtn');
        if (passBtn) {
            passBtn.addEventListener('click', (e) => {
                if (!ps.ws || ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
                // 试下/回放中不走服务器虚着
                if (ps.tryPlayMode || ps.replayMode) return;
                if (mustCaptureActive() || ps.candidates.length > 0) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    if (typeof qiAlert === 'function') qiAlert('必须提子。');
                }
            }, true);
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

            if (mustCaptureActive() && !isCandidatePoint(row, col)) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoard();
                if (typeof qiAlert === 'function') qiAlert('必须提子');
                return;
            }

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = !mustCaptureActive() || isCandidatePoint(row, col);
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
                const empty = row >= 0 && col >= 0 && ps.board[row][col] === 0;
                if (mustCaptureActive()) {
                    ps.isHoverValid = empty && isCandidatePoint(row, col);
                } else {
                    ps.isHoverValid = empty;
                }
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
