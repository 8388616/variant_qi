window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['ukrainian-weiqi'] = {
    shell: {
        "title": "乌克兰围棋",
        "rulesHtml": "基本规则同围棋。<br /><br /><br />使用复合棋子，每个复合棋子由三个单棋子组成。可选的复合棋子在棋盘下方。可以旋转、翻折。<br /><br />单击右键旋转，长按右键翻折，滑动鼠标滚轮切换形状。<br /><br />同一方不可以连续两步使用相同的形状。<br /><br />当双方连续四手虚着时进入数点流程。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "乌克兰围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "compoundPalette": true,
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
        ],
        "boardMarkTitle": "Ctrl+右键或长按空点放置标记（避免与旋转/翻折冲突）；再次放置可清除"
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "乌克兰围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const SHAPE_LIST = [
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [0, 1], [1, -1]],
            [[-1, -1], [0, 1], [1, 0]],
            [[-1, -1], [1, -1], [-1, 1]]
        ];

        var ps = {
            BOARD_SIZE: 19,
            KOMI: 3.25,
            PADDING: 0,
            CELL_SIZE: 0,
            numberOfHands: 1,
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            normalGoPhase: false,
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
            liveReplayLastUsedAtStep: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            board: [],
            lastUsedShapeByColor: { 1: -1, 2: -1 },
            replayLastUsedAtStep: [],
            tryPlayShapeByStep: [-1],
            replayLastUsedSnapshot: { 1: -1, 2: -1 },
            tryPlayLastUsedShapeByColor: { 1: -1, 2: -1 },
            currentShapeIndex: 0,
            rotation: 0,
            flipped: false,
            hasPreview: false,
            pendingPreviewRow: -1,
            pendingPreviewCol: -1,
            _needCompoundShapeHint: false,
            computerSlot: null,
            _computerMoveSchedKey: null
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
const vsComputerBtn = document.getElementById('vsComputerBtn');
        const scoreTitle = document.getElementById('scoreTitle');

        function updateVsComputerBtn() {
            if (!vsComputerBtn) return;
            const opp = ps.mySlot === 'black' ? 'white' : 'black';
            const waitingForHuman = ps.mySlot && !ps.slots[opp];
            const show = waitingForHuman && !ps.replayMode && !ps.gameOver && !ps.computerSlot && !ps.waitingScoreConfirm;
            vsComputerBtn.style.display = show ? '' : 'none';
        }
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
        const scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');
        const bottomPalette = document.querySelector('.bottom-palette');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

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

        const R = () => QiWeiqiSquarePageRuntime;
        const C = () => QiSquareWeiqiCanvas;

        function deepCopyBoard(src) { return src.map(row => row.slice()); }

        function transformCoords(baseCoords, rot, flip) {
            return baseCoords.map(([dr, dc]) => {
                let r = dr, c = dc;
                for (let i = 0; i < rot; i++) { [r, c] = [-c, r]; }
                if (flip) c = -c;
                return [r, c];
            });
        }

        function generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol) {
            const base = SHAPE_LIST[shapeIdx];
            const transformed = transformCoords(base, rot, flip);
            return transformed.map(([dr, dc]) => [refRow + dr, refCol + dc]);
        }

        function inferShapeIndexFromStones(stones) {
            if (!stones || stones.length !== 3) return -1;
            const norm = (arr) => [...arr].map(([r, c]) => `${r},${c}`).sort().join('|');
            const target = norm(stones);
            for (let shapeIdx = 0; shapeIdx < SHAPE_LIST.length; shapeIdx++) {
                for (let rot = 0; rot < 4; rot++) {
                    for (const flip of [false, true]) {
                        for (let refR = 0; refR < ps.BOARD_SIZE; refR++) {
                            for (let refC = 0; refC < ps.BOARD_SIZE; refC++) {
                                const coords = generatePlacementCoords(shapeIdx, rot, flip, refR, refC);
                                if (norm(coords) === target) return shapeIdx;
                            }
                        }
                    }
                }
            }
            return -1;
        }

        function countGroupLiberties(brd, row, col) {
            return R().countGroupLiberties(brd, row, col, ps.BOARD_SIZE);
        }

        function removeGroup(brd, row, col, color) {
            R().removeGroup(brd, row, col, color, ps.BOARD_SIZE);
        }

        function tryPlaceShape(boardBefore, shapeIdx, rot, flip, refRow, refCol, playerVal) {
            const coords = generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol);
            if (!coords) return null;
            for (let [r, c] of coords) {
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return null;
                if (boardBefore[r][c] !== 0) return null;
            }
            const newBoard = deepCopyBoard(boardBefore);
            for (let [r, c] of coords) newBoard[r][c] = playerVal;
            const affectedEnemy = new Set();
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (let [r, c] of coords) {
                for (let [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < ps.BOARD_SIZE && nc >= 0 && nc < ps.BOARD_SIZE && newBoard[nr][nc] === 3 - playerVal)
                        affectedEnemy.add(`${nr},${nc}`);
                }
            }
            for (let key of affectedEnemy) {
                const [r, c] = key.split(',').map(Number);
                if (newBoard[r][c] === 3 - playerVal && countGroupLiberties(newBoard, r, c) === 0)
                    removeGroup(newBoard, r, c, 3 - playerVal);
            }
            for (let [r, c] of coords) {
                if (newBoard[r][c] === playerVal && countGroupLiberties(newBoard, r, c) === 0)
                    removeGroup(newBoard, r, c, playerVal);
            }
            return newBoard;
        }

        function boardStringForKo(board) {
            return board.map(row => row.join(',')).join(';');
        }

        function buildKoHistorySetFromLiveReplay() {
            const h = new Set();
            for (const b of ps.liveReplayBoards)
                h.add(boardStringForKo(b));
            return h;
        }

        /** 前端算电脑应手，通过 computerMove 提交服务器 */
        function maybeRunFrontendComputerMove() {
            if (typeof UkrainianWeiqiAI === 'undefined') {
                if (!ps._warnedMissingFrontendAi) {
                    ps._warnedMissingFrontendAi = true;
                    console.warn('乌克兰围棋：未加载 ukrainian-weiqi-ai.js（全局 UkrainianWeiqiAI），电脑无法落子。请确认 public 下有该文件且 /qi/ukrainian-weiqi-ai.js 可访问。');
                }
                return;
            }
            if (!ps.computerSlot || ps.gameOver || ps.replayMode || ps.waitingScoreConfirm) return;
            if (!ps.matchStarted || !ps.ws || ps.ws.readyState !== WebSocket.OPEN) return;
            const turnSlot = ps.currentPlayer === 1 ? 'black' : 'white';
            if (turnSlot !== ps.computerSlot) return;
            const schedKey = `${ps.numberOfHands}_${ps.currentPlayer}_${boardStringForKo(ps.board)}`;
            if (ps._computerMoveSchedKey === schedKey) return;
            ps._computerMoveSchedKey = schedKey;

            // setTimeout：让上一帧的棋盘绘制先完成，再跑 AI，避免长时间思考卡住首帧 paint
            setTimeout(() => {
                if (!ps.ws || ps.ws.readyState !== WebSocket.OPEN || ps.gameOver) return;
                const t2 = ps.currentPlayer === 1 ? 'black' : 'white';
                if (t2 !== ps.computerSlot) return;

                const hist = buildKoHistorySetFromLiveReplay();
                const mv = UkrainianWeiqiAI.chooseMove({
                    board: ps.board.map(row => row.slice()),
                    boardSize: ps.BOARD_SIZE,
                    currentPlayer: ps.currentPlayer,
                    normalGoPhase: !!ps.normalGoPhase,
                    lastUsedShapeByColor: { ...ps.lastUsedShapeByColor },
                    historySet: hist,
                    tryPlaceShape,
                    tryPlaceStonesAt,
                    countGroupLiberties,
                    komi: ps.KOMI,
                    removeDeadAndDying: (src) => _page.removeDeadAndDying(src),
                    assignTerritoryWithRange: (lb) => _page.assignTerritoryWithRange(lb),
                    computeScore: (lb, terr) => R().computeScore(lb, terr, ps.BOARD_SIZE)
                });
                const pv = ps.computerSlot === 'black' ? 1 : 2;
                if (mv) {
                    if (mv.singleStone) {
                        const nb = tryPlaceStonesAt(ps.board, [[mv.row, mv.col]], pv);
                        if (!nb || hist.has(boardStringForKo(nb))) {
                            ps.ws.send(JSON.stringify({ type: 'computerMove', pass: true }));
                            return;
                        }
                        ps.ws.send(JSON.stringify({
                            type: 'computerMove',
                            singleStone: true,
                            row: mv.row,
                            col: mv.col
                        }));
                        return;
                    }
                    if (ps.lastUsedShapeByColor[pv] === mv.shapeIndex) {
                        ps.ws.send(JSON.stringify({ type: 'computerMove', pass: true }));
                        return;
                    }
                    const nb = tryPlaceShape(ps.board, mv.shapeIndex, mv.rotation, mv.flipped, mv.row, mv.col, pv);
                    if (!nb || hist.has(boardStringForKo(nb))) {
                        ps.ws.send(JSON.stringify({ type: 'computerMove', pass: true }));
                        return;
                    }
                    ps.ws.send(JSON.stringify({
                        type: 'computerMove',
                        shapeIndex: mv.shapeIndex,
                        rotation: mv.rotation,
                        flipped: mv.flipped,
                        row: mv.row,
                        col: mv.col
                    }));
                } else {
                    ps.ws.send(JSON.stringify({ type: 'computerMove', pass: true }));
                }
            }, 0);
        }

        function tryPlaceStonesAt(boardBefore, stoneCoords, playerVal) {
            if (!stoneCoords || stoneCoords.length === 0) return null;
            for (let [r, c] of stoneCoords) {
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return null;
                if (boardBefore[r][c] !== 0) return null;
            }
            const newBoard = deepCopyBoard(boardBefore);
            for (let [r, c] of stoneCoords) newBoard[r][c] = playerVal;
            const affectedEnemy = new Set();
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (let [r, c] of stoneCoords) {
                for (let [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < ps.BOARD_SIZE && nc >= 0 && nc < ps.BOARD_SIZE && newBoard[nr][nc] === 3 - playerVal)
                        affectedEnemy.add(`${nr},${nc}`);
                }
            }
            for (let key of affectedEnemy) {
                const [r, c] = key.split(',').map(Number);
                if (newBoard[r][c] === 3 - playerVal && countGroupLiberties(newBoard, r, c) === 0)
                    removeGroup(newBoard, r, c, 3 - playerVal);
            }
            for (let [r, c] of stoneCoords) {
                if (newBoard[r][c] === playerVal && countGroupLiberties(newBoard, r, c) === 0)
                    removeGroup(newBoard, r, c, playerVal);
            }
            return newBoard;
        }

        function inNormalGoLivePlay() {
            return !!ps.normalGoPhase && !(ps.tryPlayMode && ps.replayMode);
        }

        function singleStoneCellFree(refRow, refCol) {
            if (refRow < 0 || refCol < 0 || refRow >= ps.BOARD_SIZE || refCol >= ps.BOARD_SIZE) return false;
            return ps.board[refRow][refCol] === 0;
        }

        function hoverPlacementFree(refRow, refCol) {
            return inNormalGoLivePlay() ? singleStoneCellFree(refRow, refCol) : compoundPlacementCellsFree(refRow, refCol);
        }

        function isPreviewGeometryValid(refRow, refCol) {
            if (inNormalGoLivePlay()) {
                return refRow >= 0 && refCol >= 0 && refRow < ps.BOARD_SIZE && refCol < ps.BOARD_SIZE;
            }
            const coords = generatePlacementCoords(ps.currentShapeIndex, ps.rotation, ps.flipped, refRow, refCol);
            if (!coords) return false;
            for (let [r, c] of coords) {
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            }
            return true;
        }

        /** 三颗复合子对应交叉点均在棋盘内且为空（锚点/点击点可以不是子点，故不能仅用 board[ref][ref] 判断） */
        function compoundPlacementCellsFree(refRow, refCol) {
            const coords = generatePlacementCoords(ps.currentShapeIndex, ps.rotation, ps.flipped, refRow, refCol);
            if (!coords) return false;
            for (let [r, c] of coords) {
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
            }
            return true;
        }

        function isPlacementValid(refRow, refCol) {
            if (ps.tryPlayMode && ps.replayMode) {
                if (ps.waitingScoreConfirm) return false;
                return compoundPlacementCellsFree(refRow, refCol);
            }
            if (!ps.isMyTurn || ps.gameOver || ps.waitingScoreConfirm) return false;
            return inNormalGoLivePlay() ? singleStoneCellFree(refRow, refCol) : compoundPlacementCellsFree(refRow, refCol);
        }

        /** 底部复合子配色：执黑与观战为黑方视角；执白为白方视角；打谱试下时随当前轮行棋方切换。 */
        function compoundPalettePlayerVal() {
            if (ps.tryPlayMode && ps.replayMode) return ps.tryPlayCurrentPlayer;
            return ps.mySlot === 'white' ? 2 : 1;
        }

        function computeTryPlayLastUsedAfterNTrialMoves(n) {
            const base = { ...ps.replayLastUsedSnapshot };
            const basePlayer = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                ? ps.tryPlayBasePlayer
                : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
            for (let i = 1; i <= n; i++) {
                const si = ps.tryPlayShapeByStep[i];
                if (si === undefined) continue;
                const pv = (i % 2 === 1) ? basePlayer : (3 - basePlayer);
                if (si < 0) base[pv] = -1;
                else base[pv] = si;
            }
            return base;
        }

        function refreshTryPlayLastUsedShapeByColor() {
            if (!ps.tryPlayMode || !ps.replayMode) return;
            ps.tryPlayLastUsedShapeByColor = computeTryPlayLastUsedAfterNTrialMoves(ps.tryPlayStep);
        }

        function isUserBoardMarkVisibleAt(r, c) {
            if (ps.showEstimateActive) return false;
            if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            if (ps.board[r][c] !== 0) return false;
            const canPreview = ps.tryPlayMode && ps.replayMode ? !ps.waitingScoreConfirm : (!ps.gameOver && ps.isMyTurn);
            if (canPreview) {
                let previewRow = -1, previewCol = -1, previewActive = false;
                if (isMouseDevice && ps.hoverRow >= 0 && ps.hoverCol >= 0 && isPreviewGeometryValid(ps.hoverRow, ps.hoverCol)) {
                    previewRow = ps.hoverRow; previewCol = ps.hoverCol; previewActive = true;
                } else if (!isMouseDevice && ps.hoverRow >= 0 && ps.hoverCol >= 0 && isPreviewGeometryValid(ps.hoverRow, ps.hoverCol)) {
                    previewRow = ps.hoverRow; previewCol = ps.hoverCol; previewActive = true;
                } else if (isTouchDevice && ps.hasPreview && ps.pendingPreviewRow >= 0 && ps.pendingPreviewCol >= 0
                    && isPreviewGeometryValid(ps.pendingPreviewRow, ps.pendingPreviewCol)) {
                    previewRow = ps.pendingPreviewRow; previewCol = ps.pendingPreviewCol; previewActive = true;
                }
                if (previewActive) {
                    if (inNormalGoLivePlay() && singleStoneCellFree(previewRow, previewCol)) {
                        if (r === previewRow && c === previewCol) return false;
                    } else if (!inNormalGoLivePlay()) {
                        const coords = generatePlacementCoords(ps.currentShapeIndex, ps.rotation, ps.flipped, previewRow, previewCol);
                        if (coords && coords.some(([cr, cc]) => cr === r && cc === c)) return false;
                    }
                }
            }
            return true;
        }

        function computeCompoundStoneNumbers() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const turnNum = i;
                        for (const m of markers) {
                            if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = turnNum;
                        }
                    }
                }
            } else if (ps.replayMode) {
                for (let i = 1; i <= ps.replayStep; i++) {
                    const markers = ps.replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const turnNum = i;
                        for (const m of markers) {
                            if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = turnNum;
                        }
                    }
                }
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) {
                    const markers = ps.liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const turnNum = i;
                        for (const m of markers) {
                            if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                                nums[m.row][m.col] = turnNum;
                        }
                    }
                }
            } else {
                let handNum = 0;
                for (const m of ps.moveLog) {
                    if (!m) continue;
                    handNum++;
                    if (m.type === 'move' && m.stones) {
                        for (const [r, c] of m.stones) {
                            if (r < ps.BOARD_SIZE && c < ps.BOARD_SIZE && ps.board[r][c] !== 0)
                                nums[r][c] = handNum;
                        }
                    }
                }
            }
            return nums;
        }

        function drawCompoundBoard() {
            const d = C().draw;
            const cs = C().DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
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
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = computeCompoundStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }

            const canPreview = ps.tryPlayMode && ps.replayMode ? !ps.waitingScoreConfirm : (!ps.gameOver && ps.isMyTurn);
            if (canPreview) {
                let previewRow = -1, previewCol = -1, previewActive = false;
                if (isMouseDevice && ps.hoverRow >= 0 && ps.hoverCol >= 0 && isPreviewGeometryValid(ps.hoverRow, ps.hoverCol)) {
                    previewRow = ps.hoverRow; previewCol = ps.hoverCol; previewActive = true;
                } else if (!isMouseDevice && ps.hoverRow >= 0 && ps.hoverCol >= 0 && isPreviewGeometryValid(ps.hoverRow, ps.hoverCol)) {
                    previewRow = ps.hoverRow; previewCol = ps.hoverCol; previewActive = true;
                } else if (isTouchDevice && ps.hasPreview && ps.pendingPreviewRow >= 0 && ps.pendingPreviewCol >= 0
                    && isPreviewGeometryValid(ps.pendingPreviewRow, ps.pendingPreviewCol)) {
                    previewRow = ps.pendingPreviewRow; previewCol = ps.pendingPreviewCol; previewActive = true;
                }
                if (previewActive) {
                    const pv = compoundPalettePlayerVal();
                    const radius = cellSize * 0.44;
                    if (inNormalGoLivePlay() && singleStoneCellFree(previewRow, previewCol)) {
                        const cx = ps.PADDING + previewCol * cellSize, cy = ps.PADDING + previewRow * cellSize;
                        ctx.globalAlpha = 0.45;
                        ctx.beginPath();
                        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                        ctx.fillStyle = pv === 1 ? '#222' : '#ddd';
                        ctx.fill();
                        ctx.globalAlpha = 1.0;
                    } else if (!inNormalGoLivePlay()) {
                        const coords = generatePlacementCoords(ps.currentShapeIndex, ps.rotation, ps.flipped, previewRow, previewCol);
                        if (coords) {
                            for (let [r, c] of coords) {
                                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) continue;
                                const cx = ps.PADDING + c * cellSize, cy = ps.PADDING + r * cellSize;
                                if (ps.board[r][c] === 0) {
                                    ctx.globalAlpha = 0.45;
                                    ctx.beginPath();
                                    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                                    ctx.fillStyle = pv === 1 ? '#222' : '#ddd';
                                    ctx.fill();
                                } else {
                                    ctx.globalAlpha = 0.55;
                                    ctx.beginPath();
                                    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                                    ctx.fillStyle = 'rgba(220, 72, 56, 0.65)';
                                    ctx.fill();
                                }
                            }
                            ctx.globalAlpha = 1.0;
                        }
                    }
                }
            }

            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        }

        function rebuildCompoundLive(moveCoords, openingBoard) {
            let curBoard = openingBoard
                ? deepCopyBoard(openingBoard)
                : C().initBoardArray(ps.BOARD_SIZE);
            let lu = { 1: -1, 2: -1 };
            const liveReplayLastUsedAtStep = [{ 1: -1, 2: -1 }];
            const liveReplayBoards = [deepCopyBoard(curBoard)];
            const liveReplayMarkers = [[]];
            const liveReplayStepPlayers = [0];
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move' && move.stones) {
                    const nb = tryPlaceStonesAt(curBoard, move.stones.map(([r, c]) => [r, c]), playerVal);
                    if (nb) curBoard = nb;
                    let si = move.shapeIndex;
                    if (typeof si !== 'number' || si < 0) {
                        si = inferShapeIndexFromStones(move.stones.map(([r, c]) => [r, c]));
                    }
                    lu[playerVal] = si >= 0 ? si : -1;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push(move.stones.map(([r, c]) => ({ row: r, col: c, color: playerVal })));
                } else if (move.type === 'pass') {
                    lu[playerVal] = -1;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
                liveReplayLastUsedAtStep.push({ ...lu });
            }
            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
            ps.liveReplayLastUsedAtStep = liveReplayLastUsedAtStep;
        }

        function buildCompoundReplayFromData(data) {
            let curBoard = C().initBoardArray(ps.BOARD_SIZE);
            let lu = { 1: -1, 2: -1 };
            const replayLastUsedAtStep = [{ 1: -1, 2: -1 }];
            if (data.initialPosition && Array.isArray(data.initialPosition)) {
                QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, ps.BOARD_SIZE, data.initialPosition);
            }
            const replayBoards = [deepCopyBoard(curBoard)];
            const replayMarkers = [[]];
            const replayStepPlayers = [0];
            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move' && move.stones) {
                    const nb = tryPlaceStonesAt(curBoard, move.stones.map(([r, c]) => [r, c]), playerVal);
                    if (nb) curBoard = nb;
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push(move.stones.map(([r, c]) => ({ row: r, col: c, color: playerVal })));
                    let si = move.shapeIndex;
                    if (typeof si !== 'number' || si < 0) {
                        si = inferShapeIndexFromStones(move.stones.map(([r, c]) => [r, c]));
                    }
                    lu[playerVal] = si >= 0 ? si : -1;
                } else if (move.type === 'pass') {
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([]);
                    lu[playerVal] = -1;
                }
                replayLastUsedAtStep.push({ ...lu });
            }
            return {
                replayBoards,
                replayMarkers,
                replayStepPlayers,
                replayTotalSteps: replayBoards.length - 1,
                replayLastUsedAtStep
            };
        }

        function updateShapeColors() {
            const stones = document.querySelectorAll('.piece-btn .stone');
            const isWhite = compoundPalettePlayerVal() === 2;
            stones.forEach(stone => {
                stone.style.background = isWhite ? '#ffffff' : '#222222';
                stone.style.border = isWhite ? '1px solid #ccc' : '1px solid #444';
            });
        }

        function updateShapeAvailability() {
            const buttons = document.querySelectorAll('.piece-btn');
            let disabledShape = -1;
            if (ps.tryPlayMode && ps.replayMode) {
                const playerVal = compoundPalettePlayerVal();
                disabledShape = ps.tryPlayLastUsedShapeByColor[playerVal] ?? -1;
            } else if (!ps.replayMode && ps.liveReplayBoards.length > 0) {
                const total = Math.max(0, ps.liveReplayBoards.length - 1);
                if (ps.liveViewStep < total && ps.liveReplayLastUsedAtStep && ps.liveReplayLastUsedAtStep[ps.liveViewStep]) {
                    const nextP = ps.liveViewStep === 0 ? 1 : (3 - ps.liveReplayStepPlayers[ps.liveViewStep]);
                    disabledShape = ps.liveReplayLastUsedAtStep[ps.liveViewStep][nextP] ?? -1;
                } else {
                    disabledShape = ps.lastUsedShapeByColor[ps.currentPlayer] ?? -1;
                }
            } else {
                const playerVal = compoundPalettePlayerVal();
                disabledShape = ps.lastUsedShapeByColor[playerVal] ?? -1;
            }
            buttons.forEach((btn, idx) => {
                if (disabledShape === idx) btn.classList.add('disabled');
                else btn.classList.remove('disabled');
            });
        }

        function applyShapeIndexToButtons() {
            document.querySelectorAll('.piece-btn').forEach((b, i) => {
                b.classList.toggle('active', i === ps.currentShapeIndex);
            });
        }

        function createShapeButtons(setLiveViewStepFn) {
            const container = document.getElementById('shapeSelector');
            container.innerHTML = '';
            SHAPE_LIST.forEach((_, idx) => {
                const btn = document.createElement('div');
                btn.className = 'piece-btn' + (idx === 0 ? ' active' : '');
                btn.dataset.shapeIndex = idx;
                const grid = document.createElement('div');
                grid.className = 'shape-grid';
                for (let r = -1; r <= 1; r++) {
                    for (let c = -1; c <= 1; c++) {
                        const cell = document.createElement('div');
                        cell.style.width = '32px';
                        cell.style.height = '32px';
                        cell.style.display = 'flex';
                        cell.style.alignItems = 'center';
                        cell.style.justifyContent = 'center';
                        if (SHAPE_LIST[idx].some(([rr, cc]) => rr === r && cc === c)) {
                            const stone = document.createElement('div');
                            stone.className = 'stone';
                            cell.appendChild(stone);
                        }
                        grid.appendChild(cell);
                    }
                }
                btn.appendChild(grid);
                container.appendChild(btn);
                btn.addEventListener('click', () => {
                    if (btn.classList.contains('disabled')) return;
                    if (!ps.replayMode && setLiveViewStepFn && ps.liveReplayBoards.length > 0) {
                        const total = Math.max(0, ps.liveReplayBoards.length - 1);
                        if (ps.liveViewStep < total) {
                            setLiveViewStepFn(total);
                            const tot = Math.max(0, ps.liveReplayBoards.length - 1);
                            if (tot === 0) ps.currentPlayer = 1;
                            else ps.currentPlayer = 3 - ps.liveReplayStepPlayers[tot];
                            const lastMover = 3 - ps.currentPlayer;
                            const lastShape = ps.lastUsedShapeByColor[lastMover] ?? -1;
                            ps.currentShapeIndex = lastShape >= 0 ? (lastShape + 1) % SHAPE_LIST.length : 0;
                            applyShapeIndexToButtons();
                            updateShapeAvailability();
                            updateShapeColors();
                            refreshPreview();
                            drawCompoundBoard();
                            return;
                        }
                    }
                    document.querySelectorAll('.piece-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    ps.currentShapeIndex = idx;
                    refreshPreview();
                    drawCompoundBoard();
                });
            });
            updateShapeColors();
        }

        function refreshPreview() {
            if (ps.hasPreview) drawCompoundBoard();
        }

        function setBottomPaletteObserverMode(on) {
            if (on) bottomPalette.classList.add('observer-mode');
            else bottomPalette.classList.remove('observer-mode');
        }

        document.getElementById('rotateBtn').onclick = () => {
            ps.rotation = (ps.rotation + 1) % 4;
            refreshPreview();
            drawCompoundBoard();
        };
        document.getElementById('flipBtn').onclick = () => {
            ps.flipped = !ps.flipped;
            refreshPreview();
            drawCompoundBoard();
        };

        let _page = null;

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            drawBoard: drawCompoundBoard,
            removeDeadAndDying: (src) => R().removeDeadAndDying(src, ps.BOARD_SIZE, deepCopyBoard, 2),
            assignTerritoryWithRange: (lb) => R().assignTerritoryWithRange(lb, ps.BOARD_SIZE),
            rebuildLiveReplayFromMoveCoords: rebuildCompoundLive,
            enterReplayMode(data) {
                const built = buildCompoundReplayFromData(data);
                ps.replayBoards = built.replayBoards;
                ps.replayMarkers = built.replayMarkers;
                ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps;
                ps.replayLastUsedAtStep = built.replayLastUsedAtStep || [];
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                _page.setReplayStep(ps.replayTotalSteps);
                _page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                if (!isPlacementValid(row, col)) return false;
                ps.hasPreview = false;
                ps.pendingPreviewRow = -1;
                ps.pendingPreviewCol = -1;
                const playerVal = ps.tryPlayCurrentPlayer;
                const usedIdx = ps.currentShapeIndex;
                const nBefore = ps.tryPlayStep;
                const luBefore = computeTryPlayLastUsedAfterNTrialMoves(nBefore);
                if (luBefore[playerVal] === usedIdx) {
                    qiAlert('不能连续两次使用相同的形状');
                    return false;
                }
                const newBoard = tryPlaceShape(ps.board, usedIdx, ps.rotation, ps.flipped, row, col, playerVal);
                if (!newBoard) return false;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                    ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                    ps.tryPlayShapeByStep.length = ps.tryPlayStep + 1;
                }
                const coords = generatePlacementCoords(usedIdx, ps.rotation, ps.flipped, row, col);
                const markers = coords.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                ps.tryPlayBoards.push(deepCopyBoard(newBoard));
                ps.tryPlayMarkers.push(markers);
                ps.tryPlayShapeByStep.push(usedIdx);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = deepCopyBoard(newBoard);
                ps.lastMoveMarkers = markers;
                ps.currentShapeIndex = (usedIdx + 1) % SHAPE_LIST.length;
                applyShapeIndexToButtons();
                refreshTryPlayLastUsedShapeByColor();
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                _page.updateTryPlayDisplay();
                if (ps.showEstimateActive) _page.showEstimate();
                else drawCompoundBoard();
                return true;
            },
            enterTryPlay() {
                _page.clearMobileMovePreview();
                ps.tryPlayMode = true;
                ps.tryPlayBaseStep = ps.replayStep;
                ps.tryPlayBoards = [deepCopyBoard(ps.board)];
                ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];
                ps.tryPlayShapeByStep = [-1];
                ps.replayLastUsedSnapshot = (ps.replayLastUsedAtStep && ps.replayLastUsedAtStep[ps.replayStep])
                    ? { ...ps.replayLastUsedAtStep[ps.replayStep] }
                    : { 1: ps.lastUsedShapeByColor[1] ?? -1, 2: ps.lastUsedShapeByColor[2] ?? -1 };
                refreshTryPlayLastUsedShapeByColor();
                const _fromLive = !ps.replayMode;
                const _RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
                ps.tryPlayCurrentPlayer = _RT && _RT.resolveTryPlaySideToMove
                    ? _RT.resolveTryPlaySideToMove({
                        fromLive: _fromLive,
                        replayStep: ps.replayStep,
                        replayStepPlayers: ps.replayStepPlayers,
                        liveViewStep: ps.liveViewStep,
                        liveReplayStepPlayers: ps.liveReplayStepPlayers,
                        liveReplayBoardsLength: (ps.liveReplayBoards && ps.liveReplayBoards.length) || 0,
                        currentPlayer: ps.currentPlayer
                    })
                    : (ps.replayStep > 0 ? (3 - ps.replayStepPlayers[ps.replayStep]) : ((ps.currentPlayer === 1 || ps.currentPlayer === 2) ? ps.currentPlayer : 1));
                ps.tryPlayBasePlayer = ps.tryPlayCurrentPlayer;
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
                setBottomPaletteObserverMode(false);
                updateShapeColors();
                _page.updateTryPlayDisplay();
                _page.updateReplayUI();
            },
            exitTryPlay() {
                _page.clearMobileMovePreview();
                ps.tryPlayMode = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayShapeByStep = [-1];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = ps.replayTotalSteps;
                _page.setReplayStep(ps.tryPlayBaseStep);
                updateShapeAvailability();
                updateShapeColors();
                _page.updateReplayUI();
            },
            updateTryPlayDisplay() {
                const stepDisplay = document.getElementById('replayStepDisplay');
                if (ps.tryPlayMode) {
                    stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                    const emoji = ps.tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                    domPage.turnDisplay.innerText = `${emoji} 试下`;
                    updateShapeColors();
                    updateShapeAvailability();
                }
            },
            setTryPlayStep(step) {
                _page.clearMobileMovePreview();
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                ps.board = deepCopyBoard(ps.tryPlayBoards[step]);
                ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));
                const basePlayer = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                ? ps.tryPlayBasePlayer
                : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
                ps.tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);
                document.getElementById('replaySlider').value = step;
                refreshTryPlayLastUsedShapeByColor();
                _page.updateTryPlayDisplay();
                if (ps.showEstimateActive) _page.showEstimate();
                else drawCompoundBoard();
            },
            syncState(state) {
                const pv = ps.mySlot === 'black' ? 1 : (ps.mySlot === 'white' ? 2 : null);
                let oldLuMy = -1;
                if (pv !== null && ps.lastUsedShapeByColor) oldLuMy = ps.lastUsedShapeByColor[pv] ?? -1;
                const incomingMoveLen = (state.moveCoords && state.moveCoords.length) || 0;
                const prevSyncedLen = ps._syncMoveCoordsLen;
                const incomingNH = state.numberOfHands || 1;
                const incomingGO = state.gameOver || false;
                const sizeWillChange = !!(state.boardSize && state.boardSize !== ps.BOARD_SIZE);
                const handsChanged = incomingNH !== ps.numberOfHands;
                const gameOverChanged = incomingGO !== ps.gameOver;
                const playerChanged = state.currentPlayer !== undefined && state.currentPlayer !== ps.currentPlayer;
                const moveListChanged = incomingMoveLen !== (prevSyncedLen !== undefined ? prevSyncedLen : -1);
                if (sizeWillChange || handsChanged || gameOverChanged || playerChanged || moveListChanged)
                    _page.clearMobileMovePreview();
                if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = state.boardSize;
                    if (state.komi != null) ps.KOMI = state.komi;
                    ps.board = C().initBoardArray(ps.BOARD_SIZE);
                    _page.updateBoardGeometry();
                    const sizeSelect = document.getElementById('boardSizeSelect');
                    if (sizeSelect) sizeSelect.value = ps.BOARD_SIZE;
                }
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer;
                ps.gameOver = state.gameOver || false;
                ps.winner = state.winner || null;
                ps.normalGoPhase = !!state.normalGoPhase;
                ps.lastUsedShapeByColor = state.lastUsedShapeByColor || { 1: -1, 2: -1 };
                let newLuMy = -1;
                if (pv !== null) newLuMy = ps.lastUsedShapeByColor[pv] ?? -1;
                if (pv !== null && oldLuMy !== newLuMy) {
                    if (newLuMy >= 0) ps.currentShapeIndex = (newLuMy + 1) % SHAPE_LIST.length;
                    else if (newLuMy === -1 && oldLuMy !== -1) ps.currentShapeIndex = 0;
                    applyShapeIndexToButtons();
                }
                if (ps._needCompoundShapeHint && pv !== null) {
                    const luHint = ps.lastUsedShapeByColor[pv] ?? -1;
                    if (luHint >= 0) {
                        ps.currentShapeIndex = (luHint + 1) % SHAPE_LIST.length;
                        applyShapeIndexToButtons();
                    }
                    updateShapeAvailability();
                    ps._needCompoundShapeHint = false;
                }
                if (state.moveCoords) {
                    ps.moveLog = state.moveCoords.map(m => {
                        if (m.type === 'move' && m.stones)
                            return { type: 'move', stones: m.stones.map(([r, c]) => [r, c]) };
                        return null;
                    });
                }
                if (state.slots) ps.slots = state.slots;
                if (Object.prototype.hasOwnProperty.call(state, 'computerSlot'))
                    ps.computerSlot = state.computerSlot;
                if (state.matchTime !== undefined)
                    ps.matchTime = state.matchTime;
                if (state.matchStarted !== undefined)
                    ps.matchStarted = !!state.matchStarted;
                if (ps.matchStarted) ps.matchStartedOnce = true;
                if (
                    ps.numberOfHands <= 1
                    && !ps.gameOver
                    && !(ps.slots && ps.slots.black && ps.slots.white)
                    && !(ps.matchTime && ps.matchTime.settings)
                ) {
                    ps.matchStartedOnce = false;
                }

                if (!ps.replayMode) {
                    const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                    rebuildCompoundLive(
                        state.moveCoords || [],
                        (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.pickRichestBoard)
                            ? QiWeiqiSquarePageRuntime.pickRichestBoard(ps.liveOpeningBoard, state.initialBoard, state.board)
                            : (ps.liveOpeningBoard || state.initialBoard || state.board)
                    );
                    const newTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    if (newTotal === 0) {
                        ps.liveViewStep = 0;
                        ps.liveFollowLatest = true;
                    } else if (wasAtEnd) {
                        ps.liveViewStep = newTotal;
                        ps.liveFollowLatest = true;
                    } else {
                        ps.liveViewStep = Math.min(ps.liveViewStep, newTotal);
                        if (ps.liveViewStep === newTotal) ps.liveFollowLatest = true;
                    }
                    _page.applyLiveViewBoard();
                    _page.updateLiveReplayPanelUI();
                } else if (!ps.tryPlayMode) {
                ps.board = state.board;
                    ps.lastMoveMarkers = state.lastMoveMarkers || [];
                }

                const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
                const hasPlayer = ps.slots.black || ps.slots.white;
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (!hasAnyStone && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                    sizeSelect.style.display = 'inline-block';
                else
                    sizeSelect.style.display = 'none';

                if (ps.showEstimateActive) {
                    ps.cachedLiveBoard = _page.removeDeadAndDying(ps.board);
                    ps.cachedTerritory = _page.assignTerritoryWithRange(ps.cachedLiveBoard);
                    _page.showEstimate();
                } else {
                    _page.updateTurn();
                }
                _page.updateReplayUI();
                ps._syncMoveCoordsLen = incomingMoveLen;
                updateShapeAvailability();
                updateShapeColors();
                if (bottomPalette) bottomPalette.classList.toggle('normal-go-locked', !!ps.normalGoPhase);
                setBottomPaletteObserverMode(!(ps.mySlot && !ps.gameOver && !ps.replayMode));
                updateVsComputerBtn();
                maybeRunFrontendComputerMove();
            }
        });
        _page = page;

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
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            setLiveViewStep: baseSetLiveViewStep
        } = page;

        function setLiveViewStep(step) {
            baseSetLiveViewStep(step);
            updateShapeAvailability();
            updateShapeColors();
        }

        createShapeButtons(setLiveViewStep);

        function commitCompoundMove(row, col) {
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return false;
            const playerVal = ps.mySlot === 'black' ? 1 : 2;
            if (inNormalGoLivePlay()) {
                if (!singleStoneCellFree(row, col)) return false;
                ps.hasPreview = false;
                ps.pendingPreviewRow = -1;
                ps.pendingPreviewCol = -1;
                if (ps.computerSlot) {
                    const newBoard = tryPlaceStonesAt(ps.board, [[row, col]], playerVal);
                    if (!newBoard) return false;
                    const koKey = boardStringForKo(newBoard);
                    const hist = buildKoHistorySetFromLiveReplay();
                    if (hist.has(koKey)) {
                        qiAlert('禁全同。');
                        return false;
                    }
                    ps.board = newBoard;
                    ps.lastMoveMarkers = [{ row, col, color: playerVal }];
                    ps.currentPlayer = 3 - ps.currentPlayer;
                    ps.numberOfHands = (ps.numberOfHands || 1) + 1;
                    if (ps.showEstimateActive) {
                        ps.cachedLiveBoard = _page.removeDeadAndDying(ps.board);
                        ps.cachedTerritory = _page.assignTerritoryWithRange(ps.cachedLiveBoard);
                        _page.showEstimate();
                    } else {
                        _page.updateTurn();
                    }
                    drawCompoundBoard();
                }
                ps.ws.send(JSON.stringify({ type: 'move', singleStone: true, row, col }));
                return true;
            }
            if (ps.lastUsedShapeByColor[playerVal] === ps.currentShapeIndex) {
                qiAlert('不能连续两次使用相同的形状');
                return false;
            }
            if (!isPlacementValid(row, col)) return false;
            ps.hasPreview = false;
            ps.pendingPreviewRow = -1;
            ps.pendingPreviewCol = -1;
            const usedIdx = ps.currentShapeIndex;

            if (ps.computerSlot) {
                const newBoard = tryPlaceShape(ps.board, usedIdx, ps.rotation, ps.flipped, row, col, playerVal);
                if (!newBoard) return false;
                const koKey = boardStringForKo(newBoard);
                const hist = buildKoHistorySetFromLiveReplay();
                if (hist.has(koKey)) {
                    qiAlert('禁全同。');
                    return false;
                }
                const coords = generatePlacementCoords(usedIdx, ps.rotation, ps.flipped, row, col);
                ps.board = newBoard;
                ps.lastMoveMarkers = coords.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                ps.lastUsedShapeByColor[playerVal] = usedIdx;
                ps.currentPlayer = 3 - ps.currentPlayer;
                ps.numberOfHands = (ps.numberOfHands || 1) + 1;
                ps.currentShapeIndex = (usedIdx + 1) % SHAPE_LIST.length;
                applyShapeIndexToButtons();
                updateShapeAvailability();
                if (ps.showEstimateActive) {
                    ps.cachedLiveBoard = _page.removeDeadAndDying(ps.board);
                    ps.cachedTerritory = _page.assignTerritoryWithRange(ps.cachedLiveBoard);
                    _page.showEstimate();
                } else {
                    _page.updateTurn();
                }
                drawCompoundBoard();
            }

            ps.ws.send(JSON.stringify({
                type: 'move',
                shapeIndex: usedIdx,
                rotation: ps.rotation,
                flipped: ps.flipped,
                row,
                col
            }));

            if (!ps.computerSlot) {
                ps.currentShapeIndex = (usedIdx + 1) % SHAPE_LIST.length;
                applyShapeIndexToButtons();
                updateShapeAvailability();
            }
            return true;
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
            setLiveViewStep: baseSetLiveViewStep,
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
            setMySlot: (s) => {
                const was = ps.mySlot;
                ps.mySlot = s;
                if (was == null && (s === 'black' || s === 'white')) ps._needCompoundShapeHint = true;
            },
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
            onNewGameStarted() {
                if (typeof page !== "undefined" && page.clearEditModeUi) page.clearEditModeUi();
                else if (ps.clearEditModeUi) ps.clearEditModeUi();
                ps._needCompoundShapeHint = false;
                ps._computerMoveSchedKey = null;
                ps.rotation = 0;
                ps.flipped = false;
                ps.currentShapeIndex = 0;
                ps.hasPreview = false;
                ps.pendingPreviewRow = -1;
                ps.pendingPreviewCol = -1;
                document.querySelectorAll('.piece-btn').forEach((b, i) => {
                    b.classList.toggle('active', i === 0);
                });
            },
            onRoomReset() {
                ps._needCompoundShapeHint = false;
                ps._computerMoveSchedKey = null;
                ps.rotation = 0;
                ps.flipped = false;
                ps.currentShapeIndex = 0;
                ps.hasPreview = false;
                document.querySelectorAll('.piece-btn').forEach((b, i) => {
                    b.classList.toggle('active', i === 0);
                });
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });
        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const _origUpdateRadioStyles = _weiqiBindings.updateRadioStyles;
        _weiqiBindings.updateRadioStyles = function () {
            _origUpdateRadioStyles();
            updateVsComputerBtn();
        };
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        if (vsComputerBtn) {
            vsComputerBtn.onclick = () => {
                if (!ps.ws || ps.ws.readyState !== WebSocket.OPEN) return;
                ps.ws.send(JSON.stringify({ type: 'requestComputerOpponent' }));
            };
        }

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!e.ctrlKey && !e.metaKey) return;
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

        function canvasClickHandler(e) {
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
                    drawCompoundBoard();
                    return;
                }
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = hoverPlacementFree(row, col);
                        drawCompoundBoard();
                    }
                    return;
                }
                if (isPlacementValid(row, col)) {
                    tryPlayMove(row, col);
                } else if (isPreviewGeometryValid(row, col)) {
                    setPreviewTouch(row, col);
                }
                return;
            }
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (ps.waitingScoreConfirm) return;

            if (row < 0 || col < 0) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawCompoundBoard();
                return;
            }

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitCompoundMove(row, col);
                    drawCompoundBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = hoverPlacementFree(row, col);
                    drawCompoundBoard();
                }
                return;
            }
            if (!isPlacementValid(row, col)) return;
            commitCompoundMove(row, col);
        }

        if (isMouseDevice) {
            canvas.addEventListener('click', canvasClickHandler);
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawCompoundBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = row >= 0 && col >= 0 && hoverPlacementFree(row, col);
                drawCompoundBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    drawCompoundBoard();
                }
            });

            let pressTimer = null;
            let isLongPress = false;
            canvas.addEventListener('mousedown', (e) => {
                if (e.button !== 2) return;
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) return;
                if (!ps.isMyTurn) return;
                isLongPress = false;
                pressTimer = setTimeout(() => {
                    ps.flipped = !ps.flipped;
                    isLongPress = true;
                    refreshPreview();
                    drawCompoundBoard();
                    pressTimer = null;
                }, 500);
            });
            canvas.addEventListener('mouseup', (e) => {
                if (e.button !== 2) return;
                e.preventDefault();
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                    if (!isLongPress && ps.isMyTurn) {
                        ps.rotation = (ps.rotation + 1) % 4;
                        refreshPreview();
                        drawCompoundBoard();
                    }
                }
                isLongPress = false;
            });

            canvas.addEventListener('wheel', (e) => {
                if (!ps.isMyTurn) return;
                e.preventDefault();
                const delta = e.deltaY > 0 ? 1 : -1;
                const buttons = document.querySelectorAll('.piece-btn');
                let nextIdx = ps.currentShapeIndex;
                do {
                    nextIdx = (nextIdx + delta + buttons.length) % buttons.length;
                } while (nextIdx !== ps.currentShapeIndex && buttons[nextIdx].classList.contains('disabled'));
                if (nextIdx !== ps.currentShapeIndex) {
                    buttons.forEach(b => b.classList.remove('active'));
                    buttons[nextIdx].classList.add('active');
                    ps.currentShapeIndex = nextIdx;
                    refreshPreview();
                    drawCompoundBoard();
                }
            }, { passive: false });
        } else {
            canvas.addEventListener('click', (e) => {
                if (suppressCanvasClickAfterLongMark) return;
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                if (ps.tryPlayMode && ps.replayMode) {
                    if (row < 0 || col < 0) {
                        if (mobileTwoStepPlacing()) clearMobileMovePreview();
                        drawCompoundBoard();
                        return;
                    }
                    if (mobileTwoStepPlacing()) {
                        if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                            clearMobileMovePreview();
                            tryPlayMove(row, col);
                        } else {
                            ps.hoverRow = row;
                            ps.hoverCol = col;
                            ps.isHoverValid = hoverPlacementFree(row, col);
                            drawCompoundBoard();
                        }
                        return;
                    }
                    if (isPlacementValid(row, col)) {
                        tryPlayMove(row, col);
                    } else if (isPreviewGeometryValid(row, col)) {
                        setPreviewTouch(row, col);
                    }
                    return;
                }
                if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
                if (row < 0 || col < 0) { clearPreviewTouch(); return; }
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        commitCompoundMove(row, col);
                        drawCompoundBoard();
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = hoverPlacementFree(row, col);
                        drawCompoundBoard();
                    }
                    return;
                }
                if (ps.hasPreview && ps.pendingPreviewRow === row && ps.pendingPreviewCol === col)
                    commitCompoundMove(row, col);
                else
                    setPreviewTouch(row, col);
            });
        }

        function setPreviewTouch(row, col) {
            const ok = ps.tryPlayMode && ps.replayMode ? !ps.waitingScoreConfirm : (ps.isMyTurn && !ps.gameOver && !ps.waitingScoreConfirm);
            if (!ok) { clearPreviewTouch(); return; }
            if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) { clearPreviewTouch(); return; }
            ps.pendingPreviewRow = row;
            ps.pendingPreviewCol = col;
            ps.hasPreview = true;
            drawCompoundBoard();
        }

        function clearPreviewTouch() {
            ps.hasPreview = false;
            ps.pendingPreviewRow = -1;
            ps.pendingPreviewCol = -1;
            drawCompoundBoard();
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
        connectWebSocket((msg) => {
            if (msg.type === 'error' && ps.computerSlot) ps._computerMoveSchedKey = null;
            handleMessage(msg);
        });
        })();
    }
};
