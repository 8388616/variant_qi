window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['versus-schulte-grid'] = {
    shell: {
        "title": "对战舒尔特方格",
        "rulesHtml": "按顺序依次点击棋子。<br /><br />所有人共享进度，先点击的得分。<br /><br />",
        "defaultKomiText": "　",
        "boardSizeMin": 2,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "对战舒尔特方格",
        "features": {}
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};

        (function () {
            const C = QiSquareWeiqiCanvas;
            const CS = C.DEFAULT_CANVAS_SIZE;
            const MAX_PLAYERS = 4;
            let N = 9;                       // 路数，随服务器 state.boardSize 同步

            // ======================== DOM ========================
            const canvas = document.getElementById('goBoard');
            const boardContainer = document.getElementById('boardContainer');
            const turnDisplay = document.getElementById('turnDisplay');
            const scoreTitle = document.getElementById('scoreTitle');
            const scoreBoard = document.getElementById('scoreBoard');
            const leadInfo = document.getElementById('leadInfo');
            const colorStatus = document.getElementById('colorStatus');
            const sizeSelect = document.getElementById('boardSizeSelect');
            const newGameBtn = document.getElementById('newGameBtn');
            const showNumbersLabel = document.querySelector('.show-numbers-label');
            const gameTitleInfo = document.getElementById('gameTitleInfo');

            // ======================== 状态（全部来自服务器同步） ========================
            const S = {
                phase: 'lobby',        // lobby | countdown | playing | finished
                hostId: null,
                myPlayerId: null,
                players: [],           // [{id, score}]
                layout: null,          // layout[r][c] = 序号
                nextVal: 1,
                boardSize: 9,
                countdown: null,       // {deadlineServer, serverNow, recvAt} 或 null
                countdownTimer: null,
                lastClaimed: null,     // {row, col}
                lastScores: null,      // 本局最终积分（对局结束清座后仍显示结算用）
                lastMyId: null,        // 本局结束时自己的 id（清座后标记「（我）」用）
                ws: null,
                reconnectTimer: null
            };

            // ======================== UI 精简（不改公共代码，仅隐藏/改写） ========================
            (function slimUI() {
                [
                    'estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn',
                    'buryFinishBtn', 'importBtn', 'exportBtn', 'vsComputerBtn', 'replayMinesRow',
                    'replayPerspectiveRow', 'boardMarkOuter', 'editControls', 'styleSelect', 'subGameSelect',
                    'goTimerPanel', 'roomChat', 'replayPanel', 'scoreConfirmPanel', 'boardScrollX', 'boardScrollY'
                ].forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
                const sideSelect = document.getElementById('sideSelect');
                if (sideSelect) sideSelect.hidden = true;
                const komiInfo = document.getElementById('komiInfo');
                if (komiInfo) komiInfo.style.display = 'none';
                if (showNumbersLabel) showNumbersLabel.style.display = 'none';
                if (colorStatus) colorStatus.style.display = 'none';
                if (leadInfo) leadInfo.style.display = 'none';
                // 积分/序号大字号区不需要文字展示
                if (scoreTitle) scoreTitle.style.display = 'none';
                if (scoreBoard) scoreBoard.style.display = 'none';
                if (gameTitleInfo) gameTitleInfo.textContent = '对战舒尔特方格';
            })();

            // ======================== 当前玩家 ID 徽章（照抄 super-24：gameTitleInfo 右侧） ========================
            const idBox = document.createElement('div');
            idBox.id = 'playerIdBox';
            idBox.className = 's24-player-id-box';
            idBox.hidden = true;
            idBox.innerHTML = 'ID：<span id="playerIdText"></span>';
            if (gameTitleInfo && gameTitleInfo.parentNode) {
                gameTitleInfo.parentNode.insertBefore(idBox, gameTitleInfo.nextSibling);
            }
            const playerIdText = document.getElementById('playerIdText');
            function renderIdBox() {
                if (!idBox || !playerIdText) return;
                if (S.myPlayerId) {
                    idBox.hidden = false;
                    playerIdText.textContent = S.myPlayerId;
                } else {
                    idBox.hidden = true;
                    playerIdText.textContent = '';
                }
            }

            // ======================== 样式 ========================
            (function injectStyle() {
                const style = document.createElement('style');
                style.textContent = `
                    #vsMask { position: absolute; inset: 0; z-index: 5; display: flex;
                        flex-direction: column; align-items: center; justify-content: center; gap: 14px;
                        background: var(--qi-room-overlay, rgba(30,30,30,0.7));
                        user-select: none; -webkit-user-select: none; }
                    #vsStartBtn { font-size: 1.15rem; min-width: 200px; padding: 10px 28px; }
                    #vsCountdown { font-size: clamp(4.5rem, 16vw, 8rem); font-weight: 700; color: #fff7ea;
                        line-height: 1; text-shadow: 0 4px 18px rgba(0,0,0,0.45); }
                    #vsResult { color: #fff7ea; font-size: 1rem; line-height: 1.7; text-align: center;
                        white-space: pre-line; max-width: 320px; }
                    .s24-player-id-box { display: inline-flex; align-items: center; gap: 6px;
                        padding: 5px 14px; background: rgba(255, 250, 241, 0.92);
                        border: 1px solid var(--qi-room-line); border-radius: 999px;
                        font-size: 0.95rem; color: var(--qi-room-ink, #3a281c); }
                    .s24-player-id-box[hidden] { display: none !important; }
                    .s24-player-id-box span { color: var(--qi-room-accent-strong, #8a5a2b); }
                    .vs-score-table { width: 100%; border-collapse: collapse; margin-top: 10px;
                        font-size: 0.95rem; }
                    .vs-score-table th, .vs-score-table td { padding: 5px 8px; text-align: left;
                        border-bottom: 1px solid var(--qi-room-line, rgba(108,76,46,0.16)); }
                    .vs-score-table tr.me td { font-weight: 700; }
                    .vs-score-table .num { text-align: right; font-variant-numeric: tabular-nums; }
                `;
                document.head.appendChild(style);
            })();

            // 蒙版：任何非 playing 状态盖着棋盘（对局中全员可见棋盘，包括观战者）
            const mask = document.createElement('div');
            mask.id = 'vsMask';
            const startBtn = document.createElement('button');
            startBtn.type = 'button';
            startBtn.id = 'vsStartBtn';
            startBtn.className = 'qi-seat-overlay-btn';
            startBtn.textContent = '入座';
            const countdownEl = document.createElement('div');
            countdownEl.id = 'vsCountdown';
            countdownEl.style.display = 'none';
            const resultEl = document.createElement('div');
            resultEl.id = 'vsResult';
            resultEl.style.display = 'none';
            mask.appendChild(countdownEl);
            mask.appendChild(resultEl);
            mask.appendChild(startBtn);
            if (boardContainer) {
                boardContainer.style.position = 'relative';
                boardContainer.appendChild(mask);
            }
            startBtn.addEventListener('click', onStartClick);

            // ======================== 积分表（info-panel 下方） ========================
            const infoPanel = document.querySelector('.main-area-right .info-panel');
            let scoreTableEl = null;
            (function buildScoreTable() {
                const host = infoPanel && infoPanel.parentNode;
                if (!host) return;
                scoreTableEl = document.createElement('div');
                scoreTableEl.id = 'vsScoreTableWrap';
                scoreTableEl.innerHTML = '<table class="vs-score-table">' +
                    '<thead><tr><th>玩家</th><th class="num">积分</th></tr></thead>' +
                    '<tbody id="vsScoreBody"></tbody></table>';
                host.insertBefore(scoreTableEl, infoPanel.nextSibling);
            })();

            function renderScoreTable() {
                if (!scoreTableEl) return;
                const body = document.getElementById('vsScoreBody');
                if (!body) return;
                body.innerHTML = '';
                for (const p of S.players) {
                    const tr = document.createElement('tr');
                    if (p.id === S.myPlayerId) tr.className = 'me';
                    const tdId = document.createElement('td');
                    tdId.textContent = p.id + (p.id === S.hostId ? '（房主）' : '');
                    const tdScore = document.createElement('td');
                    tdScore.className = 'num';
                    tdScore.textContent = String(p.score);
                    tr.appendChild(tdId);
                    tr.appendChild(tdScore);
                    body.appendChild(tr);
                }
            }

            // ======================== 几何/绘制 ========================
            function geometry() { return C.computePaddingAndCell(N, CS); }
            function syncCanvas() { return C.setupHiDpiCanvas(canvas, CS); }

            function redraw() {
                if (!canvas) return;
                const ctx = syncCanvas();
                if (!ctx) return;
                const { padding, cellSize } = geometry();
                const stoneRadius = cellSize * 0.44;
                C.draw.clear(ctx, CS);
                C.draw.grid(ctx, N, padding, cellSize, CS);
                const starPts = C.getStarPoints(N).filter(([r, c]) => r >= 0 && r < N && c >= 0 && c < N);
                C.draw.starPoints(ctx, N, padding, cellSize, starPts);
                C.draw.coordLabels(ctx, N, padding, cellSize);

                const board = Array(N).fill().map(() => Array(N).fill(0));
                const nums = Array(N).fill().map(() => Array(N).fill(0));
                // 倒计时期间不显示棋子；对局/终局（含观战者）都完整显示棋盘
                const showStones = S.layout && S.phase !== 'countdown';
                if (showStones) {
                    for (let r = 0; r < N; r++) {
                        for (let c = 0; c < N; c++) {
                            const v = S.layout[r][c];
                            if (v <= 0) continue;
                            board[r][c] = (v % 2 === 1) ? 1 : 2;   // 单数黑、双数白
                            nums[r][c] = v;
                        }
                    }
                    // 最近一次被点中的序号：与舒尔特方格一致的下三角标记（先画、棋子盖住内侧）
                    if (S.lastClaimed) {
                        const { row, col } = S.lastClaimed;
                        const v = (S.layout[row] && S.layout[row][col]) || 0;
                        if (v > 0) {
                            C.draw.lastMoveMarkersLower(ctx, [{ row, col, color: (v % 2 === 1) ? 1 : 2 }],
                                padding, cellSize, stoneRadius, N);
                        }
                    }
                }
                C.draw.stonesBlackWhite(ctx, board, N, padding, cellSize, stoneRadius, true, 1);
                C.draw.moveNumbersOnStones(ctx, nums, board, N, padding, cellSize);
            }

            function hitTest(clientX, clientY) {
                const p = C.canvasCoordsFromClient(clientX, clientY, canvas, CS);
                const { padding, cellSize } = geometry();
                const { row, col } = C.getClosestIntersection(p.x, p.y, N, padding, cellSize);
                if (row < 0 || col < 0) return null;
                return { row, col };
            }

            // ======================== 点击 → 服务器判分 ========================
            canvas.addEventListener('click', (e) => {
                if (S.phase !== 'playing') return;
                if (!S.layout) return;
                const hit = hitTest(e.clientX, e.clientY);
                if (!hit) return;
                if (S.ws && S.ws.readyState === WebSocket.OPEN)
                    S.ws.send(JSON.stringify({ type: 'move', row: hit.row, col: hit.col }));
            });
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());

            // ======================== 中央按钮（入座/开始/新局） ========================
            function onStartClick() {
                if (S.phase === 'countdown' || S.phase === 'playing') return;
                if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
                if (!S.myPlayerId) {
                    S.ws.send(JSON.stringify({ type: 'joinGame' }));   // 入座
                } else if (S.myPlayerId === S.hostId) {
                    S.ws.send(JSON.stringify({ type: 'startGame' }));
                } else {
                    qiAlert('请等待房主开始游戏。');
                }
            }

            function isHost() { return !!S.hostId && S.myPlayerId === S.hostId; }
            function roomFull() { return S.players.length >= (S.maxPlayers || MAX_PLAYERS); }

            function renderMask() {
                if (S.phase === 'playing') {
                    // 对局中无蒙版：玩家与观战者都看到棋盘
                    mask.style.display = 'none';
                    return;
                }
                mask.style.display = 'flex';
                if (S.phase === 'countdown') {
                    countdownEl.style.display = '';
                    resultEl.style.display = 'none';
                    startBtn.style.display = 'none';
                    startCountdownDisplay();
                    return;
                }
                countdownEl.style.display = 'none';
                startBtn.style.display = '';
                if (S.phase === 'finished') {
                    resultEl.style.display = '';
                    // 用本局最终积分渲染（结束后除房主外的人已被请回观战，players 不再含完整名单）
                    const rows = (S.lastScores || S.players).slice().sort((a, b) => b.score - a.score);
                    const myId = S.myPlayerId || S.lastMyId;
                    resultEl.textContent = rows.map((p, i) =>
                        (i + 1) + '. ' + p.id + (myId && p.id === myId ? '（我）' : '') + '  ' + p.score + ' 分'
                    ).join('\n');
                    if (!S.myPlayerId) {
                        // 本局参与者已回观战：想参加下一局需重新点「入座」
                        startBtn.textContent = roomFull() ? '房间已满' : '入座';
                        startBtn.disabled = roomFull();
                    } else if (isHost()) {
                        startBtn.textContent = '新局';
                        startBtn.disabled = S.players.length < 2;
                    } else {
                        startBtn.style.display = 'none';   // 非房主：等待房主操作即可
                    }
                    return;
                }
                // lobby：只有可执行的动作才显示按钮
                resultEl.style.display = 'none';
                if (!S.myPlayerId) {
                    startBtn.textContent = roomFull() ? '房间已满' : '入座';
                    startBtn.disabled = roomFull();
                } else if (isHost()) {
                    startBtn.textContent = '开始游戏';
                    startBtn.disabled = S.players.length < 2;
                } else {
                    startBtn.style.display = 'none';       // 非房主：开局前无需操作
                }
            }

            /** 面板「新局」：始终显示；对局中（倒计时/进行中）不可用，结束后（房主）可用 */
            function updateNewGameBtn() {
                if (!newGameBtn) return;
                newGameBtn.style.display = '';
                newGameBtn.textContent = '新局';
                newGameBtn.disabled = S.phase !== 'finished' || !isHost() || S.players.length < 2;
                newGameBtn.onclick = () => {
                    if (S.ws && S.ws.readyState === WebSocket.OPEN)
                        S.ws.send(JSON.stringify({ type: 'startGame' }));
                };
            }

            // ======================== 路数选择（随服务器同步） ========================
            function updateSizeSelect() {
                if (!sizeSelect) return;
                sizeSelect.value = String(S.boardSize);
                // 开局前/对局结束后可改：无人入座时任何人都可改（选择器对所有人生效）；
                // 有人入座时仅房主可见可改；对局中隐藏
                const editable = S.phase === 'lobby' || S.phase === 'finished';
                const show = editable && (S.players.length === 0 || isHost());
                sizeSelect.style.display = show ? 'inline-block' : 'none';
            }

            // ======================== 倒计时（与服务器同步） ========================
            function startCountdownDisplay() {
                stopCountdownTimer();
                const showDigit = (n) => {
                    if (countdownEl.textContent !== String(n)) countdownEl.textContent = String(n);
                };
                showDigit(3);
                S.countdownTimer = setInterval(() => {
                    if (S.phase !== 'countdown') { stopCountdownTimer(); return; }
                    const remain = remainingMs();
                    if (remain <= 0) { stopCountdownTimer(); return; }
                    showDigit(Math.ceil(remain / 1000));
                }, 100);
            }

            function remainingMs() {
                if (!S.countdown) return 0;
                const now = Date.now();
                const elapsed = now - S.countdown.recvAt;
                return S.countdown.deadline - (S.countdown.serverNow + elapsed);
            }

            function stopCountdownTimer() {
                if (S.countdownTimer) { clearInterval(S.countdownTimer); S.countdownTimer = null; }
            }

            // ======================== 信息面板 ========================
            function statusText() {
                // 文案与其它棋类/公共层保持一致：观战、等待开始、对局结束等
                if (S.phase === 'playing' || S.phase === 'countdown') {
                    return '第' + S.nextVal + '手';          // 当前需要点击的数字
                }
                if (S.phase === 'finished') {
                    return S.myPlayerId ? '对局结束' : '观战';
                }
                // lobby（对应公共层「等待双方入座(1/2)」的计数风格）
                const k = S.players.length;
                if (!S.myPlayerId && roomFull()) return '观战';
                if (k < 2) return '等待玩家入座(' + k + '/4)';
                return '等待开始';
            }

            function updateInfoPanel() {
                if (turnDisplay) turnDisplay.textContent = statusText();
                renderScoreTable();
                renderIdBox();
                updateNewGameBtn();
                updateSizeSelect();
            }

            // ======================== 状态应用（服务器权威） ========================
            function applyState(state) {
                if (!state) return;
                if (Array.isArray(state.players)) S.players = state.players.slice();
                if (state.hostId !== undefined) S.hostId = state.hostId;
                if (state.phase) S.phase = state.phase;
                if (state.nextVal !== undefined) S.nextVal = Number(state.nextVal);
                if (state.boardSize) {
                    S.boardSize = Number(state.boardSize);
                    N = S.boardSize;
                }
                if (state.layout) S.layout = state.layout;
            }

            function handleMessage(msg) {
                if (!msg || !msg.type) return;
                switch (msg.type) {
                    case 'joined':
                        if (S.ws && S.ws.readyState === WebSocket.OPEN)
                            S.ws.send(JSON.stringify({ type: 'enterRoom' }));
                        break;
                    case 'playerJoined': {
                        S.myPlayerId = msg.playerId || null;
                        applyState(msg.state);
                        S.lastClaimed = null;
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'roomEntered': {
                        applyState(msg.state);
                        if (msg.state && msg.state.myPlayerId) S.myPlayerId = msg.state.myPlayerId;
                        else S.myPlayerId = null;
                        // 观战者/重连：立即按当前状态渲染棋盘（含对局中棋盘与最近落子）
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'stateUpdate': {
                        applyState(msg.state);
                        if (msg.state && msg.state.myPlayerId !== undefined) S.myPlayerId = msg.state.myPlayerId;
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'roundCountdown': {
                        applyState(msg.state);
                        S.countdown = { deadline: msg.deadline, serverNow: msg.serverNow, recvAt: Date.now() };
                        S.lastClaimed = null;
                        S.lastScores = null;   // 新一局开始，清掉上一局结算
                        S.lastMyId = null;
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'roundStart': {
                        applyState(msg.state);
                        S.countdown = null;
                        stopCountdownTimer();
                        S.lastClaimed = null;
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'progress': {
                        S.nextVal = Number(msg.nextVal);
                        if (Array.isArray(msg.scores)) S.players = msg.scores.slice();
                        S.lastClaimed = { row: msg.row, col: msg.col };
                        updateInfoPanel();
                        redraw();
                        break;
                    }
                    case 'roundFinished': {
                        S.phase = 'finished';
                        if (Array.isArray(msg.scores)) {
                            S.players = msg.scores.slice();
                            S.lastScores = msg.scores.slice();
                        }
                        S.lastMyId = S.myPlayerId;   // 随后服务器会把除房主外的人都请回观战
                        stopCountdownTimer();
                        updateInfoPanel();
                        renderMask();
                        redraw();
                        break;
                    }
                    case 'error':
                        if (msg.message) qiAlert(msg.message);
                        break;
                    default:
                        break;
                }
            }

            // ======================== WebSocket ========================
            function connectWebSocket() {
                if (S.reconnectTimer) { clearTimeout(S.reconnectTimer); S.reconnectTimer = null; }
                S.ws = C.connectWeiqiRoomWebSocket({
                    gameType,
                    roomId,
                    roomPassword,
                    onMessage: handleMessage,
                    connectWebSocket,
                    clearReconnectTimer: () => {
                        if (S.reconnectTimer) { clearTimeout(S.reconnectTimer); S.reconnectTimer = null; }
                    },
                    getReconnectTimer: () => S.reconnectTimer,
                    setReconnectTimer: (t) => { S.reconnectTimer = t; }
                });
            }

            // ======================== 控件接线 ========================
            if (sizeSelect) {
                // 选项已由公共 applyShellChrome 按 shell.boardSizeMin/Max(2..21) 生成；此处仅兜底并接管
                if (sizeSelect.options.length === 0) {
                    for (let n = 2; n <= 21; n++) {
                        const opt = document.createElement('option');
                        opt.value = String(n);
                        opt.textContent = n + ' 路';
                        sizeSelect.appendChild(opt);
                    }
                }
                sizeSelect.addEventListener('change', () => {
                    // 消息格式与公共 room.js 一致：{ type:'setBoardSize', size }
                    const newSize = parseInt(sizeSelect.value, 10);
                    if (S.ws && S.ws.readyState === WebSocket.OPEN)
                        S.ws.send(JSON.stringify({ type: 'setBoardSize', size: newSize }));
                });
            }

            // ======================== 说明弹层/返回 ========================
            const helpBtn = document.getElementById('helpBtn');
            const rulesModal = document.getElementById('rulesModal');
            const closeRulesBtn = document.getElementById('closeRulesBtn');
            if (helpBtn && rulesModal) helpBtn.onclick = () => { rulesModal.style.display = 'flex'; };
            if (closeRulesBtn && rulesModal) closeRulesBtn.onclick = () => { rulesModal.style.display = 'none'; };
            const backToLobbyBtn = document.getElementById('backToLobbyBtn');
            if (backToLobbyBtn) backToLobbyBtn.onclick = () => { window.location.href = '/qi'; };

            // ======================== 初始化 ========================
            window.addEventListener('resize', () => redraw());
            redraw();
            renderMask();
            updateInfoPanel();
            connectWebSocket();
        })();
    }
};
