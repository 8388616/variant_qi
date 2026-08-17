// 菱国际象棋（Rhombic Chess，Tony Paletta 1980）
// 棋盘：11 行 72 格，三方向菱形（横/竖左/竖右），六角形轮廓
// 格坐标：(type, I, J)：
//   横 h(i,j)：中心 (i·a, j·b)，顶点 (i±1,j)、(i,j±1)
//   竖左 l(I,J)：中心 (I-0.5, J-1.5)，顶点 (I-1,J),(I,J-1),(I,J-3),(I-1,J-2)
//   竖右 r(I,J)：中心 (I+0.5, J-1.5)，顶点 (I+1,J),(I,J-1),(I,J-3),(I+1,J-2)
//   a = √3/2、b = 1/2
// 走法：
//   车 edgewise（穿过对边直线，4 方向）
//   象 pointwise（穿过 60° 角直线，2 方向）+ 1 步 edgewise
//   后 = 车 + 象；王 1 步 edgewise 或 pointwise；无易位
//   马 1 步 edgewise + 1 步 pointwise（或反之），可跳
//   兵向前 1 步 edgewise（首步 2 步）直走直吃，无过路兵
//   升变：白兵到行 3（黑兵阵）、黑兵到行 9（白兵阵）
//   将军/将杀/逼和/无王判负
// 协议坐标：格 id（0-71），fromRow=fromId、fromCol=0、toRow=toId、toCol=0

const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

