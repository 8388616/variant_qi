window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["drift-weiqi"] = {
    shell: {
        "title": "漂移围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />棋盘分为四个板块。每隔<strong>0.07×棋盘总点数，向上取奇</strong>数手，所有板块沿<strong>顺时针</strong>漂移漂移。\n最多漂移 <strong>8</strong> 次，之后不再漂移。<br /><br />漂移时先漂移后提子。<br /><br />棋盘的路数和漂移手数的映射关系为：<br /><strong>8 </strong>5<br /><strong>10 </strong>7<br /><strong>12 </strong>11<br /><strong>14 </strong>15<br /><strong>16 </strong>19<br /><strong>18 </strong>23<br /><strong>20 </strong>29<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 8,
        "boardSizeMax": 20,
        "defaultBoardSize": 18,
        "minLib": 1,
        "recordDownloadPrefix": "漂移围棋",
        "useBenson": true,
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "editBoard": true
        },
        "boardSizeStep": 2,
        "boardSizeValues": [
            8,
            10,
            12,
            14,
            16,
            18,
            20
        ],
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "漂移围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const C = () => QiSquareWeiqiCanvas;
        const R = () => QiWeiqiSquarePageRuntime;

        const RW_MAX_ROT = 8;
        const RW_TINT = '#cb9665';

        function rwComputeInterval(n) {
            let x = Math.ceil(0.07 * n * n);
            if (x % 2 === 0) x += 1;
            return x;
        }
        function rwDriftCell(r, c, half) {
            if (r < half && c < half) return [r, c + half];
            if (r < half) return [r + half, c];
            if (c < half) return [r - half, c];
            return [r, c - half];
        }
        function rwInitZero(n) {
            return Array(n).fill(0).map(() => Array(n).fill(0));
        }
        function rwNormalizeMatrix(raw, n) {
            const normalized = rwInitZero(n);
            if (!Array.isArray(raw)) return normalized;
            for (let r = 0; r < n; r++) {
                if (!Array.isArray(raw[r])) continue;
                for (let c = 0; c < n; c++) {
                    const value = raw[r][c];
                    if (Number.isFinite(value)) normalized[r][c] = value;
                }
            }
            return normalized;
        }
        function rwSafeMatrixAt(matrix, r, c) {
            const row = Array.isArray(matrix) ? matrix[r] : null;
            const value = Array.isArray(row) ? row[c] : 0;
            return Number.isFinite(value) ? value : 0;
        }
        function rwDriftBoardLike(board, n, mapCell) {
            const nb = rwInitZero(n);
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const [nr, nc] = mapCell(r, c);
                    nb[nr][nc] = board[r][c];
                }
            }
            return nb;
        }
        function rwDriftQuadrantsClockwise(board, handNumAt, n) {
            const half = n / 2;
            const mapCell = (r, c) => rwDriftCell(r, c, half);
            return {
                board: rwDriftBoardLike(board, n, mapCell),
                handNumAt: rwDriftBoardLike(handNumAt, n, mapCell)
            };
        }
        function rwDriftMarkers(markers, n) {
            if (!markers || !markers.length) return [];
            const half = n / 2;
            return markers.map(m => {
                const [nr, nc] = rwDriftCell(m.row, m.col, half);
                return { row: nr, col: nc, color: m.color };
            });
        }
        function rwSyncHand(board, hand) {
            const n = board.length;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (board[r][c] === 0) hand[r][c] = 0;
                }
            }
        }
        function rwWillDriftThisPly(driftCount, driftInterval, completedPlyCount) {
            if (driftCount >= RW_MAX_ROT) return false;
            if (completedPlyCount <= 0 || completedPlyCount % driftInterval !== 0) return false;
            return true;
        }
        function rwCollectSeedsOnFirstLine(board, n, color) {
            const seeds = [];
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (r !== 0 && r !== n - 1 && c !== 0 && c !== n - 1) continue;
                    if (board[r][c] === color) seeds.push([r, c]);
                }
            }
            return seeds;
        }
        function rwFindGroupRepresentative(board, row, col, color, boardSize) {
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            let bestR = row;
            let bestC = col;
            const queue = [[row, col]];
            const visited = new Set([`${row},${col}`]);
            while (queue.length) {
                const [r, c] = queue.shift();
                if (r < bestR || (r === bestR && c < bestC)) {
                    bestR = r;
                    bestC = c;
                }
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                    const k = `${nr},${nc}`;
                    if (visited.has(k)) continue;
                    if (board[nr][nc] === color) {
                        visited.add(k);
                        queue.push([nr, nc]);
                    }
                }
            }
            return [bestR, bestC];
        }
        function rwUniqueGroupRootsFromSeeds(board, seeds, color, boardSize) {
            const roots = [];
            const seenGroups = new Set();
            for (const [sr, sc] of seeds) {
                if (board[sr][sc] !== color) continue;
                const rep = rwFindGroupRepresentative(board, sr, sc, color, boardSize);
                const key = `${rep[0]},${rep[1]}`;
                if (!seenGroups.has(key)) {
                    seenGroups.add(key);
                    roots.push(rep);
                }
            }
            return roots;
        }
        /** 漂移手提子：先对方（落子邻接 + 一路线）再己方（落子点 + 一路线）；虚着漂移仅一路线 */
        function rwApplyDriftPlyCaptures(board, placeR, placeC, playerVal, boardSize, hasPlacement) {
            const enemyColor = 3 - playerVal;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const enemySeeds = [];
            if (hasPlacement) {
                for (const [dr, dc] of dirs) {
                    const nr = placeR + dr;
                    const nc = placeC + dc;
                    if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === enemyColor) {
                        enemySeeds.push([nr, nc]);
                    }
                }
            }
            enemySeeds.push(...rwCollectSeedsOnFirstLine(board, boardSize, enemyColor));
            const enemyRoots = rwUniqueGroupRootsFromSeeds(board, enemySeeds, enemyColor, boardSize);
            for (const [gr, gc] of enemyRoots) {
                if (R().countGroupLiberties(board, gr, gc, boardSize) < 1) {
                    R().removeGroup(board, gr, gc, enemyColor, boardSize);
                }
            }
            const ownSeeds = [];
            if (hasPlacement && board[placeR][placeC] === playerVal) {
                ownSeeds.push([placeR, placeC]);
            }
            ownSeeds.push(...rwCollectSeedsOnFirstLine(board, boardSize, playerVal));
            const ownRoots = rwUniqueGroupRootsFromSeeds(board, ownSeeds, playerVal, boardSize);
            for (const [gr, gc] of ownRoots) {
                if (R().countGroupLiberties(board, gr, gc, boardSize) < 1) {
                    R().removeGroup(board, gr, gc, playerVal, boardSize);
                }
            }
        }
        function rwMaybeDrift(board, handNumAt, driftCount, n, driftInterval, completedPlyCount, lastMoveMarkers) {
            if (driftCount >= RW_MAX_ROT) {
                return { board, handNumAt, driftCount, lastMoveMarkers };
            }
            if (completedPlyCount <= 0 || completedPlyCount % driftInterval !== 0) {
                return { board, handNumAt, driftCount, lastMoveMarkers };
            }
            const r = rwDriftQuadrantsClockwise(board, handNumAt, n);
            return {
                board: r.board,
                handNumAt: r.handNumAt,
                driftCount: driftCount + 1,
                lastMoveMarkers: rwDriftMarkers(lastMoveMarkers, n)
            };
        }
        function rwDriftUserBoardMarks(map, n) {
            if (!map || typeof map !== 'object') return;
            const half = n / 2;
            const entries = Object.keys(map);
            const next = Object.create(null);
            for (const key of entries) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= n || c < 0 || c >= n) continue;
                const [nr, nc] = rwDriftCell(r, c, half);
                next[`${nr},${nc}`] = map[key];
            }
            for (const key of entries) delete map[key];
            for (const k of Object.keys(next)) map[k] = next[k];
        }

        /** 与服务器 driftQuadrantsClockwise 互逆的一步：由漂移后的盘面还原漂移前 */
        function rwUndriftBoardOnce(post, n) {
            const half = n / 2;
            const pre = rwInitZero(n);
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const [nr, nc] = rwDriftCell(r, c, half);
                    pre[r][c] = post[nr][nc];
                }
            }
            return pre;
        }
        function rwDriftCellCCW(r, c, half) {
            let a = r, b = c;
            for (let i = 0; i < 3; i++) [a, b] = rwDriftCell(a, b, half);
            return [a, b];
        }
        function rwDriftMarkersCCW(markers, n) {
            if (!markers || !markers.length) return [];
            const half = n / 2;
            return markers.map(m => {
                const [r, c] = rwDriftCellCCW(m.row, m.col, half);
                return { row: r, col: c, color: m.color };
            });
        }
        function recomputeHandNumAtFromMoves(moveCoords, boardSize, driftInterval) {
            const tryPlaceStone = (bb, r, c, pv) =>
                R().tryPlaceStoneNLiberty(bb, r, c, pv, boardSize, C().deepCopyBoard, 1);
            let curBoard = QiSquareWeiqiCanvas.initBoardArray(boardSize);
            let handNumAt = rwInitZero(boardSize);
            let driftCount = 0;
            const stepPlayers = [0];
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'player1' ? 1 : 2;
                stepPlayers.push(playerVal);
                const completedPlyCount = stepPlayers.length - 1;
                const driftNow = rwWillDriftThisPly(driftCount, driftInterval, completedPlyCount);
                if (move.type === 'move') {
                    if (driftNow) {
                        if (curBoard[move.row][move.col] === 0) {
                            const placedOnly = C().deepCopyBoard(curBoard);
                            placedOnly[move.row][move.col] = playerVal;
                            rwSyncHand(placedOnly, handNumAt);
                            handNumAt[move.row][move.col] = completedPlyCount;
                            const half = boardSize / 2;
                            const mapCell = (r, c) => rwDriftCell(r, c, half);
                            curBoard = rwDriftBoardLike(placedOnly, boardSize, mapCell);
                            handNumAt = rwDriftBoardLike(handNumAt, boardSize, mapCell);
                            const [pr, pc] = rwDriftCell(move.row, move.col, half);
                            rwApplyDriftPlyCaptures(curBoard, pr, pc, playerVal, boardSize, true);
                            rwSyncHand(curBoard, handNumAt);
                            driftCount++;
                        }
                    } else {
                        const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                        if (newBoard) curBoard = newBoard;
                        rwSyncHand(curBoard, handNumAt);
                        handNumAt[move.row][move.col] = completedPlyCount;
                        const rot = rwMaybeDrift(
                            curBoard,
                            handNumAt,
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            [{ row: move.row, col: move.col, color: playerVal }]
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                    }
                } else if (move.type === 'pass') {
                    if (driftNow) {
                        const r = rwDriftQuadrantsClockwise(
                            C().deepCopyBoard(curBoard),
                            C().deepCopyBoard(handNumAt),
                            boardSize
                        );
                        rwApplyDriftPlyCaptures(r.board, 0, 0, playerVal, boardSize, false);
                        rwSyncHand(r.board, r.handNumAt);
                        curBoard = r.board;
                        handNumAt = r.handNumAt;
                        driftCount++;
                    } else {
                        const rot = rwMaybeDrift(
                            C().deepCopyBoard(curBoard),
                            C().deepCopyBoard(handNumAt),
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            []
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                    }
                }
            }
            return handNumAt;
        }
        function isBrowsingLiveReplay(pageState) {
            if (!pageState || !pageState.liveReplayBoards || !pageState.liveReplayBoards.length) return false;
            const total = Math.max(0, pageState.liveReplayBoards.length - 1);
            return pageState.liveViewStep < total;
        }

        /** 使用服务端下发的 handNumAt（与当前路数一致时） */
        function tryApplyHandNumAtFromState(state) {
            const bs = ps.BOARD_SIZE;
            const h = state && state.handNumAt;
            if (!h || !Array.isArray(h) || h.length !== bs) return false;
            if (!h[0] || h[0].length !== bs) return false;
            ps.handNumAt = h.map(row => row.slice());
            return true;
        }

        function getQuadrantTintRects(boardSize, padding, cellSize) {
            const span = boardSize / 2 - 0.5;
            const wh = span * cellSize;
            const x0 = padding;
            const x1 = padding + wh;
            const y0 = padding;
            const y1 = padding + wh;
            return {
                tl: { x: x0, y: y0, w: wh, h: wh },
                tr: { x: x1, y: y0, w: wh, h: wh },
                bl: { x: x0, y: y1, w: wh, h: wh },
                br: { x: x1, y: y1, w: wh, h: wh }
            };
        }

        /** 与盘面象限顺时针漂移一致：底色块从当前象限移到顺时针下一象限 */
        function rwTintQuadKeyStepCW(k) {
            const m = { tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' };
            return m[k];
        }
        function rwTintQuadKeyStepCWNTimes(k, n) {
            let x = k;
            for (let i = 0; i < n; i++) x = rwTintQuadKeyStepCW(x);
            return x;
        }
        /** 漂移偶数次：主对角 tl+br；奇数次：副对角 tr+bl（与棋子象限漂移同步交换） */
        function rwGetTintPairKeys(driftCount) {
            return ((driftCount | 0) % 2 === 0) ? ['tl', 'br'] : ['tr', 'bl'];
        }

        function drawQuadrantTint(ctx, boardSize, padding, cellSize, canvasSize, show, driftCount) {
            if (!show || boardSize % 2 !== 0) return;
            const RQ = getQuadrantTintRects(boardSize, padding, cellSize);
            const keys = rwGetTintPairKeys(driftCount);
            ctx.save();
            ctx.fillStyle = RW_TINT;
            for (const k of keys) {
                const q = RQ[k];
                ctx.fillRect(q.x, q.y, q.w, q.h);
            }
            ctx.restore();
        }

        /** 漂移动画：两块底色从漂移前象限沿顺时针插值到漂移后象限 */
        function drawQuadrantTintAnimated(ctx, boardSize, padding, cellSize, t, preDriftCount, driftDelta) {
            if (boardSize % 2 !== 0) return;
            const RQ = getQuadrantTintRects(boardSize, padding, cellSize);
            const dr = Math.max(0, driftDelta | 0);
            if (dr === 0) return;
            const preRc = preDriftCount | 0;
            const keys = rwGetTintPairKeys(preRc);
            const lerp = (a, b) => a + (b - a) * t;
            ctx.save();
            ctx.fillStyle = RW_TINT;
            for (const k of keys) {
                const from = RQ[k];
                const endK = rwTintQuadKeyStepCWNTimes(k, dr);
                const to = RQ[endK];
                ctx.fillRect(lerp(from.x, to.x, t), lerp(from.y, to.y, t), from.w, from.h);
            }
            ctx.restore();
        }

        function drawQuadrantWarningStroke(ctx, boardSize, padding, cellSize) {
            const RQ = getQuadrantTintRects(boardSize, padding, cellSize);
            ctx.save();
            ctx.strokeStyle = '#e02020';
            ctx.lineWidth = 3;
            for (const k of ['tl', 'tr', 'bl', 'br']) {
                const q = RQ[k];
                ctx.strokeRect(q.x, q.y, q.w, q.h);
            }
            ctx.restore();
        }

        function startQuadrantBlink(allowReplayBlink) {
            if (ps.driftAnimating) return;
            if (!allowReplayBlink && (ps.replayMode || isBrowsingLiveReplay(ps))) return;
            let count = 0;
            const tick = () => {
                ps.blinkQuadrants = !ps.blinkQuadrants;
                drawBoard();
                count++;
                if (count < 6) setTimeout(tick, 200);
                else {
                    ps.blinkQuadrants = false;
                    drawBoard();
                }
            };
            tick();
        }

        function isUserBoardMarkVisibleAt(ps) {
            return function (r, c) {
                if (ps.showEstimateActive) return false;
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
                if (ps.board[r][c] !== 0) return false;
                return true;
            };
        }

const ps = {
            BOARD_SIZE: 18,
            KOMI: 3.25,
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
            slots: { player1: false, player2: false },
            reconnectTimer: null,
            replayMode: false,
            replayBoards: [],
            replayMarkers: [],
            replayHandNumAts: [],
            replayDriftCounts: [],
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
            liveReplayHandNumAts: [],
            liveReplayDriftCounts: [],
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            handNumAt: [],
            driftCount: 0,
            driftInterval: rwComputeInterval(18),
            showBlockTint: true,
            blinkQuadrants: false,
            driftAnimating: false,
            lastSyncedMoveCoords: [],
            /** null = 尚未与本局对齐，首次同步不播放漂移动画（中途进房/重连追状态） */
            lastDriftCountForAnim: null,
            /** 'forward' | 'back' | 'slider' | null — 由打谱控件 capture 阶段写入，供 setReplayStep 区分 */
            replayNavSource: null
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            ps.handNumAt = rwInitZero(ps.BOARD_SIZE);
            ps.driftInterval = rwComputeInterval(ps.BOARD_SIZE);
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

        function drawSingleStone(ctx, x, y, cellSize, val) {
            const radius = cellSize * 0.44;
            ctx.save();
            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowOffsetY = 2;
            const gradient = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
            if (val === 1) {
                gradient.addColorStop(0, '#444');
                gradient.addColorStop(0.6, '#222');
                gradient.addColorStop(1, '#111');
            } else {
                gradient.addColorStop(0, '#fff');
                gradient.addColorStop(0.5, '#eee');
                gradient.addColorStop(1, '#aaa');
            }
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.restore();
            if (!ps.showMoveNumbers) {
                ctx.beginPath();
                ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                ctx.fillStyle = val === 1 ? '#444' : '#fff';
                ctx.fill();
            }
        }

        function drawDriftAnimFrame(anim, t) {
            const d = C().draw;
            const cs = C().DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const n = ps.BOARD_SIZE;
            const half = n / 2;
            const pad = ps.PADDING;
            const preB = anim.preBoard;
            const preH = anim.preHandNumAt;
            d.clear(domPage.ctx, cs);
            if (ps.showBlockTint) {
                const preRc = anim.preDriftCount != null ? anim.preDriftCount : 0;
                const rd = anim.driftDelta != null ? anim.driftDelta : 1;
                drawQuadrantTintAnimated(domPage.ctx, n, pad, cellSize, t, preRc, rd);
            }
            d.grid(domPage.ctx, n, pad, cellSize, cs);
            d.starPoints(domPage.ctx, n, pad, cellSize);
            d.coordLabels(domPage.ctx, n, pad, cellSize);
            const stoneRadius = cellSize * 0.44;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const v = rwSafeMatrixAt(preB, r, c);
                    if (!v) continue;
                    const [nr, nc] = rwDriftCell(r, c, half);
                    const x0 = pad + c * cellSize;
                    const y0 = pad + r * cellSize;
                    const x1 = pad + nc * cellSize;
                    const y1 = pad + nr * cellSize;
                    const x = x0 + (x1 - x0) * t;
                    const y = y0 + (y1 - y0) * t;
                    drawSingleStone(domPage.ctx, x, y, cellSize, v);
                    const moveNum = rwSafeMatrixAt(preH, r, c);
                    if (ps.showMoveNumbers && moveNum > 0) {
                        const numStr = String(moveNum);
                        const fontSize = Math.max(9, Math.floor(cellSize * (numStr.length >= 3 ? 0.308 : 0.396)));
                        domPage.ctx.font = `bold ${fontSize}px Arial`;
                        domPage.ctx.fillStyle = v === 1 ? '#fff' : '#000';
                        domPage.ctx.textAlign = 'center';
                        domPage.ctx.textBaseline = 'middle';
                        domPage.ctx.fillText(numStr, x, y + 1);
                    }
                }
            }
            if (anim.preMarkers && anim.preMarkers.length) {
                const pm = anim.preMarkers[0];
                const [nr, nc] = rwDriftCell(pm.row, pm.col, half);
                const x = pad + (pm.col + (nc - pm.col) * t) * cellSize;
                const y = pad + (pm.row + (nr - pm.row) * t) * cellSize;
                domPage.ctx.beginPath();
                domPage.ctx.moveTo(x, y);
                domPage.ctx.lineTo(x + cellSize * 0.352, y);
                domPage.ctx.lineTo(x, y + cellSize * 0.352);
                domPage.ctx.closePath();
                domPage.ctx.fillStyle = pm.color === 1 ? '#ffffff' : '#222222';
                domPage.ctx.fill();
            }
        }

        function runDriftAnimation(anim, msg, onDone) {
            ps.driftAnimating = true;
            const DURATION = 750;
            const t0 = performance.now();
            function easeOutQuad(u) {
                return 1 - (1 - u) * (1 - u);
            }
            function frame(now) {
                const u = Math.min(1, (now - t0) / DURATION);
                const t = easeOutQuad(u);
                drawDriftAnimFrame(anim, t);
                if (u < 1) requestAnimationFrame(frame);
                else {
                    ps.driftAnimating = false;
                    ps.board = msg.board.map(row => row.slice());
                    ps.handNumAt = (msg.handNumAt || []).map(row => row.slice());
                    ps.lastMoveMarkers = (msg.lastMoveMarkers || []).map(mm => ({ ...mm }));
                    driftDrawBoardImpl();
                    onDone && onDone();
                }
            }
            requestAnimationFrame(frame);
        }

        function driftDrawBoardImpl() {
                if (ps.driftAnimating) return;
                const d = C().draw;
                const cs = C().DEFAULT_CANVAS_SIZE;
                const cellSize = ps.CELL_SIZE;
                d.clear(domPage.ctx, cs);
                drawQuadrantTint(domPage.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs, ps.showBlockTint, ps.driftCount | 0);
                if (ps.blinkQuadrants) drawQuadrantWarningStroke(domPage.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                d.grid(domPage.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
                d.starPoints(domPage.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                d.coordLabels(domPage.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
                const stoneRadius = cellSize * 0.44;
                const markLenDefault = cellSize * 0.352;
                const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
                if (lowerLastMoveMarker) {
                    d.lastMoveMarkersLower(domPage.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
                }
                d.stonesBlackWhite(domPage.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
                if (!lowerLastMoveMarker) {
                    d.lastMoveMarkersUpper(domPage.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
                }
                d.userBoardMarks(domPage.ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt(ps));
                if (ps.showMoveNumbers && ps.handNumAt && ps.handNumAt.length === ps.BOARD_SIZE && ps.handNumAt[0].length === ps.BOARD_SIZE) {
                    d.moveNumbersOnStones(domPage.ctx, ps.handNumAt, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
                }
                d.hoverPreviewStone(domPage.ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
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
                    d.hoverCaptureRing(domPage.ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                        tryPlayMode: ps.tryPlayMode,
                        gameOver: ps.gameOver,
                        isMyTurn: ps.isMyTurn,
                        isHoverValid: ps.isHoverValid,
                        hoverCapture: !!ps.hoverCapture,
                        boardSize: ps.BOARD_SIZE
                    });
                }
                if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                    d.estimateOverlay(domPage.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
                }
        }

        function buildDriftReplayFromImport(data, tryPlaceStone, deepCopyBoard, createEmptyBoard) {
            let curBoard = createEmptyBoard();
            const boardSize = curBoard.length;
            const driftInterval = rwComputeInterval(boardSize);
            if (data.initialPosition && Array.isArray(data.initialPosition)) {
                R().applyInitialPositionCompact(curBoard, boardSize, data.initialPosition);
            }
            let handNumAt = rwInitZero(boardSize);
            let driftCount = 0;
            const replayBoards = [deepCopyBoard(curBoard)];
            const replayMarkers = [[]];
            const replayHandNumAts = [deepCopyBoard(handNumAt)];
            const replayDriftCounts = [0];
            const replayStepPlayers = [0];

            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'player1' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                const completedPlyCount = replayStepPlayers.length - 1;
                const driftNow = rwWillDriftThisPly(driftCount, driftInterval, completedPlyCount);
                if (move.type === 'move') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        if (curBoard[move.row][move.col] === 0) {
                            const placedOnly = deepCopyBoard(curBoard);
                            placedOnly[move.row][move.col] = playerVal;
                            rwSyncHand(placedOnly, handNumAt);
                            handNumAt[move.row][move.col] = completedPlyCount;
                            const half = boardSize / 2;
                            curBoard = rwDriftBoardLike(placedOnly, boardSize, (r, c) => rwDriftCell(r, c, half));
                            handNumAt = rwDriftBoardLike(handNumAt, boardSize, (r, c) => rwDriftCell(r, c, half));
                            const [pr, pc] = rwDriftCell(move.row, move.col, half);
                            rwApplyDriftPlyCaptures(curBoard, pr, pc, playerVal, boardSize, true);
                            rwSyncHand(curBoard, handNumAt);
                            driftCount++;
                            lastMoveMarkers = rwDriftMarkers(
                                [{ row: move.row, col: move.col, color: playerVal }],
                                boardSize
                            );
                        } else {
                            lastMoveMarkers = [];
                        }
                    } else {
                        const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                        if (newBoard) curBoard = newBoard;
                        rwSyncHand(curBoard, handNumAt);
                        handNumAt[move.row][move.col] = completedPlyCount;
                        const rot = rwMaybeDrift(
                            curBoard,
                            handNumAt,
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            [{ row: move.row, col: move.col, color: playerVal }]
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    replayHandNumAts.push(deepCopyBoard(handNumAt));
                    replayDriftCounts.push(driftCount);
                } else if (move.type === 'pass') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        const r = rwDriftQuadrantsClockwise(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            boardSize
                        );
                        rwApplyDriftPlyCaptures(r.board, 0, 0, playerVal, boardSize, false);
                        rwSyncHand(r.board, r.handNumAt);
                        curBoard = r.board;
                        handNumAt = r.handNumAt;
                        driftCount++;
                        lastMoveMarkers = rwDriftMarkers([], boardSize);
                    } else {
                        const rot = rwMaybeDrift(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            []
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    replayHandNumAts.push(deepCopyBoard(handNumAt));
                    replayDriftCounts.push(driftCount);
                }
            }
            return {
                replayBoards,
                replayMarkers,
                replayHandNumAts,
                replayDriftCounts,
                replayStepPlayers,
                replayTotalSteps: replayBoards.length - 1
            };
        }

        function rebuildLiveReplayDrift(moveCoords) {
            const syncedLen = ps.liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncrementalDrift(mcs)) return;
            }
            const boardSize = ps.BOARD_SIZE;
            const driftInterval = ps.driftInterval || rwComputeInterval(boardSize);
            const tryPlaceStone = (bb, r, c, pv) =>
                R().tryPlaceStoneNLiberty(bb, r, c, pv, boardSize, C().deepCopyBoard, 1);
            const deepCopyBoard = C().deepCopyBoard;
            const createEmptyBoard = () => QiSquareWeiqiCanvas.initBoardArray(boardSize);
            let curBoard = createEmptyBoard();
            let handNumAt = rwInitZero(boardSize);
            let driftCount = 0;
            const liveReplayBoards = [deepCopyBoard(curBoard)];
            const liveReplayMarkers = [[]];
            const liveReplayHandNumAts = [deepCopyBoard(handNumAt)];
            const liveReplayDriftCounts = [0];
            const liveReplayStepPlayers = [0];

            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'player1' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                const completedPlyCount = liveReplayStepPlayers.length - 1;
                const driftNow = rwWillDriftThisPly(driftCount, driftInterval, completedPlyCount);
                if (move.type === 'move') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        if (curBoard[move.row][move.col] === 0) {
                            const placedOnly = deepCopyBoard(curBoard);
                            placedOnly[move.row][move.col] = playerVal;
                            rwSyncHand(placedOnly, handNumAt);
                            handNumAt[move.row][move.col] = completedPlyCount;
                            const half = boardSize / 2;
                            curBoard = rwDriftBoardLike(placedOnly, boardSize, (r, c) => rwDriftCell(r, c, half));
                            handNumAt = rwDriftBoardLike(handNumAt, boardSize, (r, c) => rwDriftCell(r, c, half));
                            const [pr, pc] = rwDriftCell(move.row, move.col, half);
                            rwApplyDriftPlyCaptures(curBoard, pr, pc, playerVal, boardSize, true);
                            rwSyncHand(curBoard, handNumAt);
                            driftCount++;
                            lastMoveMarkers = rwDriftMarkers(
                                [{ row: move.row, col: move.col, color: playerVal }],
                                boardSize
                            );
                        } else {
                            lastMoveMarkers = [];
                        }
                    } else {
                        const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                        if (newBoard) curBoard = newBoard;
                        rwSyncHand(curBoard, handNumAt);
                        handNumAt[move.row][move.col] = completedPlyCount;
                        const rot = rwMaybeDrift(
                            curBoard,
                            handNumAt,
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            [{ row: move.row, col: move.col, color: playerVal }]
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    liveReplayHandNumAts.push(deepCopyBoard(handNumAt));
                    liveReplayDriftCounts.push(driftCount);
                } else if (move.type === 'pass') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        const r = rwDriftQuadrantsClockwise(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            boardSize
                        );
                        rwApplyDriftPlyCaptures(r.board, 0, 0, playerVal, boardSize, false);
                        rwSyncHand(r.board, r.handNumAt);
                        curBoard = r.board;
                        handNumAt = r.handNumAt;
                        driftCount++;
                        lastMoveMarkers = rwDriftMarkers([], boardSize);
                    } else {
                        const rot = rwMaybeDrift(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            []
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    liveReplayHandNumAts.push(deepCopyBoard(handNumAt));
                    liveReplayDriftCounts.push(driftCount);
                }
            }
            ps.liveReplayBoards = liveReplayBoards;
            ps.liveReplayMarkers = liveReplayMarkers;
            ps.liveReplayHandNumAts = liveReplayHandNumAts;
            ps.liveReplayDriftCounts = liveReplayDriftCounts;
            ps.liveReplayStepPlayers = liveReplayStepPlayers;
        }

        function applyLiveReplayIncrementalDrift(moveCoords) {
            const startLen = ps.liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            const boardSize = ps.BOARD_SIZE;
            const driftInterval = ps.driftInterval || rwComputeInterval(boardSize);
            const tryPlaceStone = (bb, r, c, pv) =>
                R().tryPlaceStoneNLiberty(bb, r, c, pv, boardSize, C().deepCopyBoard, 1);
            const deepCopyBoard = C().deepCopyBoard;
            let curBoard = deepCopyBoard(ps.liveReplayBoards[ps.liveReplayBoards.length - 1]);
            let handNumAt = deepCopyBoard(ps.liveReplayHandNumAts[ps.liveReplayHandNumAts.length - 1]);
            let driftCount = ps.liveReplayDriftCounts[ps.liveReplayDriftCounts.length - 1] || 0;
            for (let i = startLen; i < mcs.length; i++) {
                const move = mcs[i];

                const playerVal = move.player === 'player1' ? 1 : 2;
                ps.liveReplayStepPlayers.push(playerVal);
                const completedPlyCount = liveReplayStepPlayers.length - 1;
                const driftNow = rwWillDriftThisPly(driftCount, driftInterval, completedPlyCount);
                if (move.type === 'move') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        if (curBoard[move.row][move.col] === 0) {
                            const placedOnly = deepCopyBoard(curBoard);
                            placedOnly[move.row][move.col] = playerVal;
                            rwSyncHand(placedOnly, handNumAt);
                            handNumAt[move.row][move.col] = completedPlyCount;
                            const half = boardSize / 2;
                            curBoard = rwDriftBoardLike(placedOnly, boardSize, (r, c) => rwDriftCell(r, c, half));
                            handNumAt = rwDriftBoardLike(handNumAt, boardSize, (r, c) => rwDriftCell(r, c, half));
                            const [pr, pc] = rwDriftCell(move.row, move.col, half);
                            rwApplyDriftPlyCaptures(curBoard, pr, pc, playerVal, boardSize, true);
                            rwSyncHand(curBoard, handNumAt);
                            driftCount++;
                            lastMoveMarkers = rwDriftMarkers(
                                [{ row: move.row, col: move.col, color: playerVal }],
                                boardSize
                            );
                        } else {
                            lastMoveMarkers = [];
                        }
                    } else {
                        const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                        if (newBoard) curBoard = newBoard;
                        rwSyncHand(curBoard, handNumAt);
                        handNumAt[move.row][move.col] = completedPlyCount;
                        const rot = rwMaybeDrift(
                            curBoard,
                            handNumAt,
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            [{ row: move.row, col: move.col, color: playerVal }]
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    ps.liveReplayBoards.push(deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    ps.liveReplayHandNumAts.push(deepCopyBoard(handNumAt));
                    ps.liveReplayDriftCounts.push(driftCount);
                } else if (move.type === 'pass') {
                    let lastMoveMarkers;
                    if (driftNow) {
                        const r = rwDriftQuadrantsClockwise(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            boardSize
                        );
                        rwApplyDriftPlyCaptures(r.board, 0, 0, playerVal, boardSize, false);
                        rwSyncHand(r.board, r.handNumAt);
                        curBoard = r.board;
                        handNumAt = r.handNumAt;
                        driftCount++;
                        lastMoveMarkers = rwDriftMarkers([], boardSize);
                    } else {
                        const rot = rwMaybeDrift(
                            deepCopyBoard(curBoard),
                            deepCopyBoard(handNumAt),
                            driftCount,
                            boardSize,
                            driftInterval,
                            completedPlyCount,
                            []
                        );
                        curBoard = rot.board;
                        handNumAt = rot.handNumAt;
                        driftCount = rot.driftCount;
                        lastMoveMarkers = rot.lastMoveMarkers;
                    }
                    ps.liveReplayBoards.push(deepCopyBoard(curBoard));
                    ps.liveReplayMarkers.push((lastMoveMarkers || []).map(m => ({ ...m })));
                    ps.liveReplayHandNumAts.push(deepCopyBoard(handNumAt));
                    ps.liveReplayDriftCounts.push(driftCount);
                }
                else { return false; }
            }
            return true;
        }

        const pageHolder = { ref: null };
        // 标准围棋：形势判断/数点用 Benson 档（公共钩子；档位见 shell.useBenson）
        const scoringHooks = QiWeiqiSquarePageRuntime.weiqiScoringHooks(config.useBenson !== false, {
            boardSize: () => ps.BOARD_SIZE,
            maxWeakLiberties: 2
        });

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            ...scoringHooks,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            drawBoard: driftDrawBoardImpl,
            rebuildLiveReplayFromMoveCoords: rebuildLiveReplayDrift,
            tryPlaceStone(boardBefore, row, col, playerVal) {
                const coords = ps.lastSyncedMoveCoords || [];
                const completedPlyCount = coords.length + 1;
                const iv = ps.driftInterval != null ? ps.driftInterval : rwComputeInterval(ps.BOARD_SIZE);
                const driftNow = rwWillDriftThisPly(ps.driftCount | 0, iv, completedPlyCount);
                if (!driftNow) {
                    return R().tryPlaceStoneNLiberty(
                        boardBefore, row, col, playerVal, ps.BOARD_SIZE, C().deepCopyBoard, 1
                    );
                }
                if (boardBefore[row][col] !== 0) return null;
                const nb = C().deepCopyBoard(boardBefore);
                nb[row][col] = playerVal;
                const half = ps.BOARD_SIZE / 2;
                const rb = rwDriftBoardLike(nb, ps.BOARD_SIZE, (r, c) => rwDriftCell(r, c, half));
                const [pr, pc] = rwDriftCell(row, col, half);
                rwApplyDriftPlyCaptures(rb, pr, pc, playerVal, ps.BOARD_SIZE, true);
                return rb;
            },
            enterReplayMode(data) {
                ps.replayNavSource = null;
                const tryPlaceStone = (bb, r, c, pv) =>
                    R().tryPlaceStoneNLiberty(bb, r, c, pv, ps.BOARD_SIZE, C().deepCopyBoard, 1);
                const built = buildDriftReplayFromImport(
                    data,
                    tryPlaceStone,
                    R().deepCopyBoard,
                    () => QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE)
                );
                ps.replayBoards = built.replayBoards;
                ps.replayMarkers = built.replayMarkers;
                ps.replayHandNumAts = built.replayHandNumAts;
                ps.replayDriftCounts = built.replayDriftCounts || [];
                ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps;
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                pageHolder.ref.setReplayStep(ps.replayTotalSteps);
                pageHolder.ref.updateReplayUI();
            },
            setReplayStep(step) {
                const prevReplayStep = ps.replayStep;
                pageHolder.ref.clearMobileMovePreview();
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                ps.board = R().deepCopyBoard(ps.replayBoards[step]);
                ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
                ps.handNumAt = (ps.replayHandNumAts && ps.replayHandNumAts[step])
                    ? R().deepCopyBoard(ps.replayHandNumAts[step])
                    : rwInitZero(ps.BOARD_SIZE);
                if (ps.replayDriftCounts && ps.replayDriftCounts.length && step < ps.replayDriftCounts.length)
                    ps.driftCount = ps.replayDriftCounts[step] | 0;
                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;
                if (step === 0) {
                    domPage.turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                    domPage.turnDisplay.innerText = `${emoji} 第${step}手`;
                }
                ps.isMyTurn = false;

                const nav = ps.replayNavSource;
                ps.replayNavSource = null;
                const bs = ps.BOARD_SIZE;
                const rcs = ps.replayDriftCounts;

                if (ps.replayMode && !ps.tryPlayMode && nav === 'forward' && step > prevReplayStep && rcs && rcs.length) {
                    const rcStep = step < rcs.length ? (rcs[step] | 0) : (rcs[rcs.length - 1] | 0);
                    const rcPrevStep = step > 0 ? (rcs[step - 1] | 0) : 0;

                    if (step > 0 && rcStep > rcPrevStep) {
                        ps.blinkQuadrants = false;
                        const delta = rcStep - rcPrevStep;
                        const postBoard = R().deepCopyBoard(ps.replayBoards[step]);
                        const postHand = R().deepCopyBoard(ps.replayHandNumAts[step]);
                        const postMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
                        let preBoard = postBoard.map(row => row.slice());
                        let preHand = postHand.map(row => row.slice());
                        let preMarkers = postMarkers.map(m => ({ ...m }));
                        for (let i = 0; i < delta; i++) {
                            preBoard = rwUndriftBoardOnce(preBoard, bs);
                            preHand = rwUndriftBoardOnce(preHand, bs);
                            preMarkers = rwDriftMarkersCCW(preMarkers, bs);
                        }
                        const syntheticMsg = {
                            board: postBoard,
                            handNumAt: postHand,
                            lastMoveMarkers: postMarkers
                        };
                        const anim = {
                            preBoard,
                            postBoard,
                            preHandNumAt: preHand,
                            postHandNumAt: postHand,
                            preMarkers,
                            postMarkers,
                            preDriftCount: rcPrevStep,
                            driftDelta: delta
                        };
                        ps.board = preBoard.map(row => row.slice());
                        ps.handNumAt = preHand.map(row => row.slice());
                        ps.lastMoveMarkers = preMarkers.map(m => ({ ...m }));
                        ps.driftCount = rcPrevStep;
                        driftDrawBoardImpl();
                        runDriftAnimation(anim, syntheticMsg, () => {
                            ps.driftCount = rcStep;
                        });
                        return;
                    }
                    if (step < ps.replayTotalSteps && (rcs[step + 1] | 0) > (rcs[step] | 0)) {
                        ps.driftCount = rcStep;
                        if (ps.showEstimateActive) pageHolder.ref.showEstimate();
                        else driftDrawBoardImpl();
                        queueMicrotask(() => {
                            if (!ps.driftAnimating && ps.replayMode && !ps.tryPlayMode) startQuadrantBlink(true);
                        });
                        return;
                    }
                }

                if (ps.showEstimateActive) pageHolder.ref.showEstimate();
                else pageHolder.ref.drawBoard();
            }
        });
        pageHolder.ref = page;

        const origApplyLiveViewBoard = page.applyLiveViewBoard;
        page.applyLiveViewBoard = function () {
            origApplyLiveViewBoard();
            if (ps.liveReplayDriftCounts && ps.liveReplayDriftCounts.length) {
                const step = Math.max(0, ps.liveViewStep | 0);
                if (step < ps.liveReplayDriftCounts.length)
                    ps.driftCount = ps.liveReplayDriftCounts[step] | 0;
            }
            const bs = ps.BOARD_SIZE;
            const iv = ps.driftInterval != null ? ps.driftInterval : rwComputeInterval(bs);
            const step = Math.max(0, ps.liveViewStep | 0);
            if (ps.liveReplayHandNumAts && ps.liveReplayHandNumAts[step] &&
                ps.liveReplayHandNumAts[step].length === bs &&
                ps.liveReplayHandNumAts[step][0] && ps.liveReplayHandNumAts[step][0].length === bs) {
                ps.handNumAt = R().deepCopyBoard(ps.liveReplayHandNumAts[step]);
                return;
            }
            const coords = ps.lastSyncedMoveCoords;
            if (!coords || !coords.length) {
                ps.handNumAt = rwInitZero(bs);
                return;
            }
            const sliced = coords.slice(0, step);
            ps.handNumAt = recomputeHandNumAtFromMoves(sliced, bs, iv);
        };

        const origSync = page.syncState;
        page.syncState = function (state) {
            const prevRc = ps.driftCount | 0;
            const nr = state.driftCount | 0;
            const prevAnim = ps.lastDriftCountForAnim;
            if (prevAnim != null && nr > prevRc) {
                const n = state.boardSize || ps.BOARD_SIZE;
                for (let i = 0; i < nr - prevRc; i++) rwDriftUserBoardMarks(ps.userBoardMarks, n);
            }
            const bs = state.boardSize || ps.BOARD_SIZE;
            const iv = state.driftInterval != null ? state.driftInterval : rwComputeInterval(bs);
            ps.driftInterval = iv;
            ps.driftCount = nr;
            ps.handNumAt = rwNormalizeMatrix(state.handNumAt || ps.handNumAt, bs);
            ps.lastSyncedMoveCoords = (state.moveCoords && state.moveCoords.length)
                ? state.moveCoords.map(m => ({ ...m }))
                : [];
            origSync(state);
            if (!tryApplyHandNumAtFromState(state)) {
                const bs2 = ps.BOARD_SIZE;
                const iv2 = ps.driftInterval != null ? ps.driftInterval : rwComputeInterval(bs2);
                if (ps.replayMode && ps.lastSyncedMoveCoords && ps.lastSyncedMoveCoords.length) {
                    ps.handNumAt = recomputeHandNumAtFromMoves(ps.lastSyncedMoveCoords, bs2, iv2);
                } else if (ps.lastSyncedMoveCoords && ps.lastSyncedMoveCoords.length) {
                    ps.handNumAt = recomputeHandNumAtFromMoves(ps.lastSyncedMoveCoords, bs2, iv2);
                } else {
                    ps.handNumAt = rwInitZero(bs2);
                }
            }
            const mc = ps.lastSyncedMoveCoords.length;
            const browsing = isBrowsingLiveReplay(ps);
            /** importSuccess 的整包 state 会带 replayData，此时只追局面不要播对局漂移/闪烁 */
            const syncingImportedReplay = state.replayData != null;
            if (!syncingImportedReplay && prevAnim != null && mc > 0 && (mc + 1) % iv === 0 && (ps.driftCount | 0) < RW_MAX_ROT && !ps.replayMode && !browsing && !ps.driftAnimating) {
                queueMicrotask(() => {
                    if (!ps.driftAnimating && !ps.replayMode && !isBrowsingLiveReplay(ps)) startQuadrantBlink();
                });
            }
            const deltaAnim = prevAnim != null ? nr - prevAnim : 0;
            const ra = state.driftAnimation;
            /** 服务端带 driftAnimation 时：pre=漂移前（未提子）、post=漂移后且已提子；应用后先播漂移，结束再显示提子。勿用「对 post 做逆漂移」推导 pre（post 已提子会丢子）。 */
            if (!syncingImportedReplay && ra && ra.preBoard && ra.postBoard && !ps.replayMode && !browsing && !ps.driftAnimating) {
                const driftDelta = Math.max(1, (nr - prevRc) || deltaAnim || 1);
                const anim = {
                    preBoard: ra.preBoard.map(row => row.slice()),
                    postBoard: ra.postBoard.map(row => row.slice()),
                    preHandNumAt: ra.preHandNumAt ? ra.preHandNumAt.map(row => row.slice()) : null,
                    postHandNumAt: ra.postHandNumAt ? ra.postHandNumAt.map(row => row.slice()) : null,
                    preMarkers: (ra.preMarkers || []).map(m => ({ ...m })),
                    postMarkers: (ra.postMarkers || []).map(m => ({ ...m })),
                    preDriftCount: prevRc,
                    driftDelta
                };
                const syntheticMsg = {
                    board: anim.postBoard,
                    handNumAt: anim.postHandNumAt || ps.handNumAt.map(row => row.slice()),
                    lastMoveMarkers: anim.postMarkers
                };
                ps.board = anim.preBoard.map(row => row.slice());
                ps.handNumAt = anim.preHandNumAt
                    ? anim.preHandNumAt.map(row => row.slice())
                    : rwInitZero(bs);
                ps.lastMoveMarkers = anim.preMarkers.map(m => ({ ...m }));
                driftDrawBoardImpl();
                runDriftAnimation(anim, syntheticMsg, null);
            } else if (!syncingImportedReplay && deltaAnim > 0 && prevAnim != null && !ps.replayMode && !browsing && !ps.driftAnimating) {
                const postBoard = ps.board.map(row => row.slice());
                const postHand = ps.handNumAt.map(row => row.slice());
                const postMarkers = (ps.lastMoveMarkers || []).map(m => ({ ...m }));
                let preBoard = postBoard.map(row => row.slice());
                let preHand = postHand.map(row => row.slice());
                let preMarkers = postMarkers.map(m => ({ ...m }));
                for (let i = 0; i < deltaAnim; i++) {
                    preBoard = rwUndriftBoardOnce(preBoard, bs);
                    preHand = rwUndriftBoardOnce(preHand, bs);
                    preMarkers = rwDriftMarkersCCW(preMarkers, bs);
                }
                const syntheticMsg = {
                    board: postBoard,
                    handNumAt: postHand,
                    lastMoveMarkers: postMarkers
                };
                const anim = {
                    preBoard,
                    postBoard,
                    preHandNumAt: preHand,
                    postHandNumAt: postHand,
                    preMarkers,
                    postMarkers,
                    preDriftCount: prevAnim,
                    driftDelta: deltaAnim
                };
                ps.board = preBoard.map(row => row.slice());
                ps.handNumAt = preHand.map(row => row.slice());
                ps.lastMoveMarkers = preMarkers.map(m => ({ ...m }));
                driftDrawBoardImpl();
                runDriftAnimation(anim, syntheticMsg, null);
            }
            ps.lastDriftCountForAnim = nr;
        };

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
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
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
syncState: page.syncState,
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
            isMouseDevice});
        const baseRoomHandleMessage = _weiqiBindings.handleMessage;
        function handleMessage(msg) {
            if (msg.type === 'joined' || msg.type === 'newGameStarted' || msg.type === 'roomReset' || msg.type === 'importSuccess') {
                ps.lastDriftCountForAnim = null;
            }
            baseRoomHandleMessage(msg);
        }

        (function wireReplayNavSource() {
            const fwd = document.getElementById('replayForwardBtn');
            const back = document.getElementById('replayBackBtn');
            const slider = document.getElementById('replaySlider');
            if (fwd) {
                fwd.addEventListener('click', () => {
                    if (ps.replayMode && !ps.tryPlayMode) ps.replayNavSource = 'forward';
                }, true);
            }
            if (back) {
                back.addEventListener('click', () => {
                    if (ps.replayMode && !ps.tryPlayMode) ps.replayNavSource = 'back';
                }, true);
            }
            if (slider) {
                slider.addEventListener('input', () => {
                    if (ps.replayMode && !ps.tryPlayMode) ps.replayNavSource = 'slider';
                }, true);
            }
        })();
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
            if (ps.driftAnimating) return;
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
        connectWebSocket(handleMessage);
        })();
    }
};
