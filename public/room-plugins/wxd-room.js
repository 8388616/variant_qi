window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["wxd"] = {
    shell: {
        "title": "WxD棋",
        "rulesHtml": "双方从中心格出发，每步只能走到自己上一手周围八格，并获得格内分数。<br /><br />当一方无路可走时，由另一方继续走，直至双方都无路可走时结束。<br /><br />积分高者获胜。<br />",
        "defaultKomiText": "黑贴白32点",
        "boardSizeMin": 3,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "WxD棋",
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
        "boardSizeStep": 2,
        "boardSizeValues": [
            3,
            5,
            7,
            9,
            11,
            13,
            15,
            17,
            19,
            21
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "WxD棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
(function () {
            const ps = {
                BOARD_SIZE: 9,
                PADDING: 45,
                CELL_SIZE: 56,
                board: [],
                weights: [],
                center: { row: 4, col: 4 },
                komi: 0,
                blackScore: 0,
                whiteScore: 0,
                numberOfHands: 1,
                currentPlayer: 1,
                mySlot: null,
                gameOver: false,
                winner: null,
                lastMoveMarkers: [],
                slots: { black: false, white: false },
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
const boardSizeSelect = document.getElementById('boardSizeSelect');
            const showNumbersCheck = document.getElementById('showNumbersCheck');

            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            function updateGeometry() {
                const n = ps.BOARD_SIZE;
                ps.PADDING = 63 - 2 * n;
                ps.CELL_SIZE = (600 - 2 * ps.PADDING) / n;
            }

            function initBoardArrays() {
                ps.board = Array.from({ length: ps.BOARD_SIZE }, () => Array(ps.BOARD_SIZE).fill(0));
                ps.weights = Array.from({ length: ps.BOARD_SIZE }, () => Array(ps.BOARD_SIZE).fill(0));
                const center = Math.floor(ps.BOARD_SIZE / 2);
                ps.center = { row: center, col: center };
            }

            function computeKomiBySize(n) {
                const totalScore = ((n * n - 1) * n * n) / 2;
                return Math.floor(0.01 * totalScore);
            }

            function updateKomiText() {
                komiInfo.textContent = `黑贴白${ps.komi}点`;
            }

            function boardCenterOfCell(row, col) {
                return {
                    x: ps.PADDING + col * ps.CELL_SIZE + ps.CELL_SIZE / 2,
                    y: ps.PADDING + row * ps.CELL_SIZE + ps.CELL_SIZE / 2
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
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && m.type === 'move' && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i + 1;
                }
                return nums;
            }

            function canPlayAt(row, col) {
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return false;
                if (ps.tryPlayMode) return false;
                if (ps.replayMode) return false;
                if (ps.gameOver || !isMyTurn()) return false;
                if (ps.board[row][col] !== 0) return false;
                if (row === ps.center.row && col === ps.center.col) return false;
                const me = ps.mySlot === 'black' ? 1 : 2;
                let last = null;
                for (let i = ps.moveLog.length - 1; i >= 0; i--) {
                    const m = ps.moveLog[i];
                    if (m.player === ps.mySlot) {
                        last = { row: m.row, col: m.col };
                        break;
                    }
                }
                if (!last) last = ps.center;
                const dr = Math.abs(last.row - row);
                const dc = Math.abs(last.col - col);
                return (dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0) && me > 0);
            }

            function drawBoard() {
                ctx.clearRect(0, 0, 600, 600);
                ctx.fillStyle = '#deb887';
                ctx.fillRect(0, 0, 600, 600);

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

                const c = ps.center;
                ctx.fillStyle = '#808080';
                ctx.fillRect(
                    ps.PADDING + c.col * ps.CELL_SIZE + 1,
                    ps.PADDING + c.row * ps.CELL_SIZE + 1,
                    ps.CELL_SIZE - 2,
                    ps.CELL_SIZE - 2
                );

                ctx.font = `bold ${17 - 0.2 * ps.BOARD_SIZE}px Arial`;
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

                if (!ps.showMoveNumbers) {
                    for (let r = 0; r < ps.BOARD_SIZE; r++) {
                        for (let c2 = 0; c2 < ps.BOARD_SIZE; c2++) {
                            const w = ps.weights[r][c2];
                            if (w <= 0) continue;
                            const p = boardCenterOfCell(r, c2);
                            ctx.font = `bold ${Math.floor(ps.CELL_SIZE * 0.35)}px Arial`;
                            if (ps.board[r][c2] === 1) ctx.fillStyle = '#fff';
                            else if (ps.board[r][c2] === 2) ctx.fillStyle = '#444';
                            else ctx.fillStyle = '#2c1f15';
                            ctx.fillText(String(w), p.x, p.y);
                        }
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

                if (!ps.gameOver && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    const canH = ps.tryPlayMode ? tryPlayCanPlayAt(ps.hoverRow, ps.hoverCol) : (isMyTurn() && canPlayAt(ps.hoverRow, ps.hoverCol));
                    if (canH) {
                        const p = boardCenterOfCell(ps.hoverRow, ps.hoverCol);
                        ctx.save();
                        ctx.globalAlpha = 0.42;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, stoneRadius, 0, Math.PI * 2);
                        const isBlackStone = ps.tryPlayMode ? (ps.currentPlayer === 1) : (ps.mySlot === 'black');
                        ctx.fillStyle = isBlackStone ? '#222' : '#ddd';
                        ctx.fill();
                        ctx.restore();
                    }
                }
            }

            function updateScoreBoard() {
                scoreBoard.textContent = `黑: ${ps.blackScore}　白: ${ps.whiteScore}`;
                if (ps.gameOver) {
                    const adjWhite = ps.whiteScore + ps.komi;
                    if (ps.winner === 'black') {
                        leadInfo.textContent = `终局：黑胜`;
                    } else if (ps.winner === 'white') {
                        leadInfo.textContent = `终局：白胜`;
                    } else {
                        leadInfo.textContent = `终局：和棋`;
                    }
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
                const emptyBoard = Array.from({ length: n }, () => Array(n).fill(0));
                const replayBoards = [emptyBoard.map((row) => row.slice())];
                const replayMarkers = [[]];
                const replayStepPlayers = [0];
                const replayScores = [{ blackScore: 0, whiteScore: 0 }];
                const replayCurrentPlayers = [1];
                const replayGameOvers = [false];
                const replayWinners = [null];

                let curBoard = emptyBoard.map((row) => row.slice());
                let curBlackScore = 0;
                let curWhiteScore = 0;
                let curPlayer = 1;
                let curOver = false;
                let curWinner = null;
                const lastBy = { black: null, white: null };
                const center = ps.center;

                function replayCanPlayerMove(slot) {
                    const from = lastBy[slot] || center;
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            const nr = from.row + dr;
                            const nc = from.col + dc;
                            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                            if (curBoard[nr][nc] !== 0) continue;
                            if (nr === center.row && nc === center.col) continue;
                            return true;
                        }
                    }
                    return false;
                }

                for (const m of ps.moveLog) {
                    if (!m || m.type !== 'move') continue;
                    const row = m.row;
                    const col = m.col;
                    const playerVal = m.player === 'black' ? 1 : 2;
                    if (row < 0 || row >= n || col < 0 || col >= n) continue;
                    if (curBoard[row][col] !== 0) continue;

                    curBoard[row][col] = playerVal;
                    if (playerVal === 1) curBlackScore += (ps.weights[row][col] || 0);
                    else curWhiteScore += (ps.weights[row][col] || 0);
                    const slot = playerVal === 1 ? 'black' : 'white';
                    lastBy[slot] = { row, col };

                    const other = slot === 'black' ? 'white' : 'black';
                    const selfCan = replayCanPlayerMove(slot);
                    const otherCan = replayCanPlayerMove(other);
                    if (!selfCan && !otherCan) {
                        curOver = true;
                        const whiteAdj = curWhiteScore + ps.komi;
                        if (curBlackScore > whiteAdj) curWinner = 'black';
                        else if (whiteAdj > curBlackScore) curWinner = 'white';
                        else curWinner = 'draw';
                    } else if (otherCan) {
                        curPlayer = playerVal === 1 ? 2 : 1;
                    }

                    replayBoards.push(curBoard.map((r) => r.slice()));
                    replayMarkers.push([{ row, col, color: playerVal }]);
                    replayStepPlayers.push(playerVal);
                    replayScores.push({ blackScore: curBlackScore, whiteScore: curWhiteScore });
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
                ps.blackScore = replayScores[total].blackScore;
                ps.whiteScore = replayScores[total].whiteScore;
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

                ps.blackScore = (ps.replayScores[step] && ps.replayScores[step].blackScore) || 0;
                ps.whiteScore = (ps.replayScores[step] && ps.replayScores[step].whiteScore) || 0;
                ps.currentPlayer = ps.replayCurrentPlayers[step] || 1;
                ps.gameOver = !!ps.replayGameOvers[step];
                ps.winner = ps.replayWinners[step] || null;

                document.getElementById('replaySlider').value = String(step);
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.replayTotalSteps}`;
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            function setTryPlayStepWxD(step) {
                if (!ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                ps.board = ps.tryPlayBoards[step].map((r) => r.slice());
                ps.lastMoveMarkers = (ps.tryPlayMarkers[step] || []).map((m) => ({ ...m }));
                ps.blackScore = ps.tryPlayScores[step].blackScore;
                ps.whiteScore = ps.tryPlayScores[step].whiteScore;
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

            function wxdBuildLastByFromMoveList(moves) {
                const lastBy = { black: null, white: null };
                for (let i = 0; i < moves.length; i++) {
                    const m = moves[i];
                    if (m && m.type === 'move') lastBy[m.player] = { row: m.row, col: m.col };
                }
                return lastBy;
            }

            function wxdTryPlayCanMoveFrom(curBoard, lastBy, slot) {
                const center = ps.center;
                const n = ps.BOARD_SIZE;
                const from = lastBy[slot] || center;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const nr = from.row + dr;
                        const nc = from.col + dc;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                        if (curBoard[nr][nc] !== 0) continue;
                        if (nr === center.row && nc === center.col) continue;
                        return true;
                    }
                }
                return false;
            }

            function tryPlayCanPlayAt(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                if (row < 0 || row >= ps.BOARD_SIZE || col < 0 || col >= ps.BOARD_SIZE) return false;
                if (ps.board[row][col] !== 0) return false;
                if (row === ps.center.row && col === ps.center.col) return false;
                const me = ps.currentPlayer;
                const mySlot = me === 1 ? 'black' : 'white';
                const prefix = ps.moveLog
                    .slice(0, ps.tryPlayBaseStep)
                    .concat(ps.tryPlayBranchMoves.slice(0, ps.tryPlayStep));
                let last = null;
                for (let i = prefix.length - 1; i >= 0; i--) {
                    const m = prefix[i];
                    if (m && m.type === 'move' && m.player === mySlot) {
                        last = { row: m.row, col: m.col };
                        break;
                    }
                }
                if (!last) last = ps.center;
                const dr = Math.abs(last.row - row);
                const dc = Math.abs(last.col - col);
                return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0) && me > 0;
            }

            function tryPlayTryMoveWxD(row, col) {
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
                const slot = playerVal === 1 ? 'black' : 'white';
                const prefixBefore = ps.moveLog.slice(0, ps.tryPlayBaseStep).concat(ps.tryPlayBranchMoves);
                const lastBy = wxdBuildLastByFromMoveList(prefixBefore);
                let curBoard = ps.tryPlayBoards[t].map((r) => r.slice());
                let curBlack = ps.tryPlayScores[t].blackScore;
                let curWhite = ps.tryPlayScores[t].whiteScore;
                let curPlayer = ps.tryPlayCurrentPlayers[t];
                let curOver = !!ps.tryPlayGameOvers[t];
                let curWinner = ps.tryPlayWinners[t];
                curBoard[row][col] = playerVal;
                if (playerVal === 1) curBlack += (ps.weights[row][col] || 0);
                else curWhite += (ps.weights[row][col] || 0);
                lastBy[slot] = { row, col };
                const other = slot === 'black' ? 'white' : 'black';
                const selfCan = wxdTryPlayCanMoveFrom(curBoard, lastBy, slot);
                const otherCan = wxdTryPlayCanMoveFrom(curBoard, lastBy, other);
                if (!selfCan && !otherCan) {
                    curOver = true;
                    const whiteAdj = curWhite + ps.komi;
                    if (curBlack > whiteAdj) curWinner = 'black';
                    else if (whiteAdj > curBlack) curWinner = 'white';
                    else curWinner = 'draw';
                } else if (otherCan) {
                    curPlayer = playerVal === 1 ? 2 : 1;
                }
                ps.tryPlayBranchMoves.push({ type: 'move', row, col, player: slot });
                ps.tryPlayBoards.push(curBoard.map((r) => r.slice()));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayStepPlayers.push(playerVal);
                ps.tryPlayScores.push({ blackScore: curBlack, whiteScore: curWhite });
                ps.tryPlayCurrentPlayers.push(curPlayer);
                ps.tryPlayGameOvers.push(curOver);
                ps.tryPlayWinners.push(curWinner);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                setTryPlayStepWxD(ps.tryPlayStep);
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
                setTryPlayStepWxD(0);
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
                if (ps.mySlot === 'black' && ps.currentPlayer === 1) return true;
                if (ps.mySlot === 'white' && ps.currentPlayer === 2) return true;
                return false;
            }

            function updateRecordButtons() {
                const importBtn = document.getElementById('importBtn');
                const exportBtn = document.getElementById('exportBtn');
                const hasPlayers = ps.slots.black || ps.slots.white;
                const hasMoves = ps.moveLog.length > 0;
                boardSizeSelect.style.display = (hasPlayers || hasMoves) ? 'none' : '';
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
                getSlots: () => ps.slots,
                setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot,
                setMySlot: (s) => { ps.mySlot = s; },
                getTimeControlDefaults: (boardSize) => {
                    const n = Number.isFinite(boardSize) && boardSize > 0 ? boardSize : ps.BOARD_SIZE;
                    const points = n * n;
                    return {
                        mainMinutes: Math.ceil(0.83 * points),
                        byoyomiSeconds: Math.ceil(0.24 * Math.pow(points, 0.75)),
                        maxTimeouts: Math.ceil(0.6 * Math.pow(points, 0.25))
                    };
                },
                updateTurn,
                updateReplayUI: () => { if (typeof updateReplayUI === 'function') updateReplayUI(); },
                colorStatus});

            function updateRadioStyles() {
                _seatOverlay.updateRadioStyles();
            }

            function syncState(state) {
                if (ps.tryPlayMode) exitTryPlay();
                if (state.boardSize) ps.BOARD_SIZE = state.boardSize;
                updateGeometry();
                if (state.board) ps.board = state.board.map((row) => row.slice());
                if (state.weights) ps.weights = state.weights.map((row) => row.slice());
                if (state.center) ps.center = { row: state.center.row, col: state.center.col };
                else ps.center = { row: Math.floor(ps.BOARD_SIZE / 2), col: Math.floor(ps.BOARD_SIZE / 2) };
                ps.komi = state.komi != null ? state.komi : computeKomiBySize(ps.BOARD_SIZE);
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer || 1;
                ps.blackScore = state.blackScore || 0;
                ps.whiteScore = state.whiteScore || 0;
                ps.lastMoveMarkers = (state.lastMoveMarkers || []).map((m) => ({ ...m }));
                ps.moveLog = (state.moveCoords || []).map((m) => ({ ...m }));
                ps.gameOver = !!state.gameOver;
                ps.winner = state.winner || null;
                ps.matchStarted = !!state.matchStarted;
                ps.matchTime = state.matchTime || null;
                if (ps.matchStarted || ps.moveLog.length > 0 || (ps.matchTime && ps.matchTime.settings)) ps.matchStartedOnce = true;
                if (state.slots) ps.slots = { black: !!state.slots.black, white: !!state.slots.white };
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
                        if (msg.color === 'black') ps.slots.black = true;
                        if (msg.color === 'white') ps.slots.white = true;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'slotOccupied':
                        if (msg.slot === 'black') ps.slots.black = true;
                        if (msg.slot === 'white') ps.slots.white = true;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'slotReleased':
                        if (msg.slot === 'black') ps.slots.black = false;
                        if (msg.slot === 'white') ps.slots.white = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'playerLeft':
                        if (msg.slot === 'black') ps.slots.black = false;
                        if (msg.slot === 'white') ps.slots.white = false;
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
                        if (msg.slots) ps.slots = { black: !!msg.slots.black, white: !!msg.slots.white };
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'boardSizeChanged':
                        ps.BOARD_SIZE = msg.boardSize;
                        initBoardArrays();
                        updateGeometry();
                        ps.komi = computeKomiBySize(ps.BOARD_SIZE);
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
                            if (msg.slots) ps.slots = { black: !!msg.slots.black, white: !!msg.slots.white };
                            updateRadioStyles();
                        }
                        break;
                    case 'broadcast':
                        if (msg.action === 'move' || msg.action === 'undoAccept' || msg.action === 'resign' || msg.action === 'drawAgreed' || msg.action === 'timeLoss') {
                            const wasOver = ps.gameOver;
                            syncState(msg);
                            if (!wasOver && msg.gameOver) {
                                if (msg.winner === 'black') qiAlert('黑胜。');
                                else if (msg.winner === 'white') qiAlert('白胜。');
                                else qiAlert('和棋。');
                            }
                        }
                        break;
                    case 'newGameStarted':
                        ps.mySlot = null;
                        colorStatus.textContent = '观战';
                        ps.slots = { black: false, white: false };
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
                        if (msg.data) QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(msg.data, 'WxD棋');
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
                    tryPlayTryMoveWxD(row, col);
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
                if (ps.tryPlayMode) setTryPlayStepWxD(ps.tryPlayStep - 1);
                else setReplayStep(ps.replayStep - 1);
            };
            document.getElementById('replayForwardBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStepWxD(ps.tryPlayStep + 1);
                else setReplayStep(ps.replayStep + 1);
            };
            document.getElementById('replaySlider').addEventListener('input', (e) => {
                const step = Number(e.target.value) || 0;
                if (ps.tryPlayMode) setTryPlayStepWxD(step);
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
            ps.komi = computeKomiBySize(ps.BOARD_SIZE);
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
                    if (typeof canvasCoordsFromClient === 'function' && typeof getClosestIntersection === 'function') {
                        const p = canvasCoordsFromClient(clientX, clientY);
                        return getClosestIntersection(p.x, p.y);
                    }
                    if (typeof pickIntersectionAtCanvas === 'function') {
                        const canvasEl = document.getElementById('goBoard');
                        const rect = canvasEl.getBoundingClientRect();
                        const scale = canvasEl.width / rect.width;
                        return pickIntersectionAtCanvas((clientX - rect.left) * scale, (clientY - rect.top) * scale);
                    }
                    return null;
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
