window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["guess-wuziqi"] = {
    shell: {
        "title": "猜点五子棋",
        "rulesHtml": "<strong>猜中哪个点是对方的选点，并且让对方猜错！</strong>\n<br /><br />基本规则同五子棋。每手棋分为「选点」和「猜点」两个阶段。<br /><br /><strong>选点：</strong> 系统随机生成三个迷惑点展示给当前行棋方，行棋方选择想要落子的点（可以迷惑点或是任意空点），迷惑点和行棋方选择的落子点合称为候选点。<br><br /><strong>猜点：</strong> 将所有候选点展示给等待方（但不区分是迷惑点还是行棋方选择的落子点）。等待方需要从候选点中猜出哪个是行棋方选择的落子点。<br />&nbsp;&nbsp;• 猜中：则该落子无效。<br />&nbsp;&nbsp;• 猜错：则该落子有效。<br />",
        "defaultKomiText": "无禁手",
        "boardSizeMin": 7,
        "boardSizeMax": 15,
        "defaultBoardSize": 13,
        "minLib": 1,
        "recordDownloadPrefix": "猜点五子棋",
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "猜点五子棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
let BOARD_SIZE = 13;
        let PADDING;
        let CELL_SIZE;
        (function initGuessGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(BOARD_SIZE);
            PADDING = g.padding;
            CELL_SIZE = g.cellSize;
        })();

        let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        let currentPlayer = 'black';
        let mySlot = null;
        let gameOver = false;
        let winner = null;
        let phase = 'select';
        let selectedMove = null;
        let guessCandidates = [];
        let rightGuessPoint = null;
        let wrongGuessPoint = null;
        let candidates = [];
        let numberOfHands = 1;
        let lastMoveMarkers = [];

        let replayMode = false;
        let replaySnapshots = [];
        let replayStep = 0;
        let replayTotalSteps = 0;
        let eventLog = [];
        let liveReplaySnapshots = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;
        let showMoveNumbers = false;
        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBoards = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 'black';
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

        let ws;
        let isMyTurn = false;
        let slots = { black: false, white: false }; // 槽位占用情况
        let reconnectTimer = null;
        let matchStarted = false;

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

        scoreTitle.innerText = '　';
        leadInfo.innerText = '　';

        function isBrowsingLiveReplayGuess() {
            return !replayMode && liveReplaySnapshots.length > 0 && liveViewStep < liveReplaySnapshots.length - 1;
        }

        function isUserBoardMarkVisibleAt(r, c) {
            if (typeof showEstimateActive !== 'undefined' && showEstimateActive) return false;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
            if (board[r][c] !== 0) return false;
            const browsingLiveHist = isBrowsingLiveReplayGuess();
            if (!tryPlayMode && phase === 'select' && rightGuessPoint && rightGuessPoint.row === r && rightGuessPoint.col === c) return false;
            if (!tryPlayMode && phase === 'select' && wrongGuessPoint && wrongGuessPoint.row === r && wrongGuessPoint.col === c) return false;
            const showSelectCandidates = !tryPlayMode && matchStarted && phase === 'select' && candidates.length &&
                ((replayMode && !gameOver) || (!gameOver && (browsingLiveHist || mySlot === currentPlayer)));
            if (showSelectCandidates && candidates.some(p => p.row === r && p.col === c)) return false;
            if (!tryPlayMode && phase === 'guess' && guessCandidates.some(p => p.row === r && p.col === c)) return false;
            if (!tryPlayMode && phase === 'select' && selectedMove && selectedMove.row === r && selectedMove.col === c &&
                (replayMode || browsingLiveHist)) return false;
            if (!tryPlayMode && phase === 'guess' && selectedMove && selectedMove.row === r && selectedMove.col === c &&
                (replayMode || browsingLiveHist || mySlot === currentPlayer)) return false;
            if ((isMouseDevice || mobileTwoStepPlacing()) && isMyTurn && !replayMode) {
                if (phase === 'select' && isHoverValid && hoverRow === r && hoverCol === c) return false;
                if (phase === 'guess' && isMouseDevice && guessCandidates.some(p => p.row === hoverRow && p.col === hoverCol) && hoverRow === r && hoverCol === c) return false;
            }
            if ((isMouseDevice || mobileTwoStepPlacing()) && tryPlayMode && replayMode && !gameOver && isHoverValid && hoverRow === r && hoverCol === c) return false;
            return true;
        }

        function refreshScoreBoard() {
            if (!replayMode && !gameOver && !matchStarted) {
                scoreBoard.innerText = '　';
                return;
            }
            let black = 0, white = 0;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] === 1) black++;
                    else if (board[r][c] === 2) white++;
                }
            }
            scoreBoard.innerText = `棋子数量 黑：${black}　白：${white}`;
        }

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

        function _checkWinOnBoardGuess(brd, row, col, colorVal, bs) {
            return QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(brd, row, col, colorVal, bs);
        }

        function pushGuessSnapshot(snapshots, board, phase, currentPlayer, candidates, selectedMove, guessCandidates, rightGuessPoint, wrongGuessPoint, lastMoveMarkers, gameOver, winner, handNumber = null) {
            const gc = guessCandidates || [];
            snapshots.push({
                board: board.map(row => row.slice()),
                phase,
                currentPlayer,
                candidates: (candidates || []).map(c => ({ row: c.row, col: c.col })),
                selectedMove: selectedMove ? { ...selectedMove } : null,
                guessCandidates: gc.map(c => ({ row: c.row, col: c.col })),
                rightGuessPoint: rightGuessPoint ? { ...rightGuessPoint } : null,
                wrongGuessPoint: wrongGuessPoint ? { ...wrongGuessPoint } : null,
                lastMoveMarkers: (lastMoveMarkers || []).map(m => ({ ...m })),
                gameOver,
                winner,
                handNumber
            });
        }

        function buildGuessSnapshotsFromEvents(events, size) {
            const snapshots = [];
            if (!events || events.length === 0) {
                const b0 = Array(size).fill().map(() => Array(size).fill(0));
                pushGuessSnapshot(snapshots, b0, 'select', 'black', [], null, [], null, null, [], false, null, 0);
                return snapshots;
            }
            let board = Array(size).fill().map(() => Array(size).fill(0));
            let currentPlayer = 'black';
            let lastMoveMarkers = [];
            pushGuessSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], null, null, lastMoveMarkers, false, null, 0);
            let ei = 0;
            while (ei < events.length) {
                const ev = events[ei];
                if (ev.type !== 'select') return null;
                const cb = (ev.candidatesBefore || []).map(c => ({ row: c.row, col: c.col }));
                if (ev.player !== currentPlayer) return null;
                if (cb.length < 1) return null;
                const { row, col } = ev;
                if (row < 0 || row >= size || col < 0 || col >= size || board[row][col] !== 0) return null;
                const handNum = 1 + Math.floor(ei / 2);
                pushGuessSnapshot(snapshots, board, 'select', currentPlayer, cb, null, [], null, null, lastMoveMarkers, false, null, handNum);
                const selectedMove = { row, col };
                let guessCandidates;
                if (cb.some(c => c.row === row && c.col === col)) {
                    guessCandidates = cb.map(c => ({ ...c }));
                } else {
                    guessCandidates = [...cb, { row, col }];
                }
                pushGuessSnapshot(snapshots, board, 'select', currentPlayer, cb, selectedMove, [], null, null, lastMoveMarkers, false, null, handNum);
                ei++;
                if (ei >= events.length) break;
                const gev = events[ei];
                if (gev.type !== 'guess' || gev.player === currentPlayer) return null;
                const guessRow = gev.row, guessCol = gev.col;
                if (!guessCandidates.some(p => p.row === guessRow && p.col === guessCol)) return null;
                const isHit = (guessRow === selectedMove.row && guessCol === selectedMove.col);
                lastMoveMarkers = [];
                let gameOver = false;
                let roundWinner = null;
                if (!isHit) {
                    const playerVal = currentPlayer === 'black' ? 1 : 2;
                    board[selectedMove.row][selectedMove.col] = playerVal;
                    lastMoveMarkers = [{ row: selectedMove.row, col: selectedMove.col, color: playerVal }];
                    if (_checkWinOnBoardGuess(board, selectedMove.row, selectedMove.col, playerVal, size)) {
                        gameOver = true;
                        roundWinner = currentPlayer;
                    }
                }
                if (gameOver) {
                    const rightGuessPoint = isHit ? { row: guessRow, col: guessCol } : null;
                    const wrongGuessPoint = !isHit ? { row: guessRow, col: guessCol } : null;
                    pushGuessSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], rightGuessPoint, wrongGuessPoint, lastMoveMarkers, true, roundWinner, handNum);
                    break;
                }
                currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
                let emptyCount = 0;
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++)
                        if (board[r][c] === 0) emptyCount++;
                if (emptyCount < 4) {
                    pushGuessSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], null, null, lastMoveMarkers, true, 'draw', handNum);
                    break;
                }
                let rightGuessPoint = null;
                let wrongGuessPoint = null;
                if (isHit) {
                    rightGuessPoint = { row: guessRow, col: guessCol };
                } else {
                    wrongGuessPoint = { row: guessRow, col: guessCol };
                }
                pushGuessSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], rightGuessPoint, wrongGuessPoint, lastMoveMarkers, false, null, handNum);
                ei++;
            }
            return snapshots;
        }

        function computeStoneNumbersFromGuessSnapshots(snapshots, maxStep) {
            const nums = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
            if (!snapshots || snapshots.length < 2) return nums;
            let fallbackSeq = 0;
            for (let s = 1; s <= maxStep && s < snapshots.length; s++) {
                const prev = snapshots[s - 1].board;
                const cur = snapshots[s].board;
                const hn = snapshots[s].handNumber;
                const turnNum = hn != null && hn > 0 ? hn : null;
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        if (cur[r][c] !== 0 && prev[r][c] === 0) {
                            if (turnNum != null) {
                                nums[r][c] = turnNum;
                            } else {
                                fallbackSeq++;
                                nums[r][c] = fallbackSeq;
                            }
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
                return computeStoneNumbersFromGuessSnapshots(replaySnapshots, replayStep);
            }
            if (!replayMode && liveReplaySnapshots.length && liveViewStep < liveReplaySnapshots.length - 1) {
                return computeStoneNumbersFromGuessSnapshots(liveReplaySnapshots, liveViewStep);
            }
            return computeStoneNumbersFromGuessSnapshots(liveReplaySnapshots, liveReplaySnapshots.length - 1);
        }

        // 规则弹框
        const modal = document.getElementById('rulesModal');
        const helpBtn = document.getElementById('helpBtn');
        const closeRulesBtn = document.getElementById('closeRulesBtn');
        function showRules() { modal.style.display = 'flex'; }
        function hideRules() { modal.style.display = 'none'; }
        helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showRules(); });
        closeRulesBtn.addEventListener('click', hideRules);
        modal.addEventListener('click', (e) => { if (e.target === modal) hideRules(); });
        document.addEventListener('click', (e) => {
            if (modal.style.display === 'flex' && !modal.contains(e.target) && e.target !== helpBtn) hideRules();
        });
        helpBtn.addEventListener('click', (e) => e.stopPropagation());

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

        function drawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = CELL_SIZE;
            const browsingLiveHist = !replayMode && liveReplaySnapshots.length > 0 && liveViewStep < liveReplaySnapshots.length - 1;
            d.clear(ctx, cs);
            d.grid(ctx, BOARD_SIZE, PADDING, cellSize, cs);
            d.starPoints(ctx, BOARD_SIZE, PADDING, cellSize);
            d.coordLabels(ctx, BOARD_SIZE, PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = showMoveNumbers;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, lastMoveMarkers, PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(ctx, board, BOARD_SIZE, PADDING, cellSize, stoneRadius, showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, lastMoveMarkers, PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(ctx, userBoardMarks, BOARD_SIZE, PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, board, BOARD_SIZE, PADDING, cellSize);
            }

            // 绿色方块（猜对标记）
            if (!tryPlayMode && phase === 'select' && rightGuessPoint) {
                const { row, col } = rightGuessPoint;
                if (board[row][col] === 0) {
                    const x = PADDING + col * cellSize;
                    const y = PADDING + row * cellSize;
                    const squareHalf = cellSize * 0.18;
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = '#00a040';
                    ctx.fillRect(x - squareHalf, y - squareHalf, squareHalf * 2, squareHalf * 2);
                    ctx.globalAlpha = 1.0;
                }
            }

            // 红色方块（猜错标记）
            if (!tryPlayMode && phase === 'select' && wrongGuessPoint) {
                const { row, col } = wrongGuessPoint;
                if (board[row][col] === 0) {
                    const x = PADDING + col * cellSize;
                    const y = PADDING + row * cellSize;
                    const squareHalf = cellSize * 0.18;
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = '#c00000';
                    ctx.fillRect(x - squareHalf, y - squareHalf, squareHalf * 2, squareHalf * 2);
                    ctx.globalAlpha = 1.0;
                }
            }

            // 选点阶段：迷惑点方框；第二步快照再叠加行棋方选点圆圈（打谱/回溯）
            if (!tryPlayMode && matchStarted && phase === 'select' && candidates.length && ((replayMode && !gameOver) || (!gameOver && (browsingLiveHist || mySlot === currentPlayer)))) {
                ctx.globalAlpha = 0.7;
                const playerColor = currentPlayer === 'black' ? '#222' : '#ddd';
                const squareHalf = cellSize * 0.18;
                candidates.forEach(({ row, col }) => {
                    const x = PADDING + col * cellSize;
                    const y = PADDING + row * cellSize;
                    ctx.fillStyle = playerColor;
                    ctx.fillRect(x - squareHalf, y - squareHalf, squareHalf * 2, squareHalf * 2);
                });
                ctx.globalAlpha = 1.0;
                if (selectedMove && (replayMode || browsingLiveHist)) {
                    ctx.strokeStyle = currentPlayer === 'black' ? '#000' : '#fff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(PADDING + selectedMove.col * cellSize, PADDING + selectedMove.row * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            }

            if (!tryPlayMode && matchStarted && phase === 'guess') {
                ctx.globalAlpha = 0.7;
                const guessColor = currentPlayer === 'black' ? '#222' : '#ddd';
                const squareHalf = cellSize * 0.18;
                guessCandidates.forEach(({ row, col }) => {
                    const x = PADDING + col * cellSize;
                    const y = PADDING + row * cellSize;
                    ctx.fillStyle = guessColor;
                    ctx.fillRect(x - squareHalf, y - squareHalf, squareHalf * 2, squareHalf * 2);
                });
                ctx.globalAlpha = 1.0;

                if (selectedMove && (replayMode || browsingLiveHist || mySlot === currentPlayer)) {
                    ctx.strokeStyle = currentPlayer === 'black' ? '#000' : '#fff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(PADDING + selectedMove.col * cellSize, PADDING + selectedMove.row * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            }

            // 悬停预览（选点：手机大屏可两步确认；猜点仅鼠标悬停）
            if (matchStarted && isMyTurn && !replayMode) {
                if (phase === 'select' && (isMouseDevice || mobileTwoStepPlacing()) && isHoverValid && hoverRow >= 0 && hoverCol >= 0 && board[hoverRow][hoverCol] === 0) {
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.fillStyle = mySlot === 'black' ? '#222' : '#ddd';
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
                else if (phase === 'guess' && isMouseDevice && guessCandidates.some(p => p.row === hoverRow && p.col === hoverCol)) {
                    ctx.globalAlpha = 0.75;
                    ctx.beginPath();
                    ctx.strokeStyle = mySlot === 'black' ? '#fff' : '#000';
                    ctx.lineWidth = 2;
                    ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
            if ((isMouseDevice || mobileTwoStepPlacing()) && tryPlayMode && replayMode && !gameOver && isHoverValid && hoverRow >= 0 && hoverCol >= 0 && board[hoverRow][hoverCol] === 0) {
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
                ctx.fillStyle = tryPlayCurrentPlayer === 'black' ? '#222' : '#ddd';
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            refreshScoreBoard();
        }

        function applyLiveSnapshotGuess() {
            if (!liveReplaySnapshots.length) {
                board = initBoardArray(BOARD_SIZE);
                phase = 'select';
                currentPlayer = 'black';
                candidates = [];
                selectedMove = null;
                guessCandidates = [];
                rightGuessPoint = null;
                wrongGuessPoint = null;
                lastMoveMarkers = [];
                return;
            }
            if (liveViewStep < 0) liveViewStep = 0;
            if (liveViewStep >= liveReplaySnapshots.length) liveViewStep = liveReplaySnapshots.length - 1;
            const snap = liveReplaySnapshots[liveViewStep];
            if (snap.board.length !== BOARD_SIZE) {
                BOARD_SIZE = snap.board.length;
                updateBoardGeometry();
            }
            board = deepCopyBoard(snap.board);
            phase = snap.phase || 'select';
            currentPlayer = snap.currentPlayer || 'black';
            candidates = (snap.candidates || []).map(c => ({ row: c.row, col: c.col }));
            selectedMove = snap.selectedMove ? { ...snap.selectedMove } : null;
            guessCandidates = (snap.guessCandidates || []).map(c => ({ row: c.row, col: c.col }));
            rightGuessPoint = snap.rightGuessPoint ? { ...snap.rightGuessPoint } : null;
            wrongGuessPoint = snap.wrongGuessPoint ? { ...snap.wrongGuessPoint } : null;
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;
        }

        function updateLiveReplayPanelUIGuess() {
            if (replayMode) return;
            const total = Math.max(0, liveReplaySnapshots.length - 1);
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = total;
            slider.value = liveViewStep;
            document.getElementById('replayStepDisplay').innerText = `${liveViewStep} / ${total}`;
        }

        function setLiveViewStepGuess(step) {
            clearMobileMovePreview();
            if (replayMode) return;
            const total = Math.max(0, liveReplaySnapshots.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            liveViewStep = step;
            liveFollowLatest = step >= total;
            psBindings.liveViewStep = liveViewStep;
            applyLiveSnapshotGuess();
            updateLiveReplayPanelUIGuess();
            updateTurn();
        }

        function guessDisplayBase() {
            const el = eventLog || [];
            if (el.length === 0) return { text: '初始局面', isInitial: true };

            const completedRounds = Math.floor(el.length / 2);
            const inSelectDoneWaitingGuess = (phase === 'guess') && (el.length % 2 === 1);
            if (inSelectDoneWaitingGuess) {
                const hand = completedRounds + 1;
                const emoji = currentPlayer === 'black' ? '⚫' : '⚪';
                return { text: `${emoji} 第${hand}手（已选点）`, isInitial: false };
            }

            if (completedRounds <= 0) return { text: '初始局面', isInitial: true };
            const hand = completedRounds;
            const emoji = hand % 2 === 1 ? '⚫' : '⚪';
            return { text: `${emoji} 第${hand}手`, isInitial: false };
        }

        function updateTurn()
        {
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

                let phaseTag = '';
                if (snap.candidates && snap.candidates.length && snap.selectedMove) {
                    phaseTag = ' · 选点';
                } else if (snap.candidates && snap.candidates.length) {
                    phaseTag = ' · 迷惑点';
                } else if (snap.rightGuessPoint || snap.wrongGuessPoint) {
                    phaseTag = ' · 猜点';
                }

                const hn = snap.handNumber != null && snap.handNumber > 0 ? snap.handNumber : null;
                if ((hn === null || hn === 0) && n === 0 && !phaseTag) {
                    turnDisplay.innerText = '初始局面';
                } else if (hn != null && hn >= 1) {
                    const emoji = hn % 2 === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${hn}手${phaseTag}`;
                } else {
                    const emoji = (n % 2 === 1) ? '⚫' : '⚪';
                    turnDisplay.innerText = n === 0 ? `开局${phaseTag}` : `${emoji} 第${n}手${phaseTag}`;
                }
                scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoard();
                return;
            }
            if (gameOver)
            {
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

            const base = guessDisplayBase();
            scoreTitle.innerText = '　';
            if (base.isInitial) {
                turnDisplay.innerText = '初始局面';
                if (phase === 'select') {
                    isMyTurn = (mySlot === currentPlayer);
                } else {
                    isMyTurn = (mySlot !== currentPlayer && mySlot !== null);
                }
                const atLiveEdge0 = liveReplaySnapshots.length === 0 || liveViewStep >= liveReplaySnapshots.length - 1;
                if (!atLiveEdge0) isMyTurn = false;
                drawBoard();
                return;
            }
            turnDisplay.innerText = base.text;
            if (phase === 'select') {
                isMyTurn = (mySlot === currentPlayer);
            } else {
                isMyTurn = (mySlot !== currentPlayer && mySlot !== null);
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
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: psBindings,
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep: setLiveViewStepGuess,
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

        // ---------- WebSocket ----------

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
                    if (msg.board !== undefined) {
                        syncState(msg);
                    } else {
                        matchStarted = true;
                        updateTurn();
                    }
                    break;
                case 'timeControlReset':
                    matchStarted = false;
                    updateTurn();
                    break;
                default:
                    break;
            }
        }

        function syncState(state)
        {
            clearMobileMovePreview();
            const incomingSize = state.boardSize != null ? Number(state.boardSize) : NaN;
            const sizeNum = Number(BOARD_SIZE);
            const br = state.board && state.board.length;
            const bc = state.board && state.board[0] && state.board[0].length;
            const needGeometry =
                Number.isFinite(incomingSize) &&
                (incomingSize !== sizeNum ||
                    (state.board && (br !== incomingSize || bc !== incomingSize)));
            if (needGeometry) {
                BOARD_SIZE = incomingSize;
                board = initBoardArray(BOARD_SIZE);
                updateBoardGeometry();
                const bs = document.getElementById('boardSizeSelect');
                if (bs) bs.value = String(BOARD_SIZE);
            }
            if (Array.isArray(state.eventLog))
                eventLog = state.eventLog;
            numberOfHands = state.numberOfHands != null ? state.numberOfHands : 1;
            if (state.matchStarted !== undefined) matchStarted = !!state.matchStarted;
            if (state.slots)
                slots = state.slots;
            psBindings.slots = slots;

            if (!replayMode) {
                const prevTotal = Math.max(0, liveReplaySnapshots.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                let built = buildGuessSnapshotsFromEvents(eventLog, BOARD_SIZE);
                if (!built || !built.length)
                    built = buildGuessSnapshotsFromEvents([], BOARD_SIZE);
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
                applyLiveSnapshotGuess();
                if (liveViewStep === newTotal) {
                    if (state.board != null) board = deepCopyBoard(state.board);
                    currentPlayer = state.currentPlayer;
                    gameOver = state.gameOver || false;
                    winner = state.winner || null;
                    psBindings.gameOver = gameOver;
                    psBindings.winner = winner;
                    phase = state.phase || 'select';
                    selectedMove = state.selectedMove || null;
                    guessCandidates = state.guessCandidates || [];
                    rightGuessPoint = state.rightGuessPoint || null;
                    wrongGuessPoint = state.wrongGuessPoint || null;
                    candidates = state.candidates || [];
                    lastMoveMarkers = state.lastMoveMarkers || [];
                }
                updateLiveReplayPanelUIGuess();
            } else {
                if (state.board != null)
                    board = deepCopyBoard(state.board);
                currentPlayer = state.currentPlayer;
                gameOver = state.gameOver || false;
                winner = state.winner || null;
                psBindings.gameOver = gameOver;
                psBindings.winner = winner;
                phase = state.phase || 'select';
                selectedMove = state.selectedMove || null;
                guessCandidates = state.guessCandidates || [];
                rightGuessPoint = state.rightGuessPoint || null;
                wrongGuessPoint = state.wrongGuessPoint || null;
                candidates = state.candidates || [];
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
            clearMobileMovePreview();
            replaySnapshots = data.snapshots || [];
            if (replaySnapshots.length === 0) return;
            replayTotalSteps = replaySnapshots.length - 1;
            replayMode = true;
            const slider = document.getElementById('replaySlider');
            slider.max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
            updateRecordButtons();
        }

        function exitReplayMode() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
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
            const snap = replaySnapshots[step];
            if (!snap) return;
            const sz = snap.board.length;
            if (sz !== BOARD_SIZE) {
                BOARD_SIZE = sz;
                updateBoardGeometry();
            }
            board = deepCopyBoard(snap.board);
            phase = snap.phase || 'select';
            currentPlayer = snap.currentPlayer || 'black';
            candidates = (snap.candidates || []).map(c => ({ row: c.row, col: c.col }));
            selectedMove = snap.selectedMove ? { ...snap.selectedMove } : null;
            guessCandidates = (snap.guessCandidates || []).map(c => ({ row: c.row, col: c.col }));
            rightGuessPoint = snap.rightGuessPoint ? { ...snap.rightGuessPoint } : null;
            wrongGuessPoint = snap.wrongGuessPoint ? { ...snap.wrongGuessPoint } : null;
            lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
            gameOver = !!snap.gameOver;
            winner = snap.winner != null ? snap.winner : null;
            numberOfHands = 1;

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;
            if (step === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                let phaseTag = '';
                if (snap.candidates && snap.candidates.length && snap.selectedMove) {
                    phaseTag = ' · 迷惑点+选点';
                } else if (snap.candidates && snap.candidates.length) {
                    phaseTag = ' · 迷惑点';
                } else if (snap.rightGuessPoint || snap.wrongGuessPoint) {
                    phaseTag = ' · 猜点';
                }
                if (snap.handNumber != null && snap.handNumber >= 1) {
                    const emoji = snap.handNumber % 2 === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps} · ${emoji} 第${snap.handNumber}手${phaseTag}`;
                } else {
                    let n = 0;
                    for (let r = 0; r < sz; r++)
                        for (let c = 0; c < sz; c++)
                            if (snap.board[r][c] !== 0) n++;
                    if (n === 0 && !phaseTag) {
                        turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps}`;
                    } else if (n === 0 && phaseTag) {
                        turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps} · 开局${phaseTag}`;
                    } else {
                        const emoji = (n % 2 === 1) ? '⚫' : '⚪';
                        turnDisplay.innerText = `打谱 ${step} / ${replayTotalSteps} · ${emoji} 第${n}手${phaseTag}`;
                    }
                }
            }
            if (gameOver) {
                if (winner === 'black') scoreTitle.innerText = '黑胜';
                else if (winner === 'white') scoreTitle.innerText = '白胜';
                else if (winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '对局结束';
            } else {
                scoreTitle.innerText = '　';
            }
            isMyTurn = false;
            psBindings.replayStep = replayStep;
            drawBoard();
        }

        function updateReplayUI() {
            const hideIds = ['resignBtn', 'drawBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!mySlot;
            const mt = psBindings.matchTime;
            const started = !!(matchStarted || (mt && mt.settings));
            const showMatchButtons = isPlayer && started && !replayMode;
            hideIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = showMatchButtons ? '' : 'none'; });
            replayPanel.style.display = '';
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
        }

        function checkWinLocal(brd, row, col, colorVal) {
            return QiWeiqiSquarePageRuntime.checkWuziqiFiveInRow(brd, row, col, colorVal, BOARD_SIZE);
        }

        function enterTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [lastMoveMarkers.map(m => ({ ...m }))];
            tryPlayMeta = [{ gameOver: false, winner: null }];
            const snap = replaySnapshots[replayStep];
            tryPlayCurrentPlayer = (snap && !snap.gameOver && snap.currentPlayer) ? snap.currentPlayer : 'black';
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
            psBindings.tryPlayMode = tryPlayMode;
        }

        function exitTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
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
            psBindings.tryPlayMode = tryPlayMode;
        }

        function tryPlayMove(row, col) {
            if (board[row][col] !== 0 || gameOver) return;
            const playerVal = tryPlayCurrentPlayer === 'black' ? 1 : 2;
            board[row][col] = playerVal;
            lastMoveMarkers = [{ row, col, color: playerVal }];
            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
                tryPlayMeta.length = tryPlayStep + 1;
            }
            let gOver = false;
            let win = null;
            if (checkWinLocal(board, row, col, playerVal)) {
                gOver = true;
                win = tryPlayCurrentPlayer;
            }
            tryPlayBoards.push(deepCopyBoard(board));
            tryPlayMarkers.push(lastMoveMarkers.map(m => ({ ...m })));
            tryPlayMeta.push({ gameOver: gOver, winner: win });
            gameOver = gOver;
            winner = win;
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = tryPlayCurrentPlayer === 'black' ? 'white' : 'black';
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
            board = deepCopyBoard(tryPlayBoards[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));
            const meta = tryPlayMeta[step] || { gameOver: false, winner: null };
            gameOver = meta.gameOver;
            winner = meta.winner;
            const baseSnap = replaySnapshots[tryPlayBaseStep];
            const startPl = (baseSnap && !baseSnap.gameOver && baseSnap.currentPlayer) ? baseSnap.currentPlayer : 'black';
            tryPlayCurrentPlayer = step % 2 === 0 ? startPl : (startPl === 'black' ? 'white' : 'black');
            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            updateTurn();
            drawBoard();
            psBindings.tryPlayStep = tryPlayStep;
        }

        function updateTryPlayDisplay() {
            if (tryPlayMode) {
                document.getElementById('replayStepDisplay').innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
                const emoji = tryPlayCurrentPlayer === 'black' ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
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

        // 鼠标悬停事件
        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) =>
            {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                hoverRow = row;
                hoverCol = col;
                isHoverValid = true;
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () =>
            {
                isHoverValid = false;
                hoverRow = -1;
                hoverCol = -1;
                drawBoard();
            });
        }

        canvas.addEventListener('click', (e) =>
        {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            if (tryPlayMode && replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
                    return;
                }
                if (board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
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
            if (gameOver) return;
            if (phase === 'select' && isMyTurn) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
                    return;
                }
                if (board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
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
            } else if (phase === 'guess' && isMyTurn) {
                ws.send(JSON.stringify({ type: 'guess', row, col }));
            }
        });

        drawBoard();

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
