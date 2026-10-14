window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["lines-of-action"] = {
    shell: {
        "title": "集结棋",
        "rulesHtml": "双方轮流行动，白先黑后。每回合选一枚己方棋子：沿正向或斜向走<b>正好等于这条线上所有棋子总数</b>的格数。"
            + "途中可以穿过己方棋子，但<b>不能穿过对方棋子</b>。落点必须是空格或对方棋子所在的格，后者会将对方的这枚棋子提掉。<br /><br />"
            + "把己方全部棋子连成一片（正向斜向均算相连）获胜，无子可动则对方获胜。同一局面出现三次时和棋。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 5,
        "boardSizeMax": 15,
        "defaultBoardSize": 8,
        "minLib": 1,
        "recordDownloadPrefix": "集结棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "woodTexture": true,
            "editBoard": true,
            "customTimeControl": true
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
        "boardSizeStep": 1,
        "boardSizeValues": [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "集结棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
(function () {
            const ps = {
                BOARD_SIZE: 8,
                PADDING: 45,
                CELL_SIZE: 56,
                board: [],
                blackCount: 0,
                whiteCount: 0,
                selectedRow: -1,
                selectedCol: -1,
                legalTargets: [],
                passNotice: null,
                openingBoard: null,
                numberOfHands: 1,
                currentPlayer: 1,
                mySlot: null,
                gameOver: false,
                winner: null,
                lastMoveMarkers: [],
                slots: { player2: false, player1: false },
                ws: null,
                reconnectTimer: null,
                moveLog: [],
                showMoveNumbers: false,
                replayMode: false,
                replayBoards: [],
                replayMarkers: [],
                replayStepPlayers: [],
                replayScores: [],
                replayCurrentPlayers: [],
                replayGameOvers: [],
                replayWinners: [],
                replayStep: 0,
                replayTotalSteps: 0,
                tryPlayMode: false,
                tryPlayFromLive: false,
                tryPlayBaseStep: 0,
                tryPlayBoards: [],
                tryPlayMarkers: [],
                tryPlayStepPlayers: [],
                tryPlayScores: [],
                tryPlayCurrentPlayers: [],
                tryPlayGameOvers: [],
                tryPlayWinners: [],
                tryPlayStep: 0,
                tryPlayTotalSteps: 0,
                tryPlayBranchMoves: [],
                hoverRow: -1,
                hoverCol: -1,
                isHoverValid: false,
                matchStarted: false,
                matchTime: null,
                matchStartedOnce: false
            };

const canvas = document.getElementById('goBoard');
            const ctx = canvas.getContext('2d');
            const turnDisplay = document.getElementById('turnDisplay');
            const scoreBoard = document.getElementById('scoreBoard');
            const leadInfo = document.getElementById('leadInfo');
            const scoreTitle = document.getElementById('scoreTitle');
            const colorStatus = document.getElementById('colorStatus');
            const komiInfo = document.getElementById('komiInfo');
            if (komiInfo) {
                komiInfo.hidden = true;
                komiInfo.style.display = 'none';
            }
const boardSizeSelect = document.getElementById('boardSizeSelect');
            /** 路数选择：观战者、无人入座、未开局、无着法时才可改（与服务端 setBoardSize 的门槛一致） */
            function canChangeBoardSize() {
                const anySeat = !!(ps.slots && (ps.slots.player1 || ps.slots.player2));
                const hasMoves = !!(ps.moveLog && ps.moveLog.length > 0);
                return !ps.gameOver && !ps.mySlot && !ps.replayMode && !ps.tryPlayMode
                    && !anySeat && !hasMoves;
            }
            const showNumbersCheck = document.getElementById('showNumbersCheck');

            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            function updateGeometry() {
                const n = ps.BOARD_SIZE;
                ps.PADDING = 63 - 2 * n;
                ps.CELL_SIZE = (600 - 2 * ps.PADDING) / n;
            }

            /* ===== 集结棋规则工具（与服务器 games/lines-of-action.js 保持同一套实现）===== */
            const NT_DIRS = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ];

            function ntInBounds(n, r, c) { return r >= 0 && r < n && c >= 0 && c < n; }

            /** 一子的全部落点：沿 8 方向滑到最远的连续空格 */
            /** 这一方向上整条线上的棋子数（含自己、黑白都算）——要走的格数 */
            function ntLinePieceCount(board, n, row, col, dr, dc) {
                let k = 1;
                for (const sign of [1, -1]) {
                    let r = row + dr * sign;
                    let c = col + dc * sign;
                    while (ntInBounds(n, r, c)) {
                        if (board[r][c] !== 0) k += 1;
                        r += dr * sign;
                        c += dc * sign;
                    }
                }
                return k;
            }

            /** 落点：沿线走「线上棋子总数」格；可穿己方子、不可穿对方子；落点为空位或对方棋子（吃掉） */
            function ntMovesOf(board, n, row, col) {
                const out = [];
                if (!ntInBounds(n, row, col)) return out;
                const mine = board[row][col];
                if (mine === 0) return out;
                for (const [dr, dc] of NT_DIRS) {
                    const k = ntLinePieceCount(board, n, row, col, dr, dc);
                    const tr = row + dr * k;
                    const tc = col + dc * k;
                    if (!ntInBounds(n, tr, tc)) continue;
                    if (board[tr][tc] === mine) continue;
                    let blocked = false;
                    for (let step = 1; step < k; step++) {
                        if (board[row + dr * step][col + dc * step] === 3 - mine) { blocked = true; break; }
                    }
                    if (blocked) continue;
                    out.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
                }
                return out;
            }

            /** 某方全部合法着法 */
            function ntLegalMoves(board, n, val) {
                const out = [];
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (board[r][c] !== val) continue;
                        for (const m of ntMovesOf(board, n, r, c)) out.push(m);
                    }
                }
                return out;
            }

            function ntHasMove(board, n, val) {
                return ntLegalMoves(board, n, val).length > 0;
            }

            /** 走子（返回新棋盘，不改原盘）：落到对方棋子上就把它吃掉 */
            function ntApplyOn(board, n, fr, fc, tr, tc) {
                const nb = board.map((row) => row.slice());
                nb[fr][fc] = 0;
                nb[tr][tc] = board[fr][fc];
                return nb;
            }

            /**
             * 该方是否已把全部棋子连成一片（横/竖/斜相邻都算）。
             * 只剩一枚算相连；一枚不剩（只可能出现在手摆/编辑的局面）不算相连。
             */
            function ntIsConnected(board, n, val) {
                const cells = [];
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (board[r][c] === val) cells.push([r, c]);
                    }
                }
                if (cells.length === 0) return false;
                if (cells.length === 1) return true;
                const key = (r, c) => r + ',' + c;
                const seen = new Set([key(cells[0][0], cells[0][1])]);
                const queue = [cells[0]];
                for (let head = 0; head < queue.length; head++) {
                    const [r, c] = queue[head];
                    for (const [dr, dc] of NT_DIRS) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (!ntInBounds(n, nr, nc) || board[nr][nc] !== val) continue;
                        if (seen.has(key(nr, nc))) continue;
                        seen.add(key(nr, nc));
                        queue.push([nr, nc]);
                    }
                }
                return seen.size === cells.length;
            }

            /**
             * 开局（row 0 在下、白先 player1 执白）：白方占上、下两条横排（不含四角），
             * 黑方占左、右两条竖列（不含四角）——「角落不放棋、边上摆满」，每方 2×(n-2) 枚。
             */
            function initialBoard(n) {
                const board = Array.from({ length: n }, () => Array(n).fill(0));
                for (let c = 1; c <= n - 2; c++) {
                    board[0][c] = 2;
                    board[n - 1][c] = 2;
                }
                for (let r = 1; r <= n - 2; r++) {
                    board[r][0] = 1;
                    board[r][n - 1] = 1;
                }
                return board;
            }

            function initBoardArrays() {
                ps.board = initialBoard(ps.BOARD_SIZE);
            }

            /** 黑白棋隐藏了 komiInfo 行，此处保留空实现以免各处调用失效 */
            function updateKomiText() { /* 不显示 */ }

            /** 集结棋不旋转视角：双方、观战都按同一方向看棋盘（白方在上、下两条横排） */
            function viewFlipped() { return false; }

            function boardCenterOfCell(row, col) {
                const n = ps.BOARD_SIZE;
                const dr = viewFlipped() ? row : (n - 1 - row);
                const dc = viewFlipped() ? (n - 1 - col) : col;
                return {
                    x: ps.PADDING + dc * ps.CELL_SIZE + ps.CELL_SIZE / 2,
                    y: ps.PADDING + dr * ps.CELL_SIZE + ps.CELL_SIZE / 2
                };
            }

            function getClosestCell(x, y) {
                let best = { row: -1, col: -1, dist: Infinity };
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        const p = boardCenterOfCell(r, c);
                        const d = Math.hypot(x - p.x, y - p.y);
                        if (d < best.dist) best = { row: r, col: c, dist: d };
                    }
                }
                return { row: best.row, col: best.col };
            }

            /** 当前显示局面里行棋方的数值（1 黑 / 2 白） */
            function sideValNow() { return ps.currentPlayer | 0; }

            /** 现在能否操作棋盘（我的回合 / 试下局面） */
            function boardInteractive() {
                if (ps.gameOver) return false;
                if (ps.tryPlayMode) return true;
                if (ps.replayMode) return false;
                return isMyTurn() || !!ps.editModeEnabled;
            }

            /** 该格是否是「可以动的己方棋子」 */
            function isMovablePiece(row, col) {
                if (!boardInteractive()) return false;
                const v = sideValNow();
                if (v !== 1 && v !== 2) return false;
                if (row < 0 || col < 0 || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE) return false;
                if (ps.board[row][col] !== v) return false;
                return ntMovesOf(ps.board, ps.BOARD_SIZE, row, col).length > 0;
            }

            function isLegalTarget(row, col) {
                return ps.legalTargets.some((t) => t.row === row && t.col === col);
            }

            /** 按当前选中棋子刷新落点列表 */
            function refreshLegalTargets() {
                ps.legalTargets = [];
                if (ps.selectedRow < 0) return;
                const moves = ntMovesOf(ps.board, ps.BOARD_SIZE, ps.selectedRow, ps.selectedCol);
                const seen = {};
                for (const m of moves) {
                    const k = m.toRow + ',' + m.toCol;
                    if (seen[k]) continue;
                    seen[k] = true;
                    ps.legalTargets.push({ row: m.toRow, col: m.toCol });
                }
            }

            function clearSelection() {
                ps.selectedRow = -1;
                ps.selectedCol = -1;
                ps.legalTargets = [];
            }

            function drawBoard() {
                // 底色由 canvas 的 CSS 背景提供（公共木纹），此处只画格线与棋子
                ctx.clearRect(0, 0, 600, 600);

                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#3a281c';
                for (let i = 0; i <= ps.BOARD_SIZE; i++) {
                    const x = ps.PADDING + i * ps.CELL_SIZE;
                    const y = ps.PADDING + i * ps.CELL_SIZE;
                    ctx.beginPath();
                    ctx.moveTo(x, ps.PADDING);
                    ctx.lineTo(x, 600 - ps.PADDING);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(ps.PADDING, y);
                    ctx.lineTo(600 - ps.PADDING, y);
                    ctx.stroke();
                }

                // 坐标字号与其它棋类一致（围棋等用的就是 250 / 路数）
                ctx.font = `bold ${250 / ps.BOARD_SIZE}px Arial`;
                ctx.fillStyle = '#3a281c';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let col = 0; col < ps.BOARD_SIZE; col++) {
                    const letter = String.fromCharCode(65 + col);
                    const p = boardCenterOfCell(0, col);
                    ctx.fillText(letter, p.x, 0.6 * ps.PADDING);
                }
                for (let row = 0; row < ps.BOARD_SIZE; row++) {
                    const p = boardCenterOfCell(row, 0);
                    // 与其它棋类一致：最下面一行编号为 1
                    ctx.fillText(String(row + 1), 0.5 * ps.PADDING, p.y);
                }

                const stoneRadius = ps.CELL_SIZE * 0.38;

                // 最后落子：与国际象棋一致，把移动前/后的格子涂成淡黄
                for (const marker of ps.lastMoveMarkers) {
                    const p = boardCenterOfCell(marker.row, marker.col);
                    ctx.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx.fillRect(p.x - ps.CELL_SIZE / 2, p.y - ps.CELL_SIZE / 2, ps.CELL_SIZE, ps.CELL_SIZE);
                }

                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c2 = 0; c2 < ps.BOARD_SIZE; c2++) {
                        const v = ps.board[r][c2];
                        if (v === 0) continue;
                        const p = boardCenterOfCell(r, c2);
                        const grad = ctx.createRadialGradient(p.x - 3, p.y - 3, stoneRadius * 0.2, p.x, p.y, stoneRadius * 1.2);
                        if (v === 1) {
                            grad.addColorStop(0, '#444');
                            grad.addColorStop(0.6, '#222');
                            grad.addColorStop(1, '#111');
                        } else {
                            grad.addColorStop(0, '#fff');
                            grad.addColorStop(0.5, '#eee');
                            grad.addColorStop(1, '#aaa');
                        }
                        ctx.save();
                        ctx.shadowBlur = 6;
                        ctx.shadowColor = 'rgba(0,0,0,0.5)';
                        ctx.shadowOffsetY = 2;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, stoneRadius, 0, Math.PI * 2);
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.restore();
                    }
                }


                // 可落点提示：与其它棋类一致的小方块，按行棋方着色（白方白块、黑方黑块、带反色描边）
                // 落点上有对方棋子时（走上去就吃掉），照吃子类棋种的红圈标出来
                if (ps.legalTargets.length) {
                    const v = sideValNow();
                    const half = ps.CELL_SIZE * 0.12;
                    ctx.fillStyle = v === 1 ? '#111111' : '#ffffff';
                    for (const t of ps.legalTargets) {
                        const p = boardCenterOfCell(t.row, t.col);
                        if (ps.board[t.row][t.col] !== 0) {
                            ctx.save();
                            ctx.strokeStyle = '#d62828';
                            ctx.lineWidth = Math.max(1.5, ps.CELL_SIZE * 0.055);
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, stoneRadius + 2, 0, Math.PI * 2);
                            ctx.stroke();
                            ctx.restore();
                            continue;
                        }
                        ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
                    }
                }

                // 选中棋子：方形线圈
                if (ps.selectedRow >= 0 && ps.board[ps.selectedRow][ps.selectedCol]) {
                    const p = boardCenterOfCell(ps.selectedRow, ps.selectedCol);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(163,92,39,0.9)';
                    const half = stoneRadius + 3;
                    ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
                }

                if (!ps.gameOver && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    let hoverColor = null;
                    if (ps.editModeEnabled) {
                        // 编辑悬停预览：按当前工具着色（空 = 无预览）
                        const t = ps.editTool || 'empty';
                        if (t === 'white') hoverColor = '#fff';
                        else if (t === 'black') hoverColor = '#222';
                        else if (t !== 'empty') hoverColor = '#666';
                    } else if (ps.tryPlayMode) {
                        hoverColor = ps.currentPlayer === 1 ? '#222' : '#fff';
                    } else if (ps.selectedRow >= 0 && isLegalTarget(ps.hoverRow, ps.hoverCol)) {
                        hoverColor = sideValNow() === 1 ? '#222' : '#fff';
                    }
                    if (hoverColor) {
                        const p = boardCenterOfCell(ps.hoverRow, ps.hoverCol);
                        ctx.save();
                        ctx.globalAlpha = 0.42;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, stoneRadius, 0, Math.PI * 2);
                        ctx.fillStyle = hoverColor;
                        ctx.fill();
                        ctx.restore();
                    }
                }
            }

            function updateScoreBoard() {
                // 集结棋显示双方子数（吃子后变化），并把「已相连」标出来
                const countOf = (v) => {
                    let k = 0;
                    for (let r = 0; r < ps.BOARD_SIZE; r++) {
                        for (let c = 0; c < ps.BOARD_SIZE; c++) if (ps.board[r][c] === v) k += 1;
                    }
                    return k;
                };
                const n = ps.BOARD_SIZE;
                const w = countOf(2);
                const b = countOf(1);
                const wDone = w > 0 && ntIsConnected(ps.board, n, 2);
                const bDone = b > 0 && ntIsConnected(ps.board, n, 1);
                scoreTitle.textContent = '　';
                scoreBoard.textContent = '　';
                leadInfo.textContent = ps.gameOver
                    ? QiWeiqiSquarePageRuntime.gameResultTitleText(ps, (w) => (w === 'player2' ? '黑胜' : '白胜'))
                    : '　';
            }

            function updateTurn() {
                updateActionButtons();
                if (ps.tryPlayMode) {
                    const stepDisplay = document.getElementById('replayStepDisplay');
                    stepDisplay.textContent = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                    const emoji = ps.currentPlayer === 1 ? '⚫' : '⚪';
                    turnDisplay.textContent = `${emoji} 试下`;
                    return;
                }
                if (ps.replayMode) {
                    if (ps.replayStep <= 0) {
                        turnDisplay.textContent = '初始局面';
                    } else {
                        const playerVal = ps.replayStepPlayers[ps.replayStep] || 0;
                        const emoji = playerVal === 1 ? '⚫' : '⚪';
                        turnDisplay.textContent = '打谱·' + QiWeiqiSquarePageRuntime.roundTurnText(ps.replayStep, emoji);
                    }
                    return;
                }
                if (ps.gameOver) {
                    turnDisplay.textContent = '对局结束';
                    return;
                }
                const hasStarted = !!(ps.matchStarted || ps.matchStartedOnce);
                if (!hasStarted) {
                    turnDisplay.textContent = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                    if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
                    return;
                }
                const n = ps.moveLog.length;
                if (n === 0) {
                    turnDisplay.textContent = '初始局面';
                } else {
                    const m = ps.moveLog[n - 1];
                    const moverLabel = (m && m.player === 'player1') ? '⚪' : '⚫';
                    turnDisplay.textContent = QiWeiqiSquarePageRuntime.roundTurnText(n, moverLabel);
                }
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

            function updateReplayUI() {
                if (ps.tryPlayMode) return;
                const n = ps.BOARD_SIZE;
                // 结子棋开局即有子：回放起点必须是开局局面，不能是空盘
                const baseBoard = (ps.openingBoard && ps.openingBoard.length === n)
                    ? ps.openingBoard.map((row) => row.slice())
                    : initialBoard(n);
                const replayBoards = [baseBoard.map((row) => row.slice())];
                const replayMarkers = [[]];
                const replayStepPlayers = [0];
                const replayScores = [{ blackScore: 0, whiteScore: 0 }];
                const replayCurrentPlayers = [2];
                const replayGameOvers = [false];
                const replayWinners = [null];

                let curBoard = baseBoard.map((row) => row.slice());
                let curPlayer = 2;
                let curOver = false;
                let curWinner = null;

                for (const m of ps.moveLog) {
                    if (!m || m.type !== 'move') continue;
                    const fromRow = m.fromRow;
                    const fromCol = m.fromCol;
                    const toRow = m.toRow;
                    const toCol = m.toCol;
                    if (curBoard[fromRow] === undefined || curBoard[toRow] === undefined) continue;
                    if (curBoard[fromRow][fromCol] !== curPlayer) continue;
                    if (!ntMovesOf(curBoard, n, fromRow, fromCol).some((x) => x.toRow === toRow && x.toCol === toCol)) continue;
                    curBoard = ntApplyOn(curBoard, n, fromRow, fromCol, toRow, toCol);
                    const oppVal = curPlayer === 1 ? 2 : 1;
                    const movedVal = curPlayer;
                    const movedDone = ntIsConnected(curBoard, n, movedVal);
                    const oppDone = ntIsConnected(curBoard, n, oppVal);
                    if (movedDone && oppDone) {
                        curOver = true;
                        curWinner = 'draw';
                    } else if (movedDone) {
                        curOver = true;
                        curWinner = movedVal === 1 ? 'black' : 'white';
                    } else if (oppDone) {
                        curOver = true;
                        curWinner = oppVal === 1 ? 'black' : 'white';
                    } else if (!ntHasMove(curBoard, n, oppVal)) {
                        curOver = true;
                        curWinner = movedVal === 1 ? 'black' : 'white';
                    } else {
                        curPlayer = oppVal;
                    }

                    replayBoards.push(curBoard.map((r) => r.slice()));
                    replayMarkers.push([
                        { row: fromRow, col: fromCol, color: movedVal },
                        { row: toRow, col: toCol, color: movedVal }
                    ]);
                    replayStepPlayers.push(movedVal);
                    replayScores.push({ blackScore: 0, whiteScore: 0 });
                    replayCurrentPlayers.push(curPlayer);
                    replayGameOvers.push(curOver);
                    replayWinners.push(curWinner);
                }

                ps.replayBoards = replayBoards;
                ps.replayMarkers = replayMarkers;
                ps.replayStepPlayers = replayStepPlayers;
                ps.replayScores = replayScores;
                ps.replayCurrentPlayers = replayCurrentPlayers;
                ps.replayGameOvers = replayGameOvers;
                ps.replayWinners = replayWinners;
                const total = replayBoards.length - 1;
                ps.replayTotalSteps = total;
                ps.replayStep = total;
                const slider = document.getElementById('replaySlider');
                slider.max = total;
                slider.value = total;
                document.getElementById('replayStepDisplay').textContent = `${total} / ${total}`;

                ps.board = replayBoards[total].map((row) => row.slice());
                ps.lastMoveMarkers = (replayMarkers[total] || []).map((m) => ({ ...m }));
                ps.currentPlayer = replayCurrentPlayers[total];
                ps.gameOver = replayGameOvers[total];
                ps.winner = replayWinners[total];
                clearSelection();
            }

            function setReplayStep(step) {
                if (ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                ps.replayMode = step < ps.replayTotalSteps;
                if (!ps.replayBoards.length) return;

                const board = ps.replayBoards[step];
                ps.board = board.map((row) => row.slice());
                const mk = ps.replayMarkers[step] || [];
                ps.lastMoveMarkers = mk.map((m) => ({ ...m }));

                ps.currentPlayer = ps.replayCurrentPlayers[step] || 2;
                ps.gameOver = !!ps.replayGameOvers[step];
                ps.winner = ps.replayWinners[step] || null;
                clearSelection();

                document.getElementById('replaySlider').value = String(step);
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.replayTotalSteps}`;
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            function setTryPlayStep(step) {
                if (!ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                ps.board = ps.tryPlayBoards[step].map((r) => r.slice());
                ps.lastMoveMarkers = (ps.tryPlayMarkers[step] || []).map((m) => ({ ...m }));
                ps.currentPlayer = ps.tryPlayCurrentPlayers[step];
                ps.gameOver = !!ps.tryPlayGameOvers[step];
                ps.winner = ps.tryPlayWinners[step];
                clearSelection();
                const slider = document.getElementById('replaySlider');
                slider.value = String(step);
                slider.max = ps.tryPlayTotalSteps;
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.tryPlayTotalSteps}`;
                if (ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    ps.isHoverValid = isMovablePiece(ps.hoverRow, ps.hoverCol);
                } else {
                    ps.isHoverValid = false;
                }
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            /** 试下：走子（滑行），并推进轮次 / 判胜（本棋种规则） */
            function tryPlayTryMove(fromRow, fromCol, toRow, toCol) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                const t = ps.tryPlayStep;
                const playerVal = ps.tryPlayCurrentPlayers[t];
                if (!(playerVal === 1 || playerVal === 2)) return false;
                const curBoard = ps.tryPlayBoards[t].map((r) => r.slice());
                if (curBoard[fromRow] === undefined || curBoard[fromRow][fromCol] !== playerVal) return false;
                if (!ntMovesOf(curBoard, ps.BOARD_SIZE, fromRow, fromCol)
                    .some((x) => x.toRow === toRow && x.toCol === toCol)) return false;

                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = t + 1;
                    ps.tryPlayMarkers.length = t + 1;
                    ps.tryPlayStepPlayers.length = t + 1;
                    ps.tryPlayScores.length = t + 1;
                    ps.tryPlayCurrentPlayers.length = t + 1;
                    ps.tryPlayGameOvers.length = t + 1;
                    ps.tryPlayWinners.length = t + 1;
                    ps.tryPlayBranchMoves.length = t;
                }
                const nextBoard = ntApplyOn(curBoard, ps.BOARD_SIZE, fromRow, fromCol, toRow, toCol);
                const oppVal = playerVal === 1 ? 2 : 1;
                const slot = playerVal === 1 ? 'player2' : 'player1';
                let curPlayer = oppVal;
                let curOver = false;
                let curWinner = null;
                const movedDone = ntIsConnected(nextBoard, ps.BOARD_SIZE, playerVal);
                const oppDone = ntIsConnected(nextBoard, ps.BOARD_SIZE, oppVal);
                if (movedDone && oppDone) {
                    curOver = true;
                    curWinner = 'draw';
                } else if (movedDone) {
                    curOver = true;
                    curWinner = slot;
                } else if (oppDone) {
                    curOver = true;
                    curWinner = oppVal === 1 ? 'player2' : 'player1';
                } else if (!ntHasMove(nextBoard, ps.BOARD_SIZE, oppVal)) {
                    curOver = true;
                    curWinner = slot;
                }
                ps.tryPlayBranchMoves.push({ type: 'move', fromRow, fromCol, toRow, toCol, player: slot });
                ps.tryPlayBoards.push(nextBoard.map((r) => r.slice()));
                ps.tryPlayMarkers.push([
                    { row: fromRow, col: fromCol, color: playerVal },
                    { row: toRow, col: toCol, color: playerVal }
                ]);
                ps.tryPlayStepPlayers.push(playerVal);
                ps.tryPlayScores.push({ blackScore: 0, whiteScore: 0 });
                ps.tryPlayCurrentPlayers.push(curPlayer);
                ps.tryPlayGameOvers.push(curOver);
                ps.tryPlayWinners.push(curWinner);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                setTryPlayStep(ps.tryPlayStep);
                return true;
            }

            function enterTryPlay() {
                updateReplayUI();
                const wasReplay = ps.replayMode;
                const base = wasReplay ? ps.replayStep : ps.replayTotalSteps;
                ps.tryPlayFromLive = !wasReplay;
                ps.tryPlayMode = true;
                ps.tryPlayBaseStep = base;
                if (!wasReplay) ps.replayMode = true;
                ps.tryPlayBoards = [ps.replayBoards[base].map((r) => r.slice())];
                ps.tryPlayMarkers = [(ps.replayMarkers[base] || []).map((m) => ({ ...m }))];
                ps.tryPlayStepPlayers = [ps.replayStepPlayers[base]];
                ps.tryPlayScores = [{ ...ps.replayScores[base] }];
                ps.tryPlayCurrentPlayers = [ps.replayCurrentPlayers[base]];
                ps.tryPlayGameOvers = [!!ps.replayGameOvers[base]];
                ps.tryPlayWinners = [ps.replayWinners[base]];
                ps.tryPlayBranchMoves = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                setTryPlayStep(0);
                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
                updateActionButtons();
            }

            function exitTryPlay() {
                const base = ps.tryPlayBaseStep;
                ps.tryPlayMode = false;
                ps.tryPlayFromLive = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayStepPlayers = [];
                ps.tryPlayScores = [];
                ps.tryPlayCurrentPlayers = [];
                ps.tryPlayGameOvers = [];
                ps.tryPlayWinners = [];
                ps.tryPlayBranchMoves = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                updateReplayUI();
                setReplayStep(base);
            }

            function isMyTurn() {
                if (!ps.mySlot || ps.gameOver || !ps.matchStarted) return false;
                if (ps.mySlot === 'player2' && ps.currentPlayer === 1) return true;
                if (ps.mySlot === 'player1' && ps.currentPlayer === 2) return true;
                return false;
            }

            let bindingsUpdateRecordButtons = null;   // 公共实现（_seatOverlay 建好后赋值）
            function updateRecordButtons() {
                const importBtn = document.getElementById('importBtn');
                const exportBtn = document.getElementById('exportBtn');
                const hasPlayers = ps.slots.player2 || ps.slots.player1;
                const hasMoves = ps.moveLog.length > 0;
                // 路数选择：观战者、无人入座、未开局、无着法时才显示（与其它可变路数棋种一致）；
                // 新局会释放座位，所以新局后又能改
                window.QiRoomGameSwitcher.syncSettingsSelect(boardSizeSelect);
                // 按钮显隐走公共实现（导出棋谱任何时候都显示）；下面留一份兜底，万一没接上 bindings
                if (bindingsUpdateRecordButtons) { bindingsUpdateRecordButtons(); return; }
                if (!hasPlayers && !hasMoves) {
                    importBtn.style.display = '';
                    exportBtn.style.display = '';   // 导出棋谱任何时候都显示（还没开局就导空棋谱）
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }

            // 执方名（本棋种白方先行、player1 执白）：落座对话框/colorStatus/计时框/继续执X 文案全按它走
            const SLOT_UI = {
                player2: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' },
                player1: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' }
            };

            const _seatOverlay = QiBoardRoomClient.createWeiqiMessageBindings({
                pageState: ps,
                boardSeatOverlay: true,
                seatOverlayOnly: true,
                getGameOver: () => ps.gameOver,
                getReplayMode: () => ps.replayMode,
                getBoard: () => ps.board,
                enterReplayMode: (data) => { syncState(data.recordState); ps.replayMode = true; },
                setReplayStep: (step) => { setReplayStep(step); ps.replayMode = true; },
                exitTryPlay,
                recordPointToCanvas: (row, col) => ({ ...boardCenterOfCell(row, col), cell: ps.CELL_SIZE, size: 600 }),
                recordMoveKind: 'travel',
                slotUi: SLOT_UI,          // 座位 → 执方名（player1 执白，与国际跳棋一致）
                standardWeiqiMatchTime,
                getWs: () => ps.ws,
                getBoardSize: () => ps.BOARD_SIZE,
                // 结子棋默认限时固定：10 分 + 20 秒×3 次
                timeControlDefaults: { mainMinutes: 10, byoyomiSeconds: 20, maxTimeouts: 3 },
                getSlots: () => ps.slots,
                setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot,
                setMySlot: (s) => { ps.mySlot = s; },
                updateTurn,
                updateReplayUI: () => { if (typeof updateReplayUI === 'function') updateReplayUI(); },
                // 试下虚着/悔棋要落到具体某一步：seatOverlayOnly 短路后公共代码只能靠这里拿到步进函数
                setTryPlayStep,
                colorStatus});
            bindingsUpdateRecordButtons = _seatOverlay.updateRecordButtons;

            function updateRadioStyles() {
                _seatOverlay.updateRadioStyles();
            }

            function syncState(state) {
                if (ps.tryPlayMode) exitTryPlay();
                if (state.boardSize) ps.BOARD_SIZE = state.boardSize;
                updateGeometry();
                if (state.board) ps.board = state.board.map((row) => row.slice());
                if (Array.isArray(state.openingBoard)) ps.openingBoard = state.openingBoard.map((row) => row.slice());
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer || 1;
                clearSelection();
                ps.lastMoveMarkers = (state.lastMoveMarkers || []).map((m) => ({ ...m }));
                ps.moveLog = (state.moveCoords || []).map((m) => ({ ...m }));
                ps.gameOver = !!state.gameOver;
                ps.winner = state.winner || null;
                if (state.recordResultText !== undefined) ps.recordResultText = state.recordResultText || null;
                else if (state.gameOver === false) ps.recordResultText = null;
                ps.matchStarted = !!state.matchStarted;
                ps.matchTime = state.matchTime || null;
                if (ps.matchStarted || ps.moveLog.length > 0 || (ps.matchTime && ps.matchTime.settings)) ps.matchStartedOnce = true;
                if (state.slots) ps.slots = { player2: !!state.slots.player2, player1: !!state.slots.player1 };
                boardSizeSelect.value = String(ps.BOARD_SIZE);
                updateKomiText();
                if (_seatOverlay.matchTimeCtl && state.matchTime !== undefined)
                    _seatOverlay.matchTimeCtl.applyMatchTimeFromState(state);
                updateTurn();
                updateScoreBoard();
                updateReplayUI();
                updateRecordButtons();
                updateRadioStyles();
                drawBoard();
            }

            function handleMessage(msg) {
                _seatOverlay.handleSeatOverlayMessage(msg);
                switch (msg.type) {
                    case 'joined':
                        sessionStorage.removeItem(`roomPassword_${roomId}`);
                        if (msg.role === 'player') {
                            ps.mySlot = msg.slot;
                        } else {
                            ps.mySlot = null;
                        }
                        if (msg.state) syncState(msg.state);
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        break;
                    case 'colorAssigned':
                        ps.mySlot = msg.color;
                        if (msg.color === 'player2') ps.slots.player2 = true;
                        if (msg.color === 'player1') ps.slots.player1 = true;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'slotOccupied':
                        if (msg.slot === 'player2') ps.slots.player2 = true;
                        if (msg.slot === 'player1') ps.slots.player1 = true;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'slotReleased':
                        if (msg.slot === 'player2') ps.slots.player2 = false;
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'playerLeft':
                        if (msg.slot === 'player2') ps.slots.player2 = false;
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        if (msg.matchStarted || ps.matchStarted)
                            ps.seatOverlayLocalHide = false;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'colorsFinalized':
                        if (msg.slots) ps.slots = { player2: !!msg.slots.player2, player1: !!msg.slots.player1 };
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'boardSizeChanged':
                        ps.BOARD_SIZE = msg.boardSize;
                        ps.openingBoard = null;
                        initBoardArrays();
                        updateGeometry();
                        updateKomiText();
                        if (boardSizeSelect) boardSizeSelect.value = String(msg.boardSize);
                        drawBoard();
                        break;
                    case 'gameState':
                        syncState(msg);
                        break;
                    case 'timeControlNegotiation':
                    case 'timeControlWaitPeer':
                    case 'timeControlAgreed':
                    case 'timeControlReset':
                    case 'clockUpdate':
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.handleMessage(msg);
                        if (msg.type === 'timeControlAgreed') {
                            if (msg.slots) ps.slots = { player2: !!msg.slots.player2, player1: !!msg.slots.player1 };
                            updateRadioStyles();
                        }
                        break;
                    case 'broadcast':
                        // matchStartOver = 开局即判（编辑盘面后某方无子/无子可动）：漏掉会既不提示胜负、本地 gameOver 也还是旧的
                        if (msg.action === 'move' || msg.action === 'undoAccept' || msg.action === 'resign' || msg.action === 'drawAgreed' || msg.action === 'timeLoss' || msg.action === 'matchStartOver') {
                            const wasOver = ps.gameOver;
                            syncState(msg);
                            if (!wasOver && msg.gameOver) {
                                // 优先用服务端给出的终局文案（含双方子数，如「黑 40 : 白 24，黑胜」）
                                if (msg.recordResultText) qiAlert(msg.recordResultText);
                                else if (msg.winner === 'player2') qiAlert('黑胜');
                                else if (msg.winner === 'player1') qiAlert('白胜');
                                else qiAlert('和棋');
                            }
                        }
                        break;
                    case 'newGameStarted':
                        ps.mySlot = null;
                        colorStatus.textContent = '观战';
                        ps.slots = { player2: false, player1: false };
                        ps.matchStarted = false;
                        ps.matchTime = null;
                        ps.matchStartedOnce = false;
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.stop();
                        syncState(msg);
                        break;
                    case 'importSuccess':
                    case 'roomReset':
                        syncState(msg);
                        break;
                    case 'gameRecord':
                        if (msg.data) QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(msg.data, recordDownloadPrefix);
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
                    case 'error':
                        if (msg.message) qiAlert(msg.message);
                        break;
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

            function tryCommitMove(fromRow, fromCol, toRow, toCol) {
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'move', fromRow, fromCol, toRow, toCol }));
                }
                clearSelection();
            }

            /** 点棋盘：先选己方棋子，再点落点走子；点别处取消选择 */
            function handleCanvasClick(row, col) {
                if (row < 0 || col < 0) return;
                if (ps.tryPlayMode) {
                    if (ps.selectedRow < 0) {
                        if (isMovablePiece(row, col)) {
                            ps.selectedRow = row;
                            ps.selectedCol = col;
                            refreshLegalTargets();
                        }
                        drawBoard();
                        return;
                    }
                    if (isLegalTarget(row, col)) {
                        tryPlayTryMove(ps.selectedRow, ps.selectedCol, row, col);
                        return;
                    }
                    if (isMovablePiece(row, col)) {
                        ps.selectedRow = row;
                        ps.selectedCol = col;
                        refreshLegalTargets();
                    } else {
                        clearSelection();
                    }
                    drawBoard();
                    return;
                }
                if (ps.replayMode) return;
                if (ps.gameOver) return;
                if (ps.selectedRow < 0) {
                    if (isMovablePiece(row, col)) {
                        ps.selectedRow = row;
                        ps.selectedCol = col;
                        refreshLegalTargets();
                    }
                    drawBoard();
                    return;
                }
                if (isLegalTarget(row, col)) {
                    tryCommitMove(ps.selectedRow, ps.selectedCol, row, col);
                    drawBoard();
                    return;
                }
                if (isMovablePiece(row, col)) {
                    ps.selectedRow = row;
                    ps.selectedCol = col;
                    refreshLegalTargets();
                } else {
                    clearSelection();
                }
                drawBoard();
            }

            canvas.addEventListener('click', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestCell(x, y);
                handleCanvasClick(row, col);
            });

            if (isMouseDevice) {
                canvas.addEventListener('mousemove', (e) => {
                    const rect = canvas.getBoundingClientRect();
                    const scale = 600 / rect.width;
                    const x = (e.clientX - rect.left) * scale;
                    const y = (e.clientY - rect.top) * scale;
                    const hit = getClosestCell(x, y);
                    ps.hoverRow = hit.row;
                    ps.hoverCol = hit.col;
                    ps.isHoverValid = ps.selectedRow >= 0 && isLegalTarget(hit.row, hit.col);
                    drawBoard();
                });
                canvas.addEventListener('mouseleave', () => {
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    ps.isHoverValid = false;
                    drawBoard();
                });
            }

            // 路数：5~15 路，观战者且无人入座、无着法时可改（与服务端 setBoardSize 同门槛）
            boardSizeSelect.addEventListener('change', () => {
                const n = parseInt(boardSizeSelect.value, 10);
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'setBoardSize', size: n }));
            });

            // 棋子会移动，不显示序号：隐藏该勾选
            if (showNumbersCheck && showNumbersCheck.parentElement) {
                showNumbersCheck.parentElement.style.display = 'none';
            }

            // 新局/悔棋/认输/和棋：走公共按钮绑定（带确认对话框，与房间页公共 bindings 同一套口径）
            QiBoardRoomClient.bindPanelButtons({
                getWs: () => ps.ws,
                getMySlot: () => ps.mySlot,
                getSlots: () => ps.slots,
                getComputerSlot: () => ps.computerSlot
            });
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

            document.getElementById('replayBackBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                else setReplayStep(ps.replayStep - 1);
            };
            document.getElementById('replayForwardBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                else setReplayStep(ps.replayStep + 1);
            };
            document.getElementById('replaySlider').addEventListener('input', (e) => {
                const step = Number(e.target.value) || 0;
                if (ps.tryPlayMode) setTryPlayStep(step);
                else setReplayStep(step);
            });
            {
                const tpBtn = document.getElementById('tryPlayBtn');
                if (tpBtn) {
                    tpBtn.onclick = () => {
                        if (ps.tryPlayMode) exitTryPlay();
                        else enterTryPlay();
                    };
                }
            }

            initBoardArrays();
            updateGeometry();
            updateKomiText();
            updateTurn();
            updateScoreBoard();
            updateReplayUI();
            drawBoard();

        /* board edit UI */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI && typeof ps !== 'undefined') {
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: ps,
                canvas: document.getElementById('goBoard'),
                mode: 'grid2d',
                pickAtClient(clientX, clientY) {
                    // 与正常落子的取点一致：客户端坐标 → 600 逻辑画布 → 最近格
                    const rect = canvas.getBoundingClientRect();
                    const scale = 600 / rect.width;
                    return getClosestCell((clientX - rect.left) * scale, (clientY - rect.top) * scale);
                },
                drawBoard: typeof drawBoard === 'function' ? drawBoard : function () {},
                getBoard() { return ps.board; },
                setBoard(b) { ps.board = b; },
                emptyBoard() {
                    const n = ps.BOARD_SIZE || ps.boardSize || ps.board.length;
                    return Array(n).fill(null).map(function () { return Array(n).fill(0); });
                }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) {
                        if (state.initialBoard) ps.liveOpeningBoard = state.initialBoard;
                        ps.gameStarted = (state.numberOfHands || 1) > 1;
                    }
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

            connectWebSocket();
        })();
        })();
    }
};
