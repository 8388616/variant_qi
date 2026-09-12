window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["halma"] = {
    shell: {
        "title": "跳达棋",
		"rulesHtml": "将所有棋子移动到对面深色三角区的格内即获胜。<br /><br />"
            + "移动的方式有两种。<strong>步行</strong>：直向或斜向走一格。<br /><br /><strong>跳行</strong>，直向或斜向跳过紧邻的一枚棋子至其后的空格，可以连跳。<br /><br />"
            + "若单步或单跳的落点是己方的目标三角，且被对方棋子所占，可以强制单步或单跳，与那枚棋子交换位置。<br /><br />"
            + "三同和棋。两虚和棋。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeValues": [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        "boardSizeMin": 8,
        "boardSizeMax": 19,
        "defaultBoardSize": 12,
        "minLib": 1,
        "recordDownloadPrefix": "跳达棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "xiangqi": true,
            "chess": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "跳达棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const DEFAULT_N = 12;

/** 三角形边长：8-11 路 4、12-15 路 5、16-17 路 6、18-19 路 7 */
function triangleSide(n) {
    if (n <= 11) return 4;
    if (n <= 15) return 5;
    if (n <= 17) return 6;
    return 7;
}

/** 每方棋子数 = 三角数 s(s+1)/2（10 / 15 / 21 / 28） */
function piecesPerSide(n) {
    const s = triangleSide(n);
    return s * (s + 1) / 2;
}

function emptyBoard(n) {
    return Array(n).fill(null).map(() => Array(n).fill(0));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function inBounds(n, r, c) {
    return r >= 0 && r < n && c >= 0 && c < n;
}

function oppositeSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function sideFromSlot(slot) {
    return slot === 'player1' ? 'white' : 'black';
}

function slotFromSide(side) {
    return side === 'white' ? 'player1' : 'player2';
}

/** 白方初始区（右下角直角三角形）：行 0 在底、列 0 在左，故白方占最下 s 行中靠右的格 */
function isWhiteHome(n, r, c) {
    const s = triangleSide(n);
    if (!inBounds(n, r, c)) return false;
    return r < s && c >= n - s && (c - r) >= n - s;
}

/** 黑方初始区（左上角）：与白方中心对称 */
function isBlackHome(n, r, c) {
    return isWhiteHome(n, n - 1 - r, n - 1 - c);
}

/** 某方的目标区 = 对方的初始区 */
function isTargetCell(n, side, r, c) {
    return side === 'white' ? isBlackHome(n, r, c) : isWhiteHome(n, r, c);
}

function pieceValue(n, side, idx) {
    return side === 'white' ? idx : piecesPerSide(n) + idx;
}

function pieceSide(v, n) {
    if (!v) return null;
    return v <= piecesPerSide(n) ? 'white' : 'black';
}

function createInitialBoard(n) {
    const b = emptyBoard(n);
    let wi = 1, bi = 1;
    for (let r = n - 1; r >= 0; r--) {
        for (let c = 0; c < n; c++) {
            if (isWhiteHome(n, r, c)) b[r][c] = pieceValue(n, 'white', wi++);
            else if (isBlackHome(n, r, c)) b[r][c] = pieceValue(n, 'black', bi++);
        }
    }
    return b;
}

const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function countPieces(board, n, side) {
    let k = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) === side) k++;
        }
    }
    return k;
}

/** 连跳搜索：8 方向跳过紧邻一枚棋子到其后空格；同一段连跳不能两次落到同一格 */
function jumpSeqsFrom(board, n, r, c, visited) {
    const out = [];
    for (const [dr, dc] of DIRS8) {
        const mr = r + dr, mc = c + dc;
        const lr = r + 2 * dr, lc = c + 2 * dc;
        if (!inBounds(n, lr, lc)) continue;
        if (board[mr][mc] === 0) continue;
        if (board[lr][lc] !== 0) continue;
        const key = lr + ',' + lc;
        if (visited[key]) continue;
        out.push([{ row: lr, col: lc }]);
        visited[key] = true;
        for (const deeper of jumpSeqsFrom(board, n, lr, lc, visited)) {
            out.push([{ row: lr, col: lc }].concat(deeper));
        }
        delete visited[key];
    }
    return out;
}

