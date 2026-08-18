// 菱国际象棋（Rhombic Chess，Tony Paletta 1980）
// 棋盘：11 行 72 格，三方向菱形（横/竖左/竖右），六角形轮廓
// 坐标：行列 (row, col)，row 0-10、col 0 起从左到右；奇数 row 为横格行（h），偶数 row 为竖带行
//   竖带行：顶部（row<5）col 偶 = 竖左 l、col 奇 = 竖右 r；底部（row>5）col 偶 = r、col 奇 = l
// 走法：
//   车 edgewise（穿过对边直线）；象斜走（沿长边方向直线）+ 1 步 edgewise；后 = 车 + 象
//   王 1 步 edgewise 或斜走一步；无易位
//   马 1 步 edgewise + 1 步斜走（单向），可跳
//   兵向前 1 步 edgewise（首步 2 步）斜吃（横格兵不能吃），有吃过路兵
//   升变：白兵到 row 1、黑兵到 row 9
// 协议坐标：row/col（从 0 开始）
const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

const R = (function () {
    'use strict';
    const A = Math.sqrt(3) / 2, B = 0.5;
    const key = (row, col) => row + ',' + col;
    const PIECE_CHAR = {
        wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
        bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
    };
    const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

    // 每行格数（row 0-10）
    const ROW_COUNT = [6, 4, 8, 5, 10, 6, 10, 5, 8, 4, 6];

    function buildBoard() {
        const cells = [];
        for (let row = 0; row < 11; row++) {
            const n = ROW_COUNT[row];
            if (row % 2 === 1) {
                for (let col = 0; col < n; col++) cells.push({ type: 'h', row, col });
            } else {
                const isTop = row < 5;
                for (let col = 0; col < n; col++) {
                    cells.push({ type: (col % 2 === 0) === isTop ? 'l' : 'r', row, col });
                }
            }
        }
        return cells;
    }

    const CELLS = buildBoard();
    const CELL_INDEX = {};
    CELLS.forEach((c, i) => { CELL_INDEX[key(c.row, c.col)] = i; });
    function cellIdOf(row, col) {
        const id = CELL_INDEX[key(row, col)];
        return id === undefined ? -1 : id;
    }
    function cellKeyOfId(id) { const c = CELLS[id]; return key(c.row, c.col); }

    // 半对角向量（实体单位）：长对角线（长边方向）与短对角线
    const HALF = {
        h: { long: [A, 0], short: [0, B] },
        l: { long: [0.5 * A, 0.75], short: [-0.5 * A, 0.25] },
        r: { long: [-0.5 * A, 0.75], short: [-0.5 * A, -0.25] }
    };
    function centerOf(cell) {
        const off = Math.abs(cell.row - 5) / 2;
        const x = cell.type === 'h' ? (2 * cell.col + off) * A : (cell.col + off) * A;
        return [x, (cell.row - 5) * 0.75];
    }
    function vertsOf(cell) {
        const [x, y] = centerOf(cell);
        const u = HALF[cell.type].long, v = HALF[cell.type].short;
        return [
            [x + u[0], y + u[1]],
            [x + v[0], y + v[1]],
            [x - u[0], y - u[1]],
            [x - v[0], y - v[1]]
        ];
    }
    const eq = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;

    // 预计算邻接：共享边 = edgewise；长边方向 = 斜走
    const EDGE_NB = [], DIAG_NB = [];
    for (let i = 0; i < CELLS.length; i++) {
        const c = CELLS[i];
        EDGE_NB.push([]);
        // 斜走邻居：中心沿长对角线方向 ±2×长半向量
        const diagList = [];
        const u = HALF[c.type].long;
        const [cx, cy] = centerOf(c);
        for (const s of [1, -1]) {
            const tx = cx + 2 * u[0] * s, ty = cy + 2 * u[1] * s;
            for (let j = 0; j < CELLS.length; j++) {
                if (j === i) continue;
                const p = centerOf(CELLS[j]);
                if (Math.abs(p[0] - tx) < 1e-6 && Math.abs(p[1] - ty) < 1e-6) { diagList.push(j); break; }
            }
        }
        DIAG_NB.push(diagList);
        const v1 = vertsOf(c);
        for (let j = 0; j < CELLS.length; j++) {
            if (i === j) continue;
            const v2 = vertsOf(CELLS[j]);
            let shared = false;
            for (let a = 0; a < 4 && !shared; a++) {
                for (let b = 0; b < 4; b++) {
                    if ((eq(v1[a], v2[b]) && eq(v1[(a + 1) % 4], v2[(b + 1) % 4])) ||
                        (eq(v1[a], v2[(b + 1) % 4]) && eq(v1[(a + 1) % 4], v2[b]))) { shared = true; break; }
                }
            }
            if (shared) { EDGE_NB[i].push(j); continue; }
        }
    }

    // 直线移动：从 id 沿邻居方向延伸
    function lineMoves(id, nbTable, blockers, side) {
        const out = [];
        for (const n of nbTable[id]) {
            const c = CELLS[id], d = CELLS[n];
            const c1 = centerOf(c), c2 = centerOf(d);
            const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
            let cur = n;
            while (true) {
                const b = blockers[cur];
                if (b) {
                    if (b !== side) out.push(cur);
                    break;
                }
                out.push(cur);
                const cc1 = centerOf(CELLS[cur]);
                const tx = cc1[0] + dx, ty = cc1[1] + dy;
                let next = -1;
                for (const nn of nbTable[cur]) {
                    const n2 = centerOf(CELLS[nn]);
                    if (Math.abs(n2[0] - tx) < 1e-6 && Math.abs(n2[1] - ty) < 1e-6) { next = nn; break; }
                }
                if (next === -1) break;
                cur = next;
            }
        }
        return out;
    }

    function setup() {
        const board = {};
        // 白方（底部）
        const whiteRow = ['wr', 'wn', 'wq', 'wk', 'wn', 'wr'];
        for (let c = 0; c < 6; c++) board[key(10, c)] = whiteRow[c];
        board[key(9, 1)] = 'wb'; board[key(9, 2)] = 'wb';
        for (let c = 0; c < 8; c++) board[key(8, c)] = 'wp';
        // 黑方（顶部）
        const blackRow = ['br', 'bn', 'bq', 'bk', 'bn', 'br'];
        for (let c = 0; c < 6; c++) board[key(0, c)] = blackRow[c];
        board[key(1, 1)] = 'bb'; board[key(1, 2)] = 'bb';
        for (let c = 0; c < 8; c++) board[key(2, c)] = 'bp';
        return board;
    }

    function pieceSide(pc) { return pc[0] === 'w' ? 'white' : 'black'; }
    function oppositeSide(side) { return side === 'white' ? 'black' : 'white'; }
    function sideFromSlot(slot) { return slot === 'black' ? 'white' : 'black'; }
    function slotFromSide(side) { return side === 'white' ? 'black' : 'white'; }
    function normalizePromote(p) {
        p = String(p || '').toLowerCase();
        if (PROMOTE_TYPES.includes(p)) return p;
        return 'q';
    }

    // 生成一步的所有合法目标
    function pseudoMoves(board, id, side, ep) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const blockers = {};
        for (const kk in board) {
            if (board[kk] === '' || board[kk] == null) continue;
            blockers[CELL_INDEX[kk]] = pieceSide(board[kk]);
        }
        const out = [];
        const add = (t) => { if (!out.includes(t)) out.push(t); };
        const type = pc[1];
        if (type === 'r' || type === 'q') {
            for (const t of lineMoves(id, EDGE_NB, blockers, side)) add(t);
        }
        if (type === 'b' || type === 'q') {
            for (const t of lineMoves(id, DIAG_NB, blockers, side)) add(t);
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'k') {
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
            for (const n of DIAG_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'n') {
            // 马：先走一个邻格，再走一个斜格（跳过中间格）
            for (const e of EDGE_NB[id]) {
                for (const d of DIAG_NB[e]) { const b = blockers[d]; if (!b || b !== side) add(d); }
            }
        }
        if (type === 'p') {
            const fwd = side === 'white' ? -1 : 1;
            const c1 = centerOf(CELLS[id]);
            const fwdNbs = EDGE_NB[id].filter(n => {
                const n2 = centerOf(CELLS[n]);
                return fwd * (n2[1] - c1[1]) > 0;
            });
            for (const n of fwdNbs) {
                if (blockers[n] === undefined) {
                    add(n);
                    // 首步 2 步：第一步向前一格后，第二步可选左前方或右前方（任一前方向）
                    if (!board[k].hasMoved) {
                        const cc1 = centerOf(CELLS[n]);
                        for (const nn of EDGE_NB[n]) {
                            const n3 = centerOf(CELLS[nn]);
                            if (fwd * (n3[1] - cc1[1]) > 0 && blockers[nn] === undefined) add(nn);
                        }
                    }
                }
            }
            // 斜吃：前方斜一格（长边方向前方）有敌子
            for (const d of DIAG_NB[id]) {
                const d2 = centerOf(CELLS[d]);
                if (fwd * (d2[1] - c1[1]) > 0 && blockers[d] && blockers[d] !== side) add(d);
            }
            // 吃过路兵：敌方兵双步后，可斜吃其经过格
            if (ep && ep.passedId != null && ep.passedId !== id && DIAG_NB[id].includes(ep.passedId)) {
                const d2 = centerOf(CELLS[ep.passedId]);
                if (fwd * (d2[1] - c1[1]) > 0) add(ep.passedId);
            }
        }
        return out;
    }

    function findKing(board, side) {
        // 王可能是字符串（'wk'）或对象（applyMove 后 {0:'w',1:'k',hasMoved:true}）
        const ch = side[0];
        for (const k in board) {
            const pc = board[k];
            if (pc && pc[0] === ch && pc[1] === 'k') return CELL_INDEX[k];
        }
        return -1;
    }

    function isAttacked(board, id, bySide) {
        for (const k in board) {
            const pc = board[k];
            if (pieceSide(pc) !== bySide) continue;
            const from = CELL_INDEX[k];
            if (pseudoMoves(board, from, bySide).includes(id)) return true;
        }
        return false;
    }

    // 应用一步，返回被吃子
    function applyMove(board, move, ep) {
        const fromK = cellKeyOfId(move.from);
        const toK = cellKeyOfId(move.to);
        const pc = board[fromK];
        const captured = board[toK];
        delete board[fromK];
        board[toK] = { ...pc, hasMoved: true };
        if (move.promote) board[toK] = board[toK][0] + move.promote;
        // 吃过路兵：吃掉跳越的敌方兵
        if (ep && move.to === ep.passedId && ep.pawnKey) delete board[ep.pawnKey];
        return captured;
    }

    function legalMovesFor(board, id, side, ep) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const promoRow = side === 'white' ? 1 : 9;
        const fwd = side === 'white' ? -1 : 1;
        const raw = pseudoMoves(board, id, side, ep);
        const legal = [];
        for (const t of raw) {
            const move = { from: id, to: t };
            const captured = applyMove(board, move, ep);
            let promote = false;
            if (pc[1] === 'p' && CELLS[t].row === promoRow) {
                promote = true;
                move.promote = 'q';
            }
            // 兵双步标记（记录经过格，供吃过路兵）：两步都向前（可折线）
            if (pc[1] === 'p' && !pc.hasMoved) {
                const c1 = centerOf(CELLS[id]);
                const ct = centerOf(CELLS[t]);
                for (const n of EDGE_NB[id]) {
                    if (!EDGE_NB[t].includes(n)) continue;
                    const cn = centerOf(CELLS[n]);
                    if (fwd * (cn[1] - c1[1]) > 0 && fwd * (ct[1] - cn[1]) > 0) {
                        move.doubleStep = { passed: n };
                        break;
                    }
                }
            }
            let ok = true;
            const kingId = findKing(board, side);
            if (kingId !== -1 && isAttacked(board, kingId, oppositeSide(side))) ok = false;
            // 还原（含吃过路兵删掉的兵）
            const toK = cellKeyOfId(t);
            const fromK = k;
            delete board[toK];
            board[fromK] = pc;
            if (captured !== undefined) board[toK] = captured;
            if (ep && move.to === ep.passedId && ep.pawnKey && !board[ep.pawnKey]) {
                board[ep.pawnKey] = (side === 'white' ? 'b' : 'w') + 'p';
            }
            if (ok) legal.push({ to: t, promote, doubleStep: move.doubleStep || null, enPassant: !!(ep && move.to === ep.passedId) });
        }
        return legal;
    }

    function allLegalMoves(board, side, ep) {
        const out = [];
        for (const k in board) {
            if (pieceSide(board[k]) !== side) continue;
            const id = CELL_INDEX[k];
            for (const m of legalMovesFor(board, id, side, ep)) {
                out.push({ from: id, to: m.to, promote: m.promote || null, doubleStep: m.doubleStep || null, enPassant: m.enPassant });
            }
        }
        return out;
    }

    function isInCheck(board, side) {
        const kingId = findKing(board, side);
        if (kingId === -1) return false;
        return isAttacked(board, kingId, oppositeSide(side));
    }

    function hasLegalMove(board, side) {
        return allLegalMoves(board, side).length > 0;
    }

    return {
        CELLS, CELL_INDEX, EDGE_NB, DIAG_NB, key, cellIdOf, cellKeyOfId,
        centerOf, vertsOf, PIECE_CHAR, PROMOTE_TYPES, normalizePromote,
        setup, pseudoMoves, legalMovesFor, allLegalMoves, applyMove,
        findKing, isAttacked, isInCheck, hasLegalMove,
        pieceSide, oppositeSide, sideFromSlot, slotFromSide,
    };
})();

