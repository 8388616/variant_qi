const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/** 国际跳棋（波兰跳棋）规则（内联，无独立 rules 文件） */
const R = (function () {
'use strict';

const DEFAULT_N = 10;
const MIN_N = 8;
const MAX_N = 16;

/** 深色格：左上角是浅色格 → (r+c) 为偶数的格子是深色格（棋子都放在深色格里） */
function isDarkSquare(r, c) {
    return (r + c) % 2 === 0;
}

/** 每方棋子行数 = 路数/2 - 1（8→3、10→4、12→5、14→6、16→7），中间恒定留 2 行空 */
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
    return slot === 'player1' ? 'white' : 'black';   // player1 座执白（先手）
}

function slotFromSide(side) {
    return side === 'white' ? 'player1' : 'player2';
}

/** 兵的行进方向：白方在下（row 增大 → 向对方），黑方在上 */
function manForward(side) {
    return side === 'white' ? 1 : -1;
}

/** 白方底线（到达即升变）= 最上一行；黑方底线 = 最下一行 */
function promotionRow(n, side) {
    return side === 'white' ? n - 1 : 0;
}

/** 初始局面：双方各占离自己最近的 rowsPerSide 行的深色格（每行的深色格列号随行奇偶变化，不能整体镜像） */
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

/** 编辑棋盘允许的值：空 + 四种棋子 */
function editBoardAllowedValues() {
    return ['', 'wm', 'wk', 'bm', 'bk'];
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

/**
 * 递归搜索一枚棋子的全部连吃序列。
 * - 被吃掉的子在整段连跳结束前仍留在棋盘上（占位、不可再吃），因此用 captured 记录已吃位置。
 * - 兵落在对方底线只影响「停止时的升变」，搜索中一律按兵继续（仅经过底线不升变）。
 * 返回 [{ path: [{row,col}...], captures: [{row,col}...] }]，path 只含落点（起点在调用处补）。
 */
function captureSeqsFrom(board, n, r, c, piece, side, captured) {
    const king = isKing(piece);
    const enemyCh = side === 'white' ? 'b' : 'w';
    const out = [];
    for (const [dr, dc] of DIRS) {
        if (king) {
            // 飞王：沿斜线找第一枚非空子，须是未吃过的敌子，且其后至少有一格可落
            let rr = r + dr;
            let cc = c + dc;
            while (inBounds(n, rr, cc) && board[rr][cc] === '' && !containsPos(captured, rr, cc)) {
                rr += dr;
                cc += dc;
            }
            if (!inBounds(n, rr, cc)) continue;
            const target = board[rr][cc];
            if (!target || target[0] !== enemyCh) continue;
            if (containsPos(captured, rr, cc)) continue;   // 已被吃过（仍在盘上占位）
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
            // 兵：跳过相邻一枚敌子，落在其后紧邻空格；方向不限（可后退吃）
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
                // 飞王：循任何斜向移动任意格数，路徑不可有其它棋子阻挡
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

/** 某枚棋子的合法着法（客户端选中棋子后提示落点用） */
function movesFrom(board, n, side, row, col) {
    return legalMoves(board, n, side).filter((m) => m.from.row === row && m.from.col === col);
}

/** 落子（含整段连吃的移除与终点升变），返回新棋盘；不合法返回 null */
function applyMoveOnBoard(board, n, move) {
    const p = board[move.from.row][move.from.col];
    if (!p) return null;
    const nb = copyBoard(board);
    nb[move.from.row][move.from.col] = '';
    for (const cap of move.captures) nb[cap.row][cap.col] = '';
    const last = move.path[move.path.length - 1];
    let piece = p;
    if (move.promote) piece = p[0] + 'k';
    nb[last.row][last.col] = piece;
    return nb;
}

/** 从着法列表里找出与 (from, path) 完全一致的合法着法 */
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

/** 局面键（三次重复判和用）：棋盘 + 行棋方 */
function positionKey(board, n, side) {
    const rows = [];
    for (let r = 0; r < n; r++) rows.push(board[r].join(','));
    return rows.join('|') + '#' + side;
}

/** 无进展手数：无吃子且无兵移动则 +1，否则清零 */
function nextNoProgress(prev, move, movedPiece) {
    const wasMan = !!movedPiece && !isKing(movedPiece);
    if (move.captures.length > 0 || wasMan) return 0;
    return (prev || 0) + 1;
}

/** 和棋阈值：2.5 × 路数 回合（回合 = 双方各一手）→ 手数 = 5 × 路数 */
function noProgressLimit(n) {
    return Math.round(5 * n);
}

/** 三次重复局面 */
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

/** 着法文本：起点-终点（吃子标 ×n，升变标 =王） */
function moveToText(move, n) {
    const col = (c) => String.fromCharCode(97 + c);
    const sq = (p) => col(p.col) + String(n - p.row);
    let s = sq(move.from) + '-' + sq(move.path[move.path.length - 1]);
    if (move.captures.length > 0) s += '×' + move.captures.length;
    if (move.promote) s += '=王';
    return s;
}

/** 棋盘格数合法（8-16 的偶数） */
function isValidSize(n) {
    return Number.isInteger(n) && n >= MIN_N && n <= MAX_N && n % 2 === 0;
}

return {
    DEFAULT_N,
    MIN_N,
    MAX_N,
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
    editBoardAllowedValues,
    countPieces,
    legalMoves,
    movesFrom,
    hasLegalMove,
    applyMoveOnBoard,
    findMove,
    positionKey,
    nextNoProgress,
    noProgressLimit,
    judgeRepetition,
    pieceLabel,
    moveToText,
    isValidSize
};
})();

/**
 * 协议座位：black=白方(先手，默认显示在下)，white=黑方(后手)
 */
class DraughtsRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = R.DEFAULT_N;
        this.boardRows = this.boardSize;
        this.boardCols = this.boardSize;
        // 开局前编辑允许的棋子值（字符串棋盘：空 '' + 白兵/白王/黑兵/黑王）
        this.editBoardAllowedValues = R.editBoardAllowedValues();
        this.resetToEmpty();
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player2;
        const tw = this.slotJoinedAt.player1;
        if (tb == null || tw == null) return 'player2';
        return tb <= tw ? 'player2' : 'player1';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === R.slotFromSide(this.sideToMove);
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== R.slotFromSide(this.sideToMove)) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, R.slotFromSide(this.sideToMove), Date.now());
        this._broadcastClock();
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    /** 聊天/棋谱里显示的执方名：这些棋种白方先行，player1 座执白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '白方' : (slot === 'player2' ? '黑方' : String(slot));
    }

    getState() {
        const n = this.boardSize;
        const last = this.lastMove;
        return {
            board: this.board,
            boardSize: n,
            boardRows: n,
            boardCols: n,
            // 开局局面（编辑棋子后即为编辑后的局面），客户端重放/试下据此重建
            initialBoard: this.openingBoard ? this.openingBoard.map((row) => row.slice()) : null,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: last ? { row: last.from.row, col: last.from.col } : null,
            lastTo: last ? { ...last.path[last.path.length - 1] } : null,
            lastMove: last ? this._wireMove(last) : null,
            lastMoveMarkers: last
                ? [{ row: last.path[last.path.length - 1].row, col: last.path[last.path.length - 1].col, color: last.player === 'player2' ? 1 : 2 }]
                : [],
            gameOver: this.gameOver,
            winner: this.winner,
            noProgress: this.noProgress,
            noProgressLimit: R.noProgressLimit(n),
            // 只发一份着法表（moveHistory 与 moveCoords 内容相同，两份会让每次广播的
            // 载荷随对局长度翻倍增长）；客户端按 moveHistory 解析。
            moveHistory: this.moveHistory.map((m) => this._wireMove(m)),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            recordResultText: this.recordResultText,
            slots: {
                player2: !!this.room.getPlayerBySlot('player2'),
                player1: !!this.room.getPlayerBySlot('player1')
            },
            pieceCounts: {
                white: R.countPieces(this.board, n, 'white'),
                black: R.countPieces(this.board, n, 'black')
            }
        };
    }

    /** 着法的线上表示（起点 + 整条连跳路线，客户端据此逐步回放吃子动画） */
    _wireMove(m) {
        return {
            type: 'move',
            player: m.player,
            fromRow: m.fromRow,
            fromCol: m.fromCol,
            toRow: m.toRow,
            toCol: m.toCol,
            path: (m.path || []).map((p) => ({ row: p.row, col: p.col })),
            captures: (m.captures || []).map((p) => ({ row: p.row, col: p.col })),
            piece: m.piece,
            promote: !!m.promote
        };
    }

    wireMoveCoords() {
        return this.moveHistory.map((m) => this._wireMove(m));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '国际跳棋',
            gameId: 'draughts',
            boardSize: this.boardSize,
            boardRows: this.boardSize,
            boardCols: this.boardSize,
            moves: this.moveHistory.map((m) => {
                const pts = [{ row: m.fromRow, col: m.fromCol }].concat(m.path || []);
                return (m.player === 'player1' ? 'W' : 'B') + pts.map((p) => `${p.row},${p.col}`).join('>');
            }),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = R.createInitialBoard(this.boardSize);
        this.openingBoard = R.copyBoard(this.board);
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyNoProgress = [];
        this.historyLastMoves = [];
        this.historyKeys = [R.positionKey(this.board, this.boardSize, this.sideToMove)];
        this.lastMove = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.noProgress = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.hostWs = null;
        this._stopClockTicker();
    }

    _endGame(winnerSlot, resultText) {
        this.gameOver = true;
        this.winner = winnerSlot;
        this.recordResultText = resultText;
        this._stopClockTicker();
    }

    _applyMoveCore(fromRow, fromCol, path, slot) {
        const n = this.boardSize;
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const move = R.findMove(R.legalMoves(this.board, n, side), fromRow, fromCol, path);
        if (!move) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const nb = R.applyMoveOnBoard(this.board, n, move);
        if (!nb) return { ok: false };
        const last = move.path[move.path.length - 1];

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyNoProgress.push(this.noProgress);
        this.historyLastMoves.push(this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null);

        this.board = nb;
        this.lastMove = {
            player: slot,
            from: move.from,
            path: move.path,
            captures: move.captures,
            promote: !!move.promote
        };
        this.moveHistory.push({
            player: slot,
            fromRow,
            fromCol,
            toRow: last.row,
            toCol: last.col,
            path: move.path,
            captures: move.captures,
            piece,
            promote: !!move.promote
        });
        this.noProgress = R.nextNoProgress(this.noProgress, move, piece);
        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, n, this.sideToMove));

        return { ok: true, captured: move.captures.length, last };
    }

    /** 落子后的胜负与和棋判定：吃光对方 / 对方无法行动 → 胜；三次重复 / 无进展超限 → 和 */
    _resolveAfterMove() {
        const n = this.boardSize;
        const side = this.sideToMove;
        if (R.countPieces(this.board, n, side) === 0) {
            this._endGame(R.slotFromSide(R.oppositeSide(side)), side === 'white' ? '白方棋子被吃尽，黑胜' : '黑方棋子被吃尽，白胜');
            return;
        }
        if (!R.hasLegalMove(this.board, n, side)) {
            this._endGame(R.slotFromSide(R.oppositeSide(side)), side === 'white' ? '白方无子可动，黑胜' : '黑方无子可动，白胜');
            return;
        }
        if (R.judgeRepetition(this.historyKeys)) {
            this._endGame('draw', '三次重复作和');
            return;
        }
        const limit = R.noProgressLimit(n);
        if (this.noProgress >= limit) {
            this._endGame('draw', `连续 ${Math.ceil(limit / 2)} 回合无吃子且无兵移动作和`);
        }
    }

    /** 开局判定（编辑盘面）：行棋方无子或无子可动 → 判负 */
    onMatchStarted() {
        if (this.gameOver) return;
        const n = this.boardSize;
        const side = this.sideToMove;
        if (R.countPieces(this.board, n, side) === 0) {
            this._endGame(R.slotFromSide(R.oppositeSide(side)), side === 'white' ? '黑胜' : '白胜');
            return;
        }
        if (!R.hasLegalMove(this.board, n, side)) {
            this._endGame(R.slotFromSide(R.oppositeSide(side)), side === 'white' ? '白方无子可动，黑胜' : '黑方无子可动，白胜');
        }
    }

    /** 编辑盘面后重置行棋方与计数（公共编辑流程回调） */
    afterEditBoard() {
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.noProgress = 0;
        this.historyKeys = [R.positionKey(this.board, this.boardSize, this.sideToMove)];
        this.lastMove = null;
    }

    /** 观战者改路数：仅在无棋手、无着法、未开局时允许 */
    setBoardSize(newSize, requesterWs) {
        const n = parseInt(newSize, 10);
        if (!R.isValidSize(n)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（需为 8-16 的偶数）。' }));
            return false;
        }
        if (this.room.getPlayerBySlot('player2') || this.room.getPlayerBySlot('player1')) return false;
        if (this.moveHistory.length > 0 || this.gameOver) return false;
        this.boardSize = n;
        this.boardRows = n;
        this.boardCols = n;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'draughts') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要国际跳棋棋谱）。' }));
            return;
        }
        const n = parseInt(data.boardSize != null ? data.boardSize : (data.boardRows || R.DEFAULT_N), 10);
        if (!R.isValidSize(n)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中的棋盘大小无效。' }));
            return;
        }
        this.boardSize = n;
        this.boardRows = n;
        this.boardCols = n;
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const parsed = DraughtsRoom.parseMoveEntry(rawMoves[i]);
            if (!parsed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (parsed.player && parsed.player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(parsed.fromRow, parsed.fromCol, parsed.path, expect);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'player2' || /白胜/.test(rt)) this.winner = 'player2';
            else if (data.result === 'player1' || /黑胜/.test(rt)) this.winner = 'player1';
            else this.winner = data.result;
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                moves: this.wireMoveCoords(),
                initialBoard: this.openingBoard ? this.openingBoard.map((row) => row.slice()) : null,
                resultText: this.recordResultText
            }
        });
    }

    /** 棋谱条目 → { player, fromRow, fromCol, path }；支持字符串与对象两种写法 */
    static parseMoveEntry(entry) {
        if (entry == null) return null;
        if (typeof entry === 'string') {
            // 形如 B3,2>5,4>7,6 （首格为起点，其后为各段落点）
            const m = entry.trim().match(/^([WB])((?:\d+,\d+)(?:>\d+,\d+)*)$/i);
            if (!m) return null;
            const player = m[1].toUpperCase() === 'B' ? 'player2' : 'player1';
            const pts = m[2].split('>').map((s) => s.split(',').map(Number));
            if (pts.length < 2) return null;
            for (const p of pts) {
                if (p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) return null;
            }
            return {
                player,
                fromRow: pts[0][0],
                fromCol: pts[0][1],
                path: pts.slice(1).map((p) => ({ row: p[0], col: p[1] }))
            };
        }
        if (typeof entry === 'object') {
            const path = Array.isArray(entry.path)
                ? entry.path.map((p) => (Array.isArray(p) ? { row: p[0], col: p[1] } : { row: p.row, col: p.col }))
                : null;
            if (!path || path.length === 0) return null;
            if (!Number.isInteger(entry.fromRow) || !Number.isInteger(entry.fromCol)) return null;
            return {
                player: entry.player === 'player2' || entry.player === 'player1' ? entry.player : null,
                fromRow: entry.fromRow,
                fromCol: entry.fromCol,
                path
            };
        }
        return null;
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;
            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;
            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;
            case 'setBoardSize':
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;
            case 'editBoard':
                qiProtocol.editSquareBoard(this, ws, msg);
                break;
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol } = msg;
                if (!Number.isInteger(fromRow) || !Number.isInteger(fromCol)) return;
                const path = DraughtsRoom.normalizePath(msg.path);
                if (!path) return;
                const r = this._applyMoveCore(fromRow, fromCol, path, slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'player2' ? 'player1' : 'player2';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    this._undoOne();
                    this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                    return;
                }
                this.pendingUndo = { requester: ws };
                oppWs.send(JSON.stringify({ type: 'undoRequest' }));
                break;
            }
            case 'undoResponse': {
                if (!this.pendingUndo) return;
                const requester = this.pendingUndo.requester;
                this.pendingUndo = null;
                if (!msg.accept) {
                    if (requester && requester.readyState === 1) {
                        requester.send(JSON.stringify({ type: 'undoRejected' }));
                    }
                    return;
                }
                this._undoOne();
                this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                break;
            }
            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver && slot) {
                    this.recordResultText = slot === 'player2' ? '黑方认输，白胜' : '白方认输，黑胜';
                    this._stopClockTicker();
                }
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '双方同意作和';
                        this._stopClockTicker();
                    }
                });
                break;
            default:
                break;
        }
    }

    /** 客户端来的连跳路线：统一成 [{row,col}...] */
    static normalizePath(path) {
        if (!Array.isArray(path) || path.length === 0) return null;
        const out = [];
        for (const p of path) {
            const row = Array.isArray(p) ? p[0] : p && p.row;
            const col = Array.isArray(p) ? p[1] : p && p.col;
            if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
            out.push({ row, col });
        }
        return out;
    }

    _undoOne() {
        if (this.historyBoards.length === 0) return;
        this.board = this.historyBoards.pop();
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.noProgress = this.historyNoProgress.pop() || 0;
        this.lastMove = this.historyLastMoves.pop() || null;
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        if (this.tcClock && this.tcClock.timed) this._syncClockAfterTurnChange();
    }

    resetGame() {
        this.resetToEmpty();
        for (const [client, s] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(s);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player2: false, player1: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new DraughtsRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
