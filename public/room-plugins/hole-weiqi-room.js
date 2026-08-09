window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['hole-weiqi'] = {
    shell: {
        "title": "洞围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />开局时在棋盘上随机洞（数量约为棋盘总点数的8.3%），洞内不能落子且不提供气。<br /><br /><br /><br /><i>老家的旧棋盘破了几个窟窿！</i><br /><br />",
        "defaultKomiText": "黑贴白3.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 31,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "洞围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": false,
            "holeStyle": true
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
            },
            {
                "value": "hole",
                "label": "洞"
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "洞围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const ps = {
            BOARD_SIZE: 19,
            KOMI: 3.75,
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
            holes: [],
            liveOpeningBoard: null,
            holeDisplayStyle: 'block',
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
        const styleSelect = document.getElementById('styleSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const R = () => QiWeiqiSquarePageRuntime;

        const holeStyleKey = `holeWeiqiDisplayStyle_${gameType}`;
        try {
            const s = localStorage.getItem(holeStyleKey);
            if (s === 'hole' || s === 'block' || s === 'void') {
                ps.holeDisplayStyle = s;
                if (styleSelect) styleSelect.value = s;
            }
        } catch (e) { /* ignore */ }

        if (styleSelect) {
            styleSelect.addEventListener('change', () => {
                ps.holeDisplayStyle = styleSelect.value;
                try { localStorage.setItem(holeStyleKey, ps.holeDisplayStyle); } catch (e) { /* ignore */ }
                drawBoard();
            });
        }

        function holeTryPlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 1
            );
        }

        function isStoneVal(v) {
            return v === 1 || v === 2;
        }

        function holeComputeStoneNumbers() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col]))
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.replayMode) {
                for (let i = 1; i <= ps.replayStep; i++) {
                    const markers = ps.replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col]))
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) {
                    const markers = ps.liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col]))
                            nums[m.row][m.col] = i;
                    }
                }
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && m.row != null && m.col != null
                        && m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col]))
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function isHoleCell(r, c) {
            return r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE && ps.board[r][c] === -1;
        }

        /** 与扫雷围棋「洞」样式一致：仅在两端均非洞时绘制网格线段 */
        function holeDrawGridMinesweeperStyle() {
            const z = ps.CELL_SIZE;
            const n = ps.BOARD_SIZE;
            const pad = ps.PADDING;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#3a281c';
            for (let c = 0; c < n; c++) {
                for (let r = 0; r < n - 1; r++) {
                    if (ps.board[r][c] !== -1 && ps.board[r + 1][c] !== -1) {
                        ctx.beginPath();
                        ctx.moveTo(pad + c * z, pad + r * z);
                        ctx.lineTo(pad + c * z, pad + (r + 1) * z);
                        ctx.stroke();
                    }
                }
            }
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n - 1; c++) {
                    if (ps.board[r][c] !== -1 && ps.board[r][c + 1] !== -1) {
                        ctx.beginPath();
                        ctx.moveTo(pad + c * z, pad + r * z);
                        ctx.lineTo(pad + (c + 1) * z, pad + r * z);
                        ctx.stroke();
                    }
                }
            }
        }

        /** 与扫雷围棋一致：天元/星位落在洞上时不画 */
        function holeDrawStarPointsSkipHoles() {
            const z = ps.CELL_SIZE;
            const pad = ps.PADDING;
            ctx.fillStyle = '#3a281c';
            for (const [r, c] of QiSquareWeiqiCanvas.getStarPoints(ps.BOARD_SIZE)) {
                if (r >= ps.BOARD_SIZE || c >= ps.BOARD_SIZE) continue;
                if (ps.board[r][c] === -1) continue;
                ctx.beginPath();
                ctx.arc(pad + c * z, pad + r * z, z * 0.12, 0, 2 * Math.PI);
                ctx.fill();
            }
        }

        function holeDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            const isHole = (r, c) => isHoleCell(r, c);
            if (ps.holeDisplayStyle === 'hole')
            {
                for (let r = 0; r < ps.BOARD_SIZE; r++)
                {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) 
                    {
                        if (ps.board[r][c] === -1)
                            R().drawPitHole(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE, isHole);
                    }
                }
                holeDrawGridMinesweeperStyle();
                holeDrawStarPointsSkipHoles();
                d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            } 
            else 
            {
                d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
                d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                
                for (let r = 0; r < ps.BOARD_SIZE; r++)
                {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) 
                    {
                        if (ps.board[r][c] !== -1)
                            continue;
                        if (ps.holeDisplayStyle === 'block')
                            R().drawRedBlockHole(r, c, ctx, ps.PADDING, cellSize);
                        else if (ps.holeDisplayStyle === 'void') 
                            R().drawVoidHole(r, c, ctx, ps.PADDING, cellSize, ps.BOARD_SIZE);
                    }
                }
            }
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
            function isUserBoardMarkVisibleAt(br, bc) {
                if (ps.showEstimateActive) return false;
                if (br < 0 || br >= ps.BOARD_SIZE || bc < 0 || bc >= ps.BOARD_SIZE) return false;
                if (ps.board[br][bc] !== 0) return false;
                return true;
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = holeComputeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
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

        const pageHolder = {};
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
            tryPlaceStone: holeTryPlaceStone,
            drawBoard: holeDrawBoard,
            removeDeadAndDying: (src) => R().removeDeadAndDying(src, ps.BOARD_SIZE, (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 2),
            assignTerritoryWithRange: (live) => R().assignTerritoryWithRange(live, ps.BOARD_SIZE),
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const ob = ps.liveOpeningBoard;
                const o = R().rebuildLiveReplayFromMoveCoords(
                    moveCoords,
                    holeTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    () => ob ? QiSquareWeiqiCanvas.deepCopyBoard(ob) : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE)
                );
                ps.liveReplayBoards = o.liveReplayBoards;
                ps.liveReplayMarkers = o.liveReplayMarkers;
                ps.liveReplayStepPlayers = o.liveReplayStepPlayers;
            },
            enterReplayMode(data) {
                function createEmptyBoard() {
                    return QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
                }
                const built = R().buildReplayFromImportData(
                    { initialPosition: data.initialPosition, moves: data.moves || [] },
                    holeTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    createEmptyBoard
                );
                ps.replayBoards = built.replayBoards;
                ps.replayMarkers = built.replayMarkers;
                ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps;
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                const p = pageHolder.page;
                if (p) {
                    p.setReplayStep(ps.replayTotalSteps);
                    p.updateReplayUI();
                }
            }
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
            ps.holes = state.holes || [];
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
            setBoardSize: (n) => { ps.BOARD_SIZE = n; },
            getKomi: () => ps.KOMI,
            setKomi: (n) => { ps.KOMI = n; },
            getBoard: () => ps.board.map(row => row.map(c => (c === -1 ? 0 : c))),
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
            },
            onBoardSizeChanged(msg) {
                syncState(msg);
            }
        });
        function handleMessage(msg) {
            _weiqiBindings.handleMessage(msg);
            if (msg.type === 'boardSizeChanged') _weiqiBindings.updateRadioStyles();
        }
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
