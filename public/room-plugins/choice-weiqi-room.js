window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["choice-weiqi"] = {
    shell: {
        "title": "选点围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每手棋只能落子在系统随机生成的候选点上。<br />",
        "defaultKomiText": "黑贴白2.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "选点围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "选点围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const C = QiSquareWeiqiCanvas, R = QiWeiqiSquarePageRuntime;
        var ps = {
            BOARD_SIZE: 9, KOMI: 2.25, PADDING: 0, CELL_SIZE: 0, numberOfHands: 1, currentPlayer: 1, mySlot: null, gameOver: false, winner: null,
            lastMoveMarkers: [], showEstimateActive: false, cachedLiveBoard: null, cachedTerritory: null, waitingScoreConfirm: false, iRejected: false,
            ws: null, isMyTurn: false, slots: { black: false, white: false }, reconnectTimer: null,
            replayMode: false, replayStep: 0, replayTotalSteps: 0, showMoveNumbers: false, moveLog: [],
            tryPlayMode: false, tryPlayBaseStep: 0, tryPlayBoards: [], tryPlayMarkers: [], tryPlayCurrentPlayer: 1, tryPlayStep: 0, tryPlayTotalSteps: 0,
            liveReplayBoards: [], liveReplayMarkers: [], liveReplayStepPlayers: [], liveViewStep: 0, liveFollowLatest: true,
            userBoardMarks: Object.create(null), hoverRow: -1, hoverCol: -1, isHoverValid: false,
            candidates: [], serverCandidatesSnapshot: [], replaySnapshots: [], replayMovesForNumbers: []
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
        C.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        C.initBoardMarkFoldDom(document.getElementById('boardMarkPanel'), document.getElementById('boardMarkFoldBtn'), document.getElementById('boardMarkExpandBtn'));
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const domPage = { turnDisplay, scoreTitle, scoreBoard, leadInfo, scoreConfirmPanel, scoreConfirmText, komiInfo, canvas, ctx, boardMarkSelect, colorStatus };

        function boardToString(brd) { return brd.map(row => row.join(',')).join(';'); }
        function normalizeChoiceRecordMove(entry) {
            if (entry && typeof entry === 'object' && entry.player != null) {
                const row = Number(entry.row), col = Number(entry.col);
                if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
                const cb = entry.candidatesBefore;
                if (!Array.isArray(cb) || cb.length < 1) return null;
                const candidatesBefore = [];
                for (const c of cb) {
                    if (!c) return null;
                    const cr = Number(c.row), cc = Number(c.col);
                    if (!Number.isFinite(cr) || !Number.isFinite(cc)) return null;
                    candidatesBefore.push({ row: cr, col: cc });
                }
                const pl = entry.player === 'black' || entry.player === 'white' ? entry.player : null;
                return pl ? { player: pl, row, col, candidatesBefore } : null;
            }
            if (typeof entry !== 'string') return null;
            const at = entry.indexOf('@');
            if (at === -1) return null;
            const head = entry.slice(0, at), tail = entry.slice(at + 1).trim();
            if (head.length < 3 || (head[0] !== 'B' && head[0] !== 'W')) return null;
            const comma = head.indexOf(',');
            if (comma <= 1) return null;
            const row = Number(head.slice(1, comma)), col = Number(head.slice(comma + 1));
            if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
            const player = head[0] === 'B' ? 'black' : 'white', candidatesBefore = [];
            for (const seg of tail.split(';')) {
                const s = seg.trim(); if (!s) continue;
                const parts = s.split(',');
                if (parts.length !== 2) return null;
                const r = Number(parts[0].trim()), c = Number(parts[1].trim());
                if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
                candidatesBefore.push({ row: r, col: c });
            }
            return candidatesBefore.length < 1 ? null : { player, row, col, candidatesBefore };
        }
        function parseChoiceWeiqiReplayMove(raw) {
            if (typeof raw === 'string') {
                if (raw.length >= 2 && raw[1] === 'p') return { type: 'pass', player: raw[0] === 'B' ? 'black' : 'white' };
                const m = normalizeChoiceRecordMove(raw);
                return m ? { type: 'move', ...m } : null;
            }
            if (raw && typeof raw === 'object') {
                if (raw.type === 'pass') return { type: 'pass', player: raw.player };
                if (raw.type === 'move' && raw.candidatesBefore && raw.row != null)
                    return { type: 'move', player: raw.player, row: raw.row, col: raw.col, candidatesBefore: raw.candidatesBefore };
                const m = normalizeChoiceRecordMove(raw);
                return m ? { type: 'move', ...m } : null;
            }
            return null;
        }
        function normalizeReplayInitialPayload(initialPosition) {
            if (!initialPosition) return [];
            if (Array.isArray(initialPosition)) return initialPosition;
            if (typeof initialPosition !== 'object') return [];
            const out = [];
            for (const pos of initialPosition.black || []) {
                if (Array.isArray(pos) && pos.length === 2) out.push(`B${pos[0]},${pos[1]}`);
            }
            for (const pos of initialPosition.white || []) {
                if (Array.isArray(pos) && pos.length === 2) out.push(`W${pos[0]},${pos[1]}`);
            }
            return out;
        }
        function buildChoiceWeiqiReplaySnapshotsFromMoves(data) {
            const moves = data.moves || [];
            let brd = page.initBoardArray(ps.BOARD_SIZE);
            if (data.initialPosition) {
                if (Array.isArray(data.initialPosition.black)) {
                    for (const pos of data.initialPosition.black) {
                        if (Array.isArray(pos) && pos.length === 2) {
                            const [r, c] = pos;
                            if (r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE) brd[r][c] = 1;
                        }
                    }
                }
                if (Array.isArray(data.initialPosition.white)) {
                    for (const pos of data.initialPosition.white) {
                        if (Array.isArray(pos) && pos.length === 2) {
                            const [r, c] = pos;
                            if (r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE) brd[r][c] = 2;
                        }
                    }
                }
            }
            const historySet = new Set(), snapshots = [];
            let lastMoveMarkers = [];
            snapshots.push({ board: page.deepCopyBoard(brd), currentPlayer: 1, candidates: [], lastMoveMarkers: [] });
            for (let i = 0; i < moves.length; i++) {
                const parsed = parseChoiceWeiqiReplayMove(moves[i]);
                if (!parsed) return null;
                const last = snapshots[snapshots.length - 1];
                if (parsed.type === 'pass') {
                    const pv = parsed.player === 'black' ? 1 : 2;
                    if (pv !== last.currentPlayer) return null;
                    snapshots.push({ board: page.deepCopyBoard(brd), currentPlayer: pv, candidates: [], lastMoveMarkers: lastMoveMarkers.map(m => ({ ...m })) });
                    lastMoveMarkers = [];
                    snapshots.push({ board: page.deepCopyBoard(brd), currentPlayer: 3 - pv, candidates: [], lastMoveMarkers: [] });
                    continue;
                }
                const m = parsed;
                const cb = (m.candidatesBefore || []).map(c => ({ row: c.row, col: c.col }));
                if (cb.length && !cb.some(c => c.row === m.row && c.col === m.col)) return null;
                const playerVal = m.player === 'black' ? 1 : 2;
                if (playerVal !== last.currentPlayer) return null;
                snapshots.push({
                    board: page.deepCopyBoard(brd), currentPlayer: playerVal,
                    candidates: cb.map(c => ({ ...c })), lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x }))
                });
                const newBoard = page.tryPlaceStone(brd, m.row, m.col, playerVal);
                if (!newBoard) return null;
                const ns = boardToString(newBoard);
                if (historySet.has(ns)) return null;
                historySet.add(ns);
                brd = newBoard;
                lastMoveMarkers = [{ row: m.row, col: m.col, color: playerVal }];
                snapshots.push({
                    board: page.deepCopyBoard(brd), currentPlayer: 3 - playerVal, candidates: [],
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x }))
                });
            }
            return snapshots;
        }

        function numsChoice() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers?.[0] && ps.board[markers[0].row][markers[0].col] !== 0) nums[markers[0].row][markers[0].col] = i;
                }
            } else if (ps.replayMode) {
                let hand = 0;
                for (const raw of ps.replayMovesForNumbers) {
                    if (typeof raw === 'string' && raw.length >= 2 && raw[1] === 'p') continue;
                    if (raw?.type === 'pass') continue;
                    const m = normalizeChoiceRecordMove(raw);
                    if (!m || !Number.isFinite(m.row)) continue;
                    hand++;
                    if (ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = hand;
                }
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) {
                    const markers = ps.liveReplayMarkers[i];
                    if (markers?.[0] && ps.board[markers[0].row][markers[0].col] !== 0) nums[markers[0].row][markers[0].col] = i;
                }
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }
        function drawBoardChoice() {
            const d = C.draw, cs = C.DEFAULT_CANVAS_SIZE, z = ps.CELL_SIZE, low = ps.showMoveNumbers || ps.showEstimateActive;
            d.clear(ctx, cs); d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, z, cs); d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            const sr = z * 0.44, ml = z * 0.352;
            if (low) d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, z, sr);
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, sr, ps.showMoveNumbers);
            if (!low) d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, z, ml);
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, z, (r, c) =>
                !ps.showEstimateActive && r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE && ps.board[r][c] === 0
                && (ps.tryPlayMode || ps.gameOver || !ps.candidates.length || !ps.candidates.some(p => p.row === r && p.col === c)));
            if (ps.showMoveNumbers) d.moveNumbersOnStones(ctx, numsChoice(), ps.board, ps.BOARD_SIZE, ps.PADDING, z);
            {
                const liveTotalRp = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
                const browsingLive = !ps.replayMode && ps.liveReplayBoards.length > 0 && ps.liveViewStep < liveTotalRp;
                const showCand = !ps.tryPlayMode && !ps.gameOver && !ps.showEstimateActive && ps.candidates.length > 0 && !browsingLive;
                if (showCand) {
                    ctx.globalAlpha = 0.7;
                    const playerColor = ps.currentPlayer === 1 ? '#222' : '#fff', sh = z * 0.18;
                    for (const { row, col } of ps.candidates) {
                        const x = ps.PADDING + col * z, y = ps.PADDING + row * z;
                        ctx.fillStyle = playerColor;
                        ctx.fillRect(x - sh, y - sh, sh * 2, sh * 2);
                    }
                    ctx.globalAlpha = 1;
                }
            }
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, z, {
                tryPlayMode: ps.tryPlayMode, tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer, gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn, mySlot: ps.mySlot, isHoverValid: ps.isHoverValid,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool
            });
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory)
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, ps.cachedLiveBoard, ps.cachedTerritory);
        }

        function choiceSync(state) {
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
                ps.KOMI = state.komi;
                if (komiInfo) komiInfo.innerText = `黑贴白${ps.KOMI}点`;
            }
            ps.numberOfHands = incomingNH;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = incomingGO;
            ps.winner = state.winner || null;
            if (state.matchStarted !== undefined) {
                ps.matchStarted = !!state.matchStarted;
                if (ps.matchStarted) ps.matchStartedOnce = true;
            }
            if (state.moveCoords) {
                ps.moveLog = state.moveCoords.map(m => (m.type === 'move') ? { row: m.row, col: m.col } : null);
            }
            ps.candidates = (state.candidates || []).map(c => ({ row: c.row, col: c.col }));
            ps.serverCandidatesSnapshot = ps.candidates.map(c => ({ row: c.row, col: c.col }));
            if (state.slots) ps.slots = state.slots;
            if (!ps.replayMode) {
                const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                // 有手数时绝不能拿 state.board（终局盘）当 opening，否则回放错乱并导致候选点被清掉
                const openingForReplay = (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.pickRichestBoard)
                    ? QiWeiqiSquarePageRuntime.pickRichestBoard(
                        state.initialBoard,
                        ps.liveOpeningBoard,
                        (!(state.moveCoords && state.moveCoords.length) ? state.board : null)
                    )
                    : (state.initialBoard || ps.liveOpeningBoard || null);
                page.rebuildLiveReplayFromMoveCoords(state.moveCoords || [], openingForReplay);
                const newTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newTotal === 0) { ps.liveViewStep = 0; ps.liveFollowLatest = true; }
                else if (wasAtEnd) { ps.liveViewStep = newTotal; ps.liveFollowLatest = true; }
                else {
                    ps.liveViewStep = Math.min(ps.liveViewStep, newTotal);
                    if (ps.liveViewStep === newTotal) ps.liveFollowLatest = true;
                }
                page.applyLiveViewBoard();
                page.updateLiveReplayPanelUI();
                const liveTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                if (liveTotal > 0 && ps.liveViewStep < liveTotal) {
                    ps.candidates = [];
                } else {
                    // 当前手数（含尚无一手）：必须显示服务器本回合候选点
                    if (state.board) ps.board = page.deepCopyBoard(state.board);
                    if (state.lastMoveMarkers) ps.lastMoveMarkers = state.lastMoveMarkers.map(m => ({ ...m }));
                    ps.candidates = ps.serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }));
                }
            } else {
                ps.board = state.board;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }
            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            const sizeSel = document.getElementById('boardSizeSelect');
            if (sizeSel) {
                if (!hasAnyStone && !hasPlayer && !ps.gameOver && ps.mySlot === null) sizeSel.style.display = 'inline-block';
                else sizeSel.style.display = 'none';
            }
            if (ps.showEstimateActive) {
                ps.cachedLiveBoard = page.removeDeadAndDying(ps.board);
                ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard);
                page.showEstimate();
            } else page.updateTurn();
            page.updateReplayUI();
            ps._syncMoveCoordsLen = incomingMoveLen;
        }

        var page;
        page = R.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix, minLib, maxWeakLiberties: 2, gameType, roomId, roomPassword, isMouseDevice,
            drawBoard: drawBoardChoice, syncState: choiceSync,
            enterReplayMode(data) {
                if (data.initialPosition && typeof data.initialPosition === 'object' && !Array.isArray(data.initialPosition))
                    data.initialPosition = normalizeReplayInitialPayload(data.initialPosition);
                if (data.boardSize && data.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = data.boardSize;
                    page.updateBoardGeometry();
                    const sel = document.getElementById('boardSizeSelect'); if (sel) sel.value = ps.BOARD_SIZE;
                }
                ps.replayMovesForNumbers = (data.moves || []).slice();
                const snapshots = buildChoiceWeiqiReplaySnapshotsFromMoves(data);
                if (!snapshots) {
                    qiAlert('棋谱数据无法重建打谱步序（请确认含候选点的选点围棋棋谱）。');
                    ps.replayMovesForNumbers = [];
                    return;
                }
                ps.replaySnapshots = snapshots;
                ps.replayTotalSteps = ps.replaySnapshots.length - 1;
                ps.replayMode = true;
                const sl = document.getElementById('replaySlider');
                sl.min = 0; sl.max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps);
                page.updateReplayUI();
            },
            exitReplayMode() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = []; ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                ps.replayMode = false; ps.replaySnapshots = []; ps.replayMovesForNumbers = []; ps.replayStep = 0; ps.replayTotalSteps = 0;
                page.updateReplayUI();
            },
            setReplayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                const snap = ps.replaySnapshots[step];
                ps.board = page.deepCopyBoard(snap.board);
                ps.currentPlayer = snap.currentPlayer;
                ps.candidates = (snap.candidates || []).map(c => ({ row: c.row, col: c.col }));
                ps.lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;
                turnDisplay.innerText = step === 0 ? '初始局面' : `打谱 ${step} / ${ps.replayTotalSteps}`;
                ps.isMyTurn = false;
                if (ps.showEstimateActive) page.showEstimate();
                else drawBoardChoice();
            },
            enterTryPlay() {
                page.clearMobileMovePreview(); ps.tryPlayMode = true; ps.tryPlayBaseStep = ps.replayStep;
                ps.tryPlayBoards = [page.deepCopyBoard(ps.board)]; ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];
                ps.tryPlayCurrentPlayer = ps.replaySnapshots[ps.replayStep].currentPlayer;
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0; sl.max = 0; sl.value = 0;
                page.updateTryPlayDisplay(); page.updateReplayUI();
            },
            exitTryPlay() {
                page.clearMobileMovePreview(); ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = [];
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0; sl.max = ps.replayTotalSteps;
                page.setReplayStep(ps.tryPlayBaseStep); page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                if (ps.board[row][col] !== 0) return false;
                const pv = ps.tryPlayCurrentPlayer, nb = page.tryPlaceStone(ps.board, row, col, pv);
                if (!nb) return false;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1; ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayBoards.push(page.deepCopyBoard(nb)); ps.tryPlayMarkers.push([{ row, col, color: pv }]);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1; ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.board = page.deepCopyBoard(nb); ps.lastMoveMarkers = [{ row, col, color: pv }];
                const sl = document.getElementById('replaySlider'); sl.max = ps.tryPlayTotalSteps; sl.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardChoice();
                return true;
            },
            setTryPlayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                ps.board = page.deepCopyBoard(ps.tryPlayBoards[step]);
                ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));
                const snapPlayer = ps.replaySnapshots[ps.tryPlayBaseStep].currentPlayer;
                ps.tryPlayCurrentPlayer = step % 2 === 0 ? snapPlayer : (3 - snapPlayer);
                document.getElementById('replaySlider').value = step; page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardChoice();
            },
            updateTryPlayDisplay() {
                const stepDisplay = document.getElementById('replayStepDisplay');
                if (ps.tryPlayMode) {
                    stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                    turnDisplay.innerText = `${ps.tryPlayCurrentPlayer === 1 ? '⚫' : '⚪'} 试下`;
                }
            }
        });

        const setLiveViewStep = function (step) {
            page.clearMobileMovePreview();
            if (ps.replayMode) return;
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            if (step < 0) step = 0; if (step > total) step = total;
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= total;
            page.applyLiveViewBoard();
            page.updateLiveReplayPanelUI();
            if (total > 0 && step < total) ps.candidates = [];
            else ps.candidates = ps.serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }));
            if (ps.showEstimateActive) page.showEstimate();
            else page.updateTurn();
        };

        const {
            mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, updateTurn, showEstimate, clearEstimate, downloadRecord,
            showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI,
            enterTryPlay, exitTryPlay, tryPlayMove, setTryPlayStep, updateTryPlayDisplay, rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard, updateLiveReplayPanelUI, connectWebSocket, initBoardArray, updateBoardGeometry,
            syncState, commitMove: commitMoveBase, getClosestIntersection, canvasCoordsFromClient, applyUserBoardMark
        } = page;

        function commitMove(row, col) {
            if (ps.candidates.length > 0 && !ps.candidates.some(c => c.row === row && c.col === col)) return false;
            return commitMoveBase(row, col);
        }

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
            boardSeatOverlay: true, onNewGameStarted: () => { colorStatus.innerText = '未选择阵营'; }
        });
        (function wrapReplayNewGame() {
            const b = document.getElementById('newGameBtn'); if (!b) return;
            const p = b.onclick;
            b.onclick = () => { if (ps.replayMode) { if (ps.ws && ps.ws.readyState === WebSocket.OPEN) ps.ws.send(JSON.stringify({ type: 'resetRoom' })); return; } if (typeof p === 'function') p(); };
        })();
        const handleMessage = _weiqiBindings.handleMessage;

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
        function clearLongMarkTouch() {
            if (longMarkTimer) { clearTimeout(longMarkTimer); longMarkTimer = null; }
            longMarkStart = null;
        }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                if (ps.board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); tryPlayMove(row, col); }
                    else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (ps.waitingScoreConfirm) return;
            if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
            if (ps.board[row][col] !== 0) return;
            if (ps.candidates.length > 0 && !ps.candidates.some(c => c.row === row && c.col === col)) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return;
            }
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
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                const onCand = ps.candidates.length === 0 || ps.candidates.some(c => c.row === row && c.col === col);
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0 && onCand);
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
