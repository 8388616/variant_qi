window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['sync-weiqi'] = {
    shell: {
        "title": "同步围棋",
        "rulesHtml": "基本规则同围棋，贴目与路数规则与标准围棋一致。<br /><br />\n每回合双方同时落子（或虚着），同时亮出。<br />\n• 若落子位置不同，则按围棋规则同时生效并提子。<br />\n• 若双方落在同一空点，该点变为洞。洞不可落子、不提供气<br />\n• 若双方落子后局面与历史中某一成功局面全同（含洞位置），则本回合两手均无效，双方所选点均变为洞。<br /><br />\n双方连续虚着时对局结束。",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "同步围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "同步围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
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
            matchStarted: false,
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
            mySyncPending: null,
            syncAwaitingOpponent: false,
            myPreviewMarker: null
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

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const R = () => QiWeiqiSquarePageRuntime;

        function boardToStringSync(b) {
            return b.map(row => row.join(',')).join(';');
        }

        function inBoardSync(r, c, n) {
            return r >= 0 && r < n && c >= 0 && c < n;
        }

        function collectGroupSync(board, r, c, n) {
            const color = board[r][c];
            if (color !== 1 && color !== 2) return null;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const seen = new Set([`${r},${c}`]);
            const q = [[r, c]];
            const stones = [[r, c]];
            let hasLib = false;
            let idx = 0;
            while (idx < q.length) {
                const [rr, cc] = q[idx++];
                for (const [dr, dc] of dirs) {
                    const nr = rr + dr;
                    const nc = cc + dc;
                    if (!inBoardSync(nr, nc, n)) continue;
                    const v = board[nr][nc];
                    if (v === 0) {
                        hasLib = true;
                        continue;
                    }
                    if (v !== color) continue;
                    const k = `${nr},${nc}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    q.push([nr, nc]);
                    stones.push([nr, nc]);
                }
            }
            return { stones, hasLib };
        }

        function removeZeroLibertyGroupsClient(board, n, anchorPoints) {
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const seedSet = new Set();
            for (const p of anchorPoints || []) {
                if (!p || !inBoardSync(p.row, p.col, n)) continue;
                seedSet.add(`${p.row},${p.col}`);
                for (const [dr, dc] of dirs) {
                    const nr = p.row + dr;
                    const nc = p.col + dc;
                    if (inBoardSync(nr, nc, n)) seedSet.add(`${nr},${nc}`);
                }
            }
            const groupSeen = new Set();
            const toRemove = [];
            for (const seed of seedSet) {
                const [r, c] = seed.split(',').map(Number);
                const v = board[r][c];
                if (v !== 1 && v !== 2) continue;
                const g = collectGroupSync(board, r, c, n);
                if (!g) continue;
                const k = g.stones.map(([rr, cc]) => `${rr},${cc}`).sort().join(';');
                if (groupSeen.has(k)) continue;
                groupSeen.add(k);
                if (!g.hasLib) toRemove.push(g.stones);
            }
            for (const stones of toRemove) {
                for (const [r, c] of stones) board[r][c] = 0;
            }
        }

        function applySimultaneousClient(blackMove, whiteMove, curBoard, n) {
            const nb = QiSquareWeiqiCanvas.deepCopyBoard(curBoard);
            const anchors = [];
            if (blackMove && whiteMove && blackMove.row === whiteMove.row && blackMove.col === whiteMove.col) {
                nb[blackMove.row][blackMove.col] = -1;
                anchors.push({ row: blackMove.row, col: blackMove.col });
            } else {
                if (blackMove) {
                    nb[blackMove.row][blackMove.col] = 1;
                    anchors.push({ row: blackMove.row, col: blackMove.col });
                }
                if (whiteMove) {
                    nb[whiteMove.row][whiteMove.col] = 2;
                    anchors.push({ row: whiteMove.row, col: whiteMove.col });
                }
            }
            removeZeroLibertyGroupsClient(nb, n, anchors);
            return nb;
        }

        function applyFailedTurnHolesClient(curBoard, blackMove, whiteMove, n) {
            const out = QiSquareWeiqiCanvas.deepCopyBoard(curBoard);
            const anchors = [];
            if (blackMove) {
                if (out[blackMove.row][blackMove.col] === 0) out[blackMove.row][blackMove.col] = -1;
                anchors.push({ row: blackMove.row, col: blackMove.col });
            }
            if (whiteMove) {
                if (out[whiteMove.row][whiteMove.col] === 0) out[whiteMove.row][whiteMove.col] = -1;
                anchors.push({ row: whiteMove.row, col: whiteMove.col });
            }
            removeZeroLibertyGroupsClient(out, n, anchors);
            return out;
        }

        function simulateOneSyncTurn(curBoard, turn, histSet, n) {
            const blackMove = turn.blackPass ? null : turn.black;
            const whiteMove = turn.whitePass ? null : turn.white;
            const blackPass = !!turn.blackPass;
            const whitePass = !!turn.whitePass;
            if (blackPass && whitePass) {
                return { board: curBoard, markers: [], applied: true, gameEnd: true };
            }
            const nb = applySimultaneousClient(blackMove, whiteMove, QiSquareWeiqiCanvas.deepCopyBoard(curBoard), n);
            const dup = histSet.has(boardToStringSync(nb));
            let finalBoard;
            let markers = [];
            let applied = false;
            if (dup) {
                finalBoard = applyFailedTurnHolesClient(curBoard, blackMove, whiteMove, n);
            } else {
                finalBoard = nb;
                if (blackMove && !blackPass) markers.push({ row: blackMove.row, col: blackMove.col, color: 1 });
                if (whiteMove && !whitePass) markers.push({ row: whiteMove.row, col: whiteMove.col, color: 2 });
                applied = true;
            }
            if (applied) histSet.add(boardToStringSync(finalBoard));
            return { board: finalBoard, markers, applied, gameEnd: false };
        }

        function buildSyncMoveLog(coords) {
            const log = [];
            for (const t of coords || []) {
                if (!t || !t.applied) continue;
                if (!t.blackPass && t.black) log.push({ row: t.black.row, col: t.black.col });
                if (!t.whitePass && t.white) log.push({ row: t.white.row, col: t.white.col });
            }
            return log;
        }

        function rebuildSyncLiveReplay(moveCoords) {
            const n = ps.BOARD_SIZE;
            let cur = QiSquareWeiqiCanvas.initBoardArray(n);
            const histSet = new Set([boardToStringSync(cur)]);
            const liveReplayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(cur)];
            const liveReplayMarkers = [[]];
            const liveReplayStepPlayers = [0];
            for (const turn of moveCoords || []) {
                const r = simulateOneSyncTurn(cur, turn, histSet, n);
                cur = r.board;
                liveReplayStepPlayers.push(1);
                liveReplayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(cur));
                liveReplayMarkers.push(r.markers.map(m => ({ ...m })));
                if (r.gameEnd) break;
            }
            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
        }

        function syncTryPlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 1
            );
        }

        function holeDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    if (ps.board[r][c] === -1) R().drawRedBlockHole(r, c, ctx, ps.PADDING, cellSize);
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
                const hollow = ps.myPreviewMarker;
                if (hollow && hollow.row === br && hollow.col === bc) return false;
                return true;
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers && typeof computeStoneNumbers === 'function') {
                const nums = computeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid,
                hoverCapture: !!ps.hoverCapture
            });
            if (
                ps.myPreviewMarker
                && Number.isInteger(ps.myPreviewMarker.row)
                && Number.isInteger(ps.myPreviewMarker.col)
                && (ps.mySlot === 'black' || ps.mySlot === 'white')
            ) {
                const rr = ps.myPreviewMarker.row;
                const cc = ps.myPreviewMarker.col;
                if (
                    rr >= 0 && rr < ps.BOARD_SIZE
                    && cc >= 0 && cc < ps.BOARD_SIZE
                    && ps.board[rr][cc] === 0
                ) {
                    const x = ps.PADDING + cc * cellSize;
                    const y = ps.PADDING + rr * cellSize;
                    const r = cellSize * 0.4;
                    ctx.save();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = ps.mySlot === 'black' ? '#111111' : '#f8f8f8';
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = 'rgba(0,0,0,0.35)';
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
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

        const pageHolder = {};
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            tryPlaceStone: syncTryPlaceStone,
            drawBoard: holeDrawBoard,
            removeDeadAndDying: (src) => R().removeDeadAndDying(src, ps.BOARD_SIZE, (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 2),
            assignTerritoryWithRange: (live) => R().assignTerritoryWithRange(live, ps.BOARD_SIZE),
            rebuildLiveReplayFromMoveCoords(coords) {
                rebuildSyncLiveReplay(coords);
            },
            enterReplayMode(data) {
                const n = ps.BOARD_SIZE;
                let cur = QiSquareWeiqiCanvas.initBoardArray(n);
                if (data.initialPosition && data.initialPosition.length) {
                    for (const s of data.initialPosition) {
                        if (typeof s !== 'string' || s.length < 3) continue;
                        const prefix = s[0];
                        const comma = s.indexOf(',');
                        if (comma <= 1) continue;
                        const row = parseInt(s.slice(1, comma), 10);
                        const col = parseInt(s.slice(comma + 1), 10);
                        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= n || col < 0 || col >= n) continue;
                        if (prefix === 'H') cur[row][col] = -1;
                        else if (prefix === 'B') cur[row][col] = 1;
                        else if (prefix === 'W') cur[row][col] = 2;
                    }
                }
                const histSet = new Set([boardToStringSync(cur)]);
                const replayBoards = [QiSquareWeiqiCanvas.deepCopyBoard(cur)];
                const replayMarkers = [[]];
                const replayStepPlayers = [0];
                for (const turn of data.moves || []) {
                    const r = simulateOneSyncTurn(cur, turn, histSet, n);
                    cur = r.board;
                    replayStepPlayers.push(1);
                    replayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(cur));
                    replayMarkers.push(r.markers.map(m => ({ ...m })));
                    if (r.gameEnd) break;
                }
                ps.replayBoards = replayBoards;
                ps.replayMarkers = replayMarkers;
                ps.replayStepPlayers = replayStepPlayers;
                ps.replayTotalSteps = replayBoards.length - 1;
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
            commitMove: commitMoveBase,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            computeStoneNumbers
        } = page;

        function renderSyncTurn() {
            if (ps.replayMode) {
                drawBoard();
                return;
            }
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            const browsingLive = ps.liveReplayBoards.length > 0 && ps.liveViewStep < total;
            if (browsingLive) {
                if (ps.liveViewStep === 0) turnDisplay.innerText = '初始局面';
                else turnDisplay.innerText = `第${ps.liveViewStep}手`;
                drawBoard();
                return;
            }
            if (ps.gameOver) {
                turnDisplay.innerText = '对局结束';
                drawBoard();
                return;
            }
            if (ps.waitingScoreConfirm) {
                turnDisplay.innerText = '等待数点确认';
            } else if (!ps.matchStarted) {
                const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
                turnDisplay.innerText = bothSelected ? '等待双方确认限时规则' : '等待双方入座';
            } else if (!ps.mySlot) {
                turnDisplay.innerText = `第${Math.max(1, ps.numberOfHands)}手`;
            } else if (ps.numberOfHands <= 1) {
                turnDisplay.innerText = '初始局面';
            } else {
                turnDisplay.innerText = `第${ps.numberOfHands}手`;
            }
            drawBoard();
        }

        function applySyncTurnUi(state) {
            if (state && Object.prototype.hasOwnProperty.call(state, 'mySyncPending')) {
                ps.mySyncPending = state.mySyncPending;
            }
            if (
                ps.mySyncPending
                && Number.isInteger(ps.mySyncPending.row)
                && Number.isInteger(ps.mySyncPending.col)
            ) {
                ps.myPreviewMarker = { row: ps.mySyncPending.row, col: ps.mySyncPending.col };
            }
            const browsingLive = !ps.replayMode && ps.liveReplayBoards.length > 0
                && ps.liveViewStep < Math.max(0, ps.liveReplayBoards.length - 1);
            const pendingServer = !!(ps.mySyncPending && (
                ps.mySyncPending.pass === true
                || (Number.isInteger(ps.mySyncPending.row) && Number.isInteger(ps.mySyncPending.col))
            ));
            ps.isMyTurn = !!(ps.mySlot && !ps.gameOver && !browsingLive && !ps.waitingScoreConfirm
                && ps.matchStarted && !pendingServer && !ps.syncAwaitingOpponent);
            if (state.moveCoords) ps.moveLog = buildSyncMoveLog(state.moveCoords);
            if (ps.showEstimateActive) showEstimate();
            else renderSyncTurn();
        }

        function syncStateFull(state) {
            if (state.board) {
                ps.board = QiSquareWeiqiCanvas.deepCopyBoard(state.board);
            }
            syncStateBase(state);
            ps.syncAwaitingOpponent = false;
            ps.myPreviewMarker = null;
            applySyncTurnUi(state);
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
syncState: syncStateFull,
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
            onNewGameStarted() {
                if (typeof page !== "undefined" && page.clearEditModeUi) page.clearEditModeUi();
                else if (ps.clearEditModeUi) ps.clearEditModeUi();
                ps.syncAwaitingOpponent = false;
                ps.mySyncPending = null;
                ps.myPreviewMarker = null;
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });

        function commitMove(row, col) {
            if (ps.gameOver) return false;
            if (!ps.isMyTurn) return false;
            if (ps.board[row][col] !== 0) return false;
            ps.myPreviewMarker = { row, col };
            const ok = commitMoveBase(row, col);
            if (ok) {
                ps.syncAwaitingOpponent = true;
                ps.isMyTurn = false;
                renderSyncTurn();
            }
            return ok;
        }

        function handleMessage(msg) {
            if (msg.type === 'pendingUpdate') {
                renderSyncTurn();
                return;
            }
            if (msg.type === 'broadcast' && msg.action === 'turnResolved') {
                const wasOver = ps.gameOver;
                syncStateFull(msg);
                if (msg.gameOver && !wasOver) {
                    if (msg.winner === 'black') qiAlert('黑胜。');
                    else if (msg.winner === 'white') qiAlert('白胜。');
                    else if (msg.winner === 'draw') qiAlert('和棋。');
                }
                return;
            }
            if (msg.type === 'scoreProposal' && msg.blackTotal != null && msg.whiteTotal != null) {
                _weiqiBindings.handleMessage(msg);
                scoreTitle.innerText = '官方数点（待确认）';
                scoreBoard.innerText = `黑: ${Number(msg.blackTotal).toFixed(0)}  白: ${Number(msg.whiteTotal).toFixed(0)}`;
                leadInfo.innerText = `黑${msg.lead >= 0 ? '+' : ''}${Number(msg.lead).toFixed(1)}点`;
                applySyncTurnUi({});
                return;
            }
            _weiqiBindings.handleMessage(msg);
            applySyncTurnUi({});
        }

        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        document.getElementById('passBtn').addEventListener('click', () => {
            if (ps.mySlot && ps.isMyTurn && ps.matchStarted && !ps.gameOver && !ps.replayMode) {
                ps.syncAwaitingOpponent = true;
                ps.isMyTurn = false;
                ps.myPreviewMarker = null;
                renderSyncTurn();
            }
        }, true);

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
                    ps.myPreviewMarker = { row, col };
                    drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice) {
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
                ps.hoverRow = row;
                ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    drawBoard();
                }
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
        connectWebSocket(handleMessage);
        })();
    }
};
