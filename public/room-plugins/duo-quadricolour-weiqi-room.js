window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['duo-quadricolour-weiqi'] = {
    shell: {
        "title": "双人四色围棋",
        "rulesHtml": "基本规则类同棋。<br /><br />黑蓝方执黑与蓝，白红方执白与红，按黑→白→红→蓝的顺序依次落子。",
        "defaultKomiText": "无贴点",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "双人四色围棋",
        "standardWeiqiMatchTime": true,
        "features": {
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
            },
            {
                "value": "red",
                "cellValue": 3,
                "label": "红子"
            },
            {
                "value": "blue",
                "cellValue": 4,
                "label": "蓝子"
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "双人四色围棋";
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
            turnColor: 1,
            tryPlayLocalColor: null,
            fourTerritoryCache: null,
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
        // ======================== 本地四色引擎（试下/实况回放演算用，与服务器一致） ========================
        const ORTH2 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const copy2 = (b) => b.map((row) => row.slice());

        /** (r,c) 所在同色组气数（四连，颜色 1..4） */
        function fourLocalLibs(board, r, c, n) {
            const color = board[r][c];
            if (!color) return 0;
            const libs = new Set();
            const visited = Array.from({ length: n }, () => new Uint8Array(n));
            visited[r][c] = 1;
            const queue = [[r, c]];
            for (let i = 0; i < queue.length; i++) {
                const [cr, cc] = queue[i];
                for (const [dr, dc] of ORTH2) {
                    const nr = cr + dr;
                    const nc = cc + dc;
                    if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                    if (board[nr][nc] === 0) libs.add(nr + ',' + nc);
                    else if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = 1;
                        queue.push([nr, nc]);
                    }
                }
            }
            return libs.size;
        }

        function fourLocalRemoveGroup(board, r, c, n) {
            const color = board[r][c];
            if (!color) return;
            const queue = [[r, c]];
            board[r][c] = 0;
            for (let i = 0; i < queue.length; i++) {
                const [cr, cc] = queue[i];
                for (const [dr, dc] of ORTH2) {
                    const nr = cr + dr;
                    const nc = cc + dc;
                    if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        /** 四色标准落子（与服务器 tryPlaceStone 同语义）：先提异色无气组，再判己色（允许自杀） */
        function localFourTryPlace(boardBefore, row, col, colorVal) {
            const n = boardBefore.length;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = copy2(boardBefore);
            newBoard[row][col] = colorVal;
            const checked = new Set();
            for (const [dr, dc] of ORTH2) {
                const nr = row + dr;
                const nc = col + dc;
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                const v = newBoard[nr][nc];
                if (v !== 0 && v !== colorVal) {
                    const key = nr + ',' + nc;
                    if (!checked.has(key)) {
                        checked.add(key);
                        if (fourLocalLibs(newBoard, nr, nc, n) === 0) fourLocalRemoveGroup(newBoard, nr, nc, n);
                    }
                }
            }
            if (fourLocalLibs(newBoard, row, col, n) === 0) fourLocalRemoveGroup(newBoard, row, col, n);
            return newBoard;
        }

        /** 试下走子：本地四色规则，落子颜色按黑→白→红→蓝本地推进 */
        function fourTryPlayMove(row, col) {
            if (ps.board[row][col] !== 0) return false;
            if (ps.tryPlayLocalColor == null) ps.tryPlayLocalColor = ps.turnColor || 1;
            const colorVal = ps.tryPlayLocalColor;
            const newBoard = localFourTryPlace(ps.board, row, col, colorVal);
            if (!newBoard) return false;
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
            }
            ps.tryPlayBoards.push(copy2(newBoard));
            ps.tryPlayMarkers.push([{ row, col, color: colorVal }]);
            ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlayLocalColor = (ps.tryPlayLocalColor % 4) + 1;
            ps.board = copy2(newBoard);
            ps.lastMoveMarkers = [{ row, col, color: colorVal }];
            const slider = document.getElementById('replaySlider');
            if (slider) { slider.max = ps.tryPlayTotalSteps; slider.value = ps.tryPlayStep; }
            updateTryPlayDisplay();
            if (ps.showEstimateActive) showEstimate();
            else drawBoardCore();
            return true;
        }

        /** 实况回放（观战步进）历史盘重演：换用四色本地规则 */
        function fourRebuildLiveReplay(moveCoords, openingBoard) {
            // 全量自建直播历史:公共 syncState 每次消息都会用 moveCoords 本地重演历史盘,
            // 公共重演只认黑/白(1/2),红/蓝(3/4)会被按黑白落子而丢失;
            // 这里按每手记录的 color 用四色引擎重演,保证 ps.board 含 3/4。
            const mcs = moveCoords || [];
            const n = ps.BOARD_SIZE;
            const dimOk = (b) => b && Array.isArray(b) && Array.isArray(b[0]) && b.length === n && b[0].length === n;
            let start = null;
            if (dimOk(openingBoard)) start = copy2(openingBoard);
            else if (dimOk(ps.liveOpeningBoard)) start = copy2(ps.liveOpeningBoard);
            else start = Array.from({ length: n }, () => new Array(n).fill(0));
            const boards = [copy2(start)];
            const markers = [[]];
            const stepPlayers = [0];
            let prev = start;
            for (const m of mcs) {
                if (m && m.type === 'pass') {
                    boards.push(copy2(prev));
                    markers.push([]);
                    stepPlayers.push(m.player === 'black' ? 1 : 2);
                } else if (m && m.type === 'move') {
                    const colorVal = m.color || (m.player === 'black' ? 1 : 2);
                    const nb = localFourTryPlace(prev, m.row, m.col, colorVal);
                    if (!nb) {
                        boards.push(copy2(prev));
                        markers.push([]);
                        stepPlayers.push(colorVal === 1 || colorVal === 4 ? 1 : 2);
                        continue;
                    }
                    boards.push(copy2(nb));
                    markers.push([{ row: m.row, col: m.col, color: colorVal }]);
                    stepPlayers.push(colorVal === 1 || colorVal === 4 ? 1 : 2);
                    prev = nb;
                }
            }
            ps.liveReplayBoards = boards;
            ps.liveReplayMarkers = markers;
            ps.liveReplayStepPlayers = stepPlayers;
        }

        /** 试下/回放状态行（显示下一落子颜色） */
        function fourTryPlayDisplayUpdate() {
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (!stepDisplay) return;
            if (ps.tryPlayMode) {
                const cn = ['', '黑', '白', '红', '蓝'][ps.tryPlayLocalColor || 1];
                stepDisplay.innerText = '试下 ' + ps.tryPlayStep + ' / ' + ps.tryPlayTotalSteps + ' · 下' + cn;
            }
        }

        const fourPageOpts = {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            afterDrawBoard: syncScrollbarsFromView,
            tryPlayMove: fourTryPlayMove,
            rebuildLiveReplayFromMoveCoords: fourRebuildLiveReplay,
            updateTryPlayDisplay: fourTryPlayDisplayUpdate,
            editToolValues: { red: 3, blue: 4 }
        };
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, fourPageOpts);
        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard: _pubDraw,
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

        // page 创建完成后才接管绘制入口(公共 create 内部首帧绘制时 _pubDraw 尚未初始化)
        fourPageOpts.drawBoard = drawBoardCore;

        /** 公共棋盘绘制 + 红/蓝棋子叠加层（公共只画 1 黑 2 白） */
        function redBlueOverlay() {
            const N = ps.BOARD_SIZE;
            const pad = ps.PADDING;
            const cell = ps.CELL_SIZE;
            const cs = BOARD_VIEW_CS;
            const zRaw = ps.viewZoom;
            const z = (typeof zRaw === 'number' && zRaw >= 1) ? Math.min(10, zRaw) : 1;
            const useView = z > 1;
            const invZ = useView ? 1 / z : 1;
            if (useView) {
                ctx.save();
                ctx.translate(cs / 2, cs / 2);
                ctx.scale(z, z);
                ctx.translate(-(ps.viewCenterX || cs / 2), -(ps.viewCenterY || cs / 2));
            }
            const sr = cell * 0.44;
            const gloss = 3 * invZ;
            const b = ps.board || [];
            for (let r = 0; r < N; r++) {
                const rowArr = b[r];
                if (!rowArr) continue;
                for (let c = 0; c < N; c++) {
                    const v = rowArr[c];
                    if (v !== 3 && v !== 4) continue;
                    const x = pad + c * cell;
                    const y = pad + (N - 1 - r) * cell;
                    ctx.save();
                    ctx.shadowBlur = 6 * invZ;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowOffsetY = 2 * invZ;
                    const grad = ctx.createRadialGradient(x - gloss, y - gloss, sr * 0.2, x, y, sr * 1.2);
                    // 与公共黑子样式一致(三层 #444/#222/#111 结构),仅换深红/深蓝
                    if (v === 3) { grad.addColorStop(0, '#aa3630'); grad.addColorStop(0.6, '#912723'); grad.addColorStop(1, '#6e1d1a'); }
                    else { grad.addColorStop(0, '#3a5baf'); grad.addColorStop(0.6, '#2c4295'); grad.addColorStop(1, '#101d6e'); }
                    ctx.beginPath();
                    ctx.arc(x, y, sr, 0, Math.PI * 2);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    ctx.restore();
                    // 无高光小点(与黑子观感一致:黑子高光点与本体同色不可见)
                }
            }
            // 红/蓝最后落子标记:与公共一致 —— 显示序号/形势判断时用外侧标记(公共已画,
            // 石头盖住内部、露出外侧角),否则补画石头内部的白色三角
            if (!(ps.showMoveNumbers || ps.showEstimateActive)) {
                const markLen = cell * 0.352;
                const lm2 = ps.lastMoveMarkers || [];
                for (const m of lm2) {
                    if (!m || m.row < 0 || m.col < 0 || (m.color !== 3 && m.color !== 4)) continue;
                    const mx = pad + m.col * cell;
                    const my = pad + (N - 1 - m.row) * cell;
                    ctx.beginPath();
                    ctx.moveTo(mx, my);
                    ctx.lineTo(mx + markLen, my);
                    ctx.lineTo(mx, my + markLen);
                    ctx.closePath();
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                }
            }
            // 红/蓝回合悬停预览:公共只画黑/白半透明,此处按回合色重画(样式同公共:alpha 0.45 半透明)。
            // 仅当轮到本方可悬停(与公共 canHover 一致):试下中放行,对局中须 isMyTurn。
            const hoverColVal = ps.tryPlayMode ? (ps.tryPlayLocalColor || ps.turnColor) : ps.turnColor;
            const hoverColor = hoverColVal === 3 ? '#aa2620' : (hoverColVal === 4 ? '#2a4baf' : '');
            const hoverAllowed = ps.tryPlayMode || (ps.isMyTurn && !ps.gameOver);
            if (hoverColor && hoverAllowed && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                ctx.save();
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(pad + ps.hoverCol * cell, pad + (N - 1 - ps.hoverRow) * cell, cell * 0.44, 0, Math.PI * 2);
                ctx.fillStyle = hoverColor;
                ctx.fill();
                ctx.restore();
            }
            // 形势判断领地小方块(样式同公共 estimateOverlay:dotRadius=cell*0.18;四色分别着色)
            if (ps.showEstimateActive && ps.fourTerritoryCache) {
                const dotR = cell * 0.18;
                const terrCol = ['', '#222', '#f0f0f0', '#aa2620', '#2a4baf'];
                for (let r = 0; r < N; r++) {
                    for (let c = 0; c < N; c++) {
                        if (ps.board[r][c] !== 0) continue;
                        const tv = ps.fourTerritoryCache[r] ? ps.fourTerritoryCache[r][c] : 0;
                        if (!tv || tv > 4) continue;
                        const tx = pad + c * cell;
                        const ty = pad + (N - 1 - r) * cell;
                        ctx.fillStyle = terrCol[tv];
                        ctx.fillRect(tx - dotR, ty - dotR, dotR * 2, dotR * 2);
                    }
                }
            }
            // 显示序号时:红/蓝棋子的序号(公共数字层被本层棋子盖住,补画;白字同黑子)
            if (ps.showMoveNumbers && Array.isArray(ps.moveLog)) {
                const b = ps.board || [];
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (!m) continue;
                    if (m.row < 0 || m.row >= N || m.col < 0 || m.col >= N) continue;
                    const v = b[m.row] ? b[m.row][m.col] : 0;
                    if (v !== 3 && v !== 4) continue;
                    const numStr = String(i + 1);
                    const fs = Math.max(9, Math.floor(cell * (numStr.length >= 3 ? 0.34 : 0.44)));
                    const tx = pad + m.col * cell;
                    const ty = pad + (N - 1 - m.row) * cell;
                    ctx.font = 'bold ' + fs + 'px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#fff';
                    ctx.fillText(numStr, tx, ty + 1);
                }
            }
            if (useView) ctx.restore();
        }

        /**
         * 公共绘制 + 红蓝叠加:公共 drawBoard 的 opts.drawBoard 注入点接管所有绘制入口
         * (updateTurn/回放/试下/悬停等),内部临时解除注入再调公共全绘制,避免递归。
         */
        function drawBoardCore() {
            if (fourPageOpts) fourPageOpts.drawBoard = null;
            _pubDraw();
            if (fourPageOpts) fourPageOpts.drawBoard = drawBoardCore;
            redBlueOverlay();
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard: drawBoardCore,
            updateTurn,
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
            updateReplayUI,
            showScoreConfirm,
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            onSeatOverlayUpdated({ visible }) {
                if (visible && ps.viewZoom > 1) resetBoardViewZoom();
                // 蒙版/续座按钮称呼:黑方→黑蓝方、白方→白红方、执黑→执黑蓝、执白→执白红(仅文本节点)
                const overlays = document.querySelectorAll('.qi-seat-overlay, .qi-seat-overlay-inner, [data-seat-action]');
                overlays.forEach((el) => {
                    const walk = (node) => {
                        node.childNodes.forEach((ch) => {
                            if (ch.nodeType === 3) {
                                ch.textContent = relabelStr(ch.textContent);
                            } else if (ch.nodeType === 1) walk(ch);
                        });
                    };
                    walk(el);
                });
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
            const oppColor = ps.mySlot === 'black' ? 2 : 1;
            if (m.color !== oppColor) return;
            ps.viewCenterX = ps.PADDING + m.col * ps.CELL_SIZE;
            ps.viewCenterY = ps.PADDING + m.row * ps.CELL_SIZE;
            clampBoardView();
            drawBoardCore();
        }

        const COLOR_TEXT = ['', '黑', '白', '红', '蓝'];
        const fmtTxt = (v) => String(Number(v.toFixed(2)));

        /** 本地四色算分(与服务器一致):点归最近色、并列平分 */
        function localScoreFour() {
            const n = ps.BOARD_SIZE;
            const b = ps.board;
            const scores = [0, 0, 0, 0];
            let has = false;
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                const v = b[r][c];
                if (v !== 0) { scores[v - 1] += 1; has = true; }
            }
            if (!has) { const q = n * n / 4; return [q, q, q, q]; }
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                if (b[r][c] !== 0) continue;
                const visited = Array.from({ length: n }, () => new Uint8Array(n));
                visited[r][c] = 1;
                const queue = [[r, c, 0]];
                let minLayer = Infinity;
                let colors = new Set();
                for (let i = 0; i < queue.length; i++) {
                    const [cr, cc, d] = queue[i];
                    if (d >= minLayer) continue;
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n || visited[nr][nc]) continue;
                        visited[nr][nc] = 1;
                        const v = b[nr][nc];
                        if (v !== 0) {
                            const layer = d + 1;
                            if (layer < minLayer) { minLayer = layer; colors = new Set([v]); }
                            else if (layer === minLayer) colors.add(v);
                        } else queue.push([nr, nc, d + 1]);
                    }
                }
                const share = 1 / Math.max(1, colors.size);
                for (const v of colors) scores[v - 1] += share;
            }
            return scores;
        }

        /** 四色领地(空点归属最近色;并列/无边 → 0;空盘全部 0) */
        function localFourTerritory() {
            const n = ps.BOARD_SIZE;
            const b = ps.board;
            const terr = Array.from({ length: n }, () => new Array(n).fill(0));
            let has = false;
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (b[r][c] !== 0) has = true;
            if (!has) return terr;
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                if (b[r][c] !== 0) continue;
                const visited = Array.from({ length: n }, () => new Uint8Array(n));
                visited[r][c] = 1;
                const queue = [[r, c, 0]];
                let minLayer = Infinity;
                let colors = new Set();
                for (let i = 0; i < queue.length; i++) {
                    const [cr, cc, d] = queue[i];
                    if (d >= minLayer) continue;
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n || visited[nr][nc]) continue;
                        visited[nr][nc] = 1;
                        const v = b[nr][nc];
                        if (v !== 0) {
                            const layer = d + 1;
                            if (layer < minLayer) { minLayer = layer; colors = new Set([v]); }
                            else if (layer === minLayer) colors.add(v);
                        } else queue.push([nr, nc, d + 1]);
                    }
                }
                if (colors.size === 1) {
                    for (const v of colors) terr[r][c] = v;
                }
            }
            return terr;
        }

        function showFourEstimate() {
            if (!scoreTitle || !scoreBoard || !leadInfo) return;
            const [blk, wht, red, blu] = localScoreFour();
            const lead = (blk + blu) - (wht + red);
            scoreTitle.textContent = '形势判断';
            scoreBoard.innerHTML = '黑: ' + fmtTxt(blk) + '　白: ' + fmtTxt(wht) + '<br>红: ' + fmtTxt(red) + '　蓝: ' + fmtTxt(blu);
            leadInfo.textContent = '黑蓝' + fmtTxt(lead) + '点';
            ps.showEstimateActive = true;
            ps.fourTerritoryCache = localFourTerritory();
            drawBoardCore();
        }

        /** 形势判断开关:再点一次关闭(公共 clearEstimate 清面板并重绘) */
        function fourEstimateToggle() {
            if (ps.showEstimateActive) {
                ps.showEstimateActive = false;
                ps.fourTerritoryCache = null;
                clearEstimate();
                drawBoardCore();
            } else {
                showFourEstimate();
            }
        }

        /**
         * 称呼替换(幂等,可反复执行):黑方→黑蓝方、白方→白红方、执黑→执黑蓝、执白→执白红。
         * 先收敛既有重复(执黑蓝蓝蓝…→执黑蓝)并对已生成词做占位保护,避免重复叠加。
         */
        function relabelStr(t) {
            if (!t) return t;
            return t
                .replace(/执黑蓝+/g, '执黑蓝')
                .replace(/执白红+/g, '执白红')
                .replace(/执黑蓝/g, '').replace(/执白红/g, '')
                .replace(/黑蓝方/g, '').replace(/白红方/g, '')
                .replace(/黑方/g, '黑蓝方').replace(/白方/g, '白红方')
                .replace(/执黑/g, '执黑蓝').replace(/执白/g, '执白红')
                .replace(/^黑胜$/g, '黑蓝方胜').replace(/^白胜$/g, '白红方胜')
                .replace(//g, '执黑蓝').replace(//g, '执白红')
                .replace(//g, '黑蓝方').replace(//g, '白红方');
        }

        /** 四色文案覆盖(每状态消息后):komiInfo/称呼/行棋符号 */
        function refreshFourText() {
            if (komiInfo) komiInfo.textContent = '无贴点';
            if (colorStatus && colorStatus.textContent) colorStatus.textContent = relabelStr(colorStatus.textContent);
            if (scoreTitle && scoreTitle.textContent) scoreTitle.textContent = relabelStr(scoreTitle.textContent);
            if (turnDisplay) {
                const raw = turnDisplay.textContent;
                // 对局进行中:正文与公共一致(第N手等),符号 = 上一手行动方(黑蓝方⚫/白红方⚪,
                // 与围棋一致:黑或蓝刚落 ⚫,白或红刚落 ⚪)
                if (ps.matchStarted && !ps.gameOver && !ps.tryPlayMode && !ps.replayMode) {
                    const body = raw.replace(/^[⚫⚪🔴🔵]\s*/, '');
                    let dot = '';
                    // 观战步进中:取当前显示步的落子方
                    const liveTotal = ps.liveReplayBoards.length - 1;
                    const browsingLive = ps.liveReplayBoards.length > 0 && ps.liveViewStep < liveTotal;
                    if (browsingLive && ps.liveReplayStepPlayers[ps.liveViewStep] === 2) dot = '⚪';
                    else if (browsingLive && ps.liveReplayStepPlayers[ps.liveViewStep] === 1) dot = '⚫';
                    else {
                        const mc = ps.moveCoords && ps.moveCoords.length
                            ? ps.moveCoords[ps.moveCoords.length - 1] : null;
                        dot = mc && mc.player === 'white' ? '⚪'
                            : (mc && mc.player === 'black' ? '⚫' : '');
                    }
                    turnDisplay.textContent = (dot ? dot + ' ' : '') + body;
                } else {
                    turnDisplay.textContent = relabelStr(raw);
                }
            }
        }

        function handleMessage(msg) {
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
            maybeCenterViewOnOpponentMove(msg, mkBefore);
            if (msg && msg.type === 'broadcast' && typeof msg.turnColor === 'number') ps.turnColor = msg.turnColor;
            if (msg && msg.state && typeof msg.state.turnColor === 'number') ps.turnColor = msg.state.turnColor;
            if (msg && msg.type === 'timeControlNegotiation') {
                // 对局设置弹窗称呼(执黑/执白等)
                const modal = document.querySelector('.qi-time-control-modal');
                if (modal) {
                    const walk = (node) => {
                        node.childNodes.forEach((ch) => {
                            if (ch.nodeType === 3) {
                                ch.textContent = relabelStr(ch.textContent);
                            } else if (ch.nodeType === 1) walk(ch);
                        });
                    };
                    walk(modal);
                }
            }
            if (msg && msg.type === 'scoreProposal' && scoreConfirmText) {
                const s4 = msg.scores || {};
                const lead = msg.lead;
                scoreConfirmText.innerHTML =
                    '黑: ' + fmtTxt(s4.black) + '　白: ' + fmtTxt(s4.white) + '<br>' +
                    '红: ' + fmtTxt(s4.red) + '　蓝: ' + fmtTxt(s4.blue) + '<br>' +
                    (lead > 0 ? '黑蓝方' : (lead < 0 ? '白红方' : '双方')) + '胜' + fmtTxt(Math.abs(lead)) + '点';
            }
            refreshFourText();
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

        // 可落点:空点即可(与标准围棋一致;禁着由服务器裁决)
        function canPlaceAt(row, col) {
            return row >= 0 && col >= 0 && row < ps.BOARD_SIZE && col < ps.BOARD_SIZE && ps.board[row][col] === 0;
        }

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
                        ps.isHoverValid = canPlaceAt(row, col);
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
                    ps.isHoverValid = canPlaceAt(row, col);
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
                ps.isHoverValid = canPlaceAt(row, col);
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
        // 称呼文案:侧栏座位/计时面板/回放视角中的 黑方/白方 → 黑蓝方/白红方(只动文本节点)
        (function relabelSides() {
            const ids = ['labelBlack', 'labelWhite', 'goTimerBlackTitle', 'goTimerWhiteTitle',
                'goTimerBlackProgress', 'goTimerWhiteProgress', 'replayPerspBlack', 'replayPerspWhite'];
            const swap = (el) => {
                if (!el) return;
                const walk = (node) => {
                    node.childNodes.forEach((ch) => {
                        if (ch.nodeType === 3) {
                            ch.textContent = relabelStr(ch.textContent);
                        } else if (ch.nodeType === 1) walk(ch);
                    });
                };
                walk(el);
            };
            ids.forEach((id) => swap(document.getElementById(id)));
        })();
        const estimateBtnEl = document.getElementById('estimateBtn');
        if (estimateBtnEl) estimateBtnEl.onclick = fourEstimateToggle;

        connectWebSocket(handleMessage);
        })();
    }
};
