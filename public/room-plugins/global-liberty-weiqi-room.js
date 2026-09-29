window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['global-liberty-weiqi'] = {
    shell: {
        "title": "全气围棋",
        "rulesHtml": "基本规则与围棋相似。<br /><br />"
            + "<strong>空点到一组棋子的距离</strong>：空点到这组棋的最小曼哈顿距离。<br /><br />"
            + "<strong>一组棋的气数</strong>：0.25 * 棋盘上所有空点到这组棋子的距离的倒数和<br /><br />"
            + "气数少于2的组会被提掉。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "全气围棋",
        "useBenson": false,
        "standardWeiqiMatchTime": true,
        "features": {
            "handicap": true,
            "showEstimate": true,
            "woodTexture": true,
            "zoomScroll": true,
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "全气围棋";
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

        /** 落座蒙版显示时不允许缩放（含对局中途再入座） */
        function boardViewZoomAllowed() {
            const o = document.querySelector('.board-container > .qi-seat-overlay');
            return !(o && !o.hidden);
        }

        function resetBoardViewZoom() {
            ps.viewZoom = 1;
            ps.viewCenterX = BOARD_VIEW_CS / 2;
            ps.viewCenterY = BOARD_VIEW_CS / 2;
            syncScrollbarsFromView();
            boardUpdateGrabCursor();
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
        /* ===== 全气围棋规则孪生（与服务器 games/global-liberty-weiqi.js 同一套实现）===== */
        /** 判定「少于 2 气」时的浮点容差：恰好 2.0 不该因求和误差被判成少于 2 */
        const GL_LIBERTY_EPS = 1e-9;

        /** (row,col) 所在的同色棋链（四连通）的全部格子（BFS 顺序，与服务端一致） */
        function glGroupCells(board, row, col) {
            const size = ps.BOARD_SIZE;
            const color = board[row][col];
            const seen = Array(size).fill().map(() => Array(size).fill(false));
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const queue = [[row, col]];
            seen[row][col] = true;
            const cells = [];
            for (let head = 0; head < queue.length; head++) {
                const [r, c] = queue[head];
                cells.push([r, c]);
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                    if (seen[nr][nc] || board[nr][nc] !== color) continue;
                    seen[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
            return cells;
        }

        /** 气数 = Σ_{空点} 0.25 / 曼哈顿距离：以整组棋为源点、在整张棋盘上做多源 BFS（可穿过棋子） */
        function glGroupLiberties(board, row, col) {
            if (row < 0 || col < 0 || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE) return 0;
            if (board[row][col] === 0) return 0;
            const size = ps.BOARD_SIZE;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const dist = Array(size).fill().map(() => Array(size).fill(-1));
            const queue = [];
            for (const [r, c] of glGroupCells(board, row, col)) {
                dist[r][c] = 0;
                queue.push([r, c]);
            }
            for (let head = 0; head < queue.length; head++) {
                const [r, c] = queue[head];
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                    if (dist[nr][nc] >= 0) continue;
                    dist[nr][nc] = dist[r][c] + 1;
                    queue.push([nr, nc]);
                }
            }
            let total = 0;
            for (let r = 0; r < size; r++) {
                for (let c2 = 0; c2 < size; c2++) {
                    if (board[r][c2] !== 0) continue;
                    total += 0.25 / dist[r][c2];
                }
            }
            return total;
        }

        function glRemoveGroup(board, row, col) {
            for (const [r, c] of glGroupCells(board, row, col)) board[r][c] = 0;
        }

        /** 全盘该色棋组中气数 < 2 的：先全部算出来，再一次性提掉 */
        function glRemoveGroupsBelow(board, color, minLib) {
            const size = ps.BOARD_SIZE;
            const seen = Array(size).fill().map(() => Array(size).fill(false));
            const doomed = [];
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (board[r][c] !== color || seen[r][c]) continue;
                    for (const [gr, gc] of glGroupCells(board, r, c)) seen[gr][gc] = true;
                    if (glGroupLiberties(board, r, c) < minLib - GL_LIBERTY_EPS) doomed.push([r, c]);
                }
            }
            for (const [r, c] of doomed) glRemoveGroup(board, r, c);
            return doomed;
        }

        /** 落子：先全盘提对方（<2 气），再全盘提己方（<2 气）；返回新盘面，非法则返回 null */
        function tryPlaceStoneGlobal(boardBefore, row, col, playerVal) {
            const size = ps.BOARD_SIZE;
            if (row < 0 || row >= size || col < 0 || col >= size) return null;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = boardBefore.map((r) => r.slice());
            newBoard[row][col] = playerVal;
            glRemoveGroupsBelow(newBoard, 3 - playerVal, 2);
            glRemoveGroupsBelow(newBoard, playerVal, 2);
            return newBoard;
        }

        /** 气数显示：最多 4 位小数、不足 4 位不加尾零 */
        function glFormatLiberty(v) {
            return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
        }

        /* ===== 提示框：桌面端悬停某枚棋子显示这组棋的气数；手机端点一下显示、再点一下隐藏 ===== */
        const libertyTip = document.createElement('div');
        libertyTip.id = 'globalLibertyTip';
        libertyTip.style.cssText = 'position: fixed; background: rgba(40,30,20,0.92); color: #fff;'
            + 'padding: 4px 10px; border-radius: 6px; font-size: 13px; pointer-events: none;'
            + 'z-index: 60; display: none; white-space: nowrap;';
        (document.body || document.documentElement).appendChild(libertyTip);
        /** 当前提示的棋组代表点；null = 未显示 */
        let tipCell = null;

        function hideLibertyTip() {
            tipCell = null;
            libertyTip.style.display = 'none';
        }

        function libertyTipTextAt(row, col) {
            return '气数：' + glFormatLiberty(glGroupLiberties(ps.board, row, col));
        }

        function showLibertyTip(row, col, clientX, clientY) {
            if (!ps.board || row < 0 || col < 0 || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE) return hideLibertyTip();
            if (ps.board[row][col] === 0) return hideLibertyTip();
            tipCell = { row, col };
            libertyTip.textContent = libertyTipTextAt(row, col);
            libertyTip.style.display = 'block';
            const rect = libertyTip.getBoundingClientRect ? libertyTip.getBoundingClientRect() : { width: 0, height: 0 };
            const vw = window.innerWidth || 0;
            const vh = window.innerHeight || 0;
            let x = clientX + 14;
            let y = clientY + 14;
            if (vw && x + rect.width > vw - 4) x = Math.max(4, clientX - rect.width - 14);
            if (vh && y + rect.height > vh - 4) y = Math.max(4, clientY - rect.height - 14);
            libertyTip.style.left = x + 'px';
            libertyTip.style.top = y + 'px';
        }

        /** 盘面每次重画后刷新：显示中的棋组若已不在盘上就隐藏，否则按新盘面重算气数 */
        function refreshLibertyTip() {
            if (!tipCell) return;
            const { row, col } = tipCell;
            if (!ps.board || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE || ps.board[row][col] === 0) return hideLibertyTip();
            libertyTip.textContent = libertyTipTextAt(row, col);
        }

        // 全气围棋：形势判断/数点不用 Benson 等残子算法——所有棋子都当活棋，空点严格按
        //「曼哈顿距离最近的棋子」归属（同距离平分、超过围棋阈值算共有），与服务器保持同一套实现。
        // 变体：形势判断/数点只用最近归属档（公共钩子；档位见 shell.useBenson）
        const scoringHooks = QiWeiqiSquarePageRuntime.weiqiScoringHooks(config.useBenson !== false, {
            boardSize: () => ps.BOARD_SIZE,
            maxWeakLiberties: 2
        });

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            tryPlaceStone: tryPlaceStoneGlobal,
            ...scoringHooks,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            afterDrawBoard: () => { syncScrollbarsFromView(); refreshLibertyTip(); }
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
            boardSeatOverlay: true,
            onSeatOverlayUpdated({ visible }) {
                if (visible && ps.viewZoom > 1) resetBoardViewZoom();
                if (visible) hideLibertyTip();
            }
        });
        const weiqiHandleMessageInner = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

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
            const oppColor = ps.mySlot === 'player1' ? 2 : 1;
            if (m.color !== oppColor) return;
            ps.viewCenterX = ps.PADDING + m.col * ps.CELL_SIZE;
            ps.viewCenterY = ps.PADDING + m.row * ps.CELL_SIZE;
            clampBoardView();
            drawBoardCore();
        }

        function handleMessage(msg) {
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
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
            if (!boardViewZoomAllowed()) return;
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
                if (!boardViewZoomAllowed()) return;
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
                if (!boardViewZoomAllowed()) {
                    pinchGesture = false;
                    return;
                }
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

        // 气数提示框：桌面端悬停；手机端点一下某组棋子显示、再点一下隐藏
        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (boardMousePanning) return;
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                if (row < 0 || col < 0 || !ps.board || ps.board[row][col] === 0) {
                    hideLibertyTip();
                    return;
                }
                const same = !!tipCell && tipCell.row === row && tipCell.col === col;
                if (same) {
                    // 同一组：只挪位置，不重算
                    libertyTip.style.left = (e.clientX + 14) + 'px';
                    libertyTip.style.top = (e.clientY + 14) + 'px';
                    return;
                }
                showLibertyTip(row, col, e.clientX, e.clientY);
            });
            canvas.addEventListener('mouseleave', () => hideLibertyTip());
        } else {
            canvas.addEventListener('click', (e) => {
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                if (row < 0 || col < 0 || !ps.board || ps.board[row][col] === 0) {
                    hideLibertyTip();
                    return;
                }
                if (tipCell && tipCell.row === row && tipCell.col === col) hideLibertyTip();
                else showLibertyTip(row, col, e.clientX, e.clientY);
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