/** 内部棋子可能带 hasMoved 标记（对象 {0:'w',1:'p',hasMoved:true}），发送给客户端时转回 'wp' 字符串 */
function wirePiece(v) {
    if (typeof v === 'string') return v;
    return v ? v[0] + v[1] : '';
}
function wireBoard(board) {
    const out = {};
    for (const k in board) out[k] = wirePiece(board[k]);
    return out;
}

class RhombicChessRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.editBoardAllowedValues = ['', 'wp', 'wb', 'wn', 'wr', 'wq', 'wk', 'bp', 'bb', 'bn', 'br', 'bq', 'bk'];
        this.boardCells = R.CELLS;
        this.resetToEmpty();
    }

    _pendingPawnPromotion() {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const row = this.sideToMove === 'white' ? 1 : 9;
        for (const c of this.boardCells) {
            if (c.row === row && this.board[R.key(c.row, c.col)] === pawn) {
                return { row: c.row, col: c.col };
            }
        }
        return null;
    }

    _applyPawnPromotion(row, col, promote) {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const id = R.cellIdOf(row, col);
        const c = this.boardCells[id];
        const k = R.key(c.row, c.col);
        if (!c || this.board[k] !== pawn) return false;
        this.board[k] = (this.sideToMove === 'white' ? 'w' : 'b') + R.normalizePromote(promote);
        return true;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    /** 编辑棋盘：客户端提交 flat 数组（72 项，'' 或棋子码），转回对象 board */
    applyEditBoard(ws, msg) {
        const edited = msg.board;
        if (!Array.isArray(edited) || edited.length !== this.boardCells.length) {
            ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
            return;
        }
        const allowed = this.editBoardAllowedValues;
        const next = {};
        for (let i = 0; i < edited.length; i++) {
            const v = edited[i];
            if (v !== '' && !allowed.includes(v)) {
                ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                return;
            }
            if (v !== '') {
                const c = this.boardCells[i];
                next[R.key(c.row, c.col)] = v;
            }
        }
        this.board = next;
        this.historyBoards = [JSON.stringify(this.board)];
        this.moveHistory = [];
        this.moveCoords = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.sideToMove = 'white';
        this.halfmoveClock = 0;
        this.openingBoard = JSON.parse(JSON.stringify(this.board));
        this.broadcast({ type: 'editBoardAccepted', ...this.getState() });
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
                this.recordResultText = lostSlot === 'black' ? '白超时黑胜' : '黑超时白胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.getMoveCount() > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego || this.tcSettings) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) {
            otherWs.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: v.timed,
                    mainMinutes: v.mainMinutes,
                    byoyomiSeconds: v.byoyomiSeconds,
                    maxTimeouts: v.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const p = this.tcNego.proposal;
        if (!p || p.ok !== true) return;
        this.tcSettings = p.timed ? {
            timed: true, mainMinutes: p.mainMinutes, byoyomiSeconds: p.byoyomiSeconds, maxTimeouts: p.maxTimeouts
        } : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, R.slotFromSide(this.sideToMove), Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
        });
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
            this.recordResultText = lostSlot === 'black' ? '白超时黑胜' : '黑超时白胜';
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

    getState() {
        return {
            board: wireBoard(this.board),
            boardCells: this.boardCells,
            boardSize: 72,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'white' ? 2 : 1 }] : [],
            lastEnPassant: this.lastEnPassant,
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmoveClock,
            inCheck: R.isInCheck(this.board, this.sideToMove),
            pendingPromotion: this._pendingPawnPromotion(),
            moveHistory: this.moveHistory.map((m) => ({ ...m, piece: wirePiece(m.piece) })),
            moveCoords: this.wireMoveCoords(),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            recordResultText: this.recordResultText,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    wireMoveCoords() {
        return this.moveHistory.map((m) => ({
            type: 'move',
            player: m.player,
            fromRow: m.fromRow,
            fromCol: m.fromCol,
            toRow: m.toRow,
            toCol: m.toCol,
            piece: m.piece,
            captured: m.captured || '',
            promote: m.promote || null
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '菱国际象棋',
            gameId: 'rhombic-chess',
            boardRows: 11,
            boardCols: 10,
            moves: this.moveHistory.map((m) => {
                let s = `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`;
                if (m.promote) s += `=${m.promote.toUpperCase()}`;
                return s;
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
        this.board = R.setup();
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyHalfmoves = [];
        this.historyKeys = [JSON.stringify(this.board)];
        this.lastFrom = null;
        this.lastTo = null;
        this.lastEnPassant = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.halfmoveClock = 0;
        this.slotJoinedAt = { black: null, white: null };
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

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot, promote) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!Number.isInteger(fromRow) || !Number.isInteger(fromCol) || !Number.isInteger(toRow) || !Number.isInteger(toCol)) return { ok: false };
        const fromId = R.cellIdOf(fromRow, fromCol);
        const toId = R.cellIdOf(toRow, toCol);
        if (fromId < 0 || toId < 0) return { ok: false };
        const legal = R.allLegalMoves(this.board, side, this.lastEnPassant);
        const found = legal.find(m => m.from === fromId && m.to === toId);
        if (!found) return { ok: false };

        const piece = R.cellKeyOfId(fromId);
        const fromK = piece;
        // 吃过路兵：被吃的是跳越的兵（目标格为空）
        const epCapture = found.enPassant && this.lastEnPassant ? this.board[this.lastEnPassant.pawnKey] : undefined;
        const captured = R.applyMove(this.board, found, this.lastEnPassant) || epCapture;
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(this.board, opp);
        const promoteUsed = found.promote ? R.normalizePromote(promote) : null;
        const toK = R.cellKeyOfId(toId);
        if (promoteUsed) {
            this.board[toK] = (side === 'white' ? 'w' : 'b') + promoteUsed;
        }
        // 记录/清除吃过路兵状态（兵双步后对方可斜吃经过格）
        if (found.doubleStep) this.lastEnPassant = { passedId: found.doubleStep.passed, pawnKey: fromK };
        else this.lastEnPassant = null;

        this.historyBoards.push(JSON.stringify(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push(this.halfmoveClock);

        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot,
            fromRow, fromCol, toRow, toCol,
            piece: this.board[toK] || piece, captured: captured || '',
            promote: promoteUsed
        });

        this.halfmoveClock = (captured !== undefined || this.board[toK] && this.board[toK][1] === 'p') ? 0 : this.halfmoveClock + 1;
        this.sideToMove = opp;
        this.currentPlayer = opp === 'white' ? 1 : 2;
        this.historyKeys.push(JSON.stringify(this.board));

        return { ok: true, gaveCheck, captured: captured !== undefined };
    }

    _resolveTurnStartLoss() {
        if (this.gameOver) return false;
        const side = this.sideToMove;
        if (R.findKing(this.board, side) == null) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            this._endGame(winnerSlot, side === 'white' ? '白方无王黑胜' : '黑方无王白胜');
            return true;
        }
        return false;
    }

    /** 开局（时间协商完成/双方入座即开始）时判定：编辑盘面某方无王则直接判负；行棋方无子可动则判和 */
    onMatchStarted() {
        this._resolveTurnStartLoss();
        if (this.gameOver) return;
        const side = this.sideToMove;
        if (!R.hasLegalMove(this.board, side)) {
            this._endGame('draw', side === 'white' ? '白方无子可动，和棋' : '黑方无子可动，和棋');
        }
    }

    _resolveAfterMove() {
        if (this._resolveTurnStartLoss()) return;
        const side = this.sideToMove;
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, side);

        if (!canMove) {
            if (inCheck) {
                const winnerSlot = R.slotFromSide(R.oppositeSide(side));
                const text = side === 'black' ? '白将死黑胜' : '黑将死白胜';
                this._endGame(winnerSlot, text);
            } else {
                this._endGame('draw', '逼和');
            }
            return;
        }
        const rep = this.historyKeys.filter(k => k === this.historyKeys[this.historyKeys.length - 1]).length >= 3;
        if (rep) {
            this._endGame('draw', '三次重复作和');
            return;
        }
        if (this.halfmoveClock >= 100) {
            this._endGame('draw', '五十着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'rhombic-chess') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要菱国际象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol; let promote = null;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(?:=([QRNB]))?$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
                if (m[6]) promote = m[6].toLowerCase();
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol; toRow = entry.toRow; toCol = entry.toCol;
                promote = entry.promote || null;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, player, promote);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
            if (this.gameOver) break;
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'black' || /白胜/.test(rt)) this.winner = 'black';
            else if (data.result === 'white' || /黑胜/.test(rt)) this.winner = 'white';
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
                resultText: this.recordResultText
            }
        });
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
            case 'promotePawn': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                const { row, col, promote } = msg;
                if (!Number.isInteger(row) || !Number.isInteger(col)) return;
                if (!this._applyPawnPromotion(row, col, promote)) return;
                this.broadcast({ type: 'broadcast', action: 'promotePawn', ...this.getState() });
                break;
            }
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                if (this._pendingPawnPromotion()) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const promote = msg.promote != null ? String(msg.promote).toLowerCase() : null;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot, promote);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'black' ? 'white' : 'black';
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
                    requester.send(JSON.stringify({ type: 'undoDeclined' }));
                    break;
                }
                const current = this.room.getSlotByWs(ws);
                const requesterSlot = this.room.getSlotByWs(requester);
                if (current !== requesterSlot) {
                    this._undoOne();
                }
                this._undoOne();
                this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                break;
            }
            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                const opp = slot === 'black' ? 'white' : 'black';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    this._endGame('draw', '和棋');
                    this.broadcast({ type: 'broadcast', action: 'drawAccept', ...this.getState() });
                    return;
                }
                this.pendingDraw = { requester: ws };
                oppWs.send(JSON.stringify({ type: 'drawRequest' }));
                break;
            }
            case 'drawResponse': {
                if (!this.pendingDraw) return;
                const requester = this.pendingDraw.requester;
                this.pendingDraw = null;
                if (!msg.accept) {
                    requester.send(JSON.stringify({ type: 'drawDeclined' }));
                    break;
                }
                this._endGame('draw', '和棋');
                this.broadcast({ type: 'broadcast', action: 'drawAccept', ...this.getState() });
                break;
            }
            case 'requestNewGame': {
                if (!slot) return;
                const opp = slot === 'black' ? 'white' : 'black';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    this._startNewGame();
                    return;
                }
                this.pendingNewGame = { requester: ws };
                oppWs.send(JSON.stringify({ type: 'newGameRequest' }));
                break;
            }
            case 'newGameResponse': {
                if (!this.pendingNewGame) return;
                const requester = this.pendingNewGame.requester;
                this.pendingNewGame = null;
                if (msg.accept) this._startNewGame();
                else requester.send(JSON.stringify({ type: 'newGameDeclined' }));
                break;
            }
            case 'resign': {
                if (!slot || this.gameOver) return;
                const opp = slot === 'black' ? 'white' : 'black';
                this._endGame(opp, slot === 'black' ? '白方认输黑胜' : '黑方认输白胜');
                this.broadcast({ type: 'broadcast', action: 'resign', ...this.getState() });
                break;
            }
            default:
                break;
        }
    }

    _startNewGame() {
        this.resetToEmpty();
        this.broadcast({ type: 'broadcast', action: 'newGame', ...this.getState() });
    }

    _undoOne() {
        if (this.historyBoards.length === 0) return;
        this.board = JSON.parse(this.historyBoards.pop());
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.halfmoveClock = this.historyHalfmoves.pop() || 0;
        this.lastFrom = null;
        this.lastTo = null;
        this.lastEnPassant = null;
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this._stopClockTicker();
    }
}

module.exports = {
    RhombicChessRoom,
    R,
    initRoom(room) {
        room.gameLogic = new RhombicChessRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
