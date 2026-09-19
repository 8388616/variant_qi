window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['guess-number'] = {
    shell: {
        "title": "猜数字",
        "rulesHtml": "开局前，双方各在一张 n×n 方格（n=3~6）内填入 1~(n+1)² 的数字，可以重复，可以留空，对方看不到。填好后，猜对方的方格，先猜对的获胜。<br /><br />每回合双方各提交一次猜测，都提交后结算；逐格完全一致（含空格）即为猜对，同时猜对则平局。<br /><br />每条猜测旁边的提示数：绿色（左侧每行、上方每列）＝该行/该列猜中的数字个数，不看位置，同一数字按出现次数计，空格也算一个；红色（右侧每行、下方每列）＝该行/该列与答案相差不超过 n 或相差不小于 n²+n+1 的格数，位置要对，空格对空格也算；方格右侧的「共N格正确」＝整张方格完全猜对（位置和数字都对）的格数。<br /><br />离开房间的座位不能再入座；双方都离开房间则本局结束。<br /><br />",
        "defaultKomiText": "　",
        "boardSizeMin": 3,
        "boardSizeMax": 6,
        "defaultBoardSize": 4,
        "minLib": 1,
        "recordDownloadPrefix": "猜数字",
        "features": {}
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;

        (function () {
            const C = QiSquareWeiqiCanvas;

            // ======================== 状态（全部来自服务器同步） ========================
            const S = {
                ws: null,
                reconnectTimer: null,
                slot: null,                // 'player1' | 'player2' | null（旁观）
                state: null,               // 服务端下发的状态
                draft: null,               // 填数阶段的本地方格（n×n，null=空）
                guess: null,               // 对局阶段本地正在编辑的猜测
                clockOffset: 0,            // serverNow - Date.now()
                tickTimer: null,
                draftTimer: null,
                lastError: ''
            };

            // ======================== UI 精简（藏掉棋盘棋类的壳，不改公共代码） ========================
            (function slimUI() {
                // 认输/和棋/新局 三个按钮直接复用 button-panel 里的既有按钮（见 syncPanelButtons）
                // 注意：gameTitleInfo 是「游戏名」，照 schulte 等非棋类保留显示（只藏 komiInfo 贴目位）
                const ids = ['goBoard', 'komiInfo', 'editControls', 'boardMarkPanel',
                    'estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'endReqBtn', 'boardMarkExpandBtn',
                    'importBtn', 'scoreTitle', 'scoreBoard', 'leadInfo', 'scoreConfirmPanel',
                    'replayPanel', 'tryPlayPanel'];
                for (const id of ids) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                }
                for (const sel of ['.show-numbers-label', '.board-mark-fold', '#boardMarkSelect',
                    '.color-row', '#seatOverlay', '#turnDisplay', '.weiqi-board-view-row']) {
                    document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
                }
                const titleEl = document.getElementById('gameTitleInfo');
                if (titleEl) titleEl.textContent = '猜数字';      // 与其它非棋类一样显示游戏名
                const bc = document.getElementById('boardContainer');
                if (bc) {
                    bc.style.display = 'flex';
                    bc.style.position = 'relative';       // 蒙版（.qi-seat-overlay）以此为定位容器
                }
            })();

            // ======================== 自建 DOM ========================
            const style = document.createElement('style');
            style.textContent = `
.gn-wrap { display:flex; flex-direction:column; align-items:center; gap:14px; width:100%; padding:10px 0 30px; color:var(--qi-room-ink,#222); }
.gn-status { font-size:15px; min-height:22px; }
.gn-status b { color:#0a6; }
.gn-center { display:flex; flex-direction:column; align-items:center; gap:12px; }
.gn-grid { display:grid; gap:4px; }
.gn-cell { width:44px; height:44px; box-sizing:border-box; display:flex; align-items:center; justify-content:center;
    text-align:center; font-size:19px; border:1px solid #b9a184; border-radius:6px; background:#fffdf7; color:#222; }
input.gn-cell { padding:0; line-height:42px; display:block; }
.gn-cell:focus { outline:2px solid #0a6; }
.gn-cell[readonly] { background:#f3ead9; color:#222; }
.gn-cell:disabled { background:#f3ead9; }
.gn-side { display:flex; flex-direction:column; gap:8px; flex:1 1 0; min-width:0; }
.gn-sides { display:flex; gap:18px; width:100%; align-items:flex-start; }
.gn-side-title { font-size:14px; opacity:.85; text-align:center; }
.gn-main { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:8px; padding:10px;
    border:1px solid #d8c7ac; border-radius:10px; background:rgba(255,253,247,.75); }
.gn-main.gn-editable { border-color:#0a6; }
.gn-history-block { display:flex; flex-direction:column; gap:6px; }
.gn-legend { width:100%; text-align:center; font-size:12px; line-height:1.8; opacity:.85; }
.gn-history { height:260px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding:8px; border:1px solid #d8c7ac; border-radius:10px; background:rgba(255,253,247,.55); }
.gn-entry { display:flex; flex-direction:row; align-items:center; gap:10px; }
.gn-entry-col { display:flex; flex-direction:column; gap:2px; }
.gn-entry-cap { font-size:12px; opacity:.75; }
.gn-entry-total { font-size:12px; font-weight:600; color:#7a4a00; white-space:nowrap; }
.gn-mini { display:grid; gap:2px; }
.gn-mini .gn-hit { width:22px; height:22px; line-height:22px; text-align:center; font-size:12px; color:#0a7a3d; font-weight:600; }
.gn-mini .gn-near { width:22px; height:22px; line-height:22px; text-align:center; font-size:12px; color:#c02020; }
.gn-mini .gn-val { width:22px; height:22px; line-height:22px; text-align:center; font-size:13px; border:1px solid #cfbfa6; border-radius:4px; background:#fff; }
.gn-mini .gn-val.gn-empty { color:#bbb; }
.gn-mini .gn-corner { width:22px; height:22px; }
.gn-mini .gn-ball { background:#ffe9c9; border-color:#d8b98a; }
.gn-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center; }
.gn-btn { padding:7px 16px; font-size:15px; border:1px solid #b9a184; border-radius:8px; background:#fffdf7; cursor:pointer; }
.gn-btn:hover { background:#f3ead9; }
.gn-btn:disabled { opacity:.5; cursor:default; }
.gn-btn.gn-primary { background:#0a6; color:#fff; border-color:#0a6; }
.gn-btn.gn-primary:hover { background:#086; }
.gn-timer { font-size:15px; font-variant-numeric:tabular-nums; }
.gn-timer.gn-urgent { color:#c02020; font-weight:600; }
.gn-msg { font-size:14px; color:#c02020; min-height:20px; }
.gn-result { font-size:19px; font-weight:600; }
.gn-banner { padding:8px 14px; border-radius:8px; background:#ffe9c9; font-size:14px; }
.gn-seat-tip { text-align:center; font-size:13px; color:var(--qi-room-muted,#7a6a55); }
`;
            document.head.appendChild(style);

            const wrap = document.createElement('div');
            wrap.className = 'gn-wrap';
            const boardContainer = document.getElementById('boardContainer') || document.body;
            boardContainer.appendChild(wrap);

            let n = 4;               // 方格边长（随 state.boardSize 同步）
            let maxNum = 25;
            let cells = [];          // 填数阶段的输入框
            let guessCells = [];     // 对局阶段猜测输入框

            // ======================== 工具 ========================
            function readGrid(inputs) {
                const out = [];
                for (let r = 0; r < n; r++) {
                    const row = [];
                    for (let c = 0; c < n; c++) {
                        const el = inputs[r * n + c];
                        const v = el ? String(el.value || '').trim() : '';
                        row.push(v === '' ? null : Number(v));
                    }
                    out.push(row);
                }
                return out;
            }
            function gridFromServer(g) {
                if (!Array.isArray(g) || g.length !== n) return null;
                return g.map((row) => (Array.isArray(row) ? row.map((v) => (v == null ? '' : v)) : new Array(n).fill('')));
            }
            function send(payload) {
                if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(payload));
            }
            function remainMs(deadline) {
                if (!Number.isFinite(deadline)) return null;
                return Math.max(0, deadline - (Date.now() + S.clockOffset));
            }
            function fmtSec(ms) {
                if (ms == null) return '';
                return Math.ceil(ms / 1000) + ' 秒';
            }
            function myLabel() { return S.slot === 'player2' ? '白方' : '黑方'; }
            function oppLabel() { return S.slot === 'player2' ? '黑方' : '白方'; }
            function isHost() { return S.slot === 'player1' || !S.state || !S.state.slots.player1; }

            // ======================== 渲染 ========================
            function el(tag, cls, text) {
                const e = document.createElement(tag);
                if (cls) e.className = cls;
                if (text != null) e.textContent = text;
                return e;
            }

            /** 一张「只读方格」（可选：小尺寸 + 高亮猜对的格） */
            function buildReadonlyGrid(grid, opts) {
                const o = opts || {};
                const g = el('div', 'gn-grid' + (o.mini ? ' gn-mini' : ''));
                g.style.gridTemplateColumns = `repeat(${n}, ${o.mini ? '22px' : '44px'})`;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const v = grid && grid[r] ? grid[r][c] : null;
                        const cell = el('div', o.mini ? 'gn-val' : 'gn-cell', v == null || v === '' ? '' : String(v));
                        if (o.mini && (v == null || v === '')) cell.classList.add('gn-empty');
                        if (o.mini && o.hit && o.hit[r] && o.hit[r][c]) cell.classList.add('gn-ball');
                        if (!o.mini) cell.setAttribute('readonly', 'readonly');
                        g.appendChild(cell);
                    }
                }
                return g;
            }

            /**
             * 一条历史猜测：(n+2)×(n+2) 的小方格 ——
             *   绿（左列/上行）＝ 该行/该列的数字匹配数（不看位置，按出现次数计）；
             *   红（右列/下行）＝ 该行/该列「值接近且位置正确」的格数；
             *   整张完全猜对的格数显示在方格右侧的文字里（共N格正确）。
             */
            function buildHistoryEntry(entry) {
                const box = el('div', 'gn-entry');
                const col = el('div', 'gn-entry-col');
                col.appendChild(el('div', 'gn-entry-cap', `第 ${entry.round} 回合`));
                const mini = el('div', 'gn-mini');
                mini.style.gridTemplateColumns = `repeat(${n + 2}, 22px)`;
                const cellText = (v) => String(v || 0);
                // 首行：角 + 每列（绿）+ 角（总猜对数只显示在方格右侧的文字里）
                mini.appendChild(el('div', 'gn-corner'));
                for (let c = 0; c < n; c++) mini.appendChild(el('div', 'gn-hit', cellText((entry.colHits || [])[c])));
                mini.appendChild(el('div', 'gn-corner'));
                for (let r = 0; r < n; r++) {
                    mini.appendChild(el('div', 'gn-hit', cellText((entry.rowHits || [])[r])));
                    for (let c = 0; c < n; c++) {
                        const v = entry.grid && entry.grid[r] ? entry.grid[r][c] : null;
                        const cell = el('div', 'gn-val' + (v == null || v === '' ? ' gn-empty' : ''), v == null || v === '' ? '' : String(v));
                        mini.appendChild(cell);
                    }
                    mini.appendChild(el('div', 'gn-near', cellText((entry.rowNear || [])[r])));
                }
                // 末行：角 + 每列（红）+ 角
                mini.appendChild(el('div', 'gn-corner'));
                for (let c = 0; c < n; c++) mini.appendChild(el('div', 'gn-near', cellText((entry.colNear || [])[c])));
                mini.appendChild(el('div', 'gn-corner'));
                col.appendChild(mini);
                box.appendChild(col);
                // 方格正右方、同一行、垂直居中
                box.appendChild(el('div', 'gn-entry-total', `共${Number(entry.exactTotal) || 0}格正确`));
                return box;
            }

            /** 历史区的说明文字（用户可自行编辑；支持 <br /> 等 HTML） */
            function historyLegend() {
                const max = (n + 1) * (n + 1);
                return `左侧和上方显示的数字是该行/该列猜中的数字个数（忽略位置）。<br />`
                    + `右侧和下方显示的数字是该行/该列与答案相差不超过${n}（或相差不小于${n * n + n + 1}）的格数。`;
            }

            /** 跨栏居中的一条说明：放在两块历史区上方，整行只有一个 */
            function buildLegend() {
                const legend = el('div', 'gn-legend');
                legend.innerHTML = historyLegend();       // 用 innerHTML，<br /> 才会换行
                return legend;
            }

            /** 一块历史区：可滚动，新猜的在上 */
            function buildHistoryBox(entries) {
                const block = el('div', 'gn-history-block');
                const box = el('div', 'gn-history');
                const list = Array.isArray(entries) ? entries.slice().reverse() : [];
                for (const entry of list) box.appendChild(buildHistoryEntry(entry));
                box.scrollTop = 0;
                block.appendChild(box);
                return block;
            }

            /**
             * 可编辑方格（用于填数阶段与猜测）。
             * 越界/非法输入**直接忽略**：还原成这一格上一次的有效值（不清空），也不会把这个值报给服务端。
             */
            function buildEditableGrid(initial, onInput) {
                const g = el('div', 'gn-grid');
                g.style.gridTemplateColumns = `repeat(${n}, 44px)`;
                const inputs = [];
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const inp = el('input', 'gn-cell');
                        inp.type = 'text';
                        inp.setAttribute('inputmode', 'numeric');
                        inp.inputMode = 'numeric';
                        inp.maxLength = String(String(maxNum).length);
                        const v = initial && initial[r] ? initial[r][c] : '';
                        inp.value = v == null ? '' : String(v);
                        inp._lastValid = inp.value;         // 该格最后一次合法内容
                        inp.addEventListener('input', () => {
                            const raw = String(inp.value == null ? '' : inp.value).trim();
                            if (raw !== '') {
                                const num = Number(raw);
                                if (!Number.isInteger(num) || num < 1 || num > maxNum) {
                                    inp.value = inp._lastValid;   // 越界：无效输入，保留原值
                                    return;
                                }
                            }
                            inp._lastValid = inp.value;
                            onInput(inputs);
                        });
                        inputs.push(inp);
                        g.appendChild(inp);
                    }
                }
                return { grid: g, inputs };
            }

            /**
             * 旁观者的版面：上排两块空方格（甲/乙），中间一条跨栏说明，下排两块历史区。
             * 方格只画格子不给数字（也没有可编辑的输入框），布局与对局者看到的一致。
             */
            function renderObserverView(st) {
                const hist = st.allHistory || { player1: [], player2: [] };
                const sides = el('div', 'gn-sides');
                const buildSide = (title) => {
                    const side = el('div', 'gn-side');
                    side.appendChild(el('div', 'gn-side-title', title));
                    const main = el('div', 'gn-main');
                    main.appendChild(buildReadonlyGrid(null));
                    main.appendChild(reservedButtonRow());
                    main.style.minHeight = mainBoxMinHeight() + 'px';
                    side.appendChild(main);
                    return side;
                };
                sides.appendChild(buildSide('黑方的方格'));
                sides.appendChild(buildSide('白方的方格'));
                wrap.appendChild(sides);

                wrap.appendChild(buildLegend());          // 跨栏居中的一条说明

                const histRow = el('div', 'gn-sides');
                const histA = el('div', 'gn-side');
                histA.appendChild(buildHistoryBox(hist.player1));
                const histB = el('div', 'gn-side');
                histB.appendChild(buildHistoryBox(hist.player2));
                histRow.appendChild(histA);
                histRow.appendChild(histB);
                wrap.appendChild(histRow);
            }

            /** 主方格框的固定高度：方格 + 与按钮行的间距 + 预留一行按钮（两框同高，即便不显示按钮） */
            function mainBoxMinHeight() {
                return n * 44 + (n - 1) * 4 + 8 + 48;
            }

            /** 占位按钮行：样式与真的「提交」行完全一致但不可见，保证两侧主方格框一样高 */
            function reservedButtonRow() {
                const row = el('div', 'gn-row');
                const ghost = el('button', 'gn-btn gn-primary', '提交');
                ghost.type = 'button';
                ghost.disabled = true;
                ghost.style.visibility = 'hidden';
                row.appendChild(ghost);
                return row;
            }

            function render() {
                const st = S.state;
                wrap.innerHTML = '';
                updateSeatOverlay(st);
                syncPanelButtons(st);
                if (!st) {
                    wrap.appendChild(el('div', 'gn-status', '正在连接…'));
                    return;
                }
                n = st.boardSize || n;
                maxNum = st.maxNumber || (n + 1) * (n + 1);
                S.clockOffset = (st.serverNow || Date.now()) - Date.now();

                // 顶部状态
                const status = el('div', 'gn-status');
                if (st.phase === 'filling') {
                    status.innerHTML = `填数：${n}×${n}，每格填 1~${maxNum} 的整数，可重复、可留空（对方看不到你填的）`;
                } else {
                    status.innerHTML = `第 <b>${st.round}</b> 回合`;
                }
                wrap.appendChild(status);
                if (S.lastError) {
                    const msg = el('div', 'gn-msg', S.lastError);
                    wrap.appendChild(msg);
                }

                // 格数下拉（复用壳的 路数 选择）：只在填数阶段可改，对局开始后隐藏
                const sizeSel = document.getElementById('boardSizeSelect');
                if (sizeSel) {
                    const canPick = st.phase === 'filling' && !!S.slot && !st.confirmed[S.slot];
                    sizeSel.style.display = (st.phase === 'filling' && !!S.slot) ? 'inline-block' : 'none';
                    sizeSel.disabled = !canPick;
                    if (String(sizeSel.value) !== String(n)) sizeSel.value = String(n);
                }

                if (st.phase === 'filling') renderFilling(st);
                else renderPlaying(st);
            }

            function renderFilling(st) {
                const center = el('div', 'gn-center');
                if (!S.slot) {
                    renderObserverView(st);     // 旁观者：左右两块空方格（填数阶段还没有猜测历史）
                    return;
                }
                const confirmed = !!st.confirmed[S.slot];
                const oppConfirmed = !!st.confirmed[S.slot === 'player1' ? 'player2' : 'player1'];
                if (!S.draft) S.draft = gridFromServer(st.myGrid) || gridFromServer(st.myDraft) || freshDraft();

                if (confirmed) {
                    center.appendChild(el('div', 'gn-banner', '你已确定，不能修改。'));
                    center.appendChild(buildReadonlyGrid(S.draft));
                    if (!oppConfirmed) center.appendChild(el('div', 'gn-status', '等待对方确定…'));
                    wrap.appendChild(center);
                    return;
                }
                const built = buildEditableGrid(S.draft, (inputs) => {
                    S.draft = readGrid(inputs);
                    scheduleDraft();
                });
                cells = built.inputs;
                center.appendChild(built.grid);
                const row = el('div', 'gn-row');
                const timer = el('div', 'gn-timer', '');
                timer.dataset.role = 'fillingTimer';
                row.appendChild(timer);
                const okBtn = el('button', 'gn-btn gn-primary', '确定');
                okBtn.onclick = () => {
                    S.draft = readGrid(cells);
                    send({ type: 'confirmGrid', grid: S.draft });
                };
                row.appendChild(okBtn);
                center.appendChild(row);
                center.appendChild(el('div', 'gn-status', oppConfirmed ? '对方已确定，等你确定' : '对方还在填…'));
                wrap.appendChild(center);
            }

            function renderPlaying(st) {
                // 旁观者：看得到双方的方格（空着、不可编辑）与双方的猜测
                if (!S.slot) {
                    wrap.appendChild(el('div', 'gn-banner', st.phase === 'over'
                        ? `对局结束：${st.resultText || '和棋'}`
                        : `对局中（第 ${st.round} 回合）`));
                    renderObserverView(st);
                    return;
                }
                // 上半：两块主方格
                const sides = el('div', 'gn-sides');
                const oppSide = el('div', 'gn-side');
                const mySide = el('div', 'gn-side');

                // ---- 对方一侧：主方格 = 我的猜测（可编辑 / 已提交则只读） ----
                oppSide.appendChild(el('div', 'gn-side-title', `对方的方格`));
                const oppMain = el('div', 'gn-main');
                const submittedMine = !!st.submitted[S.slot];
                if (st.phase === 'over') {
                    const revealed = st.oppRevealed;
                    oppMain.appendChild(revealed
                        ? buildReadonlyGrid(revealed)
                        : el('div', 'gn-status', '（对方没有确定方格）'));
                    oppMain.appendChild(reservedButtonRow());
                } else if (submittedMine) {
                    oppMain.appendChild(buildReadonlyGrid(S.guess));
                    oppMain.appendChild(el('div', 'gn-status', '已提交，等对方提交…'));
                    oppMain.appendChild(reservedButtonRow());
                } else {
                    if (!S.guess) S.guess = freshDraft();
                    const built = buildEditableGrid(S.guess, (inputs) => {
                        S.guess = readGrid(inputs);
                        scheduleGuessDraft();            // 超时按草稿自动提交
                    });
                    guessCells = built.inputs;
                    oppMain.classList.add('gn-editable');
                    oppMain.appendChild(built.grid);
                    const row = el('div', 'gn-row');
                    const submitBtn = el('button', 'gn-btn gn-primary', '提交');
                    submitBtn.onclick = () => {
                        S.guess = readGrid(guessCells);
                        send({ type: 'submitGuess', grid: S.guess });
                    };
                    row.appendChild(submitBtn);
                    oppMain.appendChild(row);
                }
                oppMain.style.minHeight = mainBoxMinHeight() + 'px';
                oppSide.appendChild(oppMain);

                // ---- 我方一侧：主方格 = 我的方格（只读） ----
                mySide.appendChild(el('div', 'gn-side-title', `我方的方格`));
                const myMain = el('div', 'gn-main');
                myMain.appendChild(S.draft ? buildReadonlyGrid(S.draft) : buildReadonlyGrid(st.myGrid));
                myMain.appendChild(reservedButtonRow());
                myMain.style.minHeight = mainBoxMinHeight() + 'px';
                mySide.appendChild(myMain);

                sides.appendChild(oppSide);
                sides.appendChild(mySide);
                wrap.appendChild(sides);

                // 中间：跨栏居中的一条说明（整行只有一个）
                wrap.appendChild(buildLegend());

                // 下半：两块历史区（左＝我猜对方的、右＝对方猜我的）
                const histRow = el('div', 'gn-sides');
                const histA = el('div', 'gn-side');
                histA.appendChild(buildHistoryBox(st.myHistory));
                const histB = el('div', 'gn-side');
                histB.appendChild(buildHistoryBox(st.otherHistory));
                histRow.appendChild(histA);
                histRow.appendChild(histB);
                wrap.appendChild(histRow);

                // 底部：计时 +（认输/和棋/新局 复用 button-panel 的按钮，见 syncPanelButtons）
                const bottom = el('div', 'gn-row');
                const timer = el('div', 'gn-timer', '');
                timer.dataset.role = 'roundTimer';
                bottom.appendChild(timer);
                if (st.phase === 'over') {
                    wrap.appendChild(el('div', 'gn-result', st.resultText || (st.winner === 'draw' ? '和棋' : '')));
                } else if (S.slot && st.pendingDraw && !st.pendingDraw.mine) {
                    const b = el('div', 'gn-banner', '对方提议和棋：');
                    const yes = el('button', 'gn-btn gn-primary', '同意');
                    yes.onclick = () => send({ type: 'drawResponse', accept: true });
                    const no = el('button', 'gn-btn', '拒绝');
                    no.onclick = () => send({ type: 'drawResponse', accept: false });
                    b.appendChild(yes);
                    b.appendChild(no);
                    bottom.appendChild(b);
                } else if (S.slot && st.pendingDraw && st.pendingDraw.mine) {
                    bottom.appendChild(el('div', 'gn-banner', '已向对方提议和棋，等对方回应…'));
                }
                wrap.appendChild(bottom);
                if (!st.slots.player2) wrap.appendChild(el('div', 'gn-banner', '等待对方入座…'));
            }

            function freshDraft() {
                return Array.from({ length: n }, () => new Array(n).fill(''));
            }

            // ======================== 草稿上报（填数超时按草稿确定，猜测超时按草稿提交） ========================
            function sendDraftSoon(getGrid) {
                if (S.draftTimer) clearTimeout(S.draftTimer);
                S.draftTimer = setTimeout(() => {
                    S.draftTimer = null;
                    send({ type: 'draftGrid', grid: getGrid() });
                }, 250);
            }
            function scheduleDraft() { sendDraftSoon(() => S.draft); }
            function scheduleGuessDraft() { sendDraftSoon(() => S.guess); }

            // ======================== 落座蒙版（照棋盘棋类的观感：.qi-seat-overlay + 入座按钮） ========================
            let seatOverlay = null;
            function updateSeatOverlay(st) {
                const bc = document.getElementById('boardContainer');
                if (!bc) return;
                const visible = !!st && !S.slot && st.phase !== 'over';
                if (!visible) {
                    if (seatOverlay && seatOverlay.parentNode) seatOverlay.parentNode.removeChild(seatOverlay);
                    seatOverlay = null;
                    return;
                }
                const seatsFull = !!(st.slots && st.slots.player1 && st.slots.player2);
                if (!seatOverlay) {
                    seatOverlay = el('div', 'qi-seat-overlay');
                    const inner = el('div', 'qi-seat-overlay-inner');
                    const sitBtn = el('button', 'qi-seat-overlay-btn', seatsFull ? '观战' : '入座');
                    sitBtn.type = 'button';
                    sitBtn.onclick = () => send({ type: 'takeSeat' });
                    const tip = el('div', 'gn-seat-tip', '');
                    inner.appendChild(sitBtn);
                    inner.appendChild(tip);
                    seatOverlay.appendChild(inner);
                    seatOverlay._sitBtn = sitBtn;
                    seatOverlay._tip = tip;
                    bc.appendChild(seatOverlay);
                }
                seatOverlay._sitBtn.textContent = seatsFull ? '观战' : '入座';
                seatOverlay._sitBtn.disabled = seatsFull;
            }

            // ======================== 复用 button-panel 的 认输 / 和棋 / 新局 ========================
            function syncPanelButtons(st) {
                const seated = !!S.slot;
                const over = !!(st && (st.phase === 'over' || st.gameOver));

                const resignBtn = document.getElementById('resignBtn');
                if (resignBtn) {
                    resignBtn.style.display = (st && seated && !over) ? '' : 'none';
                    resignBtn.onclick = () => {
                        if (!S.slot) { qiAlert('只有对局者可以认输'); return; }
                        qiConfirm('确定认输吗？').then((ok) => { if (ok) send({ type: 'resign' }); });
                    };
                }
                const drawBtn = document.getElementById('drawBtn');
                if (drawBtn) {
                    drawBtn.style.display = (st && seated && !over) ? '' : 'none';
                    drawBtn.disabled = !!(st && st.pendingDraw);
                    drawBtn.onclick = () => {
                        if (!S.slot || (st && st.pendingDraw)) return;
                        const opp = S.slot === 'player1' ? 'player2' : 'player1';
                        const hasOpp = !!(st && st.slots && st.slots[opp]);
                        qiConfirm(hasOpp ? '确定向对方申请和棋吗？' : '确定和棋吗？')
                            .then((ok) => { if (ok) send({ type: 'requestDraw' }); });
                    };
                }
                const newGameBtn = document.getElementById('newGameBtn');
                if (newGameBtn) {
                    newGameBtn.style.display = '';
                    newGameBtn.textContent = '新局';
                    newGameBtn.disabled = !(st && seated && over);
                    newGameBtn.onclick = () => {
                        if (!st || !S.slot || !(st.phase === 'over' || st.gameOver)) return;
                        qiConfirm('确定开始新局吗？').then((ok) => { if (ok) send({ type: 'requestNewGame' }); });
                    };
                }
            }

            // ======================== 计时（每秒刷新显示） ========================
            function tick() {
                const st = S.state;
                if (!st) return;
                const t = wrap.querySelector('[data-role="fillingTimer"], [data-role="roundTimer"]');
                if (!t) return;
                const mine = st.myDeadline;
                const ms = remainMs(mine);
                if (ms == null) { t.textContent = ''; return; }
                t.textContent = `剩余 ${fmtSec(ms)}`;
                t.classList.toggle('gn-urgent', ms <= 10000);
            }
            if (S.tickTimer) clearInterval(S.tickTimer);
            S.tickTimer = setInterval(tick, 500);

            // ======================== 消息 ========================
            function applyState(state) {
                if (!state) return;
                if (S.state && Number.isFinite(S.state.seq) && Number.isFinite(state.seq) && state.seq < S.state.seq) return;
                S.state = state;
                S.lastError = '';
                if (state.mySlot !== undefined) S.slot = state.mySlot || null;
                const nChanged = Number(state.boardSize) !== n;
                n = Number(state.boardSize) || n;
                maxNum = Number(state.maxNumber) || (n + 1) * (n + 1);
                if (nChanged) { S.draft = null; S.guess = null; cells = []; guessCells = []; }
                if (state.phase === 'playing' && !S.guess)
                    S.guess = gridFromServer(state.myGuessDraft) || freshDraft();   // 刷新页面也能接着填
                render();
            }

            function handleMessage(msg) {
                if (!msg || !msg.type) return;
                switch (msg.type) {
                    case 'joined':
                        S.slot = msg.slot || null;
                        applyState(msg.state);
                        break;
                    case 'seatTaken':
                        S.slot = msg.slot || S.slot;
                        break;
                    case 'stateUpdate':
                        applyState(msg.state);
                        break;
                    case 'error':
                        S.lastError = msg.message || '出错了';
                        render();
                        break;
                    case 'drawRequest':
                        if (S.state) { S.state.pendingDraw = { requester: S.slot === 'player1' ? 'player2' : 'player1', mine: false }; render(); }
                        break;
                    case 'drawDeclined':
                        S.lastError = '对方拒绝了和棋';
                        render();
                        break;
                    default:
                        break;
                }
            }

            // ======================== 连接 ========================
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

            // ======================== 格数下拉（复用壳的 boardSizeSelect，3~6） ========================
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (sizeSelect) {
                if (sizeSelect.options.length === 0) {
                    for (let k = 3; k <= 6; k++) {
                        const opt = document.createElement('option');
                        opt.value = String(k);
                        opt.textContent = k + ' 路';
                        sizeSelect.appendChild(opt);
                    }
                }
                sizeSelect.addEventListener('change', () => {
                    const v = parseInt(sizeSelect.value, 10);
                    send({ type: 'setBoardSize', size: v });
                });
            }

            const backBtn = document.getElementById('backToLobbyBtn');
            if (backBtn) backBtn.onclick = () => { window.location.href = '/qi'; };

            window.addEventListener('resize', render);
            render();
            connectWebSocket();
        })();
    }
};