/** 某方全部合法着法（每个终点一条）：步行/单跳可落到空格或交换，连跳落点必须为空 */
function legalMoves(board, n, side) {
    const out = [];
    const seen = Object.create(null);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) !== side) continue;
            for (const [dr, dc] of DIRS8) {
                const rr = r + dr, cc = c + dc;
                if (!inBounds(n, rr, cc)) continue;
                const occupant = board[rr][cc];
                if (occupant === 0) {
                    out.push({
                        from: { row: r, col: c }, to: { row: rr, col: cc },
                        path: [{ row: rr, col: cc }], jump: false, swap: false
                    });
                } else if (pieceSide(occupant, n) !== side && isTargetCell(n, side, rr, cc)) {
                    out.push({
                        from: { row: r, col: c }, to: { row: rr, col: cc },
                        path: [{ row: rr, col: cc }], jump: false, swap: true
                    });
                }
            }
            for (const [dr, dc] of DIRS8) {
                const mr = r + dr, mc = c + dc;
                const lr = r + 2 * dr, lc = c + 2 * dc;
                if (!inBounds(n, lr, lc)) continue;
                if (board[mr][mc] === 0) continue;
                const occupant = board[lr][lc];
                if (occupant !== 0 && pieceSide(occupant, n) !== side && isTargetCell(n, side, lr, lc)) {
                    out.push({
                        from: { row: r, col: c }, to: { row: lr, col: lc },
                        path: [{ row: lr, col: lc }], jump: true, swap: true
                    });
                }
            }
            const visited = Object.create(null);
            visited[r + ',' + c] = true;
            for (const seq of jumpSeqsFrom(board, n, r, c, visited)) {
                const last = seq[seq.length - 1];
                const key = r + ',' + c + '>' + last.row + ',' + last.col;
                if (seen[key]) continue;
                seen[key] = true;
                out.push({
                    from: { row: r, col: c }, to: { row: last.row, col: last.col },
                    path: seq, jump: true, swap: false
                });
            }
        }
    }
    return out;
}

function movesFrom(board, n, side, row, col) {
    return legalMoves(board, n, side).filter((m) => m.from.row === row && m.from.col === col);
}

function applyMoveOnBoard(board, n, move) {
    const p = board[move.from.row][move.from.col];
    if (!p) return null;
    const nb = copyBoard(board);
    nb[move.from.row][move.from.col] = 0;
    const occupant = board[move.to.row][move.to.col];
    if (move.swap) {
        if (!occupant) return null;
        nb[move.from.row][move.from.col] = occupant;
    } else if (occupant !== 0) {
        return null;
    }
    nb[move.to.row][move.to.col] = p;
    return nb;
}

function findMoveTo(moves, fromRow, fromCol, toRow, toCol) {
    for (const m of moves) {
        if (m.from.row === fromRow && m.from.col === fromCol
            && m.to.row === toRow && m.to.col === toCol) return m;
    }
    return null;
}

function findMove(moves, fromRow, fromCol, path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    for (const m of moves) {
        if (m.from.row !== fromRow || m.from.col !== fromCol) continue;
        if (m.path.length !== path.length) continue;
        let ok = true;
        for (let i = 0; i < path.length; i++) {
            if (m.path[i].row !== path[i].row || m.path[i].col !== path[i].col) { ok = false; break; }
        }
        if (ok) return m;
    }
    return null;
}

/** 全部棋子都进入自家目标区即获胜 */
function hasWon(board, n, side) {
    let any = false;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (pieceSide(board[r][c], n) !== side) continue;
            any = true;
            if (!isTargetCell(n, side, r, c)) return false;
        }
    }
    return any;
}

