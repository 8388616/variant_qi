window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["draughts"] = {
    shell: {
        "title": "国际跳棋",
        "rulesHtml": "基本规则同国际跳棋。<br /><br />"
            + "棋子分为<strong>兵</strong>和<strong>王</strong>两种。<br /><br />"
			+ "<strong>兵</strong>：向前斜走一格，或向任意方向跳吃，跳过相邻的一枚敌方棋子落在其后的第一个空格。兵停在对方底线时升变为王（仅仅经过底线不算）。<br />"
			+ "<strong>王</strong>：沿斜线走任意格数，或沿斜线上跳过一枚敌方棋子，落在其后的任意空格。<br /><br />"
			+ "有吃必吃，能吃多子时必须选择吃子最多的路线。<br /><br />"
            + "连跳中不能两次跳过同一枚敌子，被吃掉的子在整段连跳结束前仍然留在棋盘上挡路。<br /><br />"
            + "吃光对方棋子或让对方无棋可走的一方获胜。连续<strong>2.5×棋盘路数</strong>回合双方都没有吃子，也没有兵移动，或同一局面出现三次时和棋。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeValues": [8, 10, 12, 14, 16],
        "boardSizeMin": 8,
        "boardSizeMax": 16,
        "defaultBoardSize": 10,
        "minLib": 1,
        "recordDownloadPrefix": "国际跳棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "xiangqi": true,
            "chess": true
        },
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "wm", "label": "白兵", "cellValue": "wm", "color": "#222" },
            { "value": "wk", "label": "白王", "cellValue": "wk", "color": "#222" },
            { "value": "bm", "label": "黑兵", "cellValue": "bm", "color": "#222" },
            { "value": "bk", "label": "黑王", "cellValue": "bk", "color": "#222" }
        ],
        "editToolGlyphSize": 22
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "国际跳棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const DEFAULT_N = 10;

/** 深色格：左上角是浅色格 → (r+c) 为偶数的格子是深色格（棋子都放在深色格里） */
function isDarkSquare(r, c) {
    return (r + c) % 2 === 0;
}

function rowsPerSide(n) {
    return Math.floor(n / 2) - 1;
}

function emptyBoard(n) {
    return Array(n).fill(null).map(() => Array(n).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function inBounds(n, r, c) {
    return r >= 0 && r < n && c >= 0 && c < n;
}

function pieceSide(p) {
    if (!p) return null;
    return p[0] === 'w' ? 'white' : 'black';
}

function isKing(p) {
    return !!p && p[1] === 'k';
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

function manForward(side) {
    return side === 'white' ? 1 : -1;
}

function promotionRow(n, side) {
    return side === 'white' ? n - 1 : 0;
}

/** 初始局面：双方各占离自己最近的 rowsPerSide 行的深色格 */
function createInitialBoard(n) {
    const b = emptyBoard(n);
    const rows = rowsPerSide(n);
    for (let r = 0; r < n; r++) {
        let piece = null;
        if (r < rows) piece = 'wm';
        else if (r >= n - rows) piece = 'bm';
        if (!piece) continue;
        for (let c = 0; c < n; c++) {
            if (isDarkSquare(r, c)) b[r][c] = piece;
        }
    }
    return b;
}

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function countPieces(board, n, side) {
    const ch = side === 'white' ? 'w' : 'b';
    let k = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] && board[r][c][0] === ch) k++;
        }
    }
    return k;
}

function containsPos(list, r, c) {
    for (const p of list) {
        if (p.row === r && p.col === c) return true;
    }
    return false;
}

