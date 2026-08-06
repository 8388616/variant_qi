window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['bury-mine-weiqi'] = {
    shell: {
        "title": "埋雷围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />开局前双方同时埋雷，每人最多埋 ⌈总点数/91⌉ 颗雷（9路1颗、19路4颗）。己方的雷仅自己可见（半透明）。也可以少埋，之后配额永久减少。<br /><br />踩到任意一方的雷时，该手等效于虚着并清除该雷，并提示「踩雷。」。雷被踩后，在对方再走完一手后，雷的主人可重新埋雷。<br /><br />终局时公开全部雷的位置。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "埋雷围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "zoomScroll": false,
            "editBoard": true,
            "compoundPalette": false,
            "replayMines": true
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "埋雷围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
            const C = QiSquareWeiqiCanvas, R = () => QiWeiqiSquarePageRuntime;
            const MINE = -3;
            var ps = {
                BOARD_SIZE: 19, KOMI: 3.25, PADDING: 0, CELL_SIZE: 0, numberOfHands: 1, currentPlayer: 1, mySlot: null, gameOver: false, winner: null,
                lastMoveMarkers: [], showEstimateActive: false, cachedLiveBoard: null, cachedTerritory: null, waitingScoreConfirm: false, iRejected: false,
                ws: null, isMyTurn: false, slots: { black: false, white: false }, reconnectTimer: null,
                replayMode: false, replayBoards: [], replayMarkers: [], replayStepPlayers: [], replayStep: 0, replayTotalSteps: 0,
                showMoveNumbers: false, moveLog: [],
                tryPlayMode: false, tryPlayBaseStep: 0, tryPlayBoards: [], tryPlayMarkers: [], tryPlayCurrentPlayer: 1, tryPlayStep: 0, tryPlayTotalSteps: 0,
                liveReplayBoards: [], liveReplayMarkers: [], liveReplayStepPlayers: [], liveViewStep: 0, liveFollowLatest: true,
                userBoardMarks: Object.create(null), hoverRow: -1, hoverCol: -1, isHoverValid: false,
                phase: 'waiting', buryDone: { black: false, white: false }, mineQuota: { black: 0, white: 0 },
                myMines: [], myLockedMines: [], myMineCount: 0, myMineQuota: 0, myBuryDone: true,
                minesRevealedPublicly: false, allMines: null, isInitialBury: false,
                gameStarted: false, editModeEnabled: false, editTool: 'empty',
                replayMinesVisible: true, matchStarted: false, matchStartedOnce: false
            };
            (function () {
                const g = C.computePaddingAndCell(ps.BOARD_SIZE);
                ps.PADDING = g.padding; ps.CELL_SIZE = g.cellSize;
                ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            })();

            const BOARD_MARK_CHAR_LIST = (() => {
                const a = ['?', '!']; for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
                a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩'); return a;
            })();
            const komiInfo = document.getElementById('komiInfo'), canvas = document.getElementById('goBoard'), ctx = canvas.getContext('2d');
            const turnDisplay = document.getElementById('turnDisplay'), colorStatus = document.getElementById('colorStatus');
            const scoreTitle = document.getElementById('scoreTitle'), scoreBoard = document.getElementById('scoreBoard'), leadInfo = document.getElementById('leadInfo');
            const scoreConfirmPanel = document.getElementById('scoreConfirmPanel'), scoreConfirmText = document.getElementById('scoreConfirmText');
            const scoreConfirmYes = document.getElementById('scoreConfirmYes'), scoreConfirmNo = document.getElementById('scoreConfirmNo');
            const boardMarkSelect = document.getElementById('boardMarkSelect');
            C.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST, '🚩');
            C.initBoardMarkFoldDom(document.getElementById('boardMarkPanel'), document.getElementById('boardMarkFoldBtn'), document.getElementById('boardMarkExpandBtn'));
            const replayMinesRow = document.getElementById('replayMinesRow');
            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            const domPage = { turnDisplay, scoreTitle, scoreBoard, leadInfo, scoreConfirmPanel, scoreConfirmText, komiInfo, canvas, ctx, boardMarkSelect, colorStatus };

            function dc(b) { return b.map(r => r.slice()); }
            function isBuryingNow() {
                return ps.phase === 'burying' && !ps.replayMode && !ps.tryPlayMode && !ps.gameOver;
            }
            function canIBury() {
                return isBuryingNow() && !!ps.mySlot && !ps.myBuryDone;
            }

            function hasLiberty(brd, row, col) {
                const color = brd[row][col];
                if (color !== 1 && color !== 2) return false;
                const n = ps.BOARD_SIZE, vis = Array(n).fill().map(() => Array(n).fill(false)), q = [[row, col]], dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                vis[row][col] = true;
                while (q.length) {
                    const [r, c] = q.shift();
                    for (const [dr, dc_] of dirs) {
                        const nr = r + dr, nc = c + dc_;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                        if (brd[nr][nc] === 0) return true;
                        if (brd[nr][nc] === color && !vis[nr][nc]) { vis[nr][nc] = true; q.push([nr, nc]); }
                    }
                }
                return false;
            }
            function removeGroup(brd, row, col, color) {
                const n = ps.BOARD_SIZE, q = [[row, col]], dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                brd[row][col] = 0;
                while (q.length) {
                    const [r, c] = q.shift();
                    for (const [dr, dc_] of dirs) {
                        const nr = r + dr, nc = c + dc_;
                        if (nr >= 0 && nr < n && nc >= 0 && nc < n && brd[nr][nc] === color) { brd[nr][nc] = 0; q.push([nr, nc]); }
                    }
                }
            }
            function tryPlace(boardBefore, row, col, playerVal) {
                if (boardBefore[row][col] !== 0) return null;
                const nb = dc(boardBefore);
                nb[row][col] = playerVal;
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                for (const [dr, dc_] of dirs) {
                    const nr = row + dr, nc = col + dc_;
                    if (nr >= 0 && nr < ps.BOARD_SIZE && nc >= 0 && nc < ps.BOARD_SIZE && nb[nr][nc] === 3 - playerVal)
                        if (!hasLiberty(nb, nr, nc)) removeGroup(nb, nr, nc, 3 - playerVal);
                }
                if (!hasLiberty(nb, row, col)) removeGroup(nb, row, col, playerVal);
                return nb;
            }
            function removeDead(src) { return src.map(r => r.slice()); }
            function assignTerritory(live) {
                return R().assignTerritoryWithRange(live, ps.BOARD_SIZE);
            }
            function isUserBoardMarkVisibleAt(r, c) {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                return true;
            }
            function numsOnBoard() {
                const n = ps.BOARD_SIZE, nums = Array(n).fill().map(() => Array(n).fill(0));
                if (ps.replayMode && ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const mk = ps.tryPlayMarkers[i];
                        if (mk?.[0] && (ps.board[mk[0].row][mk[0].col] === 1 || ps.board[mk[0].row][mk[0].col] === 2)) nums[mk[0].row][mk[0].col] = i;
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const mk = ps.replayMarkers[i];
                        if (mk?.[0] && (ps.board[mk[0].row][mk[0].col] === 1 || ps.board[mk[0].row][mk[0].col] === 2)) nums[mk[0].row][mk[0].col] = i;
                    }
                } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                    for (let i = 1; i <= ps.liveViewStep; i++) {
                        const mk = ps.liveReplayMarkers[i];
                        if (mk?.[0] && (ps.board[mk[0].row][mk[0].col] === 1 || ps.board[mk[0].row][mk[0].col] === 2)) nums[mk[0].row][mk[0].col] = i;
                    }
                } else {
                    for (let i = 0; i < ps.moveLog.length; i++) {
                        const m = ps.moveLog[i];
                        if (m && (ps.board[m.row][m.col] === 1 || ps.board[m.row][m.col] === 2)) nums[m.row][m.col] = i + 1;
                    }
                }
                return nums;
            }

            function drawMineSemi(row, col, alpha) {
                ctx.save();
                ctx.globalAlpha = alpha;
                R().drawMine(row, col, ctx, ps.PADDING, ps.CELL_SIZE);
                ctx.restore();
            }

            function minesToDraw() {
                if (ps.replayMode) {
                    if (!(ps.replayStep >= 0 && ps.replayMinesVisible)) return [];
                    // 打谱：终局公开雷；若无 allMines 则用盘上 -3
                    if (ps.allMines) {
                        return [...(ps.allMines.black || []), ...(ps.allMines.white || [])];
                    }
                    const out = [];
                    for (let r = 0; r < ps.BOARD_SIZE; r++)
                        for (let c = 0; c < ps.BOARD_SIZE; c++)
                            if (ps.board[r][c] === MINE) out.push({ row: r, col: c });
                    return out;
                }
                if (ps.minesRevealedPublicly || ps.gameOver) {
                    if (ps.allMines) return [...(ps.allMines.black || []), ...(ps.allMines.white || [])];
                    return ps.myMines || [];
                }
                return ps.myMines || [];
            }

            function drawBoardCore() {
                const d = C.draw, cs = C.DEFAULT_CANVAS_SIZE;
                d.clear(ctx, cs);
                d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, cs);
                d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
                d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);

                const revealFull = ps.replayMode
                    ? (ps.replayMinesVisible && (ps.minesRevealedPublicly || ps.gameOver || ps.allMines))
                    : (ps.minesRevealedPublicly || ps.gameOver);
                const mineAlpha = revealFull ? 1 : 0.45;
                for (const m of minesToDraw()) {
                    const r = m.row != null ? m.row : m.r;
                    const c = m.col != null ? m.col : m.c;
                    if (ps.board[r] && (ps.board[r][c] === 1 || ps.board[r][c] === 2)) continue;
                    drawMineSemi(r, c, mineAlpha);
                }

                const stoneRadius = ps.CELL_SIZE * 0.44, markLenDefault = ps.CELL_SIZE * 0.352;
                const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
                if (lowerLastMoveMarker) d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, stoneRadius);
                d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, stoneRadius, ps.showMoveNumbers);
                if (!lowerLastMoveMarker) d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, markLenDefault);
                d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, isUserBoardMarkVisibleAt);
                if (ps.showMoveNumbers) {
                    d.moveNumbersOnStones(ctx, numsOnBoard(), ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
                }
                const canHover = ps.tryPlayMode || canIBury() || (!ps.gameOver && !ps.waitingScoreConfirm && ps.isMyTurn && ps.phase === 'playing');
                if (canHover && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0 && ps.board[ps.hoverRow][ps.hoverCol] === 0) {
                    ctx.globalAlpha = 0.45; ctx.beginPath();
                    ctx.arc(ps.PADDING + ps.hoverCol * ps.CELL_SIZE, ps.PADDING + ps.hoverRow * ps.CELL_SIZE, ps.CELL_SIZE * 0.44, 0, 2 * Math.PI);
                    ctx.fillStyle = ps.tryPlayMode ? (ps.tryPlayCurrentPlayer === 1 ? '#222' : '#ddd') : (ps.mySlot === 'black' ? '#222' : '#ddd');
                    ctx.fill(); ctx.globalAlpha = 1;
                }
                if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                    const dr = ps.CELL_SIZE * 0.18;
                    for (let r = 0; r < ps.BOARD_SIZE; r++) for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        if ((ps.board[r][c] === 1 || ps.board[r][c] === 2) && ps.cachedLiveBoard[r][c] === 0) {
                            const x = ps.PADDING + c * ps.CELL_SIZE, y = ps.PADDING + r * ps.CELL_SIZE;
                            ctx.fillStyle = ps.board[r][c] === 1 ? '#fff' : '#222'; ctx.fillRect(x - dr, y - dr, dr * 2, dr * 2);
                        } else if (ps.board[r][c] === 0 && ps.cachedTerritory[r][c] === 1) {
                            const x = ps.PADDING + c * ps.CELL_SIZE, y = ps.PADDING + r * ps.CELL_SIZE; ctx.fillStyle = '#222'; ctx.fillRect(x - dr, y - dr, dr * 2, dr * 2);
                        } else if (ps.board[r][c] === 0 && ps.cachedTerritory[r][c] === 2) {
                            const x = ps.PADDING + c * ps.CELL_SIZE, y = ps.PADDING + r * ps.CELL_SIZE; ctx.fillStyle = '#f0f0f0'; ctx.fillRect(x - dr, y - dr, dr * 2, dr * 2);
                        }
                    }
                }
            }

            function rebuildLive(moveCoords, openingBoard) {
                const n = ps.BOARD_SIZE;
                ps.liveReplayBoards = []; ps.liveReplayMarkers = [];
                let cur = openingBoard ? dc(openingBoard) : Array(n).fill().map(() => Array(n).fill(0));
                ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                for (const move of (moveCoords || [])) {
                    const pv = move.player === 'black' ? 1 : 2;
                    if (move.type === 'move') {
                        const nb = tryPlace(cur, move.row, move.col, pv);
                        if (nb) cur = nb;
                        ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                    } else if (move.type === 'mineHit') {
                        ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                    } else if (move.type === 'pass') {
                        ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                    }
                }
            }

            function applyMineState(state) {
                if (!state) return;
                if (state.phase) ps.phase = state.phase;
                if (state.buryDone) ps.buryDone = { black: !!state.buryDone.black, white: !!state.buryDone.white };
                if (state.mineQuota) ps.mineQuota = { black: state.mineQuota.black | 0, white: state.mineQuota.white | 0 };
                if (state.myMines) ps.myMines = state.myMines.slice();
                else if (state.myMines === null) ps.myMines = [];
                if (state.myLockedMines) ps.myLockedMines = state.myLockedMines.slice();
                if (state.myMineCount != null) ps.myMineCount = state.myMineCount | 0;
                else ps.myMineCount = (ps.myMines || []).length;
                if (state.myMineQuota != null) ps.myMineQuota = state.myMineQuota | 0;
                if (state.myBuryDone != null) ps.myBuryDone = !!state.myBuryDone;
                if (state.minesRevealedPublicly != null) ps.minesRevealedPublicly = !!state.minesRevealedPublicly;
                if (state.allMines !== undefined) ps.allMines = state.allMines;
                if (state.isInitialBury != null) ps.isInitialBury = !!state.isInitialBury;
            }

            function burySync(state) {
                const incomingMoveLen = (state.moveCoords && state.moveCoords.length) || 0;
                const prevSyncedLen = ps._syncMoveCoordsLen;
                const incomingNH = state.numberOfHands || 1;
                const incomingGO = state.gameOver || false;
                const sizeWillChange = !!(state.boardSize && state.boardSize !== ps.BOARD_SIZE);
                const handsChanged = incomingNH !== ps.numberOfHands;
                const gameOverChanged = incomingGO !== ps.gameOver;
                const playerChanged = state.currentPlayer !== undefined && state.currentPlayer !== ps.currentPlayer;
                const moveListChanged = incomingMoveLen !== (prevSyncedLen !== undefined ? prevSyncedLen : -1);
                if (sizeWillChange || handsChanged || gameOverChanged || playerChanged || moveListChanged) page.clearMobileMovePreview();
                if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = state.boardSize;
                    if (state.komi != null && Number.isFinite(state.komi)) ps.KOMI = state.komi;
                    ps.board = page.initBoardArray(ps.BOARD_SIZE);
                    page.updateBoardGeometry();
                    const sel = document.getElementById('boardSizeSelect'); if (sel) sel.value = ps.BOARD_SIZE;
                } else if (state.komi != null && Number.isFinite(state.komi) && state.komi !== ps.KOMI) {
                    ps.KOMI = state.komi; if (komiInfo) komiInfo.innerText = `黑贴白${ps.KOMI}点`;
                }
                ps.numberOfHands = incomingNH; ps.currentPlayer = state.currentPlayer; ps.gameOver = incomingGO; ps.winner = state.winner || null;
                applyMineState(state);
                if (state.moveCoords) {
                    ps.moveLog = state.moveCoords.map(m => (m.type === 'move' || m.type === 'mineHit') ? { row: m.row, col: m.col } : null);
                }
                if (state.slots) ps.slots = state.slots;
                ps.gameStarted = ps.numberOfHands > 1 || ps.phase === 'playing' || ps.phase === 'burying';
                if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
                else if (state.matchTime && state.matchTime.settings) ps.matchStarted = true;
                if (ps.matchStarted) ps.matchStartedOnce = true;
                if (!ps.replayMode) {
                    const prevT = Math.max(0, ps.liveReplayBoards.length - 1), wasEnd = ps.liveFollowLatest || ps.liveViewStep >= prevT;
                    const coords = state.moveCoords || [];
                    const prevLen = prevSyncedLen !== undefined ? prevSyncedLen : -1;
                    if (
                        !sizeWillChange
                        && prevLen >= 0
                        && incomingMoveLen === prevLen + 1
                        && ps.liveReplayBoards.length === prevLen + 1
                        && state.board
                    ) {
                        ps.liveReplayBoards.push(dc(state.board));
                        ps.liveReplayMarkers.push((state.lastMoveMarkers || []).map(m => ({ ...m })));
                    } else if (
                        !sizeWillChange
                        && prevLen >= 0
                        && incomingMoveLen === prevLen
                        && ps.liveReplayBoards.length === prevLen + 1
                        && state.board
                        && state.lastMoveMarkers
                    ) {
                        ps.liveReplayBoards[ps.liveReplayBoards.length - 1] = dc(state.board);
                        ps.liveReplayMarkers[ps.liveReplayMarkers.length - 1] = state.lastMoveMarkers.map(m => ({ ...m }));
                    } else {
                        rebuildLive(coords, state.initialBoard);
                    }
                    ps._syncMoveCoordsLen = incomingMoveLen;
                    if (wasEnd) { ps.liveFollowLatest = true; ps.liveViewStep = Math.max(0, ps.liveReplayBoards.length - 1); }
                    else ps.liveViewStep = Math.min(ps.liveViewStep, Math.max(0, ps.liveReplayBoards.length - 1));
                    if (ps.liveFollowLatest && state.board) {
                        ps.board = dc(state.board);
                        ps.lastMoveMarkers = (state.lastMoveMarkers || []).map(m => ({ ...m }));
                    } else if (ps.liveReplayBoards[ps.liveViewStep]) {
                        ps.board = dc(ps.liveReplayBoards[ps.liveViewStep]);
                        ps.lastMoveMarkers = (ps.liveReplayMarkers[ps.liveViewStep] || []).map(m => ({ ...m }));
                    }
                }
                page.updateLiveReplayPanelUI();
                if (!ps.replayMode) {
                    if (ps.phase === 'burying') {
                        ps.isMyTurn = canIBury();
                    } else {
                        page.updateTurn();
                    }
                    refreshBuryUi();
                }
                else page.updateTurn();
                drawBoardCore();
            }

            function enterReplay(moveCoords, openingBoard) {
                const n = ps.BOARD_SIZE;
                let cur = openingBoard ? dc(openingBoard) : Array(n).fill().map(() => Array(n).fill(0));
                ps.replayBoards = [dc(cur)]; ps.replayMarkers = [[]];
                for (const move of (moveCoords || [])) {
                    const pv = move.player === 'black' ? 1 : 2;
                    if (move.type === 'move') {
                        const nb = tryPlace(cur, move.row, move.col, pv);
                        if (nb) cur = nb;
                        ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                    } else if (move.type === 'mineHit') {
                        ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                    } else if (move.type === 'pass') {
                        ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
                    }
                }
                ps.replayTotalSteps = ps.replayBoards.length - 1; ps.replayMode = true;
                ps.replayMinesVisible = true;
                const rShow = document.getElementById('replayMinesShow'), rHide = document.getElementById('replayMinesHide');
                if (rShow) rShow.checked = true; if (rHide) rHide.checked = false;
                document.getElementById('replaySlider').max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps); page.updateReplayUI();
            }

            var page;
            page = R().create(ps, domPage, {
                enableEditBoard: true,
                editTools: config.editTools,
                recordDownloadPrefix, minLib, maxWeakLiberties: 0, gameType, roomId, roomPassword, isMouseDevice,
                boardMarkMode: 'minesweeper',
                tryPlaceStone: tryPlace, removeDeadAndDying: removeDead, assignTerritoryWithRange: assignTerritory,
                drawBoard: drawBoardCore, syncState: burySync, rebuildLiveReplayFromMoveCoords: rebuildLive, enterReplayMode: enterReplay
            });

            function resetScoreBoardLayout() {
                if (!scoreBoard) return;
                scoreBoard.style.display = '';
                scoreBoard.style.justifyContent = '';
                scoreBoard.style.alignItems = '';
                scoreBoard.innerHTML = '';
            }

            function refreshBuryUi() {
                if (!turnDisplay || !scoreBoard) return;
                if (ps.replayMode || ps.tryPlayMode || ps.waitingScoreConfirm || ps.showEstimateActive) return;
                if (ps.phase !== 'burying' || ps.gameOver) {
                    return;
                }
                const quota = ps.mySlot ? (ps.myMineQuota | 0) : 0;
                const count = ps.mySlot ? (ps.myMineCount | 0) : 0;
                if (ps.mySlot && !ps.myBuryDone) {
                    turnDisplay.innerText = `埋雷中(${count}/${quota})`;
                    resetScoreBoardLayout();
                    scoreBoard.style.display = 'flex';
                    scoreBoard.style.justifyContent = 'center';
                    scoreBoard.style.alignItems = 'center';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'ctrl-btn';
                    btn.id = 'buryMineFinishBtn';
                    btn.textContent = '埋雷完成';
                    btn.style.padding = '6px 12px';
                    btn.addEventListener('click', () => {
                        if (!ps.ws || ps.ws.readyState !== 1) return;
                        if (!canIBury()) return;
                        ps.ws.send(JSON.stringify({ type: 'buryFinish' }));
                    });
                    scoreBoard.appendChild(btn);
                    if (scoreTitle) scoreTitle.innerText = '　';
                    if (leadInfo) leadInfo.innerText = '　';
                } else if (ps.mySlot && ps.myBuryDone) {
                    turnDisplay.innerText = '等待对方埋雷';
                    resetScoreBoardLayout();
                    scoreBoard.innerText = '等待对方埋雷';
                    if (scoreTitle) scoreTitle.innerText = '　';
                    if (leadInfo) leadInfo.innerText = '　';
                } else {
                    turnDisplay.innerText = '埋雷中';
                    resetScoreBoardLayout();
                    scoreBoard.innerText = '　';
                }
                ps.isMyTurn = canIBury();
            }

            (function wrapTurnForBury() {
                const wrap = (name) => {
                    const o = page[name];
                    if (typeof o !== 'function') return;
                    page[name] = function (...args) {
                        const r = o.apply(this, args);
                        if (ps.phase === 'burying') refreshBuryUi();
                        return r;
                    };
                };
                wrap('updateTurn');
                wrap('clearEstimate');
                wrap('showEstimate');
                wrap('setLiveViewStep');
            })();

            const {
                mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, showEstimate, clearEstimate, downloadRecord,
                showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI,
                enterTryPlay, exitTryPlay, tryPlayMove, setTryPlayStep, updateTryPlayDisplay, applyLiveViewBoard, updateLiveReplayPanelUI,
                setLiveViewStep, connectWebSocket, initBoardArray, updateBoardGeometry, syncState, commitMove, updateTurn,
                getClosestIntersection, canvasCoordsFromClient, applyUserBoardMark,
                updateEditModeUI, clearEditModeUi
            } = page;

            const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
                roomId, gameType, pageState: ps, drawBoard, exitTryPlay, enterTryPlay, setTryPlayStep, setReplayStep, setLiveViewStep,
                getWs: () => ps.ws, getBoardSize: () => ps.BOARD_SIZE, setBoardSize: (n) => { ps.BOARD_SIZE = n; },
                getKomi: () => ps.KOMI, setKomi: (n) => { ps.KOMI = n; if (komiInfo) komiInfo.innerText = `黑贴白${ps.KOMI}点`; },
                getBoard: () => ps.board, setBoard: (b) => { ps.board = b; }, getSlots: () => ps.slots, setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot, setMySlot: (s) => { ps.mySlot = s; }, getGameOver: () => ps.gameOver, setGameOver: (v) => { ps.gameOver = v; },
                getWinner: () => ps.winner, setWinner: (w) => { ps.winner = w; }, getReplayMode: () => ps.replayMode,
                getShowEstimateActive: () => ps.showEstimateActive, setShowEstimateActive: (v) => { ps.showEstimateActive = v; },
                getWaitingScoreConfirm: () => ps.waitingScoreConfirm, setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
                getIRejected: () => ps.iRejected, setIRejected: (v) => { ps.iRejected = v; },
                colorStatus, scoreTitle, turnDisplay, syncState, updateBoardGeometry, initBoardArray,
                exitReplayMode, clearEstimate, hideScoreConfirm, showEstimate, clearMobileMovePreview, downloadRecord, enterReplayMode, updateTurn, updateReplayUI,
                showScoreConfirm, isMouseDevice, standardWeiqiMatchTime,
                boardSeatOverlay: true,
                updateEditModeUI,
                onNewGameStarted: () => {
                    clearEditModeUi();
                    ps.gameStarted = false;
                    ps.phase = 'waiting';
                    ps.myMines = [];
                    ps.myLockedMines = [];
                    ps.minesRevealedPublicly = false;
                    ps.allMines = null;
                    colorStatus.innerText = '未选择阵营';
                    resetScoreBoardLayout();
                    scoreBoard.innerText = '　';
                }
            });

            const _ur0 = page.updateReplayUI;
            page.updateReplayUI = function () {
                _ur0();
                _weiqiBindings.updateRecordButtons();
                if (replayMinesRow) replayMinesRow.style.display = ps.replayMode ? '' : 'none';
            };
            document.querySelectorAll('input[name="replayMinesVis"]').forEach(el => {
                el.addEventListener('change', () => {
                    if (!el.checked) return;
                    ps.replayMinesVisible = el.value === 'show';
                    drawBoard();
                });
            });

            (function wrapReplayNewGame() {
                const b = document.getElementById('newGameBtn'); if (!b) return;
                const p = b.onclick;
                b.onclick = () => { if (ps.replayMode) { if (ps.ws && ps.ws.readyState === WebSocket.OPEN) ps.ws.send(JSON.stringify({ type: 'resetRoom' })); return; } if (typeof p === 'function') p(); };
            })();

            function handleMessage(msg) {
                if (msg.type === 'editBoardAccepted') { syncState(msg); return; }
                if (msg.type === 'boardSizeChanged') { syncState(msg); clearEstimate(); _weiqiBindings.updateRadioStyles(); return; }

                if (msg.type === 'broadcast' && msg.action === 'mineHit') {
                    if (typeof qiAlert === 'function') qiAlert('踩雷。');
                }

                // 埋雷阶段动作不在通用 weiqi bindings 白名单内，需自行同步
                if (msg.type === 'broadcast' && (
                    msg.action === 'buryClick'
                    || msg.action === 'buryDone'
                    || msg.action === 'buryDoneAll'
                    || msg.action === 'buryPhase'
                )) {
                    syncState(msg);
                    return;
                }

                if (msg.type === 'timeControlAgreed') {
                    applyMineState(msg);
                    if (msg.matchStarted != null) ps.matchStarted = !!msg.matchStarted;
                }

                _weiqiBindings.handleMessage(msg);

                if (msg.type === 'timeControlAgreed') {
                    applyMineState(msg);
                    refreshBuryUi();
                    drawBoard();
                }
            }

            let suppressCanvasClickAfterLongMark = false;
            const LONG_MARK_MS = 500, LONG_MARK_MOVE_CANCEL = 14;
            let longMarkTimer = null, longMarkStart = null;
            canvas.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                const t = e.touches[0]; longMarkStart = { x: t.clientX, y: t.clientY };
                longMarkTimer = setTimeout(() => {
                    longMarkTimer = null; if (!longMarkStart) return;
                    const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                    const { row, col } = getClosestIntersection(x, y);
                    applyUserBoardMark(row, col); suppressCanvasClickAfterLongMark = true;
                    setTimeout(() => { suppressCanvasClickAfterLongMark = false; }, 450); longMarkStart = null;
                }, LONG_MARK_MS);
            }, { passive: true });
            canvas.addEventListener('touchmove', (e) => {
                if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
                const t = e.touches[0];
                const dx = t.clientX - longMarkStart.x, dy = t.clientY - longMarkStart.y;
                if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) { clearTimeout(longMarkTimer); longMarkTimer = null; }
            }, { passive: true });
            function clearLongMarkTouch() { if (longMarkTimer) { clearTimeout(longMarkTimer); longMarkTimer = null; } longMarkStart = null; }
            canvas.addEventListener('touchend', clearLongMarkTouch); canvas.addEventListener('touchcancel', clearLongMarkTouch);

            canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                applyUserBoardMark(row, col);
            });

            function sendBuryClick(row, col) {
                if (!ps.ws || ps.ws.readyState !== 1) return;
                ps.ws.send(JSON.stringify({ type: 'buryClick', row, col }));
            }

            canvas.addEventListener('click', (e) => {
                if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
                if (ps.editModeEnabled) return;
                const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
                const x = (e.clientX - rect.left) * sc, y = (e.clientY - rect.top) * sc;
                const { row, col } = getClosestIntersection(x, y);

                if (canIBury()) {
                    if (row < 0 || col < 0) return;
                    if (ps.board[row][col] !== 0) return;
                    sendBuryClick(row, col);
                    return;
                }

                if (ps.tryPlayMode && ps.replayMode) {
                    if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                    if (ps.board[row][col] === 1 || ps.board[row][col] === 2) return;
                    if (mobileTwoStepPlacing()) {
                        if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); tryPlayMove(row, col); }
                        else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                        return;
                    }
                    tryPlayMove(row, col); return;
                }
                if (ps.gameOver || ps.phase === 'burying' || !ps.isMyTurn || ps.waitingScoreConfirm) return;
                if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                if (ps.board[row][col] === 1 || ps.board[row][col] === 2) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); commitMove(row, col); drawBoard(); }
                    else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
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
                    const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
                    const { row, col } = getClosestIntersection((e.clientX - rect.left) * sc, (e.clientY - rect.top) * sc);
                    ps.hoverRow = row; ps.hoverCol = col;
                    const allow = canIBury() || ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn && ps.phase === 'playing');
                    ps.isHoverValid = !!(allow && row >= 0 && col >= 0 && ps.board[row][col] === 0);
                    drawBoard();
                });
                canvas.addEventListener('mouseleave', () => {
                    if (!ps.waitingScoreConfirm) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                });
            }

            if (scoreConfirmYes) {
                scoreConfirmYes.onclick = () => { ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: true })); hideScoreConfirm(); };
                scoreConfirmNo.onclick = () => {
                    ps.iRejected = true; ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false })); hideScoreConfirm();
                    if (ps.showEstimateActive) { ps.showEstimateActive = false; clearEstimate(); }
                    ps.waitingScoreConfirm = false;
                };
            }
            connectWebSocket(handleMessage);
        })();
    }
};
