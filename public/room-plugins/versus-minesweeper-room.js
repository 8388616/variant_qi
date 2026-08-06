window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["versus-minesweeper"] = {
    shell: {
        "title": "对战扫雷",
        "rulesHtml": "基本规则同扫雷。<br /><br />双方互相埋雷。<br /><br />开局时会显视距离雷最远的格。<br /><br />",
        "defaultKomiText": "　",
        "boardSizeMin": 7,
        "boardSizeMax": 27,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "对战扫雷",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "versusMinesweeper": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "对战扫雷";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const ps = {
            ws: null,
            reconnectTimer: null,
            mySlot: null,
            boardSize: 19,
            phase: 'waiting',
            matchStarted: false,
            gameOver: false,
            winner: null,
            resultText: null,
            myBoard: null,
            progress: { black: 0, white: 0 },
            buryCounts: { black: 0, white: 0 },
            buryDone: { black: false, white: false },
            clock: null,
            slots: { black: false, white: false },
            mineCount: 72,
            settingsMode: null
        };

        const grid = document.getElementById('msGrid');
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const scoreTitle = document.getElementById('scoreTitle');
        const radioBlack = document.getElementById('radioBlack');
        const radioWhite = document.getElementById('radioWhite');
        const labelBlack = document.getElementById('labelBlack');
        const labelWhite = document.getElementById('labelWhite');
        const boardSizeSelect = document.getElementById('boardSizeSelect');
        const goTimerPanel = document.getElementById('goTimerPanel');
        const timerLabel = document.getElementById('timerLabel');
        const timerCount = document.getElementById('timerCount');
        const progBlackBlock = document.getElementById('progBlackBlock');
        const progWhiteBlock = document.getElementById('progWhiteBlock');
        const progBlack = document.getElementById('progBlack');
        const progWhite = document.getElementById('progWhite');
        const resignBtn = document.getElementById('resignBtn');
        const newGameBtn = document.getElementById('newGameBtn');
        const buryFinishBtn = document.getElementById('buryFinishBtn');
        const settingsModal = document.getElementById('settingsModal');
        const settingsTitle = document.getElementById('settingsTitle');
        const settingsHint = document.getElementById('settingsHint');
        const settingsFields = document.getElementById('settingsFields');
        const settingsConfirmBtn = document.getElementById('settingsConfirmBtn');
        const settingsAcceptBtn = document.getElementById('settingsAcceptBtn');
        const settingsAdjustBtn = document.getElementById('settingsAdjustBtn');
        const setBoardSize = document.getElementById('setBoardSize');
        const setMineCount = document.getElementById('setMineCount');
        const setBuryMin = document.getElementById('setBuryMin');
        const setSweepMin = document.getElementById('setSweepMin');

        function fillBoardSizeSelect(sel, selected) {
            const cur = String(selected != null ? selected : 19);
            sel.innerHTML = '';
            for (let n = 7; n <= 27; n++) {
                const opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n + '路';
                if (String(n) === cur) opt.selected = true;
                sel.appendChild(opt);
            }
        }
        fillBoardSizeSelect(boardSizeSelect, 19);
        fillBoardSizeSelect(setBoardSize, 19);

        let buttonsDown = 0;
        let chordArmed = false;
        let chordRow = -1;
        let chordCol = -1;
        let rafId = 0;
        const DIRS8 = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];

        function drawMineOnCanvas(canvas, hit) {
            const size = canvas.width;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            const cx = size / 2;
            const cy = size / 2;
            const cellSize = size;
            const spikeOuter = cellSize * 0.43;
            const spikeInner = cellSize * 0.26;
            const bodyRadius = cellSize * 0.24;
            ctx.save();
            ctx.fillStyle = hit ? '#4a0000' : '#303030';
            for (let i = 0; i < 8; i++) {
                const a = (Math.PI / 4) * i;
                const ax = Math.cos(a), ay = Math.sin(a);
                const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
                ctx.beginPath();
                ctx.moveTo(cx + ax * spikeOuter, cy + ay * spikeOuter);
                ctx.lineTo(cx + ax * spikeInner + px * cellSize * 0.05, cy + ay * spikeInner + py * cellSize * 0.05);
                ctx.lineTo(cx + ax * spikeInner - px * cellSize * 0.05, cy + ay * spikeInner - py * cellSize * 0.05);
                ctx.closePath();
                ctx.fill();
            }
            const bodyGrad = ctx.createRadialGradient(
                cx - bodyRadius * 0.35, cy - bodyRadius * 0.35, bodyRadius * 0.2,
                cx, cy, bodyRadius * 1.15
            );
            if (hit) {
                bodyGrad.addColorStop(0, '#ff8080');
                bodyGrad.addColorStop(0.45, '#cc2020');
                bodyGrad.addColorStop(1, '#5a0000');
            } else {
                bodyGrad.addColorStop(0, '#6c6c6c');
                bodyGrad.addColorStop(0.45, '#4e4e4e');
                bodyGrad.addColorStop(1, '#252525');
            }
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath();
            ctx.arc(cx - bodyRadius * 0.38, cy - bodyRadius * 0.45, bodyRadius * 0.23, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function cellSizePx() {
            const max = Math.min(560, Math.floor(window.innerWidth * 0.72));
            return Math.max(14, Math.floor(max / ps.boardSize));
        }

        function renderBoard() {
            const board = ps.myBoard;
            const n = ps.boardSize;
            const sz = cellSizePx();
            grid.style.gridTemplateColumns = `repeat(${n}, ${sz}px)`;
            grid.style.gridTemplateRows = `repeat(${n}, ${sz}px)`;
            grid.innerHTML = '';
            if (!board || !board.cells) {
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const el = document.createElement('div');
                        el.className = 'ms-cell closed';
                        el.style.width = sz + 'px';
                        el.style.height = sz + 'px';
                        el.dataset.row = r;
                        el.dataset.col = c;
                        grid.appendChild(el);
                    }
                }
                return;
            }
            const rec = board.recommend;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const cell = board.cells[r][c];
                    const el = document.createElement('div');
                    el.style.width = sz + 'px';
                    el.style.height = sz + 'px';
                    el.style.fontSize = Math.max(10, Math.floor(sz * 0.62)) + 'px';
                    el.dataset.row = r;
                    el.dataset.col = c;
                    let cls = 'ms-cell ';
                    if (cell.kind === 'closed') cls += 'closed';
                    else if (cell.kind === 'empty') cls += 'open empty';
                    else if (cell.kind === 'number') cls += 'open n' + cell.number;
                    else if (cell.kind === 'flag') cls += 'flag';
                    else if (cell.kind === 'question') cls += 'question';
                    else if (cell.kind === 'mine') cls += 'mine';
                    else if (cell.kind === 'mine-hit') cls += 'mine-hit';
                    else cls += 'closed';
                    if (rec && rec.r === r && rec.c === c && (cell.kind === 'closed' || cell.kind === 'flag' || cell.kind === 'question')) {
                        cls += ' recommend';
                    }
                    el.className = cls;
                    if (cell.kind === 'number') el.textContent = String(cell.number);
                    if (cell.kind === 'mine' || cell.kind === 'mine-hit') {
                        const cv = document.createElement('canvas');
                        cv.className = 'ms-mine-canvas';
                        cv.width = 64;
                        cv.height = 64;
                        drawMineOnCanvas(cv, cell.kind === 'mine-hit');
                        el.appendChild(cv);
                    }
                    grid.appendChild(el);
                }
            }
            if (chordArmed && chordRow >= 0 && chordCol >= 0) {
                applyChordPreview(chordRow, chordCol);
            }
        }

        function formatMs(ms) {
            const s = Math.max(0, Math.ceil(ms / 1000));
            const m = Math.floor(s / 60);
            const r = s % 60;
            return m + ':' + String(r).padStart(2, '0');
        }

        function updateTimerDisplay() {
            const showClock = ps.clock && (ps.phase === 'burying' || ps.phase === 'sweeping');
            const showProg = ps.phase === 'sweeping' || ps.phase === 'finished';
            if (!showClock && !showProg) {
                goTimerPanel.hidden = true;
                return;
            }
            goTimerPanel.hidden = false;
            document.getElementById('sharedTimerBlock').hidden = !showClock;
            if (showClock) {
                timerLabel.textContent = (ps.clock.label || '') + '时间';
                let rem = ps.clock.remainingMs;
                if (ps._clockRecvAt != null && ps.clock.remainingMs != null) {
                    rem = Math.max(0, ps.clock.remainingMs - (Date.now() - ps._clockRecvAt));
                }
                timerCount.textContent = formatMs(rem);
            }
            progBlackBlock.hidden = !showProg;
            progWhiteBlock.hidden = !showProg;
            if (showProg) {
                progBlack.textContent = (ps.progress.black || 0) + '%';
                progWhite.textContent = (ps.progress.white || 0) + '%';
            }
        }

        function tickClock() {
            updateTimerDisplay();
            rafId = requestAnimationFrame(tickClock);
        }

        function updateScore() {
            const b = ps.myBoard;
            if (ps.phase === 'burying' && b) {
                scoreTitle.textContent = '埋雷';
                scoreBoard.textContent =
                    `已埋雷: ${b.placed}\n目标雷数: ${b.target}\n还可埋: ${Math.max(0, b.target - b.placed)}`;
                const oppSlot = ps.mySlot === 'black' ? 'white' : 'black';
                const oppDone = ps.buryDone[oppSlot];
                const selfDone = ps.mySlot && ps.buryDone[ps.mySlot];
                if (selfDone) {
                    leadInfo.textContent = oppDone ? '双方已确认' : '已确认，等待对方埋雷结束…';
                } else {
                    leadInfo.textContent = `对方已埋: ${ps.buryCounts[oppSlot] || 0}` + (oppDone ? '（对方已确认）' : '');
                }
                return;
            }
            if ((ps.phase === 'sweeping' || ps.phase === 'finished') && b && b.opened != null) {
                scoreTitle.textContent = '己方进度';
                scoreBoard.textContent =
                    `已打开: ${b.opened}\n剩余格: ${b.remainingSafe}\n已标记雷: ${b.flagged}\n剩余雷: ${b.remainingMines}`;
                if (ps.gameOver && ps.resultText) leadInfo.textContent = ps.resultText;
                else if (b.failed) leadInfo.textContent = '已触雷，等待结果…';
                else if (b.finished) leadInfo.textContent = '已完成！';
                else leadInfo.textContent = `对方进度: ${ps.progress[ps.mySlot === 'black' ? 'white' : 'black'] || 0}%`;
                return;
            }
            scoreTitle.textContent = '　';
            scoreBoard.textContent = '　';
            leadInfo.textContent = '　';
        }

        function updateTurn() {
            if (ps.gameOver) {
                turnDisplay.textContent = '对局结束';
                return;
            }
            if (!ps.matchStarted) {
                turnDisplay.textContent = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                return;
            }
            if (ps.phase === 'burying') {
                const mineDone = ps.mySlot && ps.buryDone[ps.mySlot];
                turnDisplay.textContent = mineDone
                    ? '等待对方埋雷'
                    : '埋雷阶段';
            }
            else if (ps.phase === 'sweeping') turnDisplay.textContent = '扫雷阶段';
            else turnDisplay.textContent = '　';
        }

        function updateSeatsUI() {
            labelBlack.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            labelWhite.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            labelBlack.style.opacity = '';
            labelWhite.style.opacity = '';
            if (ps.slots.black) {
                labelBlack.classList.add(ps.mySlot === 'black' ? 'self-radio' : 'opponent-radio');
                labelBlack.classList.add('checked-disabled');
                radioBlack.disabled = true;
                radioBlack.checked = true;
            } else {
                radioBlack.disabled = !!ps.mySlot;
                radioBlack.checked = false;
            }
            if (ps.slots.white) {
                labelWhite.classList.add(ps.mySlot === 'white' ? 'self-radio' : 'opponent-radio');
                labelWhite.classList.add('checked-disabled');
                radioWhite.disabled = true;
                radioWhite.checked = true;
            } else {
                radioWhite.disabled = !!ps.mySlot;
                radioWhite.checked = false;
            }
            if (ps.mySlot === 'black') colorStatus.textContent = '已选择: 黑方';
            else if (ps.mySlot === 'white') colorStatus.textContent = '已选择: 白方';
            else colorStatus.textContent = '观战';
            const canSize = !ps.matchStarted && !ps.slots.black && !ps.slots.white && !ps.mySlot;
            boardSizeSelect.style.display = canSize ? '' : 'none';
            boardSizeSelect.value = String(ps.boardSize);
            resignBtn.style.display = ps.mySlot && ps.matchStarted && !ps.gameOver ? '' : 'none';
            const showBuryFinish = ps.phase === 'burying' && ps.mySlot && !ps.buryDone[ps.mySlot];
            buryFinishBtn.style.display = showBuryFinish ? '' : 'none';
        }

        function updateProgressPanel() {
            updateTimerDisplay();
        }

        function renderAll() {
            renderBoard();
            updateScore();
            updateTurn();
            updateSeatsUI();
            updateProgressPanel();
            updateTimerDisplay();
        }

        function applyState(msg) {
            if (msg.boardSize != null) {
                ps.boardSize = msg.boardSize;
                fillBoardSizeSelect(boardSizeSelect, ps.boardSize);
            }
            if (msg.phase != null) ps.phase = msg.phase;
            if (msg.matchStarted != null) ps.matchStarted = msg.matchStarted;
            if (msg.gameOver != null) ps.gameOver = msg.gameOver;
            if (msg.winner !== undefined) ps.winner = msg.winner;
            if (msg.resultText != null) ps.resultText = msg.resultText;
            if (msg.myBoard !== undefined) ps.myBoard = msg.myBoard;
            if (msg.progress) ps.progress = msg.progress;
            if (msg.buryCounts) ps.buryCounts = msg.buryCounts;
            if (msg.buryDone) ps.buryDone = msg.buryDone;
            if (msg.clock) {
                ps.clock = msg.clock;
                ps._clockRecvAt = Date.now();
            }
            if (msg.slots) ps.slots = msg.slots;
            if (msg.mineCount != null) ps.mineCount = msg.mineCount;
            if (msg.mySlot !== undefined && msg.mySlot != null) ps.mySlot = msg.mySlot;
            renderAll();
        }

        function hideSettings() {
            settingsModal.style.display = 'none';
            ps.settingsMode = null;
        }

        function showPropose(defaults) {
            ps.settingsMode = 'propose';
            settingsTitle.textContent = '设置对战规则';
            settingsHint.textContent = '双方确认后开始埋雷';
            settingsFields.style.opacity = '1';
            setBoardSize.disabled = false;
            setMineCount.disabled = false;
            setBuryMin.disabled = false;
            setSweepMin.disabled = false;
            fillBoardSizeSelect(setBoardSize, (defaults && defaults.boardSize) || ps.boardSize || boardSizeSelect.value);
            if (defaults) {
                setMineCount.value = defaults.mineCount;
                setBuryMin.value = defaults.buryMinutes;
                setSweepMin.value = defaults.sweepMinutes;
            }
            settingsConfirmBtn.hidden = false;
            settingsAcceptBtn.hidden = true;
            settingsAdjustBtn.hidden = true;
            settingsModal.style.display = 'flex';
        }

        function showRespond(proposal) {
            ps.settingsMode = 'respond';
            settingsTitle.textContent = '确认对战规则';
            settingsHint.textContent = '可接受，或调整后重新提交';
            fillBoardSizeSelect(setBoardSize, proposal.boardSize || ps.boardSize);
            setMineCount.value = proposal.mineCount;
            setBuryMin.value = proposal.buryMinutes;
            setSweepMin.value = proposal.sweepMinutes;
            setBoardSize.disabled = true;
            setMineCount.disabled = true;
            setBuryMin.disabled = true;
            setSweepMin.disabled = true;
            settingsFields.style.opacity = '0.85';
            settingsConfirmBtn.hidden = true;
            settingsAcceptBtn.hidden = false;
            settingsAdjustBtn.hidden = false;
            settingsModal.style.display = 'flex';
        }

        function showWait(text) {
            ps.settingsMode = 'wait';
            settingsTitle.textContent = '规则确认';
            settingsHint.textContent = text || '等待对方…';
            settingsFields.style.opacity = '0.5';
            setBoardSize.disabled = true;
            setMineCount.disabled = true;
            setBuryMin.disabled = true;
            setSweepMin.disabled = true;
            settingsConfirmBtn.hidden = true;
            settingsAcceptBtn.hidden = true;
            settingsAdjustBtn.hidden = true;
            settingsModal.style.display = 'flex';
        }

        function sendSettingsPayload() {
            return {
                type: 'settingsSubmit',
                boardSize: parseInt(setBoardSize.value, 10) || 19,
                mineCount: parseInt(setMineCount.value, 10) || 72,
                buryMinutes: parseInt(setBuryMin.value, 10) || 2,
                sweepMinutes: parseInt(setSweepMin.value, 10) || 5
            };
        }

        settingsConfirmBtn.onclick = () => {
            if (!ps.ws) return;
            setBoardSize.disabled = false;
            setMineCount.disabled = false;
            setBuryMin.disabled = false;
            setSweepMin.disabled = false;
            ps.ws.send(JSON.stringify(sendSettingsPayload()));
        };
        settingsAcceptBtn.onclick = () => {
            if (!ps.ws) return;
            ps.ws.send(JSON.stringify({ type: 'settingsAccept' }));
        };
        settingsAdjustBtn.onclick = () => {
            setBoardSize.disabled = false;
            setMineCount.disabled = false;
            setBuryMin.disabled = false;
            setSweepMin.disabled = false;
            settingsFields.style.opacity = '1';
            settingsConfirmBtn.hidden = false;
            settingsAcceptBtn.hidden = true;
            settingsAdjustBtn.hidden = true;
            settingsTitle.textContent = '调整对战规则';
            ps.settingsMode = 'propose';
        };

        function sendOpen(r, c) {
            if (!ps.ws || !ps.mySlot) return;
            if (ps.phase === 'burying') {
                if (ps.buryDone[ps.mySlot]) return;
                ps.ws.send(JSON.stringify({ type: 'buryClick', row: r, col: c, right: false }));
            } else if (ps.phase === 'sweeping') {
                ps.ws.send(JSON.stringify({ type: 'openCell', row: r, col: c }));
            }
        }
        function sendMark(r, c) {
            if (!ps.ws || !ps.mySlot) return;
            if (ps.phase === 'burying') {
                if (ps.buryDone[ps.mySlot]) return;
                ps.ws.send(JSON.stringify({ type: 'buryClick', row: r, col: c, right: true }));
            } else if (ps.phase === 'sweeping') {
                ps.ws.send(JSON.stringify({ type: 'markCell', row: r, col: c }));
            }
        }
        function sendChord(r, c) {
            if (!ps.ws || !ps.mySlot || ps.phase !== 'sweeping') return;
            ps.ws.send(JSON.stringify({ type: 'chordCell', row: r, col: c }));
        }

        function getChordInfo(r, c) {
            const board = ps.myBoard;
            if (!board || !board.cells || ps.phase !== 'sweeping') return null;
            const cell = board.cells[r] && board.cells[r][c];
            if (!cell || cell.kind !== 'number' || !(cell.number > 0)) return null;
            const n = ps.boardSize;
            let flagCnt = 0;
            const targets = [];
            for (const [dr, dc] of DIRS8) {
                const rr = r + dr;
                const cc = c + dc;
                if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
                const nc = board.cells[rr][cc];
                if (!nc) continue;
                if (nc.kind === 'flag') flagCnt++;
                else if (nc.kind === 'closed' || nc.kind === 'question') targets.push([rr, cc]);
            }
            if (flagCnt !== cell.number) return null;
            return { targets };
        }

        function clearChordPreview() {
            grid.querySelectorAll('.ms-cell.chord-preview').forEach((el) => {
                el.classList.remove('chord-preview', 'open', 'empty');
            });
        }

        function applyChordPreview(r, c) {
            clearChordPreview();
            const info = getChordInfo(r, c);
            if (!info) return false;
            for (const [rr, cc] of info.targets) {
                const el = grid.querySelector(`.ms-cell[data-row="${rr}"][data-col="${cc}"]`);
                if (!el) continue;
                el.className = 'ms-cell open empty chord-preview';
                el.textContent = '';
                el.querySelectorAll('canvas').forEach((cv) => cv.remove());
            }
            return true;
        }

        function cancelChord() {
            if (!chordArmed) return;
            chordArmed = false;
            chordRow = -1;
            chordCol = -1;
            clearChordPreview();
            renderBoard();
        }

        function releaseChord() {
            if (!chordArmed) return;
            const r = chordRow;
            const c = chordCol;
            chordArmed = false;
            chordRow = -1;
            chordCol = -1;
            // 保持预览，直接请求打开，等服务端状态刷新棋盘
            sendChord(r, c);
        }

        function chordPointerStillOnCell(clientX, clientY) {
            if (chordRow < 0 || chordCol < 0) return false;
            const el = document.elementFromPoint(clientX, clientY);
            const cell = el && el.closest ? el.closest('.ms-cell') : null;
            if (!cell || !grid.contains(cell)) return false;
            return parseInt(cell.dataset.row, 10) === chordRow
                && parseInt(cell.dataset.col, 10) === chordCol;
        }

        grid.addEventListener('contextmenu', (e) => e.preventDefault());

        grid.addEventListener('mousedown', (e) => {
            const cell = e.target.closest('.ms-cell');
            if (!cell || !ps.mySlot) return;
            e.preventDefault();
            const r = parseInt(cell.dataset.row, 10);
            const c = parseInt(cell.dataset.col, 10);
            buttonsDown = e.buttons;
            if ((e.buttons & 3) === 3) {
                if (applyChordPreview(r, c)) {
                    chordArmed = true;
                    chordRow = r;
                    chordCol = c;
                } else {
                    chordArmed = false;
                    chordRow = -1;
                    chordCol = -1;
                }
                return;
            }
            if (chordArmed) return;
            if (e.button === 0) sendOpen(r, c);
            else if (e.button === 2) sendMark(r, c);
        });

        grid.addEventListener('mousemove', (e) => {
            if (!chordArmed) return;
            if (!chordPointerStillOnCell(e.clientX, e.clientY)) {
                cancelChord();
            }
        });

        grid.addEventListener('mouseleave', () => {
            if (chordArmed) cancelChord();
        });

        window.addEventListener('mouseup', (e) => {
            buttonsDown = e.buttons;
            if (!chordArmed || (e.buttons & 3) !== 0) return;
            if (chordPointerStillOnCell(e.clientX, e.clientY)) {
                releaseChord();
            } else {
                cancelChord();
            }
        });

        let longPressTimer = null;
        grid.addEventListener('touchstart', (e) => {
            const cell = e.target.closest('.ms-cell');
            if (!cell || !ps.mySlot) return;
            const r = parseInt(cell.dataset.row, 10);
            const c = parseInt(cell.dataset.col, 10);
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                sendMark(r, c);
            }, 480);
        }, { passive: true });
        grid.addEventListener('touchend', (e) => {
            const cell = e.target.closest('.ms-cell');
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                if (cell && ps.mySlot) {
                    const r = parseInt(cell.dataset.row, 10);
                    const c = parseInt(cell.dataset.col, 10);
                    sendOpen(r, c);
                }
            }
        });
        grid.addEventListener('touchmove', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });

        radioBlack.addEventListener('change', () => {
            if (radioBlack.checked && ps.ws) ps.ws.send(JSON.stringify({ type: 'selectColor', color: 'black' }));
        });
        radioWhite.addEventListener('change', () => {
            if (radioWhite.checked && ps.ws) ps.ws.send(JSON.stringify({ type: 'selectColor', color: 'white' }));
        });
        boardSizeSelect.addEventListener('change', () => {
            if (!ps.ws) return;
            ps.ws.send(JSON.stringify({ type: 'setBoardSize', boardSize: parseInt(boardSizeSelect.value, 10) }));
        });
        newGameBtn.onclick = () => {
            if (!ps.ws || !ps.mySlot) { qiAlert('只有对局者可以开始新局'); return; }
            ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
        };
        buryFinishBtn.onclick = () => {
            if (!ps.ws || !ps.mySlot || ps.phase !== 'burying') return;
            if (ps.buryDone[ps.mySlot]) return;
            ps.ws.send(JSON.stringify({ type: 'buryFinish' }));
        };
        resignBtn.onclick = () => {
            if (!ps.ws || !ps.mySlot) return;
            if (!confirm('确认认输？')) return;
            ps.ws.send(JSON.stringify({ type: 'resign' }));
        };
        document.getElementById('helpBtn').onclick = () => {
            document.getElementById('rulesModal').style.display = 'flex';
        };
        document.getElementById('closeRulesBtn').onclick = () => {
            document.getElementById('rulesModal').style.display = 'none';
        };
        document.getElementById('rulesModal').onclick = (e) => {
            if (e.target.id === 'rulesModal') e.target.style.display = 'none';
        };
        document.getElementById('backToLobbyBtn').onclick = () => { location.href = '/qi'; };

        function handleMessage(msg) {
            switch (msg.type) {
                case 'joined':
                    if (msg.role === 'player' && msg.slot) ps.mySlot = msg.slot;
                    if (msg.state) applyState(msg.state);
                    break;
                case 'colorAssigned':
                    ps.mySlot = msg.color;
                    if (msg.color === 'black') ps.slots.black = true;
                    if (msg.color === 'white') ps.slots.white = true;
                    updateSeatsUI();
                    break;
                case 'slotOccupied':
                    if (msg.slot === 'black') ps.slots.black = true;
                    if (msg.slot === 'white') ps.slots.white = true;
                    updateSeatsUI();
                    break;
                case 'slotReleased':
                    if (msg.slot === 'black') ps.slots.black = false;
                    if (msg.slot === 'white') ps.slots.white = false;
                    if (ps.mySlot === msg.slot) ps.mySlot = null;
                    updateSeatsUI();
                    break;
                case 'gameState':
                    applyState(msg);
                    break;
                case 'boardSizeChanged':
                    applyState(msg);
                    break;
                case 'clockUpdate':
                    ps.clock = msg.clock;
                    ps._clockRecvAt = Date.now();
                    updateTimerDisplay();
                    break;
                case 'settingsNegotiation':
                    if (msg.mode === 'propose') showPropose(msg.defaults);
                    else if (msg.mode === 'respond') showRespond(msg.proposal);
                    break;
                case 'settingsWaitPeer':
                    showWait(msg.text);
                    break;
                case 'settingsAgreed':
                    hideSettings();
                    break;
                case 'phaseChanged':
                    break;
                case 'broadcast':
                    if (msg.action === 'gameResult') {
                        applyState(msg);
                        if (msg.resultText) qiAlert(msg.resultText);
                    } else {
                        applyState(msg);
                    }
                    break;
                case 'newGameRequest':
                    if (confirm('对方请求开始新局，是否同意？')) {
                        ps.ws.send(JSON.stringify({ type: 'newGameResponse', accept: true }));
                    } else {
                        ps.ws.send(JSON.stringify({ type: 'newGameResponse', accept: false }));
                    }
                    break;
                case 'info':
                    if (msg.message) qiAlert(msg.message);
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
            const roomPassword = sessionStorage.getItem('roomPassword_' + roomId);
            ps.ws = qiOpenRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                onMessage: handleMessage,
                onClose: () => {
                    ps.reconnectTimer = setTimeout(connectWebSocket, 2000);
                }
            });
        }

        window.addEventListener('resize', () => renderBoard());
        connectWebSocket();
        renderAll();
        rafId = requestAnimationFrame(tickClock);
        })();
    }
};
