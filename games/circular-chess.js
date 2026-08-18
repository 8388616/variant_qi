const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/** 国际象棋规则（内联，无独立 rules 文件） */
const R = (function () {
    'use strict';
    const RINGS = 4, SECTORS = 16;
    const key = (ring, sector) => ring + ',' + sector;
    const PIECE_CHAR = {
        wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
        bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
    };
    const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

    // 初始布局：白方下方居中 sector 6-9（从右到左）
    // ring 0（最内）：兵后王兵；ring 1：兵象象兵；ring 2：兵马马兵；ring 3（最外）：兵车车兵
    // 黑方 = 白方旋转 180°（sector +8）
    const WHITE_LAYOUT = [
        ['wp', 'wq', 'wk', 'wp'],
        ['wp', 'wb', 'wb', 'wp'],
        ['wp', 'wn', 'wn', 'wp'],
        ['wp', 'wr', 'wr', 'wp']
    ];
    // 兵的方向（环向）：左侧兵向左、右侧兵向右
    // 白方：sector 6（右/东）往右 = 逆时针(-1)、sector 9（左/西）往左 = 顺时针(+1)
    // 黑方：sector 14（右/西）往右 = 逆时针(-1)、sector 1（左/东）往左 = 顺时针(+1)
    function pawnDir(side, sector) {
        if (side === 'white') return sector === 6 ? -1 : (sector === 9 ? 1 : 0);
        return sector === 14 ? -1 : (sector === 1 ? 1 : 0);
    }

    function setup() {
        const board = {};
        for (let r = 0; r < RINGS; r++) {
            for (let k = 0; k < 4; k++) {
                const w = WHITE_LAYOUT[r][k];
                board[key(r, 6 + k)] = w;
                board[key(r, (6 + k + 8) % 16)] = 'b' + w.slice(1);
            }
            // 兵存方向与步数（对象）
            for (const s of [6, 9, 14, 1]) {
                const k = key(r, s);
                const pc = board[k];
                board[k] = { 0: pc[0], 1: pc[1], dir: pawnDir(pc[0] === 'w' ? 'white' : 'black', s), steps: 0 };
            }
        }
        return board;
    }

    function pieceSide(pc) { return pc[0] === 'w' ? 'white' : 'black'; }
    function oppositeSide(side) { return side === 'white' ? 'black' : 'white'; }
    function sideFromSlot(slot) { return slot === 'black' ? 'white' : 'black'; }
    function slotFromSide(side) { return side === 'white' ? 'black' : 'white'; }
    function normalizePromote(p) {
        p = String(p || '').toLowerCase();
        return PROMOTE_TYPES.indexOf(p) >= 0 ? p : 'q';
    }
    function inBounds(ring) { return ring >= 0 && ring < RINGS; }
    /** 兵升级：累计走满 6 步（首步 2 步算 2 步） */
    function needsPromotion(pc) {
        return pc && pc[1] === 'p' && (pc.steps || 0) >= 6;
    }

    /**
     * 直线延伸：径向（内外）、环向（沿环）、斜向（径向+环向各一步）。
     * noLoop：环向直线不允许绕一整圈回到原点（车/后）。
     */
    function lineTargets(board, ring, sector, dirs, side, noLoop) {
        const out = [];
        const ch = side[0];
        for (const [dR, dS] of dirs) {
            let r = ring + dR;
            let s = (sector + dS + SECTORS) % SECTORS;
            let steps = 0;
            while (inBounds(r) && (!noLoop || !(steps > 0 && s === sector))) {
                const pc = board[key(r, s)];
                if (pc) {
                    if (pc[0] !== ch) out.push({ ring: r, sector: s });
                    break;
                }
                out.push({ ring: r, sector: s });
                r += dR;
                s = (s + dS + SECTORS) % SECTORS;
                steps++;
            }
        }
        return out;
    }

    /** 攻击判定（兵按斜吃） */
    function attacksSquare(pc, fromRing, fromSector, toRing, toSector, board) {
        if (!pc || !inBounds(toRing)) return false;
        if (fromRing === toRing && fromSector === toSector) return false;
        const type = pc[1];
        const dR = toRing - fromRing;
        let dS = toSector - fromSector;
        if (dS > 8) dS -= 16;
        if (dS < -8) dS += 16;
        const aR = Math.abs(dR), aS = Math.abs(dS);
        if (type === 'k') return aR <= 1 && aS <= 1 && (aR + aS) > 0;
        if (type === 'n') return (aR === 2 && aS === 1) || (aR === 1 && aS === 2);
        if (type === 'p') {
            const dir = pc.dir || 0;
            return aR === 1 && dS === dir;
        }
        if (type === 'r') {
            if (dR !== 0 && dS !== 0) return false;
            const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
            const d = lineTargets(board, fromRing, fromSector, dirs, pieceSide(pc), dS !== 0);
            return d.some(t => t.ring === toRing && t.sector === toSector);
        }
        if (type === 'b') {
            if (aR !== aS) return false;
            const d = lineTargets(board, fromRing, fromSector, [[dR > 0 ? 1 : -1, dS > 0 ? 1 : -1]], pieceSide(pc), false);
            return d.some(t => t.ring === toRing && t.sector === toSector);
        }
        if (type === 'q') {
            if (dR !== 0 && dS !== 0 && aR !== aS) return false;
            const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
            const d = lineTargets(board, fromRing, fromSector, dirs, pieceSide(pc), dS !== 0 && dR === 0);
            return d.some(t => t.ring === toRing && t.sector === toSector);
        }
        return false;
    }

    function isSquareAttackedBy(board, ring, sector, bySide) {
        const ch = bySide[0];
        for (let r = 0; r < RINGS; r++) {
            for (let s = 0; s < SECTORS; s++) {
                const pc = board[key(r, s)];
                if (!pc || pc[0] !== ch) continue;
                if (attacksSquare(pc, r, s, ring, sector, board)) return true;
            }
        }
        return false;
    }

    function findKing(board, side) {
        const code = side[0] + 'k';
        for (let r = 0; r < RINGS; r++) {
            for (let s = 0; s < SECTORS; s++) {
                const pc = board[key(r, s)];
                if (pc && pc[0] + pc[1] === code) return { ring: r, sector: s };
            }
        }
        return null;
    }

    function isInCheck(board, side) {
        const king = findKing(board, side);
        if (!king) return true;
        return isSquareAttackedBy(board, king.ring, king.sector, oppositeSide(side));
    }

    /** 几何走法（不含将军应将） */
    function isPseudoLegalMove(pc, fromRing, fromSector, toRing, toSector, board) {
        if (!pc || !inBounds(toRing)) return false;
        if (fromRing === toRing && fromSector === toSector) return false;
        const type = pc[1];
        const color = pc[0];
        const target = board[key(toRing, toSector)];
        if (target && target[0] === color) return false;
        let dS = toSector - fromSector;
        if (dS > 8) dS -= 16;
        if (dS < -8) dS += 16;
        const dR = toRing - fromRing;
        const aR = Math.abs(dR), aS = Math.abs(dS);
        const side = color === 'w' ? 'white' : 'black';

        if (type === 'n') return (aR === 2 && aS === 1) || (aR === 1 && aS === 2);
        if (type === 'b') {
            if (aR !== aS) return false;
            return lineTargets(board, fromRing, fromSector, [[dR > 0 ? 1 : -1, dS > 0 ? 1 : -1]], side, false)
                .some(t => t.ring === toRing && t.sector === toSector);
        }
        if (type === 'r') {
            if (dR !== 0 && dS !== 0) return false;
            const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
            return lineTargets(board, fromRing, fromSector, dirs, side, dS !== 0)
                .some(t => t.ring === toRing && t.sector === toSector);
        }
        if (type === 'q') {
            if (dR !== 0 && dS !== 0 && aR !== aS) return false;
            const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
            return lineTargets(board, fromRing, fromSector, dirs, side, dS !== 0 && dR === 0)
                .some(t => t.ring === toRing && t.sector === toSector);
        }
        if (type === 'k') return aR <= 1 && aS <= 1 && (aR + aS) > 0;
        if (type === 'p') {
            const dir = pc.dir || 0;
            if (dir === 0) return false;
            // 直走：1 步（dS=dir）或首步 2 步（dS=2*dir）
            if (dR === 0 && !target && aS >= 1 && aS <= 2 && (dS === dir || dS === 2 * dir)) {
                if (aS === 1) return true;
                if (aS === 2 && !pc.hasMoved && !board[key(fromRing, (fromSector + dir + SECTORS) % SECTORS)]) return true;
                return false;
            }
            if (dS === dir && aR === 1 && target && target[0] !== color) return true;
            return false;
        }
        return false;
    }

    /** 执行走子，返回 { board, captured, wasPawnMove } */
    function applyMoveOnBoard(board, fromRing, fromSector, toRing, toSector, promote) {
        const next = {};
        for (const k in board) next[k] = board[k] && typeof board[k] === 'object' ? { ...board[k] } : board[k];
        const piece = next[key(fromRing, fromSector)];
        const captured = next[key(toRing, toSector)] || '';
        let moveSteps = 0;
        if (piece && piece[1] === 'p') {
            let dS = toSector - fromSector;
            if (dS > 8) dS -= 16;
            if (dS < -8) dS += 16;
            moveSteps = Math.abs(dS) === 2 ? 2 : 1;
        }
        next[key(toRing, toSector)] = piece;
        delete next[key(fromRing, fromSector)];
        if (piece && piece[1] === 'p') {
            const steps = (piece.steps || 0) + moveSteps;
            next[key(toRing, toSector)] = { 0: piece[0], 1: piece[1], dir: piece.dir, steps, hasMoved: true };
            if (needsPromotion(next[key(toRing, toSector)])) {
                const t = normalizePromote(promote);
                next[key(toRing, toSector)] = { 0: piece[0], 1: t, dir: piece.dir, steps, hasMoved: true };
            }
        }
        return { board: next, captured, wasPawnMove: piece && piece[1] === 'p' };
    }

    function isLegalMove(board, fromRing, fromSector, toRing, toSector, side, promote) {
        const piece = board[key(fromRing, fromSector)];
        if (!piece || piece[0] !== side[0]) return false;
        if (!isPseudoLegalMove(piece, fromRing, fromSector, toRing, toSector, board)) return false;
        const applied = applyMoveOnBoard(board, fromRing, fromSector, toRing, toSector, promote);
        if (isInCheck(applied.board, side)) return false;
        return true;
    }

    function generateLegalMoves(board, side) {
        const moves = [];
        for (let r = 0; r < RINGS; r++) {
            for (let s = 0; s < SECTORS; s++) {
                const p = board[key(r, s)];
                if (!p || p[0] !== side[0]) continue;
                for (let tr = 0; tr < RINGS; tr++) {
                    for (let ts = 0; ts < SECTORS; ts++) {
                        if (!isPseudoLegalMove(p, r, s, tr, ts, board)) continue;
                        let dS = ts - s;
                        if (dS > 8) dS -= 16;
                        if (dS < -8) dS += 16;
                        const willPromote = p[1] === 'p' && (p.steps || 0) + (Math.abs(dS) === 2 ? 2 : 1) >= 6;
                        if (willPromote) {
                            for (const promo of PROMOTE_TYPES) {
                                if (isLegalMove(board, r, s, tr, ts, side, promo)) {
                                    moves.push({ fromRing: r, fromSector: s, toRing: tr, toSector: ts, promote: promo, capture: !!board[key(tr, ts)] });
                                }
                            }
                        } else if (isLegalMove(board, r, s, tr, ts, side, null)) {
                            moves.push({ fromRing: r, fromSector: s, toRing: tr, toSector: ts, promote: null, capture: !!board[key(tr, ts)] });
                        }
                    }
                }
            }
        }
        return moves;
    }

    function hasLegalMove(board, side) {
        return generateLegalMoves(board, side).length > 0;
    }

    return {
        RINGS, SECTORS, key, PIECE_CHAR, PROMOTE_TYPES,
        setup, pawnDir, needsPromotion, normalizePromote,
        isSquareAttackedBy, isInCheck, isPseudoLegalMove, applyMoveOnBoard,
        isLegalMove, generateLegalMoves, hasLegalMove,
        findKing, lineTargets, attacksSquare,
        pieceSide, oppositeSide, sideFromSlot, slotFromSide,
    };
})();