return {
    DEFAULT_N,
    triangleSide,
    piecesPerSide,
    emptyBoard,
    copyBoard,
    inBounds,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    isWhiteHome,
    isBlackHome,
    isTargetCell,
    pieceValue,
    pieceSide,
    createInitialBoard,
    countPieces,
    legalMoves,
    movesFrom,
    applyMoveOnBoard,
    findMove,
    findMoveTo,
    hasWon
};
})();

        const SLOT_UI = {
            player2: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' },
            player1: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' }
        };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const PAD = 0.6;
        const LOGICAL_SIZE = 560;
        function applyHiDpiCanvas(redraw) {
            if (typeof QiWeiqiSquarePageRuntime === 'undefined' || !QiWeiqiSquarePageRuntime.setupHiDpiCanvas) return;
            QiWeiqiSquarePageRuntime.setupHiDpiCanvas(canvas, LOGICAL_SIZE);
            if (redraw) drawBoard();
        }
        applyHiDpiCanvas(false);
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            window.requestAnimationFrame(() => applyHiDpiCanvas(true));
        }
        window.addEventListener('resize', () => applyHiDpiCanvas(true));
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const START_SIZE = R.DEFAULT_N;
        const ps = {
            board: R.createInitialBoard(START_SIZE),
            boardSize: START_SIZE,
            initialBoard: null,
            sideToMove: 'white',
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            gameStarted: false,
            winner: null,
            lastMove: null,
            ws: null,
            isMyTurn: false,
            slots: { player2: false, player1: false },
            reconnectTimer: null,
            replayMode: false,
            tryPlayMode: false,
            matchStarted: false,
            matchTime: null,
            selectedRow: -1,
            selectedCol: -1,
            legalTargets: [],
            swapTargets: [],
            candidateMoves: [],
            moveHistory: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            liveSnapshots: [],
            replaySnapshots: [],
            replayStep: 0,
            replayTotalSteps: 0,
            tryPlayBaseStep: 0,
            tryPlaySnapshots: [],
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            tryPlaySide: 'white',
            recordResultText: null,
            waitingScoreConfirm: false,
            iRejected: false,
            pendingMoveMsg: null
        };

        let cellSize = 0, offsetX = 0, offsetY = 0;

        function sideOfSlot(slot) { return R.sideFromSlot(slot); }
        function slotOfSide(side) { return R.slotFromSide(side); }
        function boardSize() { return ps.boardSize || R.DEFAULT_N; }

        function boardFlipped() {
            return ps.mySlot === 'player2';
        }

        function toDisplayCoord(row, col) {
            const n = boardSize();
            let r = row, c = col;
            if (boardFlipped()) { r = n - 1 - r; c = n - 1 - c; }
            return { row: n - 1 - r, col: c };
        }

        function toOriginalCoord(dispRow, dispCol) {
            const n = boardSize();
            let r = n - 1 - dispRow, c = dispCol;
            if (boardFlipped()) { r = n - 1 - r; c = n - 1 - c; }
            return { row: r, col: c };
        }

        function calcGeometry() {
            const n = boardSize();
            const units = n + 2 * PAD;
            cellSize = Math.min(LOGICAL_SIZE / units, LOGICAL_SIZE / units);
            offsetX = (LOGICAL_SIZE - n * cellSize) / 2;
            offsetY = (LOGICAL_SIZE - n * cellSize) / 2;
        }

        function squareCenter(dispRow, dispCol) {
            return {
                x: offsetX + (dispCol + 0.5) * cellSize,
                y: offsetY + (dispRow + 0.5) * cellSize
            };
        }

        function drawCoordinatesOn(g) {
            const n = boardSize();
            const files = [];
            for (let i = 0; i < n; i++) files.push(String.fromCharCode(65 + i));
            if (boardFlipped()) files.reverse();
            const ranks = [];
            for (let i = 0; i < n; i++) ranks.push(String(n - i));
            if (boardFlipped()) ranks.reverse();
            g.fillStyle = '#5a3a1e';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.font = `bold ${cellSize * 0.375}px Arial`;
            for (let c = 0; c < n; c++) {
                const x = offsetX + (c + 0.5) * cellSize;
                g.fillText(files[c], x, 0.6 * offsetY);
                g.fillText(files[c], x, offsetY + n * cellSize + 0.6 * offsetY);
            }
            for (let r = 0; r < n; r++) {
                const y = offsetY + (r + 0.5) * cellSize;
                g.fillText(ranks[r], 0.5 * offsetX, y);
            }
            for (let r = 0; r < n; r++) {
                const y = offsetY + (r + 0.5) * cellSize;
                g.fillText(ranks[r], offsetX + n * cellSize + 0.5 * offsetX, y);
            }
        }

        /** 选中棋子后给出候选：普通终点（空格）与可强制交换的对方棋子 */
        function refreshLegalTargets() {
            ps.legalTargets = [];
            ps.swapTargets = [];
            ps.candidateMoves = [];
            if (ps.selectedRow < 0) return;
            const n = boardSize();
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const moves = R.movesFrom(ps.board, n, side, ps.selectedRow, ps.selectedCol);
            ps.candidateMoves = moves;
            const seenTo = {}, seenSwap = {};
            for (const m of moves) {
                const k = m.to.row + ',' + m.to.col;
                if (m.swap) {
                    if (seenSwap[k]) continue;
                    seenSwap[k] = true;
                    ps.swapTargets.push({ row: m.to.row, col: m.to.col });
                    continue;
                }
                if (seenTo[k]) continue;
                seenTo[k] = true;
                ps.legalTargets.push({ row: m.to.row, col: m.to.col });
            }
        }

        function clearSelection() {
            ps.selectedRow = -1;
            ps.selectedCol = -1;
            ps.legalTargets = [];
            ps.swapTargets = [];
            ps.candidateMoves = [];
        }

        /** 棋子贴图缓存：阴影 + 径向渐变很贵，逐子重画时 19 路明显卡顿 */
        const pieceSprites = {};
        let boardLayer = null;

        function canvasScale() {
            return (canvas.width / LOGICAL_SIZE) || 1;
        }

        function pieceSprite(piece) {
            const isWhite = R.pieceSide(piece, boardSize()) === 'white';
            const scale = canvasScale();
            const key = (isWhite ? 'w' : 'b') + '|' + cellSize.toFixed(2) + '|' + scale.toFixed(3);
            const hit = pieceSprites[key];
            if (hit) return hit;
            const radius = cellSize * 0.42;
            const pad = radius * 0.9;
            const size = radius * 2 + pad * 2;
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.ceil(size * scale));
            cv.height = Math.max(1, Math.ceil(size * scale));
            const g = cv.getContext('2d');
            g.scale(scale, scale);
            const cx = radius + pad;
            const cy = radius + pad;
            const glossOffset = radius * 0.35;
            g.save();
            g.shadowBlur = radius * 0.4;
            g.shadowColor = 'rgba(0,0,0,0.5)';
            g.shadowOffsetY = radius * 0.14;
            const grad = g.createRadialGradient(cx - glossOffset, cy - glossOffset, radius * 0.2, cx, cy, radius * 1.2);
            if (isWhite) {
                grad.addColorStop(0, '#fff');
                grad.addColorStop(0.5, '#eee');
                grad.addColorStop(1, '#aaa');
            } else {
                grad.addColorStop(0, '#444');
                grad.addColorStop(0.6, '#222');
                grad.addColorStop(1, '#111');
            }
            g.beginPath();
            g.arc(cx, cy, radius, 0, 2 * Math.PI);
            g.fillStyle = grad;
            g.fill();
            g.restore();
            g.beginPath();
            g.arc(cx - glossOffset, cy - glossOffset, radius * 0.15, 0, 2 * Math.PI);
            g.fillStyle = isWhite ? '#fff' : '#444';
            g.fill();
            const sprite = { canvas: cv, size, half: radius + pad };
            pieceSprites[key] = sprite;
            return sprite;
        }

        function drawPiece(x, y, piece) {
            const s = pieceSprite(piece);
            ctx2d.drawImage(s.canvas, x - s.half, y - s.half, s.size, s.size);
        }

        /** 棋盘底图（纯色底 + 格线 + 双方初始区深色 + 坐标，同结子棋的画法）缓存 */
        function boardLayerCanvas() {
            const n = boardSize();
            const scale = canvasScale();
            const key = n + '|' + (boardFlipped() ? 1 : 0) + '|' + scale.toFixed(3);
            if (boardLayer && boardLayer.key === key) return boardLayer.canvas;
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, canvas.width);
            cv.height = Math.max(1, canvas.height);
            const g = cv.getContext('2d');
            g.scale(scale, scale);
            // 底色由 canvas 的 CSS 背景提供（公共木纹），此处不铺满色块：只有双方初始区（对方的目标区）涂深色
            g.fillStyle = 'rgba(224,160,112,0.8)';
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (!R.isWhiteHome(n, r, c) && !R.isBlackHome(n, r, c)) continue;
                    const d = toDisplayCoord(r, c);
                    g.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }
            // 格线（同结子棋：纯色格子 + 格线）
            g.strokeStyle = '#3a281c';
            g.lineWidth = 1.5;
            for (let i = 0; i <= n; i++) {
                const x = offsetX + i * cellSize;
                const y = offsetY + i * cellSize;
                g.beginPath();
                g.moveTo(x, offsetY);
                g.lineTo(x, offsetY + n * cellSize);
                g.stroke();
                g.beginPath();
                g.moveTo(offsetX, y);
                g.lineTo(offsetX + n * cellSize, y);
                g.stroke();
            }
            g.lineWidth = 2;
            g.strokeRect(offsetX, offsetY, n * cellSize, n * cellSize);
            drawCoordinatesOn(g);
            boardLayer = { key, canvas: cv };
            return cv;
        }

        function drawBoard() {
            calcGeometry();
            const n = boardSize();
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
            ctx2d.drawImage(boardLayerCanvas(), 0, 0, LOGICAL_SIZE, LOGICAL_SIZE);

            // 上一手：起点 + 整条跳跃路线淡黄（交换时落点也标出来）
            const lm = ps.lastMove;
            if (lm && lm.fromRow != null) {
                const marks = [{ row: lm.fromRow, col: lm.fromCol }].concat(lm.path || []);
                for (const p of marks) {
                    if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col)) continue;
                    const d = toDisplayCoord(p.row, p.col);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }

            // 候选：空格终点用小方块（按行棋方黑白着色）；可交换的对方棋子用方框（同国际象棋的吃子候选框）
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            if (ps.legalTargets.length) {
                const half = cellSize * 0.12;
                ctx2d.fillStyle = side === 'white' ? '#ffffff' : '#111111';
                for (const t of ps.legalTargets) {
                    const d = toDisplayCoord(t.row, t.col);
                    const { x, y } = squareCenter(d.row, d.col);
                    ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
                }
            }
            if (ps.swapTargets.length) {
                for (const t of ps.swapTargets) {
                    const d = toDisplayCoord(t.row, t.col);
                    const { x, y } = squareCenter(d.row, d.col);
                    const half = cellSize * 0.38;
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = Math.max(2, cellSize * 0.14);
                    ctx2d.strokeRect(x - half, y - half, half * 2, half * 2);
                }
            }

            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const piece = ps.board[r][c];
                    if (!piece) continue;
                    const d = toDisplayCoord(r, c);
                    const { x, y } = squareCenter(d.row, d.col);
                    drawPiece(x, y, piece);
                }
            }

            if (ps.selectedRow >= 0) {
                const d = toDisplayCoord(ps.selectedRow, ps.selectedCol);
                ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                ctx2d.lineWidth = 2;
                ctx2d.strokeRect(
                    offsetX + d.col * cellSize + 2,
                    offsetY + d.row * cellSize + 2,
                    cellSize - 4,
                    cellSize - 4
                );
            }
        }

        function turnLabel(side) {
            return side === 'white' ? '⚪ 白方行棋' : '⚫ 黑方行棋';
        }

        function updateTurn() {
            syncSizeSelect();
            if (ps.gameOver) {
                let text = '';
                if (ps.winner === 'draw') text = '和棋';
                else if (ps.winner === 'player2') text = '⚫ 黑方胜';
                else if (ps.winner === 'player1') text = '⚪ 白方胜';
                if (ps.recordResultText) text = ps.recordResultText;
                turnDisplay.innerText = '对局结束';
                scoreTitle.innerText = text || '　';   // 结果放这里（与围棋一致）
                scoreBoard.innerText = '　';
                leadInfo.innerText = '　';
                return;
            }
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (!matchStarted && !ps.tryPlayMode && !ps.replayMode) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                return;
            }
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            if (!ps.tryPlayMode && !ps.replayMode) {
                const moverLabel = side === 'white' ? '⚫' : '⚪';
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.roundTurnText(ps.moveHistory.length, moverLabel);
            } else {
                turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + turnLabel(side);
            }
        }

        function normalizeMoveEntry(m) {
            if (!m) return null;
            if (m.pass || m.type === 'pass') {
                return { pass: true, player: m.player, path: [] };
            }
            const path = (m.path || []).map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col }));
            return {
                pass: false,
                player: m.player,
                fromRow: m.fromRow,
                fromCol: m.fromCol,
                toRow: m.toRow != null ? m.toRow : (path.length ? path[path.length - 1].row : m.fromRow),
                toCol: m.toCol != null ? m.toCol : (path.length ? path[path.length - 1].col : m.fromCol),
                path,
                jump: !!m.jump,
                swap: !!m.swap,
                piece: m.piece || 0
            };
        }

        /** 观战者改路数：仅无人入座、未开局、无着法时可见 */
        function syncSizeSelect() {
            const sel = document.getElementById('boardSizeSelect');
            if (!sel) return;
            const canChange = !ps.gameOver && !ps.mySlot && !ps.replayMode && !ps.tryPlayMode
                && !(ps.slots && (ps.slots.player2 || ps.slots.player1))
                && !ps.moveHistory.length;
            sel.style.display = canChange ? 'inline-block' : 'none';
        }

        function applyBoardSize(n) {
            if (!Number.isInteger(n) || n === ps.boardSize) return;
            ps.boardSize = n;
            ps.initialBoard = null;
            ps.board = R.createInitialBoard(n);
            clearSelection();
            rebuildLiveSnapshots();
            syncSizeSelect();
            drawBoard();
        }

        function syncState(state) {
            if (!state) return;
            if (state.boardSize && state.boardSize !== ps.boardSize) {
                ps.boardSize = state.boardSize;
                if (state.board) ps.board = R.copyBoard(state.board);
                clearSelection();
            } else if (state.board) {
                ps.board = R.copyBoard(state.board);
            }
            ps.initialBoard = state.initialBoard && state.initialBoard.length === ps.boardSize
                ? state.initialBoard.map((row) => row.slice())
                : null;
            if (state.sideToMove) {
                ps.sideToMove = state.sideToMove;
                ps.currentPlayer = state.sideToMove === 'white' ? 1 : 2;
            } else if (state.currentPlayer) {
                ps.currentPlayer = state.currentPlayer;
                ps.sideToMove = state.currentPlayer === 1 ? 'white' : 'black';
            }
            ps.gameOver = !!state.gameOver;
            ps.winner = state.winner != null ? state.winner : null;
            ps.lastMove = state.lastMove ? normalizeMoveEntry(state.lastMove) : null;
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) ps.moveHistory = state.moveHistory.map(normalizeMoveEntry);
            else if (state.moveCoords) ps.moveHistory = state.moveCoords.map(normalizeMoveEntry);
            if (state.recordResultText) ps.recordResultText = state.recordResultText;
            rebuildLiveSnapshots();
            if (!ps.replayMode && !ps.tryPlayMode && ps.liveFollowLatest) {
                ps.liveViewStep = Math.max(0, ps.liveSnapshots.length - 1);
            }
            clearSelection();
            updateIsMyTurn();
            updateTurn();
            drawBoard();
            updateReplayUI();
        }

        function updateIsMyTurn() {
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (ps.gameOver || ps.replayMode || ps.tryPlayMode || !matchStarted || !ps.mySlot) {
                ps.isMyTurn = false;
            } else {
                ps.isMyTurn = ps.mySlot === slotOfSide(ps.sideToMove);
            }
            updateMatchControlButtons();
        }

        function updateMatchControlButtons() {
            const isPlayer = !!ps.mySlot;
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            const showMatch = isPlayer && matchStarted && !ps.replayMode;
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = showMatch ? '' : 'none';
            });
            const passBtn = document.getElementById('passBtn');
            if (passBtn) passBtn.style.display = (showMatch && ps.isMyTurn && !ps.gameOver) ? '' : 'none';
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) {
                tryPlayBtn.style.display = showMatch ? 'none' : '';
                tryPlayBtn.textContent = ps.tryPlayMode ? '试下结束' : '试下';
            }
            updateRecordButtons();
        }

        function snapshotFrom(board, side, lastMove) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                lastMove: lastMove ? normalizeMoveEntry(lastMove) : null,
                lastFrom: lastMove && !lastMove.pass ? { row: lastMove.fromRow, col: lastMove.fromCol } : null,
                lastTo: lastMove && !lastMove.pass ? { row: lastMove.toRow, col: lastMove.toCol } : null
            };
        }

        function openingBoard() {
            return ps.initialBoard && ps.initialBoard.length === ps.boardSize
                ? R.copyBoard(ps.initialBoard)
                : R.createInitialBoard(ps.boardSize);
        }

        /** 棋谱字符串 → 对象（B3,2>5,4 / B*3,2>5,4 交换 / Bp 虚着） */
        function parseMoveString(raw) {
            if (typeof raw !== 'string') return raw;
            const s = raw.trim();
            const mp = s.match(/^([WB])p$/i);
            if (mp) return { player: mp[1].toUpperCase() === 'B' ? 'player2' : 'player1', pass: true };
            const mt = s.match(/^([WB])(\*?)((?:\d+,\d+)(?:>\d+,\d+)*)$/i);
            if (!mt) return null;
            const pts = mt[3].split('>').map((x) => x.split(',').map(Number));
            return {
                player: mt[1].toUpperCase() === 'B' ? 'player2' : 'player1',
                swap: mt[2] === '*',
                fromRow: pts[0][0],
                fromCol: pts[0][1],
                toRow: pts[pts.length - 1][0],
                toCol: pts[pts.length - 1][1],
                path: pts.slice(1).map((p) => ({ row: p[0], col: p[1] }))
            };
        }

        /** 按着法表重建逐手快照（含虚着：棋盘不变、只交换行棋方） */
        function buildSnapshots(startBoard, rawMoves, n) {
            let b = startBoard.map((row) => row.slice());
            let side = 'white';
            const snaps = [snapshotFrom(b, side, null)];
            for (const raw of rawMoves) {
                const m = normalizeMoveEntry(typeof raw === 'string' ? parseMoveString(raw) : raw);
                if (!m) break;
                if (m.pass) {
                    side = R.oppositeSide(side);
                    snaps.push(snapshotFrom(b, side, null));
                    continue;
                }
                const mv = R.findMoveTo(R.legalMoves(b, n, side), m.fromRow, m.fromCol, m.toRow, m.toCol);
                if (!mv) break;
                b = R.applyMoveOnBoard(b, n, mv);
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, {
                    player: m.player, fromRow: m.fromRow, fromCol: m.fromCol,
                    toRow: mv.to.row, toCol: mv.to.col,
                    path: mv.path, jump: mv.jump, swap: mv.swap, piece: m.piece
                }));
            }
            return snaps;
        }

        function rebuildLiveSnapshots() {
            ps.liveSnapshots = buildSnapshots(openingBoard(), ps.moveHistory, ps.boardSize);
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'white' ? 1 : 2;
            if (!s.lastFrom && !s.lastTo) {
                ps.lastMove = null;
            } else if (s.lastMove) {
                ps.lastMove = normalizeMoveEntry(s.lastMove);
            } else {
                ps.lastMove = normalizeMoveEntry({
                    fromRow: s.lastFrom.row, fromCol: s.lastFrom.col,
                    toRow: s.lastTo.row, toCol: s.lastTo.col,
                    path: [{ row: s.lastTo.row, col: s.lastTo.col }]
                });
            }
            clearSelection();
            updateTurn();
            drawBoard();
        }

        function setLiveViewStep(step) {
            if (!ps.liveSnapshots.length) return;
            const max = ps.liveSnapshots.length - 1;
            step = Math.max(0, Math.min(max, step));
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= max;
            if (!ps.replayMode && !ps.tryPlayMode) applySnapshot(ps.liveSnapshots[step]);
            updateReplayUI();
        }

        function updateReplayUI() {
            const slider = document.getElementById('replaySlider');
            const stepDisp = document.getElementById('replayStepDisplay');
            let total = 0, cur = 0;
            if (ps.tryPlayMode) {
                total = ps.tryPlayTotalSteps;
                cur = ps.tryPlayStep;
            } else if (ps.replayMode) {
                total = ps.replayTotalSteps;
                cur = ps.replayStep;
            } else {
                total = Math.max(0, ps.liveSnapshots.length - 1);
                cur = ps.liveViewStep;
            }
            if (slider) { slider.max = total; slider.value = cur; }
            if (stepDisp) stepDisp.textContent = `${cur} / ${total}`;
            updateMatchControlButtons();
        }

        function downloadRecord(data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${recordDownloadPrefix}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function enterReplayMode(data) {
            const n = (data && data.boardSize) || ps.boardSize;
            ps.boardSize = n;
            const rawMoves = (data && data.moves) || [];
            const startBoard = (data && data.initialBoard && data.initialBoard.length === n)
                ? data.initialBoard.map((row) => row.slice())
                : R.createInitialBoard(n);
            const snaps = buildSnapshots(startBoard, rawMoves, n);
            ps.replaySnapshots = snaps;
            ps.replayTotalSteps = snaps.length - 1;
            ps.replayMode = true;
            ps.tryPlayMode = false;
            setReplayStep(ps.replayTotalSteps);
            document.getElementById('tryPlayBtn').textContent = '试下';
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }

        function exitReplayMode() {
            ps.replayMode = false;
            ps.tryPlayMode = false;
            clearSelection();
            document.getElementById('tryPlayBtn').textContent = '试下';
            if (ps.liveSnapshots.length) setLiveViewStep(ps.liveSnapshots.length - 1);
            else {
                ps.board = openingBoard();
                ps.sideToMove = 'white';
                ps.lastMove = null;
                updateTurn();
                drawBoard();
            }
        }

        function setReplayStep(step) {
            step = Math.max(0, Math.min(ps.replayTotalSteps, step));
            ps.replayStep = step;
            applySnapshot(ps.replaySnapshots[step]);
            updateReplayUI();
        }

        function enterTryPlay() {
            if (!ps.replayMode) {
                rebuildLiveSnapshots();
                ps.tryPlayBaseStep = ps.liveViewStep;
                const base = ps.liveSnapshots[ps.liveViewStep];
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.lastMove)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.lastMove)];
            }
            ps.tryPlayMode = true;
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            ps.tryPlaySide = ps.tryPlaySnapshots[0].sideToMove;
            applySnapshot(ps.tryPlaySnapshots[0]);
            document.getElementById('tryPlayBtn').textContent = '退出试下';
            updateReplayUI();
        }

        function exitTryPlay() {
            ps.tryPlayMode = false;
            clearSelection();
            document.getElementById('tryPlayBtn').textContent = '试下';
            if (ps.replayMode) setReplayStep(ps.tryPlayBaseStep);
            else setLiveViewStep(ps.tryPlayBaseStep);
        }

        function setTryPlayStep(step) {
            step = Math.max(0, Math.min(ps.tryPlayTotalSteps, step));
            ps.tryPlayStep = step;
            const s = ps.tryPlaySnapshots[step];
            ps.tryPlaySide = s.sideToMove;
            applySnapshot(s);
            updateReplayUI();
        }

        function tryPlayMove(fromRow, fromCol, toRow, toCol) {
            const side = ps.tryPlaySide;
            const n = boardSize();
            const mv = R.findMoveTo(R.legalMoves(ps.board, n, side), fromRow, fromCol, toRow, toCol);
            if (!mv) return false;
            const nb = R.applyMoveOnBoard(ps.board, n, mv);
            if (!nb) return false;
            const nextSide = R.oppositeSide(side);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(nb, nextSide, {
                player: R.slotFromSide(side), fromRow, fromCol, toRow: mv.to.row, toCol: mv.to.col,
                path: mv.path, jump: mv.jump, swap: mv.swap
            }));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = nextSide;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(fromRow, fromCol, toRow, toCol) {
            const msg = JSON.stringify({ type: 'move', fromRow, fromCol, toRow, toCol });
            if (!ps.ws || ps.ws.readyState !== 1) {
                ps.pendingMoveMsg = msg;
                return;
            }
            ps.ws.send(msg);
        }

        function getRowColFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = LOGICAL_SIZE / rect.width;
            const scaleY = LOGICAL_SIZE / rect.height;
            const canvasX = (clientX - rect.left) * scaleX;
            const canvasY = (clientY - rect.top) * scaleY;
            const dispCol = Math.floor((canvasX - offsetX) / cellSize);
            const dispRow = Math.floor((canvasY - offsetY) / cellSize);
            if (dispRow < 0 || dispRow >= boardSize() || dispCol < 0 || dispCol >= boardSize()) {
                return { row: -1, col: -1 };
            }
            return toOriginalCoord(dispRow, dispCol);
        }

        function playMove(mv) {
            if (ps.tryPlayMode) tryPlayMove(mv.from.row, mv.from.col, mv.to.row, mv.to.col);
            else commitMove(mv.from.row, mv.from.col, mv.to.row, mv.to.col);
        }

        function handleBoardClick(clientX, clientY) {
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { row, col } = getRowColFromClient(clientX, clientY);
            if (row < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const n = boardSize();
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;

            if (ps.selectedRow < 0) {
                if (R.pieceSide(ps.board[row][col], n) === side) {
                    ps.selectedRow = row;
                    ps.selectedCol = col;
                    refreshLegalTargets();
                    drawBoard();
                }
                return;
            }

            if (row === ps.selectedRow && col === ps.selectedCol) {
                clearSelection();
                drawBoard();
                return;
            }

            // 点要交换的对方棋子 → 强制交换（单步或单跳）
            const swapHit = ps.swapTargets.some((t) => t.row === row && t.col === col);
            if (swapHit) {
                const mv = ps.candidateMoves.find((m) => m.swap && m.to.row === row && m.to.col === col);
                if (mv) playMove(mv);
                clearSelection();
                drawBoard();
                return;
            }

            // 点空格终点 → 整手走完（连跳一步到位）
            const hit = ps.legalTargets.some((t) => t.row === row && t.col === col);
            if (hit) {
                const mv = ps.candidateMoves.find((m) => !m.swap && m.to.row === row && m.to.col === col);
                if (mv) playMove(mv);
                clearSelection();
                drawBoard();
                return;
            }

            const p = ps.board[row][col];
            if (R.pieceSide(p, n) === side) {
                ps.selectedRow = row;
                ps.selectedCol = col;
                refreshLegalTargets();
                drawBoard();
            }
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            slotUi: SLOT_UI,
            roomId,
            gameType,
            pageState: ps,
            tryPlayOppositeSide: (side) => R.oppositeSide(side),
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ps.ws,
            getBoardSize: () => ps.boardSize,
            getTotalPoints: () => ps.boardSize * ps.boardSize,
            timeControlMainCoef: 0.05,
            setBoardSize: (n) => applyBoardSize(n),
            getKomi: () => 0,
            setKomi: () => {},
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
            getShowEstimateActive: () => false,
            setShowEstimateActive: () => {},
            getWaitingScoreConfirm: () => false,
            setWaitingScoreConfirm: () => {},
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
            syncState: (state) => {
                if (state) {
                    ps.gameStarted = (state.numberOfHands || 1) > 1 || !!state.matchStarted;
                }
                syncState(state);
            },
            updateBoardGeometry: () => {},
            onBoardSizeChanged: (msg) => syncState(msg),
            initBoardArray: () => R.createInitialBoard(ps.boardSize),
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview: () => {},
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            updateTryPlayDisplay: () => updateReplayUI(),
            showScoreConfirm: () => {},
            isMouseDevice,
            onSeatOverlayUpdated() { drawBoard(); }
        });

        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;

        function connectWebSocket() {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const url = `${proto}://${location.host}/qi/ws?game=${encodeURIComponent(gameType)}&room=${encodeURIComponent(roomId)}`;
            const ws = new WebSocket(url);
            ps.ws = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', password: roomPassword || '' }));
                if (ps.pendingMoveMsg) {
                    const m = ps.pendingMoveMsg;
                    ps.pendingMoveMsg = null;
                    ws.send(m);
                }
            };
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                handleMessage(msg);
                if (msg.type === 'timeControlAgreed' || msg.type === 'colorAssigned' || msg.type === 'colorsFinalized'
                    || msg.type === 'gameState' || msg.type === 'broadcast' || msg.type === 'joined'
                    || msg.type === 'newGameStarted' || msg.type === 'roomReset') {
                    updateIsMyTurn();
                    drawBoard();
                    updateTurn();
                    updateReplayUI();
                }
                if (msg.type === 'gameRecord') downloadRecord(msg.data);
            };
            ws.onclose = () => {
                if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
                if (ps.reconnectTimer) return;
                ps.reconnectTimer = setTimeout(() => {
                    ps.reconnectTimer = null;
                    connectWebSocket();
                }, 1200);
            };
        }

        connectWebSocket();

        canvas.addEventListener('click', (e) => handleBoardClick(e.clientX, e.clientY));

        document.getElementById('tryPlayBtn').onclick = () => {
            if (ps.tryPlayMode) exitTryPlay();
            else enterTryPlay();
            updateMatchControlButtons();
        };
        document.getElementById('replayBackBtn').onclick = () => {
            if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
            else if (ps.replayMode) setReplayStep(ps.replayStep - 1);
            else setLiveViewStep(ps.liveViewStep - 1);
        };
        document.getElementById('replayForwardBtn').onclick = () => {
            if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
            else if (ps.replayMode) setReplayStep(ps.replayStep + 1);
            else setLiveViewStep(ps.liveViewStep + 1);
        };
        document.getElementById('replaySlider').addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            if (ps.tryPlayMode) setTryPlayStep(v);
            else if (ps.replayMode) setReplayStep(v);
            else setLiveViewStep(v);
        });

        document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
        document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
        document.getElementById('backToLobbyBtn').onclick = () => { location.href = '/qi'; };

        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
