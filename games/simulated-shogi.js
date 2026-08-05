const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/**
 * 模拟日本将棋规则（内联）。
 * 9×9 格内落子；红先；红王黑玉；颜色区分双方。
 * 棋子：王玉飛角金銀桂香步；升变龍馬全圭杏个。
 * 座位：black=红方(先手)，white=黑方(后手)
 */
const R = (function () {
    'use strict';

    const BOARD_H = 9;
    const BOARD_W = 9;

    // 未升变小写，升变大写（金/王不升变）
    const PIECE_CHAR = {
        rk: '王', bk: '玉',
        rr: '飛', br: '飛', rR: '龍', bR: '龍',
        rb: '角', bb: '角', rB: '馬', bB: '馬',
        rg: '金', bg: '金',
        rs: '銀', bs: '銀', rS: '全', bS: '全',
        rn: '桂', bn: '桂', rN: '圭', bN: '圭',
        rl: '香', bl: '香', rL: '杏', bL: '杏',
        rp: '步', bp: '步', rP: '个', bP: '个'
    };

    const HAND_ORDER = ['r', 'b', 'g', 's', 'n', 'l', 'p'];

    function emptyBoard() {
        return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
    }

    function copyBoard(src) {
        return src.map((row) => row.slice());
    }

    function emptyHands() {
        return { red: [], black: [] };
    }

    function copyHands(h) {
        return { red: (h.red || []).slice(), black: (h.black || []).slice() };
    }

    function createInitialBoard() {
        const b = emptyBoard();
        // 黑（后手）在上
        b[0][0] = 'bl'; b[0][1] = 'bn'; b[0][2] = 'bs'; b[0][3] = 'bg'; b[0][4] = 'bk';
        b[0][5] = 'bg'; b[0][6] = 'bs'; b[0][7] = 'bn'; b[0][8] = 'bl';
        // 角在各自左手、飞在各自右手 → 双方对角
        b[1][7] = 'bb'; b[1][1] = 'br';
        for (let c = 0; c < 9; c++) b[2][c] = 'bp';
        // 红（先手）在下
        for (let c = 0; c < 9; c++) b[6][c] = 'rp';
        b[7][1] = 'rb'; b[7][7] = 'rr';
        b[8][0] = 'rl'; b[8][1] = 'rn'; b[8][2] = 'rs'; b[8][3] = 'rg'; b[8][4] = 'rk';
        b[8][5] = 'rg'; b[8][6] = 'rs'; b[8][7] = 'rn'; b[8][8] = 'rl';
        return b;
    }

    function sideColorChar(side) { return side === 'red' ? 'r' : 'b'; }
    function oppositeSide(side) { return side === 'red' ? 'black' : 'red'; }
    function sideFromSlot(slot) { return slot === 'black' ? 'red' : 'black'; }
    function slotFromSide(side) { return side === 'red' ? 'black' : 'white'; }
    function inBounds(row, col) {
        return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
    }

    function pieceType(code) { return code ? code[1] : ''; }
    function pieceColor(code) { return code ? code[0] : ''; }

    function isPromotedType(t) {
        return t === 'R' || t === 'B' || t === 'S' || t === 'N' || t === 'L' || t === 'P';
    }

    function baseType(t) {
        if (t === 'R') return 'r';
        if (t === 'B') return 'b';
        if (t === 'S') return 's';
        if (t === 'N') return 'n';
        if (t === 'L') return 'l';
        if (t === 'P') return 'p';
        return t;
    }

    function promoteType(t) {
        const b = baseType(t);
        if (b === 'r') return 'R';
        if (b === 'b') return 'B';
        if (b === 's') return 'S';
        if (b === 'n') return 'N';
        if (b === 'l') return 'L';
        if (b === 'p') return 'P';
        return t;
    }

    function canPromoteType(t) {
        const b = baseType(t);
        return b === 'r' || b === 'b' || b === 's' || b === 'n' || b === 'l' || b === 'p';
    }

    function findKing(board, side) {
        const code = side === 'red' ? 'rk' : 'bk';
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                if (board[r][c] === code) return { row: r, col: c };
            }
        }
        return null;
    }

    function inPromotionZone(side, row) {
        if (side === 'red') return row <= 2;
        return row >= 6;
    }

    function mustPromote(type, side, toRow) {
        const b = baseType(type);
        if (b === 'p' || b === 'l') {
            return side === 'red' ? toRow === 0 : toRow === 8;
        }
        if (b === 'n') {
            return side === 'red' ? toRow <= 1 : toRow >= 7;
        }
        return false;
    }

    function goldDeltas(side) {
        const f = side === 'red' ? -1 : 1;
        return [[f, 0], [f, -1], [f, 1], [0, -1], [0, 1], [-f, 0]];
    }

    function silverDeltas(side) {
        const f = side === 'red' ? -1 : 1;
        return [[f, 0], [f, -1], [f, 1], [-f, -1], [-f, 1]];
    }

    function kingDeltas() {
        return [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    }

    function pathClearOrtho(board, fr, fc, tr, tc) {
        if (fr !== tr && fc !== tc) return false;
        const dR = Math.sign(tr - fr);
        const dC = Math.sign(tc - fc);
        let r = fr + dR, c = fc + dC;
        while (r !== tr || c !== tc) {
            if (board[r][c] !== '') return false;
            r += dR; c += dC;
        }
        return true;
    }

    function pathClearDiag(board, fr, fc, tr, tc) {
        if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
        const dR = Math.sign(tr - fr);
        const dC = Math.sign(tc - fc);
        let r = fr + dR, c = fc + dC;
        while (r !== tr || c !== tc) {
            if (board[r][c] !== '') return false;
            r += dR; c += dC;
        }
        return true;
    }

    function attacksSquare(piece, fr, fc, tr, tc, board) {
        if (!piece || !inBounds(tr, tc)) return false;
        if (fr === tr && fc === tc) return false;
        const color = piece[0];
        const type = piece[1];
        const side = color === 'r' ? 'red' : 'black';
        const target = board[tr][tc];
        if (target && target[0] === color) return false;
        const dR = tr - fr, dC = tc - fc;
        const aR = Math.abs(dR), aC = Math.abs(dC);
        const forward = side === 'red' ? -1 : 1;

        if (type === 'k') return aR <= 1 && aC <= 1;
        if (type === 'g' || type === 'S' || type === 'N' || type === 'L' || type === 'P') {
            return goldDeltas(side).some(([dr, dc]) => dR === dr && dC === dc);
        }
        if (type === 's') return silverDeltas(side).some(([dr, dc]) => dR === dr && dC === dc);
        if (type === 'n') return dR === 2 * forward && aC === 1;
        if (type === 'l') {
            if (dC !== 0 || Math.sign(dR) !== forward) return false;
            return pathClearOrtho(board, fr, fc, tr, tc);
        }
        if (type === 'p') return dR === forward && dC === 0;
        if (type === 'r') return pathClearOrtho(board, fr, fc, tr, tc);
        if (type === 'b') return pathClearDiag(board, fr, fc, tr, tc);
        if (type === 'R') {
            if (aR <= 1 && aC <= 1) return true;
            return pathClearOrtho(board, fr, fc, tr, tc);
        }
        if (type === 'B') {
            if (aR <= 1 && aC <= 1) return true;
            return pathClearDiag(board, fr, fc, tr, tc);
        }
        return false;
    }

    function isSquareAttackedBy(board, row, col, bySide) {
        const ch = sideColorChar(bySide);
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const p = board[r][c];
                if (!p || p[0] !== ch) continue;
                if (attacksSquare(p, r, c, row, col, board)) return true;
            }
        }
        return false;
    }

    function isInCheck(board, side) {
        const king = findKing(board, side);
        if (!king) return true;
        return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
    }

    function isPseudoLegalMove(piece, fr, fc, tr, tc, board) {
        return attacksSquare(piece, fr, fc, tr, tc, board);
    }

    function applyBoardMove(board, hands, fr, fc, tr, tc, promote) {
        const next = copyBoard(board);
        const nextHands = copyHands(hands);
        const piece = next[fr][fc];
        const side = piece[0] === 'r' ? 'red' : 'black';
        const captured = next[tr][tc];
        if (captured) {
            const bt = baseType(captured[1]);
            if (bt !== 'k') nextHands[side].push(bt);
        }
        let placed = piece;
        const t = piece[1];
        const canProm = canPromoteType(t) && !isPromotedType(t)
            && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
        if (mustPromote(t, side, tr)) {
            placed = piece[0] + promoteType(t);
        } else if (promote && canProm) {
            placed = piece[0] + promoteType(t);
        }
        next[tr][tc] = placed;
        next[fr][fc] = '';
        return { board: next, hands: nextHands, captured: captured || '', placed };
    }

    function hasUnpromotedPawnOnFile(board, side, col) {
        const ch = sideColorChar(side);
        for (let r = 0; r < BOARD_H; r++) {
            if (board[r][col] === ch + 'p') return true;
        }
        return false;
    }

    function dropDestOk(type, side, row) {
        if (type === 'p' || type === 'l') {
            return side === 'red' ? row > 0 : row < 8;
        }
        if (type === 'n') {
            return side === 'red' ? row > 1 : row < 7;
        }
        return true;
    }

    function isLegalDrop(board, hands, side, type, row, col, opts) {
        if (!inBounds(row, col) || board[row][col] !== '') return false;
        if (!dropDestOk(type, side, row)) return false;
        const hand = hands[side] || [];
        if (hand.indexOf(type) < 0) return false;
        if (type === 'p' && hasUnpromotedPawnOnFile(board, side, col)) return false;
        const next = copyBoard(board);
        next[row][col] = sideColorChar(side) + type;
        const nextHands = copyHands(hands);
        const idx = nextHands[side].indexOf(type);
        nextHands[side].splice(idx, 1);
        if (isInCheck(next, side)) return false;
        // 打步詰（检测时应忽略对方打步的二次打步詰递归）
        if (type === 'p' && !(opts && opts.skipUchifuzume)) {
            const opp = oppositeSide(side);
            if (isInCheck(next, opp) && !hasLegalMove(next, nextHands, opp, { skipUchifuzume: true })) {
                return false;
            }
        }
        return true;
    }

    function isLegalMove(board, hands, fr, fc, tr, tc, side, promote) {
        const piece = board[fr] && board[fr][fc];
        if (!piece || piece[0] !== sideColorChar(side)) return false;
        if (!isPseudoLegalMove(piece, fr, fc, tr, tc, board)) return false;
        const t = piece[1];
        const canProm = canPromoteType(t) && !isPromotedType(t)
            && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
        const must = mustPromote(t, side, tr);
        if (must && promote === false) return false;
        if (promote && !canProm && !must) return false;
        const applied = applyBoardMove(board, hands, fr, fc, tr, tc, !!promote || must);
        if (isInCheck(applied.board, side)) return false;
        return true;
    }

    function generateLegalMoves(board, hands, side, opts) {
        const moves = [];
        const ch = sideColorChar(side);
        for (let fr = 0; fr < BOARD_H; fr++) {
            for (let fc = 0; fc < BOARD_W; fc++) {
                const p = board[fr][fc];
                if (!p || p[0] !== ch) continue;
                for (let tr = 0; tr < BOARD_H; tr++) {
                    for (let tc = 0; tc < BOARD_W; tc++) {
                        if (!isPseudoLegalMove(p, fr, fc, tr, tc, board)) continue;
                        const t = p[1];
                        const canProm = canPromoteType(t) && !isPromotedType(t)
                            && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
                        const must = mustPromote(t, side, tr);
                        if (must) {
                            if (isLegalMove(board, hands, fr, fc, tr, tc, side, true)) {
                                moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: true });
                            }
                        } else {
                            if (isLegalMove(board, hands, fr, fc, tr, tc, side, false)) {
                                moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: false });
                            }
                            if (canProm && isLegalMove(board, hands, fr, fc, tr, tc, side, true)) {
                                moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: true });
                            }
                        }
                    }
                }
            }
        }
        const seenDrop = {};
        for (const type of hands[side] || []) {
            for (let r = 0; r < BOARD_H; r++) {
                for (let c = 0; c < BOARD_W; c++) {
                    const key = type + ':' + r + ',' + c;
                    if (seenDrop[key]) continue;
                    if (isLegalDrop(board, hands, side, type, r, c, opts)) {
                        seenDrop[key] = true;
                        moves.push({ kind: 'drop', pieceType: type, toRow: r, toCol: c });
                    }
                }
            }
        }
        return moves;
    }

    function hasLegalMove(board, hands, side, opts) {
        return generateLegalMoves(board, hands, side, opts).length > 0;
    }

    function applyDrop(board, hands, side, type, row, col) {
        const next = copyBoard(board);
        const nextHands = copyHands(hands);
        const idx = nextHands[side].indexOf(type);
        if (idx < 0) return null;
        nextHands[side].splice(idx, 1);
        next[row][col] = sideColorChar(side) + type;
        return { board: next, hands: nextHands };
    }

    function positionKey(board, hands, sideToMove) {
        let s = sideToMove === 'red' ? 'r|' : 'b|';
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                s += board[r][c] || '.';
                s += ',';
            }
            s += ';';
        }
        s += 'H:' + (hands.red || []).slice().sort().join('') + '/' + (hands.black || []).slice().sort().join('');
        return s;
    }

    function judgeRepetition(historyKeys) {
        if (!historyKeys || historyKeys.length < 4) return null;
        const cur = historyKeys[historyKeys.length - 1];
        let count = 0;
        for (let i = 0; i < historyKeys.length; i++) {
            if (historyKeys[i] === cur) count++;
        }
        if (count >= 4) return { result: 'draw', reason: 'sennichite' };
        return null;
    }

    function sortedHand(hand) {
        const arr = (hand || []).slice();
        arr.sort((a, b) => HAND_ORDER.indexOf(a) - HAND_ORDER.indexOf(b));
        return arr;
    }

    function pieceLabel(code) {
        return PIECE_CHAR[code] || '?';
    }

    function handPieceLabel(type) {
        return PIECE_CHAR['r' + type] || PIECE_CHAR['r' + promoteType(type)] || type;
    }

    function moveCanOfferPromote(board, fr, fc, tr, tc, side) {
        const piece = board[fr][fc];
        if (!piece) return false;
        const t = piece[1];
        if (!canPromoteType(t) || isPromotedType(t)) return false;
        if (mustPromote(t, side, tr)) return false;
        return inPromotionZone(side, fr) || inPromotionZone(side, tr);
    }

    return {
        BOARD_H, BOARD_W, PIECE_CHAR, HAND_ORDER,
        emptyBoard, copyBoard, emptyHands, copyHands, createInitialBoard,
        sideColorChar, oppositeSide, sideFromSlot, slotFromSide, inBounds,
        pieceType, baseType, promoteType, canPromoteType, isPromotedType, mustPromote,
        findKing, isInCheck, isPseudoLegalMove, isLegalMove, isLegalDrop,
        applyBoardMove, applyDrop, generateLegalMoves, hasLegalMove,
        positionKey, judgeRepetition, sortedHand, pieceLabel, handPieceLabel,
        moveCanOfferPromote, inPromotionZone
    };
})();

class SimulatedShogiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
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
                this.recordResultText = lostSlot === 'black' ? '红超时黑胜' : '黑超时红胜';
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
                    ok: true, timed: v.timed, mainMinutes: v.mainMinutes,
                    byoyomiSeconds: v.byoyomiSeconds, maxTimeouts: v.maxTimeouts
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
        } else this.tcClock = null;
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
            this.recordResultText = lostSlot === 'black' ? '红超时黑胜' : '黑超时红胜';
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

    getMoveCount() { return this.moveHistory.length; }

    getState() {
        return {
            board: this.board,
            hands: {
                red: R.sortedHand(this.hands.red),
                black: R.sortedHand(this.hands.black)
            },
            boardSize: R.BOARD_W,
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'red' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'red' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            inCheck: R.isInCheck(this.board, this.sideToMove),
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
        return this.moveHistory.map((m) => ({ ...m, type: m.kind === 'drop' ? 'drop' : 'move' }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '模拟日本将棋',
            gameId: 'simulated-shogi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => {
                if (m.kind === 'drop') {
                    return `${m.player[0].toUpperCase()}D${m.pieceType}${m.toRow},${m.toCol}`;
                }
                let s = `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`;
                if (m.promote) s += '+';
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
        this.board = R.createInitialBoard();
        this.hands = R.emptyHands();
        this.sideToMove = 'red';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHands = [];
        this.historySides = [];
        this.historyKeys = [R.positionKey(this.board, this.hands, this.sideToMove)];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
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
        if (!R.isLegalMove(this.board, this.hands, fromRow, fromCol, toRow, toCol, side, promote)) return { ok: false };

        this.historyBoards.push(R.copyBoard(this.board));
        this.historyHands.push(R.copyHands(this.hands));
        this.historySides.push(this.sideToMove);

        const applied = R.applyBoardMove(this.board, this.hands, fromRow, fromCol, toRow, toCol, !!promote);
        this.board = applied.board;
        this.hands = applied.hands;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            kind: 'move', player: slot,
            fromRow, fromCol, toRow, toCol,
            promote: !!promote || R.mustPromote(this.historyBoards[this.historyBoards.length - 1][fromRow][fromCol][1], side, toRow),
            piece: applied.placed, captured: applied.captured
        });
        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.hands, this.sideToMove));
        const gaveCheck = R.isInCheck(this.board, this.sideToMove);
        return { ok: true, gaveCheck };
    }

    _applyDropCore(pieceType, toRow, toCol, slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const t = String(pieceType || '').toLowerCase();
        if (!R.isLegalDrop(this.board, this.hands, side, t, toRow, toCol)) return { ok: false };

        this.historyBoards.push(R.copyBoard(this.board));
        this.historyHands.push(R.copyHands(this.hands));
        this.historySides.push(this.sideToMove);

        const applied = R.applyDrop(this.board, this.hands, side, t, toRow, toCol);
        this.board = applied.board;
        this.hands = applied.hands;
        this.lastFrom = null;
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            kind: 'drop', player: slot, pieceType: t, toRow, toCol,
            piece: R.sideColorChar(side) + t, captured: ''
        });
        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.hands, this.sideToMove));
        const gaveCheck = R.isInCheck(this.board, this.sideToMove);
        return { ok: true, gaveCheck };
    }

    _resolveAfterMove() {
        const side = this.sideToMove;
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, this.hands, side);
        if (!canMove) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            const text = inCheck
                ? (side === 'black' ? '红将死黑胜' : '黑将死红胜')
                : (side === 'black' ? '红胜（黑无着）' : '黑胜（红无着）');
            this._endGame(winnerSlot, text);
            return;
        }
        const rep = R.judgeRepetition(this.historyKeys);
        if (rep) this._endGame('draw', '千日手作和');
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'simulated-shogi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要模拟日本将棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const entry = rawMoves[i];
            let r;
            if (typeof entry === 'string') {
                const drop = entry.match(/^([BW])D([rbgslnp])(\d+),(\d+)$/i);
                const mov = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(\+)?$/i);
                if (drop) {
                    const player = drop[1].toUpperCase() === 'B' ? 'black' : 'white';
                    if (player !== R.slotFromSide(this.sideToMove)) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                    r = this._applyDropCore(drop[2].toLowerCase(), +drop[3], +drop[4], player);
                } else if (mov) {
                    const player = mov[1].toUpperCase() === 'B' ? 'black' : 'white';
                    if (player !== R.slotFromSide(this.sideToMove)) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                    r = this._applyMoveCore(+mov[2], +mov[3], +mov[4], +mov[5], player, !!mov[6]);
                } else {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
            } else if (entry.kind === 'drop') {
                r = this._applyDropCore(entry.pieceType, entry.toRow, entry.toCol, entry.player);
            } else {
                r = this._applyMoveCore(entry.fromRow, entry.fromCol, entry.toRow, entry.toCol, entry.player, !!entry.promote);
            }
            if (!r || !r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
            if (this.gameOver) break;
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { moves: this.wireMoveCoords(), resultText: this.recordResultText }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor': qiProtocol.selectColor(this, ws, msg); break;
            case 'timeControlSubmit': this._handleTimeControlSubmit(ws, msg); break;
            case 'timeControlAccept': this._handleTimeControlAccept(ws); break;
            case 'exportRecord': qiProtocol.exportRecord(this, ws); break;
            case 'importRecord': qiProtocol.importRecord(this, ws, msg); break;
            case 'resetRoom': qiProtocol.resetRoomToEmpty(this, ws); break;
            case 'move': {
                if (this.gameOver || !this._timeAllowsPlay(slot) || !this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot, !!msg.promote);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'drop': {
                if (this.gameOver || !this._timeAllowsPlay(slot) || !this._drainClockBeforeMove(slot)) return;
                const { toRow, toCol, pieceType } = msg;
                if (![toRow, toCol].every((n) => Number.isInteger(n))) return;
                const r = this._applyDropCore(pieceType, toRow, toCol, slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'drop', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver || this.moveHistory.length === 0) return;
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
                    if (requester && requester.readyState === 1) requester.send(JSON.stringify({ type: 'undoRejected' }));
                    return;
                }
                this._undoOne();
                this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                break;
            }
            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver && slot) {
                    this.recordResultText = slot === 'black' ? '红认输黑胜' : '黑认输红胜';
                    this._stopClockTicker();
                }
                break;
            case 'requestNewGame': qiProtocol.requestNewGame(this, ws, slot); break;
            case 'newGameResponse': qiProtocol.newGameResponse(this, ws, msg); break;
            case 'requestDraw': qiProtocol.requestDraw(this, ws, slot); break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '双方同意作和';
                        this._stopClockTicker();
                    }
                });
                break;
            default: break;
        }
    }

    _undoOne() {
        if (this.historyBoards.length === 0) return;
        this.board = this.historyBoards.pop();
        this.hands = this.historyHands.pop();
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.moveHistory.pop();
        this.historyKeys.pop();
        const last = this.moveHistory[this.moveHistory.length - 1];
        if (last) {
            this.lastFrom = last.kind === 'drop' ? null : { row: last.fromRow, col: last.fromCol };
            this.lastTo = { row: last.toRow, col: last.toCol };
        } else {
            this.lastFrom = null;
            this.lastTo = null;
        }
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
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
        room.gameLogic = new SimulatedShogiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    // 供测试
    _rules: R
};
