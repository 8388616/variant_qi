window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["reversi"] = {
    shell: {
        "title": "黑白棋",
        "rulesHtml": "基本规则同黑白棋。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 8,
        "boardSizeMax": 12,
        "defaultBoardSize": 8,
        "minLib": 1,
        "recordDownloadPrefix": "黑白棋",
        "standardWeiqiMatchTime": true,
        "features": {
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
        "boardSizeValues": [
            8,
            9,
            10,
            11,
            12
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "黑白棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
(function () {
            const ps = {
                BOARD_SIZE: 9,
                PADDING: 45,
                CELL_SIZE: 56,
                board: [],
                blackCount: 0,
                whiteCount: 0,
                passNotice: null,
                openingBoard: null,
                numberOfHands: 1,
                currentPlayer: 1,
                mySlot: null,
                gameOver: false,
                winner: null,
                lastMoveMarkers: [],
                slots: { player1: false, player2: false },
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
            // 黑白棋不需要这一行文字：整行隐藏（子数在右侧计分显示）
            if (komiInfo) {
                komiInfo.hidden = true;
                komiInfo.style.display = 'none';
            }
const boardSizeSelect = document.getElementById('boardSizeSelect');
            const showNumbersCheck = document.getElementById('showNumbersCheck');

            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            function updateGeometry() {
                const n = ps.BOARD_SIZE;
                ps.PADDING = 63 - 2 * n;
                ps.CELL_SIZE = (600 - 2 * ps.PADDING) / n;
            }

            /* ===== 黑白棋规则工具（与服务器 games/reversi.js 保持同一套实现）===== */
            const REVERSI_DIRS = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ];

            /** 在 (row,col) 落子能翻转的对方子坐标 */
            function reversiFlipsOn(board, n, row, col, val) {
                const flips = [];
                if (row < 0 || row >= n || col < 0 || col >= n) return flips;
                if (board[row][col] !== 0) return flips;
                const opp = val === 1 ? 2 : 1;
                for (const [dr, dc] of REVERSI_DIRS) {
                    const line = [];
                    let r = row + dr;
                    let c = col + dc;
                    while (r >= 0 && r < n && c >= 0 && c < n && board[r][c] === opp) {
                        line.push([r, c]);
                        r += dr;
                        c += dc;
                    }
                    if (line.length && r >= 0 && r < n && c >= 0 && c < n && board[r][c] === val) {
                        for (const cell of line) flips.push(cell);
                    }
                }
                return flips;
            }

            /** 就地落子并翻转，返回被翻的子 */
            function reversiApplyOn(board, n, row, col, val) {
                const flips = reversiFlipsOn(board, n, row, col, val);
                if (flips.length === 0) return flips;
                board[row][col] = val;
                for (const [r, c] of flips) board[r][c] = val;
                return flips;
            }

            function reversiHasMoveOn(board, n, val) {
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (board[r][c] === 0 && reversiFlipsOn(board, n, r, c, val).length > 0) return true;
                    }
                }
                return false;
            }

            function reversiCountOn(board, n) {
                let black = 0;
                let white = 0;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        if (board[r][c] === 1) black++;
                        else if (board[r][c] === 2) white++;
                    }
                }
                return { black, white };
            }

            /** 开局：居中交错一块（8/10 路 2×2，9/11 路 3×3，12 路 4×4），左上为白 */
            function initialBoard(n) {
                const board = Array.from({ length: n }, () => Array(n).fill(0));
                const block = (n % 2 === 1) ? 3 : (n <= 10 ? 2 : 4);
                const top = Math.floor((n - block) / 2);
                for (let vr = 0; vr < block; vr++) {
                    for (let c = 0; c < block; c++) {
                        board[top + (block - 1 - vr)][top + c] = ((vr + c) % 2 === 0) ? 2 : 1;
                    }
                }
                return board;
            }

            function initBoardArrays() {
                ps.board = initialBoard(ps.BOARD_SIZE);
                const counts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = counts.black;
                ps.whiteCount = counts.white;
            }

            /** 黑白棋隐藏了 komiInfo 行，此处保留空实现以免各处调用失效 */
            function updateKomiText() { /* 不显示 */ }

            function boardCenterOfCell(row, col) {
                return {
                    x: ps.PADDING + col * ps.CELL_SIZE + ps.CELL_SIZE / 2,
                    y: ps.PADDING + (ps.BOARD_SIZE - 1 - row) * ps.CELL_SIZE + ps.CELL_SIZE / 2
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

            function computeStoneNumbers() {
                const nums = Array.from({ length: ps.BOARD_SIZE }, () => Array(ps.BOARD_SIZE).fill(0));
                const put = (row, col, n) => {
                    if (row < 0 || col < 0 || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE) return;
                    if (ps.board[row][col] === 0) return;
                    nums[row][col] = n;
                };
                // 与公共实现（room.js computeStoneNumbers）一致：试下/打谱各自用本分支的标记编号，
                // 否则试下时会去读对局的 moveLog，分支上的棋子拿不到序号（甚至串号）。
                if (ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const markers = ps.tryPlayMarkers[i];
                        if (markers && markers.length > 0) put(markers[0].row, markers[0].col, i);
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const markers = ps.replayMarkers[i];
                        if (markers && markers.length > 0) put(markers[0].row, markers[0].col, i);
                    }
                } else {
                    // 服务器只在对局记录里存真正的落子（过手不记），因此按落子序计数即可
                    let n = 0;
                    for (const m of ps.moveLog) {
                        if (!m || m.type !== 'move') continue;
                        n++;
                        put(m.row, m.col, n);
                    }
                }
                return nums;
            }

            function canPlayAt(row, col) {
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return false;
                if (ps.tryPlayMode) return false;
                if (ps.replayMode) return false;
                if (ps.gameOver || !isMyTurn()) return false;
                if (ps.board[row][col] !== 0) return false;
                const me = ps.mySlot === 'player1' ? 1 : 2;
                if (!(me > 0)) return false;
                return reversiFlipsOn(ps.board, ps.BOARD_SIZE, row, col, me).length > 0;
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

                for (const marker of ps.lastMoveMarkers) {
                    const p = boardCenterOfCell(marker.row, marker.col);
                    ctx.beginPath();
                    ctx.moveTo(p.x + stoneRadius, p.y + stoneRadius);
                    ctx.lineTo(p.x, p.y + stoneRadius);
                    ctx.lineTo(p.x + stoneRadius, p.y);
                    ctx.closePath();
                    ctx.fillStyle = marker.color === 1 ? '#fff' : '#222';
                    ctx.fill();
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

                if (ps.showMoveNumbers) {
                    const nums = computeStoneNumbers();
                    for (let r = 0; r < ps.BOARD_SIZE; r++) {
                        for (let c2 = 0; c2 < ps.BOARD_SIZE; c2++) {
                            if (nums[r][c2] <= 0 || ps.board[r][c2] === 0) continue;
                            const p = boardCenterOfCell(r, c2);
                            const num = String(nums[r][c2]);
                            const fontSize = Math.max(9, Math.floor(ps.CELL_SIZE * (num.length >= 3 ? 0.308 : 0.396)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = ps.board[r][c2] === 1 ? '#fff' : '#000';
                            ctx.fillText(num, p.x, p.y + 1);
                        }
                    }
                }

                // 可落点提示：与其它棋类一致的小方块，按行棋方着色（黑方黑块、白方白块）
                {
                    // 试下/对局都以 currentPlayer 为准（试下每步会同步该字段）
                    const sideVal = ps.currentPlayer | 0;
                    const engaged = !!(ps.matchStarted || ps.matchStartedOnce
                        || (ps.matchTime && ps.matchTime.settings) || (ps.moveLog && ps.moveLog.length)
                        || ps.tryPlayMode);
                    // 注意：本棋种进入试下时会借用 replay 脚手架，故试下不算「回放」
                    if ((!ps.replayMode || ps.tryPlayMode) && !ps.gameOver && engaged && (sideVal === 1 || sideVal === 2)) {
                        const half = ps.CELL_SIZE * 0.12;
                        for (let r = 0; r < ps.BOARD_SIZE; r++) {
                            for (let c2 = 0; c2 < ps.BOARD_SIZE; c2++) {
                                if (ps.board[r][c2] !== 0) continue;
                                if (!reversiFlipsOn(ps.board, ps.BOARD_SIZE, r, c2, sideVal).length) continue;
                                const p = boardCenterOfCell(r, c2);
                                ctx.fillStyle = sideVal === 1 ? '#111111' : '#ffffff';
                                ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
                            }
                        }
                    }
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
                    } else if (isMyTurn() && canPlayAt(ps.hoverRow, ps.hoverCol)) {
                        hoverColor = ps.mySlot === 'player1' ? '#222' : '#fff';
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
                const counts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = counts.black;
                ps.whiteCount = counts.white;
                scoreBoard.textContent = `黑: ${counts.black}　白: ${counts.white}`;
                updateKomiText();
                if (ps.gameOver) {
                    leadInfo.textContent = `终局：` + (ps.winner === 'player1' ? '黑胜' : (ps.winner === 'player2' ? '白胜' : '和棋'))
                        + `（${counts.black} : ${counts.white}）`;
                } else if (ps.passNotice) {
                    leadInfo.textContent = (ps.passNotice === 'player1' ? '黑方' : '白方') + '无棋可下，过手';
                } else {
                    leadInfo.textContent = '　';
                }
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
                        turnDisplay.textContent = '打谱：初始局面';
                    } else {
                        const playerVal = ps.replayStepPlayers[ps.replayStep] || 0;
                        const emoji = playerVal === 1 ? '⚫' : '⚪';
                        turnDisplay.textContent = `打谱：${emoji}第${ps.replayStep}手`;
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
                    turnDisplay.textContent = `第${n}手`;
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
                // 黑白棋开局即有子：回放起点必须是开局局面，不能是空盘
                const baseBoard = (ps.openingBoard && ps.openingBoard.length === n)
                    ? ps.openingBoard.map((row) => row.slice())
                    : initialBoard(n);
                const replayBoards = [baseBoard.map((row) => row.slice())];
                const replayMarkers = [[]];
                const replayStepPlayers = [0];
                const replayScores = [{ blackScore: 0, whiteScore: 0 }];
                const replayCurrentPlayers = [1];
                const replayGameOvers = [false];
                const replayWinners = [null];

                let curBoard = baseBoard.map((row) => row.slice());
                let curPlayer = 1;
                let curOver = false;
                let curWinner = null;
                let curCounts = reversiCountOn(curBoard, n);

                for (const m of ps.moveLog) {
                    if (!m || m.type !== 'move') continue;
                    const row = m.row;
                    const col = m.col;
                    const playerVal = m.player === 'player1' ? 1 : 2;
                    if (row < 0 || row >= n || col < 0 || col >= n) continue;
                    if (curBoard[row][col] !== 0) continue;
                    reversiApplyOn(curBoard, n, row, col, playerVal);
                    curCounts = reversiCountOn(curBoard, n);
                    const oppVal = playerVal === 1 ? 2 : 1;
                    const oppCan = reversiHasMoveOn(curBoard, n, oppVal);
                    const selfCan = reversiHasMoveOn(curBoard, n, playerVal);
                    if (!oppCan && !selfCan) {
                        curOver = true;
                        curWinner = curCounts.black > curCounts.white ? 'player1'
                            : (curCounts.white > curCounts.black ? 'player2' : 'draw');
                    } else {
                        curPlayer = oppCan ? oppVal : playerVal;
                    }

                    replayBoards.push(curBoard.map((r) => r.slice()));
                    replayMarkers.push([{ row, col, color: playerVal }]);
                    replayStepPlayers.push(playerVal);
                    replayScores.push({ blackScore: curCounts.black, whiteScore: curCounts.white });
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
                ps.blackCount = replayScores[total].blackScore;
                ps.whiteCount = replayScores[total].whiteScore;
                ps.currentPlayer = replayCurrentPlayers[total];
                ps.gameOver = replayGameOvers[total];
                ps.winner = replayWinners[total];
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

                ps.blackCount = (ps.replayScores[step] && ps.replayScores[step].blackScore) || 0;
                ps.whiteCount = (ps.replayScores[step] && ps.replayScores[step].whiteScore) || 0;
                ps.currentPlayer = ps.replayCurrentPlayers[step] || 1;
                ps.gameOver = !!ps.replayGameOvers[step];
                ps.winner = ps.replayWinners[step] || null;

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
                ps.blackCount = ps.tryPlayScores[step].blackScore;
                ps.whiteCount = ps.tryPlayScores[step].whiteScore;
                ps.currentPlayer = ps.tryPlayCurrentPlayers[step];
                ps.gameOver = !!ps.tryPlayGameOvers[step];
                ps.winner = ps.tryPlayWinners[step];
                const slider = document.getElementById('replaySlider');
                slider.value = String(step);
                slider.max = ps.tryPlayTotalSteps;
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.tryPlayTotalSteps}`;
                if (ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    ps.isHoverValid = tryPlayCanPlayAt(ps.hoverRow, ps.hoverCol);
                } else {
                    ps.isHoverValid = false;
                }
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            /** 试下：判断当前试下局面轮到的一方能否在 (row,col) 落子 */
            function tryPlayCanPlayAt(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return false;
                if (ps.board[row][col] !== 0) return false;
                const me = ps.currentPlayer;
                if (!(me > 0)) return false;
                return reversiFlipsOn(ps.board, ps.BOARD_SIZE, row, col, me).length > 0;
            }

            /** 试下：落子（应用翻转），并按黑白棋规则推进轮次 / 过手 / 终局 */
            function tryPlayTryMove(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                if (!tryPlayCanPlayAt(row, col)) return false;
                const t = ps.tryPlayStep;
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
                const playerVal = ps.tryPlayCurrentPlayers[t];
                const slot = playerVal === 1 ? 'player1' : 'player2';
                const curBoard = ps.tryPlayBoards[t].map((r) => r.slice());
                reversiApplyOn(curBoard, ps.BOARD_SIZE, row, col, playerVal);
                const counts = reversiCountOn(curBoard, ps.BOARD_SIZE);
                const oppVal = playerVal === 1 ? 2 : 1;
                const oppCan = reversiHasMoveOn(curBoard, ps.BOARD_SIZE, oppVal);
                const selfCan = reversiHasMoveOn(curBoard, ps.BOARD_SIZE, playerVal);
                let curPlayer = playerVal;
                let curOver = false;
                let curWinner = null;
                if (!oppCan && !selfCan) {
                    curOver = true;
                    curWinner = counts.black > counts.white ? 'player1'
                        : (counts.white > counts.black ? 'player2' : 'draw');
                } else {
                    curPlayer = oppCan ? oppVal : playerVal;
                }
                ps.tryPlayBranchMoves.push({ type: 'move', row, col, player: slot });
                ps.tryPlayBoards.push(curBoard.map((r) => r.slice()));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayStepPlayers.push(playerVal);
                ps.tryPlayScores.push({ blackScore: counts.black, whiteScore: counts.white });
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
                if (ps.mySlot === 'player1' && ps.currentPlayer === 1) return true;
                if (ps.mySlot === 'player2' && ps.currentPlayer === 2) return true;
                return false;
            }

            function updateRecordButtons() {
                const importBtn = document.getElementById('importBtn');
                const exportBtn = document.getElementById('exportBtn');
                const hasPlayers = ps.slots.player1 || ps.slots.player2;
                const hasMoves = ps.moveLog.length > 0;
                // 开局（开赛/计时协商中/已有落子）隐藏路数选择；终局开新局（盘面清空、未开赛）后恢复可选，
                // 是否已就座不影响——否则新局后玩家仍在座会永远隐藏。
                const engaged = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings) || hasMoves);
                boardSizeSelect.style.display = engaged ? 'none' : '';
                if (!hasPlayers && !hasMoves) {
                    importBtn.style.display = '';
                    exportBtn.style.display = 'none';
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }

            const _seatOverlay = QiBoardRoomClient.createWeiqiMessageBindings({
                pageState: ps,
                boardSeatOverlay: true,
                seatOverlayOnly: true,
                standardWeiqiMatchTime,
                getWs: () => ps.ws,
                getBoardSize: () => ps.BOARD_SIZE,
                // 默认限时与围棋同口径：按棋盘总点数换算
                getTotalPoints: () => ps.BOARD_SIZE * ps.BOARD_SIZE,
                // 主用时系数按本棋种调大（0.05，读秒/次数仍同围棋口径）
                timeControlMainCoef: 0.05,
                getSlots: () => ps.slots,
                setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot,
                setMySlot: (s) => { ps.mySlot = s; },
                updateTurn,
                updateReplayUI: () => { if (typeof updateReplayUI === 'function') updateReplayUI(); },
                // 试下虚着/悔棋要落到具体某一步：seatOverlayOnly 短路后公共代码只能靠这里拿到步进函数
                setTryPlayStep,
                colorStatus});

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
                const _stCounts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = state.blackCount != null ? state.blackCount : _stCounts.black;
                ps.whiteCount = state.whiteCount != null ? state.whiteCount : _stCounts.white;
                ps.passNotice = state.passNotice || null;
                ps.lastMoveMarkers = (state.lastMoveMarkers || []).map((m) => ({ ...m }));
                ps.moveLog = (state.moveCoords || []).map((m) => ({ ...m }));
                ps.gameOver = !!state.gameOver;
                ps.winner = state.winner || null;
                ps.matchStarted = !!state.matchStarted;
                ps.matchTime = state.matchTime || null;
                if (ps.matchStarted || ps.moveLog.length > 0 || (ps.matchTime && ps.matchTime.settings)) ps.matchStartedOnce = true;
                if (state.slots) ps.slots = { player1: !!state.slots.player1, player2: !!state.slots.player2 };
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
                        if (msg.color === 'player1') ps.slots.player1 = true;
                        if (msg.color === 'player2') ps.slots.player2 = true;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'slotOccupied':
                        if (msg.slot === 'player1') ps.slots.player1 = true;
                        if (msg.slot === 'player2') ps.slots.player2 = true;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'slotReleased':
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (msg.slot === 'player2') ps.slots.player2 = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'playerLeft':
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (msg.slot === 'player2') ps.slots.player2 = false;
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
                        if (msg.slots) ps.slots = { player1: !!msg.slots.player1, player2: !!msg.slots.player2 };
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'boardSizeChanged':
                        ps.BOARD_SIZE = msg.boardSize;
                        ps.openingBoard = null;
                        initBoardArrays();
                        updateGeometry();
                        updateKomiText();
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
                            if (msg.slots) ps.slots = { player1: !!msg.slots.player1, player2: !!msg.slots.player2 };
                            updateRadioStyles();
                        }
                        break;
                    case 'broadcast':
                        if (msg.action === 'move' || msg.action === 'undoAccept' || msg.action === 'resign' || msg.action === 'drawAgreed' || msg.action === 'timeLoss') {
                            const wasOver = ps.gameOver;
                            syncState(msg);
                            if (!wasOver && msg.gameOver) {
                                // 优先用服务端给出的终局文案（含双方子数，如「黑 40 : 白 24，黑胜」）
                                if (msg.recordResultText) qiAlert(msg.recordResultText);
                                else if (msg.winner === 'player1') qiAlert('黑胜');
                                else if (msg.winner === 'player2') qiAlert('白胜');
                                else qiAlert('和棋');
                            }
                        }
                        break;
                    case 'newGameStarted':
                        ps.mySlot = null;
                        colorStatus.textContent = '观战';
                        ps.slots = { player1: false, player2: false };
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
                        if (msg.data) QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(msg.data, '黑白棋');
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

            function tryCommitMove(row, col) {
                if (!canPlayAt(row, col)) return;
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            }

            canvas.addEventListener('click', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestCell(x, y);
                if (ps.tryPlayMode) {
                    tryPlayTryMove(row, col);
                    return;
                }
                tryCommitMove(row, col);
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
                    ps.isHoverValid = ps.tryPlayMode ? tryPlayCanPlayAt(hit.row, hit.col) : canPlayAt(hit.row, hit.col);
                    drawBoard();
                });
                canvas.addEventListener('mouseleave', () => {
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    ps.isHoverValid = false;
                    drawBoard();
                });
            }

            boardSizeSelect.addEventListener('change', () => {
                const n = parseInt(boardSizeSelect.value, 10);
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'setBoardSize', size: n }));
            });
            showNumbersCheck.addEventListener('change', () => {
                ps.showMoveNumbers = !!showNumbersCheck.checked;
                drawBoard();
            });

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
