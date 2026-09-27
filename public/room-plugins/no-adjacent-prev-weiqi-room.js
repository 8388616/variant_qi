window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['no-adjacent-prev-weiqi'] = {
    shell: {
        "title": "不邻前手围棋",
        "rulesHtml": "基本规则同围棋，但每手棋不能下在前一手的相邻位置。：<br /><br /><strong>不邻前手</strong>：不能下在前一手的上下左右四格。<br /><br /><strong>不邻己方前手</strong>：不能下在己方前一手的上下左右四格。<br /><br /><strong>不近前手</strong>：不能下在前一手的上下左右及四个斜角。<br /><br /><strong>不近己方前手</strong>：不能下在己方前一手的上下左右及四个斜角。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "不邻前手围棋",
        "useBenson": true,
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "不邻前手围棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        // 子棋类（顺序即下拉框顺序；与 games/no-adjacent-prev-weiqi.js 的 SUB_GAMES 一致）
        const SUB_GAMES = ['no-adjacent-prev-weiqi', 'no-adjacent-own-prev-weiqi', 'no-near-prev-weiqi', 'no-near-own-prev-weiqi'];
        const DEFAULT_SUB_GAME = 'no-adjacent-prev-weiqi';
        let SUB = DEFAULT_SUB_GAME;
        /** own = 参考「己方前一手」（否则看紧邻的前一手）；near = 含四个斜角（八格） */
        const SUB_META = {
            'no-adjacent-prev-weiqi': { own: false, near: false, label: '不邻前手', name: '不邻前手围棋' },
            'no-adjacent-own-prev-weiqi': { own: true, near: false, label: '不邻己方前手', name: '不邻己方前手围棋' },
            'no-near-prev-weiqi': { own: false, near: true, label: '不近前手', name: '不近前手围棋' },
            'no-near-own-prev-weiqi': { own: true, near: true, label: '不近己方前手', name: '不近己方前手围棋' }
        };
        function subMeta() { return SUB_META[SUB] || SUB_META[DEFAULT_SUB_GAME]; }

        /** 普通围棋贴目：路数 ≤ 8 → 4.25，其余 3.25（四种子棋类相同，与后端 _komi 一致） */
        function komiForSize(boardSize) {
            return boardSize <= 8 ? 4.25 : 3.25;
        }

        const ps = {
            BOARD_SIZE: 19,
            KOMI: komiForSize(19),
            PADDING: 0,
            CELL_SIZE: 0,
            numberOfHands: 1,
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastMoveMarkers: [],
            moveCoords: [],
            bannedPoints: [],
            tryPlayStartPlayer: null,
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

        /* ==================== 禁点（与前一手 / 己方前一手 相邻或相近） ====================
         * 判定口径与 games/no-adjacent-prev-weiqi.js 的 isBannedPoint 逐字一致：
         *   参考手 = 己方前一手（meta.own）/ 全局最后一手（只看它，不往前找）；参考的是那一手的落点；
         *   参考手是虚着 / 不存在 → 无禁点；near = 含四个斜角（八格），否则只算上下左右。
         */

        /** 单点判定：moveCoords 为「已发生的手」列表（实战棋谱或试下序列），playerVal = 即将落子的一方 */
        function isBannedPoint(moveCoords, row, col, playerVal, meta) {
            const mcs = moveCoords || [];
            if (!mcs.length) return false;
            let ref = null;
            if (meta.own) {
                const slot = playerVal === 2 ? 'player2' : 'player1';
                for (let i = mcs.length - 1; i >= 0; i--) {
                    if (mcs[i] && mcs[i].player === slot) { ref = mcs[i]; break; }
                }
            } else {
                ref = mcs[mcs.length - 1];
            }
            if (!ref || ref.type !== 'move' || !Number.isInteger(ref.row) || !Number.isInteger(ref.col)) return false;
            const dr = Math.abs(row - ref.row);
            const dc = Math.abs(col - ref.col);
            if (meta.near) return dr <= 1 && dc <= 1 && (dr + dc) > 0;
            return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
        }

        /**
         * 试下序列 → 与实战棋谱同形的「已发生的手」列表。
         * 试下每步一个标记（tryPlayMarkers[i]，空数组 = 该步虚着；下标 0 = 进入试下时的实战盘面），
         * 试下各方交替（含虚着），故第 i 步的行棋方 = 起点方按 i 次换手推导。
         */
        function tryPlayMoveCoords() {
            if (ps.tryPlayStep === 0) ps.tryPlayStartPlayer = ps.tryPlayCurrentPlayer || 1;
            const start = ps.tryPlayStartPlayer || null;
            const out = [];
            const upto = Math.min(ps.tryPlayStep || 0, (ps.tryPlayMarkers || []).length - 1);
            for (let i = 0; i <= upto; i++) {
                const mk = (ps.tryPlayMarkers || [])[i];
                const player = (start && i >= 1) ? (i % 2 === 1 ? (start === 1 ? 'player1' : 'player2') : (start === 1 ? 'player2' : 'player1')) : null;
                if (!mk || !mk.length) { out.push({ type: 'pass', player: player || 'player1' }); continue; }
                out.push({ type: 'move', player: player || 'player1', row: mk[0].row, col: mk[0].col });
            }
            return out;
        }

        /** 当前应当依据的「已发生的手」列表（试下中用试下序列；打谱中不限制（打谱只回放已发生的棋谱）） */
        function activeMoveCoords() {
            if (ps.tryPlayMode && ps.replayMode) {
                if (ps.tryPlayStartPlayer == null && (ps.tryPlayStep || 0) > 0) return null;   // 起点方未知：宁可不限制
                return tryPlayMoveCoords();
            }
            return ps.moveCoords || [];
        }

        function tryPlaceStoneNoAdjPrev(boardBefore, row, col, playerVal) {
            const mcs = activeMoveCoords();
            if (mcs && isBannedPoint(mcs, row, col, playerVal, subMeta())) return null;
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 1
            );
        }

        /** 当前行棋方的全部禁点（画提示用）；纯打谱中不画，试下按试下序列算 */
        function computeBannedPoints() {
            if (ps.replayMode && !ps.tryPlayMode) return [];
            const mcs = activeMoveCoords();
            if (!mcs || !mcs.length) return [];
            const playerVal = ps.currentPlayer === 2 ? 2 : 1;
            const meta = subMeta();
            const out = [];
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    if (ps.board[r][c] !== 0) continue;
                    if (isBannedPoint(mcs, r, c, playerVal, meta)) out.push({ row: r, col: c });
                }
            }
            return out;
        }

        /**
         * 自定义绘制：默认绘制序列 + 禁点提示（照 room-plugins/greedy-weiqi-room.js 的候选点画法，
         * 位置同样在用户标记之后、落子预览之前）。禁点在形势判断中不画（与用户标记的可见性口径一致）。
         */
        function drawBoardNoAdjPrev() {
            const C = QiSquareWeiqiCanvas;
            const d = C.draw;
            const cs = C.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            ps.bannedPoints = computeBannedPoints();   // 每次绘制都重算（试下推进/悔棋/打谱都会改变参考手）
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers, undefined);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, (r, c) => {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                return true;
            });
            if (ps.showMoveNumbers) {
                const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
                if (ps.replayMode && ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const markers = ps.tryPlayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const markers = ps.replayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                } else {
                    const upto = ps.liveViewStep || 0;
                    for (let i = 1; i <= upto; i++) {
                        const markers = ps.liveReplayMarkers[i];
                        if (markers && markers[0] && ps.board[markers[0].row] && ps.board[markers[0].row][markers[0].col] !== 0)
                            nums[markers[0].row][markers[0].col] = i;
                    }
                }
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            // 禁点提示：当前行棋方不能下的点（灰色小叉；形势判断/编辑盘面时不画）
            if (!ps.showEstimateActive && !ps.gameOver && !ps.editModeEnabled) {
                const banned = ps.bannedPoints || [];
                if (banned.length) {
                    const half = cellSize * 0.16;
                    ctx.save();
                    ctx.globalAlpha = 0.75;
                    ctx.strokeStyle = '#3a281c';   // 棋盘线同色：木纹上黑白两方都看得清
                    ctx.lineWidth = Math.max(1.5, cellSize * 0.055);
                    for (const { row, col } of banned) {
                        const x = ps.PADDING + col * cellSize;
                        const y = ps.PADDING + (ps.BOARD_SIZE - 1 - row) * cellSize;
                        ctx.beginPath();
                        ctx.moveTo(x - half, y - half);
                        ctx.lineTo(x + half, y + half);
                        ctx.moveTo(x + half, y - half);
                        ctx.lineTo(x - half, y + half);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
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
                    hoverCapture: !!ps.hoverCapture,
                    boardSize: ps.BOARD_SIZE
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
        /** 实战棋谱展示用（打谱/实时回放）：盘面只是重建「服务端已裁决过的棋谱」，不再套禁点判定 */
        function standardTryPlaceStone(boardBefore, row, col, playerVal) {
            return R().tryPlaceStoneNLiberty(
                boardBefore, row, col, playerVal, ps.BOARD_SIZE,
                (b) => QiSquareWeiqiCanvas.deepCopyBoard(b), 1
            );
        }

        // 标准围棋：形势判断/数点用 Benson 档（公共钩子；档位见 shell.useBenson）
        const scoringHooks = QiWeiqiSquarePageRuntime.weiqiScoringHooks(config.useBenson !== false, {
            boardSize: () => ps.BOARD_SIZE,
            maxWeakLiberties: 2
        });

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix,
            minLib: 1,
            maxWeakLiberties: 2,
            ...scoringHooks,
            drawBoard: drawBoardNoAdjPrev,
            tryPlaceStone: tryPlaceStoneNoAdjPrev,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const syncedLen = ps.liveReplayBoards.length - 1;
                const mcs = moveCoords || [];
                if (syncedLen >= 0 && mcs.length > syncedLen) {
                    const inc = R().applyLiveReplayIncrementalBoards(
                        ps.liveReplayBoards, ps.liveReplayMarkers, ps.liveReplayStepPlayers,
                        mcs, standardTryPlaceStone, QiSquareWeiqiCanvas.deepCopyBoard);
                    if (inc.ok) return;
                }
                const ob = ps.liveOpeningBoard;
                const o = R().rebuildLiveReplayFromMoveCoords(
                    moveCoords,
                    standardTryPlaceStone,
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

        /** 棋谱下载文件名前缀按当前子棋类（同族棋种惯例：用子棋类全名） */
        function recordPrefix() {
            return (SUB_META[SUB] || {}).name || '不邻前手围棋';
        }
        /** 覆盖运行时的下载按钮：文件名带上子棋类（内容里的 gameType/subGameId 由服务端导出时写好） */
        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordPrefix());
        }

        function syncState(state) {
            ps.gameStarted = (state.numberOfHands || 1) > 1;
            ps.moveCoords = state.moveCoords || [];
            if (state.subGameId && SUB_GAMES.indexOf(state.subGameId) >= 0 && state.subGameId !== SUB) {
                SUB = state.subGameId;
                ps.tryPlayStartPlayer = null;
                const sel = document.getElementById('subGameSelect');
                if (sel) sel.value = SUB;
                refreshKomiInfo();
            }
            // 棋盘尺寸变化由 syncStateBase 统一处理（内部重建棋盘并更新几何/贴目显示），
            // 切勿在此先改 ps.BOARD_SIZE——会跳过 syncStateBase 的几何更新导致换路数后棋格不变化
            syncStateBase(state);
            ps.bannedPoints = computeBannedPoints();
            updateEditModeUI();
            // 子棋类选择器显示时机与路数选择器一致（开局前可改）
            updateSubGameSelectVisibility();
        }

        function updateSubGameSelectVisibility() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.player1 || ps.slots.player2;
            // 有子棋类：始终显示；开局（有子/有手数/有人入座/对局结束）后锁定不可改，新局时恢复可用
            sel.style.display = 'inline-block';
            sel.disabled = hasAnyStone || hasPlayer || ps.gameOver || (ps.moveCoords || []).length > 0;
        }

        function refreshKomiInfo() {
            ps.KOMI = komiForSize(ps.BOARD_SIZE);
            QiWeiqiSquarePageRuntime.writeKomiInfoText(document.getElementById('komiInfo'), ps.KOMI, ps.BOARD_SIZE * ps.BOARD_SIZE);
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
                ps.KOMI = komiForSize(n);
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
        const _baseHandleMessage = _weiqiBindings.handleMessage;
        const updateVsComputerBtn = _weiqiBindings.updateVsComputerBtn;
        const handleMessage = (msg) => {
            if (msg && msg.type === 'subGameChanged') {
                // 子棋类变更广播（带完整 state）：全量同步
                syncState(msg);
                // 切换子棋类后「与电脑对弈」可用性立即更新（服务端已按新子棋类重查 katagos/{子棋类id}/）
                if (Object.prototype.hasOwnProperty.call(msg, 'katagoAvailable'))
                    ps.katagoAvailable = !!msg.katagoAvailable;
                if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                    ps.computerSlot = msg.computerSlot || null;
                if (typeof updateVsComputerBtn === 'function') updateVsComputerBtn();
                drawBoard();
                return;
            }
            _baseHandleMessage(msg);
        };
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
                // 试下同样按禁点规则挡（参考手取试下自己的序列，虚着会解除限制）
                if (isBannedPoint(activeMoveCoords() || [], row, col, ps.tryPlayCurrentPlayer, subMeta())) return;
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
            // 禁点（与前一手/己方前一手相邻或相近）：服务端会静默拒绝，这里先挡（禁点位置画成灰色小叉）
            if (isBannedPoint(ps.moveCoords || [], row, col, ps.currentPlayer === 2 ? 2 : 1, subMeta())) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = !isBannedPoint(activeMoveCoords() || [], row, col, ps.tryPlayCurrentPlayer, subMeta());
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
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0
                    && !isBannedPoint(ps.moveCoords || [], row, col, ps.currentPlayer === 2 ? 2 : 1, subMeta()));
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
        // 子棋类选择器：不邻/不近 × 前手/己方前手（开局前与路数选择器同显）
        const subGameSelect = document.getElementById('subGameSelect');
        if (subGameSelect) {
            subGameSelect.innerHTML = '';
            for (const id of SUB_GAMES) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = (SUB_META[id] || {}).label || id;
                if (id === SUB) opt.selected = true;
                subGameSelect.appendChild(opt);
            }
            subGameSelect.addEventListener('change', () => {
                const v = subGameSelect.value;
                if (!v || v === SUB || SUB_GAMES.indexOf(v) < 0) return;
                // 本地立即切换（乐观更新）；服务器广播 subGameChanged 回来时已相同
                SUB = v;
                // 与旧子棋类绑定的瞬态全部清掉：试下/打谱/形势判断/用户标记
                if (ps.tryPlayMode) exitTryPlay();
                if (ps.replayMode) exitReplayMode();
                if (ps.showEstimateActive) { ps.showEstimateActive = false; clearEstimate(); }
                ps.userBoardMarks = Object.create(null);
                ps.tryPlayStartPlayer = null;
                refreshKomiInfo();
                ps.bannedPoints = computeBannedPoints();
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'setSubGame', subGameId: v }));
                }
                drawBoard();
            });
        }
        connectWebSocket(handleMessage);
        })();
    }
};
