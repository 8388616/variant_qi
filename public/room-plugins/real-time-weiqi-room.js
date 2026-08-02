window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['real-time-weiqi'] = {
    shell: {
        "title": "RealTime围棋",
        "rulesHtml": "基本规则与围棋相同，但采用<strong>即时制</strong>。",
        "defaultKomiText": "无贴目",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "RealTime围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": true
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "RealTime围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        const ps = {
            BOARD_SIZE: 19,
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
            /** 棋盘局部缩放（与 qi.js QiWeiqiSquarePageRuntime 视口变换配合） */
            viewZoom: 1,
            viewCenterX: 300,
            viewCenterY: 300
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
        })();

document.body.classList.add('qi-page-real-time-weiqi');

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

        const BOARD_VIEW_CS = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
        let boardScrollbarProgrammatic = false;

        function viewCenterBoundsForScrollbars() {
            const z = Math.max(1, Math.min(10, ps.viewZoom || 1));
            const half = (BOARD_VIEW_CS / 2) / z;
            return {
                minX: half,
                maxX: BOARD_VIEW_CS - half,
                minY: half,
                maxY: BOARD_VIEW_CS - half
            };
        }

        function clampBoardView() {
            let z = ps.viewZoom;
            if (!Number.isFinite(z)) z = 1;
            z = Math.max(1, Math.min(10, z));
            ps.viewZoom = z;
            if (z <= 1) {
                ps.viewCenterX = BOARD_VIEW_CS / 2;
                ps.viewCenterY = BOARD_VIEW_CS / 2;
                return;
            }
            const half = (BOARD_VIEW_CS / 2) / z;
            ps.viewCenterX = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterX));
            ps.viewCenterY = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterY));
        }

        function applyZoomKeepingScreenPoint(ssx, ssy, zNew) {
            const z0 = ps.viewZoom;
            const cs = BOARD_VIEW_CS;
            const Lx = (ssx - cs / 2) / z0 + ps.viewCenterX;
            const Ly = (ssy - cs / 2) / z0 + ps.viewCenterY;
            ps.viewZoom = zNew;
            ps.viewCenterX = Lx - (ssx - cs / 2) / zNew;
            ps.viewCenterY = Ly - (ssy - cs / 2) / zNew;
            clampBoardView();
        }

        function syncScrollbarsFromView() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            if (ps.viewZoom <= 1) {
                sx.style.display = 'none';
                sy.style.display = 'none';
                return;
            }
            sx.style.display = 'block';
            sy.style.display = 'block';
            const b = viewCenterBoundsForScrollbars();
            const spanX = b.maxX - b.minX;
            const spanY = b.maxY - b.minY;
            boardScrollbarProgrammatic = true;
            sx.value = spanX > 1e-6 ? String(Math.round((ps.viewCenterX - b.minX) / spanX * 1000)) : '500';
            sy.value = spanY > 1e-6 ? String(Math.round((b.maxY - ps.viewCenterY) / spanY * 1000)) : '500';
            boardScrollbarProgrammatic = false;
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
            recordDownloadPrefix,
            komiInfoText: '无贴目',
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            afterDrawBoard: syncScrollbarsFromView
        });
        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard: drawBoardCore,
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
            getClosestIntersection,
            canvasCoordsFromClient,
            boardScreenPointFromClient,
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard: drawBoardCore,
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
        const weiqiHandleMessageInner = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        /** 限时协商：隐藏步时/超时次数，提交 0；应答提示仅保留「05:00」形式 */
        function rtTcNormalizeNegotiationUi() {
            if (!document.body.classList.contains('qi-page-real-time-weiqi')) return;
            const modal = document.querySelector('.qi-time-control-modal');
            if (!modal || modal.style.display === 'none') return;
            document.querySelectorAll('.qi-time-control-fields label.qi-time-control-field').forEach((lab) => {
                if (lab.querySelector('#qiTcByoSec') || lab.querySelector('#qiTcMaxT'))
                    lab.style.display = 'none';
            });
            const byo = document.getElementById('qiTcByoSec');
            const maxt = document.getElementById('qiTcMaxT');
            if (byo) byo.value = '0';
            if (maxt) maxt.value = '0';
            const hint = document.getElementById('qiTcHint');
            if (!hint || !hint.textContent) return;
            const t = hint.textContent.trim();
            if (t === '对方提议：不限时') return;
            const m = /^对方提议：(\d{2}:\d{2}(?::\d{2})?) \d+秒\d+次$/.exec(t);
            if (m) hint.textContent = `对方提议：${m[1]}`;
        }

        (function rtTcObserveNegotiationModal() {
            const obs = new MutationObserver(() => rtTcNormalizeNegotiationUi());
            obs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true });
        })();

        function lastMoveMarkerKey() {
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return '';
            return `${m.row},${m.col},${m.color}`;
        }

        function maybeCenterViewOnOpponentMove(msg, keyBefore) {
            if (ps.viewZoom <= 1 || !ps.mySlot || ps.replayMode || ps.tryPlayMode) return;
            if (msg.type !== 'broadcast' && msg.type !== 'gameState') return;
            if (msg.type === 'broadcast' && msg.action !== 'move') return;
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return;
            if (lastMoveMarkerKey() === keyBefore) return;
            const oppColor = ps.mySlot === 'black' ? 2 : 1;
            if (m.color !== oppColor) return;
            ps.viewCenterX = ps.PADDING + m.col * ps.CELL_SIZE;
            ps.viewCenterY = ps.PADDING + m.row * ps.CELL_SIZE;
            clampBoardView();
            drawBoardCore();
        }

        function fixInstantWeiqiPlacement() {
            if (ps.replayMode || ps.tryPlayMode) return;
            ps.isMyTurn = !!(ps.matchStarted && ps.mySlot && !ps.gameOver && !ps.waitingScoreConfirm);
            drawBoardCore();
        }

        function handleMessage(msg) {
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
            fixInstantWeiqiPlacement();
            queueMicrotask(rtTcNormalizeNegotiationUi);
            maybeCenterViewOnOpponentMove(msg, mkBefore);
        }

        let suppressCanvasClickAfterLongMark = false;
        let suppressCanvasClickAfterPan = false;

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }

        (function initWeiqiBoardScrollbars() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            function applyFromSliders() {
                if (boardScrollbarProgrammatic) return;
                if (ps.viewZoom <= 1) return;
                const b = viewCenterBoundsForScrollbars();
                const tx = Number(sx.value) / 1000;
                const ty = 1 - Number(sy.value) / 1000;
                ps.viewCenterX = b.minX + tx * (b.maxX - b.minX);
                ps.viewCenterY = b.minY + ty * (b.maxY - b.minY);
                clampBoardView();
                drawBoardCore();
            }
            sx.addEventListener('input', applyFromSliders);
            sy.addEventListener('input', applyFromSliders);
        })();

        canvas.addEventListener('wheel', (e) => {
            const z0 = ps.viewZoom;
            const z1 = Math.max(1, Math.min(10, z0 * Math.exp(-e.deltaY * 0.002)));
            if (Math.abs(z1 - z0) < 1e-8) return;
            e.preventDefault();
            const ss = boardScreenPointFromClient(e.clientX, e.clientY);
            applyZoomKeepingScreenPoint(ss.x, ss.y, z1);
            drawBoardCore();
        }, { passive: false });

        let boardMousePanning = false;
        let boardPanLastScreen = null;

        function boardUpdateGrabCursor() {
            if (boardMousePanning) {
                canvas.style.cursor = 'grabbing';
            } else {
                canvas.style.cursor = ps.viewZoom > 1 ? 'grab' : 'default';
            }
        }

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || ps.viewZoom <= 1) return;
            boardMousePanning = true;
            boardPanLastScreen = boardScreenPointFromClient(e.clientX, e.clientY);
            boardUpdateGrabCursor();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!boardMousePanning || !boardPanLastScreen) return;
            const p = boardScreenPointFromClient(e.clientX, e.clientY);
            const dx = p.x - boardPanLastScreen.x;
            const dy = p.y - boardPanLastScreen.y;
            ps.viewCenterX -= dx / ps.viewZoom;
            ps.viewCenterY -= dy / ps.viewZoom;
            boardPanLastScreen = p;
            clampBoardView();
            drawBoardCore();
        });

        window.addEventListener('mouseup', () => {
            if (!boardMousePanning) return;
            boardMousePanning = false;
            boardPanLastScreen = null;
            boardUpdateGrabCursor();
        });

        let pinchGesture = false;
        let pinchStartDist = 1;
        let pinchStartZoom = 1;
        let touchPanLastScreen = null;
        let touchDidPan = false;

        function touchDistanceScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return Math.hypot(b.x - a.x, b.y - a.y);
        }

        function touchMidpointScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 2) {
                clearLongMarkTouch();
                pinchGesture = true;
                pinchStartDist = Math.max(1e-6, touchDistanceScreen(e.touches));
                pinchStartZoom = ps.viewZoom;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { capture: true, passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (pinchGesture && e.touches.length >= 2) {
                e.preventDefault();
                const d = touchDistanceScreen(e.touches);
                const z1 = Math.max(1, Math.min(10, pinchStartZoom * (d / pinchStartDist)));
                const mid = touchMidpointScreen(e.touches);
                applyZoomKeepingScreenPoint(mid.x, mid.y, z1);
                drawBoardCore();
                return;
            }
            if (!pinchGesture && e.touches.length === 1 && ps.viewZoom > 1 && touchPanLastScreen) {
                const cur = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
                const dx = cur.x - touchPanLastScreen.x;
                const dy = cur.y - touchPanLastScreen.y;
                if (dx * dx + dy * dy > 9) {
                    touchDidPan = true;
                    e.preventDefault();
                    ps.viewCenterX -= dx / ps.viewZoom;
                    ps.viewCenterY -= dy / ps.viewZoom;
                    touchPanLastScreen = cur;
                    clampBoardView();
                    drawBoardCore();
                }
            }
        }, { passive: false });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        });

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

        function onCanvasTouchEnd(e) {
            clearLongMarkTouch();
            if (e.touches.length < 2) pinchGesture = false;
            if (e.touches.length === 0) {
                if (touchDidPan) {
                    suppressCanvasClickAfterPan = true;
                    setTimeout(() => { suppressCanvasClickAfterPan = false; }, 450);
                }
                touchDidPan = false;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }
        canvas.addEventListener('touchend', onCanvasTouchEnd);
        canvas.addEventListener('touchcancel', () => {
            clearLongMarkTouch();
            pinchGesture = false;
            touchPanLastScreen = null;
            touchDidPan = false;
        });

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark || suppressCanvasClickAfterPan) {
                e.preventDefault();
                return;
            }
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardCore();
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
                        drawBoardCore();
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
                drawBoardCore();
                return;
            }
            if (ps.board[row][col] !== 0) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoardCore();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoardCore();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (boardMousePanning) return;
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoardCore(); }
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                boardUpdateGrabCursor();
                drawBoardCore();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    if (!boardMousePanning) boardUpdateGrabCursor();
                    drawBoardCore();
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
        fixInstantWeiqiPlacement();
        })();
    }
};