/**
 * 协议座位：black=白方(先手)，white=黑方(后手)
 */
class RingChessRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.editBoardAllowedValues = ['', 'wp', 'wb', 'wn', 'wr', 'wq', 'wk', 'bp', 'bb', 'bn', 'br', 'bq', 'bk'];
        this.boardRows = R.RINGS;
        this.boardCols = R.SECTORS;
        this.resetToEmpty();
    }

    _pendingPawnPromotion() {
        // 兵已走满 6 步且未升变（防御；正常流程走子时直接带 promote）
        for (let r = 0; r < R.RINGS; r++) {
            for (let s = 0; s < R.SECTORS; s++) {
                const pc = this.board[R.key(r, s)];
                if (pc && pc[1] === 'p' && (pc.steps || 0) >= 6) return { ring: r, sector: s };
            }
        }
        return null;
    }

    _applyPawnPromotion(ring, sector, promote) {
        const pc = this.board[R.key(ring, sector)];
        if (!pc || pc[1] !== 'p' || (pc.steps || 0) < 6) return false;
        this.board[R.key(ring, sector)] = { 0: pc[0], 1: R.normalizePromote(promote), dir: pc.dir, steps: pc.steps, hasMoved: true };
        return true;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    /** 编辑棋盘：客户端提交 flat 数组（64 项，'' 或棋子码），转回对象 board */
    applyEditBoard(ws, msg) {
        const edited = msg.board;
        if (!Array.isArray(edited) || edited.length !== R.RINGS * R.SECTORS) {
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
                const ring = Math.floor(i / R.SECTORS);
                const sector = i % R.SECTORS;
                if (v[1] === 'p') {
                    next[R.key(ring, sector)] = { 0: v[0], 1: 'p', dir: R.pawnDir(v[0] === 'w' ? 'white' : 'black', sector), steps: 0 };
                } else {
                    next[R.key(ring, sector)] = v;
                }
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
            board: this.board,
            boardSize: 64,
            boardRows: R.RINGS,
            boardCols: R.SECTORS,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.ring, col: this.lastTo.sector, color: this.sideToMove === 'white' ? 2 : 1 }] : [],
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
            fromRow: m.fromRing,
            fromCol: m.fromSector,
            toRow: m.toRing,
            toCol: m.toSector,
            piece: m.piece,
            captured: m.captured || '',
            promote: m.promote || null
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '环国际象棋',
            gameId: 'circular-chess',
            boardRows: R.RINGS,
            boardCols: R.SECTORS,
            moves: this.moveHistory.map((m) => {
                let s = `${m.player[0].toUpperCase()}${m.fromRing},${m.fromSector}-${m.toRing},${m.toSector}`;
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

    _applyMoveCore(fromRing, fromSector, toRing, toSector, slot, promote) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!Number.isInteger(fromRing) || !Number.isInteger(fromSector) || !Number.isInteger(toRing) || !Number.isInteger(toSector)) return { ok: false };
        const legal = R.generateLegalMoves(this.board, side);
        const found = legal.find(m => m.fromRing === fromRing && m.fromSector === fromSector
            && m.toRing === toRing && m.toSector === toSector
            && (m.promote || null) === (promote || null));
        if (!found) return { ok: false };

        const piece = this.board[R.key(fromRing, fromSector)];
        const applied = R.applyMoveOnBoard(this.board, fromRing, fromSector, toRing, toSector, promote);
        this.board = applied.board;
        const captured = applied.captured;
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(this.board, opp);

        this.historyBoards.push(JSON.stringify(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push(this.halfmoveClock);

        this.lastFrom = { ring: fromRing, sector: fromSector };
        this.lastTo = { ring: toRing, sector: toSector };
        const pieceLabel = this.board[R.key(toRing, toSector)];
        this.moveHistory.push({
            player: slot,
            fromRing, fromSector, toRing, toSector,
            piece: pieceLabel ? pieceLabel[0] + pieceLabel[1] : piece[0] + piece[1],
            captured: captured ? (captured[0] + captured[1]) : '',
            promote: found.promote || null
        });

        this.halfmoveClock = (captured || piece[1] === 'p') ? 0 : this.halfmoveClock + 1;
        this.sideToMove = opp;
        this.currentPlayer = opp === 'white' ? 1 : 2;
        this.historyKeys.push(JSON.stringify(this.board));

        return { ok: true, gaveCheck, captured: !!captured };
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

    /** 开局判定（编辑盘面）：1 无王判负；2 单王被将军且无法应将判负；3 无子可动（其余情况）判和 */
    onMatchStarted() {
        this._resolveTurnStartLoss();
        if (this.gameOver) return;
        const side = this.sideToMove;
        let kingCount = 0;
        for (const k in this.board) {
            const pc = this.board[k];
            if (pc && pc[0] === side[0] && pc[1] === 'k') kingCount++;
        }
        if (R.hasLegalMove(this.board, side)) return;
        if (kingCount === 1 && R.isInCheck(this.board, side)) {
            // 单王被将军且无法应将 → 判负
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            this._endGame(winnerSlot, side === 'white' ? '白方被将死黑胜' : '黑方被将死白胜');
        } else {
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
        if (!data || data.gameId !== 'circular-chess') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要环国际象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRing; let fromSector; let toRing; let toSector; let promote = null;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(?:=([QRNB]))?$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromRing = +m[2]; fromSector = +m[3]; toRing = +m[4]; toSector = +m[5];
                if (m[6]) promote = m[6].toLowerCase();
            } else {
                player = entry.player;
                fromRing = entry.fromRing; fromSector = entry.fromSector; toRing = entry.toRing; toSector = entry.toSector;
                promote = entry.promote || null;
            }
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromRing, fromSector, toRing, toSector, player, promote);
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
            case 'editBoard':
                this.applyEditBoard(ws, msg);
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
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this._stopClockTicker();
    }
}

module.exports = {
    R,
    initRoom(room) {
        room.gameLogic = new RingChessRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
