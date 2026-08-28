window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['magnetism-weiqi'] = {
    shell: {
        "title": "磁性围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />棋子具有磁性。落子时棋子会受到磁力影响移动。<br /><br /><strong>弱磁性</strong>：上下左右四个方向上最近的棋子尝试移动一格，己方棋子远离落子点、对方棋子靠近落子点。<br /><br /><strong>中磁性</strong>：落子后沿上下左右四个方向扫描射线，己方棋子从最远端先滑动一格、对方棋子从最近端先滑动一格，每方向只进行一轮移动。<br /><br /><strong>强磁性</strong>：落子时上下左右四个方向上的所有棋子都会受到磁力影响而移动，己方棋子远离落子点、对方棋子靠近落子点，直至遇到阻碍；先移动己方棋子（同一方向上由远到近），再移动对方棋子（由近到远），同一方向可重复多轮，直到一整轮内没有任何棋子能移动为止。<br /><br />",
        "defaultKomiText": "黑贴白2.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "磁性围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "磁性围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        // 子棋类：weak 弱磁性 / medium 中磁性 / strong 强磁性
        let MAGNETISM = 'weak';
        function magnetismKomiForSize(boardSize) {
            switch (boardSize) {
                case 3: return 1.5;
                case 4: return 3.5;
                case 5: return 4.5;
                case 6: return 2.0;
                case 7: return 3.5;
                case 8: return 2.0;
                case 9: return 3.5;
                case 10: return 2.25;
                case 11: return 2.75;
                case 12: return 2.25;
                default:
                    if (boardSize % 2 === 0) return 1.75;
                    return 2.25;
            }
        }
        /** 客户端显示贴目（沿用各子棋类原口径）：弱磁性按尺寸查表；中/强磁性固定 3.25 */
        function komiForMagnetism(magnetism, boardSize) {
            if (magnetism === 'weak') return magnetismKomiForSize(boardSize);
            return 3.25;
        }

        const ps = {
            BOARD_SIZE: 9,
            KOMI: komiForMagnetism('weak', 9),
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

        function magneticApplyOneRoundClient(board, row, col, playerVal, boardSize) {
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            const ownList = [];
            const oppList = [];
            for (let dirIdx = 0; dirIdx < dirs.length; dirIdx++) {
                const [dr, dc] = dirs[dirIdx];
                for (let step = 1; ; step++) {
                    const nr = row + dr * step;
                    const nc = col + dc * step;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) break;
                    if (board[nr][nc] === 0) continue;
                    const color = board[nr][nc];
                    const entry = { r: nr, c: nc, step, dirIdx, dr, dc, color };
                    if (color === playerVal) ownList.push(entry);
                    else oppList.push(entry);
                }
            }
            ownList.sort((a, b) => b.step - a.step || a.dirIdx - b.dirIdx);
            oppList.sort((a, b) => a.step - b.step || a.dirIdx - b.dirIdx);
            const tryShift = (r, c, dr, dc, color) => {
                const moveDr = (color === playerVal) ? dr : -dr;
                const moveDc = (color === playerVal) ? dc : -dc;
                const newR = r + moveDr;
                const newC = c + moveDc;
                if (newR >= 0 && newR < boardSize && newC >= 0 && newC < boardSize && board[newR][newC] === 0) {
                    board[newR][newC] = color;
                    board[r][c] = 0;
                }
            };
            for (const item of ownList) {
                const { r, c, dr, dc } = item;
                if (board[r][c] === 0) continue;
                const color = board[r][c];
                if (color !== playerVal) continue;
                tryShift(r, c, dr, dc, color);
            }
            for (const item of oppList) {
                const { r, c, dr, dc } = item;
                if (board[r][c] === 0) continue;
                const color = board[r][c];
                if (color === playerVal) continue;
                tryShift(r, c, dr, dc, color);
            }
            return board;
        }

        function magneticApplyMoveClient(board, row, col, playerVal, boardSize) {
            if (MAGNETISM === 'weak') return magneticApplyMoveWeakClient(board, row, col, playerVal, boardSize);
            if (MAGNETISM === 'strong') {
                let guard = 0;
                const maxRounds = boardSize * boardSize * boardSize * 8 + 1000;
                while (magneticApplyOneRoundClient(board, row, col, playerVal, boardSize)) {
                    if (++guard > maxRounds) break;
                }
                return board;
            }
            magneticApplyOneRoundClient(board, row, col, playerVal, boardSize);
            return board;
        }

        function magneticTryPlaceStone(boardBefore, row, col, playerVal) {
            const boardSize = ps.BOARD_SIZE;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            newBoard[row][col] = playerVal;
            magneticApplyMoveClient(newBoard, row, col, playerVal, boardSize);
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

        function magneticApplyOneRoundClientWithNum(board, numGrid, row, col, playerVal, boardSize) {
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            const ownList = [];
            const oppList = [];
            for (let dirIdx = 0; dirIdx < dirs.length; dirIdx++) {
                const [dr, dc] = dirs[dirIdx];
                for (let step = 1; ; step++) {
                    const nr = row + dr * step;
                    const nc = col + dc * step;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) break;
                    if (board[nr][nc] === 0) continue;
                    const color = board[nr][nc];
                    const entry = { r: nr, c: nc, step, dirIdx, dr, dc, color };
                    if (color === playerVal) ownList.push(entry);
                    else oppList.push(entry);
                }
            }
            ownList.sort((a, b) => b.step - a.step || a.dirIdx - b.dirIdx);
            oppList.sort((a, b) => a.step - b.step || a.dirIdx - b.dirIdx);
            const tryShift = (r, c, dr, dc, color) => {
                const moveDr = (color === playerVal) ? dr : -dr;
                const moveDc = (color === playerVal) ? dc : -dc;
                const newR = r + moveDr;
                const newC = c + moveDc;
                if (newR >= 0 && newR < boardSize && newC >= 0 && newC < boardSize && board[newR][newC] === 0) {
                    board[newR][newC] = color;
                    board[r][c] = 0;
                    const t = numGrid[r][c];
                    numGrid[r][c] = numGrid[newR][newC];
                    numGrid[newR][newC] = t;
                }
            };
            for (const item of ownList) {
                const { r, c, dr, dc } = item;
                if (board[r][c] === 0) continue;
                const color = board[r][c];
                if (color !== playerVal) continue;
                tryShift(r, c, dr, dc, color);
            }
            for (const item of oppList) {
                const { r, c, dr, dc } = item;
                if (board[r][c] === 0) continue;
                const color = board[r][c];
                if (color === playerVal) continue;
                tryShift(r, c, dr, dc, color);
            }
            return board;
        }

        function magneticApplyMoveClientWithNum(board, numGrid, row, col, playerVal, boardSize) {
            if (MAGNETISM === 'weak') return magneticApplyMoveWeakClientWithNum(board, numGrid, row, col, playerVal, boardSize);
            if (MAGNETISM === 'strong') {
                let guard = 0;
                const maxRounds = boardSize * boardSize * boardSize * 8 + 1000;
                while (magneticApplyOneRoundClientWithNum(board, numGrid, row, col, playerVal, boardSize)) {
                    if (++guard > maxRounds) break;
                }
                return board;
            }
            magneticApplyOneRoundClientWithNum(board, numGrid, row, col, playerVal, boardSize);
            return board;
        }

        function magneticTryPlaceStoneWithNum(boardBefore, numGridBefore, row, col, playerVal, moveNum) {
            const boardSize = ps.BOARD_SIZE;
            if (boardBefore[row][col] !== 0) return null;
            const newBoard = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            const newNum = numGridBefore.map(r => r.slice());
            newBoard[row][col] = playerVal;
            newNum[row][col] = moveNum;
            magneticApplyMoveClientWithNum(newBoard, newNum, row, col, playerVal, boardSize);
            magneticRemoveDeadGroupsClientWithNum(newBoard, newNum, boardSize);
            return { board: newBoard, numGrid: newNum };
        }

        function emptyNumGrid(n) {
            return Array(n).fill().map(() => Array(n).fill(0));
        }

        function computeMagneticStoneNumbers() {
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
                    const r = magneticTryPlaceStoneWithNum(board, numGrid, mv.row, mv.col, pv, mi);
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
                        const r = magneticTryPlaceStoneWithNum(board, numGrid, m.row, m.col, m.color, i);
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
        function magneticDrawBoard() {
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
                const nums = computeMagneticStoneNumbers();
                d.moveNumbersOnStones(dom.ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(dom.ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
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
            tryPlaceStone: magneticTryPlaceStone,
            drawBoard: magneticDrawBoard,
            enterReplayMode(data) {
                ps.replayMovesFull = data.moves || [];
                const built = QiWeiqiSquarePageRuntime.buildReplayFromImportData(
                    data,
                    magneticTryPlaceStone,
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
            if (state.magnetism && state.magnetism !== MAGNETISM) {
                MAGNETISM = state.magnetism;
                const sel = document.getElementById('subGameSelect');
                if (sel) sel.value = MAGNETISM;
                refreshKomiInfo();
            }
            // 棋盘尺寸变化由 syncStateBase 统一处理（内部重建棋盘并更新几何/贴目显示），
            // 切勿在此先改 ps.BOARD_SIZE——会跳过 syncStateBase 的几何更新导致换路数后棋格不变化
            syncStateBase(state);
            // 子棋类选择器显示时机与路数选择器一致（开局前可改）
            updateSubGameSelectVisibility();
        }

        function updateSubGameSelectVisibility() {
            const sel = document.getElementById('subGameSelect');
            if (!sel) return;
            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            // 有子棋类：始终显示；开局（有子/有人入座/对局结束）后锁定不可改，新局时恢复可用
            sel.style.display = 'inline-block';
            sel.disabled = hasAnyStone || hasPlayer || ps.gameOver;
        }

        function refreshKomiInfo() {
            ps.KOMI = komiForMagnetism(MAGNETISM, ps.BOARD_SIZE);
            const el = document.getElementById('komiInfo');
            if (el) el.textContent = `黑贴白${ps.KOMI}点`;
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
        const _baseHandleMessage = _weiqiBindings.handleMessage;
        const updateVsComputerBtn = _weiqiBindings.updateVsComputerBtn;
        const handleMessage = (msg) => {
            if (msg && msg.type === 'magnetismChanged') {
                // 子棋类变更广播（带完整 state）：全量同步
                syncState(msg);
                // 切换弱/中/强磁性后「与电脑对弈」可用性立即更新（服务端已按新子棋类重查引擎）
                if (Object.prototype.hasOwnProperty.call(msg, 'katagoAvailable'))
                    ps.katagoAvailable = !!msg.katagoAvailable;
                if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                    ps.computerSlot = msg.computerSlot || null;
                if (typeof updateVsComputerBtn === 'function') updateVsComputerBtn();
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
        // 子棋类选择器：弱磁性/中磁性/强磁性（开局前与路数选择器同显）
        const subGameSelect = document.getElementById('subGameSelect');
        if (subGameSelect) {
            subGameSelect.innerHTML = '';
            const opts = [
                { value: 'weak', label: '弱磁性' },
                { value: 'medium', label: '中磁性' },
                { value: 'strong', label: '强磁性' }
            ];
            for (const o of opts) {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                if (o.value === MAGNETISM) opt.selected = true;
                subGameSelect.appendChild(opt);
            }
            subGameSelect.addEventListener('change', () => {
                const v = subGameSelect.value;
                if (!v || v === MAGNETISM) return;
                // 本地立即切换（乐观更新）；服务器广播 magnetismChanged 回来时已相同
                MAGNETISM = v;
                refreshKomiInfo();
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'setMagnetism', magnetism: v }));
                }
                drawBoard();
            });
        }

        connectWebSocket(handleMessage);
        })();
    }
};
