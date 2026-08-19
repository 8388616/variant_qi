window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['sudoku-weiqi'] = {
    shell: {
        "title": "数独围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />落子必须保证数独有解，否则无效，视为虚着。<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeValues": [9, 16],
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "数独围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "compoundPalette": false,
            "zoomScroll": false,
            "vlBags": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "数独围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        if (!document.getElementById('sudokuWeiqiBagStyle')) {
            const st = document.createElement('style');
            st.id = 'sudokuWeiqiBagStyle';
            st.textContent = [
                'body.qi-room.qi-room-sudoku-weiqi .vl-bag-slot-btn.disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.35);pointer-events:none;}',
                'body.qi-room.qi-room-sudoku-weiqi .vl-bag-lv{left:3px;top:1px;font-size:10px;}'
            ].join('');
            document.head.appendChild(st);
        }
        document.body.classList.add('qi-room-sudoku-weiqi');

        function emptyDigitBoard(size) {
            return Array(size).fill(null).map(() => Array(size).fill(0));
        }

        function initialBagAvail(size) {
            const bag = new Array(size + 1).fill(false);
            for (let d = 1; d <= size; d++) bag[d] = true;
            return bag;
        }

        function deepCopy2d(a) {
            return a.map(row => row.slice());
        }

        function copyBagAvail(bag) {
            return bag.slice();
        }

        function bagRefreshPeriod(boardSize) {
            return boardSize === 16 ? 31 : 17;
        }

        function normalizeDigitBoard(raw, boardSize) {
            const out = emptyDigitBoard(boardSize);
            if (!Array.isArray(raw)) return out;
            for (let r = 0; r < boardSize; r++) {
                if (!Array.isArray(raw[r])) continue;
                for (let c = 0; c < boardSize; c++) {
                    const v = raw[r][c];
                    if (Number.isFinite(v) && v >= 1 && v <= boardSize) out[r][c] = v;
                }
            }
            return out;
        }

        function normalizeBagAvail(raw, boardSize) {
            const bag = initialBagAvail(boardSize);
            if (!Array.isArray(raw)) return bag;
            for (let d = 1; d <= boardSize; d++) {
                if (raw[d] === false || raw[d] === 0) bag[d] = false;
                else if (raw[d] === true || raw[d] === 1) bag[d] = true;
            }
            return bag;
        }

        function safeDigitAt(digitBoard, r, c) {
            const row = Array.isArray(digitBoard) ? digitBoard[r] : null;
            const value = Array.isArray(row) ? row[c] : 0;
            return Number.isFinite(value) ? value : 0;
        }

        function boxSizeOf(n) {
            return n === 16 ? 4 : 3;
        }

        function computeCellGeometry(boardSize) {
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const padding = Math.max(26, 420 / (boardSize + 2));
            const cellSize = (cs - 2 * padding) / boardSize;
            return { padding, cellSize, canvasSize: cs };
        }

        function cellCenter(padding, cellSize, row, col) {
            return {
                x: padding + (col + 0.5) * cellSize,
                y: padding + (row + 0.5) * cellSize
            };
        }

        function getClosestCell(x, y, boardSize, padding, cellSize) {
            const col = Math.floor((x - padding) / cellSize);
            const row = Math.floor((y - padding) / cellSize);
            if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return { row: -1, col: -1 };
            return { row, col };
        }

        function popcount32(x) {
            x -= (x >>> 1) & 0x55555555;
            x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
            return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
        }

        function bitIndex32(bit) {
            let i = 0;
            let b = bit >>> 1;
            while (b) {
                b >>>= 1;
                i++;
            }
            return i;
        }

        /** 客户端试下用：与服务器同逻辑的有解判定 */
        function isSudokuSolvable(grid) {
            const n = grid.length;
            const box = Math.round(Math.sqrt(n));
            if (box * box !== n) return false;
            const g = new Int8Array(n * n);
            const rowMask = new Uint32Array(n);
            const colMask = new Uint32Array(n);
            const boxMask = new Uint32Array(n);
            const ALL = n === 16 ? 0xffff : 0x1ff;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const v = grid[r][c] | 0;
                    const idx = r * n + c;
                    if (v === 0) { g[idx] = 0; continue; }
                    if (v < 1 || v > n) return false;
                    const bit = 1 << (v - 1);
                    const b = ((r / box) | 0) * box + ((c / box) | 0);
                    if ((rowMask[r] & bit) || (colMask[c] & bit) || (boxMask[b] & bit)) return false;
                    rowMask[r] |= bit; colMask[c] |= bit; boxMask[b] |= bit;
                    g[idx] = v;
                }
            }
            function candMask(r, c) {
                const b = ((r / box) | 0) * box + ((c / box) | 0);
                return ALL & ~(rowMask[r] | colMask[c] | boxMask[b]);
            }
            function place(r, c, bit) {
                g[r * n + c] = bitIndex32(bit) + 1;
                const b = ((r / box) | 0) * box + ((c / box) | 0);
                rowMask[r] |= bit; colMask[c] |= bit; boxMask[b] |= bit;
            }
            function unplace(r, c, bit) {
                g[r * n + c] = 0;
                const b = ((r / box) | 0) * box + ((c / box) | 0);
                rowMask[r] ^= bit; colMask[c] ^= bit; boxMask[b] ^= bit;
            }
            function propagate() {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (let r = 0; r < n; r++) {
                        for (let c = 0; c < n; c++) {
                            if (g[r * n + c] !== 0) continue;
                            const m = candMask(r, c);
                            if (m === 0) return false;
                            if ((m & (m - 1)) === 0) { place(r, c, m); changed = true; }
                        }
                    }
                    for (let d = 0; d < n; d++) {
                        const bit = 1 << d;
                        for (let r = 0; r < n; r++) {
                            if (rowMask[r] & bit) continue;
                            let onlyC = -1;
                            for (let c = 0; c < n; c++) {
                                if (g[r * n + c] !== 0) continue;
                                if (candMask(r, c) & bit) {
                                    if (onlyC >= 0) { onlyC = -2; break; }
                                    onlyC = c;
                                }
                            }
                            if (onlyC === -1) return false;
                            if (onlyC >= 0) { place(r, onlyC, bit); changed = true; }
                        }
                        for (let c = 0; c < n; c++) {
                            if (colMask[c] & bit) continue;
                            let onlyR = -1;
                            for (let r = 0; r < n; r++) {
                                if (g[r * n + c] !== 0) continue;
                                if (candMask(r, c) & bit) {
                                    if (onlyR >= 0) { onlyR = -2; break; }
                                    onlyR = r;
                                }
                            }
                            if (onlyR === -1) return false;
                            if (onlyR >= 0) { place(onlyR, c, bit); changed = true; }
                        }
                        for (let br = 0; br < box; br++) {
                            for (let bc = 0; bc < box; bc++) {
                                const bIdx = br * box + bc;
                                if (boxMask[bIdx] & bit) continue;
                                let onlyR = -1, onlyC = -1;
                                const r0 = br * box, c0 = bc * box;
                                outer: for (let dr = 0; dr < box; dr++) {
                                    for (let dc = 0; dc < box; dc++) {
                                        const r = r0 + dr, c = c0 + dc;
                                        if (g[r * n + c] !== 0) continue;
                                        if (candMask(r, c) & bit) {
                                            if (onlyR >= 0) { onlyR = -2; break outer; }
                                            onlyR = r; onlyC = c;
                                        }
                                    }
                                }
                                if (onlyR === -1) return false;
                                if (onlyR >= 0) { place(onlyR, onlyC, bit); changed = true; }
                            }
                        }
                    }
                }
                return true;
            }
            function snapshot() {
                return { g: Int8Array.from(g), row: Uint32Array.from(rowMask), col: Uint32Array.from(colMask), box: Uint32Array.from(boxMask) };
            }
            function restore(s) {
                g.set(s.g); rowMask.set(s.row); colMask.set(s.col); boxMask.set(s.box);
            }
            function solve() {
                if (!propagate()) return false;
                let bestIdx = -1, bestMask = 0, bestCount = 99;
                for (let i = 0; i < n * n; i++) {
                    if (g[i] !== 0) continue;
                    const r = (i / n) | 0, c = i - r * n;
                    const m = candMask(r, c);
                    const cnt = popcount32(m);
                    if (cnt === 0) return false;
                    if (cnt < bestCount) {
                        bestCount = cnt; bestMask = m; bestIdx = i;
                        if (cnt === 1) break;
                    }
                }
                if (bestIdx < 0) return true;
                const r = (bestIdx / n) | 0, c = bestIdx - r * n;
                let m = bestMask;
                const snap = snapshot();
                while (m) {
                    const bit = m & -m; m ^= bit;
                    restore(snap); place(r, c, bit);
                    if (solve()) return true;
                }
                restore(snap);
                return false;
            }
            return solve();
        }

        function countGroupLiberties(board, row, col, boardSize) {
            const color = board[row][col];
            if (!color) return 0;
            const visited = Array(boardSize).fill(null).map(() => Array(boardSize).fill(false));
            const queue = [[row, col]];
            visited[row][col] = true;
            const libs = new Set();
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                    if (board[nr][nc] === 0) libs.add(nr + ',' + nc);
                    else if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }
            return libs.size;
        }

        function tryPlaceSudokuStone(board, digitBoard, boardSize, row, col, playerVal, digit) {
            if (board[row][col] !== 0) return null;
            const newBoard = deepCopy2d(board);
            const newDigits = deepCopy2d(digitBoard);
            newBoard[row][col] = playerVal;
            newDigits[row][col] = digit;
            const returnedDigits = [];
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            function removeGroup(r0, c0, color) {
                const queue = [[r0, c0]];
                newBoard[r0][c0] = 0;
                if (newDigits[r0][c0]) { returnedDigits.push(newDigits[r0][c0]); newDigits[r0][c0] = 0; }
                while (queue.length) {
                    const [r, c] = queue.shift();
                    for (const [dr, dc] of dirs) {
                        const nr = r + dr, nc = c + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (newBoard[nr][nc] === color) {
                            newBoard[nr][nc] = 0;
                            if (newDigits[nr][nc]) { returnedDigits.push(newDigits[nr][nc]); newDigits[nr][nc] = 0; }
                            queue.push([nr, nc]);
                        }
                    }
                }
            }
            const enemy = 3 - playerVal;
            const checked = new Set();
            for (const [dr, dc] of dirs) {
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (newBoard[nr][nc] !== enemy) continue;
                const key = nr + ',' + nc;
                if (checked.has(key)) continue;
                checked.add(key);
                if (countGroupLiberties(newBoard, nr, nc, boardSize) < 1) removeGroup(nr, nc, enemy);
            }
            if (countGroupLiberties(newBoard, row, col, boardSize) < 1) {
                if (newBoard[row][col] === playerVal) removeGroup(row, col, playerVal);
            }
            return { board: newBoard, digitBoard: newDigits, returnedDigits };
        }

        function parseMoveString(s) {
            if (typeof s !== 'string' || s.length < 2) return null;
            const player = s[0] === 'B' ? 'black' : 'white';
            if (s[1] === 'p') return { type: 'pass', player };
            if (s[1] === '!') {
                const parts = s.slice(2).split(',');
                if (parts.length < 3) return null;
                const row = parseInt(parts[0], 10), col = parseInt(parts[1], 10), digit = parseInt(parts[2], 10);
                if (![row, col, digit].every(Number.isInteger)) return null;
                return { type: 'invalid', player, row, col, digit };
            }
            const parts = s.slice(1).split(',');
            if (parts.length < 3) return null;
            const row = parseInt(parts[0], 10), col = parseInt(parts[1], 10), digit = parseInt(parts[2], 10);
            if (![row, col, digit].every(Number.isInteger)) return null;
            return { type: 'move', player, row, col, digit };
        }

        function normalizeMove(m) {
            if (typeof m === 'string') return parseMoveString(m);
            if (m && typeof m === 'object' && m.type) {
                if (m.type === 'move' && m.digit == null && m.level != null) m.digit = m.level;
                return m;
            }
            return null;
        }

        function applyInitialDigits(digitBoard, list, boardSize) {
            if (!Array.isArray(list)) return;
            for (const s of list) {
                if (typeof s !== 'string') continue;
                const at = s.indexOf('@');
                if (at <= 0) continue;
                const digit = parseInt(s.slice(0, at), 10);
                const comma = s.indexOf(',', at);
                if (comma < 0) continue;
                const row = parseInt(s.slice(at + 1, comma), 10);
                const col = parseInt(s.slice(comma + 1), 10);
                if (![digit, row, col].every(Number.isInteger)) continue;
                if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) continue;
                if (digit >= 1 && digit <= boardSize) digitBoard[row][col] = digit;
            }
        }

        function maybeRefreshBags(blackBag, whiteBag, moveCount, boardSize) {
            const period = bagRefreshPeriod(boardSize);
            if (moveCount > 0 && moveCount % period === 0) {
                for (let d = 1; d <= boardSize; d++) {
                    blackBag[d] = true;
                    whiteBag[d] = true;
                }
            }
        }

        function buildReplaySnapshots(movesRaw, boardSize, initialPosition, initialDigits) {
            let curBoard = QiSquareWeiqiCanvas.initBoardArray(boardSize);
            let curDigits = emptyDigitBoard(boardSize);
            if (Array.isArray(initialPosition)) {
                for (const s of initialPosition) {
                    if (typeof s !== 'string' || s.length < 3) continue;
                    const p = s[0];
                    const comma = s.indexOf(',');
                    if (comma <= 1) continue;
                    const r = parseInt(s.slice(1, comma), 10);
                    const c = parseInt(s.slice(comma + 1), 10);
                    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
                    if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                    if (p === 'B') curBoard[r][c] = 1;
                    else if (p === 'W') curBoard[r][c] = 2;
                }
            }
            applyInitialDigits(curDigits, initialDigits, boardSize);
            let blackBag = initialBagAvail(boardSize);
            let whiteBag = initialBagAvail(boardSize);

            const boards = [deepCopy2d(curBoard)];
            const digitBoards = [deepCopy2d(curDigits)];
            const blackBags = [copyBagAvail(blackBag)];
            const whiteBags = [copyBagAvail(whiteBag)];
            const markers = [[]];
            const players = [0];

            const moves = (movesRaw || []).map(normalizeMove).filter(Boolean);
            let moveCount = 0;
            for (const move of moves) {
                const playerVal = move.player === 'black' ? 1 : 2;
                const myBag = move.player === 'black' ? blackBag : whiteBag;
                moveCount++;
                if (move.type === 'pass' || move.type === 'invalid') {
                    maybeRefreshBags(blackBag, whiteBag, moveCount, boardSize);
                    boards.push(deepCopy2d(curBoard));
                    digitBoards.push(deepCopy2d(curDigits));
                    blackBags.push(copyBagAvail(blackBag));
                    whiteBags.push(copyBagAvail(whiteBag));
                    markers.push([]);
                    players.push(playerVal);
                    continue;
                }
                if (myBag[move.digit]) myBag[move.digit] = false;
                const placed = tryPlaceSudokuStone(curBoard, curDigits, boardSize, move.row, move.col, playerVal, move.digit);
                if (placed) {
                    for (const d of placed.returnedDigits) myBag[d] = true;
                    curBoard = placed.board;
                    curDigits = placed.digitBoard;
                }
                maybeRefreshBags(blackBag, whiteBag, moveCount, boardSize);
                boards.push(deepCopy2d(curBoard));
                digitBoards.push(deepCopy2d(curDigits));
                blackBags.push(copyBagAvail(blackBag));
                whiteBags.push(copyBagAvail(whiteBag));
                markers.push([{ row: move.row, col: move.col, color: playerVal, digit: move.digit }]);
                players.push(playerVal);
            }
            return { boards, digitBoards, blackBags, whiteBags, markers, players };
        }

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const ps = {
            BOARD_SIZE: 9,
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
            replayDigitBoards: [],
            replayBlackBags: [],
            replayWhiteBags: [],
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
            liveReplayDigitBoards: [],
            liveReplayBlackBags: [],
            liveReplayWhiteBags: [],
            liveReplayMarkers: [],
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false,
            digitBoard: emptyDigitBoard(9),
            blackBagAvail: initialBagAvail(9),
            whiteBagAvail: initialBagAvail(9),
            selectedDigit: 1,
            _prevWasMyTurn: false
        };

        (function initGeom() {
            const g = computeCellGeometry(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill(null).map(() => Array(ps.BOARD_SIZE).fill(0));
            ps.digitBoard = emptyDigitBoard(ps.BOARD_SIZE);
            ps.blackBagAvail = initialBagAvail(ps.BOARD_SIZE);
            ps.whiteBagAvail = initialBagAvail(ps.BOARD_SIZE);
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
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');

        const domPage = {
            canvas,
            ctx,
            turnDisplay,
            colorStatus,
            scoreTitle,
            scoreBoard,
            leadInfo,
            BOARD_MARK_CHAR_LIST
        };

        function myBagAvail() {
            if (ps.mySlot === 'white') return ps.whiteBagAvail;
            return ps.blackBagAvail;
        }

        function ensureSelectedDigitAvailable() {
            const bag = myBagAvail();
            const n = ps.BOARD_SIZE;
            if (bag[ps.selectedDigit]) return;
            for (let d = 1; d <= n; d++) {
                if (bag[d]) {
                    ps.selectedDigit = d;
                    return;
                }
            }
        }

        function isBrowsingLiveHistory() {
            return !ps.replayMode && ps.liveReplayBoards.length > 0 && !ps.liveFollowLatest;
        }

        function renderBags() {
            const whiteRow = document.getElementById('whiteBagRow');
            const blackRow = document.getElementById('blackBagRow');
            if (!blackRow || !whiteRow) return;
            whiteRow.innerHTML = '';
            blackRow.innerHTML = '';

            const browsing = isBrowsingLiveHistory();
            const canSelect = !ps.gameOver && !ps.replayMode && !browsing && !!ps.mySlot;
            ensureSelectedDigitAvailable();

            function fillRow(rowEl, bag, color, isMyBag) {
                for (let d = 1; d <= ps.BOARD_SIZE; d++) {
                    const avail = !!bag[d];
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'vl-bag-slot-btn';
                    if (!avail) btn.classList.add('disabled');
                    if (isMyBag && canSelect && avail && ps.selectedDigit === d) btn.classList.add('active');

                    const stone = document.createElement('div');
                    stone.className = 'vl-bag-stone ' + (color === 'black' ? 'vl-black' : 'vl-white');
                    const sp = document.createElement('span');
                    sp.className = 'vl-bag-lv';
                    sp.textContent = String(d);
                    stone.appendChild(sp);
                    btn.appendChild(stone);

                    if (isMyBag && canSelect && avail) {
                        btn.addEventListener('click', () => {
                            ps.selectedDigit = d;
                            renderBags();
                            drawBoard();
                        });
                    } else if (browsing && ps.mySlot === color) {
                        btn.addEventListener('click', () => {
                            const total = Math.max(0, ps.liveReplayBoards.length - 1);
                            page.setLiveViewStep(total);
                            renderBags();
                            drawBoard();
                        });
                    }
                    rowEl.appendChild(btn);
                }
            }

            fillRow(whiteRow, ps.whiteBagAvail, 'white', ps.mySlot === 'white');
            fillRow(blackRow, ps.blackBagAvail, 'black', ps.mySlot === 'black');
        }

        function rebuildLiveReplayFromMoveCoords(moveCoords) {
            const built = buildReplaySnapshots(moveCoords || [], ps.BOARD_SIZE, null, null);
            ps.liveReplayBoards = built.boards;
            ps.liveReplayDigitBoards = built.digitBoards;
            ps.liveReplayBlackBags = built.blackBags;
            ps.liveReplayWhiteBags = built.whiteBags;
            ps.liveReplayMarkers = built.markers;
            ps.liveReplayStepPlayers = built.players;
        }

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: false,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            rebuildLiveReplayFromMoveCoords,
            tryPlaceStone(boardBefore, row, col, playerVal) {
                const bag = playerVal === 1 ? ps.blackBagAvail : ps.whiteBagAvail;
                if (!bag[ps.selectedDigit]) return null;
                const res = tryPlaceSudokuStone(
                    boardBefore, ps.digitBoard, ps.BOARD_SIZE, row, col, playerVal, ps.selectedDigit
                );
                if (!res) return null;
                if (!isSudokuSolvable(res.digitBoard)) return null;
                return res.board;
            }
        });

        const origUpdateBoardGeometry = page.updateBoardGeometry;
        page.updateBoardGeometry = function () {
            const g = computeCellGeometry(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            if (typeof origUpdateBoardGeometry === 'function') {
                // skip default intersection geometry
            }
        };

        function hitCell(x, y) {
            return getClosestCell(x, y, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
        }

        page.getClosestIntersection = function (x, y) {
            return hitCell(x, y);
        };

        function drawStoneAt(ctx2, x, y, color, radius, digit, showNum) {
            ctx2.save();
            ctx2.shadowBlur = 6;
            ctx2.shadowColor = 'rgba(0,0,0,0.5)';
            ctx2.shadowOffsetY = 2;
            const grad = ctx2.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
            if (color === 1) {
                grad.addColorStop(0, '#444');
                grad.addColorStop(0.6, '#222');
                grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.5, '#eee');
                grad.addColorStop(1, '#aaa');
            }
            ctx2.beginPath();
            ctx2.arc(x, y, radius, 0, 2 * Math.PI);
            ctx2.fillStyle = grad;
            ctx2.fill();
            ctx2.restore();
            if (!showNum) {
                ctx2.beginPath();
                ctx2.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                ctx2.fillStyle = color === 1 ? '#444' : '#fff';
                ctx2.fill();
            }
            if (digit > 0 && !showNum) {
                const fontPx = Math.max(10, Math.floor(radius * 0.85));
                ctx2.font = `bold ${fontPx}px Arial`;
                ctx2.textAlign = 'center';
                ctx2.textBaseline = 'middle';
                ctx2.fillStyle = color === 1 ? '#fff' : '#000';
                ctx2.shadowBlur = 0;
                ctx2.fillText(String(digit), x - radius * 0.42 + 1, y - radius * 0.42 + 1);
            }
        }

        function drawSudokuGrid(ctx2, boardSize, padding, cellSize, cs) {
            const box = boxSizeOf(boardSize);
            ctx2.strokeStyle = '#3a281c';
            for (let i = 0; i <= boardSize; i++) {
                const thick = (i % box === 0);
                ctx2.lineWidth = thick ? 2.4 : 1.1;
                const x = padding + i * cellSize;
                const y = padding + i * cellSize;
                ctx2.beginPath();
                ctx2.moveTo(x, padding);
                ctx2.lineTo(x, padding + boardSize * cellSize);
                ctx2.stroke();
                ctx2.beginPath();
                ctx2.moveTo(padding, y);
                ctx2.lineTo(padding + boardSize * cellSize, y);
                ctx2.stroke();
            }
            // coord labels at cell centers
            ctx2.font = `bold ${Math.max(10, 220 / boardSize)}px Arial`;
            ctx2.fillStyle = '#3a281c';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            for (let c = 0; c < boardSize; c++) {
                let letter = String.fromCharCode(65 + c);
                if (c >= 26) letter = String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
                const x = padding + (c + 0.5) * cellSize;
                ctx2.fillText(letter, x, padding * 0.55);
            }
            for (let r = 0; r < boardSize; r++) {
                const y = padding + (r + 0.5) * cellSize;
                ctx2.fillText(String(r + 1), padding * 0.45, y);
            }
        }

        page.drawBoard = function () {
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const padding = ps.PADDING;
            ctx.clearRect(0, 0, cs, cs);
            drawSudokuGrid(ctx, ps.BOARD_SIZE, padding, cellSize, cs);

            const stoneRadius = cellSize * 0.42;
            const markLenDefault = cellSize * 0.32;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;

            if (lowerLastMoveMarker) {
                for (const m of ps.lastMoveMarkers) {
                    const { x, y } = cellCenter(padding, cellSize, m.row, m.col);
                    ctx.beginPath();
                    ctx.moveTo(x + stoneRadius, y + stoneRadius);
                    ctx.lineTo(x, y + stoneRadius);
                    ctx.lineTo(x + stoneRadius, y);
                    ctx.closePath();
                    ctx.fillStyle = m.color === 2 ? '#222' : '#fff';
                    ctx.fill();
                }
            }

            for (let r = 0; r < ps.BOARD_SIZE; r++) {
                for (let c = 0; c < ps.BOARD_SIZE; c++) {
                    const val = ps.board[r][c];
                    if (val !== 1 && val !== 2) continue;
                    const { x, y } = cellCenter(padding, cellSize, r, c);
                    const digit = safeDigitAt(ps.digitBoard, r, c);
                    drawStoneAt(ctx, x, y, val, stoneRadius, digit, ps.showMoveNumbers);
                }
            }

            if (!lowerLastMoveMarker) {
                for (const m of ps.lastMoveMarkers) {
                    const { x, y } = cellCenter(padding, cellSize, m.row, m.col);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + markLenDefault, y);
                    ctx.lineTo(x, y + markLenDefault);
                    ctx.closePath();
                    ctx.fillStyle = m.color === 2 ? '#222' : '#fff';
                    ctx.fill();
                }
            }

            // user marks
            for (const key of Object.keys(ps.userBoardMarks)) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) continue;
                if (page.isUserBoardMarkVisibleAt && !page.isUserBoardMarkVisibleAt(r, c)) continue;
                const ch = ps.userBoardMarks[key];
                const { x, y } = cellCenter(padding, cellSize, r, c);
                ctx.beginPath();
                ctx.arc(x, y, cellSize * 0.28, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
                ctx.fill();
                ctx.font = `bold ${cellSize * 0.55}px "Segoe UI",sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }

            if (ps.showMoveNumbers && page.computeStoneNumbers) {
                const nums = page.computeStoneNumbers();
                for (let r = 0; r < ps.BOARD_SIZE; r++) {
                    for (let c = 0; c < ps.BOARD_SIZE; c++) {
                        if (!nums[r] || !nums[r][c]) continue;
                        const { x, y } = cellCenter(padding, cellSize, r, c);
                        ctx.font = `bold ${cellSize * 0.32}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = ps.board[r][c] === 1 ? '#fff' : '#000';
                        ctx.fillText(String(nums[r][c]), x, y);
                    }
                }
            }

            if (ps.hoverRow >= 0 && ps.hoverCol >= 0 && ps.isHoverValid) {
                const canHover = ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn);
                if (canHover && ps.board[ps.hoverRow][ps.hoverCol] === 0) {
                    const { x, y } = cellCenter(padding, cellSize, ps.hoverRow, ps.hoverCol);
                    const hoverColor = ps.tryPlayMode
                        ? (ps.tryPlayCurrentPlayer === 1 ? '#222' : '#ddd')
                        : (ps.mySlot === 'black' ? '#222' : '#ddd');
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(x, y, stoneRadius, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    if (ps.selectedDigit > 0) {
                        const fontPx = Math.max(10, Math.floor(stoneRadius * 0.85));
                        ctx.font = `bold ${fontPx}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = (ps.tryPlayMode ? ps.tryPlayCurrentPlayer === 1 : ps.mySlot !== 'white')
                            ? '#fff' : '#000';
                        ctx.fillText(
                            String(ps.selectedDigit),
                            x - stoneRadius * 0.42 + 1,
                            y - stoneRadius * 0.42 + 1
                        );
                    }
                    ctx.globalAlpha = 1;
                }
            }

            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                const ox = padding + cellSize * 0.5;
                QiSquareWeiqiCanvas.draw.estimateOverlay(
                    ctx, ps.board, ps.BOARD_SIZE, ox, cellSize, ps.cachedLiveBoard, ps.cachedTerritory
                );
            }
        };

        const origExitReplayMode = page.exitReplayMode;
        page.exitReplayMode = function () {
            origExitReplayMode();
            ps.replayDigitBoards = [];
            ps.replayBlackBags = [];
            ps.replayWhiteBags = [];
        };

        page.enterReplayMode = function (data) {
            const built = buildReplaySnapshots(
                data.moves || [],
                ps.BOARD_SIZE,
                data.initialPosition,
                data.initialDigits
            );
            ps.replayBoards = built.boards;
            ps.replayDigitBoards = built.digitBoards;
            ps.replayBlackBags = built.blackBags;
            ps.replayWhiteBags = built.whiteBags;
            ps.replayMarkers = built.markers;
            ps.replayStepPlayers = built.players;
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
            ps.digitBoard = deepCopy2d(ps.replayDigitBoards[step]);
            ps.blackBagAvail = copyBagAvail(ps.replayBlackBags[step]);
            ps.whiteBagAvail = copyBagAvail(ps.replayWhiteBags[step]);
            ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
            const slider = document.getElementById('replaySlider');
            if (slider) slider.value = step;
            const stepDisp = document.getElementById('replayStepDisplay');
            if (stepDisp) stepDisp.textContent = `${step} / ${ps.replayTotalSteps}`;
            renderBags();
            page.drawBoard();
            page.updateReplayUI();
        };

        function syncLiveViewDigitsAndBag() {
            if (!ps.liveReplayBoards.length) {
                return;
            }
            const step = ps.liveViewStep;
            if (ps.liveReplayDigitBoards && step >= 0 && step < ps.liveReplayDigitBoards.length) {
                ps.digitBoard = deepCopy2d(ps.liveReplayDigitBoards[step]);
            }
            if (ps.liveReplayBlackBags && step >= 0 && step < ps.liveReplayBlackBags.length) {
                ps.blackBagAvail = copyBagAvail(ps.liveReplayBlackBags[step]);
            }
            if (ps.liveReplayWhiteBags && step >= 0 && step < ps.liveReplayWhiteBags.length) {
                ps.whiteBagAvail = copyBagAvail(ps.liveReplayWhiteBags[step]);
            }
        }

        const origApplyLiveViewBoard = page.applyLiveViewBoard;
        page.applyLiveViewBoard = function () {
            origApplyLiveViewBoard();
            syncLiveViewDigitsAndBag();
            renderBags();
        };

        const origSetLiveViewStep = page.setLiveViewStep;
        page.setLiveViewStep = function (step) {
            origSetLiveViewStep(step);
            if (ps.replayMode) return;
            syncLiveViewDigitsAndBag();
            renderBags();
            if (ps.showEstimateActive) page.showEstimate();
            else page.drawBoard();
        };

        const origSyncState = page.syncState;
        page.syncState = function (state) {
            const wasMyTurn = ps.isMyTurn;
            const incomingSize = Number.isInteger(state.boardSize) ? state.boardSize : ps.BOARD_SIZE;
            if (incomingSize !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = incomingSize;
                page.updateBoardGeometry();
            }
            ps.digitBoard = normalizeDigitBoard(state.digitBoard || ps.digitBoard, incomingSize);
            ps.blackBagAvail = normalizeBagAvail(state.blackBagAvail || ps.blackBagAvail, incomingSize);
            ps.whiteBagAvail = normalizeBagAvail(state.whiteBagAvail || ps.whiteBagAvail, incomingSize);
            origSyncState(state);
            if (ps.replayMode) {
                ps.digitBoard = normalizeDigitBoard(state.digitBoard || ps.digitBoard, ps.BOARD_SIZE);
                ps.blackBagAvail = normalizeBagAvail(state.blackBagAvail || ps.blackBagAvail, ps.BOARD_SIZE);
                ps.whiteBagAvail = normalizeBagAvail(state.whiteBagAvail || ps.whiteBagAvail, ps.BOARD_SIZE);
            } else {
                syncLiveViewDigitsAndBag();
                if (ps.liveFollowLatest || !ps.liveReplayBoards.length) {
                    ps.digitBoard = normalizeDigitBoard(state.digitBoard || ps.digitBoard, ps.BOARD_SIZE);
                    ps.blackBagAvail = normalizeBagAvail(state.blackBagAvail || ps.blackBagAvail, ps.BOARD_SIZE);
                    ps.whiteBagAvail = normalizeBagAvail(state.whiteBagAvail || ps.whiteBagAvail, ps.BOARD_SIZE);
                }
            }
            if (!wasMyTurn && ps.isMyTurn && ps.mySlot) ensureSelectedDigitAvailable();
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
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        function getClosestIntersection(x, y) {
            return hitCell(x, y);
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
                ps.digitBoard = emptyDigitBoard(ps.BOARD_SIZE);
                ps.blackBagAvail = initialBagAvail(ps.BOARD_SIZE);
                ps.whiteBagAvail = initialBagAvail(ps.BOARD_SIZE);
                ps.selectedDigit = 1;
                renderBags();
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

        const baseHandleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function handleMessage(msg) {
            if (msg && msg.type === 'broadcast' && msg.action === 'invalidSudoku') {
                // 通用 weiqi 广播列表未包含此 action，需自行同步局面
                if (Array.isArray(msg.moveCoords)) {
                    rebuildLiveReplayFromMoveCoords(msg.moveCoords);
                }
                syncState(msg);
                updateTurn();
                if (msg.message) qiAlert(msg.message);
                return;
            }
            const prevSlot = ps.mySlot;
            baseHandleMessage(msg);
            if (ps.mySlot !== prevSlot) renderBags();
            if (msg && msg.type === 'broadcast' && (msg.digitBoard || msg.blackBagAvail || msg.whiteBagAvail)) {
                if (msg.digitBoard) ps.digitBoard = normalizeDigitBoard(msg.digitBoard, ps.BOARD_SIZE);
                if (msg.blackBagAvail) ps.blackBagAvail = normalizeBagAvail(msg.blackBagAvail, ps.BOARD_SIZE);
                if (msg.whiteBagAvail) ps.whiteBagAvail = normalizeBagAvail(msg.whiteBagAvail, ps.BOARD_SIZE);
                if (!ps.replayMode && (ps.liveFollowLatest || !ps.liveReplayBoards.length)) {
                    renderBags();
                    drawBoard();
                }
            }
        }

        function commitMove(row, col) {
            if (ps.gameOver) return false;
            if (!ps.isMyTurn) return false;
            if (ps.board[row][col] !== 0) return false;
            if (!myBagAvail()[ps.selectedDigit]) return false;
            if (!ps.ws || ps.ws.readyState !== WebSocket.OPEN) return false;
            ps.ws.send(JSON.stringify({ type: 'move', row, col, digit: ps.selectedDigit }));
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
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
                    return;
                }
                if (ps.board[row][col] !== 0) return;
                if (!myBagAvail()[ps.selectedDigit]) return;
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
            if (!myBagAvail()[ps.selectedDigit]) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row;
                ps.hoverCol = col;
                const can = (ps.tryPlayMode && ps.replayMode)
                    || (!ps.gameOver && ps.isMyTurn && !ps.waitingScoreConfirm);
                ps.isHoverValid = !!(can && row >= 0 && col >= 0 && ps.board[row][col] === 0 && myBagAvail()[ps.selectedDigit]);
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

        page.updateBoardGeometry();
        renderBags();
        connectWebSocket(handleMessage);
        })();
    }
};
