window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["sonar-weiqi"] = {
    shell: {
        "title": "声呐围棋",
        "rulesHtml": "基本规则同围棋，但每手棋为隐身子，仅己方可见。<br /><br />隐身子在参与提子时显形。<br /><br />落子在对方隐身子上时无效，该隐身子显形，此手视为虚着。<br /><br />每枚己方棋子可看到其上下左右四个方向上最近的对方棋子。<br /><br />",
        "defaultKomiText": "黑贴白4.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "声呐围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "replayPerspective": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "声呐围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const ps = {
            BOARD_SIZE: 9,
            KOMI: 4.25,
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
            replayTruthBoards: [],
            replayInvisibleGrids: [],
            replayPerspective: 'both',
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
            liveReplayInvisibleTints: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            invisibleTintKeys: new Set(),
            plainWeiqiStartHand: null,
            serverInvisibleStoneCounts: null,
            invisibleStoneCountsTimeline: null,
            replayInvisibleCounts: null,
            liveReplayTruthBoards: []
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

        let page;

        function emptyInvisibleGrid(sz) {
            return Array(sz).fill().map(() => Array(sz).fill(false));
        }

        function diffRemovedStones(oldBoard, newBoard, size) {
            const out = [];
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const o = oldBoard[r][c];
                    const n = newBoard[r][c];
                    if (o !== 0 && n === 0) out.push({ row: r, col: c, color: o });
                }
            }
            return out;
        }

        function dedupeRemovedStones(removed) {
            const seen = new Set();
            const out = [];
            for (const x of removed) {
                const k = `${x.row},${x.col}`;
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(x);
            }
            return out;
        }

        function removedStonesForCapture(oldBoard, newBoard, size, moveRow, moveCol, playerVal) {
            let removed = diffRemovedStones(oldBoard, newBoard, size);
            if (oldBoard[moveRow][moveCol] === 0 && newBoard[moveRow][moveCol] === 0)
                removed = removed.concat([{ row: moveRow, col: moveCol, color: playerVal }]);
            return dedupeRemovedStones(removed);
        }

        function revealParticipatingInvisibleForCapture(removed, newBoard, invisible) {
            if (!removed || removed.length === 0) return;
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            const seen = new Set();
            for (const { row: rr, col: cc } of removed) {
                for (const [dr, dc] of dirs) {
                    const nr = rr + dr;
                    const nc = cc + dc;
                    if (nr < 0 || nr >= ps.BOARD_SIZE || nc < 0 || nc >= ps.BOARD_SIZE) continue;
                    const v = newBoard[nr][nc];
                    if (v !== 1 && v !== 2) continue;
                    if (!invisible[nr][nc]) continue;
                    const key = `${nr},${nc}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    invisible[nr][nc] = false;
                }
            }
        }

        function countInvisibleStonesOnGrid(truthBoard, invGrid, size) {
            let black = 0;
            let white = 0;
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (!invGrid[r][c]) continue;
                    const v = truthBoard[r][c];
                    if (v === 1) black++;
                    else if (v === 2) white++;
                }
            }
            return { black, white };
        }

        function shouldShowInvisibleStoneScoreLine() {
            const started = !!(ps.matchStarted || ps.matchStartedOnce || ps.numberOfHands > 1);
            if (!started) return false;
            if (ps.showEstimateActive) return false;
            if (ps.waitingScoreConfirm) return false;
            // 导入棋谱打谱：终局棋谱也会带 gameOver，仍需显示隐身子数量（形势判断/数点确认时仍由上面两行屏蔽）
            if (ps.replayMode && !ps.tryPlayMode) return true;
            if (ps.gameOver) return false;
            if (ps.replayMode && ps.tryPlayMode) return false;
            return true;
        }

        function getCurrentInvisibleStoneCounts() {
            if (ps.replayMode && !ps.tryPlayMode) {
                const arr = ps.replayInvisibleCounts;
                if (arr && ps.replayStep >= 0 && ps.replayStep < arr.length)
                    return arr[ps.replayStep];
                return { black: 0, white: 0 };
            }
            const tl = ps.invisibleStoneCountsTimeline;
            if (tl && tl.length && ps.liveViewStep >= 0 && ps.liveViewStep < tl.length)
                return tl[ps.liveViewStep];
            if (ps.serverInvisibleStoneCounts)
                return ps.serverInvisibleStoneCounts;
            return { black: 0, white: 0 };
        }

        function refreshInvisibleStoneScoreLine() {
            if (!shouldShowInvisibleStoneScoreLine()) {
                if (ps.showEstimateActive || ps.waitingScoreConfirm) return;
                scoreBoard.innerText = '　';
                return;
            }
            const c = getCurrentInvisibleStoneCounts();
            scoreBoard.innerText = `隐身子数量　黑:${c.black} 白:${c.white}`;
        }

        function applySonarRevealToDisplay(display, truth, myColor) {
            if (myColor !== 1 && myColor !== 2) return;
            const opp = 3 - myColor;
            const size = ps.BOARD_SIZE;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (display[r][c] !== myColor) continue;
                    for (const [dr, dc] of dirs) {
                        let rr = r + dr, cc = c + dc;
                        while (rr >= 0 && rr < size && cc >= 0 && cc < size) {
                            if (truth[rr][cc] === opp) {
                                display[rr][cc] = opp;
                                break;
                            }
                            rr += dr; cc += dc;
                        }
                    }
                }
            }
        }

        function buildReplayView(step) {
            const truth = ps.replayTruthBoards[step];
            const inv = ps.replayInvisibleGrids[step];
            const display = page.initBoardArray(ps.BOARD_SIZE);
            const tint = new Set();
            const persp = ps.replayPerspective;
            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    const v = truth[r][c];
                    if (v === 0) continue;
                    const isInv = inv[r][c];
                    if (persp === 'both') {
                        display[r][c] = v;
                        if (isInv) tint.add(`${r},${c}`);
                    } else if (persp === 'black') {
                        if (v === 1) {
                            display[r][c] = 1;
                            if (isInv) tint.add(`${r},${c}`);
                        } else {
                            if (isInv) display[r][c] = 0;
                            else display[r][c] = 2;
                        }
                    } else {
                        if (v === 2) {
                            display[r][c] = 2;
                            if (isInv) tint.add(`${r},${c}`);
                        } else {
                            if (isInv) display[r][c] = 0;
                            else display[r][c] = 1;
                        }
                    }
                }
            }
            if (persp === 'black') applySonarRevealToDisplay(display, truth, 1);
            else if (persp === 'white') applySonarRevealToDisplay(display, truth, 2);
            return { display, tint };
        }

        /** 与服务器 InvisibleStoneWeiqiRoom.buildViewBoard 一致（当前座位的可见棋盘）。 */
        function buildClientViewBoard(truthBoard, inv, slot) {
            const size = truthBoard.length;
            const out = page.initBoardArray(size);
            const isSpectator = slot !== 'black' && slot !== 'white';
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const v = truthBoard[r][c];
                    if (v === 0) continue;
                    if (inv[r][c]) {
                        if (isSpectator) continue;
                        if (slot === 'black') {
                            if (v === 1) out[r][c] = v;
                        } else {
                            if (v === 2) out[r][c] = v;
                        }
                    } else {
                        out[r][c] = v;
                    }
                }
            }
            if (slot === 'black') applySonarRevealToDisplay(out, truthBoard, 1);
            else if (slot === 'white') applySonarRevealToDisplay(out, truthBoard, 2);
            return out;
        }

        /** 与服务器 buildInvisibleTint 一致，返回 "row,col" 字符串列表（便于逐步恢复 Set）。 */
        function buildClientInvisibleTintKeysList(truthBoard, inv, slot) {
            const list = [];
            if (slot !== 'black' && slot !== 'white') return list;
            const size = truthBoard.length;
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (truthBoard[r][c] === 0) continue;
                    if (!inv[r][c]) continue;
                    if (slot === 'black' && truthBoard[r][c] === 1) list.push(`${r},${c}`);
                    else if (slot === 'white' && truthBoard[r][c] === 2) list.push(`${r},${c}`);
                }
            }
            return list;
        }

        /** 与服务器 filterLastMoveMarkers 一致（inv 为当前局面隐身子网格）。 */
        function filterLiveLastMoveMarkers(markers, truthBoard, inv, slot) {
            if (!markers || !markers.length) return [];
            const view = buildClientViewBoard(truthBoard, inv, slot);
            return markers.filter(m => {
                const { row, col } = m;
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return true;
                return view[row][col] !== 0;
            }).map(m => ({ row: m.row, col: m.col, color: m.color }));
        }

        /**
         * 用完整手顺重建 live 进度数据（中途进房时无法靠「多次 push 当前局面」得到历史）。
         */
        function rebuildLiveReplayFromReplaySync(replaySync) {
            const size = ps.BOARD_SIZE;
            const pwsh = replaySync.plainWeiqiStartHand != null ? replaySync.plainWeiqiStartHand : null;
            let curBoard = page.initBoardArray(size);
            let curInv = emptyInvisibleGrid(size);
            if (replaySync.initialPosition && Array.isArray(replaySync.initialPosition)) {
                QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, size, replaySync.initialPosition);
            }
            const liveReplayBoards = [];
            const liveReplayTruthBoards = [];
            const liveReplayMarkers = [];
            const liveReplayStepPlayers = [0];
            const liveReplayInvisibleTints = [];
            const slot = ps.mySlot;

            function pushStep(lastMarkersRaw) {
                liveReplayTruthBoards.push(page.deepCopyBoard(curBoard));
                liveReplayBoards.push(page.deepCopyBoard(buildClientViewBoard(curBoard, curInv, slot)));
                liveReplayMarkers.push(filterLiveLastMoveMarkers(lastMarkersRaw, curBoard, curInv, slot).map(m => ({ ...m })));
                liveReplayInvisibleTints.push(buildClientInvisibleTintKeysList(curBoard, curInv, slot));
            }

            pushStep([]);

            let plyIndex = 0;
            for (const move of replaySync.moves || []) {
                const playerVal = move.player === 'black' ? 1 : 2;
                const enemyVal = 3 - playerVal;
                liveReplayStepPlayers.push(playerVal);
                let lastMarkersRaw = [];
                if (move.type === 'move') {
                    if (move.concealed) {
                        plyIndex++;
                        pushStep([]);
                        continue;
                    }
                    plyIndex++;
                    const nextHand = plyIndex;
                    const { row, col } = move;
                    if (typeof row !== 'number' || typeof col !== 'number') {
                        pushStep([]);
                        continue;
                    }
                    if (curBoard[row][col] !== 0) {
                        if (curBoard[row][col] === enemyVal && curInv[row][col]) {
                            curInv[row][col] = false;
                            lastMarkersRaw = [];
                        }
                    } else {
                        const oldBoard = page.deepCopyBoard(curBoard);
                        const newBoard = page.tryPlaceStone(curBoard, row, col, playerVal);
                        if (newBoard) {
                            curBoard = newBoard;
                            const removed = removedStonesForCapture(oldBoard, curBoard, size, row, col, playerVal);
                            for (const { row: rr, col: cc } of removed) curInv[rr][cc] = false;
                            const wantInv = (pwsh == null || nextHand < pwsh);
                            if (wantInv && curBoard[row][col] === playerVal) curInv[row][col] = true;
                            revealParticipatingInvisibleForCapture(removed, curBoard, curInv);
                            lastMarkersRaw = [{ row, col, color: playerVal }];
                        }
                    }
                } else if (move.type === 'pass') {
                    plyIndex++;
                    if (move.reason === 'hitInvisible' && typeof move.revealRow === 'number' && typeof move.revealCol === 'number') {
                        curInv[move.revealRow][move.revealCol] = false;
                    }
                    lastMarkersRaw = [];
                }
                pushStep(lastMarkersRaw);
            }

            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayTruthBoards = liveReplayTruthBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
            ps.liveReplayInvisibleTints = liveReplayInvisibleTints;
            ps.liveReplayInvisibleGrid = page.deepCopyBoard(curInv);
        }

        function applyLiveReplayIncremental(replaySync) {
            const startLen = ps.liveReplayBoards.length - 1;
            const moves = replaySync.moves || [];
            if (moves.length <= startLen) return true;
            const size = ps.BOARD_SIZE;
            const pwsh = replaySync.plainWeiqiStartHand != null ? replaySync.plainWeiqiStartHand : null;
            let curBoard = page.deepCopyBoard(ps.liveReplayTruthBoards[ps.liveReplayTruthBoards.length - 1]);
            let curInv = ps.liveReplayInvisibleGrid
                ? page.deepCopyBoard(ps.liveReplayInvisibleGrid)
                : emptyInvisibleGrid(size);
            const slot = ps.mySlot;
            function pushStep(lastMarkersRaw) {
                ps.liveReplayTruthBoards.push(page.deepCopyBoard(curBoard));
                ps.liveReplayBoards.push(page.deepCopyBoard(buildClientViewBoard(curBoard, curInv, slot)));
                ps.liveReplayMarkers.push(filterLiveLastMoveMarkers(lastMarkersRaw, curBoard, curInv, slot).map(m => ({ ...m })));
                ps.liveReplayInvisibleTints.push(buildClientInvisibleTintKeysList(curBoard, curInv, slot));
            }
            let plyIndex = startLen;
            for (let i = startLen; i < moves.length; i++) {
                const move = moves[i];
                const playerVal = move.player === 'black' ? 1 : 2;
                const enemyVal = 3 - playerVal;
                ps.liveReplayStepPlayers.push(playerVal);
                let lastMarkersRaw = [];
                if (move.type === 'move') {
                    if (move.concealed) {
                        plyIndex++;
                        pushStep([]);
                        continue;
                    }
                    plyIndex++;
                    const nextHand = plyIndex;
                    const { row, col } = move;
                    if (typeof row !== 'number' || typeof col !== 'number') {
                        pushStep([]);
                        continue;
                    }
                    if (curBoard[row][col] !== 0) {
                        if (curBoard[row][col] === enemyVal && curInv[row][col]) {
                            curInv[row][col] = false;
                            lastMarkersRaw = [];
                        }
                    } else {
                        const oldBoard = page.deepCopyBoard(curBoard);
                        const newBoard = page.tryPlaceStone(curBoard, row, col, playerVal);
                        if (newBoard) {
                            curBoard = newBoard;
                            const removed = removedStonesForCapture(oldBoard, curBoard, size, row, col, playerVal);
                            for (const { row: rr, col: cc } of removed) curInv[rr][cc] = false;
                            const wantInv = (pwsh == null || nextHand < pwsh);
                            if (wantInv && curBoard[row][col] === playerVal) curInv[row][col] = true;
                            revealParticipatingInvisibleForCapture(removed, curBoard, curInv);
                            lastMarkersRaw = [{ row, col, color: playerVal }];
                        }
                    }
                } else if (move.type === 'pass') {
                    plyIndex++;
                    if (move.reason === 'hitInvisible' && typeof move.revealRow === 'number' && typeof move.revealCol === 'number') {
                        curInv[move.revealRow][move.revealCol] = false;
                    }
                    lastMarkersRaw = [];
                } else { return false; }
                pushStep(lastMarkersRaw);
            }
            ps.liveReplayInvisibleGrid = page.deepCopyBoard(curInv);
            return true;
        }

        /** 与对弈时 filterLastMoveMarkers 一致：不显示落在对方隐身子上的最后一手标记 */
        function filterReplayLastMoveMarkers(markers, step) {
            if (!markers || !markers.length) return [];
            if (!ps.replayTruthBoards[step] || !ps.replayInvisibleGrids[step])
                return markers.map(m => ({ ...m }));
            const { display } = buildReplayView(step);
            return markers.filter(m => {
                const { row, col } = m;
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return true;
                return display[row][col] !== 0;
            }).map(m => ({ ...m }));
        }

        /** 绘制隐身子 tint 时取子色：本地棋谱回放有 truth；联网时仅为己方隐子，用座位判定。 */
        function getStoneColorForInvisibleTintAt(rr, cc) {
            if (ps.replayMode && ps.replayTruthBoards && ps.replayTruthBoards.length > 0) {
                const step = Math.min(ps.replayStep, ps.replayTruthBoards.length - 1);
                const v = ps.replayTruthBoards[step][rr][cc];
                if (v === 1 || v === 2) return v;
            }
            if (ps.mySlot === 'black') return 1;
            if (ps.mySlot === 'white') return 2;
            return 0;
        }

        function syncLiveReplayFromServerState(state) {
            const nh = state.numberOfHands || 1;
            const coords = state.moveCoords || [];
            const boardEmpty = !(state.board || []).some(row => row.some(v => v === 1 || v === 2));

            if (nh === 1 && boardEmpty) {
                ps.liveReplayBoards = [page.deepCopyBoard(state.board)];
                ps.liveReplayTruthBoards = [page.deepCopyBoard(state.board)];
                ps.liveReplayMarkers = [[]];
                ps.liveReplayStepPlayers = [0];
                ps.liveReplayInvisibleTints = [[]];
                return;
            }

            const rvb = state.replayViewBoards;
            if (Array.isArray(rvb) && rvb.length === nh) {
                ps.liveReplayBoards = rvb.map(b => page.deepCopyBoard(b));
                ps.liveReplayTruthBoards = ps.liveReplayBoards.map(b => page.deepCopyBoard(b));
                ps.liveReplayStepPlayers = [0];
                for (let i = 0; i < coords.length; i++) {
                    const m = coords[i];
                    const pv = m && m.player === 'white' ? 2 : 1;
                    ps.liveReplayStepPlayers.push(pv);
                }
                const markers = [[]];
                for (let i = 0; i < coords.length; i++) {
                    const m = coords[i];
                    let mk = [];
                    if (m.type === 'move' && typeof m.row === 'number' && !m.concealed) {
                        const pv = m.player === 'white' ? 2 : 1;
                        mk = [{ row: m.row, col: m.col, color: pv }];
                    }
                    markers.push(mk);
                }
                if (markers.length > 0)
                    markers[markers.length - 1] = (state.lastMoveMarkers || []).map(m => ({ ...m }));
                ps.liveReplayMarkers = markers;
                const rvt = state.replayViewInvisibleTints;
                if (Array.isArray(rvt) && rvt.length === nh)
                    ps.liveReplayInvisibleTints = rvt.map(x => (Array.isArray(x) ? x.slice() : []));
                else
                    ps.liveReplayInvisibleTints = new Array(nh).fill(null);
                return;
            }

            const rs = state.replaySync;
            if (rs && Array.isArray(rs.moves) && rs.moves.length === nh - 1) {
                const syncedLen = ps.liveReplayBoards.length - 1;
                if (syncedLen >= 0 && rs.moves.length > syncedLen && applyLiveReplayIncremental(rs)) {
                    return;
                }
                rebuildLiveReplayFromReplaySync(rs);
                return;
            }

            ps.liveReplayTruthBoards = null;

            if (!ps.liveReplayBoards.length) {
                ps.liveReplayStepPlayers = [];
                ps.liveReplayMarkers = [];
            }

            while (ps.liveReplayBoards.length > nh) {
                ps.liveReplayBoards.pop();
                ps.liveReplayMarkers.pop();
                ps.liveReplayStepPlayers.pop();
                if (ps.liveReplayTruthBoards && ps.liveReplayTruthBoards.length)
                    ps.liveReplayTruthBoards.pop();
            }

            while (ps.liveReplayBoards.length < nh) {
                const idx = ps.liveReplayBoards.length;
                ps.liveReplayBoards.push(page.deepCopyBoard(state.board));
                if (idx === 0) {
                    ps.liveReplayStepPlayers.push(0);
                    ps.liveReplayMarkers.push([]);
                } else {
                    const m = coords[idx - 1];
                    const pv = m && m.player === 'white' ? 2 : 1;
                    ps.liveReplayStepPlayers.push(pv);
                    const isLast = (idx === nh - 1);
                    ps.liveReplayMarkers.push(isLast ? (state.lastMoveMarkers || []).map(x => ({ ...x })) : []);
                }
            }
            const li = ps.liveReplayBoards.length - 1;
            if (li >= 0) {
                ps.liveReplayBoards[li] = page.deepCopyBoard(state.board);
                ps.liveReplayMarkers[li] = (state.lastMoveMarkers || []).map(m => ({ ...m }));
            }
            ps.liveReplayInvisibleTints = new Array(ps.liveReplayBoards.length).fill(null);
        }

        const variantOpts = {
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            drawBoard() {
                const d = QiSquareWeiqiCanvas.draw;
                const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
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
                let baseBoard = ps.board;
                if (ps.invisibleTintKeys.size) {
                    baseBoard = page.deepCopyBoard(ps.board);
                    for (const key of ps.invisibleTintKeys) {
                        const [rr, cc] = key.split(',').map(Number);
                        baseBoard[rr][cc] = 0;
                    }
                }
                d.stonesBlackWhite(ctx, baseBoard, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
                if (ps.invisibleTintKeys.size) {
                    for (const key of ps.invisibleTintKeys) {
                        const [rr, cc] = key.split(',').map(Number);
                        const v = getStoneColorForInvisibleTintAt(rr, cc);
                        if (v !== 1 && v !== 2) continue;
                        const cx = ps.PADDING + cc * cellSize;
                        const cy = ps.PADDING + rr * cellSize;
                        QiWeiqiSquarePageRuntime.invisibleDrawStone(ctx, cx, cy, stoneRadius, v === 1, 0.6);
                    }
                }
                if (!lowerLastMoveMarker) {
                    d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
                }
                d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, page && page.isUserBoardMarkVisibleAt);
                if (ps.showMoveNumbers) {
                    const nums = page ? page.computeStoneNumbers() : [];
                    d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
                }
                d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                    tryPlayMode: ps.tryPlayMode,
                    tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    mySlot: ps.mySlot,
                    isHoverValid: ps.isHoverValid,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool
                });
                if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                    d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
                }
            },
            syncState(state) {
                page.clearMobileMovePreview();
                if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                    ps.BOARD_SIZE = state.boardSize;
                    if (state.komi != null) ps.KOMI = state.komi;
                    ps.board = page.initBoardArray(ps.BOARD_SIZE);
                    ps.userBoardMarks = Object.create(null);
                    ps.liveReplayBoards = [];
                    ps.liveReplayTruthBoards = [];
                    ps.liveReplayMarkers = [];
                    ps.liveReplayStepPlayers = [];
                    ps.liveReplayInvisibleTints = [];
                    ps.liveViewStep = 0;
                    page.updateBoardGeometry();
                    const sizeSelect = document.getElementById('boardSizeSelect');
                    if (sizeSelect) sizeSelect.value = ps.BOARD_SIZE;
                }
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer;
                ps.gameOver = state.gameOver || false;
                ps.winner = state.winner || null;
                if (state.matchStarted !== undefined)
                    ps.matchStarted = !!state.matchStarted;
                if (state.moveCoords) {
                    ps.moveLog = state.moveCoords.map(m => {
                        if (m.type !== 'move') return null;
                        if (m.concealed || typeof m.row !== 'number') return null;
                        return { row: m.row, col: m.col };
                    });
                }
                if (state.slots)
                    ps.slots = state.slots;
                if ('plainWeiqiStartHand' in state)
                    ps.plainWeiqiStartHand = state.plainWeiqiStartHand;
                if (state.invisibleStoneCounts)
                    ps.serverInvisibleStoneCounts = state.invisibleStoneCounts;
                if (state.invisibleStoneCountsTimeline)
                    ps.invisibleStoneCountsTimeline = state.invisibleStoneCountsTimeline;

                if (state.useServerBoard && !ps.replayMode) {
                    ps.board = page.deepCopyBoard(state.board);
                    ps.lastMoveMarkers = state.lastMoveMarkers || [];
                    ps.invisibleTintKeys = new Set((state.invisibleTint || []).map(p => p.row + ',' + p.col));
                    const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                    syncLiveReplayFromServerState(state);
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
                    page.applyLiveViewBoard();
                    page.updateLiveReplayPanelUI();
                } else if (!ps.replayMode) {
                    const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                    const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                    page.rebuildLiveReplayFromMoveCoords(state.moveCoords || [], state.initialBoard);
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
                    page.applyLiveViewBoard();
                    page.updateLiveReplayPanelUI();
                    ps.invisibleTintKeys = new Set();
                } else {
                    ps.board = page.deepCopyBoard(state.board || ps.board);
                    ps.lastMoveMarkers = state.lastMoveMarkers || [];
                    ps.invisibleTintKeys = new Set();
                }

                const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
                const hasPlayer = ps.slots.black || ps.slots.white;
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (!hasAnyStone && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                    sizeSelect.style.display = 'inline-block';
                else
                    sizeSelect.style.display = 'none';

                if (ps.showEstimateActive) {
                    ps.cachedLiveBoard = page.removeDeadAndDying(ps.board);
                    ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard);
                    page.showEstimate();
                } else {
                    page.updateTurn();
                }
                page.updateReplayUI();
            },
            enterReplayMode(data) {
                const size = ps.BOARD_SIZE;
                const pwsh = data.plainWeiqiStartHand != null ? data.plainWeiqiStartHand : null;
                ps.replayBoards = [];
                ps.replayMarkers = [];
                ps.replayTruthBoards = [];
                ps.replayInvisibleGrids = [];
                ps.replayStepPlayers = [0];

                let curBoard = Array(size).fill().map(() => Array(size).fill(0));
                let curInv = emptyInvisibleGrid(size);

                function pushSnapshot(markerRow) {
                    ps.replayTruthBoards.push(page.deepCopyBoard(curBoard));
                    ps.replayInvisibleGrids.push(curInv.map(row => row.slice()));
                    ps.replayBoards.push(page.deepCopyBoard(curBoard));
                    ps.replayMarkers.push(markerRow || []);
                }

                if (data.initialPosition && Array.isArray(data.initialPosition)) {
                    QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, size, data.initialPosition);
                }
                pushSnapshot([]);

                let plyIndex = 0;
                for (const move of data.moves || []) {
                    const playerVal = move.player === 'black' ? 1 : 2;
                    const enemyVal = 3 - playerVal;
                    if (move.type === 'move') {
                        plyIndex++;
                        const nextHand = plyIndex;
                        const { row, col } = move;
                        if (curBoard[row][col] !== 0) {
                            if (curBoard[row][col] === enemyVal && curInv[row][col]) {
                                curInv[row][col] = false;
                                ps.replayStepPlayers.push(playerVal);
                                pushSnapshot([]);
                            }
                        } else {
                            const oldBoard = page.deepCopyBoard(curBoard);
                            const newBoard = page.tryPlaceStone(curBoard, row, col, playerVal);
                            if (newBoard) {
                                curBoard = newBoard;
                                const removed = removedStonesForCapture(oldBoard, curBoard, size, row, col, playerVal);
                                for (const { row: rr, col: cc } of removed) curInv[rr][cc] = false;
                                const wantInv = (pwsh == null || nextHand < pwsh);
                                if (wantInv && curBoard[row][col] === playerVal) curInv[row][col] = true;
                                revealParticipatingInvisibleForCapture(removed, curBoard, curInv);
                                ps.replayStepPlayers.push(playerVal);
                                pushSnapshot([{ row, col, color: playerVal }]);
                            }
                        }
                    } else if (move.type === 'pass') {
                        plyIndex++;
                        if (move.reason === 'hitInvisible') {
                            curInv[move.revealRow][move.revealCol] = false;
                        }
                        ps.replayStepPlayers.push(playerVal);
                        pushSnapshot([]);
                    }
                }

                ps.replayTotalSteps = ps.replayTruthBoards.length - 1;
                ps.replayInvisibleCounts = [];
                for (let i = 0; i < ps.replayTruthBoards.length; i++) {
                    ps.replayInvisibleCounts.push(
                        countInvisibleStonesOnGrid(ps.replayTruthBoards[i], ps.replayInvisibleGrids[i], size)
                    );
                }
                ps.replayMode = true;

                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps);
                page.updateReplayUI();
            },
            exitReplayMode() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                ps.replayMode = false;
                ps.replayBoards = [];
                ps.replayMarkers = [];
                ps.replayStepPlayers = [];
                ps.replayStep = 0;
                ps.replayTotalSteps = 0;
                ps.replayTruthBoards = [];
                ps.replayInvisibleGrids = [];
                ps.replayInvisibleCounts = null;
                ps.replayPerspective = 'both';
                const perspBoth = document.getElementById('replayPerspBoth');
                if (perspBoth) perspBoth.checked = true;
                const perspRow = document.getElementById('replayPerspectiveRow');
                if (perspRow) perspRow.style.display = 'none';
                page.updateReplayUI();
                refreshInvisibleStoneScoreLine();
            },
            setReplayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                if (ps.replayTruthBoards.length > 0) {
                    const { display, tint } = buildReplayView(step);
                    ps.board = display;
                    ps.invisibleTintKeys = tint;
                } else {
                    ps.board = page.deepCopyBoard(ps.replayBoards[step]);
                    ps.invisibleTintKeys = new Set();
                }
                ps.lastMoveMarkers = filterReplayLastMoveMarkers(ps.replayMarkers[step], step);

                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;

                if (step === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${step}手`;
                }
                ps.isMyTurn = false;

                if (ps.showEstimateActive) page.showEstimate();
                else page.drawBoard();
                refreshInvisibleStoneScoreLine();
            },
            updateReplayUI() {
                const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
                const replayPanel = document.getElementById('replayPanel');
                const tryPlayBtn = document.getElementById('tryPlayBtn');
                const perspRow = document.getElementById('replayPerspectiveRow');
                if (ps.replayMode) {
                    for (const id of gameButtonIds) {
                        const el = document.getElementById(id);
                        if (el) el.style.display = 'none';
                    }
                    replayPanel.style.display = '';
                    tryPlayBtn.style.display = '';
                    tryPlayBtn.innerText = ps.tryPlayMode ? '试下结束' : '试下';
                    if (perspRow) perspRow.style.display = '';
                } else {
                    for (const id of gameButtonIds) {
                        const el = document.getElementById(id);
                        if (el) el.style.display = '';
                    }
                    replayPanel.style.display = '';
                    tryPlayBtn.style.display = 'none';
                    tryPlayBtn.innerText = '试下';
                    if (perspRow) perspRow.style.display = 'none';
                }
            }
        };

        page = QiWeiqiSquarePageRuntime.create(ps, domPage, variantOpts);

        const origApplyLiveViewBoard = page.applyLiveViewBoard;
        page.applyLiveViewBoard = function () {
            origApplyLiveViewBoard();
            const row = ps.liveReplayInvisibleTints && ps.liveReplayInvisibleTints[ps.liveViewStep];
            if (!ps.replayMode && Array.isArray(row))
                ps.invisibleTintKeys = new Set(row);
        };

        (function wrapInvisibleStoneScoreRefresh() {
            const wrap = (name) => {
                const o = page[name];
                if (typeof o !== 'function') return;
                page[name] = function (...args) {
                    const r = o.apply(this, args);
                    refreshInvisibleStoneScoreLine();
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
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
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
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            timeControlMainByoScale: 2,
            onNewGameStarted: () => {
                ps.userBoardMarks = Object.create(null);
                ps.plainWeiqiStartHand = null;
            },
            onRoomReset: () => {
                ps.plainWeiqiStartHand = null;
                ps.userBoardMarks = Object.create(null);
            },
            onImportSuccessBeforeSync: (msg, prevBoardSize) => {
                if (msg.boardSize && msg.boardSize !== prevBoardSize)
                    ps.userBoardMarks = Object.create(null);
            },
            isMouseDevice
        });
        const handleMessage = _weiqiBindings.handleMessage;
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

        document.querySelectorAll('input[name="replayPerspective"]').forEach((el) => {
            el.addEventListener('change', () => {
                const c = document.querySelector('input[name="replayPerspective"]:checked');
                ps.replayPerspective = c ? c.value : 'both';
                if (ps.replayMode && !ps.tryPlayMode) setReplayStep(ps.replayStep);
            });
        });
        connectWebSocket(handleMessage);
        })();
    }
};