const R = (function () {
    'use strict';
    const A = Math.sqrt(3) / 2, B = 0.5;
    const key = (type, I, J) => type + ',' + I + ',' + J;
    const PIECE_CHAR = {
        wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
        bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
    };
    const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

    function buildBoard() {
        const cells = [];
        const add = (type, I, J, row) => cells.push({ type, I, J, row });
        // 行 1（黑大子）
        add('l', 3, -6, 1); add('r', 3, -6, 1);
        add('l', 5, -6, 1); add('r', 5, -6, 1);
        add('l', 7, -6, 1); add('r', 7, -6, 1);
        // 行 2（黑象）
        add('h', 2, -6, 2); add('h', 4, -6, 2); add('h', 6, -6, 2); add('h', 8, -6, 2);
        // 行 3（黑兵）
        for (let k = 0; k < 4; k++) { add('l', 2 + 2 * k, -3, 3); add('r', 2 + 2 * k, -3, 3); }
        // 行 4
        for (let k = 0; k < 5; k++) add('h', 1 + 2 * k, -3, 4);
        // 行 5
        for (let k = 0; k < 5; k++) { add('l', 1 + 2 * k, 0, 5); add('r', 1 + 2 * k, 0, 5); }
        // 行 6
        for (let k = 0; k < 6; k++) add('h', 2 * k, 0, 6);
        // 行 7（从竖右开始）
        for (let k = 0; k < 5; k++) add('r', 0 + 2 * k, 3, 7);
        for (let k = 0; k < 5; k++) add('l', 2 + 2 * k, 3, 7);
        // 行 8
        for (let k = 0; k < 5; k++) add('h', 1 + 2 * k, 3, 8);
        // 行 9（白兵）
        for (let k = 0; k < 4; k++) add('r', 1 + 2 * k, 6, 9);
        for (let k = 0; k < 4; k++) add('l', 3 + 2 * k, 6, 9);
        // 行 10（白象）
        for (let k = 0; k < 4; k++) add('h', 2 + 2 * k, 6, 10);
        // 行 11（白大子，从竖右开始）
        add('r', 2, 9, 11); add('l', 4, 9, 11);
        add('r', 4, 9, 11); add('l', 6, 9, 11);
        add('r', 6, 9, 11); add('l', 8, 9, 11);
        cells.forEach((c, i) => { c.id = i; });
        return cells;
    }

    const CELLS = buildBoard();
    const CELL_INDEX = {};
    CELLS.forEach((c) => { CELL_INDEX[key(c.type, c.I, c.J)] = c.id; });

    function verts(type, I, J) {
        if (type === 'h') return [[I - 1, J], [I, J - 1], [I + 1, J], [I, J + 1]];
        if (type === 'l') return [[I - 1, J - 3], [I, J - 2], [I, J], [I - 1, J - 1]];
        return [[I + 1, J - 3], [I + 1, J - 1], [I, J], [I, J - 2]];
    }
    const eq = (p, q) => p[0] === q[0] && p[1] === q[1];
    function center(type, I, J) {
        if (type === 'h') return [I * A, J * B];
        if (type === 'l') return [(I - 0.5) * A, (J - 1.5) * B];
        return [(I + 0.5) * A, (J - 1.5) * B];
    }

    // 预计算邻接
    const EDGE_NB = [], PT_NB = [];
    for (let i = 0; i < CELLS.length; i++) {
        const c = CELLS[i];
        EDGE_NB.push([]);
        PT_NB.push([]);
        const v1 = verts(c.type, c.I, c.J);
        const c1 = center(c.type, c.I, c.J);
        for (let j = 0; j < CELLS.length; j++) {
            if (i === j) continue;
            const d = CELLS[j];
            const v2 = verts(d.type, d.I, d.J);
            let shared = false;
            for (let a = 0; a < 4 && !shared; a++) {
                for (let b = 0; b < 4; b++) {
                    if ((eq(v1[a], v2[b]) && eq(v1[(a + 1) % 4], v2[(b + 1) % 4])) ||
                        (eq(v1[a], v2[(b + 1) % 4]) && eq(v1[(a + 1) % 4], v2[b]))) { shared = true; break; }
                }
            }
            if (shared) { EDGE_NB[i].push(j); continue; }
            // pointwise：穿过 60° 角（短对角线两端；中心 = 2v - 本格中心）
            const c2 = center(d.type, d.I, d.J);
            let sharp = [];
            if (c.type === 'h') sharp = [[c.I, c.J - 1], [c.I, c.J + 1]];
            else if (c.type === 'l') sharp = [[c.I - 1, c.J - 3], [c.I, c.J]];
            else sharp = [[c.I + 1, c.J - 3], [c.I, c.J]];
            for (const v of sharp) {
                const tv = [2 * v[0] * A - c1[0], 2 * v[1] * B - c1[1]];
                if (Math.abs(tv[0] - c2[0]) < 1e-6 && Math.abs(tv[1] - c2[1]) < 1e-6) {
                    PT_NB[i].push(j);
                    break;
                }
            }
        }
    }

    // 直线移动：从 id 沿邻居方向延伸
    function lineMoves(id, nbTable, blockers, side) {
        const out = [];
        for (const n of nbTable[id]) {
            const c = CELLS[id], d = CELLS[n];
            const c1 = center(c.type, c.I, c.J), c2 = center(d.type, d.I, d.J);
            const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
            let cur = n;
            while (true) {
                const cc = CELLS[cur];
                const b = blockers[cc.id];
                if (b) {
                    if (b !== side) out.push(cur);
                    break;
                }
                out.push(cur);
                const cc1 = center(cc.type, cc.I, cc.J);
                const tx = cc1[0] + dx, ty = cc1[1] + dy;
                let next = -1;
                for (const nn of nbTable[cur]) {
                    const n2 = center(CELLS[nn].type, CELLS[nn].I, CELLS[nn].J);
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
        const whiteRow11 = ['r,2,9', 'l,4,9', 'r,4,9', 'l,6,9', 'r,6,9', 'l,8,9'];
        const whitePieces = ['wr', 'wn', 'wq', 'wk', 'wn', 'wr'];
        for (let k = 0; k < 6; k++) board[whiteRow11[k]] = whitePieces[k];
        board['h,4,6'] = 'wb'; board['h,6,6'] = 'wb';
        const whitePawns = ['r,1,6', 'l,3,6', 'r,3,6', 'l,5,6', 'r,5,6', 'l,7,6', 'r,7,6', 'l,9,6'];
        for (const k of whitePawns) board[k] = 'wp';
        const blackRow1 = ['l,3,-6', 'r,3,-6', 'l,5,-6', 'r,5,-6', 'l,7,-6', 'r,7,-6'];
        const blackPieces = ['br', 'bn', 'bq', 'bk', 'bn', 'br'];
        for (let k = 0; k < 6; k++) board[blackRow1[k]] = blackPieces[k];
        board['h,4,-6'] = 'bb'; board['h,6,-6'] = 'bb';
        const blackPawns = ['l,2,-3', 'r,2,-3', 'l,4,-3', 'r,4,-3', 'l,6,-3', 'r,6,-3', 'l,8,-3', 'r,8,-3'];
        for (const k of blackPawns) board[k] = 'bp';
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
    function cellKeyOfId(id) { const c = CELLS[id]; return key(c.type, c.I, c.J); }

    // 生成一步的所有合法目标
    function pseudoMoves(board, id, side) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const blockers = {};
        for (const kk in board) blockers[CELL_INDEX[kk]] = pieceSide(board[kk]);
        const out = [];
        const add = (t) => { if (!out.includes(t)) out.push(t); };
        const type = pc[1];
        if (type === 'r' || type === 'q') {
            for (const t of lineMoves(id, EDGE_NB, blockers, side)) add(t);
        }
        if (type === 'b' || type === 'q') {
            for (const t of lineMoves(id, PT_NB, blockers, side)) add(t);
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'k') {
            for (const n of EDGE_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
            for (const n of PT_NB[id]) { const b = blockers[n]; if (!b || b !== side) add(n); }
        }
        if (type === 'n') {
            for (const e of EDGE_NB[id]) {
                for (const p of PT_NB[e]) { const b = blockers[p]; if (!b || b !== side) add(p); }
            }
            for (const p of PT_NB[id]) {
                for (const e of EDGE_NB[p]) { const b = blockers[e]; if (!b || b !== side) add(e); }
            }
        }
        if (type === 'p') {
            const fwd = side === 'white' ? -1 : 1;
            const c1 = center(CELLS[id].type, CELLS[id].I, CELLS[id].J);
            const fwdNbs = EDGE_NB[id].filter(n => {
                const n2 = center(CELLS[n].type, CELLS[n].I, CELLS[n].J);
                return fwd * (n2[1] - c1[1]) > 0;
            });
            for (const n of fwdNbs) {
                if (blockers[n] === undefined) {
                    add(n);
                    // 首步 2 步
                    if (!board[k].hasMoved) {
                        const cc = CELLS[n];
                        const cc1 = center(cc.type, cc.I, cc.J);
                        const dx = cc1[0] - c1[0], dy = cc1[1] - c1[1];
                        const tx = cc1[0] + dx, ty = cc1[1] + dy;
                        for (const nn of EDGE_NB[n]) {
                            const n3 = center(CELLS[nn].type, CELLS[nn].I, CELLS[nn].J);
                            if (Math.abs(n3[0] - tx) < 1e-6 && Math.abs(n3[1] - ty) < 1e-6 && blockers[nn] === undefined) add(nn);
                        }
                    }
                }
            }
            // 直走直吃（同移动，无斜吃）——上面已含
        }
        return out;
    }

    function findKing(board, side) {
        for (const k in board) {
            if (board[k] === (side === 'white' ? 'wk' : 'bk')) return CELL_INDEX[k];
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
    function applyMove(board, move) {
        const fromK = cellKeyOfId(move.from);
        const toK = cellKeyOfId(move.to);
        const pc = board[fromK];
        const captured = board[toK];
        delete board[fromK];
        board[toK] = { ...pc, hasMoved: true };
        if (move.promote) board[toK] = board[toK][0] + move.promote;
        return captured;
    }

    function legalMovesFor(board, id, side) {
        const k = cellKeyOfId(id);
        const pc = board[k];
        if (!pc || pieceSide(pc) !== side) return [];
        const promoRow = side === 'white' ? 3 : 9;
        const raw = pseudoMoves(board, id, side);
        const legal = [];
        for (const t of raw) {
            const move = { from: id, to: t };
            const captured = applyMove(board, move);
            let promote = false;
            if (pc[1] === 'p' && CELLS[t].row === promoRow) {
                promote = true;
                move.promote = 'q';
            }
            let ok = true;
            const kingId = findKing(board, side);
            if (kingId !== -1 && isAttacked(board, kingId, oppositeSide(side))) ok = false;
            // 还原
            const toK = cellKeyOfId(t);
            const fromK = k;
            delete board[toK];
            board[fromK] = pc;
            if (captured !== undefined) board[toK] = captured;
            if (ok) legal.push({ to: t, promote });
        }
        return legal;
    }

    function allLegalMoves(board, side) {
        const out = [];
        for (const k in board) {
            if (pieceSide(board[k]) !== side) continue;
            const id = CELL_INDEX[k];
            for (const m of legalMovesFor(board, id, side)) {
                out.push({ from: id, to: m.to, promote: m.promote || null });
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
        CELLS, CELL_INDEX, EDGE_NB, PT_NB, key, center, verts,
        PIECE_CHAR, PROMOTE_TYPES, normalizePromote,
        setup, pseudoMoves, legalMovesFor, allLegalMoves, applyMove,
        findKing, isAttacked, isInCheck, hasLegalMove,
        pieceSide, oppositeSide, sideFromSlot, slotFromSide,
        cellKeyOfId,
    };
})();

class RhombicChessRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.editBoardAllowedValues = ['', 'wp', 'wb', 'wn', 'wr', 'wq', 'wk', 'bp', 'bb', 'bn', 'br', 'bq', 'bk'];
        this.boardCells = R.CELLS;
        this.resetToEmpty();
    }

    _pendingPawnPromotion() {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const row = this.sideToMove === 'white' ? 3 : 9;
        for (const c of this.boardCells) {
            if (c.row === row && this.board[R.key(c.type, c.I, c.J)] === pawn) {
                return { row: c.id, col: 0 };
            }
        }
        return null;
    }

    _applyPawnPromotion(id, promote) {
        const pawn = this.sideToMove === 'white' ? 'wp' : 'bp';
        const c = this.boardCells[id];
        const k = R.key(c.type, c.I, c.J);
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
            board: this.board,
            boardCells: this.boardCells,
            boardSize: 72,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: 0, color: this.sideToMove === 'white' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmoveClock,
            inCheck: R.isInCheck(this.board, this.sideToMove),
            pendingPromotion: this._pendingPawnPromotion(),
            moveHistory: this.moveHistory.map((m) => ({ ...m })),
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
            boardRows: 72,
            boardCols: 1,
            moves: this.moveHistory.map((m) => {
                let s = `${m.player[0].toUpperCase()}${m.fromRow}-${m.toRow}`;
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

    _applyMoveCore(fromId, toId, slot, promote) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!Number.isInteger(fromId) || !Number.isInteger(toId)) return { ok: false };
        if (fromId < 0 || fromId >= 72 || toId < 0 || toId >= 72) return { ok: false };
        const legal = R.allLegalMoves(this.board, side);
        const found = legal.find(m => m.from === fromId && m.to === toId);
        if (!found) return { ok: false };

        const piece = R.cellKeyOfId(fromId);
        const fromK = piece;
        const captured = R.applyMove(this.board, found);
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(this.board, opp);
        const promoteUsed = found.promote ? R.normalizePromote(promote) : null;
        const toK = R.cellKeyOfId(toId);
        if (promoteUsed) {
            this.board[toK] = (side === 'white' ? 'w' : 'b') + promoteUsed;
        }

        this.historyBoards.push(JSON.stringify(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push(this.halfmoveClock);

        this.lastFrom = { row: fromId, col: 0 };
        this.lastTo = { row: toId, col: 0 };
        this.moveHistory.push({
            player: slot,
            fromRow: fromId, fromCol: 0, toRow: toId, toCol: 0,
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

    onMatchStarted() {
        this._resolveTurnStartLoss();
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
            let player; let fromId; let toId; let promote = null;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+)-(\d+)(?:=([QRNB]))?$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromId = +m[2]; toId = +m[3];
                if (m[4]) promote = m[4].toLowerCase();
            } else {
                player = entry.player;
                fromId = entry.fromRow; toId = entry.toRow;
                promote = entry.promote || null;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromId, toId, player, promote);
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
                if (!this._applyPawnPromotion(row, promote)) return;
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
                const r = this._applyMoveCore(fromRow, toRow, slot, promote);
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
                    this.recordResultText = slot === 'black' ? '白认输黑胜' : '黑认输白胜';
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

    _undoOne() {
        if (this.historyBoards.length === 0) return;
        this.board = JSON.parse(this.historyBoards.pop());
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'white' ? 1 : 2;
        this.halfmoveClock = this.historyHalfmoves.pop() || 0;
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this._stopClockTicker();
    }
}

RhombicChessRoom.prototype.slotFromSide = R.slotFromSide;
RhombicChessRoom.prototype.sideFromSlot = R.sideFromSlot;

module.exports = {
    RhombicChessRoom,
    R,
    initRoom(room) {
        room.gameLogic = new RhombicChessRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};

