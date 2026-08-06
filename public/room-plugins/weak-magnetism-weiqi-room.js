window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['weak-magnetism-weiqi'] = {
    shell: {
        "title": "弱磁性围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />棋子具有弱磁性。落子时，上下左右四个方向上最近的棋子都会受到磁力影响尝试移动一格：己方棋子远离落子点一格，对方棋子靠近落子点一格；若目标格已有棋子或在棋盘外则不移动。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "弱磁性围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "弱磁性围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
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
            moveCoordsFull: null,
            replayMovesFull: null
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

        function magneticRemoveDeadGroupsClient(board, boardSize) {
            let changed;
            do {
                changed = false;
                for (let i = 0; i < boardSize; i++) {
                    for (let j = 0; j < boardSize; j++) {
                        const val = board[i][j];
                        if (val !== 0 && !QiWeiqiSquarePageRuntime.hasLiberty(board, i, j, boardSize)) {
                            QiWeiqiSquarePageRuntime.removeGroup(board, i, j, val, boardSize);
                            changed = true;
                        }
                    }
                }
            } while (changed);
        }

        function magneticApplyMoveWeakClient(board, row, col, playerVal, boardSize) {
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            for (const [dr, dc] of dirs) {
                let step = 1;
                let targetR = -1;
                let targetC = -1;
                while (true) {
                    const nr = row + dr * step;
                    const nc = col + dc * step;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) break;
                    if (board[nr][nc] !== 0) {
                        targetR = nr;
                        targetC = nc;
                        break;
                    }
                    step++;
                }
                if (targetR === -1) continue;
                const targetColor = board[targetR][targetC];
                const moveDr = (targetColor === playerVal) ? dr : -dr;
                const moveDc = (targetColor === playerVal) ? dc : -dc;
                const newR = targetR + moveDr;
                const newC = targetC + moveDc;
                if (newR >= 0 && newR < boardSize && newC >= 0 && newC < boardSize && board[newR][newC] === 0) {
                    board[newR][newC] = targetColor;
                    board[targetR][targetC] = 0;
                }
            }
            return board;
        }

        function weakMagneticTryPlaceStone(boardBefore, row, col, playerVal) {
            const boardSize = ps.BOARD_SIZE;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            newBoard[row][col] = playerVal;
            magneticApplyMoveWeakClient(newBoard, row, col, playerVal, boardSize);
            magneticRemoveDeadGroupsClient(newBoard, boardSize);
            return newBoard;
        }

        function removeGroupWithNum(board, numGrid, row, col, color, boardSize) {
            const queue = [[row, col]];
            board[row][col] = 0;
            numGrid[row][col] = 0;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        numGrid[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function magneticRemoveDeadGroupsClientWithNum(board, numGrid, boardSize) {
            let changed;
            do {
                changed = false;
                for (let i = 0; i < boardSize; i++) {
                    for (let j = 0; j < boardSize; j++) {
                        const val = board[i][j];
                        if (val !== 0 && !QiWeiqiSquarePageRuntime.hasLiberty(board, i, j, boardSize)) {
                            removeGroupWithNum(board, numGrid, i, j, val, boardSize);
                            changed = true;
                        }
                    }
                }
            } while (changed);
        }

        function magneticApplyMoveWeakClientWithNum(board, numGrid, row, col, playerVal, boardSize) {
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            for (const [dr, dc] of dirs) {
                let step = 1;
                let targetR = -1;
                let targetC = -1;
                while (true) {
                    const nr = row + dr * step;
                    const nc = col + dc * step;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) break;
                    if (board[nr][nc] !== 0) {
                        targetR = nr;
                        targetC = nc;
                        break;
                    }
                    step++;
                }
                if (targetR === -1) continue;
                const targetColor = board[targetR][targetC];
                const moveDr = (targetColor === playerVal) ? dr : -dr;
                const moveDc = (targetColor === playerVal) ? dc : -dc;
                const newR = targetR + moveDr;
                const newC = targetC + moveDc;
                if (newR >= 0 && newR < boardSize && newC >= 0 && newC < boardSize && board[newR][newC] === 0) {
                    board[newR][newC] = targetColor;
                    board[targetR][targetC] = 0;
                    const t = numGrid[targetR][targetC];
                    numGrid[targetR][targetC] = numGrid[newR][newC];
                    numGrid[newR][newC] = t;
                }
            }
            return board;
        }

        function weakMagneticTryPlaceStoneWithNum(boardBefore, numGridBefore, row, col, playerVal, moveNum) {
            const boardSize = ps.BOARD_SIZE;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            const newNum = numGridBefore.map(r => r.slice());
            newBoard[row][col] = playerVal;
            newNum[row][col] = moveNum;
            magneticApplyMoveWeakClientWithNum(newBoard, newNum, row, col, playerVal, boardSize);
            magneticRemoveDeadGroupsClientWithNum(newBoard, newNum, boardSize);
            return { board: newBoard, numGrid: newNum };
        }

        function emptyNumGrid(n) {
            return Array(n).fill().map(() => Array(n).fill(0));
        }

        function computeWeakMagneticStoneNumbers() {
            const n = ps.BOARD_SIZE;
            const applySeq = (moves, upTo) => {
                let numGrid = emptyNumGrid(n);
                let board = QiSquareWeiqiCanvas.initBoardArray(n);
                let mi = 0;
                const lim = upTo == null ? moves.length : upTo;
                for (let j = 0; j < lim; j++) {
                    const mv = moves[j];
                    if (!mv || mv.type === 'pass') continue;
                    if (mv.type !== 'move') continue;
                    mi++;
                    const pv = mv.player === 'black' ? 1 : 2;
                    const r = weakMagneticTryPlaceStoneWithNum(board, numGrid, mv.row, mv.col, pv, mi);
                    if (r) {
                        board = r.board;
                        numGrid = r.numGrid;
                    }
                }
                return numGrid;
            };

            if (ps.replayMode && ps.tryPlayMode) {
                let numGrid = emptyNumGrid(n);
                let board = QiSquareWeiqiCanvas.initBoardArray(n);
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        const r = weakMagneticTryPlaceStoneWithNum(board, numGrid, m.row, m.col, m.color, i);
                        if (r) {
                            board = r.board;
                            numGrid = r.numGrid;
                        }
                    }
                }
                return numGrid;
            }
            if (ps.replayMode) {
                const moves = ps.replayMovesFull || [];
                return applySeq(moves, ps.replayStep);
            }
            if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                const moves = ps.moveCoordsFull || [];
                return applySeq(moves, ps.liveViewStep);
            }
            return applySeq(ps.moveCoordsFull || [], null);
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
        function weakMagneticDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const dom = domPage;
            d.clear(dom.ctx, cs);
            d.grid(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
            }
            function isUserBoardMarkVisibleAt(r, c) {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                return true;
            }
            d.userBoardMarks(dom.ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = computeWeakMagneticStoneNumbers();
                d.moveNumbersOnStones(dom.ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(dom.ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid,
                hoverCapture: !!ps.hoverCapture
            });
            if (ps.hoverCapture) {
                d.hoverCaptureRing(dom.ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                    tryPlayMode: ps.tryPlayMode,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture
                });
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        }

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            tryPlaceStone: weakMagneticTryPlaceStone,
            drawBoard: weakMagneticDrawBoard,
            enterReplayMode(data) {
                ps.replayMovesFull = data.moves || [];
                const built = QiWeiqiSquarePageRuntime.buildReplayFromImportData(
                    data,
                    weakMagneticTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    () => pageHolder.page.initBoardArray(ps.BOARD_SIZE)
                );
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
            exitReplayMode: exitReplayModeBase,
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
            applyUserBoardMark
        } = page;

        function syncState(state) {
            if (state.moveCoords) ps.moveCoordsFull = state.moveCoords;
            syncStateBase(state);
        }

        function exitReplayMode() {
            ps.replayMovesFull = null;
            exitReplayModeBase();
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
            timeControlMainByoScale: 2
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
