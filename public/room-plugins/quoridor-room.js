window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["quoridor"] = {
    shell: {
        "title": "路墙棋",
        "rulesHtml": "基本规则同路墙棋。<br />",
        "defaultKomiText": "　",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "路墙棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "transparentCanvas": true,
            "quoridorBags": true,
            "customTimeControl": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "路墙棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
(function () {
            const Q = (function () {
                const GRID = 9;
                const WALLS_EACH = 10;

                function qKey(r, c) {
                    return r + ',' + c;
                }

                function parseKey(k) {
                    const i = k.indexOf(',');
                    return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
                }
            
            function buildBlockedEdges(h, v) {
                const ns = new Set();
                const ew = new Set();
                const hList = h instanceof Set ? Array.from(h) : h;
                const vList = v instanceof Set ? Array.from(v) : v;
                for (const k of hList) {
                    const [r, c] = parseKey(k);
                    ns.add(qKey(r, c));
                    ns.add(qKey(r, c + 1));
                }
                for (const k of vList) {
                    const [r, c] = parseKey(k);
                    ew.add(qKey(r, c));
                    ew.add(qKey(r + 1, c));
                }
                return { ns, ew };
            }
            
            function canCross(pr, pc, nr, nc, ns, ew) {
                if (nr === pr + 1 && nc === pc) return !ns.has(qKey(pr, pc));
                if (nr === pr - 1 && nc === pc) return !ns.has(qKey(nr, nc));
                if (nc === pc + 1 && nr === pr) return !ew.has(qKey(pr, pc));
                if (nc === pc - 1 && nr === pr) return !ew.has(qKey(pr, nc));
                return false;
            }
            
            function canPlaceHorizontalWall(ns, ew, r, c) {
                if (r < 0 || r > 7 || c < 0 || c > 7) return false;
                if (ns.has(qKey(r, c)) || ns.has(qKey(r, c + 1))) return false;
                return true;
            }
            
            function canPlaceVerticalWall(ns, ew, r, c) {
                if (r < 0 || r > 7 || c < 0 || c > 7) return false;
                if (ew.has(qKey(r, c)) || ew.has(qKey(r + 1, c))) return false;
                return true;
            }
            
            function wallsHSet(state) {
                if (state.wallsH instanceof Set) return state.wallsH;
                return new Set(state.wallsH || []);
            }
            
            function wallsVSet(state) {
                if (state.wallsV instanceof Set) return state.wallsV;
                return new Set(state.wallsV || []);
            }
            
            function hasPathToGoal(br, bc, goalRow, wallsH, wallsV) {
                const { ns, ew } = buildBlockedEdges(wallsH, wallsV);
                const vis = new Set();
                const q = [[br, bc]];
                vis.add(qKey(br, bc));
                while (q.length) {
                    const [r, c] = q.shift();
                    if (r === goalRow) return true;
                    const neigh = [
                        [r - 1, c],
                        [r + 1, c],
                        [r, c - 1],
                        [r, c + 1]
                    ];
                    for (const [nr, nc] of neigh) {
                        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
                        if (vis.has(qKey(nr, nc))) continue;
                        if (!canCross(r, c, nr, nc, ns, ew)) continue;
                        vis.add(qKey(nr, nc));
                        q.push([nr, nc]);
                    }
                }
                return false;
            }
            
            function wallPlacementLegal(state, orient, r, c) {
                if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 7 || c < 0 || c > 7) return false;
                const wh = wallsHSet(state);
                const wv = wallsVSet(state);
                const { ns, ew } = buildBlockedEdges(wh, wv);
                if (orient === 'h') {
                    if (!canPlaceHorizontalWall(ns, ew, r, c)) return false;
                } else {
                    if (!canPlaceVerticalWall(ns, ew, r, c)) return false;
                }
                const nextH = new Set(wh);
                const nextV = new Set(wv);
                if (orient === 'h') nextH.add(qKey(r, c));
                else nextV.add(qKey(r, c));
                if (!hasPathToGoal(state.blackRow, state.blackCol, GRID - 1, nextH, nextV)) return false;
                if (!hasPathToGoal(state.whiteRow, state.whiteCol, 0, nextH, nextV)) return false;
                return true;
            }
            
            function pawnPos(state, slot) {
                return slot === 'black'
                    ? [state.blackRow, state.blackCol]
                    : [state.whiteRow, state.whiteCol];
            }
            
            function otherSlot(slot) {
                return slot === 'black' ? 'white' : 'black';
            }
            
            function getLegalPawnMoves(state, playerSlot) {
                const { ns, ew } = buildBlockedEdges(wallsHSet(state), wallsVSet(state));
                const [pr, pc] = pawnPos(state, playerSlot);
                const [or, oc] = pawnPos(state, otherSlot(playerSlot));
                const out = [];
                const seen = new Set();
                const dirs = [
                    [-1, 0],
                    [1, 0],
                    [0, -1],
                    [0, 1]
                ];
                for (const [dr, dc] of dirs) {
                    const nr = pr + dr;
                    const nc = pc + dc;
                    if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
                    if (!canCross(pr, pc, nr, nc, ns, ew)) continue;
                    if (nr !== or || nc !== oc) {
                        const k = qKey(nr, nc);
                        if (!seen.has(k)) {
                            seen.add(k);
                            out.push([nr, nc]);
                        }
                        continue;
                    }
                    const jr = pr + 2 * dr;
                    const jc = pc + 2 * dc;
                    const inB = jr >= 0 && jr < GRID && jc >= 0 && jc < GRID;
                    const straightJump =
                        inB &&
                        !(jr === or && jc === oc) &&
                        !(jr === pr && jc === pc) &&
                        canCross(or, oc, jr, jc, ns, ew);
                    if (straightJump) {
                        const k = qKey(jr, jc);
                        if (!seen.has(k)) {
                            seen.add(k);
                            out.push([jr, jc]);
                        }
                    } else {
                        const perps = [
                            [-dc, dr],
                            [dc, -dr]
                        ];
                        for (const [pdr, pdc] of perps) {
                            const sr = or + pdr;
                            const sc = oc + pdc;
                            if (sr < 0 || sr >= GRID || sc < 0 || sc >= GRID) continue;
                            if (!canCross(or, oc, sr, sc, ns, ew)) continue;
                            if (sr === pr && sc === pc) continue;
                            if (sr === or && sc === oc) continue;
                            const k = qKey(sr, sc);
                            if (!seen.has(k)) {
                                seen.add(k);
                                out.push([sr, sc]);
                            }
                        }
                    }
                }
                return out;
            }
            
            function isLegalPawnMove(state, playerSlot, tr, tc) {
                const leg = getLegalPawnMoves(state, playerSlot);
                return leg.some(([r, c]) => r === tr && c === tc);
            }
            
            function initialState() {
                return {
                    blackRow: 0,
                    blackCol: 4,
                    whiteRow: 8,
                    whiteCol: 4,
                    wallsH: new Set(),
                    wallsV: new Set(),
                    wallsBlackLeft: WALLS_EACH,
                    wallsWhiteLeft: WALLS_EACH,
                    currentPlayer: 2,
                    gameOver: false,
                    winner: null,
                    lastMoveMarkers: []
                };
            }
            
            function cloneState(s) {
                return {
                    blackRow: s.blackRow,
                    blackCol: s.blackCol,
                    whiteRow: s.whiteRow,
                    whiteCol: s.whiteCol,
                    wallsH: new Set(wallsHSet(s)),
                    wallsV: new Set(wallsVSet(s)),
                    wallsBlackLeft: s.wallsBlackLeft,
                    wallsWhiteLeft: s.wallsWhiteLeft,
                    currentPlayer: s.currentPlayer,
                    gameOver: s.gameOver,
                    winner: s.winner,
                    lastMoveMarkers: (s.lastMoveMarkers || []).map((m) => ({ ...m }))
                };
            }
            
            function applyPawnMove(state, slot, tr, tc) {
                if (slot === 'black') {
                    state.blackRow = tr;
                    state.blackCol = tc;
                } else {
                    state.whiteRow = tr;
                    state.whiteCol = tc;
                }
                state.lastMoveMarkers = [{ row: tr, col: tc, color: slot === 'black' ? 1 : 2 }];
                if (slot === 'black' && tr === GRID - 1) {
                    state.gameOver = true;
                    state.winner = 'black';
                } else if (slot === 'white' && tr === 0) {
                    state.gameOver = true;
                    state.winner = 'white';
                }
                if (!state.gameOver) state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
            }
            
            function applyWall(state, slot, orient, r, c) {
                if (!state.wallsH || !(state.wallsH instanceof Set)) state.wallsH = new Set(state.wallsH || []);
                if (!state.wallsV || !(state.wallsV instanceof Set)) state.wallsV = new Set(state.wallsV || []);
                if (orient === 'h') state.wallsH.add(qKey(r, c));
                else state.wallsV.add(qKey(r, c));
                if (slot === 'black') state.wallsBlackLeft--;
                else state.wallsWhiteLeft--;
                state.lastMoveMarkers = [{ row: r, col: c, color: orient === 'h' ? 3 : 4, orient }];
                state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
            }
                return {
                    N: GRID,
                    WALLS_EACH,
                    key: qKey,
                    buildBlockedEdges,
                    canCross,
                    hasPathToGoal,
                    wallPlacementLegal,
                    getLegalPawnMoves,
                    isLegalPawnMove,
                    initialState,
                    cloneState,
                    applyPawnMove,
                    applyWall,
                    wallsHSet,
                    wallsVSet,
                    pawnPos,
                    otherSlot
                };
            })();

const N = Q.N;
            const WMAX = Q.WALLS_EACH;
            const CELL = 50;
            const GAP = 12;
            const MARGIN = Math.floor((600 - (N * CELL + (N - 1) * GAP)) / 2);
            const CELL_FILL = '#fdcc90';
            /** 沟槽底色与交叉处小叉的颜色 */
            const GROOVE_LINE = '#a08058';
            /** 棋盘最外一圈方框的颜色（仅描边，与 GROOVE_LINE 可分开调） */
            const OUTER_FRAME_LINE = '#3a281c';
            const WALL_FILL = '#2a1a10';

            function cellOrigin(c) { return MARGIN + c * (CELL + GAP); }
            function cellOriginY(r) { return MARGIN + r * (CELL + GAP); }
            function boardOuterRect() {
                const x0 = cellOrigin(0);
                const y0 = cellOriginY(0);
                const w = N * CELL + (N - 1) * GAP;
                const h = w;
                return { x0, y0, w, h };
            }

            function drawJunctionCrosses() {
                ctx.strokeStyle = GROOVE_LINE;
                ctx.lineWidth = 1;
                ctx.lineCap = 'square';
                for (let r = 0; r < N - 1; r++) {
                    for (let c = 0; c < N - 1; c++) {
                        const jx = cellOrigin(c) + CELL;
                        const jy = cellOriginY(r) + CELL;
                        ctx.beginPath();
                        ctx.moveTo(jx, jy);
                        ctx.lineTo(jx + GAP, jy + GAP);
                        ctx.moveTo(jx + GAP, jy);
                        ctx.lineTo(jx, jy + GAP);
                        ctx.stroke();
                    }
                }
            }

            function fillHexWallH(r, c, fillStyle) {
                const xL = cellOrigin(c);
                const w = 2 * CELL + GAP;
                const jy = cellOriginY(r) + CELL;
                const ymid = jy + GAP / 2;
                const cap = GAP / 2;
                ctx.fillStyle = fillStyle;
                ctx.beginPath();
                ctx.moveTo(xL - cap, ymid);
                ctx.lineTo(xL, jy);
                ctx.lineTo(xL, jy + GAP);
                ctx.closePath();
                ctx.fill();
                ctx.fillRect(xL, jy, w, GAP);
                ctx.beginPath();
                ctx.moveTo(xL + w, jy);
                ctx.lineTo(xL + w + cap, ymid);
                ctx.lineTo(xL + w, jy + GAP);
                ctx.closePath();
                ctx.fill();
            }

            function fillHexWallV(r, c, fillStyle) {
                const jx = cellOrigin(c) + CELL;
                const yT = cellOriginY(r);
                const h = 2 * CELL + GAP;
                const xmid = jx + GAP / 2;
                const cap = GAP / 2;
                ctx.fillStyle = fillStyle;
                /* 分三次填充，避免单路径闭合在重叠顶点处被当成五边形或非零绕组异常 */
                ctx.beginPath();
                ctx.moveTo(xmid, yT - cap);
                ctx.lineTo(jx, yT);
                ctx.lineTo(jx + GAP, yT);
                ctx.closePath();
                ctx.fill();
                ctx.fillRect(jx, yT, GAP, h);
                ctx.beginPath();
                ctx.moveTo(jx, yT + h);
                ctx.lineTo(jx + GAP, yT + h);
                ctx.lineTo(xmid, yT + h + cap);
                ctx.closePath();
                ctx.fill();
            }

            const ps = {
                ws: null,
                reconnectTimer: null,
                mySlot: null,
                slots: { black: false, white: false },
                currentPlayer: 2,
                gameOver: false,
                winner: null,
                blackRow: 0, blackCol: 4, whiteRow: 8, whiteCol: 4,
                wallsH: new Set(),
                wallsV: new Set(),
                wallsBlackLeft: WMAX,
                wallsWhiteLeft: WMAX,
                moveLog: [],
                replayMode: false,
                replaySnapshots: [],
                replayStep: 0,
                replayTotalSteps: 0,
                tryPlayMode: false,
                tryPlayFromLive: false,
                tryPlayBaseStep: 0,
                tryPlaySnapshots: [],
                tryPlayStep: 0,
                tryPlayTotalSteps: 0,
                liveState: null,
                selectPawn: false,
                selectWall: false,
                hoverCellR: -1,
                hoverCellC: -1,
                hoverWall: null,
                hoverWallValid: false,
                hoverPawnDest: null,
                hoverPawnValid: false,
                mobilePendingPawn: null,
                mobilePendingWall: null,
                numberOfHands: 1,
                matchStarted: false,
                matchStartedOnce: false,
                matchTime: null
            };

            const canvas = document.getElementById('goBoard');
            const ctx = canvas.getContext('2d');
            const turnDisplay = document.getElementById('turnDisplay');
            const colorStatus = document.getElementById('colorStatus');
const scoreBoard = document.getElementById('scoreBoard');
            const leadInfo = document.getElementById('leadInfo');
            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            function engineStateFromPs() {
                return {
                    blackRow: ps.blackRow,
                    blackCol: ps.blackCol,
                    whiteRow: ps.whiteRow,
                    whiteCol: ps.whiteCol,
                    wallsH: ps.wallsH,
                    wallsV: ps.wallsV,
                    wallsBlackLeft: ps.wallsBlackLeft,
                    wallsWhiteLeft: ps.wallsWhiteLeft,
                    currentPlayer: ps.currentPlayer,
                    gameOver: ps.gameOver,
                    winner: ps.winner,
                    lastMoveMarkers: []
                };
            }

            function engineSnapshotFromPs() {
                return {
                    blackRow: ps.blackRow,
                    blackCol: ps.blackCol,
                    whiteRow: ps.whiteRow,
                    whiteCol: ps.whiteCol,
                    wallsH: ps.wallsH,
                    wallsV: ps.wallsV,
                    wallsBlackLeft: ps.wallsBlackLeft,
                    wallsWhiteLeft: ps.wallsWhiteLeft,
                    currentPlayer: ps.currentPlayer,
                    gameOver: ps.gameOver,
                    winner: ps.winner,
                    lastMoveMarkers: ps.lastMoveMarkers || []
                };
            }

            function tryPlayToMoveSlot() {
                return ps.currentPlayer === 2 ? 'white' : 'black';
            }

            function boardInteractionActive() {
                if (ps.tryPlayMode) return !ps.gameOver;
                return !ps.replayMode && isMyTurn();
            }

            function isMyTurn() {
                if (ps.gameOver || ps.replayMode) return false;
                if (!ps.matchStarted) return false;
                if (!ps.mySlot) return false;
                if (ps.mySlot === 'white' && ps.currentPlayer === 2) return true;
                if (ps.mySlot === 'black' && ps.currentPlayer === 1) return true;
                return false;
            }

            function currentSlot() {
                return ps.currentPlayer === 2 ? 'white' : 'black';
            }

            function updateTurn() {
                updateActionButtons();
                if (ps.tryPlayMode) {
                    updateTryPlayDisplay();
                    return;
                }
                if (ps.replayMode) {
                    const step = ps.replayStep;
                    if (step === 0) {
                        turnDisplay.textContent = '初始局面';
                    } else {
                        const m = ps.moveLog[step - 1];
                        const emoji =
                            m && m.player === 'white' ? '⚪' : '⚫';
                        turnDisplay.textContent = `${emoji} 第${step}手`;
                    }
                    return;
                }
                const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
                if (ps.matchStarted) ps.matchStartedOnce = true;
                if (bothSelected && ps.matchTime && ps.matchTime.settings) ps.matchStartedOnce = true;
                if ((ps.moveLog && ps.moveLog.length > 0)) ps.matchStartedOnce = true;
                if (!ps.matchStarted) {
                    turnDisplay.textContent = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                    if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
                    return;
                }
                const n = ps.moveLog ? ps.moveLog.length : 0;
                if (n === 0) {
                    turnDisplay.textContent = '初始局面';
                    if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
                    return;
                }
                const m = ps.moveLog[n - 1];
                const emoji = m && m.player === 'white' ? '⚪' : '⚫';
                turnDisplay.textContent = `${emoji} 第${n}手`;
                if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
            }

            function updateActionButtons() {
                const showMatchButtons = !!ps.mySlot
                    && !!(ps.matchStarted || ps.matchStartedOnce || (ps.matchTime && ps.matchTime.settings))
                    && !ps.replayMode;
                ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = showMatchButtons ? '' : 'none';
                });
                const tryPlayBtn = document.getElementById('tryPlayBtn');
                if (tryPlayBtn) {
                    tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
                    tryPlayBtn.textContent = ps.tryPlayMode ? '试下结束' : '试下';
                }
            }

            function updateScore() {
                if (ps.gameOver) {
                    if (ps.winner === 'black') leadInfo.textContent = '黑胜';
                    else if (ps.winner === 'white') leadInfo.textContent = '白胜';
                    else if (ps.winner === 'draw') leadInfo.textContent = '和棋';
                    else leadInfo.textContent = '　';
                }
            }

            function isEmptyOpening() {
                if (ps.moveLog && ps.moveLog.length > 0) return false;
                if (ps.wallsH.size > 0 || ps.wallsV.size > 0) return false;
                if (ps.blackRow !== 0 || ps.blackCol !== 4 || ps.whiteRow !== 8 || ps.whiteCol !== 4) return false;
                return true;
            }

            function updateRecordButtons() {
                const importBtn = document.getElementById('importBtn');
                const exportBtn = document.getElementById('exportBtn');
                if (!importBtn || !exportBtn) return;
                if (ps.replayMode) {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = 'none';
                } else {
                    const noPlayers = !ps.slots.black && !ps.slots.white;
                    if (noPlayers && isEmptyOpening()) {
                        importBtn.style.display = '';
                        exportBtn.style.display = 'none';
                    } else {
                        importBtn.style.display = 'none';
                        exportBtn.style.display = '';
                    }
                }
            }

            const _seatOverlay = QiBoardRoomClient.createWeiqiMessageBindings({
                pageState: ps,
                boardSeatOverlay: true,
                seatOverlayOnly: true,
                standardWeiqiMatchTime,
                getWs: () => ps.ws,
                getBoardSize: () => N,
                getSlots: () => ps.slots,
                setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot,
                setMySlot: (s) => { ps.mySlot = s; },
                getTimeControlDefaults: (boardSize) => {
                    const n = Number.isFinite(boardSize) && boardSize > 0 ? boardSize : N;
                    const points = n * n;
                    return {
                        mainMinutes: Math.ceil(0.83 * points),
                        byoyomiSeconds: Math.ceil(0.24 * Math.pow(points, 0.75)),
                        maxTimeouts: Math.ceil(0.6 * Math.pow(points, 0.25))
                    };
                },
                updateTurn: () => { if (typeof updateTurn === 'function') updateTurn(); },
                updateReplayUI: () => { if (typeof updateReplayDisplay === 'function') updateReplayDisplay(); },
                colorStatus});

            function updateRadioStyles() {
                _seatOverlay.updateRadioStyles();
                updateRecordButtons();
            }

            function clearSelection() {
                ps.selectPawn = false;
                ps.selectWall = false;
                ps.mobilePendingPawn = null;
                ps.mobilePendingWall = null;
                document.querySelectorAll('.qd-wall-slot').forEach((el) => el.classList.remove('active'));
            }

            function wallSlotsRefresh() {
                const bw = document.getElementById('blackWallsRow');
                const ww = document.getElementById('whiteWallsRow');
                bw.innerHTML = '';
                ww.innerHTML = '';
                for (let i = 0; i < WMAX; i++) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'qd-wall-slot';
                    b.innerHTML = '<span class="qd-wall-shape-v qd-b"></span>';
                    b.disabled = i >= ps.wallsBlackLeft;
                    b.dataset.side = 'black';
                    b.onclick = () => onWallSlotClick('black', b);
                    bw.appendChild(b);
                }
                for (let i = 0; i < WMAX; i++) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'qd-wall-slot';
                    b.innerHTML = '<span class="qd-wall-shape-v qd-w"></span>';
                    b.disabled = i >= ps.wallsWhiteLeft;
                    b.dataset.side = 'white';
                    b.onclick = () => onWallSlotClick('white', b);
                    ww.appendChild(b);
                }
            }

            function onWallSlotClick(side, btn) {
                if ((ps.replayMode && !ps.tryPlayMode) || ps.gameOver) return;
                if (ps.tryPlayMode) {
                    if (side !== tryPlayToMoveSlot()) return;
                } else if (!isMyTurn() || side !== ps.mySlot) return;
                if (btn.disabled) return;
                if (ps.selectWall && btn.classList.contains('active')) {
                    clearSelection();
                    drawBoard();
                    return;
                }
                clearSelection();
                ps.selectWall = true;
                btn.classList.add('active');
                drawBoard();
            }

            function clientToBoard(clientX, clientY) {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                return {
                    x: (clientX - rect.left) * scale,
                    y: (clientY - rect.top) * scale
                };
            }

            function hitCell(x, y) {
                for (let r = 0; r < N; r++) {
                    for (let c = 0; c < N; c++) {
                        const x0 = cellOrigin(c);
                        const y0 = cellOriginY(r);
                        if (x >= x0 && x < x0 + CELL && y >= y0 && y < y0 + CELL)
                            return { r, c };
                    }
                }
                return null;
            }

            /** 点到轴对齐矩形（含内部）的最近距离平方 */
            function distSqPointToRect(x, y, xmin, ymin, xmax, ymax) {
                const cx = Math.min(Math.max(x, xmin), xmax);
                const cy = Math.min(Math.max(y, ymin), ymax);
                const dx = x - cx;
                const dy = y - cy;
                return dx * dx + dy * dy;
            }

            /**
             * 用与绘制一致的沟槽矩形判定最近墙位。
             * h(r,c) 与 v(r,c) 的中心点重合，原先按欧氏距离 + 先遍历水平会导致竖墙永远选不中。
             */
            function nearestWallPlacement(x, y) {
                const slots = [];
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const xL = cellOrigin(c);
                        const jy = cellOriginY(r) + CELL;
                        const xminH = xL;
                        const xmaxH = xL + 2 * CELL + GAP;
                        const yminH = jy;
                        const ymaxH = jy + GAP;
                        const dH = distSqPointToRect(x, y, xminH, yminH, xmaxH, ymaxH);
                        slots.push({
                            orient: 'h',
                            r,
                            c,
                            d2: dH,
                            cx: xL + CELL + GAP / 2,
                            cy: jy + GAP / 2
                        });
                    }
                }
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const jx = cellOrigin(c) + CELL;
                        const yT = cellOriginY(r);
                        const cap = GAP / 2;
                        const hBody = 2 * CELL + GAP;
                        const xminV = jx;
                        const xmaxV = jx + GAP;
                        const yminV = yT - cap;
                        const ymaxV = yT + hBody + cap;
                        const dV = distSqPointToRect(x, y, xminV, yminV, xmaxV, ymaxV);
                        slots.push({
                            orient: 'v',
                            r,
                            c,
                            d2: dV,
                            cx: jx + GAP / 2,
                            cy: yT + CELL + GAP / 2
                        });
                    }
                }
                let bestD = 1e9;
                for (const s of slots) {
                    if (s.d2 < bestD) bestD = s.d2;
                }
                if (bestD > 55 * 55) return null;
                const EPS = 4;
                const near = slots.filter((s) => s.d2 <= bestD + EPS);
                const vNear = near.filter((s) => s.orient === 'v');
                const hNear = near.filter((s) => s.orient === 'h');
                const bestV = vNear.length ? vNear.reduce((a, b) => (a.d2 <= b.d2 ? a : b)) : null;
                const bestH = hNear.length ? hNear.reduce((a, b) => (a.d2 <= b.d2 ? a : b)) : null;
                if (bestV && !bestH) return { orient: 'v', r: bestV.r, c: bestV.c, cx: bestV.cx, cy: bestV.cy };
                if (bestH && !bestV) return { orient: 'h', r: bestH.r, c: bestH.c, cx: bestH.cx, cy: bestH.cy };
                if (bestV && bestH) {
                    if (bestV.d2 + 1e-6 < bestH.d2) return { orient: 'v', r: bestV.r, c: bestV.c, cx: bestV.cx, cy: bestV.cy };
                    if (bestH.d2 + 1e-6 < bestV.d2) return { orient: 'h', r: bestH.r, c: bestH.c, cx: bestH.cx, cy: bestH.cy };
                    const vx = bestV.cx;
                    const hy = bestH.cy;
                    const dxV = Math.abs(x - vx);
                    const dyH = Math.abs(y - hy);
                    if (dxV < dyH) return { orient: 'v', r: bestV.r, c: bestV.c, cx: bestV.cx, cy: bestV.cy };
                    if (dyH < dxV) return { orient: 'h', r: bestH.r, c: bestH.c, cx: bestH.cx, cy: bestH.cy };
                    return { orient: 'v', r: bestV.r, c: bestV.c, cx: bestV.cx, cy: bestV.cy };
                }
                return null;
            }

            function updateHoverFromClient(clientX, clientY) {
                const { x, y } = clientToBoard(clientX, clientY);
                ps.hoverCellR = -1;
                ps.hoverCellC = -1;
                ps.hoverWall = null;
                ps.hoverWallValid = false;
                ps.hoverPawnDest = null;
                ps.hoverPawnValid = false;
                const cell = hitCell(x, y);
                if (cell) {
                    ps.hoverCellR = cell.r;
                    ps.hoverCellC = cell.c;
                }
                if (ps.selectWall && boardInteractionActive()) {
                    const w = nearestWallPlacement(x, y);
                    ps.hoverWall = w;
                    if (w) {
                        const st = engineStateFromPs();
                        ps.hoverWallValid = Q.wallPlacementLegal(st, w.orient, w.r, w.c);
                    }
                } else if (ps.selectPawn && boardInteractionActive() && cell) {
                    const st = engineStateFromPs();
                    const leg = Q.getLegalPawnMoves(st, ps.mySlot);
                    ps.hoverPawnDest = cell;
                    ps.hoverPawnValid = leg.some(([rr, cc]) => rr === cell.r && cc === cell.c);
                }
            }

            function drawBoard() {
                ctx.clearRect(0, 0, 600, 600);
                ctx.fillStyle = CELL_FILL;
                ctx.fillRect(0, 0, 600, 600);

                const outer = boardOuterRect();
                ctx.fillStyle = GROOVE_LINE;
                ctx.fillRect(outer.x0, outer.y0, outer.w, outer.h);

                for (let r = 0; r < N; r++) {
                    for (let c = 0; c < N; c++) {
                        const x0 = cellOrigin(c);
                        const y0 = cellOriginY(r);
                        ctx.fillStyle = CELL_FILL;
                        ctx.fillRect(x0, y0, CELL, CELL);
                    }
                }

                drawJunctionCrosses();

                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                for (let c = 0; c < N; c++) {
                    ctx.fillRect(cellOrigin(c), cellOriginY(0), CELL, CELL);
                }
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                for (let c = 0; c < N; c++) {
                    ctx.fillRect(cellOrigin(c), cellOriginY(N - 1), CELL, CELL);
                }

                ctx.save();
                ctx.beginPath();
                ctx.rect(outer.x0, outer.y0, outer.w, outer.h);
                ctx.clip();
                for (const k of ps.wallsH) {
                    const [r, c] = k.split(',').map(Number);
                    fillHexWallH(r, c, WALL_FILL);
                }
                for (const k of ps.wallsV) {
                    const [r, c] = k.split(',').map(Number);
                    fillHexWallV(r, c, WALL_FILL);
                }
                if (ps.selectWall && ps.hoverWall && boardInteractionActive()) {
                    const w = ps.hoverWall;
                    ctx.save();
                    ctx.globalAlpha = ps.hoverWallValid ? 0.55 : 0.35;
                    const col = ps.hoverWallValid ? 'rgba(80,160,255,0.92)' : 'rgba(255,80,80,0.82)';
                    if (w.orient === 'h') {
                        fillHexWallH(w.r, w.c, col);
                    } else {
                        fillHexWallV(w.r, w.c, col);
                    }
                    ctx.restore();
                }
                ctx.restore();

                ctx.strokeStyle = OUTER_FRAME_LINE;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(outer.x0 + 1.25, outer.y0 + 1.25, outer.w - 2.5, outer.h - 2.5);

                function drawPawn(rr, cc, black) {
                    const cx = cellOrigin(cc) + CELL / 2;
                    const cy = cellOriginY(rr) + CELL / 2;
                    const rad = CELL * 0.38;
                    const grd = ctx.createRadialGradient(cx - rad * 0.25, cy - rad * 0.25, rad * 0.1, cx, cy, rad);
                    if (black) {
                        grd.addColorStop(0, '#666');
                        grd.addColorStop(0.55, '#111');
                        grd.addColorStop(1, '#000');
                    } else {
                        grd.addColorStop(0, '#fff');
                        grd.addColorStop(0.55, '#e8e8e8');
                        grd.addColorStop(1, '#bbb');
                    }
                    ctx.fillStyle = grd;
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    ctx.fill();
                }

                drawPawn(ps.blackRow, ps.blackCol, true);
                drawPawn(ps.whiteRow, ps.whiteCol, false);

                if (ps.selectPawn && boardInteractionActive()) {
                    const moveSlot = ps.tryPlayMode ? tryPlayToMoveSlot() : ps.mySlot;
                    if (moveSlot === 'black' || moveSlot === 'white') {
                        const selRow = moveSlot === 'black' ? ps.blackRow : ps.whiteRow;
                        const selCol = moveSlot === 'black' ? ps.blackCol : ps.whiteCol;
                        const selCx = cellOrigin(selCol) + CELL / 2;
                        const selCy = cellOriginY(selRow) + CELL / 2;
                        const selColor = moveSlot === 'black' ? '#ff9900' : '#0099ff';
                        ctx.save();
                        ctx.strokeStyle = selColor;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(selCx, selCy, CELL * 0.4, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.restore();
                    }
                }

                if (ps.selectPawn && ps.hoverPawnDest && boardInteractionActive() && isMouseDevice) {
                    const { r, c } = ps.hoverPawnDest;
                    const cx = cellOrigin(c) + CELL / 2;
                    const cy = cellOriginY(r) + CELL / 2;
                    const rad = CELL * 0.38;
                    const moveSlot = ps.tryPlayMode ? tryPlayToMoveSlot() : ps.mySlot;
                    ctx.save();
                    ctx.globalAlpha = ps.hoverPawnValid ? 0.45 : 0.28;
                    ctx.fillStyle = moveSlot === 'black'
                        ? (ps.hoverPawnValid ? 'rgba(0,0,0,0.5)' : 'rgba(200,0,0,0.35)')
                        : (ps.hoverPawnValid ? 'rgba(255,255,255,0.65)' : 'rgba(200,0,0,0.35)');
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }

            function syncFromState(state) {
                if (ps.tryPlayMode) exitTryPlay();
                ps.currentPlayer = state.currentPlayer != null ? state.currentPlayer : 1;
                ps.gameOver = !!state.gameOver;
                ps.winner = state.winner || null;
                if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
                if (state.matchTime !== undefined) {
                    ps.matchTime = state.matchTime;
                    if (_seatOverlay.matchTimeCtl)
                        _seatOverlay.matchTimeCtl.applyMatchTimeFromState(state);
                }
                ps.blackRow = state.blackRow;
                ps.blackCol = state.blackCol;
                ps.whiteRow = state.whiteRow;
                ps.whiteCol = state.whiteCol;
                ps.wallsH = new Set(state.wallsH || []);
                ps.wallsV = new Set(state.wallsV || []);
                ps.wallsBlackLeft = state.wallsBlackLeft != null ? state.wallsBlackLeft : WMAX;
                ps.wallsWhiteLeft = state.wallsWhiteLeft != null ? state.wallsWhiteLeft : WMAX;
                ps.numberOfHands = state.numberOfHands || 1;
                if (state.slots) {
                    ps.slots.black = !!state.slots.black;
                    ps.slots.white = !!state.slots.white;
                }
                if (state.moveCoords) {
                    ps.moveLog = state.moveCoords.slice();
                } else if (state.moveHistory) {
                    ps.moveLog = state.moveHistory.slice();
                } else {
                    ps.moveLog = [];
                }
                ps.liveState = {
                    blackRow: ps.blackRow,
                    blackCol: ps.blackCol,
                    whiteRow: ps.whiteRow,
                    whiteCol: ps.whiteCol,
                    wallsH: Array.from(ps.wallsH),
                    wallsV: Array.from(ps.wallsV),
                    wallsBlackLeft: ps.wallsBlackLeft,
                    wallsWhiteLeft: ps.wallsWhiteLeft,
                    currentPlayer: ps.currentPlayer,
                    gameOver: ps.gameOver,
                    winner: ps.winner
                };
                wallSlotsRefresh();
                if (ps.replayMode) {
                    const oldTotal = ps.replayTotalSteps;
                    ps.replaySnapshots = buildReplaySnapshots();
                    ps.replayTotalSteps = Math.max(0, ps.replaySnapshots.length - 1);
                    if (ps.replayStep > ps.replayTotalSteps) ps.replayStep = ps.replayTotalSteps;
                    else if (ps.replayStep === oldTotal && ps.replayTotalSteps >= oldTotal) ps.replayStep = ps.replayTotalSteps;
                    const slider = document.getElementById('replaySlider');
                    slider.max = ps.replayTotalSteps;
                    slider.value = ps.replayStep;
                    applyReplayStep();
                    updateReplayDisplay();
                } else {
                    const slider = document.getElementById('replaySlider');
                    const total = ps.moveLog.length;
                    ps.replayTotalSteps = total;
                    slider.max = total;
                    slider.value = total;
                    document.getElementById('replayStepDisplay').textContent = `${total} / ${total}`;
                    updateTurn();
                    updateScore();
                    drawBoard();
                }
                updateRecordButtons();
            }

            function buildReplaySnapshots() {
                const snaps = [];
                let s = Q.initialState();
                snaps.push(Q.cloneState(s));
                for (const m of ps.moveLog) {
                    if (m.type === 'move' || m.kind === 'pawn') {
                        const slot = m.player || (m.type === 'move' ? m.player : null);
                        const row = m.row;
                        const col = m.col;
                        Q.applyPawnMove(s, slot, row, col);
                    } else if (m.type === 'wall' || m.kind === 'wall') {
                        const slot = m.player;
                        const orient = m.orient;
                        const r = m.r;
                        const c = m.c;
                        Q.applyWall(s, slot, orient, r, c);
                    }
                    snaps.push(Q.cloneState(s));
                }
                return snaps;
            }

            function enterReplayMode() {
                if (ps.tryPlayMode) exitTryPlay();
                const snaps = buildReplaySnapshots();
                if (snaps.length < 2) return;
                ps.replaySnapshots = snaps;
                ps.replayTotalSteps = snaps.length - 1;
                ps.replayMode = true;
                ps.replayStep = ps.replayTotalSteps;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                slider.value = ps.replayStep;
                applyReplayStep();
                updateReplayDisplay();
                updateRecordButtons();
            }

            function exitReplayMode() {
                if (ps.tryPlayMode) {
                    exitTryPlay();
                    return;
                }
                ps.replayMode = false;
                ps.replaySnapshots = [];
                if (ps.liveState) {
                    ps.blackRow = ps.liveState.blackRow;
                    ps.blackCol = ps.liveState.blackCol;
                    ps.whiteRow = ps.liveState.whiteRow;
                    ps.whiteCol = ps.liveState.whiteCol;
                    ps.wallsH = new Set(ps.liveState.wallsH);
                    ps.wallsV = new Set(ps.liveState.wallsV);
                    ps.wallsBlackLeft = ps.liveState.wallsBlackLeft;
                    ps.wallsWhiteLeft = ps.liveState.wallsWhiteLeft;
                    ps.currentPlayer = ps.liveState.currentPlayer;
                    ps.gameOver = ps.liveState.gameOver;
                    ps.winner = ps.liveState.winner;
                }
                const total = ps.moveLog.length;
                ps.replayStep = total;
                ps.replayTotalSteps = total;
                document.getElementById('replaySlider').max = total;
                document.getElementById('replaySlider').value = total;
                document.getElementById('replayStepDisplay').textContent = `${total} / ${total}`;
                wallSlotsRefresh();
                updateTurn();
                updateScore();
                drawBoard();
                updateRecordButtons();
            }

            function applyReplayStep() {
                const s = ps.replaySnapshots[ps.replayStep];
                if (!s) return;
                ps.blackRow = s.blackRow;
                ps.blackCol = s.blackCol;
                ps.whiteRow = s.whiteRow;
                ps.whiteCol = s.whiteCol;
                ps.wallsH = new Set(s.wallsH);
                ps.wallsV = new Set(s.wallsV);
                ps.wallsBlackLeft = s.wallsBlackLeft;
                ps.wallsWhiteLeft = s.wallsWhiteLeft;
                ps.currentPlayer = s.currentPlayer;
                ps.gameOver = s.gameOver;
                ps.winner = s.winner;
                updateTurn();
                updateScore();
                wallSlotsRefresh();
                drawBoard();
            }

            function updateReplayDisplay() {
                document.getElementById('replayStepDisplay').textContent =
                    ps.replayStep + ' / ' + ps.replayTotalSteps;
            }

            function setReplayStep(step) {
                if (ps.tryPlayMode) return;
                const total = ps.moveLog.length;
                if (total <= 0) return;
                if (!ps.replayMode) {
                    if (step >= total) return;
                    enterReplayMode();
                }
                if (!ps.replayMode) return;
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                if (step === ps.replayTotalSteps && ps.replayTotalSteps > 0) {
                    exitReplayMode();
                    return;
                }
                ps.replayStep = step;
                document.getElementById('replaySlider').value = ps.replayStep;
                applyReplayStep();
                updateReplayDisplay();
            }

            function updateTryPlayDisplay() {
                const stepDisplay = document.getElementById('replayStepDisplay');
                stepDisplay.textContent = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                const emoji = ps.currentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.textContent = `${emoji} 试下`;
            }

            function applyTryPlaySnapshotToPs(step) {
                const s = ps.tryPlaySnapshots[step];
                if (!s) return;
                ps.blackRow = s.blackRow;
                ps.blackCol = s.blackCol;
                ps.whiteRow = s.whiteRow;
                ps.whiteCol = s.whiteCol;
                ps.wallsH = new Set(s.wallsH);
                ps.wallsV = new Set(s.wallsV);
                ps.wallsBlackLeft = s.wallsBlackLeft;
                ps.wallsWhiteLeft = s.wallsWhiteLeft;
                ps.currentPlayer = s.currentPlayer;
                ps.gameOver = s.gameOver;
                ps.winner = s.winner;
                wallSlotsRefresh();
                updateScore();
                updateTryPlayDisplay();
                drawBoard();
            }

            function setTryPlayStep(step) {
                if (!ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                applyTryPlaySnapshotToPs(step);
                const slider = document.getElementById('replaySlider');
                slider.value = String(ps.tryPlayStep);
                slider.max = ps.tryPlayTotalSteps;
            }

            function tryPlayTryPawn(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                const st = Q.cloneState(ps.tryPlaySnapshots[ps.tryPlayStep]);
                const slot = st.currentPlayer === 1 ? 'black' : 'white';
                if (!Q.isLegalPawnMove(st, slot, row, col)) return false;
                Q.applyPawnMove(st, slot, row, col);
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
                ps.tryPlaySnapshots.push(st);
                ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                applyTryPlaySnapshotToPs(ps.tryPlayStep);
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                clearSelection();
                return true;
            }

            function tryPlayTryWall(orient, r, c) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                const st = Q.cloneState(ps.tryPlaySnapshots[ps.tryPlayStep]);
                const slot = st.currentPlayer === 1 ? 'black' : 'white';
                if (slot === 'black' && st.wallsBlackLeft <= 0) return false;
                if (slot === 'white' && st.wallsWhiteLeft <= 0) return false;
                if (!Q.wallPlacementLegal(st, orient, r, c)) return false;
                Q.applyWall(st, slot, orient, r, c);
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
                ps.tryPlaySnapshots.push(st);
                ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                applyTryPlaySnapshotToPs(ps.tryPlayStep);
                const slider = document.getElementById('replaySlider');
                slider.max = ps.tryPlayTotalSteps;
                slider.value = ps.tryPlayStep;
                clearSelection();
                return true;
            }

            function enterTryPlay() {
                clearSelection();
                if (!ps.replayMode) {
                    ps.tryPlayFromLive = true;
                    ps.replayMode = true;
                    ps.replaySnapshots = [Q.cloneState(engineSnapshotFromPs())];
                    ps.replayStep = 0;
                    ps.replayTotalSteps = 0;
                } else {
                    ps.tryPlayFromLive = false;
                }
                ps.tryPlayMode = true;
                ps.tryPlayBaseStep = ps.replayStep;
                ps.tryPlaySnapshots = [Q.cloneState(ps.replaySnapshots[ps.replayStep])];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                applyTryPlaySnapshotToPs(0);
                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
                updateActionButtons();
            }

            function exitTryPlay() {
                const base = ps.tryPlayBaseStep;
                const fromLive = ps.tryPlayFromLive;
                clearSelection();
                ps.tryPlayMode = false;
                ps.tryPlaySnapshots = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                ps.tryPlayFromLive = false;
                const slider = document.getElementById('replaySlider');
                if (fromLive) {
                    ps.replayMode = false;
                    ps.replaySnapshots = [];
                    ps.replayStep = 0;
                    ps.replayTotalSteps = 0;
                    if (ps.liveState) {
                        ps.blackRow = ps.liveState.blackRow;
                        ps.blackCol = ps.liveState.blackCol;
                        ps.whiteRow = ps.liveState.whiteRow;
                        ps.whiteCol = ps.liveState.whiteCol;
                        ps.wallsH = new Set(ps.liveState.wallsH);
                        ps.wallsV = new Set(ps.liveState.wallsV);
                        ps.wallsBlackLeft = ps.liveState.wallsBlackLeft;
                        ps.wallsWhiteLeft = ps.liveState.wallsWhiteLeft;
                        ps.currentPlayer = ps.liveState.currentPlayer;
                        ps.gameOver = ps.liveState.gameOver;
                        ps.winner = ps.liveState.winner;
                    }
                    const total = ps.moveLog.length;
                    slider.max = total;
                    slider.value = total;
                    document.getElementById('replayStepDisplay').textContent = `${total} / ${total}`;
                } else {
                    ps.replaySnapshots = buildReplaySnapshots();
                    ps.replayTotalSteps = Math.max(0, ps.replaySnapshots.length - 1);
                    ps.replayStep = Math.min(base, ps.replayTotalSteps);
                    if (ps.replayTotalSteps > 0 && ps.replayStep >= ps.replayTotalSteps) {
                        ps.replayMode = false;
                        ps.replaySnapshots = [];
                        if (ps.liveState) {
                            ps.blackRow = ps.liveState.blackRow;
                            ps.blackCol = ps.liveState.blackCol;
                            ps.whiteRow = ps.liveState.whiteRow;
                            ps.whiteCol = ps.liveState.whiteCol;
                            ps.wallsH = new Set(ps.liveState.wallsH);
                            ps.wallsV = new Set(ps.liveState.wallsV);
                            ps.wallsBlackLeft = ps.liveState.wallsBlackLeft;
                            ps.wallsWhiteLeft = ps.liveState.wallsWhiteLeft;
                            ps.currentPlayer = ps.liveState.currentPlayer;
                            ps.gameOver = ps.liveState.gameOver;
                            ps.winner = ps.liveState.winner;
                        }
                        const t2 = ps.moveLog.length;
                        ps.replayStep = t2;
                        ps.replayTotalSteps = t2;
                        slider.max = t2;
                        slider.value = t2;
                        document.getElementById('replayStepDisplay').textContent = `${t2} / ${t2}`;
                    } else {
                        ps.replayMode = ps.replayTotalSteps > 0;
                        slider.max = ps.replayTotalSteps;
                        slider.value = ps.replayStep;
                        applyReplayStep();
                        updateReplayDisplay();
                    }
                }
                wallSlotsRefresh();
                updateTurn();
                updateScore();
                drawBoard();
                updateActionButtons();
                updateRecordButtons();
            }

            function trySendPawn(row, col) {
                if (!isMyTurn()) return;
                const st = engineStateFromPs();
                if (!Q.isLegalPawnMove(st, ps.mySlot, row, col)) return;
                ps.ws && ps.ws.readyState === 1 && ps.ws.send(JSON.stringify({ type: 'quoridorPawn', row, col }));
                clearSelection();
            }

            function trySendWall(orient, r, c) {
                if (!isMyTurn()) return;
                if (ps.mySlot === 'black' && ps.wallsBlackLeft <= 0) return;
                if (ps.mySlot === 'white' && ps.wallsWhiteLeft <= 0) return;
                const st = engineStateFromPs();
                if (!Q.wallPlacementLegal(st, orient, r, c)) return;
                ps.ws && ps.ws.readyState === 1 && ps.ws.send(JSON.stringify({ type: 'quoridorWall', orient, r, c }));
                clearSelection();
            }

            function handleCanvasClick(clientX, clientY) {
                if (ps.tryPlayMode) {
                    const { x, y } = clientToBoard(clientX, clientY);
                    if (ps.gameOver) return;
                    const cell = hitCell(x, y);
                    if (cell && ps.blackRow === cell.r && ps.blackCol === cell.c && tryPlayToMoveSlot() === 'black') {
                        ps.selectPawn = true;
                        ps.selectWall = false;
                        ps.mobilePendingWall = null;
                        document.querySelectorAll('.qd-wall-slot').forEach((el) => el.classList.remove('active'));
                        return;
                    }
                    if (cell && ps.whiteRow === cell.r && ps.whiteCol === cell.c && tryPlayToMoveSlot() === 'white') {
                        ps.selectPawn = true;
                        ps.selectWall = false;
                        ps.mobilePendingWall = null;
                        document.querySelectorAll('.qd-wall-slot').forEach((el) => el.classList.remove('active'));
                        return;
                    }
                    if (ps.selectWall) {
                        const w = nearestWallPlacement(x, y);
                        if (!w) return;
                        if (!isMouseDevice) {
                            if (ps.mobilePendingWall &&
                                ps.mobilePendingWall.r === w.r &&
                                ps.mobilePendingWall.c === w.c &&
                                ps.mobilePendingWall.orient === w.orient) {
                                const st = engineStateFromPs();
                                if (Q.wallPlacementLegal(st, w.orient, w.r, w.c))
                                    tryPlayTryWall(w.orient, w.r, w.c);
                                ps.mobilePendingWall = null;
                            } else {
                                ps.mobilePendingWall = { orient: w.orient, r: w.r, c: w.c };
                                ps.hoverWall = w;
                                ps.hoverWallValid = Q.wallPlacementLegal(engineStateFromPs(), w.orient, w.r, w.c);
                                drawBoard();
                            }
                        } else {
                            tryPlayTryWall(w.orient, w.r, w.c);
                        }
                        return;
                    }
                    if (ps.selectPawn && cell) {
                        tryPlayTryPawn(cell.r, cell.c);
                    }
                    return;
                }
                if (ps.replayMode) return;
                const { x, y } = clientToBoard(clientX, clientY);
                if (ps.gameOver || !isMyTurn()) return;

                const cell = hitCell(x, y);
                if (cell && ps.blackRow === cell.r && ps.blackCol === cell.c && ps.mySlot === 'black') {
                    ps.selectPawn = true;
                    ps.selectWall = false;
                    ps.mobilePendingWall = null;
                    document.querySelectorAll('.qd-wall-slot').forEach((el) => el.classList.remove('active'));
                    return;
                }
                if (cell && ps.whiteRow === cell.r && ps.whiteCol === cell.c && ps.mySlot === 'white') {
                    ps.selectPawn = true;
                    ps.selectWall = false;
                    ps.mobilePendingWall = null;
                    document.querySelectorAll('.qd-wall-slot').forEach((el) => el.classList.remove('active'));
                    return;
                }

                if (ps.selectWall) {
                    const w = nearestWallPlacement(x, y);
                    if (!w) return;
                    if (!isMouseDevice) {
                        if (ps.mobilePendingWall &&
                            ps.mobilePendingWall.r === w.r &&
                            ps.mobilePendingWall.c === w.c &&
                            ps.mobilePendingWall.orient === w.orient) {
                            const st = engineStateFromPs();
                            if (Q.wallPlacementLegal(st, w.orient, w.r, w.c))
                                trySendWall(w.orient, w.r, w.c);
                            ps.mobilePendingWall = null;
                        } else {
                            ps.mobilePendingWall = { orient: w.orient, r: w.r, c: w.c };
                            ps.hoverWall = w;
                            ps.hoverWallValid = Q.wallPlacementLegal(engineStateFromPs(), w.orient, w.r, w.c);
                            drawBoard();
                        }
                    } else {
                        trySendWall(w.orient, w.r, w.c);
                    }
                    return;
                }

                if (ps.selectPawn && cell) {
                    if (!isMouseDevice) {
                        trySendPawn(cell.r, cell.c);
                        ps.mobilePendingPawn = null;
                    } else {
                        trySendPawn(cell.r, cell.c);
                    }
                }
            }

            function handleMessage(msg) {
                _seatOverlay.handleSeatOverlayMessage(msg);
                switch (msg.type) {
                    case 'joined':
                        sessionStorage.removeItem('roomPassword_' + roomId);
                        if (msg.role === 'player') {
                            ps.mySlot = msg.slot;
                            if (msg.state) syncFromState(msg.state);
                        } else {
                            ps.mySlot = null;
                            if (msg.state) syncFromState(msg.state);
                        }
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        break;
                    case 'slotOccupied':
                        if (msg.slot === 'black') ps.slots.black = true;
                        else if (msg.slot === 'white') ps.slots.white = true;
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'slotReleased':
                        if (msg.slot === 'black') ps.slots.black = false;
                        else if (msg.slot === 'white') ps.slots.white = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                        }
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'playerLeft':
                        if (msg.slot === 'black') ps.slots.black = false;
                        else if (msg.slot === 'white') ps.slots.white = false;
                        if (ps.mySlot === msg.slot) ps.mySlot = null;
                        if (msg.matchStarted || ps.matchStarted)
                            ps.seatOverlayLocalHide = false;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'colorAssigned':
                        ps.mySlot = msg.color;
                        if (msg.color === 'black') ps.slots.black = true;
                        else ps.slots.white = true;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'colorsFinalized':
                        if (msg.slots) ps.slots = { black: !!msg.slots.black, white: !!msg.slots.white };
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'gameState':
                        syncFromState(msg);
                        updateRadioStyles();
                        break;
                    case 'timeControlNegotiation':
                    case 'timeControlWaitPeer':
                    case 'timeControlAgreed':
                    case 'timeControlReset':
                    case 'clockUpdate':
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.handleMessage(msg);
                        if (msg.type === 'timeControlAgreed') {
                            if (msg.slots) ps.slots = { black: !!msg.slots.black, white: !!msg.slots.white };
                            updateRadioStyles();
                        }
                        break;
                    case 'broadcast':
                        if (msg.action === 'move' || msg.action === 'undoAccept' || msg.action === 'resign' || msg.action === 'drawAgreed' || msg.action === 'timeLoss') {
                            const wasOver = ps.gameOver;
                            syncFromState(msg);
                            if (msg.gameOver && !wasOver) {
                                if (msg.action === 'timeLoss') {
                                    const loser = msg.player === 'black' ? '黑方' : '白方';
                                    const winText = msg.winner === 'black' ? '黑胜' : (msg.winner === 'white' ? '白胜' : '和棋');
                                    qiAlert(`${loser}超时，${winText}。`);
                                } else if (msg.winner === 'black') qiAlert('黑胜。');
                                else if (msg.winner === 'white') qiAlert('白胜。');
                                else if (msg.winner === 'draw') qiAlert('和棋。');
                            } else if (msg.action === 'drawAgreed' && !wasOver) qiAlert('和棋。');
                            else if (msg.action === 'resign' && !wasOver) {
                                qiAlert((msg.player === 'black' ? '黑方' : '白方') + '认输');
                            }
                        }
                        updateRadioStyles();
                        break;
                    case 'newGameStarted':
                        ps.mySlot = null;
                        colorStatus.textContent = '观战';
                        ps.slots = { black: false, white: false };
                        ps.matchStarted = false;
                        ps.matchStartedOnce = false;
                        ps.matchTime = null;
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.stop();
                        exitReplayMode();
                        clearSelection();
                        syncFromState(msg);
                        updateRadioStyles();
                        break;
                    case 'importSuccess':
                        exitReplayMode();
                        syncFromState(msg);
                        if (msg.replayData && msg.replayData.moves && msg.replayData.moves.length)
                            enterReplayMode();
                        updateRadioStyles();
                        break;
                    case 'roomReset':
                        exitReplayMode();
                        ps.matchStarted = false;
                        ps.matchStartedOnce = false;
                        ps.matchTime = null;
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.stop();
                        syncFromState(msg);
                        updateRadioStyles();
                        break;
                    case 'error':
                        if (msg.message) qiAlert(msg.message);
                        break;
                    case 'newGameRequest':
                        qiConfirm('对方请求开始新的一局，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'newGameResponse', accept: !!ok })); });
                        break;
                    case 'undoRequest':
                        qiConfirm('对方请求悔棋，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'undoResponse', accept: !!ok })); });
                        break;
                    case 'drawRequest':
                        qiConfirm('对方申请和棋，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'drawResponse', accept: !!ok })); });
                        break;
                    case 'gameRecord': {
                        const data = msg.data;
                        if (data && (data.boardSize == null || data.boardSize === ''))
                            data.boardSize = N;
                        QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix);
                        break;
                    }
                    default:
                        break;
                }
            }

            function connectWebSocket() {
                if (ps.reconnectTimer) {
                    clearTimeout(ps.reconnectTimer);
                    ps.reconnectTimer = null;
                }
                ps.ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                    gameType,
                    roomId,
                    roomPassword,
                    onMessage: handleMessage,
                    colorStatus,
                    connectWebSocket,
                    clearReconnectTimer: () => {
                        if (ps.reconnectTimer) {
                            clearTimeout(ps.reconnectTimer);
                            ps.reconnectTimer = null;
                        }
                    },
                    getReconnectTimer: () => ps.reconnectTimer,
                    setReconnectTimer: (t) => { ps.reconnectTimer = t; }
                });
            }

            document.getElementById('newGameBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
            };
            document.getElementById('undoBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'requestUndo' }));
            };
            document.getElementById('resignBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'resign' }));
            };
            document.getElementById('drawBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'requestDraw' }));
            };
            document.getElementById('exportBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'exportRecord' }));
            };
            document.getElementById('importBtn').onclick = () => document.getElementById('importFileInput').click();
            document.getElementById('importFileInput').onchange = (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = JSON.parse(reader.result);
                        if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'importRecord', data }));
                    } catch (err) {
                        qiAlert('文件解析失败');
                    }
                    e.target.value = '';
                };
                reader.readAsText(f);
            };

            document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
            document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
            document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };

            const replaySlider = document.getElementById('replaySlider');
            replaySlider.addEventListener('input', () => {
                const v = parseInt(replaySlider.value, 10);
                if (ps.tryPlayMode) setTryPlayStep(v);
                else setReplayStep(v);
            });
            document.getElementById('replayBackBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                else if (ps.replayMode) setReplayStep(ps.replayStep - 1);
                else setReplayStep(ps.moveLog.length - 1);
            };
            document.getElementById('replayForwardBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                else if (!ps.replayMode) return;
                else setReplayStep(ps.replayStep + 1);
            };
            {
                const tpBtn = document.getElementById('tryPlayBtn');
                if (tpBtn) {
                    tpBtn.onclick = () => {
                        if (ps.tryPlayMode) exitTryPlay();
                        else enterTryPlay();
                    };
                }
            }

            canvas.addEventListener('click', (e) => {
                handleCanvasClick(e.clientX, e.clientY);
                drawBoard();
            });
            canvas.addEventListener('touchend', (e) => {
                if (e.changedTouches.length !== 1) return;
                const t = e.changedTouches[0];
                handleCanvasClick(t.clientX, t.clientY);
                drawBoard();
                e.preventDefault();
            }, { passive: false });

            if (isMouseDevice) {
                canvas.addEventListener('mousemove', (e) => {
                    updateHoverFromClient(e.clientX, e.clientY);
                    drawBoard();
                });
                canvas.addEventListener('mouseleave', () => {
                    ps.hoverCellR = -1;
                    ps.hoverCellC = -1;
                    ps.hoverWall = null;
                    ps.hoverPawnDest = null;
                    drawBoard();
                });
            }

            wallSlotsRefresh();
            syncFromState(Q.initialState());
            updateRadioStyles();
            connectWebSocket();
        })();
        })();
    }
};
