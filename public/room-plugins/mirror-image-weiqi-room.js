window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['mirror-image-weiqi'] = {
    shell: {
        "title": "镜像围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每手棋随机生成一个镜面。落子时，在落子点的镜像点也同时落下一子，除非该点已经有棋子。",
        "defaultKomiText": "黑贴白4.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "镜像围棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "镜像围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const C = QiSquareWeiqiCanvas, R = QiWeiqiSquarePageRuntime;
        var ps = {
            BOARD_SIZE: 19, KOMI: 4.25, PADDING: 0, CELL_SIZE: 0, numberOfHands: 1, currentPlayer: 1, mySlot: null, gameOver: false, winner: null,
            lastMoveMarkers: [], showEstimateActive: false, cachedLiveBoard: null, cachedTerritory: null, waitingScoreConfirm: false, iRejected: false,
            ws: null, isMyTurn: false, slots: { black: false, white: false }, reconnectTimer: null,
            replayMode: false, replayBoards: [], replayMarkers: [], replayStepPlayers: [], replayMirrorAxes: [], replayStep: 0, replayTotalSteps: 0,
            showMoveNumbers: false, moveLog: [],
            tryPlayMode: false, tryPlayBaseStep: 0, tryPlayBoards: [], tryPlayMarkers: [], tryPlayCurrentPlayer: 1, tryPlayMirrorAxis: 'diag1',
            tryPlayStepAxes: [], tryPlayStep: 0, tryPlayTotalSteps: 0,
            liveReplayBoards: [], liveReplayMarkers: [], liveReplayStepPlayers: [], liveReplayMirrorAxes: [], liveViewStep: 0, liveFollowLatest: true,
            mirrorAxis: 'diag1', serverMirrorAxis: 'diag1', matchStarted: false,
            userBoardMarks: Object.create(null), hoverRow: -1, hoverCol: -1, isHoverValid: false
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

        const dc = (b) => b.map(r => r.slice());
        const getMP = (r, c, ax) => {
            const L = ps.BOARD_SIZE - 1;
            if (ax === 'horizontal') return { row: L - r, col: c };
            if (ax === 'vertical') return { row: r, col: L - c };
            if (ax === 'diag1') return { row: c, col: r };
            if (ax === 'diag2') return { row: L - c, col: L - r };
            return { row: r, col: c };
        };
        const nextAxis = (hn) => (hn === 1 ? 'diag1' : hn === 2 ? 'diag2' : ['horizontal', 'vertical', 'diag1', 'diag2'][Math.floor(Math.random() * 4)]);
        const performCap = (brd, pv) => {
            let ch;
            do {
                ch = false;
                for (let i = 0; i < ps.BOARD_SIZE; i++) for (let j = 0; j < ps.BOARD_SIZE; j++) {
                    if (brd[i][j] === 3 - pv && R.countGroupLiberties(brd, i, j, ps.BOARD_SIZE) === 0) {
                        R.removeGroup(brd, i, j, 3 - pv, ps.BOARD_SIZE); ch = true;
                    }
                }
                for (let i = 0; i < ps.BOARD_SIZE; i++) for (let j = 0; j < ps.BOARD_SIZE; j++) {
                    if (brd[i][j] === pv && R.countGroupLiberties(brd, i, j, ps.BOARD_SIZE) === 0) {
                        R.removeGroup(brd, i, j, pv, ps.BOARD_SIZE); ch = true;
                    }
                }
            } while (ch);
        };
        const tryMirror = (bf, r, c, pv, ax) => {
            if (bf[r][c] !== 0) return null;
            const m = getMP(r, c, ax), nb = dc(bf);
            nb[r][c] = pv;
            if (!(m.row === r && m.col === c) && nb[m.row][m.col] === 0) nb[m.row][m.col] = pv;
            performCap(nb, pv);
            return nb;
        };
        function rebuildLive(mc) {
            const n = ps.BOARD_SIZE;
            ps.liveReplayBoards = []; ps.liveReplayMarkers = []; ps.liveReplayStepPlayers = [0]; ps.liveReplayMirrorAxes = [null];
            let cur = Array(n).fill().map(() => Array(n).fill(0));
            ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
            let curAx = 'diag1';
            for (const mv of (mc || [])) {
                const pv = mv.player === 'black' ? 1 : 2;
                ps.liveReplayStepPlayers.push(pv);
                if (mv.type === 'move') {
                    const ax = mv.mirrorAxis || curAx;
                    ps.liveReplayMirrorAxes.push(ax);
                    const nb = tryMirror(cur, mv.row, mv.col, pv, ax);
                    if (nb) cur = nb;
                    const mk = [{ row: mv.row, col: mv.col, color: pv }];
                    const mp = getMP(mv.row, mv.col, ax);
                    if (!(mp.row === mv.row && mp.col === mv.col) && cur[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push(mk);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                } else if (mv.type === 'pass') {
                    ps.liveReplayMirrorAxes.push(null);
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                }
            }
        }
        function applyLiveView() {
            if (!ps.liveReplayBoards.length) {
                ps.board = page.initBoardArray(ps.BOARD_SIZE); ps.lastMoveMarkers = []; ps.mirrorAxis = 'diag1'; return;
            }
            if (ps.liveViewStep < 0) ps.liveViewStep = 0;
            if (ps.liveViewStep >= ps.liveReplayBoards.length) ps.liveViewStep = ps.liveReplayBoards.length - 1;
            ps.board = dc(ps.liveReplayBoards[ps.liveViewStep]);
            ps.lastMoveMarkers = ps.liveReplayMarkers[ps.liveViewStep].map(m => ({ ...m }));
            // liveReplayMirrorAxes[step] 是该手「已使用」的轴；跟最新时要用服务端「下一手」轴
            const atLatest = ps.liveFollowLatest && ps.liveViewStep === ps.liveReplayBoards.length - 1;
            ps.mirrorAxis = atLatest ? (ps.serverMirrorAxis || ps.liveReplayMirrorAxes[ps.liveViewStep] || 'diag1')
                : ps.liveReplayMirrorAxes[ps.liveViewStep];
        }
        function numsMirror() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            const step = (i, mk, lim) => {
                if (!mk) return;
                for (const m of mk) {
                    if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i;
                }
            };
            if (ps.replayMode && ps.tryPlayMode) { for (let i = 1; i <= ps.tryPlayStep; i++) step(i, ps.tryPlayMarkers[i], 0); }
            else if (ps.replayMode) { for (let i = 1; i <= ps.replayStep; i++) step(i, ps.replayMarkers[i], 0); }
            else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) step(i, ps.liveReplayMarkers[i], 0);
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const e = ps.moveLog[i]; if (!e) continue;
                    for (const m of e) if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }
        /** 试下用分支下一手轴；否则用 ps.mirrorAxis（跟最新时已在 applyLiveView 换成服务端下一手轴） */
        function getCurrentMirrorAxis() {
            if (ps.tryPlayMode && ps.replayMode) return ps.tryPlayMirrorAxis;
            return ps.mirrorAxis;
        }
        function drawMirrorAxisLine() {
            if (ps.showEstimateActive) return;
            if (!ps.replayMode && !ps.matchStarted) return;
            const axis = getCurrentMirrorAxis();
            const last = ps.BOARD_SIZE - 1;
            if (!axis) return;
            let mirrorColor;
            if (ps.replayMode && !ps.tryPlayMode) {
                mirrorColor = ps.replayStepPlayers[ps.replayStep] || 1;
            } else if (!ps.replayMode && ps.liveReplayBoards.length > 0 && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                mirrorColor = ps.liveReplayStepPlayers[ps.liveViewStep] || 1;
            } else if (ps.tryPlayMode) {
                if (ps.tryPlayStep === 0) mirrorColor = ps.replayStepPlayers[ps.tryPlayBaseStep] || 1;
                else mirrorColor = 3 - ps.tryPlayCurrentPlayer;
            } else {
                mirrorColor = ps.currentPlayer;
            }
            const P = ps.PADDING, z = ps.CELL_SIZE, edge = C.DEFAULT_CANVAS_SIZE - P;
            ctx.save();
            ctx.lineWidth = 3;
            ctx.strokeStyle = mirrorColor === 1 ? '#000000' : '#ffffff';
            ctx.shadowBlur = 4;
            ctx.shadowColor = mirrorColor === 1 ? '#aaa' : '#333';
            ctx.shadowOffsetY = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            if (axis === 'horizontal') {
                const midY = P + (last / 2) * z;
                ctx.moveTo(P, midY); ctx.lineTo(edge, midY);
            } else if (axis === 'vertical') {
                const midX = P + (last / 2) * z;
                ctx.moveTo(midX, P); ctx.lineTo(midX, edge);
            } else if (axis === 'diag1') {
                ctx.moveTo(P, P); ctx.lineTo(edge, edge);
            } else if (axis === 'diag2') {
                ctx.moveTo(edge, P); ctx.lineTo(P, edge);
            } else {
                ctx.restore();
                return;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.restore();
        }
        function drawBoardMirror() {
            const d = C.draw, cs = C.DEFAULT_CANVAS_SIZE, z = ps.CELL_SIZE, low = ps.showMoveNumbers || ps.showEstimateActive;
            d.clear(ctx, cs); d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, z, cs); d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            drawMirrorAxisLine();
            const sr = z * 0.44, ml = z * 0.352;
            if (low) d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, z, sr);
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, sr, ps.showMoveNumbers);
            if (!low) d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, z, ml);
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, z, (r, c) =>
                !ps.showEstimateActive && r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE && ps.board[r][c] === 0);
            if (ps.showMoveNumbers) d.moveNumbersOnStones(ctx, numsMirror(), ps.board, ps.BOARD_SIZE, ps.PADDING, z);
            const hoverOpts = {
                tryPlayMode: ps.tryPlayMode, tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer, gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn, mySlot: ps.mySlot, isHoverValid: ps.isHoverValid
            };
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, z, hoverOpts);
            // 镜像点同步悬停（须用下一手镜面轴，否则白方会画到上一手轴的错误位置）
            const axis = getCurrentMirrorAxis();
            if (ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0 && axis) {
                const mp = getMP(ps.hoverRow, ps.hoverCol, axis);
                if (!(mp.row === ps.hoverRow && mp.col === ps.hoverCol))
                    d.hoverPreviewStone(ctx, mp.row, mp.col, ps.board, ps.PADDING, z, hoverOpts);
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory)
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, ps.cachedLiveBoard, ps.cachedTerritory);
        }

        var page;
        function mirrorSync(state) {
            page.clearMobileMovePreview();
            if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = state.boardSize;
                ps.KOMI = (state.komi != null && Number.isFinite(state.komi)) ? state.komi : (ps.BOARD_SIZE <= 8 ? 5.25 : 4.25);
                ps.board = page.initBoardArray(ps.BOARD_SIZE);
                page.updateBoardGeometry();
                const sel = document.getElementById('boardSizeSelect'); if (sel) sel.value = ps.BOARD_SIZE;
            }
            ps.numberOfHands = state.numberOfHands || 1; ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false; ps.winner = state.winner || null;
            if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
            ps.serverMirrorAxis = state.mirrorAxis || 'diag1';
            if (state.moveCoords) ps.moveLog = state.moveCoords.map(m => {
                if (m.type !== 'move') return null;
                const en = [{ row: m.row, col: m.col }];
                if (m.mirrorAxis) { const mp = getMP(m.row, m.col, m.mirrorAxis); if (!(mp.row === m.row && mp.col === m.col)) en.push({ row: mp.row, col: mp.col }); }
                return en;
            });
            if (state.slots) ps.slots = state.slots;
            if (!ps.replayMode) {
                const prevT = Math.max(0, ps.liveReplayBoards.length - 1), wasEnd = ps.liveFollowLatest || ps.liveViewStep >= prevT;
                rebuildLive(state.moveCoords || []);
                const newT = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newT === 0) { ps.liveViewStep = 0; ps.liveFollowLatest = true; }
                else if (wasEnd) { ps.liveViewStep = newT; ps.liveFollowLatest = true; }
                else { ps.liveViewStep = Math.min(ps.liveViewStep, newT); if (ps.liveViewStep === newT) ps.liveFollowLatest = true; }
                applyLiveView();
                if (ps.liveFollowLatest && ps.liveViewStep === newT) ps.mirrorAxis = ps.serverMirrorAxis;
                page.updateLiveReplayPanelUI();
            } else {
                ps.board = state.board; ps.lastMoveMarkers = state.lastMoveMarkers || []; ps.mirrorAxis = state.mirrorAxis || 'diag1';
            }
            const hasS = ps.board.some(row => row.some(v => v !== 0)), hasP = ps.slots.black || ps.slots.white;
            const sel = document.getElementById('boardSizeSelect');
            if (!hasS && !hasP && !ps.gameOver && ps.mySlot === null) sel.style.display = 'inline-block'; else sel.style.display = 'none';
            if (ps.showEstimateActive) { ps.cachedLiveBoard = page.removeDeadAndDying(ps.board); ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard); page.showEstimate(); }
            else page.updateTurn();
            page.updateReplayUI();
        }

        page = R.create(ps, domPage, {
            recordDownloadPrefix, minLib, maxWeakLiberties: 2, gameType, roomId, roomPassword, isMouseDevice,
            enableEditBoard: true,
            drawBoard: drawBoardMirror, syncState: mirrorSync,
            rebuildLiveReplayFromMoveCoords: rebuildLive, applyLiveViewBoard: applyLiveView,
            enterReplayMode(data) {
                const n = ps.BOARD_SIZE;
                ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = [0]; ps.replayMirrorAxes = [null];
                let cur = Array(n).fill().map(() => Array(n).fill(0));
                if (data.initialPosition) {
                    if (Array.isArray(data.initialPosition)) R.applyInitialPositionCompact(cur, n, data.initialPosition);
                    else {
                        for (const pos of data.initialPosition.black || []) if (Array.isArray(pos) && pos.length === 2) cur[pos[0]][pos[1]] = 1;
                        for (const pos of data.initialPosition.white || []) if (Array.isArray(pos) && pos.length === 2) cur[pos[0]][pos[1]] = 2;
                    }
                }
                ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
                let curAx = 'diag1';
                for (const mv of (data.moves || [])) {
                    const pv = mv.player === 'black' ? 1 : 2;
                    ps.replayStepPlayers.push(pv);
                    if (mv.type === 'move') {
                        const ax = mv.mirrorAxis || curAx;
                        ps.replayMirrorAxes.push(ax);
                        const nb = tryMirror(cur, mv.row, mv.col, pv, ax);
                        if (nb) cur = nb;
                        const mk = [{ row: mv.row, col: mv.col, color: pv }];
                        const mp = getMP(mv.row, mv.col, ax);
                        if (!(mp.row === mv.row && mp.col === mv.col) && cur[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                        ps.replayBoards.push(dc(cur)); ps.replayMarkers.push(mk);
                        curAx = nextAxis(ps.replayBoards.length);
                    } else if (mv.type === 'pass') {
                        ps.replayMirrorAxes.push(null); ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
                        curAx = nextAxis(ps.replayBoards.length);
                    }
                }
                ps.replayTotalSteps = ps.replayBoards.length - 1; ps.replayMode = true;
                document.getElementById('replaySlider').max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps); page.updateReplayUI();
            },
            exitReplayMode() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = []; ps.tryPlayStepAxes = []; ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                ps.replayMode = false; ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = []; ps.replayMirrorAxes = [];
                ps.replayStep = 0; ps.replayTotalSteps = 0;
                page.updateReplayUI();
            },
            setReplayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step; ps.board = dc(ps.replayBoards[step]); ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
                ps.mirrorAxis = ps.replayMirrorAxes[step];
                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;
                turnDisplay.innerText = step === 0 ? '初始局面' : `${ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪'} 第${step}手`;
                ps.isMyTurn = false;
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardMirror();
            },
            enterTryPlay() {
                page.clearMobileMovePreview(); ps.tryPlayMode = true; ps.tryPlayBaseStep = ps.replayStep;
                ps.tryPlayBoards = [dc(ps.board)]; ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];
                ps.tryPlayMirrorAxis = ps.mirrorAxis; ps.tryPlayStepAxes = [ps.replayMirrorAxes[ps.replayStep]];
                ps.tryPlayCurrentPlayer = ps.replayStep === 0 ? 1 : (ps.replayStepPlayers[ps.replayStep] === 1 ? 2 : 1);
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0; sl.max = 0; sl.value = 0;
                page.updateTryPlayDisplay(); page.updateReplayUI();
            },
            exitTryPlay() {
                page.clearMobileMovePreview(); ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = []; ps.tryPlayStepAxes = [];
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0; sl.max = ps.replayTotalSteps;
                page.setReplayStep(ps.tryPlayBaseStep); page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                if (ps.board[row][col] !== 0) return false;
                const pv = ps.tryPlayCurrentPlayer, nb = tryMirror(ps.board, row, col, pv, ps.tryPlayMirrorAxis);
                if (!nb) return false;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1; ps.tryPlayMarkers.length = ps.tryPlayStep + 1; ps.tryPlayStepAxes.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayStepAxes.push(ps.tryPlayMirrorAxis);
                const mk = [{ row, col, color: pv }], mp = getMP(row, col, ps.tryPlayMirrorAxis);
                if (!(mp.row === row && mp.col === col) && nb[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                ps.tryPlayBoards.push(dc(nb)); ps.tryPlayMarkers.push(mk);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1; ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.tryPlayMirrorAxis = nextAxis(ps.tryPlayBaseStep + ps.tryPlayStep + 1);
                ps.board = dc(nb); ps.lastMoveMarkers = mk.map(m => ({ ...m }));
                const sl = document.getElementById('replaySlider'); sl.max = ps.tryPlayTotalSteps; sl.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardMirror();
                return true;
            },
            setTryPlayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step; ps.board = dc(ps.tryPlayBoards[step]); ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));
                const baseP = ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]);
                ps.tryPlayCurrentPlayer = step % 2 === 0 ? baseP : (3 - baseP);
                ps.tryPlayMirrorAxis = nextAxis(ps.tryPlayBaseStep + step + 1);
                document.getElementById('replaySlider').value = step; page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardMirror();
            }
        });
        const _setLive = page.setLiveViewStep;
        page.setLiveViewStep = function (step) {
            _setLive(step);
            // applyLiveView 在跟最新时已写入 serverMirrorAxis；此处仅兜底
            const t = Math.max(0, ps.liveReplayBoards.length - 1);
            if (ps.liveFollowLatest && ps.liveViewStep === t)
                ps.mirrorAxis = ps.serverMirrorAxis || ps.mirrorAxis || 'diag1';
        };
        const {
            mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, updateTurn, showEstimate, clearEstimate, downloadRecord,
            showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI,
            enterTryPlay, exitTryPlay, tryPlayMove, setTryPlayStep, updateTryPlayDisplay, rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard, updateLiveReplayPanelUI, setLiveViewStep, connectWebSocket, initBoardArray, updateBoardGeometry,
            syncState, commitMove, getClosestIntersection, canvasCoordsFromClient, applyUserBoardMark
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
            showScoreConfirm, isMouseDevice, onNewGameStarted: () => { colorStatus.innerText = '未选择阵营'; },
            standardWeiqiMatchTime,
            boardSeatOverlay: true
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
        function clearLongMarkTouch() { if (longMarkTimer) { clearTimeout(longMarkTimer); longMarkTimer = null; } longMarkStart = null; }
        canvas.addEventListener('touchend', clearLongMarkTouch); canvas.addEventListener('touchcancel', clearLongMarkTouch);
        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
            const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
            const x = (e.clientX - rect.left) * sc, y = (e.clientY - rect.top) * sc;
            const { row, col } = getClosestIntersection(x, y);
            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                if (ps.board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); tryPlayMove(row, col); }
                    else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                    return;
                }
                tryPlayMove(row, col); return;
            }
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
            if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
            if (ps.board[row][col] !== 0) return;
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
                ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = row >= 0 && col >= 0 && ps.board[row][col] === 0; drawBoard();
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
