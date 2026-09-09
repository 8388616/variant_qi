window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['schulte-grid'] = {
    shell: {
        "title": "舒尔特方格",
        "rulesHtml": "按顺序依次点击棋子。<br /><br />",
        "defaultKomiText": "　",
        "boardSizeMin": 2,
        "boardSizeMax": 21,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "舒尔特方格",
        "features": {}
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};

        (function () {
            const C = QiSquareWeiqiCanvas;
            const CS = C.DEFAULT_CANVAS_SIZE; // 600 逻辑画布

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

            // ======================== 状态 ========================
            const S = {
                N: 9,
                mono: false,          // 单色棋子（全白）
                layout: null,         // layout[r][c] = 序号 1..N²；null = 未初始化
                cellOf: null,         // cellOf[序号] = r*N+c
                phase: 'awaiting',    // awaiting | countdown | playing
                retained: false,      // true = 蒙版按钮为「重来」（同一布局再来一轮）
                nextVal: 1,
                lastIdx: -1,          // 最近落子索引（r*N+c），-1 无
                stonesHidden: false,  // 重来时先隐藏棋子，倒计时结束再显示
                startAtMs: 0,
                token: 0,             // 倒计时/定时器竞态令牌
                timer: null,
                ws: null,
                reconnectTimer: null,
                myPlayerId: null,
                roomPlayers: [],
                pendingJoin: false    // observer 已点开始、等待 joinGame 回执
            };

            // ======================== UI 精简（不改公共代码，仅隐藏/改写） ========================
            (function slimUI() {
                // 按钮面板只留「新局」
                [
                    'estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn',
                    'buryFinishBtn', 'importBtn', 'exportBtn', 'vsComputerBtn', 'replayMinesRow',
                    'replayPerspectiveRow', 'boardMarkOuter', 'editControls', 'styleSelect', 'subGameSelect',
                    'goTimerPanel', 'roomChat', 'replayPanel', 'scoreConfirmPanel', 'boardScrollX', 'boardScrollY'
                ].forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
                // 侧边选择/贴点条隐藏
                const sideSelect = document.getElementById('sideSelect');
                if (sideSelect) sideSelect.hidden = true;
                const komiInfo = document.getElementById('komiInfo');
                if (komiInfo) komiInfo.style.display = 'none';
                // 显示序号选项位置 → 「单色棋子」（序号常显，无关闭入口）
                if (showNumbersLabel) {
                    showNumbersLabel.innerHTML = '<input type="checkbox" id="showNumbersCheck"> 单色棋子';
                    const cb = document.getElementById('showNumbersCheck');
                    if (cb) {
                        cb.checked = false;
                        cb.onchange = () => { S.mono = !!cb.checked; redraw(); };
                    }
                }
                if (newGameBtn) {
                    newGameBtn.style.display = '';
                    newGameBtn.onclick = () => resetToAwaiting(true);
                }
                if (gameTitleInfo) gameTitleInfo.textContent = '舒尔特方格';
                // 隐藏公共状态胶囊与说明行（房间人数/leadInfo 不展示）
                if (colorStatus) colorStatus.style.display = 'none';
                if (leadInfo) leadInfo.style.display = 'none';
            })();

            // ======================== 样式 ========================
            (function injectStyle() {
                const style = document.createElement('style');
                style.textContent = `
                    #sgMask { position: absolute; inset: 0; z-index: 5; display: flex;
                        flex-direction: column; align-items: center; justify-content: center; gap: 20px;
                        background: var(--qi-room-overlay, rgba(30,30,30,0.7));
                        user-select: none; -webkit-user-select: none; }
                    #sgStartBtn, #sgContinueBtn { font-size: 1.15rem; min-width: 190px; padding: 10px 26px; }
                    #sgCountdown { font-size: clamp(4.5rem, 16vw, 8rem); font-weight: 700; color: #fff7ea;
                        line-height: 1; text-shadow: 0 4px 18px rgba(0,0,0,0.45); }
                `;
                document.head.appendChild(style);
            })();

            // 蒙版：进房即建；任何状态都盖着棋盘直到 playing
            const mask = document.createElement('div');
            mask.id = 'sgMask';
            const startBtn = document.createElement('button');
            startBtn.type = 'button';
            startBtn.id = 'sgStartBtn';
            startBtn.className = 'qi-seat-overlay-btn';
            startBtn.textContent = '开始游戏';
            const countdownEl = document.createElement('div');
            countdownEl.id = 'sgCountdown';
            countdownEl.style.display = 'none';
            const continueBtn = document.createElement('button');
            continueBtn.type = 'button';
            continueBtn.id = 'sgContinueBtn';
            continueBtn.className = 'qi-seat-overlay-btn';
            continueBtn.textContent = '继续';
            continueBtn.style.display = 'none';
            mask.appendChild(countdownEl);
            mask.appendChild(startBtn);
            mask.appendChild(continueBtn);
            if (boardContainer) {
                boardContainer.style.position = 'relative';
                boardContainer.appendChild(mask);
            }
            startBtn.addEventListener('click', onStartClick);
            continueBtn.addEventListener('click', onContinueClick);

            // ======================== 几何/绘制（调用公共导出，逻辑恒 600） ========================
            function geometry() {
                return C.computePaddingAndCell(S.N, CS);
            }
            function syncCanvas() {
                return C.setupHiDpiCanvas(canvas, CS);
            }
            function px(r, c, padding, cellSize) {
                return { x: padding + c * cellSize, y: padding + (S.N - 1 - r) * cellSize };
            }
            function colorOf(value) {
                // 单色：全白；否则单数为黑、双数为白
                if (S.mono) return 2;
                return (value % 2 === 1) ? 1 : 2;
            }
            function buildBoardAndNums() {
                const board = Array(S.N).fill().map(() => Array(S.N).fill(0));
                const nums = Array(S.N).fill().map(() => Array(S.N).fill(0));
                if (S.layout && !S.stonesHidden) {
                    for (let r = 0; r < S.N; r++) {
                        for (let c = 0; c < S.N; c++) {
                            const v = S.layout[r][c];
                            if (v > 0) { board[r][c] = colorOf(v); nums[r][c] = v; }
                        }
                    }
                }
                return { board, nums };
            }
            function redraw() {
                if (!canvas) return;
                const ctx = syncCanvas();
                if (!ctx) return;
                const { padding, cellSize } = geometry();
                const stoneRadius = cellSize * 0.44;
                C.draw.clear(ctx, CS);
                C.draw.grid(ctx, S.N, padding, cellSize, CS);
                const starPts = C.getStarPoints(S.N).filter(([r, c]) => r >= 0 && r < S.N && c >= 0 && c < S.N);
                C.draw.starPoints(ctx, S.N, padding, cellSize, starPts);
                C.draw.coordLabels(ctx, S.N, padding, cellSize);
                const { board, nums } = buildBoardAndNums();
                // 最近落子三角（棋子之下先画，只保留最后一个）；重来隐藏棋子时一并隐藏
                if (S.lastIdx >= 0 && !S.stonesHidden) {
                    const r = Math.floor(S.lastIdx / S.N), c = S.lastIdx % S.N;
                    const v = (S.layout && S.layout[r][c]) || 0;
                    C.draw.lastMoveMarkersLower(ctx, [{ row: r, col: c, color: v > 0 ? colorOf(v) : 1 }], padding, cellSize, stoneRadius, S.N);
                }
                C.draw.stonesBlackWhite(ctx, board, S.N, padding, cellSize, stoneRadius, true, 1);
                C.draw.moveNumbersOnStones(ctx, nums, board, S.N, padding, cellSize);
            }

            // ======================== 命中 ========================
            function hitTest(clientX, clientY) {
                const p = C.canvasCoordsFromClient(clientX, clientY, canvas, CS);
                const { padding, cellSize } = geometry();
                const { row, col } = C.getClosestIntersection(p.x, p.y, S.N, padding, cellSize);
                if (row < 0 || col < 0) return -1;
                return row * S.N + col;
            }

            // ======================== 流程 ========================
            function onStartClick() {
                if (S.phase === 'countdown' || S.phase === 'playing') return;
                if (!S.myPlayerId) {
                    // 尚未入座（observer）：先 joinGame 入座，回执后自动倒计时
                    if (S.pendingJoin) return;
                    S.pendingJoin = true;
                    startBtn.disabled = true;
                    if (S.ws && S.ws.readyState === WebSocket.OPEN)
                        S.ws.send(JSON.stringify({ type: 'joinGame' }));
                    else {
                        S.pendingJoin = false;
                        startBtn.disabled = false;
                    }
                    return;
                }
                beginCountdown();
            }

            function onContinueClick() {
                if (S.phase !== 'awaiting' || !S.myPlayerId) return;
                // 继续 = 新局 + 开始：重新随机布局并直接倒计时开局
                resetToAwaiting(true);
                beginCountdown();
            }

            function beginCountdown() {
                if (S.phase === 'countdown' || S.phase === 'playing') return;
                S.phase = 'countdown';
                const token = ++S.token;
                mask.style.display = 'flex';
                startBtn.style.display = 'none';
                continueBtn.style.display = 'none';
                countdownEl.style.display = '';
                if (S.retained) {
                    // 重来：先隐藏棋子，倒计时结束后再显示（同一布局）
                    S.stonesHidden = true;
                    redraw();
                }
                updateInfoPanel();
                const deadline = performance.now() + 3000;
                showCountdownDigit(3);
                stopTimer();
                setSizeSelectEnabled();
                S.timer = setInterval(() => {
                    if (S.token !== token) return;
                    const left = deadline - performance.now();
                    if (left <= 0) {
                        stopTimer();
                        startPlay(token);
                        return;
                    }
                    showCountdownDigit(Math.ceil(left / 1000));
                }, 100);
            }

            function showCountdownDigit(n) {
                if (countdownEl.textContent !== String(n)) countdownEl.textContent = String(n);
            }

            function startPlay(token) {
                if (S.token !== token) return;
                if (!S.layout) initLayout();
                S.stonesHidden = false;
                S.nextVal = 1;
                S.lastIdx = -1;
                S.startAtMs = performance.now();
                S.phase = 'playing';
                mask.style.display = 'none';
                stopTimer();
                updateTimeText(0);
                setSizeSelectEnabled();
                // 每 100ms 刷新用时显示
                S.timer = setInterval(() => {
                    if (S.token !== token) return;
                    if (S.phase !== 'playing') return;
                    updateTimeText((performance.now() - S.startAtMs) / 1000);
                }, 100);
                updateInfoPanel();
                redraw();
            }

            function initLayout() {
                const n = S.N;
                const seq = [];
                for (let i = 1; i <= n * n; i++) seq.push(i);
                // Fisher-Yates
                for (let i = seq.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const t = seq[i]; seq[i] = seq[j]; seq[j] = t;
                }
                const layout = Array(n).fill().map(() => Array(n).fill(0));
                const cellOf = Array(n * n + 1).fill(-1);
                for (let i = 0; i < seq.length; i++) {
                    const r = Math.floor(i / n), c = i % n;
                    layout[r][c] = seq[i];
                    cellOf[seq[i]] = i;
                }
                S.layout = layout;
                S.cellOf = cellOf;
            }

            function stopTimer() {
                if (S.timer) { clearInterval(S.timer); S.timer = null; }
            }

            function setSizeSelectEnabled() {
                // 倒计时/对局中锁定路数，防止中途换盘
                if (sizeSelect) sizeSelect.disabled = S.phase !== 'awaiting';
            }

            function resetToAwaiting(randomize) {
                // randomize=true（新局/改路数）：清布局重新随机；false（完成后的重来）保留布局
                const token = ++S.token;
                stopTimer();
                if (randomize) { S.layout = null; S.cellOf = null; S.retained = false; }
                S.nextVal = 1;
                S.lastIdx = -1;
                S.phase = 'awaiting';
                mask.style.display = 'flex';
                startBtn.style.display = '';
                startBtn.disabled = false;
                countdownEl.style.display = 'none';
                continueBtn.style.display = 'none';
                S.pendingJoin = false;
                S.stonesHidden = false;
                if (randomize && scoreBoard) scoreBoard.textContent = '--';
                setSizeSelectEnabled();
                startBtn.textContent = S.retained ? '重来' : '开始游戏';
                updateInfoPanel();
                redraw();
                void token;
            }

            // ======================== 信息面板 ========================
            function fmtTime(sec) { return sec.toFixed(2) + ' 秒'; }
            function updateTimeText(sec) {
                if (scoreBoard) scoreBoard.textContent = fmtTime(sec);
            }
            function updateInfoPanel() {
                if (turnDisplay) {
                    if (S.phase === 'playing' || S.phase === 'countdown') {
                        // 进度：当前需要点击的数字
                        turnDisplay.textContent = '第' + S.nextVal + '手';
                    } else if (S.retained) {
                        turnDisplay.textContent = '已完成';
                    } else {
                        turnDisplay.textContent = '等待开始';
                    }
                }
                if (scoreTitle) scoreTitle.textContent = '用时';
            }

            // ======================== 点击 ========================
            canvas.addEventListener('click', (e) => {
                if (S.phase !== 'playing') return;
                if (!S.layout) return;
                const idx = hitTest(e.clientX, e.clientY);
                if (idx < 0) return;
                if (S.cellOf[S.nextVal] !== idx) return; // 点错：静默忽略
                S.lastIdx = idx;
                S.nextVal++;
                redraw();
                updateInfoPanel();   // 刷新 turnDisplay 的“第 n 手”进度
                if (S.nextVal > S.N * S.N) {
                    finishRun();
                }
            });
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());

            async function finishRun() {
                stopTimer();
                const elapsed = (performance.now() - S.startAtMs) / 1000;
                updateTimeText(elapsed);
                if (scoreTitle) scoreTitle.textContent = '用时';
                if (turnDisplay) turnDisplay.textContent = '已完成';
                try {
                    await qiAlert('完成，用时' + elapsed.toFixed(2) + '秒。');
                } catch (err) { /* 无按钮框被关等情况仍继续 */ }
                S.retained = true;
                S.phase = 'awaiting';
                mask.style.display = 'flex';
                startBtn.style.display = '';
                startBtn.disabled = false;
                startBtn.textContent = '重来';
                // 「继续」位于重来按钮下方：= 新局 + 开始，直接进入下一局
                continueBtn.style.display = '';
                countdownEl.style.display = 'none';
                setSizeSelectEnabled();
                updateInfoPanel();
            }

            // ======================== 路数选择 ========================
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
                sizeSelect.style.display = 'inline-block';
                sizeSelect.value = String(S.N);
                sizeSelect.disabled = false;
                sizeSelect.addEventListener('change', () => {
                    const n = parseInt(sizeSelect.value, 10);
                    if (!Number.isFinite(n) || n < 2 || n > 21) return;
                    if (n !== S.N) {
                        S.N = n;
                        resetToAwaiting(true);
                    }
                });
            }

            // ======================== 响应式 ========================
            window.addEventListener('resize', () => { if (S.phase === 'playing' || S.layout) redraw(); });

            // ======================== WebSocket / 房间名单 ========================
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

            function applyRoster(players) {
                S.roomPlayers = Array.isArray(players) ? players : [];
                if (S.myPlayerId && S.roomPlayers.length > 0
                    && !S.roomPlayers.some((p) => p && p.id === S.myPlayerId)) {
                    // 名单里找不到自己（被让座/断线重连后）：回到观战态
                    S.myPlayerId = null;
                }
            }

            function handleMessage(msg) {
                if (!msg || !msg.type) return;
                switch (msg.type) {
                    case 'joined':
                        // 服务器已按 observer 处理（assignSlot 恒 null）；主动请求入座
                        if (S.ws && S.ws.readyState === WebSocket.OPEN)
                            S.ws.send(JSON.stringify({ type: 'enterRoom' }));
                        break;
                    case 'playerJoined':
                        S.myPlayerId = msg.playerId || null;
                        if (msg.state) applyRoster(msg.state.players);
                        if (S.pendingJoin) {
                            S.pendingJoin = false;
                            startBtn.disabled = false;
                            beginCountdown();
                        }
                        updateInfoPanel();
                        break;
                    case 'roomEntered':
                        if (msg.state) applyRoster(msg.state.players);
                        if (msg.state && msg.state.myPlayerId) S.myPlayerId = msg.state.myPlayerId;
                        updateInfoPanel();
                        break;
                    case 'playerListUpdate':
                        applyRoster(msg.players);
                        break;
                    case 'error':
                        if (msg.message) qiAlert(msg.message);
                        if (S.pendingJoin) {
                            S.pendingJoin = false;
                            startBtn.disabled = false;
                        }
                        break;
                    default:
                        break;
                }
            }

            // ======================== 说明弹层 ========================
            const helpBtn = document.getElementById('helpBtn');
            const rulesModal = document.getElementById('rulesModal');
            const closeRulesBtn = document.getElementById('closeRulesBtn');
            if (helpBtn && rulesModal) helpBtn.onclick = () => { rulesModal.style.display = 'flex'; };
            if (closeRulesBtn && rulesModal) closeRulesBtn.onclick = () => { rulesModal.style.display = 'none'; };
            const backToLobbyBtn = document.getElementById('backToLobbyBtn');
            if (backToLobbyBtn) backToLobbyBtn.onclick = () => { window.location.href = '/qi'; };

            // ======================== 初始化 ========================
            resetToAwaiting(true);
            connectWebSocket();
        })();
    }
};
