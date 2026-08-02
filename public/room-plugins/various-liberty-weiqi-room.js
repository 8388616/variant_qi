window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['various-liberty-weiqi'] = {
    shell: {
        "title": "异气围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />\n棋子有一气、二气、三气、四气四种，最小气数分别为1、2、3、4。每片棋至少要有n口气才能留在棋盘上，其中n为这片棋中所有棋子的最小气数平均值。<br /><br />\n双方各有容量为8的背包。开局时背包里有每种其中各2枚。每手棋可以从背包中选一枚棋子落子。<br /><br />\n每手棋结束后，若背包未满，则会依次补充一枚一气、二气、三气、四气棋子。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "异气围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": false,
            "vlBags": true
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
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "异气围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const BACKPACK_CAP = 8;

        function initialBag() {
            return [1, 1, 2, 2, 3, 3, 4, 4];
        }

        function initLevelBoard(size) {
            return Array(size).fill().map(() => Array(size).fill(0));
        }

        function normalizeLevelBoard(rawLevelBoard, boardSize) {
            const normalized = initLevelBoard(boardSize);
            if (!Array.isArray(rawLevelBoard)) return normalized;
            for (let r = 0; r < boardSize; r++) {
                if (!Array.isArray(rawLevelBoard[r])) continue;
                for (let c = 0; c < boardSize; c++) {
                    const value = rawLevelBoard[r][c];
                    if (Number.isFinite(value)) normalized[r][c] = value;
                }
            }
            return normalized;
        }

        function safeLevelAt(levelBoard, r, c) {
            const row = Array.isArray(levelBoard) ? levelBoard[r] : null;
            const value = Array.isArray(row) ? row[c] : 0;
            return Number.isFinite(value) ? value : 0;
        }

        function deepCopy2d(a) {
            return a.map(row => row.slice());
        }

        function collectGroup(board, levelBoard, boardSize, startR, startC) {
            const color = board[startR][startC];
            if (color === 0) return null;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            const queue = [[startR, startC]];
            visited[startR][startC] = true;
            const stones = [];
            const libSet = new Set();
            while (queue.length) {
                const [r, c] = queue.shift();
                stones.push([r, c]);
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                    if (board[nr][nc] === 0) libSet.add(nr + ',' + nc);
                    else if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }
            const libertyCount = libSet.size;
            let sumLevel = 0;
            for (const [r, c] of stones) sumLevel += levelBoard[r][c];
            return { stones, libertyCount, sumLevel, color };
        }

        function removeGroupWithLevels(board, levelBoard, row, col, color, boardSize) {
            const queue = [[row, col]];
            board[row][col] = 0;
            levelBoard[row][col] = 0;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        levelBoard[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function removeFailingGroupsOfColor(board, levelBoard, boardSize, targetColor) {
            let changed = true;
            while (changed) {
                changed = false;
                const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
                for (let r = 0; r < boardSize; r++) {
                    for (let c = 0; c < boardSize; c++) {
                        if (board[r][c] !== targetColor || visited[r][c]) continue;
                        const g = collectGroup(board, levelBoard, boardSize, r, c);
                        if (!g) continue;
                        for (const [rr, cc] of g.stones) visited[rr][cc] = true;
                        const { libertyCount, stones, sumLevel } = g;
                        if (libertyCount * stones.length < sumLevel) {
                            removeGroupWithLevels(board, levelBoard, r, c, targetColor, boardSize);
                            changed = true;
                        }
                    }
                }
            }
        }

        function tryPlaceStoneVariousLiberty(board, levelBoard, boardSize, row, col, playerVal, level) {
            if (board[row][col] !== 0) return null;
            const newBoard = deepCopy2d(board);
            const newLevel = deepCopy2d(levelBoard);
            newBoard[row][col] = playerVal;
            newLevel[row][col] = level;
            const enemyColor = 3 - playerVal;
            removeFailingGroupsOfColor(newBoard, newLevel, boardSize, enemyColor);
            removeFailingGroupsOfColor(newBoard, newLevel, boardSize, playerVal);
            if (newBoard[row][col] === 0) return null;
            return { board: newBoard, levelBoard: newLevel };
        }

        function replenishAfterPly(bag, moveNumber) {
            if (bag.length >= BACKPACK_CAP) return;
            const r = moveNumber % 8;
            let level;
            if (r === 0 || r === 1) level = 1;
            else if (r === 2 || r === 3) level = 2;
            else if (r === 4 || r === 5) level = 3;
            else level = 4;
            bag.push(level);
            bag.sort((a, b) => a - b);
        }

        function removeFirstOfLevel(bag, level) {
            const i = bag.indexOf(level);
            if (i === -1) return false;
            bag.splice(i, 1);
            return true;
        }

        function parseVlMoveString(s) {
            if (typeof s !== 'string' || s.length < 2) return null;
            const player = s[0] === 'B' ? 'black' : 'white';
            if (s[1] === 'p') return { type: 'pass', player };
            const parts = s.slice(1).split(',');
            if (parts.length < 3) return null;
            const row = parseInt(parts[0], 10);
            const col = parseInt(parts[1], 10);
            const level = parseInt(parts[2], 10);
            if (!Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(level)) return null;
            return { type: 'move', player, row, col, level };
        }

        function normalizeVlMove(m) {
            if (typeof m === 'string') return parseVlMoveString(m);
            if (m && typeof m === 'object' && m.type) return m;
            return null;
        }

        /**
         * 与后端一致的逐步快照：用于打谱模式与局面回放。
         */
        function buildVlReplayStepSnapshots(movesRaw, boardSize, _initialPosition) {
            let curBoard = QiSquareWeiqiCanvas.initBoardArray(boardSize);
            let curLevel = initLevelBoard(boardSize);
            let black = initialBag();
            let white = initialBag();
            const boards = [deepCopy2d(curBoard)];
            const levelBoards = [deepCopy2d(curLevel)];
            const markers = [[]];
            const players = [0];
            const blackBags = [black.slice()];
            const whiteBags = [white.slice()];

            const moves = (movesRaw || []).map(normalizeVlMove).filter(Boolean);
            for (let i = 0; i < moves.length; i++) {
                const m = moves[i];
                const playerVal = m.player === 'black' ? 1 : 2;
                players.push(playerVal);
                const bag = playerVal === 1 ? black : white;
                if (m.type === 'move') {
                    if (!removeFirstOfLevel(bag, m.level)) break;
                    const placed = tryPlaceStoneVariousLiberty(
                        curBoard, curLevel, boardSize, m.row, m.col, playerVal, m.level
                    );
                    if (placed) {
                        curBoard = placed.board;
                        curLevel = placed.levelBoard;
                    }
                    replenishAfterPly(bag, i + 1);
                    boards.push(deepCopy2d(curBoard));
                    levelBoards.push(deepCopy2d(curLevel));
                    markers.push([{ row: m.row, col: m.col, color: playerVal, level: m.level }]);
                } else {
                    replenishAfterPly(bag, i + 1);
                    boards.push(deepCopy2d(curBoard));
                    levelBoards.push(deepCopy2d(curLevel));
                    markers.push([]);
                }
                blackBags.push(black.slice());
                whiteBags.push(white.slice());
            }
            return {
                boards,
                levelBoards,
                markers,
                players,
                blackBags,
                whiteBags
            };
        }

        const ps = {
            BOARD_SIZE: 19,
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
            slots: { black: false, white: false },
            reconnectTimer: null,
            replayMode: false,
            replayBoards: [],
            replayLevelBoards: [],
            replayMarkers: [],
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
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            levelBoard: [],
            blackBag: initialBag(),
            whiteBag: initialBag(),
            selectedBagIndex: 0,
            liveReplayLevelBoards: [],
            liveReplayBlackBags: [],
            liveReplayWhiteBags: [],
            replayBlackBags: [],
            replayWhiteBags: [],
            _prevWasMyTurn: false
        };

        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            ps.levelBoard = initLevelBoard(ps.BOARD_SIZE);
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

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
        const gameWrapper = document.getElementById('gameWrapper');

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
            komiInfo: document.getElementById('komiInfo'),
            canvas,
            ctx,
            boardMarkSelect,
            colorStatus
        };

        function getBagForPlayerVal(playerVal) {
            return playerVal === 1 ? ps.blackBag : ps.whiteBag;
        }

        function rebuildLiveReplayFromMoveCoords(moveCoords) {
            const built = buildVlReplayStepSnapshots(moveCoords || [], ps.BOARD_SIZE, []);
            ps.liveReplayBoards = built.boards;
            ps.liveReplayLevelBoards = built.levelBoards;
            ps.liveReplayMarkers = built.markers;
            ps.liveReplayStepPlayers = built.players;
            ps.liveReplayBlackBags = built.blackBags;
            ps.liveReplayWhiteBags = built.whiteBags;
        }

        /** 对局中正在浏览历史（非打谱模式、非紧跟最新） */
        function isBrowsingLiveHistory() {
            return !ps.replayMode && ps.liveReplayBoards.length > 0 && !ps.liveFollowLatest;
        }

        function renderBags() {
            const whiteRow = document.getElementById('whiteBagRow');
            const blackRow = document.getElementById('blackBagRow');
            whiteRow.innerHTML = '';
            blackRow.innerHTML = '';

            const browsing = isBrowsingLiveHistory();

            function fillRow(rowEl, bag, color, isMyBag, selectedIndex) {
                bag.forEach((level, idx) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'vl-bag-slot-btn';
                    if (isMyBag && selectedIndex >= 0 && idx === selectedIndex) btn.classList.add('active');
                    const stone = document.createElement('div');
                    stone.className = 'vl-bag-stone ' + (color === 'black' ? 'vl-black' : 'vl-white');
                    if (level > 1) {
                        const sp = document.createElement('span');
                        sp.className = 'vl-bag-lv';
                        sp.textContent = String(level);
                        stone.appendChild(sp);
                    }
                    btn.appendChild(stone);
                    if (isMyBag) {
                        btn.addEventListener('click', () => {
                            if (browsing && ps.mySlot === color) {
                                const total = Math.max(0, ps.liveReplayBoards.length - 1);
                                page.setLiveViewStep(total);
                                ps.selectedBagIndex = 0;
                                renderBags();
                                drawBoard();
                                return;
                            }
                            if (browsing) return;
                            ps.selectedBagIndex = idx;
                            renderBags();
                            drawBoard();
                        });
                    }
                    rowEl.appendChild(btn);
                });
            }

            const canSelect = !ps.gameOver && !ps.replayMode;
            let wSel = ps.mySlot === 'white' ? Math.min(ps.selectedBagIndex, Math.max(0, ps.whiteBag.length - 1)) : -1;
            let bSel = ps.mySlot === 'black' ? Math.min(ps.selectedBagIndex, Math.max(0, ps.blackBag.length - 1)) : -1;
            if (browsing) {
                wSel = -1;
                bSel = -1;
            }
            fillRow(whiteRow, ps.whiteBag, 'white', ps.mySlot === 'white' && canSelect, wSel);
            fillRow(blackRow, ps.blackBag, 'black', ps.mySlot === 'black' && canSelect, bSel);
        }

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords,
            tryPlaceStone(boardBefore, row, col, playerVal) {
                const bag = getBagForPlayerVal(playerVal);
                if (!bag.length) return null;
                const idx = Math.min(ps.selectedBagIndex, bag.length - 1);
                const level = bag[idx];
                const lb = deepCopy2d(ps.levelBoard);
                const res = tryPlaceStoneVariousLiberty(
                    boardBefore, lb, ps.BOARD_SIZE, row, col, playerVal, level
                );
                return res ? res.board : null;
            }
        });

        const origExitReplayMode = page.exitReplayMode;

        page.enterReplayMode = function (data) {
            const built = buildVlReplayStepSnapshots(data.moves || [], ps.BOARD_SIZE, data.initialPosition);
            ps.replayBoards = built.boards;
            ps.replayLevelBoards = built.levelBoards;
            ps.replayMarkers = built.markers;
            ps.replayStepPlayers = built.players;
            ps.replayBlackBags = built.blackBags;
            ps.replayWhiteBags = built.whiteBags;
            ps.replayTotalSteps = built.boards.length - 1;
            ps.replayMode = true;
            const slider = document.getElementById('replaySlider');
            if (slider) {
                slider.min = 0;
                slider.max = ps.replayTotalSteps;
            }
            page.setReplayStep(ps.replayTotalSteps);
            page.updateReplayUI();
        };

        page.setReplayStep = function (step) {
            page.clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
            ps.replayStep = step;
            ps.board = deepCopy2d(ps.replayBoards[step]);
            ps.levelBoard = deepCopy2d(ps.replayLevelBoards[step]);
            ps.blackBag = ps.replayBlackBags[step].slice();
            ps.whiteBag = ps.replayWhiteBags[step].slice();
            ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
            const slider = document.getElementById('replaySlider');
            if (slider) slider.value = step;
            const stepDisp = document.getElementById('replayStepDisplay');
            if (stepDisp) stepDisp.innerText = `${step} / ${ps.replayTotalSteps}`;
            if (step === 0) turnDisplay.innerText = '初始局面';
            else {
                const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 第${step}手`;
            }
            ps.isMyTurn = false;
            if (ps.showEstimateActive) page.showEstimate();
            else page.drawBoard();
            renderBags();
        };

        page.exitReplayMode = function () {
            origExitReplayMode();
            ps.replayLevelBoards = [];
            ps.replayBlackBags = [];
            ps.replayWhiteBags = [];
        };

        page.drawBoard = function () {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
            if (!ps.showMoveNumbers) {
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        if (ps.board[r][c] === 0) continue;
                        const lv = safeLevelAt(ps.levelBoard, r, c);
                        if (lv <= 1) continue;
                        const x = ps.PADDING + c * cellSize;
                        const y = ps.PADDING + r * cellSize;
                        const fontPx = Math.max(11, Math.floor(stoneRadius * 0.85));
                        ctx.font = `bold ${fontPx}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const textX = x - stoneRadius * 0.42 + 1;
                        const textY = y - stoneRadius * 0.42 + 1;
                        ctx.fillStyle = ps.board[r][c] === 1 ? '#fff' : '#000';
                        ctx.shadowBlur = 0;
                        ctx.fillText(String(lv), textX, textY);
                    }
                }
            }
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize,
                page.isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = page.computeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid
            });
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        };

        /** qi.js 内部调用的是闭包里的 applyLiveViewBoard，不会走到 page.applyLiveViewBoard 的覆盖；对局浏览与同步后需显式同步。 */
        function syncLiveViewLevelAndBagsFromReplay() {
            if (!ps.liveReplayBoards.length) {
                ps.levelBoard = initLevelBoard(ps.BOARD_SIZE);
                return;
            }
            const step = ps.liveViewStep;
            if (ps.liveReplayLevelBoards && step >= 0 && step < ps.liveReplayLevelBoards.length) {
                ps.levelBoard = deepCopy2d(ps.liveReplayLevelBoards[step]);
            } else {
                ps.levelBoard = initLevelBoard(ps.BOARD_SIZE);
            }
            if (
                ps.liveReplayBlackBags && ps.liveReplayWhiteBags
                && step >= 0 && step < ps.liveReplayBlackBags.length && step < ps.liveReplayWhiteBags.length
            ) {
                ps.blackBag = ps.liveReplayBlackBags[step].slice();
                ps.whiteBag = ps.liveReplayWhiteBags[step].slice();
            }
        }

        const origSyncState = page.syncState;
        const origApplyLiveViewBoard = page.applyLiveViewBoard;
        page.applyLiveViewBoard = function () {
            origApplyLiveViewBoard();
            syncLiveViewLevelAndBagsFromReplay();
            renderBags();
        };
        const origSetLiveViewStep = page.setLiveViewStep;
        page.setLiveViewStep = function (step) {
            origSetLiveViewStep(step);
            if (ps.replayMode) return;
            syncLiveViewLevelAndBagsFromReplay();
            renderBags();
            if (ps.showEstimateActive) page.showEstimate();
            else page.drawBoard();
        };
        page.syncState = function (state) {
            const wasMyTurn = ps.isMyTurn;
            const incomingSize = Number.isInteger(state.boardSize) ? state.boardSize : ps.BOARD_SIZE;
            ps.levelBoard = normalizeLevelBoard(state.levelBoard || ps.levelBoard, incomingSize);
            origSyncState(state);
            if (ps.replayMode) {
                ps.levelBoard = normalizeLevelBoard(state.levelBoard || ps.levelBoard, ps.BOARD_SIZE);
                if (state.blackBag) ps.blackBag = [...state.blackBag];
                if (state.whiteBag) ps.whiteBag = [...state.whiteBag];
            } else {
                syncLiveViewLevelAndBagsFromReplay();
            }
            if (!wasMyTurn && ps.isMyTurn && ps.mySlot) ps.selectedBagIndex = 0;
            renderBags();
            if (!ps.replayMode) {
                if (ps.showEstimateActive) page.showEstimate();
                else page.drawBoard();
            }
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
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
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
syncState,
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
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            timeControlMainByoScale: 2
        });
        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMoveVl(row, col) {
            if (ps.gameOver) return false;
            if (!ps.isMyTurn) return false;
            if (ps.board[row][col] !== 0) return false;
            const bag = ps.mySlot === 'black' ? ps.blackBag : ps.whiteBag;
            if (!bag.length) return false;
            const bagIndex = Math.min(ps.selectedBagIndex, bag.length - 1);
            const level = bag[bagIndex];
            if (!ps.ws || ps.ws.readyState !== WebSocket.OPEN) return false;
            ps.ws.send(JSON.stringify({ type: 'move', row, col, level }));
            return true;
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

            const myBag = ps.mySlot === 'black' ? ps.blackBag : ps.whiteBag;
            if (!myBag.length) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMoveVl(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            commitMoveVl(row, col);
        });

        if (isMouseDevice) {
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
                const myBag = ps.mySlot === 'black' ? ps.blackBag : ps.whiteBag;
                ps.hoverRow = row;
                ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0 && myBag.length > 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    drawBoard();
                }
            });
        }

        if (scoreConfirmYes) {
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

        renderBags();
        connectWebSocket(handleMessage);
        })();
    }
};
