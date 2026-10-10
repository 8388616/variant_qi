window.RoomPlugins = window.RoomPlugins || {};
/* 会挪动棋子的棋种：子层标记允许「就近同色配对」跟随 */
window.QiBoardMarks = window.QiBoardMarks || {};
window.QiBoardMarks._stoneFollow = true;
window.RoomPlugins["rotation-wuziqi"] = {
    shell: {
        "title": "旋转五子棋",
        "rulesHtml": "基本规则同五子棋。<br /><br />落子时，落子点周围八格的棋子沿<strong>顺时针</strong>旋转一格。<br /><br />双方同时形成五连时，落子方判负。<br /><br />",
        "defaultKomiText": "无禁手",
        "boardSizeMin": 7,
        "boardSizeMax": 15,
        "defaultBoardSize": 13,
        "minLib": 1,
        "recordDownloadPrefix": "旋转五子棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "woodTexture": true,
            "editBoard": true
        },
        "editTools": [
            { "value": "empty", "label": "空" },
            { "value": "black", "label": "黑子" },
            { "value": "white", "label": "白子" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "旋转五子棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const ps = {
            BOARD_SIZE: 13,
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
            isHoverValid: false
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
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const domPage = {
            turnDisplay,
            scoreTitle,
            scoreBoard,
            leadInfo,
            scoreConfirmPanel: null,
            scoreConfirmText: null,
            komiInfo,
            canvas,
            ctx,
            boardMarkSelect,
            colorStatus
        };

        /* ---------- 环旋转孪生：与服务端 games/rotation-%GAME%.js 同逻辑 ----------
           落子后，落点周围八格的棋子沿**顺时针**整体挪一格；边、角处只有盘内的邻格参与，
           按顺时针顺序构成闭环。屏幕上顺时针 = 北→东北→东→东南→南→西南→西→西北；
           本仓库 row 0 在最下方，故顺时针序列为 (+1,0),(+1,+1),(0,+1),(-1,+1),(-1,0),(-1,-1),(0,-1),(+1,-1)。 */
        const RING_CW = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

        /** 把落点周围的环顺时针挪一格；board 需已含刚落下的子（落点本身不动） */
        function rotateRingClockwise(board, row, col, boardSize) {
            const cells = [];
            for (const [dr, dc] of RING_CW) {
                const r = row + dr;
                const c = col + dc;
                if (r >= 0 && r < boardSize && c >= 0 && c < boardSize) cells.push([r, c]);
            }
            if (cells.length < 2) return board;
            const next = QiSquareWeiqiCanvas.deepCopyBoard(board);
            for (let i = 0; i < cells.length; i++) {
                const [r, c] = cells[i];
                const [pr, pc] = cells[(i - 1 + cells.length) % cells.length];   // 顺时针上一格
                next[r][c] = board[pr][pc];
            }
            return next;
        }

        /** 落子 + 环旋转（试下/回放/实时步进共用） */
        function tryPlaceStoneRot(board, row, col, playerVal, boardSize) {
            const placed = QiSquareWeiqiCanvas.deepCopyBoard(board);
            placed[row][col] = playerVal;
            return rotateRingClockwise(placed, row, col, boardSize);
        }

        /** 整盘扫描某色是否已成五（旋转可能把别处的棋子摆成五，不能只看落点） */
        function hasFiveOnBoard(board, colorVal, boardSize) {
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (board[r][c] === colorVal
                        && QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(board, r, c, colorVal, boardSize)) return true;
                }
            }
            return false;
        }

        /** 打谱局面：逐手「落子 → 环旋转」，判定同服务端（先看对方成五，再看自己） */
        function buildRotationReplaySnapshots(moves, boardSize) {
            const snaps = [];
            let b = page.initBoardArray(boardSize);
            let cur = 1;
            let trailingPass = 0;
            snaps.push({ board: QiSquareWeiqiCanvas.deepCopyBoard(b), lastMoveMarkers: [], currentPlayer: 1, gameOver: false, winner: null });
            for (const rawMove of moves || []) {
                const m = QiWeiqiSquarePageRuntime.parseWuziqiRecordMoveEntry(rawMove);
                if (!m) return null;
                let go = false;
                let win = null;
                let nextCur = cur;
                let markers = [];
                if (m.type === 'pass') {
                    trailingPass++;
                    markers = [];
                    nextCur = cur === 1 ? 2 : 1;
                    if (trailingPass >= 2) { go = true; win = 'draw'; nextCur = cur; }
                } else {
                    trailingPass = 0;
                    const pv = m.player === 'player1' ? 1 : 2;
                    b = tryPlaceStoneRot(b, m.row, m.col, pv, boardSize);
                    markers = [{ row: m.row, col: m.col, color: pv }];
                    const oppVal = pv === 1 ? 2 : 1;
                    if (hasFiveOnBoard(b, oppVal, boardSize)) {
                        go = true; win = m.player === 'player1' ? 'player2' : 'player1'; nextCur = cur;
                    } else if (hasFiveOnBoard(b, pv, boardSize)) {
                        go = true; win = m.player; nextCur = cur;
                    } else if (QiWeiqiSquarePageRuntime.isWuziqiBoardFull(b, boardSize)) {
                        go = true; win = 'draw'; nextCur = cur === 1 ? 2 : 1;
                    } else {
                        nextCur = cur === 1 ? 2 : 1;
                    }
                }
                snaps.push({
                    board: QiSquareWeiqiCanvas.deepCopyBoard(b),
                    lastMoveMarkers: markers.map((x) => ({ ...x })),
                    currentPlayer: nextCur,
                    gameOver: go,
                    winner: go ? win : null
                });
                cur = nextCur;
                if (go) break;
            }
            return snaps;
        }

        let page;
        page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            komiInfoText: '无禁手',
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            replayGameButtonIds: ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn'],
            tryPlaceStone: (b, r, c, pv) => tryPlaceStoneRot(b, r, c, pv, ps.BOARD_SIZE),
            enterReplayMode(data) {
                const bs = data.boardSize != null ? Number(data.boardSize) : ps.BOARD_SIZE;
                const snaps = buildRotationReplaySnapshots(data.moves, bs);
                if (!snaps || snaps.length === 0) return;
                if (bs !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = bs;
                    ps.board = page.initBoardArray(bs);
                    page.updateBoardGeometry();
                    const bsEl = document.getElementById('boardSizeSelect');
                    if (bsEl) bsEl.value = String(bs);
                }
                ps.replayBoards = snaps.map(s => QiSquareWeiqiCanvas.deepCopyBoard(s.board));
                ps.replayMarkers = snaps.map(s => (s.lastMoveMarkers || []).map(m => ({ ...m })));
                ps.replayStepPlayers = snaps.map((s, i) => {
                    if (i === 0) return 0;
                    const moves = data.moves || [];
                    const raw = moves[i - 1];
                    const parsed = QiWeiqiSquarePageRuntime.parseWuziqiRecordMoveEntry(raw);
                    if (parsed) return parsed.player === 'player1' ? 1 : 2;
                    return i % 2 === 1 ? 1 : 2;
                });
                ps.replayTotalSteps = ps.replayBoards.length - 1;
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps);
                page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                if (ps.board[row][col] !== 0) return false;
                const playerVal = ps.tryPlayCurrentPlayer;
                const newBoard = tryPlaceStoneRot(ps.board, row, col, playerVal, ps.BOARD_SIZE);
                if (!newBoard) return false;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(newBoard));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = QiSquareWeiqiCanvas.deepCopyBoard(newBoard);
                ps.lastMoveMarkers = [{ row, col, color: playerVal }];
                ps.gameOver = false;
                ps.winner = null;
                // 判定同服务端：先看对方成五（含双方同时成五）→ 对方胜，再看自己
                const oppVal = playerVal === 1 ? 2 : 1;
                if (hasFiveOnBoard(ps.board, oppVal, ps.BOARD_SIZE)) {
                    ps.gameOver = true;
                    ps.winner = oppVal === 1 ? 'player1' : 'player2';
                } else if (hasFiveOnBoard(ps.board, playerVal, ps.BOARD_SIZE)) {
                    ps.gameOver = true;
                    ps.winner = playerVal === 1 ? 'player1' : 'player2';
                }
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                page.drawBoard();
                return true;
            }
        });

        const _sync0 = page.syncState;
        page.syncState = function (state) {
            if (!state.moveCoords && state.moveHistory) {
                state.moveCoords = state.moveHistory.map(m =>
                    (m.type === 'pass')
                        ? { type: 'pass', player: m.player }
                        : { type: 'move', player: m.player, row: m.row, col: m.col }
                );
            }
            _sync0(state);
        };

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard,
            updateTurn,
            downloadRecord,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            updateReplayUI,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
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

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
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
syncState: page.syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm: () => {},
            isMouseDevice
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
                if (ps.board[row][col] !== 0) return;
                if (m2) {
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
            const ltLive = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            if (!ps.replayMode && ps.liveReplayBoards.length && ps.liveViewStep < ltLive) return;
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (row < 0 || col < 0) {
                if (m2) { clearMobileMovePreview(); drawBoard(); }
                return;
            }
            if (ps.board[row][col] !== 0) return;
            if (m2) {
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
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                ps.isHoverValid = false;
                ps.hoverRow = -1; ps.hoverCol = -1;
                drawBoard();
            });
        }
        connectWebSocket(handleMessage);
        })();
    }
};