/** 递归搜索连吃序列（被吃子在整段连跳结束前仍留在棋盘上占位、不可再吃） */
function captureSeqsFrom(board, n, r, c, piece, side, captured) {
    const king = isKing(piece);
    const enemyCh = side === 'white' ? 'b' : 'w';
    const out = [];
    for (const [dr, dc] of DIRS) {
        if (king) {
            let rr = r + dr;
            let cc = c + dc;
            while (inBounds(n, rr, cc) && board[rr][cc] === '' && !containsPos(captured, rr, cc)) {
                rr += dr;
                cc += dc;
            }
            if (!inBounds(n, rr, cc)) continue;
            const target = board[rr][cc];
            if (!target || target[0] !== enemyCh) continue;
            if (containsPos(captured, rr, cc)) continue;
            const capPos = { row: rr, col: cc };
            let lr = rr + dr;
            let lc = cc + dc;
            while (inBounds(n, lr, lc) && board[lr][lc] === '' && !containsPos(captured, lr, lc)) {
                const nextCaptured = captured.concat([capPos]);
                const deeper = captureSeqsFrom(board, n, lr, lc, piece, side, nextCaptured);
                if (deeper.length === 0) {
                    out.push({ path: [{ row: lr, col: lc }], captures: nextCaptured });
                } else {
                    for (const seq of deeper) {
                        out.push({
                            path: [{ row: lr, col: lc }].concat(seq.path),
                            captures: seq.captures
                        });
                    }
                }
                lr += dr;
                lc += dc;
            }
        } else {
            const mr = r + dr;
            const mc = c + dc;
            const lr = r + 2 * dr;
            const lc = c + 2 * dc;
            if (!inBounds(n, lr, lc)) continue;
            const target = board[mr][mc];
            if (!target || target[0] !== enemyCh) continue;
            if (containsPos(captured, mr, mc)) continue;
            if (board[lr][lc] !== '' || containsPos(captured, lr, lc)) continue;
            const capPos = { row: mr, col: mc };
            const nextCaptured = captured.concat([capPos]);
            const deeper = captureSeqsFrom(board, n, lr, lc, piece, side, nextCaptured);
            if (deeper.length === 0) {
                out.push({ path: [{ row: lr, col: lc }], captures: nextCaptured });
            } else {
                for (const seq of deeper) {
                    out.push({
                        path: [{ row: lr, col: lc }].concat(seq.path),
                        captures: seq.captures
                    });
                }
            }
        }
    }
    return out;
}

/** 某方全部合法着法：有吃必吃、且只保留吃子最多的路线 */
function legalMoves(board, n, side) {
    const ch = side === 'white' ? 'w' : 'b';
    const captures = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            const seqs = captureSeqsFrom(board, n, r, c, p, side, []);
            for (const seq of seqs) {
                captures.push({
                    from: { row: r, col: c },
                    path: seq.path,
                    captures: seq.captures,
                    promote: !isKing(p) && seq.path[seq.path.length - 1].row === promotionRow(n, side)
                });
            }
        }
    }
    if (captures.length > 0) {
        let max = 0;
        for (const m of captures) if (m.captures.length > max) max = m.captures.length;
        return captures.filter((m) => m.captures.length === max);
    }
    const quiet = [];
    const fwd = manForward(side);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (isKing(p)) {
                for (const [dr, dc] of DIRS) {
                    let rr = r + dr;
                    let cc = c + dc;
                    while (inBounds(n, rr, cc) && board[rr][cc] === '') {
                        quiet.push({
                            from: { row: r, col: c },
                            path: [{ row: rr, col: cc }],
                            captures: [],
                            promote: false
                        });
                        rr += dr;
                        cc += dc;
                    }
                }
            } else {
                for (const dc of [-1, 1]) {
                    const rr = r + fwd;
                    const cc = c + dc;
                    if (!inBounds(n, rr, cc)) continue;
                    if (board[rr][cc] !== '') continue;
                    quiet.push({
                        from: { row: r, col: c },
                        path: [{ row: rr, col: cc }],
                        captures: [],
                        promote: rr === promotionRow(n, side)
                    });
                }
            }
        }
    }
    return quiet;
}

