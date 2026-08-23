window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["translocation-weiqi"] = {
    shell: {
        "title": "易位围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每手棋可以选择「落子」或「易位」。<br /><strong>易位</strong>：将一枚己方棋子和一枚与之相邻的对方棋子交换位置。<br /><br />仅前n手可以易位，从第n+1手开始恢复为标准围棋，不可以再易位。其中n为棋盘总点数的80%向上取偶。\n棋盘的路数与n的映射关系为：<br /><strong>7 </strong>40<br /><strong>8 </strong>52<br /><strong>9 </strong>66<br /><strong>10 </strong>82<br /><strong>11 </strong>98<br /><strong>12 </strong>116<br /><strong>13 </strong>136<br /><strong>14 </strong>158<br /><strong>15 </strong>182<br /><strong>16 </strong>206<br /><strong>17 </strong>232<br /><strong>18 </strong>260<br /><strong>19 </strong>290<br /><strong>20 </strong>322<br /><strong>21 </strong>354<br /><br /><br />需要易位时，依次点击两枚待易位的棋子。<br />",
        "defaultKomiText": "黑贴白1.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "易位围棋",
        "standardWeiqiMatchTime": true,
        "features": {
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "易位围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const R = () => QiWeiqiSquarePageRuntime;
        const C = () => QiSquareWeiqiCanvas;

function computeMaxTranspositionMoves(size) {
            let limit = Math.ceil(size * size * 0.8);
            if (limit % 2 !== 0) limit++;
            return limit;
        }

        function komiForSize(boardSize) {
            if (boardSize === 7) 
                return 2.5;    
            if (boardSize === 8) 
                return 2.0;
            if (boardSize === 9) 
                return 1.5;
            if (boardSize === 10) 
                return 1.75;
            if (boardSize === 11) 
                return 1.75;
            return 1.25;
        }

        const ps = {
            BOARD_SIZE: 19,
            KOMI: 1.25,
            PADDING: 0,
            CELL_SIZE: 0,
            numberOfHands: 1,
            currentPlayer: 1,
            lastMovePlayerColor: null,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastMoveMarkers: [],
            moveHighlightMarkers: [],
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
            replayHighlights: [],
            replayMovePlayerColors: [],
            replayStepPlayers: [],
            replayStep: 0,
            replayTotalSteps: 0,
            showMoveNumbers: false,
            moveLog: [],
            moveCoords: [],
            tryPlayMode: false,
            tryPlayBaseStep: 0,
            tryPlayBoards: [],
            tryPlayMarkers: [],
            tryPlayHighlights: [],
            tryPlayMovePlayerColors: [],
            tryPlayCurrentPlayer: 1,
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            tryPlayPlyCount: 0,
            tryPlaySelectedPiece: null,
            liveReplayBoards: [],
            liveReplayMarkers: [],
            liveReplayHighlights: [],
            liveReplayMovePlayerColors: [],
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            board: [],
            selectedPiece: null,
            canTransposition: true,
            moveCount: 0,
            maxTranspositionMoves: 290,
            _syncMoveCoordsLen: undefined
        };
        (function initSquareGeometry() {
            const g = C().computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            ps.maxTranspositionMoves = computeMaxTranspositionMoves(ps.BOARD_SIZE);
        })();

        const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        function trySwapPiece(boardBefore, fromRow, fromCol, toRow, toCol, playerVal) {
            const bs = ps.BOARD_SIZE;
            if (fromRow < 0 || fromRow >= bs || fromCol < 0 || fromCol >= bs ||
                toRow < 0 || toRow >= bs || toCol < 0 || toCol >= bs) return null;
            if (boardBefore[fromRow][fromCol] !== playerVal) return null;
            if (boardBefore[toRow][toCol] !== 3 - playerVal) return null;
            if (Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol) !== 1) return null;
            const newBoard = C().deepCopyBoard(boardBefore);
            newBoard[fromRow][fromCol] = 3 - playerVal;
            newBoard[toRow][toCol] = playerVal;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const enemyPositions = new Set();
            enemyPositions.add(`${fromRow},${fromCol}`);
            for (const [dr, dc] of dirs) {
                const nr = toRow + dr, nc = toCol + dc;
                if (nr >= 0 && nr < bs && nc >= 0 && nc < bs && newBoard[nr][nc] === 3 - playerVal)
                    enemyPositions.add(`${nr},${nc}`);
            }
            for (const key of enemyPositions) {
                const [r, c] = key.split(',').map(Number);
                if (newBoard[r][c] === 3 - playerVal && R().countGroupLiberties(newBoard, r, c, bs) === 0)
                    R().removeGroup(newBoard, r, c, 3 - playerVal, bs);
            }
            const friendlyPositions = new Set();
            for (const [dr, dc] of dirs) {
                const nr = fromRow + dr, nc = fromCol + dc;
                if (nr >= 0 && nr < bs && nc >= 0 && nc < bs && newBoard[nr][nc] === playerVal)
                    friendlyPositions.add(`${nr},${nc}`);
            }
            for (const key of friendlyPositions) {
                const [r, c] = key.split(',').map(Number);
                if (newBoard[r][c] === playerVal && R().countGroupLiberties(newBoard, r, c, bs) === 0)
                    R().removeGroup(newBoard, r, c, playerVal, bs);
            }
            return newBoard;
        }

        function stoneColorAt(board, row, col) {
            return board[row] && board[row][col];
        }

        function isAdjacentPos(r1, c1, r2, c2) {
            return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
        }

        function hasAdjacentOppositeStone(board, row, col, boardSize) {
            const color = stoneColorAt(board, row, col);
            if (color !== 1 && color !== 2) return false;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of dirs) {
                const nr = row + dr;
                const nc = col + dc;
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && stoneColorAt(board, nr, nc) === 3 - color)
                    return true;
            }
            return false;
        }

        function canSelectForSwap(board, row, col, boardSize) {
            const color = stoneColorAt(board, row, col);
            if (color !== 1 && color !== 2) return false;
            return hasAdjacentOppositeStone(board, row, col, boardSize);
        }

        function isSwapTargetForSelection(board, sel, row, col) {
            if (!sel) return false;
            const selColor = stoneColorAt(board, sel.row, sel.col);
            if (selColor !== 1 && selColor !== 2) return false;
            const targetColor = stoneColorAt(board, row, col);
            return isAdjacentPos(sel.row, sel.col, row, col) && targetColor === 3 - selColor;
        }

        function normalizeSwapCoords(board, sel, row, col, playerVal) {
            const selColor = stoneColorAt(board, sel.row, sel.col);
            if (selColor === playerVal) {
                return { fromRow: sel.row, fromCol: sel.col, row, col };
            }
            return { fromRow: row, fromCol: col, row: sel.row, col: sel.col };
        }

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
        const komiInfo = document.getElementById('komiInfo');

        C().initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        C().initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        function computeStoneNumbers() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.replayMode) {
                for (let i = 1; i <= ps.replayStep; i++) {
                    const markers = ps.replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) {
                    const markers = ps.liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && m.capture) continue;
                    if (m && m.row != null && m.col != null
                        && m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function isTranspositionHoverPreviewAt(r, c) {
            if (ps.hoverRow !== r || ps.hoverCol !== c || !ps.isHoverValid) return false;
            if (ps.tryPlayMode && ps.replayMode) {
                const tsp = ps.tryPlaySelectedPiece;
                if (tsp) {
                    return isSwapTargetForSelection(ps.board, tsp, r, c);
                }
                return ps.board[r][c] === 0;
            }
            if (ps.gameOver || !ps.isMyTurn) return false;
            if (ps.selectedPiece) {
                return isSwapTargetForSelection(ps.board, ps.selectedPiece, r, c);
            }
            return ps.board[r][c] === 0;
        }

        function isUserBoardMarkVisibleAt(r, c) {
            if (ps.showEstimateActive) return false;
            if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            if (ps.board[r][c] !== 0) return false;
            for (const m of ps.moveHighlightMarkers) {
                if (m.row === r && m.col === c) return false;
            }
            const sel = ps.tryPlayMode ? ps.tryPlaySelectedPiece : ps.selectedPiece;
            if (sel && sel.row === r && sel.col === c) return false;
            if (isTranspositionHoverPreviewAt(r, c)) return false;
            return true;
        }

        function drawBoardImpl() {
            const d = C().draw;
            const cs = C().DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = computeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            // 编辑模式悬停预览走公共逻辑（非编辑模式的落子/易位预览由下方自定义块绘制）
            if (ps.editModeEnabled) {
                d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                    tryPlayMode: ps.tryPlayMode,
                    tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    mySlot: ps.mySlot,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture,
                    pageState: ps,
                    editModeEnabled: true,
                    editTool: ps.editTool,
                    holeDisplayStyle: ps.holeDisplayStyle,
                    boardSize: ps.BOARD_SIZE
                });
            }
            if (ps.lastMovePlayerColor !== null) {
                const strokeColor = ps.lastMovePlayerColor === 1 ? '#ff9900' : '#0099ff';
                for (const { row, col, frameOnly } of ps.moveHighlightMarkers) {
                    const x = ps.PADDING + col * ps.CELL_SIZE;
                    const y = ps.PADDING + row * ps.CELL_SIZE;
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, ps.CELL_SIZE * 0.44, 0, 2 * Math.PI);
                    ctx.stroke();
                    if (!frameOnly) {
                        ctx.globalAlpha = 0.3;
                        const pieceColor = (ps.board[row] && ps.board[row][col]) || (ps.lastMovePlayerColor === 1 ? 1 : 2);
                        ctx.fillStyle = pieceColor === 1 ? '#222' : '#ddd';
                        ctx.fill();
                        ctx.globalAlpha = 1.0;
                    }
                }
            }
            const sel = ps.tryPlayMode ? ps.tryPlaySelectedPiece : ps.selectedPiece;
            const selMyTurn = ps.tryPlayMode ? true : (ps.isMyTurn && ps.canTransposition && !ps.gameOver);
            const selColor = ps.tryPlayMode ? (ps.tryPlayCurrentPlayer === 1 ? '#ff9900' : '#0099ff') : (ps.mySlot === 'black' ? '#ff9900' : '#0099ff');
            if (sel && selMyTurn) {
                const { row, col } = sel;
                const x = ps.PADDING + col * cellSize;
                const y = ps.PADDING + row * cellSize;
                ctx.strokeStyle = selColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, cellSize * 0.48, 0, 2 * Math.PI);
                ctx.stroke();
            }
            let showPreview = false;
            let previewColor = '#222';
            if (ps.tryPlayMode && ps.replayMode) {
                const pv = ps.tryPlayCurrentPlayer;
                const tsp = ps.tryPlaySelectedPiece;
                if (ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    if (tsp) {
                        if (isSwapTargetForSelection(ps.board, tsp, ps.hoverRow, ps.hoverCol))
                            showPreview = true;
                    } else if (ps.board[ps.hoverRow][ps.hoverCol] === 0) {
                        showPreview = true;
                    }
                }
                previewColor = pv === 1 ? '#222' : '#ddd';
            } else if (!ps.gameOver && ps.isMyTurn && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                if (ps.selectedPiece) {
                    if (isSwapTargetForSelection(ps.board, ps.selectedPiece, ps.hoverRow, ps.hoverCol))
                        showPreview = true;
                } else {
                    if (ps.board[ps.hoverRow][ps.hoverCol] === 0) showPreview = true;
                }
                previewColor = ps.mySlot === 'black' ? '#222' : '#ddd';
            }
            if (showPreview) {
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(ps.PADDING + ps.hoverCol * cellSize, ps.PADDING + ps.hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                ctx.fillStyle = previewColor;
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        }

        function rebuildLiveReplayCore(coords, openingBoard) {
            const size = ps.BOARD_SIZE;
            ps.liveReplayBoards = [];
            ps.liveReplayMarkers = [];
            ps.liveReplayHighlights = [];
            ps.liveReplayMovePlayerColors = [];
            ps.liveReplayStepPlayers = [0];
            let curBoard = C().initBoardArray(size);
            if (openingBoard && Array.isArray(openingBoard) && Array.isArray(openingBoard[0])
                && openingBoard.length === curBoard.length && openingBoard[0].length === curBoard[0].length)
                curBoard = C().deepCopyBoard(openingBoard);
            ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
            ps.liveReplayMarkers.push([]);
            ps.liveReplayHighlights.push([]);
            ps.liveReplayMovePlayerColors.push(null);
            for (const move of (coords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                ps.liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const nb = page.tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                    ps.liveReplayHighlights.push([]);
                    ps.liveReplayMovePlayerColors.push(playerVal);
                } else if (move.type === 'swap') {
                    const nb = trySwapPiece(curBoard, move.fromRow, move.fromCol, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    let nmm = [];
                    if (curBoard[move.row][move.col] === playerVal)
                        nmm = [{ row: move.row, col: move.col, color: playerVal }];
                    ps.liveReplayMarkers.push(nmm);
                    ps.liveReplayHighlights.push([
                        { row: move.fromRow, col: move.fromCol, frameOnly: curBoard[move.fromRow][move.fromCol] === 0 },
                        { row: move.row, col: move.col, frameOnly: curBoard[move.row][move.col] === 0 }
                    ]);
                    ps.liveReplayMovePlayerColors.push(playerVal);
                } else if (move.type === 'pass') {
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([]);
                    ps.liveReplayHighlights.push([]);
                    ps.liveReplayMovePlayerColors.push(null);
                }
            }
        }

        function applyLiveReplayIncremental(moveCoords) {
            const startLen = ps.liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            let curBoard = C().deepCopyBoard(ps.liveReplayBoards[ps.liveReplayBoards.length - 1]);
            for (let i = startLen; i < mcs.length; i++) {
                const move = mcs[i];
                const playerVal = move.player === 'black' ? 1 : 2;
                ps.liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const nb = page.tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                    ps.liveReplayHighlights.push([]);
                    ps.liveReplayMovePlayerColors.push(playerVal);
                } else if (move.type === 'swap') {
                    const nb = trySwapPiece(curBoard, move.fromRow, move.fromCol, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    let nmm = [];
                    if (curBoard[move.row][move.col] === playerVal)
                        nmm = [{ row: move.row, col: move.col, color: playerVal }];
                    ps.liveReplayMarkers.push(nmm);
                    ps.liveReplayHighlights.push([
                        { row: move.fromRow, col: move.fromCol, frameOnly: curBoard[move.fromRow][move.fromCol] === 0 },
                        { row: move.row, col: move.col, frameOnly: curBoard[move.row][move.col] === 0 }
                    ]);
                    ps.liveReplayMovePlayerColors.push(playerVal);
                } else if (move.type === 'pass') {
                    ps.liveReplayBoards.push(C().deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push([]);
                    ps.liveReplayHighlights.push([]);
                    ps.liveReplayMovePlayerColors.push(null);
                } else { return false; }
            }
            return true;
        }

        function syncLiveReplayFromState(state) {
            const mcs = state.moveCoords || [];
            const syncedLen = ps.liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncremental(mcs)) return;
            }
            const hasMoves = !!(state.moveCoords && state.moveCoords.length);
            rebuildLiveReplayCore(mcs, (ps.liveOpeningBoard != null ? ps.liveOpeningBoard : state.initialBoard));
        }

        function applyLiveViewBoardImpl() {
            if (!ps.liveReplayBoards.length) {
                ps.board = page.initBoardArray(ps.BOARD_SIZE);
                ps.lastMoveMarkers = [];
                ps.moveHighlightMarkers = [];
                ps.lastMovePlayerColor = null;
                ps.selectedPiece = null;
                return;
            }
            if (ps.liveViewStep < 0) ps.liveViewStep = 0;
            if (ps.liveViewStep >= ps.liveReplayBoards.length) ps.liveViewStep = ps.liveReplayBoards.length - 1;
            ps.board = C().deepCopyBoard(ps.liveReplayBoards[ps.liveViewStep]);
            ps.lastMoveMarkers = ps.liveReplayMarkers[ps.liveViewStep].map(m => ({ ...m }));
            ps.moveHighlightMarkers = (ps.liveReplayHighlights[ps.liveViewStep] || []).map(m => ({ ...m }));
            ps.lastMovePlayerColor = ps.liveReplayMovePlayerColors[ps.liveViewStep] != null ? ps.liveReplayMovePlayerColors[ps.liveViewStep] : null;
            ps.selectedPiece = null;
        }

        function syncStateImpl(state) {
            page.clearMobileMovePreview();
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const sizeNum = Number(ps.BOARD_SIZE);
            const needGeometry =
                Number.isFinite(incomingSize) &&
                (incomingSize !== sizeNum ||
                    (state.board && state.board.length !== incomingSize));
            if (needGeometry) {
                ps.BOARD_SIZE = incomingSize;
                if (state.komi != null && Number.isFinite(state.komi)) ps.KOMI = state.komi;
                else ps.KOMI = komiForSize(incomingSize);
                ps.board = page.initBoardArray(ps.BOARD_SIZE);
                ps.maxTranspositionMoves = computeMaxTranspositionMoves(ps.BOARD_SIZE);
                page.updateBoardGeometry();
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (sizeSelect) sizeSelect.value = String(ps.BOARD_SIZE);
            } else if (state.komi != null && Number.isFinite(state.komi) && state.komi !== ps.KOMI) {
                ps.KOMI = state.komi;
                if (komiInfo) page.updateBoardGeometry();
            }
            ps.numberOfHands = state.numberOfHands || 1;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            ps.moveCount = state.moveCount || 0;
            ps.canTransposition = state.canTransposition !== undefined ? state.canTransposition : (ps.moveCount < ps.maxTranspositionMoves);
            if (state.slots) ps.slots = state.slots;
            ps.moveCoords = state.moveCoords ? state.moveCoords.map(m => ({ ...m })) : [];
            ps.moveLog = (state.moveCoords || []).map(m => {
                if (m.type === 'move') return { row: m.row, col: m.col };
                if (m.type === 'swap') return { row: m.row, col: m.col };
                return null;
            });
            if (!ps.replayMode) {
                const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                // 与公共逻辑一致：已有着手时不得把当前盘面当开局重放——
                // 否则被提掉的子所在空位会重新落子，产生"幽灵提子"（被提子仍参与后续提子判断）
                const hasMoves = !!(state.moveCoords && state.moveCoords.length);
                syncLiveReplayFromState(state);;
                const newTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newTotal === 0) {
                    ps.liveViewStep = 0;
                    ps.liveFollowLatest = true;
                } else if (wasAtEnd) {
                    ps.liveViewStep = newTotal;
                    ps.liveFollowLatest = true;
                } else {
                    ps.liveViewStep = Math.min(ps.liveViewStep, newTotal);
                    if (ps.liveViewStep === newTotal)
                        ps.liveFollowLatest = true;
                }
                applyLiveViewBoardImpl();
                page.updateLiveReplayPanelUI();
            } else if (!ps.tryPlayMode) {
                ps.board = state.board;
                ps.lastMovePlayerColor = state.movePlayerColor || null;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
                ps.moveHighlightMarkers = state.moveHighlightMarkers || [];
            }
            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            const boardSizeSelect = document.getElementById('boardSizeSelect');
            if (boardSizeSelect && ps.liveViewStep === 0 && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                boardSizeSelect.style.display = 'inline-block';
            else if (boardSizeSelect)
                boardSizeSelect.style.display = 'none';
            if (ps.showEstimateActive) {
                ps.cachedLiveBoard = page.removeDeadAndDying(ps.board);
                ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard);
                page.showEstimate();
            } else {
                page.updateTurn();
            }
            if (ps.selectedPiece) ps.selectedPiece = null;
            page.updateReplayUI();
            _weiqiBindings.updateRecordButtons();
            ps._syncMoveCoordsLen = (state.moveCoords && state.moveCoords.length) || 0;
        }

        /** 与洞围棋等一致：紧凑数组 ["B3,3","W4,4"]；仍兼容旧棋谱 { black:[], white:[] } */
        function applyReplayInitialPositionToBoard(curBoard, boardSize, initialPosition) {
            if (!initialPosition) return;
            if (Array.isArray(initialPosition)) {
                QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, boardSize, initialPosition);
                return;
            }
        }

        function enterReplayModeImpl(data) {
            const size = ps.BOARD_SIZE;
            ps.replayBoards = [];
            ps.replayMarkers = [];
            ps.replayHighlights = [];
            ps.replayMovePlayerColors = [];
            ps.replayStepPlayers = [0];
            let curBoard = C().initBoardArray(size);
            applyReplayInitialPositionToBoard(curBoard, size, data.initialPosition);
            ps.replayBoards.push(C().deepCopyBoard(curBoard));
            ps.replayMarkers.push([]);
            ps.replayHighlights.push([]);
            ps.replayMovePlayerColors.push(null);
            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                ps.replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const nb = page.tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.replayBoards.push(C().deepCopyBoard(curBoard));
                    ps.replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                    ps.replayHighlights.push([]);
                    ps.replayMovePlayerColors.push(playerVal);
                } else if (move.type === 'swap') {
                    const nb = trySwapPiece(curBoard, move.fromRow, move.fromCol, move.row, move.col, playerVal);
                    if (nb) curBoard = nb;
                    ps.replayBoards.push(C().deepCopyBoard(curBoard));
                    let nmm = [];
                    if (curBoard[move.row][move.col] === playerVal)
                        nmm = [{ row: move.row, col: move.col, color: playerVal }];
                    ps.replayMarkers.push(nmm);
                    ps.replayHighlights.push([
                        { row: move.fromRow, col: move.fromCol, frameOnly: curBoard[move.fromRow][move.fromCol] === 0 },
                        { row: move.row, col: move.col, frameOnly: curBoard[move.row][move.col] === 0 }
                    ]);
                    ps.replayMovePlayerColors.push(playerVal);
                } else if (move.type === 'pass') {
                    ps.replayBoards.push(C().deepCopyBoard(curBoard));
                    ps.replayMarkers.push([]);
                    ps.replayHighlights.push([]);
                    ps.replayMovePlayerColors.push(null);
                }
            }
            ps.replayTotalSteps = ps.replayBoards.length - 1;
            ps.replayMode = true;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = ps.replayTotalSteps;
            page.setReplayStep(ps.replayTotalSteps);
            page.updateReplayUI();
        }

        function exitReplayModeImpl() {
            page.clearMobileMovePreview();
            ps.tryPlayMode = false;
            ps.tryPlayBoards = [];
            ps.tryPlayMarkers = [];
            ps.tryPlayHighlights = [];
            ps.tryPlayMovePlayerColors = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            ps.tryPlayPlyCount = 0;
            ps.tryPlaySelectedPiece = null;
            ps.replayMode = false;
            ps.replayBoards = [];
            ps.replayMarkers = [];
            ps.replayHighlights = [];
            ps.replayMovePlayerColors = [];
            ps.replayStepPlayers = [];
            ps.replayStep = 0;
            ps.replayTotalSteps = 0;
            page.updateReplayUI();
        }

        function setReplayStepImpl(step) {
            page.clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
            ps.replayStep = step;
            ps.board = C().deepCopyBoard(ps.replayBoards[step]);
            ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
            ps.moveHighlightMarkers = (ps.replayHighlights[step] || []).map(m => ({ ...m }));
            ps.lastMovePlayerColor = ps.replayMovePlayerColors[step] != null ? ps.replayMovePlayerColors[step] : null;
            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;
            if (step === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 第${step}手`;
            }
            ps.isMyTurn = false;
            ps.selectedPiece = null;
            if (ps.showEstimateActive) page.showEstimate();
            else drawBoardImpl();
        }

        /** 试下进入/退出框架走公共 QiWeiqiSquarePageRuntime 逻辑；这里只补易位专属状态 */
        function initTryPlayExtraState() {
            ps.tryPlayHighlights = [ps.moveHighlightMarkers.map(m => ({ ...m }))];
            ps.tryPlayMovePlayerColors = [ps.lastMovePlayerColor];
            ps.tryPlayPlyCount = 0;
            ps.tryPlaySelectedPiece = null;
        }

        function tryPlayCanSwap() {
            return (ps.tryPlayBaseStep + ps.tryPlayPlyCount) < ps.maxTranspositionMoves;
        }

        function tryPlayAfterStep(newBoard, newMarkers, newHighlights, newMpc) {
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                ps.tryPlayHighlights.length = ps.tryPlayStep + 1;
                ps.tryPlayMovePlayerColors.length = ps.tryPlayStep + 1;
            }
            ps.tryPlayBoards.push(C().deepCopyBoard(newBoard));
            ps.tryPlayMarkers.push(newMarkers.map(m => ({ ...m })));
            ps.tryPlayHighlights.push(newHighlights.map(m => ({ ...m })));
            ps.tryPlayMovePlayerColors.push(newMpc);
            ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlayPlyCount++;
            ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
            ps.board = C().deepCopyBoard(newBoard);
            ps.lastMoveMarkers = newMarkers.map(m => ({ ...m }));
            ps.moveHighlightMarkers = newHighlights.map(m => ({ ...m }));
            ps.lastMovePlayerColor = newMpc;
            document.getElementById('replaySlider').max = ps.tryPlayTotalSteps;
            document.getElementById('replaySlider').value = ps.tryPlayStep;
            updateTryPlayDisplayImpl();
            if (ps.showEstimateActive) page.showEstimate();
            else drawBoardImpl();
        }

        function tryPlayPlaceAt(row, col) {
            const playerVal = ps.tryPlayCurrentPlayer;
            const newBoard = page.tryPlaceStone(ps.board, row, col, playerVal);
            if (!newBoard) return;
            tryPlayAfterStep(newBoard, [{ row, col, color: playerVal }], [], playerVal);
        }

        function tryPlaySwapAt(fromRow, fromCol, row, col) {
            const playerVal = ps.tryPlayCurrentPlayer;
            if (!tryPlayCanSwap()) return;
            const newBoard = trySwapPiece(ps.board, fromRow, fromCol, row, col, playerVal);
            if (!newBoard) return;
            let nmm = [];
            if (newBoard[row][col] === playerVal)
                nmm = [{ row, col, color: playerVal }];
            const nh = [
                { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
                { row, col, frameOnly: newBoard[row][col] === 0 }
            ];
            tryPlayAfterStep(newBoard, nmm, nh, playerVal);
        }

        function setTryPlayStepImpl(step) {
            page.clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
            ps.tryPlayStep = step;
            ps.board = C().deepCopyBoard(ps.tryPlayBoards[step]);
            ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));
            ps.moveHighlightMarkers = (ps.tryPlayHighlights[step] || []).map(m => ({ ...m }));
            ps.lastMovePlayerColor = ps.tryPlayMovePlayerColors[step] != null ? ps.tryPlayMovePlayerColors[step] : null;
            const basePlayer = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                ? ps.tryPlayBasePlayer
                : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
            ps.tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);
            ps.tryPlayPlyCount = step;
            ps.tryPlaySelectedPiece = null;
            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplayImpl();
            if (ps.showEstimateActive) page.showEstimate();
            else drawBoardImpl();
        }

        function updateTryPlayDisplayImpl() {
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (ps.tryPlayMode) {
                stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                const emoji = ps.tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
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

        let page = null;
        let _weiqiBindings = null;

        page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            komiInfoText: (p) => `黑贴白${p.KOMI}点`,
            drawBoard: drawBoardImpl,
            syncState: syncStateImpl,
            rebuildLiveReplayFromMoveCoords: rebuildLiveReplayCore,
            applyLiveViewBoard: applyLiveViewBoardImpl,
            enterReplayMode: enterReplayModeImpl,
            exitReplayMode: exitReplayModeImpl,
            setReplayStep: setReplayStepImpl,
            // 试下框架（进入/退出/从直播挂载 replayMode 脚手架）走公共逻辑，
            // 易位只通过钩子补专属状态（易位高亮/易位次数/选中子）
            onEnterTryPlay: initTryPlayExtraState,
            onExitTryPlay: () => {
                ps.tryPlayHighlights = [];
                ps.tryPlayMovePlayerColors = [];
                ps.tryPlayPlyCount = 0;
                ps.tryPlaySelectedPiece = null;
            },
            setTryPlayStep: setTryPlayStepImpl,
            updateTryPlayDisplay: updateTryPlayDisplayImpl
        });

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
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            tryPlaceStone,
            removeDeadAndDying,
            assignTerritoryWithRange
        } = page;

        _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
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
            onNewGameStarted: () => { ps.selectedPiece = null; },
            onRoomReset: () => { ps.selectedPiece = null; },
            onBoardSizeChanged: (msg) => {
                if (msg.boardSize != null) {
                    const bs = Number(msg.boardSize);
                    if (Number.isFinite(bs)) {
                        ps.maxTranspositionMoves = computeMaxTranspositionMoves(bs);
                        ps.KOMI = komiForSize(bs);
                        if (komiInfo) komiInfo.innerText = `黑贴白${ps.KOMI}点`;
                    }
                }
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            timeControlMainByoScale: 2
        });
        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function handleCanvasClick(e) {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            if (ps.waitingScoreConfirm) return;
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            const m2 = mobileTwoStepPlacing();

            if (ps.replayMode && ps.tryPlayMode) {
                const playerVal = ps.tryPlayCurrentPlayer;
                if (ps.tryPlaySelectedPiece) {
                    if (isSwapTargetForSelection(ps.board, ps.tryPlaySelectedPiece, row, col)) {
                        if (!tryPlayCanSwap()) {
                            ps.tryPlaySelectedPiece = null;
                            clearMobileMovePreview();
                            drawBoard();
                            return;
                        }
                        const swap = normalizeSwapCoords(ps.board, ps.tryPlaySelectedPiece, row, col, playerVal);
                        if (m2) {
                            if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                                clearMobileMovePreview();
                                tryPlaySwapAt(swap.fromRow, swap.fromCol, swap.row, swap.col);
                                ps.tryPlaySelectedPiece = null;
                            } else {
                                ps.hoverRow = row;
                                ps.hoverCol = col;
                                ps.isHoverValid = true;
                                drawBoard();
                            }
                            return;
                        }
                        tryPlaySwapAt(swap.fromRow, swap.fromCol, swap.row, swap.col);
                        ps.tryPlaySelectedPiece = null;
                    } else if (tryPlayCanSwap() && canSelectForSwap(ps.board, row, col, ps.BOARD_SIZE)) {
                        ps.tryPlaySelectedPiece = { row, col };
                        clearMobileMovePreview();
                        drawBoard();
                    } else {
                        ps.tryPlaySelectedPiece = null;
                        clearMobileMovePreview();
                        drawBoard();
                    }
                    return;
                }
                if (tryPlayCanSwap() && canSelectForSwap(ps.board, row, col, ps.BOARD_SIZE)) {
                    ps.tryPlaySelectedPiece = { row, col };
                    clearMobileMovePreview();
                    drawBoard();
                } else if (ps.board[row] && ps.board[row][col] === 0) {
                    if (m2) {
                        if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                            clearMobileMovePreview();
                            tryPlayPlaceAt(row, col);
                        } else {
                            ps.hoverRow = row;
                            ps.hoverCol = col;
                            ps.isHoverValid = true;
                            drawBoard();
                        }
                        return;
                    }
                    tryPlayPlaceAt(row, col);
                }
                return;
            }

            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            const playerVal = ps.mySlot === 'black' ? 1 : 2;

            if (ps.selectedPiece) {
                if (isSwapTargetForSelection(ps.board, ps.selectedPiece, row, col)) {
                    if (!ps.canTransposition) {
                        ps.selectedPiece = null;
                        clearMobileMovePreview();
                        drawBoard();
                        return;
                    }
                    const swap = normalizeSwapCoords(ps.board, ps.selectedPiece, row, col, playerVal);
                    if (m2) {
                        if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                            clearMobileMovePreview();
                            ps.ws.send(JSON.stringify({
                                type: 'move',
                                moveType: 'swap',
                                fromRow: swap.fromRow, fromCol: swap.fromCol,
                                row: swap.row, col: swap.col
                            }));
                            ps.selectedPiece = null;
                            drawBoard();
                        } else {
                            ps.hoverRow = row;
                            ps.hoverCol = col;
                            ps.isHoverValid = true;
                            drawBoard();
                        }
                        return;
                    }
                    ps.ws.send(JSON.stringify({
                        type: 'move',
                        moveType: 'swap',
                        fromRow: swap.fromRow, fromCol: swap.fromCol,
                        row: swap.row, col: swap.col
                    }));
                    ps.selectedPiece = null;
                } else if (ps.canTransposition && canSelectForSwap(ps.board, row, col, ps.BOARD_SIZE)) {
                    ps.selectedPiece = { row, col };
                    clearMobileMovePreview();
                    drawBoard();
                } else {
                    ps.selectedPiece = null;
                    clearMobileMovePreview();
                    drawBoard();
                }
                return;
            }

            if (ps.canTransposition && canSelectForSwap(ps.board, row, col, ps.BOARD_SIZE)) {
                ps.selectedPiece = { row, col };
                clearMobileMovePreview();
                drawBoard();
            } else if (ps.board[row] && ps.board[row][col] === 0) {
                if (m2) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        ps.ws.send(JSON.stringify({
                            type: 'move',
                            moveType: 'place',
                            row, col
                        }));
                        drawBoard();
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        drawBoard();
                    }
                    return;
                }
                ps.ws.send(JSON.stringify({
                    type: 'move',
                    moveType: 'place',
                    row, col
                }));
            }
        }

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

        canvas.addEventListener('click', handleCanvasClick);

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
                ps.hoverRow = row; ps.hoverCol = col;
                if (ps.tryPlayMode && ps.replayMode) {
                    if (ps.tryPlaySelectedPiece) {
                        ps.isHoverValid = isSwapTargetForSelection(ps.board, ps.tryPlaySelectedPiece, row, col);
                    } else {
                        ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                    }
                } else {
                    if (ps.selectedPiece) {
                        ps.isHoverValid = isSwapTargetForSelection(ps.board, ps.selectedPiece, row, col);
                    } else {
                        ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                    }
                }
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
