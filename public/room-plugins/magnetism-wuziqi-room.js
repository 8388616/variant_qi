window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["magnetism-wuziqi"] = {
    shell: {
        "title": "磁性五子棋",
        "rulesHtml": "基本规则同五子棋，但每落一子后，落点周围八个方向上各自最近的棋子会被磁力拉动一格："
            + "<strong>同色</strong>棋子远离一格，<strong>异色</strong>棋子靠近一格，除非目标格出界或已有棋子。<br /><br />"
            + "双方同时形成五连时，落子方判负。<br /><br />",
        "defaultKomiText": "无禁手",
        "boardSizeMin": 7,
        "boardSizeMax": 15,
        "defaultBoardSize": 13,
        "minLib": 1,
        "recordDownloadPrefix": "磁性五子棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "磁性五子棋";
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

        /* ---------- 磁力规则孪生：与服务端 games/magnetism-wuziqi.js 里那份逐字同逻辑 ----------
           本棋种专属，不进公共文件。改这里务必同步改服务端那份。
           八个方向（上下左右 + 四个斜向）各自取最近的一枚棋子：同色远离一格、异色靠近一格。 */

        /** 结算磁力。board 必须是**已经落完这一子**的盘面（落点上有子）；返回 { board, moves }（与服务端同形） */
        function applyMagnetism(board, row, col, playerVal, boardSize) {
            const next = QiSquareWeiqiCanvas.deepCopyBoard(board);
            const moves = [];
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
            const inB = (r, c) => r >= 0 && r < boardSize && c >= 0 && c < boardSize;
            for (const [dr, dc] of dirs) {
                let r = row + dr;
                let c = col + dc;
                while (inB(r, c) && next[r][c] === 0) { r += dr; c += dc; }
                if (!inB(r, c)) continue;                     // 该方向没有棋子
                const v = next[r][c];
                const away = v === playerVal;                 // 同色远离、异色靠近
                const tr = away ? r + dr : r - dr;
                const tc = away ? c + dc : c - dc;
                if (!inB(tr, tc)) continue;                   // 出界
                if (next[tr][tc] !== 0) continue;             // 被占（紧贴落点时即落在落点上）
                next[tr][tc] = v;
                next[r][c] = 0;
                moves.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, color: v });
            }
            return { board: next, moves };
        }

        /** 落子 + 磁力（试下/回放/实时步进共用） */
        function tryPlaceStoneMag(board, row, col, playerVal, boardSize) {
            const placed = QiSquareWeiqiCanvas.deepCopyBoard(board);
            placed[row][col] = playerVal;
            return applyMagnetism(placed, row, col, playerVal, boardSize).board;
        }

        /** 整盘扫描某色是否已成五（磁力可能把别处的棋子拉成五，不能只看落点） */
        function hasFiveOnBoard(board, colorVal, boardSize) {
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (board[r][c] === colorVal
                        && QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(board, r, c, colorVal, boardSize)) return true;
                }
            }
            return false;
        }

        /** 打谱局面：逐手「落子 → 磁力」，判定同服务端（先看对方成五，再看自己） */
        function buildMagnetismReplaySnapshots(moves, boardSize) {
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
                    b = tryPlaceStoneMag(b, m.row, m.col, pv, boardSize);
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
            tryPlaceStone: (b, r, c, pv) => tryPlaceStoneMag(b, r, c, pv, ps.BOARD_SIZE),
            enterReplayMode(data) {
                const bs = data.boardSize != null ? Number(data.boardSize) : ps.BOARD_SIZE;
                const snaps = buildMagnetismReplaySnapshots(data.moves, bs);
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
                const newBoard = tryPlaceStoneMag(ps.board, row, col, playerVal, ps.BOARD_SIZE);
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
