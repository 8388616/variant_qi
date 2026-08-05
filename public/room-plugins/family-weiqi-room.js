window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['family-weiqi'] = {
    shell: {
        "title": "全家福围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />\n开局时每个点有5%的概率随机产生：<br />\n<strong>洞：</strong> 不可落子、不可被提、不提供气。<br />\n<strong>中立子：</strong> 不可落子、可被提、不提供气。<br />\n<strong>桥：</strong> 不可落子、不可被提，左右与上下各自连通。<br />\n<strong>雷：</strong> 占据交叉点本身提供一气。第一次选择在雷上「落子」无效（等同于虚着），但会消除雷；该手仍有最后落子标记。之后该点可正常落子。<br />",
        "defaultKomiText": "黑贴白4.75点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "全家福围棋",
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
            },
            {
                "value": "hole",
                "label": "洞"
            },
            {
                "value": "neutral",
                "label": "中立子"
            },
            {
                "value": "bridge",
                "label": "桥"
            },
            {
                "value": "mine",
                "label": "雷"
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "全家福围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const ps = {
            BOARD_SIZE: 19, KOMI: 4.75, PADDING: 0, CELL_SIZE: 0, numberOfHands: 1, currentPlayer: 1,
            mySlot: null, gameOver: false, winner: null, lastMoveMarkers: [], showEstimateActive: false,
            cachedLiveBoard: null, cachedTerritory: null, waitingScoreConfirm: false, iRejected: false,
            ws: null, isMyTurn: false, slots: { black: false, white: false }, reconnectTimer: null,
            replayMode: false, replayBoards: [], replayMarkers: [], replayStepPlayers: [], replayStep: 0, replayTotalSteps: 0,
            showMoveNumbers: false, moveLog: [], tryPlayMode: false, tryPlayBaseStep: 0, tryPlayBoards: [], tryPlayMarkers: [],
            tryPlayCurrentPlayer: 1, tryPlayStep: 0, tryPlayTotalSteps: 0, liveReplayBoards: [], liveReplayMarkers: [],
            liveReplayStepPlayers: [], liveViewStep: 0, liveFollowLatest: true, userBoardMarks: Object.create(null),
            hoverRow: -1, hoverCol: -1, isHoverValid: false, liveOpeningBoard: null, gameStarted: false,
            editModeEnabled: false, editTool: 'empty'
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding; ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = []; a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

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
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(document.getElementById('boardMarkPanel'), document.getElementById('boardMarkFoldBtn'), document.getElementById('boardMarkExpandBtn'));

        const HOLE = -1, BRIDGE = -2, MINE = -3, NEUTRAL = 10000;
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const R = () => QiWeiqiSquarePageRuntime;
        const inBounds = (r, c) => r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE;
        const isStoneVal = (v) => v === 1 || v === 2;

        function resolveBridgeStep(board, row, col, dr, dc) {
            let r = row + dr, c = col + dc;
            while (inBounds(r, c) && board[r][c] === BRIDGE) { r += dr; c += dc; }
            if (!inBounds(r, c)) return null;
            return [r, c];
        }
        function getBridgeNeighbors(board, row, col) {
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]], out = [], seen = new Set();
            for (const [dr, dc] of dirs) {
                const p = resolveBridgeStep(board, row, col, dr, dc);
                if (!p) continue;
                const key = p[0] + ',' + p[1];
                if (!seen.has(key)) { seen.add(key); out.push(p); }
            }
            return out;
        }
        function assignTerritoryWithBridgeGraph(liveBoard, boardSize, options = {}) {
            const isPassable = options.isPassable ?? ((v) => v !== -1);
            const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
            const bridgeTerritoryNeighbors = (row, col) => {
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]], out = [], seen = new Set();
                for (const [dr, dc] of dirs) {
                    let nr = row + dr, nc = col + dc;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                    while (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && liveBoard[nr][nc] === BRIDGE) {
                        nr += dr; nc += dc;
                    }
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                    if (!isPassable(liveBoard[nr][nc])) continue;
                    const key = nr + ',' + nc;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push([nr, nc]);
                }
                return out;
            };
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (liveBoard[r][c] !== 0) continue;
                    const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                    let blackMin = Infinity, whiteMin = Infinity;
                    const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                    dist[r][c] = 0;
                    const queue = [[r, c]];
                    let front = 0;
                    while (front < queue.length) {
                        const [cr, cc] = queue[front++];
                        const d = dist[cr][cc];
                        if (d > maxDist) continue;
                        const v = liveBoard[cr][cc];
                        if (v === 1 && d < blackMin) blackMin = d;
                        if (v === 2 && d < whiteMin) whiteMin = d;
                        for (const [nr, nc] of bridgeTerritoryNeighbors(cr, cc)) {
                            if (dist[nr][nc] !== Infinity) continue;
                            dist[nr][nc] = d + 1;
                            queue.push([nr, nc]);
                        }
                    }
                    if (blackMin <= maxDist && whiteMin <= maxDist) {
                        if (blackMin < whiteMin) territory[r][c] = 1;
                        else if (whiteMin < blackMin) territory[r][c] = 2;
                        else territory[r][c] = 3;
                    } else if (blackMin <= maxDist) territory[r][c] = 1;
                    else if (whiteMin <= maxDist) territory[r][c] = 2;
                    else territory[r][c] = 3;
                }
            }
            return territory;
        }
        function collectGroup(board, row, col, color) {
            const st = [[row, col]], seen = new Set(), group = [];
            while (st.length) {
                const [r, c] = st.pop(), key = r + ',' + c;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!inBounds(r, c) || board[r][c] !== color) continue;
                group.push([r, c]);
                for (const [nr, nc] of getBridgeNeighbors(board, r, c)) if (board[nr][nc] === color) st.push([nr, nc]);
            }
            return group;
        }
        function hasFamilyLiberty(board, row, col) {
            const v = board[row][col];
            if (v === 0 || v === BRIDGE || v === HOLE || v === MINE) return false;
            const group = collectGroup(board, row, col, v);
            for (const [r, c] of group) 
                for (const [nr, nc] of getBridgeNeighbors(board, r, c)) {
                    const nv = board[nr][nc];
                    if (nv === NEUTRAL || nv === HOLE || nv === BRIDGE) continue;
                    if (nv === 0 || nv === MINE) return true;
                }
            return false;
        }
        function removeFamilyGroup(board, row, col, color) {
            const g = collectGroup(board, row, col, color);
            for (const [r, c] of g) board[r][c] = 0;
        }
        function familyTryPlaceStone(boardBefore, row, col, playerVal)
        {
            if (!inBounds(row, col) || boardBefore[row][col] !== 0) 
                return null;
            const board = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            board[row][col] = playerVal;
            const toCapture = [];
            const seen = new Set();

            for (const [nr, nc] of getBridgeNeighbors(board, row, col)) 
            {
                const v = board[nr][nc];
                if ((v === 3 - playerVal || v === NEUTRAL) && !hasFamilyLiberty(board, nr, nc)) 
                {
                    const key = `${v}:${nr},${nc}`;
                    if (!seen.has(key))
                    {
                        seen.add(key);
                        toCapture.push({ row: nr, col: nc, color: v });
                    }
                }
            }
            for (const stone of toCapture) 
            {
                if (board[stone.row][stone.col] === stone.color)
                    removeFamilyGroup(board, stone.row, stone.col, stone.color);
            }

            if (!hasFamilyLiberty(board, row, col))
                removeFamilyGroup(board, row, col, playerVal);
            return board;
        }
        function familyRemoveDeadAndDying(srcBoard) {
            const b = QiSquareWeiqiCanvas.deepCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        const v = b[r][c];
                        if ((v === 1 || v === 2 || v === NEUTRAL) && !hasFamilyLiberty(b, r, c)) {
                            removeFamilyGroup(b, r, c, v);
                            changed = true;
                        }
                    }
                }
            }
            return b;
        }

        function familyRebuildLiveReplayFromMoveCoords(moveCoords) {
            const ob = ps.liveOpeningBoard;
            const dc = QiSquareWeiqiCanvas.deepCopyBoard;
            let curBoard = ob ? dc(ob) : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
            const liveReplayBoards = [dc(curBoard)];
            const liveReplayMarkers = [[]];
            const liveReplayStepPlayers = [0];
            for (const move of moveCoords || []) {
                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = familyTryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(dc(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(dc(curBoard));
                    liveReplayMarkers.push([]);
                } else if (move.type === 'mineHit') {
                    curBoard = dc(curBoard);
                    if (curBoard[move.row][move.col] === MINE) curBoard[move.row][move.col] = 0;
                    liveReplayBoards.push(dc(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                }
            }
            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
        }

        function familyBuildReplayFromImportData(data) {
            const dc = QiSquareWeiqiCanvas.deepCopyBoard;
            let curBoard = QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
            const boardSize = curBoard.length;
            if (data.initialPosition && Array.isArray(data.initialPosition)) {
                R().applyInitialPositionCompact(curBoard, boardSize, data.initialPosition);
            }
            const replayBoards = [dc(curBoard)];
            const replayMarkers = [[]];
            const replayStepPlayers = [0];
            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = familyTryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(dc(curBoard));
                    replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    replayBoards.push(dc(curBoard));
                    replayMarkers.push([]);
                } else if (move.type === 'mineHit') {
                    curBoard = dc(curBoard);
                    if (curBoard[move.row][move.col] === MINE) curBoard[move.row][move.col] = 0;
                    replayBoards.push(dc(curBoard));
                    replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                }
            }
            return {
                replayBoards,
                replayMarkers,
                replayStepPlayers,
                replayTotalSteps: replayBoards.length - 1
            };
        }
        function familyComputeStoneNumbers() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            const applyMarker = (i, markers) => {
                if (!markers || !markers.length) return;
                const m = markers[0];
                if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col])) nums[m.row][m.col] = i;
            };
            if (ps.replayMode && ps.tryPlayMode) for (let i = 1; i <= ps.tryPlayStep; i++) applyMarker(i, ps.tryPlayMarkers[i]);
            else if (ps.replayMode) for (let i = 1; i <= ps.replayStep; i++) applyMarker(i, ps.replayMarkers[i]);
            else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) for (let i = 1; i <= ps.liveViewStep; i++) applyMarker(i, ps.liveReplayMarkers[i]);
            else for (let i = 0; i < ps.moveLog.length; i++) {
                const m = ps.moveLog[i];
                if (m && m.row != null && m.col != null && m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && isStoneVal(ps.board[m.row][m.col])) nums[m.row][m.col] = i + 1;
            }
            return nums;
        }
        function familyDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw, cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    if (ps.board[r][c] === HOLE)
                        R().drawRedBlockHole(r, c, ctx, ps.PADDING, ps.CELL_SIZE);
                    else if (ps.board[r][c] === BRIDGE)
                        R().drawBridge(r, c, ctx, ps.PADDING, ps.CELL_SIZE, ps.BOARD_SIZE);
                    else if (ps.board[r][c] === NEUTRAL)
                        R().drawNeutralStone(r, c, ctx, ps.PADDING, ps.CELL_SIZE);
                    else if (ps.board[r][c] === MINE) 
                        R().drawMine(r, c, ctx, ps.PADDING, ps.CELL_SIZE);
                }
            }
            const stoneRadius = ps.CELL_SIZE * 0.44, markLenDefault = ps.CELL_SIZE * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker)
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, stoneRadius);
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker)
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, markLenDefault);
            function isUserBoardMarkVisibleAt(br, bc) {
                if (ps.showEstimateActive) return false;
                if (!inBounds(br, bc)) return false;
                return ps.board[br][bc] === 0;
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) d.moveNumbersOnStones(ctx, familyComputeStoneNumbers(), ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            const hr = ps.hoverRow, hc = ps.hoverCol;
            const hoverCell = hr >= 0 && hc >= 0 ? ps.board[hr][hc] : null;
            const hoverValidCell = hr >= 0 && hc >= 0 && (hoverCell === 0 || hoverCell === MINE);
            const hoverStoneValidEmpty = hr >= 0 && hc >= 0 && hoverCell === 0 && ps.isHoverValid && hoverValidCell;
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, ps.CELL_SIZE, {
                tryPlayMode: ps.tryPlayMode, tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer, gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn, mySlot: ps.mySlot, isHoverValid: hoverStoneValidEmpty, hoverCapture: !!ps.hoverCapture
            });
            if (hoverValidCell && hoverCell === MINE && ps.isHoverValid && !ps.hoverCapture) {
                const canMineHover = ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn);
                if (canMineHover) {
                    const cx = ps.PADDING + hc * ps.CELL_SIZE;
                    const cy = ps.PADDING + hr * ps.CELL_SIZE;
                    R().stoneDanger.drawRing(ctx, cx, cy, ps.CELL_SIZE * 0.44, '#d62828', ps.CELL_SIZE * 0.055);
                }
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, ps.cachedLiveBoard, ps.cachedTerritory);
        }

        const domPage = { turnDisplay, scoreTitle, scoreBoard, leadInfo, scoreConfirmPanel, scoreConfirmText, komiInfo: document.getElementById('komiInfo'), canvas, ctx, boardMarkSelect, colorStatus };
        const pageHolder = {};
        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix, minLib, maxWeakLiberties: 2, gameType, roomId, roomPassword, isMouseDevice,
            tryPlaceStone: familyTryPlaceStone, drawBoard: familyDrawBoard,
            removeDeadAndDying: (src) => familyRemoveDeadAndDying(src),
            assignTerritoryWithRange: (live) => assignTerritoryWithBridgeGraph(live, ps.BOARD_SIZE, { isPassable: (v) => v !== HOLE && v !== BRIDGE && v !== MINE && v !== NEUTRAL }),
            rebuildLiveReplayFromMoveCoords: familyRebuildLiveReplayFromMoveCoords,
            enterReplayMode(data) {
                const built = familyBuildReplayFromImportData(data);
                ps.replayBoards = built.replayBoards; ps.replayMarkers = built.replayMarkers; ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps; ps.replayMode = true;
                const slider = document.getElementById('replaySlider'); slider.max = ps.replayTotalSteps;
                const p = pageHolder.page; if (p) { p.setReplayStep(ps.replayTotalSteps); p.updateReplayUI(); }
            }
        });
        pageHolder.page = page;

        const tryPlayMoveInner = page.tryPlayMove.bind(page);
        function familyTryPlayMove(row, col) {
            if (ps.board[row][col] === MINE) {
                const playerVal = ps.tryPlayCurrentPlayer;
                const nb = QiSquareWeiqiCanvas.deepCopyBoard(ps.board);
                nb[row][col] = 0;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(nb));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = nb;
                ps.lastMoveMarkers = [{ row, col, color: playerVal }];
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate();
                else drawBoard();
                return true;
            }
            return tryPlayMoveInner(row, col);
        }
        function familyCommitMove(row, col) {
            if (ps.gameOver || !ps.isMyTurn) return false;
            const v = ps.board[row][col];
            if (v !== 0 && v !== MINE) return false;
            ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        const { mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, updateTurn, showEstimate, clearEstimate, downloadRecord,
            showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI, enterTryPlay, exitTryPlay,
            setTryPlayStep, updateTryPlayDisplay, applyLiveViewBoard, updateLiveReplayPanelUI, setLiveViewStep, connectWebSocket, initBoardArray,
            updateBoardGeometry, syncState: syncStateBase, getClosestIntersection, canvasCoordsFromClient,
            applyUserBoardMark, updateEditModeUI, clearEditModeUi } = page;

        function syncState(state) {
            ps.gameStarted = (state.numberOfHands || 1) > 1;
            syncStateBase(state);
            updateEditModeUI();
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId, gameType, pageState: ps, drawBoard, exitTryPlay, enterTryPlay, setTryPlayStep, setReplayStep, setLiveViewStep,
            getWs: () => ps.ws, getBoardSize: () => ps.BOARD_SIZE, setBoardSize: (n) => { ps.BOARD_SIZE = n; },
            getKomi: () => ps.KOMI, setKomi: (n) => { ps.KOMI = n; },
            getBoard: () => ps.board.map(row => row.map(c => (c === HOLE || c === NEUTRAL || c === BRIDGE || c === MINE ? 0 : c))), setBoard: (b) => { ps.board = b; },
            getSlots: () => ps.slots, setSlots: (s) => { ps.slots = s; }, getMySlot: () => ps.mySlot, setMySlot: (s) => { ps.mySlot = s; },
            getGameOver: () => ps.gameOver, setGameOver: (v) => { ps.gameOver = v; }, getWinner: () => ps.winner, setWinner: (w) => { ps.winner = w; },
            getReplayMode: () => ps.replayMode, getShowEstimateActive: () => ps.showEstimateActive, setShowEstimateActive: (v) => { ps.showEstimateActive = v; },
            getWaitingScoreConfirm: () => ps.waitingScoreConfirm, setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
            getIRejected: () => ps.iRejected, setIRejected: (v) => { ps.iRejected = v; },
            colorStatus, scoreTitle, turnDisplay, syncState, updateBoardGeometry,
            initBoardArray, exitReplayMode, clearEstimate, hideScoreConfirm, showEstimate, clearMobileMovePreview, downloadRecord,
            enterReplayMode, updateTurn, updateReplayUI, showScoreConfirm, isMouseDevice, standardWeiqiMatchTime,
            boardSeatOverlay: true,
            onNewGameStarted() {
                clearEditModeUi();
            },
            onBoardSizeChanged(msg) { syncState(msg); }
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
        const LONG_MARK_MS = 500, LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null, longMarkStart = null;
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
            const t = e.touches[0], dx = t.clientX - longMarkStart.x, dy = t.clientY - longMarkStart.y;
            if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) { clearTimeout(longMarkTimer); longMarkTimer = null; }
        }, { passive: true });
        function clearLongMarkTouch() { if (longMarkTimer) { clearTimeout(longMarkTimer); longMarkTimer = null; } longMarkStart = null; }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
            const rect = canvas.getBoundingClientRect(), scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                if (ps.board[row][col] !== 0 && ps.board[row][col] !== MINE) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); familyTryPlayMove(row, col); }
                    else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                    return;
                }
                familyTryPlayMove(row, col); return;
            }
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
            if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
            if (!(ps.board[row][col] === 0 || ps.board[row][col] === MINE)) return;
            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); familyCommitMove(row, col); drawBoard(); }
                else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                return;
            }
            familyCommitMove(row, col);
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect(), scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && (ps.board[row][col] === 0 || ps.board[row][col] === MINE));
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
            });
        }

        if (scoreConfirmYes) {
            scoreConfirmYes.onclick = () => { ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: true })); hideScoreConfirm(); };
            scoreConfirmNo.onclick = () => {
                ps.iRejected = true;
                ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (ps.showEstimateActive) { ps.showEstimateActive = false; clearEstimate(); }
                ps.waitingScoreConfirm = false;
            };
        }
        connectWebSocket(handleMessage);
        })();
    }
};