function hasLegalMove(board, n, side) {
    return legalMoves(board, n, side).length > 0;
}

function movesFrom(board, n, side, row, col) {
    return legalMoves(board, n, side).filter((m) => m.from.row === row && m.from.col === col);
}

function applyMoveOnBoard(board, n, move) {
    const p = board[move.from.row][move.from.col];
    if (!p) return null;
    const nb = copyBoard(board);
    nb[move.from.row][move.from.col] = '';
    for (const cap of move.captures) nb[cap.row][cap.col] = '';
    const last = move.path[move.path.length - 1];
    nb[last.row][last.col] = move.promote ? (p[0] + 'k') : p;
    return nb;
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

function positionKey(board, n, side) {
    const rows = [];
    for (let r = 0; r < n; r++) rows.push(board[r].join(','));
    return rows.join('|') + '#' + side;
}

function nextNoProgress(prev, move, movedPiece) {
    const wasMan = !!movedPiece && !isKing(movedPiece);
    if (move.captures.length > 0 || wasMan) return 0;
    return (prev || 0) + 1;
}

function noProgressLimit(n) {
    return Math.round(5 * n);
}

function judgeRepetition(historyKeys) {
    if (!historyKeys || historyKeys.length === 0) return false;
    const last = historyKeys[historyKeys.length - 1];
    let cnt = 0;
    for (const k of historyKeys) if (k === last) cnt++;
    return cnt >= 3;
}

function pieceLabel(code) {
    if (!code) return '';
    return (code[0] === 'w' ? '白' : '黑') + (code[1] === 'k' ? '王' : '兵');
}

return {
    DEFAULT_N,
    isDarkSquare,
    rowsPerSide,
    emptyBoard,
    copyBoard,
    inBounds,
    pieceSide,
    isKing,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    manForward,
    promotionRow,
    createInitialBoard,
    countPieces,
    legalMoves,
    hasLegalMove,
    movesFrom,
    applyMoveOnBoard,
    findMove,
    positionKey,
    nextNoProgress,
    noProgressLimit,
    judgeRepetition,
    pieceLabel
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
            noProgress: 0,
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
            candidateMoves: [],
            hopPath: [],
            hoverRow: -1,
            hoverCol: -1,
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

        /** 当前待走的落点提示：选中棋子后按「本次点击可落的格」给出 */
        function refreshLegalTargets() {
            ps.legalTargets = [];
            ps.candidateMoves = [];
            if (ps.selectedRow < 0) return;
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const moves = R.movesFrom(ps.board, boardSize(), side, ps.selectedRow, ps.selectedCol);
            const prefix = ps.hopPath || [];
            const cand = moves.filter((m) => {
                if (m.path.length < prefix.length) return false;
                for (let i = 0; i < prefix.length; i++) {
                    if (m.path[i].row !== prefix[i].row || m.path[i].col !== prefix[i].col) return false;
                }
                return true;
            });
            ps.candidateMoves = cand;
            const seen = {};
            for (const m of cand) {
                const nxt = m.path[prefix.length];
                if (!nxt) continue;
                const k = nxt.row + ',' + nxt.col;
                if (seen[k]) continue;
                seen[k] = true;
                ps.legalTargets.push({ row: nxt.row, col: nxt.col });
            }
        }

        function clearSelection() {
            ps.selectedRow = -1;
            ps.selectedCol = -1;
            ps.legalTargets = [];
            ps.candidateMoves = [];
            ps.hopPath = [];
        }

        /**
         * 棋子贴图缓存：阴影 + 径向渐变很贵，逐子重画时 16 路 (112 子) 明显卡顿。
         * 每种（颜色 × 兵/王 × 格子尺寸 × 像素比）只画一次小画布，之后 drawImage。
         */
        const pieceSprites = {};
        let boardLayer = null;

        function canvasScale() {
            return (canvas.width / LOGICAL_SIZE) || 1;
        }

        function pieceSprite(piece) {
            const isKing = R.isKing(piece);
            const isWhite = piece[0] === 'w';
            const scale = canvasScale();
            const key = (isWhite ? 'w' : 'b') + (isKing ? 'k' : 'm') + '|' + cellSize.toFixed(2) + '|' + scale.toFixed(3);
            const hit = pieceSprites[key];
            if (hit) return hit;
            const radius = cellSize * 0.42;
            const pad = radius * 0.9;               // 给阴影留边
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
            if (isKing) {
                g.font = `${radius * 1.3}px "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillStyle = isWhite ? '#1a1a1a' : '#f7f7f7';
                g.fillText('♕', cx, cy + radius * 0.06);
            }
            const sprite = { canvas: cv, size, half: radius + pad };
            pieceSprites[key] = sprite;
            return sprite;
        }

        /** 画一枚棋子：兵 = 围棋棋子；王 = 棋子 + ♕（黑棋白字、白棋黑字） */
        function drawPiece(x, y, piece) {
            const s = pieceSprite(piece);
            ctx2d.drawImage(s.canvas, x - s.half, y - s.half, s.size, s.size);
        }

        /** 棋盘底图（格子 + 外框 + 坐标）缓存：只在路数/视角/像素比变化时重画 */
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
            const light = '#f0d9b5';
            const dark = '#b58863';
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const d = toDisplayCoord(r, c);
                    g.fillStyle = R.isDarkSquare(r, c) ? dark : light;
                    g.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }
            g.strokeStyle = '#3a281c';
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

            // 上一手：起点 + 落点淡黄（被吃掉的格子不做任何标记）
            const lm = ps.lastMove;
            if (lm) {
                const marks = [{ row: lm.fromRow, col: lm.fromCol }].concat(lm.path || []);
                for (const p of marks) {
                    if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col)) continue;
                    const d = toDisplayCoord(p.row, p.col);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }

            // 本次连跳已走过的部分：起点+已跳格淡黄
            const prefix = ps.hopPath || [];
            if (ps.selectedRow >= 0 && prefix.length > 0) {
                for (const p of [{ row: ps.selectedRow, col: ps.selectedCol }].concat(prefix)) {
                    const d = toDisplayCoord(p.row, p.col);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.45)';
                    ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }

            // 可落点提示：小方块（与国际象棋一致），按行棋方着色：白方白块、黑方黑块
            if (ps.legalTargets.length) {
                const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
                const half = cellSize * 0.12;
                ctx2d.fillStyle = side === 'white' ? '#ffffff' : '#111111';
                for (const t of ps.legalTargets) {
                    const d = toDisplayCoord(t.row, t.col);
                    const { x, y } = squareCenter(d.row, d.col);
                    ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
                }
            }

            // 棋子（连跳进行中：原位的棋子画在已跳到的位置，已被吃掉的子先隐藏）
            const pendingCaptures = [];
            let pendingPos = null;
            if (ps.selectedRow >= 0 && prefix.length > 0) {
                pendingPos = prefix[prefix.length - 1];
                const cur = ps.candidateMoves[0];
                if (cur) {
                    for (let i = 0; i < prefix.length; i++) {
                        if (cur.captures[i]) pendingCaptures.push(cur.captures[i]);
                    }
                }
            }
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    let piece = ps.board[r][c];
                    if (!piece) continue;
                    if (pendingPos && r === ps.selectedRow && c === ps.selectedCol) continue;
                    if (pendingCaptures.some((p) => p.row === r && p.col === c)) continue;
                    const d = toDisplayCoord(r, c);
                    const { x, y } = squareCenter(d.row, d.col);
                    drawPiece(x, y, piece);
                }
            }
            if (pendingPos) {
                const piece = ps.board[ps.selectedRow][ps.selectedCol];
                const d = toDisplayCoord(pendingPos.row, pendingPos.col);
                const { x, y } = squareCenter(d.row, d.col);
                if (piece) drawPiece(x, y, piece);
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
            // 国际跳棋不显示比分/形势面板（scoreTitle / scoreBoard / leadInfo 一律留空）
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
                // turnDisplay 显示「刚下完这手棋」的一方与回合数（比分面板一律留空）
                const moverLabel = side === 'white' ? '⚫' : '⚪';
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.roundTurnText(ps.moveHistory.length, moverLabel);
            } else {
                turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + turnLabel(side);
            }
        }

        function normalizeMoveEntry(m) {
            const path = (m.path || []).map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col }));
            return {
                player: m.player,
                fromRow: m.fromRow,
                fromCol: m.fromCol,
                toRow: m.toRow != null ? m.toRow : (path.length ? path[path.length - 1].row : m.fromRow),
                toCol: m.toCol != null ? m.toCol : (path.length ? path[path.length - 1].col : m.fromCol),
                path,
                captures: (m.captures || []).map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col })),
                piece: m.piece || '',
                promote: !!m.promote
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
            ps.noProgress = state.noProgress || 0;
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) ps.moveHistory = state.moveHistory.map(normalizeMoveEntry);
            else if (state.moveCoords) ps.moveHistory = state.moveCoords.filter((m) => m.type === 'move').map(normalizeMoveEntry);
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
                lastFrom: lastMove ? { row: lastMove.fromRow, col: lastMove.fromCol } : null,
                lastTo: lastMove ? { row: lastMove.toRow, col: lastMove.toCol } : null
            };
        }

        function openingBoard() {
            return ps.initialBoard && ps.initialBoard.length === ps.boardSize
                ? R.copyBoard(ps.initialBoard)
                : R.createInitialBoard(ps.boardSize);
        }

        function rebuildLiveSnapshots() {
            const n = ps.boardSize;
            let b = openingBoard();
            let side = 'white';
            const snaps = [snapshotFrom(b, side, null)];
            for (const m of ps.moveHistory) {
                const moves = R.legalMoves(b, n, side);
                const mv = R.findMove(moves, m.fromRow, m.fromCol, m.path);
                if (!mv) break;
                b = R.applyMoveOnBoard(b, n, mv);
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, {
                    player: m.player, fromRow: m.fromRow, fromCol: m.fromCol,
                    toRow: mv.path[mv.path.length - 1].row, toCol: mv.path[mv.path.length - 1].col,
                    path: mv.path, captures: mv.captures, piece: m.piece, promote: mv.promote
                }));
            }
            ps.liveSnapshots = snaps;
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
                    path: [{ row: s.lastTo.row, col: s.lastTo.col }], captures: []
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
            let b = startBoard.map((row) => row.slice());
            let side = 'white';
            const snaps = [snapshotFrom(b, side, null)];
            for (const raw of rawMoves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.trim().match(/^([WB])((?:\d+,\d+)(?:>\d+,\d+)*)$/i);
                    if (!mt) continue;
                    const pts = mt[2].split('>').map((s) => s.split(',').map(Number));
                    m = {
                        fromRow: pts[0][0], fromCol: pts[0][1],
                        path: pts.slice(1).map((p) => ({ row: p[0], col: p[1] }))
                    };
                }
                const path = (m.path || []).map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col }));
                const mv = R.findMove(R.legalMoves(b, n, side), m.fromRow, m.fromCol, path);
                if (!mv) break;
                b = R.applyMoveOnBoard(b, n, mv);
                const to = mv.path[mv.path.length - 1];
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, {
                    fromRow: m.fromRow, fromCol: m.fromCol, toRow: to.row, toCol: to.col,
                    path: mv.path, captures: mv.captures, promote: mv.promote
                }));
            }
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

        function tryPlayMove(fromRow, fromCol, path) {
            const side = ps.tryPlaySide;
            const mv = R.findMove(R.legalMoves(ps.board, boardSize(), side), fromRow, fromCol, path);
            if (!mv) return false;
            const nb = R.applyMoveOnBoard(ps.board, boardSize(), mv);
            if (!nb) return false;
            const to = mv.path[mv.path.length - 1];
            const nextSide = R.oppositeSide(side);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(nb, nextSide, {
                player: R.slotFromSide(side), fromRow, fromCol, toRow: to.row, toCol: to.col,
                path: mv.path, captures: mv.captures, promote: mv.promote
            }));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = nextSide;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(fromRow, fromCol, path) {
            const msg = JSON.stringify({
                type: 'move',
                fromRow,
                fromCol,
                path: path.map((p) => ({ row: p.row, col: p.col }))
            });
            // 断线/重连中不让着法凭空消失：缓存一手，连上后自动补发（服务器仍会校验合法性）
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

        /** 点了一个可落点：接受这一步；若该着法还有后续连跳则继续等下一跳 */
        function attemptHop(row, col) {
            const prefix = (ps.hopPath || []).concat([{ row, col }]);
            const cand = ps.candidateMoves.filter((m) => {
                if (m.path.length < prefix.length) return false;
                for (let i = 0; i < prefix.length; i++) {
                    if (m.path[i].row !== prefix[i].row || m.path[i].col !== prefix[i].col) return false;
                }
                return true;
            });
            if (cand.length === 0) return false;
            if (cand.every((m) => m.path.length === prefix.length)) {
                const move = cand[0];
                if (ps.tryPlayMode) tryPlayMove(move.from.row, move.from.col, move.path);
                else commitMove(move.from.row, move.from.col, move.path);
                clearSelection();
                drawBoard();
                return true;
            }
            ps.hopPath = prefix;
            refreshLegalTargets();
            drawBoard();
            return true;
        }

        function handleBoardClick(clientX, clientY) {
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { row, col } = getRowColFromClient(clientX, clientY);
            if (row < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const ch = side === 'white' ? 'w' : 'b';

            if (ps.selectedRow < 0) {
                const p = ps.board[row][col];
                if (p && p[0] === ch) {
                    ps.selectedRow = row;
                    ps.selectedCol = col;
                    ps.hopPath = [];
                    refreshLegalTargets();
                    drawBoard();
                }
                return;
            }

            // 连跳进行中：只接受「可落点」，点别处忽略
            const midHop = (ps.hopPath || []).length > 0;
            if (row === ps.selectedRow && col === ps.selectedCol && !midHop) {
                clearSelection();
                drawBoard();
                return;
            }

            const hit = ps.legalTargets.some((t) => t.row === row && t.col === col);
            if (hit) {
                attemptHop(row, col);
                return;
            }

            if (midHop) return;

            const p2 = ps.board[row][col];
            if (p2 && p2[0] === ch) {
                ps.selectedRow = row;
                ps.selectedCol = col;
                ps.hopPath = [];
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
            // 试下虚着：快照型棋种要由棋种自己给出「另一方」的取值
            tryPlayOppositeSide: (side) => R.oppositeSide(side),
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ps.ws,
            getBoardSize: () => ps.boardSize,
            // 默认限时与围棋同口径：按棋盘总点数换算
            getTotalPoints: () => ps.boardSize * ps.boardSize,
            // 主用时系数按本棋种调大（0.05，读秒/次数仍同围棋口径）
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
                if (editApi) editApi.updateEditModeUI();
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

        // 编辑模式：安装公共编辑 UI（点击放置棋子，关闭编辑时提交服务器）
        let editApi = null;
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'grid2d',
                editTools: config.editTools,
                pickAtClient(clientX, clientY) {
                    return getRowColFromClient(clientX, clientY);
                },
                drawBoard,
                getBoard: () => ps.board,
                setBoard: (b) => { ps.board = b; },
                emptyBoard: () => R.emptyBoard(ps.boardSize)
            });
        }

        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
