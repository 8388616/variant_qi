window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["random-instability-wuziqi"] = {
    shell: {
        "title": "随机不稳定五子棋",
        "rulesHtml": "基本规则同五子棋。<br /><br />每个棋子都会获得一个随机寿命。每下一手棋所有棋子的寿命减1，寿命归零的棋子消失。<br><br />随着棋局的进程，棋子寿命的随机范围会逐渐增长。<br /><br />",
        "defaultKomiText": "无禁手",
        "boardSizeMin": 7,
        "boardSizeMax": 15,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "随机不稳定五子棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true
        },
        "editTools": [
            { "value": "empty", "label": "空" },
            { "value": "black", "label": "黑子" },
            { "value": "white", "label": "白子" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "随机不稳定五子棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
let BOARD_SIZE = 9;
        let PADDING;
        let CELL_SIZE;
        (function initRiGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(BOARD_SIZE);
            PADDING = g.padding;
            CELL_SIZE = g.cellSize;
        })();

        // 游戏状态
        let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        let lifetimes = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        let currentPlayer = 'black';
        let moveCount = 0;
        let nextLifetimePreview = 0;
        let matchStarted = false;
        let matchTime = null;
        let gameOver = false;
        let winner = null;
        let lastMoveMarkers = [];
        let showEstimateActive = false;
        let cachedLiveBoard = null;
        let cachedTerritory = null;

        let replayMode = false;
        let replaySnapshots = [];
        let replayStep = 0;
        let replayTotalSteps = 0;
        let moveLog = [];
        let liveReplaySnapshots = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;
        let showMoveNumbers = false;
        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBoards = [];
        let tryPlayLifetimes = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 1;
        let tryPlayStep = 0;
        let tryPlayTotalSteps = 0;
        let tryPlayMeta = [];

        let userBoardMarks = Object.create(null);
        const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        let mySlot = null;
        let slots = { black: false, white: false };
        let ws;
        let isMyTurn = false;
        let reconnectTimer = null;

        // 悬停预览
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        let hoverRow = -1, hoverCol = -1;
        let isHoverValid = false;

        function mobileTwoStepPlacing() {
            return !isMouseDevice && BOARD_SIZE > 9;
        }
        function clearMobileMovePreview() {
            hoverRow = -1;
            hoverCol = -1;
            isHoverValid = false;
        }

        // DOM
        const canvas = document.getElementById('goBoard');
        const ctx = canvas.getContext('2d');
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        function isUserBoardMarkVisibleAt(r, c) {
            if (typeof showEstimateActive !== 'undefined' && showEstimateActive) return false;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
            if (board[r][c] !== 0) return false;
            if ((isMouseDevice || mobileTwoStepPlacing()) && isMyTurn && !gameOver && !replayMode && isHoverValid && hoverRow === r && hoverCol === c) return false;
            if ((isMouseDevice || mobileTwoStepPlacing()) && tryPlayMode && replayMode && !gameOver && isHoverValid && hoverRow === r && hoverCol === c) return false;
            return true;
        }

        // 规则弹窗
        const modal = document.getElementById('rulesModal');
        const helpBtn = document.getElementById('helpBtn');
        const closeRulesBtn = document.getElementById('closeRulesBtn');
        helpBtn.onclick = () => modal.style.display = 'flex';
        closeRulesBtn.onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

        function initBoardArray(size) {
            return QiSquareWeiqiCanvas.initBoardArray(size);
        }

        function updateBoardGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(BOARD_SIZE);
            PADDING = g.padding;
            CELL_SIZE = g.cellSize;
        }

        function deepCopyBoard(src) {
            return QiSquareWeiqiCanvas.deepCopyBoard(src);
        }

        function deepCopyLifetimes(src) {
            return src.map(row => row.slice());
        }

        function _checkWinBoardRI(board, row, col, colorVal, bs) {
            return QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(board, row, col, colorVal, bs);
        }

        function parseRIMoveEntry(entry) {
            if (entry && typeof entry === 'object' && entry.player) {
                if (entry.type === 'pass') {
                    return {
                        type: 'pass',
                        player: entry.player,
                        nextPreview: entry.nextPreview != null ? entry.nextPreview : null
                    };
                }
                return {
                    player: entry.player,
                    row: entry.row,
                    col: entry.col,
                    lifetime: entry.lifetime,
                    nextPreview: entry.nextPreview != null ? entry.nextPreview : null
                };
            }
            if (typeof entry !== 'string' || entry.length < 2) return null;
            const head = entry[0];
            if (head !== 'B' && head !== 'W') return null;
            const player = head === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') {
                let nextPreview = null;
                if (entry.length > 2 && entry[2] === ',') {
                    const n = +entry.slice(3);
                    if (Number.isFinite(n)) nextPreview = n;
                }
                return { type: 'pass', player, nextPreview };
            }
            const parts = entry.slice(1).split(',');
            if (parts.length < 3) return null;
            const row = +parts[0];
            const col = +parts[1];
            const lifetime = +parts[2];
            const nextPv = parts.length >= 4 ? +parts[3] : null;
            if (!Number.isFinite(row) || !Number.isFinite(col) || !Number.isFinite(lifetime)) return null;
            return { player, row, col, lifetime, nextPreview: Number.isFinite(nextPv) ? nextPv : null };
        }

        function buildLiveSnapshotsFromMoveLog(moves, openingPreview, boardSize) {
            const size = boardSize;
            const snapshots = [];
            let b = initBoardArray(size);
            let lifetimes = initBoardArray(size);
            let currentPlayer = 'black';
            let moveCount = 0;
            const arr = moves || [];
            let nextPreview;
            if (arr.length > 0) {
                const m0 = parseRIMoveEntry(arr[0]);
                if (!m0) return null;
                nextPreview = m0.type === 'pass'
                    ? (openingPreview != null ? openingPreview : (m0.nextPreview != null ? m0.nextPreview : null))
                    : m0.lifetime;
                if (m0.type === 'pass' && arr[0] && arr[0].previewBefore != null) {
                    nextPreview = arr[0].previewBefore;
                }
                if (nextPreview == null) return null;
            } else {
                nextPreview = openingPreview;
            }
            let lastMoveMarkers = [];
            snapshots.push({
                board: b.map(r => r.slice()),
                lifetimes: lifetimes.map(r => r.slice()),
                currentPlayer,
                moveCount,
                nextLifetimePreview: nextPreview,
                lastMoveMarkers: [],
                gameOver: false,
                winner: null
            });
            for (let i = 0; i < arr.length; i++) {
                const m = parseRIMoveEntry(arr[i]);
                if (!m) return null;
                const slot = m.player;
                if (slot !== currentPlayer) return null;
                for (let r = 0; r < size; r++) {
                    for (let c = 0; c < size; c++) {
                        if (lifetimes[r][c] > 0) {
                            lifetimes[r][c]--;
                            if (lifetimes[r][c] === 0) b[r][c] = 0;
                        }
                    }
                }
                if (m.type === 'pass') {
                    lastMoveMarkers = [];
                    if (m.nextPreview != null) nextPreview = m.nextPreview;
                    else if (arr[i] && arr[i].nextPreview != null) nextPreview = arr[i].nextPreview;
                    let trailing = 1;
                    for (let j = i - 1; j >= 0; j--) {
                        const prev = parseRIMoveEntry(arr[j]);
                        if (prev && prev.type === 'pass') trailing++;
                        else break;
                    }
                    if (trailing >= 2) {
                        snapshots.push({
                            board: b.map(r => r.slice()),
                            lifetimes: lifetimes.map(r => r.slice()),
                            currentPlayer: slot,
                            moveCount,
                            nextLifetimePreview: nextPreview,
                            lastMoveMarkers: [],
                            gameOver: true,
                            winner: 'draw'
                        });
                        break;
                    }
                    currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
                    moveCount++;
                    snapshots.push({
                        board: b.map(r => r.slice()),
                        lifetimes: lifetimes.map(r => r.slice()),
                        currentPlayer,
                        moveCount,
                        nextLifetimePreview: nextPreview,
                        lastMoveMarkers: [],
                        gameOver: false,
                        winner: null
                    });
                    continue;
                }
                const lifetimePlaced = m.lifetime;
                if (lifetimePlaced !== nextPreview) return null;
                const playerVal = slot === 'black' ? 1 : 2;
                b[m.row][m.col] = playerVal;
                lifetimes[m.row][m.col] = lifetimePlaced;
                lastMoveMarkers = [{ row: m.row, col: m.col, color: playerVal }];
                let gameOver = false;
                let winner = null;
                if (_checkWinBoardRI(b, m.row, m.col, playerVal, size)) {
                    gameOver = true;
                    winner = slot;
                } else {
                    let full = true;
                    for (let r = 0; r < size && full; r++)
                        for (let c = 0; c < size; c++)
                            if (b[r][c] === 0) { full = false; break; }
                    if (full) {
                        gameOver = true;
                        winner = 'draw';
                    }
                }
                if (gameOver) {
                    snapshots.push({
                        board: b.map(r => r.slice()),
                        lifetimes: lifetimes.map(r => r.slice()),
                        currentPlayer: slot,
                        moveCount,
                        nextLifetimePreview: null,
                        lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                        gameOver: true,
                        winner
                    });
                    break;
                }
                currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
                moveCount++;
                if (i + 1 < arr.length) {
                    const mn = parseRIMoveEntry(arr[i + 1]);
                    if (!mn) return null;
                    if (mn.type === 'pass') {
                        if (m.nextPreview != null) nextPreview = m.nextPreview;
                        else if (arr[i] && arr[i].nextPreview != null) nextPreview = arr[i].nextPreview;
                    } else {
                        nextPreview = mn.lifetime;
                    }
                } else {
                    nextPreview = m.nextPreview != null ? m.nextPreview : null;
                }
                snapshots.push({
                    board: b.map(r => r.slice()),
                    lifetimes: lifetimes.map(r => r.slice()),
                    currentPlayer,
                    moveCount,
                    nextLifetimePreview: nextPreview,
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                    gameOver: false,
                    winner: null
                });
            }
            return snapshots;
        }

        function computeStoneNumbersFromRISnapshots(snapshots, maxStep) {
            const nums = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
            if (!snapshots || snapshots.length < 2) return nums;
            let num = 0;
            for (let s = 1; s <= maxStep && s < snapshots.length; s++) {
                const prev = snapshots[s - 1].board;
                const cur = snapshots[s].board;
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        if (cur[r][c] !== 0 && prev[r][c] === 0) {
                            num++;
                            nums[r][c] = num;
                        }
                    }
                }
            }
            return nums;
        }

        function computeStoneNumbers() {
            if (replayMode && tryPlayMode) {
                const nums = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
                let num = 0;
                for (let s = 1; s <= tryPlayStep && s < tryPlayBoards.length; s++) {
                    const prev = tryPlayBoards[s - 1];
                    const cur = tryPlayBoards[s];
                    for (let r = 0; r < BOARD_SIZE; r++) {
                        for (let c = 0; c < BOARD_SIZE; c++) {
                            if (cur[r][c] !== 0 && prev[r][c] === 0) {
                                num++;
                                nums[r][c] = num;
                            }
                        }
                    }
                }
                return nums;
            }
            if (replayMode) {
                return computeStoneNumbersFromRISnapshots(replaySnapshots, replayStep);
            }
            if (!replayMode && liveReplaySnapshots.length && liveViewStep < liveReplaySnapshots.length - 1) {
                return computeStoneNumbersFromRISnapshots(liveReplaySnapshots, liveViewStep);
            }
            return computeStoneNumbersFromRISnapshots(liveReplaySnapshots, liveReplaySnapshots.length - 1);
        }

        function applyLiveSnapshotRI() {
            if (!liveReplaySnapshots.length) return;
            if (liveViewStep < 0) liveViewStep = 0;
            if (liveViewStep > liveReplaySnapshots.length - 1) liveViewStep = liveReplaySnapshots.length - 1;
            const snap = liveReplaySnapshots[liveViewStep];
            if (!snap) return;
            board = deepCopyBoard(snap.board);
            lifetimes = deepCopyLifetimes(snap.lifetimes);
            currentPlayer = snap.currentPlayer || 'black';
            moveCount = Number.isFinite(snap.moveCount) ? snap.moveCount : 0;
            nextLifetimePreview = snap.nextLifetimePreview;
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;
            psBindings.gameOver = gameOver;
            psBindings.winner = winner;
        }

        function updateLiveReplayPanelUIRI() {
            if (replayMode) return;
            const total = Math.max(0, liveReplaySnapshots.length - 1);
            const slider = document.getElementById('replaySlider');
            if (!slider) return;
            slider.min = 0;
            slider.max = total;
            slider.value = liveViewStep;
            const stepEl = document.getElementById('replayStepDisplay');
            if (stepEl) stepEl.innerText = `${liveViewStep} / ${total}`;
        }

        function setLiveViewStep(step) {
            if (replayMode) return;
            const total = Math.max(0, liveReplaySnapshots.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            liveFollowLatest = step >= total;
            liveViewStep = step;
            applyLiveSnapshotRI();
            psBindings.liveViewStep = liveViewStep;
            updateLiveReplayPanelUIRI();
            updateTurn();
        }

        function updateRadioStyles() {
            updateRecordButtons();
        }

        function updateRecordButtons() {
            const importBtn = document.getElementById('importBtn');
            const exportBtn = document.getElementById('exportBtn');
            if (!importBtn || !exportBtn) return;
            if (replayMode) {
                importBtn.style.display = 'none';
                exportBtn.style.display = 'none';
            } else {
                const hasAnyStone = board.some(row => row.some(v => v !== 0));
                const noPlayers = !slots.black && !slots.white;
                if (noPlayers && !hasAnyStone) {
                    importBtn.style.display = '';
                    exportBtn.style.display = 'none';
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }
        }

        // 绘制棋子及其寿命
        function drawPiece(row, col, x, y, radius, cellSize)
        {
            const val = board[row][col];
            if (val === 0) return;
            // 棋子阴影
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
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            if (!showMoveNumbers) {
                ctx.beginPath();
                ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                ctx.fillStyle = val === 1 ? '#444' : '#fff';
                ctx.fill();
            }

            // 绘制剩余寿命
            const life = lifetimes[row][col];
            if (life > 0 && !showMoveNumbers)
            {
                ctx.font = `bold ${Math.max(12, Math.floor(radius * 0.7))}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const textX = x - radius * 0.4;
                const textY = y - radius * 0.4;

                let textColor;
                if (val === 1)
                    textColor = life < 5 ? '#ff4444' : '#ffffff';
                else textColor = life < 5 ? '#ff4444' : '#000000';
                ctx.fillStyle = textColor;
                ctx.shadowBlur = 0;
                ctx.fillText(life.toString(), textX, textY);

                if (life < 5) {
                    ctx.beginPath();
                    ctx.arc(x, y, radius + 1, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#ff0000';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        function drawBoard() 
        {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, BOARD_SIZE, PADDING, cellSize, cs);
            d.starPoints(ctx, BOARD_SIZE, PADDING, cellSize);
            d.coordLabels(ctx, BOARD_SIZE, PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = showMoveNumbers || showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, lastMoveMarkers, PADDING, cellSize, stoneRadius);
            }
            // 必须用 drawPiece：在棋子上绘制剩余寿命（stonesBlackWhite 无寿命）
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] === 0) continue;
                    const x = PADDING + c * cellSize;
                    const y = PADDING + r * cellSize;
                    drawPiece(r, c, x, y, stoneRadius, cellSize);
                }
            }
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, lastMoveMarkers, PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(ctx, userBoardMarks, BOARD_SIZE, PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, board, BOARD_SIZE, PADDING, cellSize);
            }
            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            d.hoverPreviewStone(ctx, hoverRow, hoverCol, board, PADDING, cellSize, {
                tryPlayMode,
                tryPlayCurrentPlayer,
                gameOver,
                isMyTurn,
                mySlot,
                isHoverValid,
                editModeEnabled: !!(editCb && editCb.checked),
                editTool: (editSel && editSel.value) || 'empty',
                boardSize: BOARD_SIZE
            });
            if (showEstimateActive && cachedLiveBoard && cachedTerritory) {
                d.estimateOverlay(ctx, board, BOARD_SIZE, PADDING, cellSize, cachedLiveBoard, cachedTerritory);
            }
        }

        function updateTurn() {
            if (replayMode && tryPlayMode) {
                updateTryPlayDisplay();
                isMyTurn = !gameOver;
                drawBoard();
                return;
            }
            if (replayMode && !tryPlayMode) {
                isMyTurn = false;
                drawBoard();
                return;
            }
            const liveTotal = liveReplaySnapshots.length > 0 ? liveReplaySnapshots.length - 1 : 0;
            const browsingLive = liveReplaySnapshots.length > 0 && liveViewStep < liveTotal;
            if (browsingLive) {
                const snap = liveReplaySnapshots[liveViewStep];
                const sz = snap.board.length;
                let n = 0;
                for (let r = 0; r < sz; r++)
                    for (let c = 0; c < sz; c++)
                        if (snap.board[r][c] !== 0) n++;
                if (n === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = (n % 2 === 1) ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${n}手`;
                }
                scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoard();
                return;
            }
            if (gameOver) {
                turnDisplay.innerText = '对局结束';
                if (winner === 'black')
                    scoreTitle.innerText = '黑胜';
                else if (winner === 'white')
                    scoreTitle.innerText = '白胜';
                else if (winner === 'draw')
                    scoreTitle.innerText = '和棋';
                else
                    scoreTitle.innerText = '对局结束';
                isMyTurn = false;
                drawBoard();
                return;
            }
            if (!matchStarted) {
                const bothSelected = !!slots.black && !!slots.white;
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoard();
                return;
            }
            let n = 0;
            for (let r = 0; r < BOARD_SIZE; r++)
                for (let c = 0; c < BOARD_SIZE; c++)
                    if (board[r][c] !== 0) n++;
            if (n === 0) {
                turnDisplay.innerText = '初始局面';
                scoreTitle.innerText = (!gameOver && nextLifetimePreview > 0) ? `下一手寿命: ${nextLifetimePreview}` : '　';
                isMyTurn = (mySlot === currentPlayer);
                const atLiveEdge = liveReplaySnapshots.length === 0 || liveViewStep >= liveReplaySnapshots.length - 1;
                if (!atLiveEdge) isMyTurn = false;
                drawBoard();
                return;
            }
            const emoji = (moveCount % 2 === 1) ? '⚫' : '⚪';
            turnDisplay.innerText = `${emoji} 第${moveCount}手`;
            isMyTurn = (mySlot === currentPlayer);
            if (!gameOver && nextLifetimePreview > 0) {
                scoreTitle.innerText = `下一手寿命: ${nextLifetimePreview}`;
            } else {
                scoreTitle.innerText = '　';
            }
            const atLiveEdge = liveReplaySnapshots.length === 0 || liveViewStep >= liveReplaySnapshots.length - 1;
            if (!atLiveEdge) isMyTurn = false;
            psBindings.isMyTurn = isMyTurn;
            drawBoard();
        }

        const psBindings = {
            ws: null,
            mySlot: null,
            slots: { black: false, white: false },
            gameOver: false,
            winner: null,
            replayMode: false,
            tryPlayMode: false,
            replayStep: 0,
            tryPlayStep: 0,
            liveViewStep: 0,
            isMyTurn: false
        };
        Object.defineProperty(psBindings, 'showMoveNumbers', {
            get: () => showMoveNumbers,
            set: (v) => { showMoveNumbers = !!v; }
        });
        Object.defineProperty(psBindings, 'matchStarted', {
            get: () => !!matchStarted,
            set: (v) => { matchStarted = !!v; }
        });
        Object.defineProperty(psBindings, 'matchTime', {
            get: () => matchTime,
            set: (v) => { matchTime = v || null; }
        });
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: psBindings,
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => BOARD_SIZE,
            setBoardSize: (n) => { BOARD_SIZE = n; },
            getKomi: () => 0,
            setKomi: () => {},
            getBoard: () => board,
            setBoard: (b) => { board = b; },
            getSlots: () => slots,
            setSlots: (s) => { slots = s; psBindings.slots = s; },
            getMySlot: () => mySlot,
            setMySlot: (s) => { mySlot = s; psBindings.mySlot = s; },
            getGameOver: () => gameOver,
            setGameOver: (v) => { gameOver = v; psBindings.gameOver = !!v; },
            getWinner: () => winner,
            setWinner: (w) => { winner = w; psBindings.winner = w; },
            getReplayMode: () => replayMode,
            getShowEstimateActive: () => false,
            setShowEstimateActive: () => {},
            getWaitingScoreConfirm: () => false,
            setWaitingScoreConfirm: () => {},
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            showScoreConfirm: () => {},
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });
        const baseRoomHandleMessage = _weiqiBindings.handleMessage;

        // WebSocket

        function connectWebSocket() {
            const storedPassword = sessionStorage.getItem(`roomPassword_${roomId}`);
            if (storedPassword) roomPassword = storedPassword;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => reconnectTimer,
                setReconnectTimer: (id) => { reconnectTimer = id; },
                onMessage: handleMessage
            });
            psBindings.ws = ws;
        }

        function handleMessage(msg)
        {
            baseRoomHandleMessage(msg);
            switch (msg.type) {
                case 'timeControlAgreed':
                    matchStarted = true;
                    updateTurn();
                    break;
                case 'timeControlReset':
                    matchStarted = false;
                    updateTurn();
                    break;
                default:
                    break;
            }
        }

        function syncState(state) {
            clearMobileMovePreview();
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const sizeNum = Number(BOARD_SIZE);
            const row0 = state.board && state.board[0];
            const lenMismatch = state.board && (
                state.board.length !== sizeNum ||
                (row0 && row0.length !== sizeNum)
            );
            const needGeometry =
                Number.isFinite(incomingSize) &&
                (incomingSize !== sizeNum || lenMismatch);
            if (needGeometry) {
                BOARD_SIZE = incomingSize;
                board = initBoardArray(BOARD_SIZE);
                lifetimes = initBoardArray(BOARD_SIZE);
                updateBoardGeometry();
                const bs = document.getElementById('boardSizeSelect');
                if (bs) bs.value = String(BOARD_SIZE);
            }
            moveLog = state.moveLog || [];
            if (state.matchStarted !== undefined) matchStarted = !!state.matchStarted;
            if (state.slots) slots = state.slots;
            psBindings.slots = slots;

            if (!replayMode) {
                const prevTotal = Math.max(0, liveReplaySnapshots.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                const openPv = moveLog.length > 0 ? moveLog[0].previewBefore : state.nextLifetimePreview;
                let built = buildLiveSnapshotsFromMoveLog(moveLog, openPv, BOARD_SIZE);
                if (!built || !built.length)
                    built = buildLiveSnapshotsFromMoveLog([], state.nextLifetimePreview, BOARD_SIZE);
                liveReplaySnapshots = built;
                const newTotal = Math.max(0, liveReplaySnapshots.length - 1);
                if (newTotal === 0) {
                    liveViewStep = 0;
                    liveFollowLatest = true;
                } else if (wasAtEnd) {
                    liveViewStep = newTotal;
                    liveFollowLatest = true;
                } else {
                    liveViewStep = Math.min(liveViewStep, newTotal);
                    if (liveViewStep === newTotal) liveFollowLatest = true;
                }
                applyLiveSnapshotRI();
                if (liveViewStep === newTotal) {
                    board = state.board;
                    lifetimes = state.lifetimes;
                    currentPlayer = state.currentPlayer;
                    moveCount = state.moveCount;
                    nextLifetimePreview = state.nextLifetimePreview;
                    gameOver = state.gameOver;
                    winner = state.winner;
                    psBindings.gameOver = !!gameOver;
                    psBindings.winner = winner;
                    lastMoveMarkers = state.lastMoveMarkers || [];
                }
                updateLiveReplayPanelUIRI();
            } else {
                board = state.board;
                lifetimes = state.lifetimes;
                currentPlayer = state.currentPlayer;
                moveCount = state.moveCount;
                nextLifetimePreview = state.nextLifetimePreview;
                gameOver = state.gameOver;
                winner = state.winner;
                psBindings.gameOver = !!gameOver;
                psBindings.winner = winner;
                lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = board.some(row => row.some(v => v !== 0));
            const hasPlayer = slots.black || slots.white;
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (sizeSelect && !hasAnyStone && !hasPlayer && !gameOver && mySlot === null && !replayMode)
                sizeSelect.style.display = 'inline-block';
            else if (sizeSelect) sizeSelect.style.display = 'none';

            updateTurn();
            psBindings.replayMode = replayMode;
            psBindings.tryPlayMode = tryPlayMode;
            psBindings.replayStep = replayStep;
            psBindings.tryPlayStep = tryPlayStep;
            psBindings.liveViewStep = liveViewStep;
            psBindings.mySlot = mySlot;
            updateRecordButtons();
            updateReplayUI();
        }

        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix);
        }

        function enterReplayMode(data) {
            replaySnapshots = data.snapshots || [];
            if (replaySnapshots.length === 0) return;
            replayTotalSteps = replaySnapshots.length - 1;
            replayMode = true;
            document.getElementById('replaySlider').max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
            updateRecordButtons();
        }

        function exitReplayMode() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayLifetimes = [];
            tryPlayMarkers = [];
            tryPlayMeta = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            replayMode = false;
            replaySnapshots = [];
            replayStep = 0;
            replayTotalSteps = 0;
            updateReplayUI();
            updateRecordButtons();
        }

        function setReplayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > replayTotalSteps) step = replayTotalSteps;
            replayStep = step;
            psBindings.replayStep = replayStep;
            const snap = replaySnapshots[step];
            if (!snap) return;
            const sz = snap.board.length;
            if (sz !== BOARD_SIZE) {
                BOARD_SIZE = sz;
                updateBoardGeometry();
            }
            board = deepCopyBoard(snap.board);
            lifetimes = deepCopyLifetimes(snap.lifetimes);
            currentPlayer = snap.currentPlayer || 'black';
            moveCount = snap.moveCount != null ? snap.moveCount : 0;
            nextLifetimePreview = snap.nextLifetimePreview != null ? snap.nextLifetimePreview : 0;
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;
            if (step === 0)
                turnDisplay.innerText = '初始局面';
            else
                turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps}`;
            if (gameOver) {
                if (winner === 'black') scoreTitle.innerText = '黑胜';
                else if (winner === 'white') scoreTitle.innerText = '白胜';
                else if (winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '对局结束';
            } else {
                scoreTitle.innerText = '　';
            }
            isMyTurn = false;
            drawBoard();
        }

        function updateReplayUI() {
            const hideIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!mySlot;
            const started = !!(matchStarted || (matchTime && matchTime.settings));
            const showMatchButtons = isPlayer && started && !replayMode;
            hideIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = showMatchButtons ? '' : 'none'; });
            replayPanel.style.display = '';
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
        }

        function checkWinLocal(brd, row, col, colorVal) {
            if (brd[row][col] !== colorVal) return false;
            const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
            for (let [dx, dy] of dirs) {
                let count = 1;
                for (let s = 1; s < 5; s++) {
                    const nr = row + dx * s, nc = col + dy * s;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || brd[nr][nc] !== colorVal) break;
                    count++;
                }
                for (let s = 1; s < 5; s++) {
                    const nr = row - dx * s, nc = col - dy * s;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || brd[nr][nc] !== colorVal) break;
                    count++;
                }
                if (count >= 5) return true;
            }
            return false;
        }

        function enterTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayLifetimes = [deepCopyLifetimes(lifetimes)];
            tryPlayMarkers = [lastMoveMarkers.map(m => ({ ...m }))];
            tryPlayMeta = [{ gameOver: false, winner: null }];
            const snap = replaySnapshots[replayStep];
            tryPlayCurrentPlayer = (snap && !snap.gameOver && snap.currentPlayer === 'white') ? 2 : 1;
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            gameOver = false;
            winner = null;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            updateTurn();
        }

        function exitTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayLifetimes = [];
            tryPlayMarkers = [];
            tryPlayMeta = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = replayTotalSteps;
            setReplayStep(tryPlayBaseStep);
            updateReplayUI();
            updateTurn();
        }

        function tryPlayMove(row, col) {
            if (board[row][col] !== 0 || gameOver) return;
            const playerVal = tryPlayCurrentPlayer;
            board[row][col] = playerVal;
            lifetimes[row][col] = 99;
            lastMoveMarkers = [{ row, col, color: playerVal }];
            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayLifetimes.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
                tryPlayMeta.length = tryPlayStep + 1;
            }
            let gOver = false;
            let win = null;
            if (checkWinLocal(board, row, col, playerVal)) {
                gOver = true;
                win = playerVal === 1 ? 'black' : 'white';
            } else {
                let full = true;
                for (let r = 0; r < BOARD_SIZE && full; r++)
                    for (let c = 0; c < BOARD_SIZE; c++)
                        if (board[r][c] === 0) { full = false; break; }
                if (full) {
                    gOver = true;
                    win = 'draw';
                }
            }
            tryPlayBoards.push(deepCopyBoard(board));
            tryPlayLifetimes.push(deepCopyLifetimes(lifetimes));
            tryPlayMarkers.push(lastMoveMarkers.map(m => ({ ...m })));
            tryPlayMeta.push({ gameOver: gOver, winner: win });
            gameOver = gOver;
            winner = win;
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = tryPlayCurrentPlayer === 1 ? 2 : 1;
            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            updateTurn();
            drawBoard();
        }

        function setTryPlayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > tryPlayTotalSteps) step = tryPlayTotalSteps;
            tryPlayStep = step;
            psBindings.tryPlayStep = tryPlayStep;
            board = deepCopyBoard(tryPlayBoards[step]);
            lifetimes = deepCopyLifetimes(tryPlayLifetimes[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));
            const meta = tryPlayMeta[step] || { gameOver: false, winner: null };
            gameOver = meta.gameOver;
            winner = meta.winner;
            const baseSnap = replaySnapshots[tryPlayBaseStep];
            const startPl = (baseSnap && !baseSnap.gameOver && baseSnap.currentPlayer === 'white') ? 2 : 1;
            tryPlayCurrentPlayer = step % 2 === 0 ? startPl : (3 - startPl);
            moveCount = baseSnap ? baseSnap.moveCount : 0;
            nextLifetimePreview = baseSnap && baseSnap.nextLifetimePreview != null ? baseSnap.nextLifetimePreview : 0;
            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            updateTurn();
            drawBoard();
        }

        function updateTryPlayDisplay() {
            if (tryPlayMode) {
                document.getElementById('replayStepDisplay').innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
                const emoji = tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
                scoreTitle.innerText = '　';
            }
        }

        // 坐标转换
        function getClosestIntersection(x, y) {
            return QiSquareWeiqiCanvas.getClosestIntersection(x, y, BOARD_SIZE, PADDING, CELL_SIZE);
        }

        function canvasCoordsFromClient(clientX, clientY) {
            return QiSquareWeiqiCanvas.canvasCoordsFromClient(clientX, clientY, canvas);
        }

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const v = boardMarkSelect.value;
            if (v === '') return { clear: true, ch: '' };
            return { clear: false, ch: v };
        }

        function applyUserBoardMark(row, col) {
            if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return;
            if (board[row][col] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = row + ',' + col;
            const existing = userBoardMarks[key];
            if (clear) {
                if (existing !== undefined) {
                    delete userBoardMarks[key];
                    drawBoard();
                }
                return;
            }
            if (existing === undefined) userBoardMarks[key] = ch;
            else if (existing !== ch) userBoardMarks[key] = ch;
            else delete userBoardMarks[key];
            drawBoard();
        }

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

        // 鼠标事件
        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                hoverRow = row;
                hoverCol = col;
                isHoverValid = (row >= 0 && col >= 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                isHoverValid = false;
                hoverRow = -1;
                hoverCol = -1;
                drawBoard();
            });
        }

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
            const m2 = mobileTwoStepPlacing();
            if (tryPlayMode && replayMode) {
                if (row < 0 || col < 0) {
                    if (m2) { clearMobileMovePreview(); drawBoard(); }
                    return;
                }
                if (board[row][col] !== 0) return;
                if (m2) {
                    if (hoverRow === row && hoverCol === col && isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        hoverRow = row;
                        hoverCol = col;
                        isHoverValid = true;
                        drawBoard();
                    }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            if (replayMode && !tryPlayMode) return;
            const ltLive = liveReplaySnapshots.length > 0 ? liveReplaySnapshots.length - 1 : 0;
            if (!replayMode && liveReplaySnapshots.length && liveViewStep < ltLive) return;
            if (gameOver || !isMyTurn) return;
            if (row < 0 || col < 0) {
                if (m2) { clearMobileMovePreview(); drawBoard(); }
                return;
            }
            if (board[row][col] !== 0) return;
            if (m2) {
                if (hoverRow === row && hoverCol === col && isHoverValid) {
                    clearMobileMovePreview();
                    ws.send(JSON.stringify({ type: 'move', row, col }));
                    drawBoard();
                } else {
                    hoverRow = row;
                    hoverCol = col;
                    isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            ws.send(JSON.stringify({ type: 'move', row, col }));
        });

        /* board edit UI */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            const _editPs = {
                get board() { return board; },
                set board(v) { board = v; },
                get gameOver() { return typeof gameOver !== 'undefined' ? gameOver : false; },
                get mySlot() { return typeof mySlot !== 'undefined' ? mySlot : null; },
                get gameStarted() {
                    if (typeof gameStarted !== 'undefined') return !!gameStarted;
                    return (typeof numberOfHands !== 'undefined' ? numberOfHands : 1) > 1;
                },
                set gameStarted(v) { if (typeof gameStarted !== 'undefined') gameStarted = !!v; },
                editModeEnabled: false,
                editTool: 'empty',
                get hoverRow() { return hoverRow; },
                set hoverRow(v) { hoverRow = v == null ? -1 : v; },
                get hoverCol() { return hoverCol; },
                set hoverCol(v) { hoverCol = v == null ? -1 : v; },
                get isHoverValid() { return isHoverValid; },
                set isHoverValid(v) { isHoverValid = !!v; },
                get ws() { return typeof ws !== 'undefined' ? ws : null; }
            };
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: _editPs,
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
                getBoard() { return board; },
                setBoard(b) { board = b; },
                emptyBoard() {
                    const n = (typeof BOARD_SIZE !== 'undefined' ? BOARD_SIZE
                        : (typeof ROWS !== 'undefined' ? ROWS : board.length));
                    return Array(n).fill(null).map(function () { return Array(n).fill(0); });
                }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) _editPs.gameStarted = (state.numberOfHands || 1) > 1;
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

        connectWebSocket();
        })();
    }
};
