window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['minesweeper-weiqi'] = {
    shell: {
        "title": "扫雷围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />第2手落子后，在棋盘上随机生成若干隐藏的雷（数量约为棋盘总点数的20%，向上取整）。<br /><br />落子在雷上时，落子无效（等效于虚着），同时雷被消除。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "扫雷围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "compoundPalette": false,
            "zoomScroll": false,
            "replayMines": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "扫雷围棋";
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
            minesweeperHints: {}, holes: [], minesRevealedPublicly: false, holesGenerated: false, remainingMines: null,
            gameStarted: false, editModeEnabled: false, editTool: 'empty',
            replayMinesVisible: true
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
        const editModeCheckbox = document.getElementById('editModeCheckbox'), editToolSelect = document.getElementById('editToolSelect'), clearBoardBtn = document.getElementById('clearBoardBtn');
        const replayMinesRow = document.getElementById('replayMinesRow');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const domPage = { turnDisplay, scoreTitle, scoreBoard, leadInfo, scoreConfirmPanel, scoreConfirmText, komiInfo, canvas, ctx, boardMarkSelect, colorStatus };

        function dc(b) { return b.map(r => r.slice()); }
        function hasLiberty(brd, row, col) 
        {
            const color = brd[row][col];
            if (color === 0 || color === MINE)
                return false;
            const n = ps.BOARD_SIZE, vis = Array(n).fill().map(() => Array(n).fill(false)), q = [[row, col]], dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            vis[row][col] = true;
            while (q.length) 
            {
                const [r, c] = q.shift();
                for (const [dr, dc_] of dirs) 
                {
                    const nr = r + dr, nc = c + dc_;
                    if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                    if (brd[nr][nc] === 0 || brd[nr][nc] === MINE)
                        return true;
                    if (brd[nr][nc] === color && !vis[nr][nc])
                    {
                        vis[nr][nc] = true;
                        q.push([nr, nc]); 
                    }
                }
            }
            return false;
        }
        function removeGroupMs(brd, row, col, color) {
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
        function msTryPlace(boardBefore, row, col, playerVal) {
            if (boardBefore[row][col] !== 0) return null;
            const nb = dc(boardBefore);
            nb[row][col] = playerVal;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc_] of dirs) {
                const nr = row + dr, nc = col + dc_;
                if (nr >= 0 && nr < ps.BOARD_SIZE && nc >= 0 && nc < ps.BOARD_SIZE && nb[nr][nc] === 3 - playerVal)
                    if (!hasLiberty(nb, nr, nc)) removeGroupMs(nb, nr, nc, 3 - playerVal);
            }
            if (!hasLiberty(nb, row, col)) removeGroupMs(nb, row, col, playerVal);
            return nb;
        }
        function msRemoveDead(src) {
            // 扫雷围棋形势判断/数点：不判残子，盘上棋子全部视为活子
            return src.map(r => r.slice());
        }
        function msAssign(live) {
            return R().assignTerritoryWithRangeWithHoles(live, ps.BOARD_SIZE, (r, c) => live[r][c] === MINE);
        }
        function isUserBoardMarkVisibleAt(r, c) {
            if (ps.showEstimateActive) return false;
            if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            if (ps.board[r][c] !== 0) return false;
            return true;
        }
        function numsSweep() {
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

        function showMineCountsOnStones() {
            if (!(ps.replayMode && !ps.tryPlayMode)) return true;
            return ps.replayStep >= 3;
        }

        /** 与房间端 computeMinesweeperHints 一致，供打谱/试下按当前盘面刷新 */
        function computeMinesweeperHintsLocal(board, n) {
            const hints = {};
            const dirs8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (board[r][c] !== 1 && board[r][c] !== 2) continue;
                    let cnt = 0;
                    for (const [dr, dc] of dirs8) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === MINE) cnt++;
                    }
                    if (cnt > 0) hints[`${r},${c}`] = cnt;
                }
            }
            return hints;
        }

        function refreshReplayMinesweeperHints() {
            if (ps.replayMode && ps.board) ps.minesweeperHints = computeMinesweeperHintsLocal(ps.board, ps.BOARD_SIZE);
        }

        function drawBoardSweep() 
        {
            const d = C.draw, cs = C.DEFAULT_CANVAS_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            const showMinesOnBoard = ps.replayMode
                ? (ps.replayStep >= 3 && ps.replayMinesVisible)
                : ps.minesRevealedPublicly;
            if (showMinesOnBoard) 
            {
                for (let r = 0; r < ps.BOARD_SIZE; r++)
                    for (let c = 0; c < ps.BOARD_SIZE; c++)
                        if (ps.board[r][c] === MINE) R().drawMine(r, c, ctx, ps.PADDING, ps.CELL_SIZE);
            }
            const stoneRadius = ps.CELL_SIZE * 0.44, markLenDefault = ps.CELL_SIZE * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, stoneRadius);
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker) d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, ps.CELL_SIZE, markLenDefault);
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = numsSweep();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
            } else if (!ps.showEstimateActive && ps.minesweeperHints && showMineCountsOnStones())
             {
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const mineHintFontPx = Math.max(12, Math.floor(stoneRadius * 0.7));
                for (let r = 0; r < ps.BOARD_SIZE; r++) for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    const n = ps.minesweeperHints[`${r},${c}`];
                    if (n > 0 && (ps.board[r][c] === 1 || ps.board[r][c] === 2)) {
                        const cx = 1 + ps.PADDING + c * ps.CELL_SIZE, cy = 1 + ps.PADDING + r * ps.CELL_SIZE;
                        ctx.font = `bold ${mineHintFontPx}px Arial`;
                        ctx.fillStyle = ps.board[r][c] === 1 ? '#ffffff' : '#000000';
                        ctx.shadowBlur = 0;
                        ctx.fillText(String(n), cx - stoneRadius * 0.4, cy - stoneRadius * 0.4);
                    }
                }
            }
            const canHover = ps.tryPlayMode || (!ps.gameOver && !ps.waitingScoreConfirm && ps.isMyTurn);
            if (canHover && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0 && (ps.board[ps.hoverRow][ps.hoverCol] === 0 || ps.board[ps.hoverRow][ps.hoverCol] === MINE)) {
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

        function rebuildLiveSweep(moveCoords, openingBoard) {
            const n = ps.BOARD_SIZE;
            ps.liveReplayBoards = []; ps.liveReplayMarkers = [];
            let cur = openingBoard ? dc(openingBoard) : Array(n).fill().map(() => Array(n).fill(0));
            if (!ps.minesRevealedPublicly && !ps.gameOver) {
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (cur[r][c] === MINE) cur[r][c] = 0;
                    }
                }
            }
            ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const pv = move.player === 'black' ? 1 : 2;
                if (move.type === 'move') {
                    const nb = msTryPlace(cur, move.row, move.col, pv);
                    if (nb) cur = nb;
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                } else if (move.type === 'mineHit') {
                    if (cur[move.row][move.col] === MINE) cur[move.row][move.col] = 0;
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                } else if (move.type === 'holeReveal') {
                    if (cur[move.row][move.col] === MINE) cur[move.row][move.col] = 0;
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                } else if (move.type === 'pass') {
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                }
            }
        }

        function sweepSync(state) {
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
            ps.minesweeperHints = state.minesweeperHints || {};
            ps.minesRevealedPublicly = !!state.minesRevealedPublicly;
            ps.holesGenerated = !!state.holesGenerated;
            ps.remainingMines = (state.remainingMines != null && Number.isFinite(state.remainingMines))
                ? state.remainingMines
                : null;
            if (state.moveCoords) ps.moveLog = state.moveCoords.map(m => m.type === 'move' ? { row: m.row, col: m.col } : null);
            if (state.slots) ps.slots = state.slots;
            ps.gameStarted = ps.numberOfHands > 1;
            if (state.matchStarted !== undefined) {
                ps.matchStarted = !!state.matchStarted;
            } else if (state.matchTime && state.matchTime.settings) {
                // 兼容未显式回传 matchStarted 的旧状态：只要已协商限时即视为正式开局
                ps.matchStarted = true;
            }
            if (ps.matchStarted) ps.matchStartedOnce = true;
            if (!ps.replayMode) {
                const prevT = Math.max(0, ps.liveReplayBoards.length - 1), wasEnd = ps.liveFollowLatest || ps.liveViewStep >= prevT;
                const coords = state.moveCoords || [];
                const prevLen = prevSyncedLen !== undefined ? prevSyncedLen : -1;
                // 常态：每手只追加一帧，避免整谱重放 + 大包 boardHistory 导致越下越卡
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
                    && ps.liveReplayBoards.length === incomingMoveLen + 1
                    && state.board
                ) {
                    ps.liveReplayBoards[ps.liveReplayBoards.length - 1] = dc(state.board);
                    if (state.lastMoveMarkers)
                        ps.liveReplayMarkers[ps.liveReplayMarkers.length - 1] = state.lastMoveMarkers.map(m => ({ ...m }));
                } else if (Array.isArray(state.boardHistory) && state.boardHistory.length > 0) {
                    // 兼容旧服务端仍下发 boardHistory 的情况
                    ps.liveReplayBoards = state.boardHistory.map(b => b.map(row => row.slice()));
                    ps.liveReplayMarkers = (state.markerHistory || []).map(a => (a || []).map(m => ({ ...m })));
                    while (ps.liveReplayMarkers.length < ps.liveReplayBoards.length) ps.liveReplayMarkers.push([]);
                } else {
                    const opening = (incomingMoveLen === 0 && state.board) ? state.board : null;
                    rebuildLiveSweep(coords, opening);
                }
                ps.liveReplayStepPlayers = [0];
                for (const m of coords)
                    ps.liveReplayStepPlayers.push(m.player === 'black' ? 1 : 2);
                const newT = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newT === 0) { ps.liveViewStep = 0; ps.liveFollowLatest = true; }
                else if (wasEnd) { ps.liveViewStep = newT; ps.liveFollowLatest = true; }
                else { ps.liveViewStep = Math.min(ps.liveViewStep, newT); if (ps.liveViewStep === newT) ps.liveFollowLatest = true; }
                page.applyLiveViewBoard(); page.updateLiveReplayPanelUI();
                if (state.board) {
                    const tot = Math.max(0, ps.liveReplayBoards.length - 1);
                    if (ps.liveFollowLatest && ps.liveViewStep === tot) {
                        ps.board = dc(state.board);
                        if (state.lastMoveMarkers && state.lastMoveMarkers.length) ps.lastMoveMarkers = state.lastMoveMarkers.map(m => ({ ...m }));
                    }
                }
            } else {
                ps.board = state.board; ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }
            ps.holes = [];
            for (let r = 0; r < ps.BOARD_SIZE; r++) for (let c = 0; c < ps.BOARD_SIZE; c++) if (ps.board[r] && ps.board[r][c] === MINE) ps.holes.push({ r, c });
            const hasS = ps.board.some(row => row.some(v => v === 1 || v === 2)), hasP = ps.slots.black || ps.slots.white;
            const sizeSel = document.getElementById('boardSizeSelect');
            if (sizeSel) {
                if (!hasS && !hasP && !ps.gameOver && ps.mySlot === null && !ps.replayMode) sizeSel.style.display = '';
                else sizeSel.style.display = 'none';
            }
            if (ps.showEstimateActive) { ps.cachedLiveBoard = msRemoveDead(ps.board); ps.cachedTerritory = msAssign(ps.cachedLiveBoard); page.showEstimate(); }
            else page.updateTurn();
            page.updateReplayUI();
            ps._syncMoveCoordsLen = incomingMoveLen;
        }

        function isLegacyMinesweeperInitial(ip) {
            if (!Array.isArray(ip)) return false;
            return ip.some(s => typeof s === 'string' && s.length >= 2 && (s[0] === 'B' || s[0] === 'W'));
        }
        function parseMineSnapshotFromInitial(ip, boardSize) {
            const out = [];
            if (!Array.isArray(ip) || !Number.isInteger(boardSize)) return out;
            for (const s of ip) {
                if (typeof s !== 'string' || s.length < 3 || s[0] !== 'M') continue;
                const comma = s.indexOf(',');
                if (comma <= 1) continue;
                const r = parseInt(s.slice(1, comma), 10), c = parseInt(s.slice(comma + 1), 10);
                if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                out.push({ r, c });
            }
            return out;
        }

        function applyMinesweeperInitialCompact(board, boardSize, ip) {
            if (!ip) return;
            if (Array.isArray(ip)) {
                for (const s of ip) {
                    if (typeof s !== 'string' || s.length < 3) continue;
                    const t = s[0];
                    if (t !== 'B' && t !== 'W' && t !== 'M') continue;
                    const comma = s.indexOf(',');
                    if (comma <= 1) continue;
                    const r = parseInt(s.slice(1, comma), 10), c = parseInt(s.slice(comma + 1), 10);
                    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
                    if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                    if (t === 'B') board[r][c] = 1;
                    else if (t === 'W') board[r][c] = 2;
                    else board[r][c] = -1;
                }
                return;
            }
            if (typeof ip !== 'object') return;
            if (Array.isArray(ip.holes)) for (const pos of ip.holes)
                if (Array.isArray(pos) && pos.length === 2) { const [r, c] = pos; if (r >= 0 && r < boardSize && c >= 0 && c < boardSize) board[r][c] = -1; }
            if (Array.isArray(ip.black)) for (const pos of ip.black)
                if (Array.isArray(pos) && pos.length === 2) { const [r, c] = pos; if (r >= 0 && r < boardSize && c >= 0 && c < boardSize) board[r][c] = 1; }
            if (Array.isArray(ip.white)) for (const pos of ip.white)
                if (Array.isArray(pos) && pos.length === 2) { const [r, c] = pos; if (r >= 0 && r < boardSize && c >= 0 && c < boardSize) board[r][c] = 2; }
        }

        function msEnterReplay(data) {
            const size = ps.BOARD_SIZE;
            ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = [0];
            let cur = Array(size).fill().map(() => Array(size).fill(0));
            const ip = data.initialPosition;
            let snapshotMines = null;
            if (ip && isLegacyMinesweeperInitial(ip)) applyMinesweeperInitialCompact(cur, size, ip);
            else if (Array.isArray(ip)) snapshotMines = parseMineSnapshotFromInitial(ip, size);
            else if (ip) applyMinesweeperInitialCompact(cur, size, ip);
            let stoneMoveCount = 0;
            let minesPlacedFromSnapshot = cur.some(row => row.some(v => v === MINE));
            ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
            for (const move of (data.moves || [])) {
                const pv = move.player === 'black' ? 1 : 2;
                ps.replayStepPlayers.push(pv);
                if (move.type === 'move') {
                    const nb = msTryPlace(cur, move.row, move.col, pv);
                    if (nb) cur = nb;
                    stoneMoveCount++;
                    if (!minesPlacedFromSnapshot && stoneMoveCount >= 2 && snapshotMines && snapshotMines.length) {
                        for (const h of snapshotMines) {
                            if (cur[h.r][h.c] === 0) cur[h.r][h.c] = -1;
                        }
                        minesPlacedFromSnapshot = true;
                    }
                    ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                } else if (move.type === 'mineHit') {
                    if (cur[move.row][move.col] === MINE) cur[move.row][move.col] = 0;
                    ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([{ row: move.row, col: move.col, color: pv }]);
                } else if (move.type === 'holeReveal') {
                    if (cur[move.row][move.col] === MINE) cur[move.row][move.col] = 0;
                    ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
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
            recordDownloadPrefix, minLib, maxWeakLiberties: 0, gameType, roomId, roomPassword, isMouseDevice,
            boardMarkMode: 'minesweeper',
            tryPlaceStone: msTryPlace, removeDeadAndDying: msRemoveDead, assignTerritoryWithRange: msAssign,
            drawBoard: drawBoardSweep, syncState: sweepSync, rebuildLiveReplayFromMoveCoords: rebuildLiveSweep, enterReplayMode: msEnterReplay
        });

        function shouldShowRemainingMinesScoreLine() {
            if (!ps.holesGenerated || ps.remainingMines == null) return false;
            if (ps.showEstimateActive) return false;
            if (ps.waitingScoreConfirm) return false;
            if (ps.gameOver) return false;
            if (ps.replayMode && !ps.tryPlayMode) return false;
            return true;
        }
        function refreshRemainingMinesScoreLine() {
            if (!scoreBoard) return;
            if (!shouldShowRemainingMinesScoreLine()) {
                if (ps.showEstimateActive || ps.waitingScoreConfirm) return;
                scoreBoard.innerText = '　';
                return;
            }
            scoreBoard.innerText = `剩余雷数　${ps.remainingMines}`;
        }
        (function wrapRemainingMinesScoreRefresh() {
            const wrap = (name) => {
                const o = page[name];
                if (typeof o !== 'function') return;
                page[name] = function (...args) {
                    const r = o.apply(this, args);
                    refreshRemainingMinesScoreLine();
                    return r;
                };
            };
            wrap('updateTurn');
            wrap('clearEstimate');
            wrap('showEstimate');
            wrap('setLiveViewStep');
            wrap('setTryPlayStep');
            wrap('enterTryPlay');
            wrap('exitTryPlay');
        })();
        (function wrapReplayMinesweeperHints() {
            const sr = page.setReplayStep.bind(page);
            page.setReplayStep = (step) => { sr(step); refreshReplayMinesweeperHints(); };
            const ts = page.setTryPlayStep.bind(page);
            page.setTryPlayStep = (step) => { ts(step); refreshReplayMinesweeperHints(); };
            const tm = page.tryPlayMove.bind(page);
            page.tryPlayMove = (row, col) => {
                const ok = tm(row, col);
                if (ok) refreshReplayMinesweeperHints();
                return ok;
            };
        })();
        const _ur0 = page.updateReplayUI;

        const {
            mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, showEstimate, clearEstimate, downloadRecord,
            showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI,
            enterTryPlay, exitTryPlay, tryPlayMove, setTryPlayStep, updateTryPlayDisplay, applyLiveViewBoard, updateLiveReplayPanelUI,
            setLiveViewStep, connectWebSocket, initBoardArray, updateBoardGeometry, syncState, commitMove, updateTurn,
            getClosestIntersection, canvasCoordsFromClient, applyUserBoardMark
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
            showScoreConfirm, isMouseDevice, standardWeiqiMatchTime, timeControlMainByoScale: 2,
            boardSeatOverlay: true,
            onNewGameStarted: () => {
                ps.gameStarted = false; ps.editModeEnabled = false; if (editModeCheckbox) editModeCheckbox.checked = false;
                ps.holesGenerated = false; ps.remainingMines = null; ps.minesRevealedPublicly = false;
                colorStatus.innerText = '未选择阵营';
                refreshRemainingMinesScoreLine();
            }
        });
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
            _weiqiBindings.handleMessage(msg);
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

        function handleContextMenu(e) {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        }
        canvas.addEventListener('contextmenu', handleContextMenu);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
            const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
            const x = (e.clientX - rect.left) * sc, y = (e.clientY - rect.top) * sc;
            const { row, col } = getClosestIntersection(x, y);
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
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
            if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
            if (ps.board[row][col] === 1 || ps.board[row][col] === 2) return;
            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); commitMove(row, col); drawBoard(); }
                else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                return;
            }
            commitMove(row, col);
        });

        function handleWheel(e) {
            if (!ps.editModeEnabled) return;
            e.preventDefault();
            const opts_ = ['empty', 'black', 'white', 'hole'];
            let i = opts_.indexOf(ps.editTool);
            i = (i + (e.deltaY < 0 ? 1 : -1) + opts_.length) % opts_.length;
            ps.editTool = opts_[i]; if (editToolSelect) editToolSelect.value = ps.editTool;
        }
        canvas.addEventListener('wheel', handleWheel, { passive: false });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
                const { row, col } = getClosestIntersection((e.clientX - rect.left) * sc, (e.clientY - rect.top) * sc);
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
                ps.iRejected = true; ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false })); hideScoreConfirm();
                if (ps.showEstimateActive) { ps.showEstimateActive = false; clearEstimate(); }
                ps.waitingScoreConfirm = false;
            };
        }
        connectWebSocket(handleMessage);
        })();
    }
};
