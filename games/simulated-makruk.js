const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/**
 * 模拟泰国象棋（Makruk）规则（内联）。
 * 8×8 格内落子；红先。棋子：王士象馬車兵。
 * 座位：black=红方(先手)，white=黑方(后手)
 */
const R = (function () {
    'use strict';

    const BOARD_H = 8;
    const BOARD_W = 8;

    // k王 m士(籽) e象(官) n馬 r車 p兵；兵升变后为 m
    const PIECE_CHAR = {
        rk: '王', rm: '士', re: '象', rn: '馬', rr: '車', rp: '兵',
        bk: '王', bm: '士', be: '象', bn: '馬', br: '車', bp: '兵'
    };

    function emptyBoard() {
        return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
    }

    function copyBoard(src) {
        return src.map((row) => row.slice());
    }

    function createInitialBoard() {
        const b = emptyBoard();
        // 黑在上：旋转对称 — 士在 D、将在 E；兵在第 3 横排（row 2）
        b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'bm';
        b[0][4] = 'bk'; b[0][5] = 'be'; b[0][6] = 'bn'; b[0][7] = 'br';
        for (let c = 0; c < 8; c++) b[2][c] = 'bp';

        // 红在下：王在 D、士在 E；兵在第 3 横排（row 5）
        for (let c = 0; c < 8; c++) b[5][c] = 'rp';
        b[7][0] = 'rr'; b[7][1] = 'rn'; b[7][2] = 're'; b[7][3] = 'rk';
        b[7][4] = 'rm'; b[7][5] = 're'; b[7][6] = 'rn'; b[7][7] = 'rr';
        return b;
    }

    function sideColorChar(side) { return side === 'red' ? 'r' : 'b'; }
    function oppositeSide(side) { return side === 'red' ? 'black' : 'red'; }
    function sideFromSlot(slot) { return slot === 'black' ? 'red' : 'black'; }
    function slotFromSide(side) { return side === 'red' ? 'black' : 'white'; }
    function inBounds(row, col) {
        return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
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

    /** 兵到达己方第6横排则升变为士 */
    function pawnPromotesAt(side, toRow) {
        if (side === 'red') return toRow <= 2; // rank 6,7,8 from red → rows 2,1,0
        return toRow >= 5;
    }

    function attacksSquare(piece, fr, fc, tr, tc, board) {
        if (!piece || !inBounds(tr, tc)) return false;
        if (fr === tr && fc === tc) return false;
        const color = piece[0];
        const type = piece[1];
        const target = board[tr][tc];
        if (target && target[0] === color) return false;
        const dR = tr - fr, dC = tc - fc;
        const aR = Math.abs(dR), aC = Math.abs(dC);
        const side = color === 'r' ? 'red' : 'black';
        const forward = side === 'red' ? -1 : 1;

        if (type === 'k') return aR <= 1 && aC <= 1;
        if (type === 'm') return aR === 1 && aC === 1;
        if (type === 'e') {
            // 象：一步斜，或一步前
            if (aR === 1 && aC === 1) return true;
            return dR === forward && dC === 0;
        }
        if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);
        if (type === 'r') return pathClearOrtho(board, fr, fc, tr, tc);
        if (type === 'p') {
            // 吃：斜前一步（攻击用）
            return dR === forward && aC === 1;
        }
        return false;
    }

    function isPseudoLegalMove(piece, fr, fc, tr, tc, board) {
        if (!piece || !inBounds(tr, tc)) return false;
        if (fr === tr && fc === tc) return false;
        const color = piece[0];
        const type = piece[1];
        const target = board[tr][tc];
        if (target && target[0] === color) return false;
        const dR = tr - fr, dC = tc - fc;
        const aR = Math.abs(dR), aC = Math.abs(dC);
        const side = color === 'r' ? 'red' : 'black';
        const forward = side === 'red' ? -1 : 1;

        if (type === 'p') {
            // 直走不吃；斜吃
            if (dC === 0 && dR === forward && !target) return true;
            if (aC === 1 && dR === forward && target && target[0] !== color) return true;
            return false;
        }
        return attacksSquare(piece, fr, fc, tr, tc, board);
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

    function applyMoveOnBoard(board, fr, fc, tr, tc) {
        const next = copyBoard(board);
        const piece = next[fr][fc];
        const captured = next[tr][tc] || '';
        const side = piece[0] === 'r' ? 'red' : 'black';
        let placed = piece;
        if (piece[1] === 'p' && pawnPromotesAt(side, tr)) {
            placed = piece[0] + 'm';
        }
        next[tr][tc] = placed;
        next[fr][fc] = '';
        return { board: next, captured, placed, wasPawnMove: piece[1] === 'p' };
    }

    function isLegalMove(board, fr, fc, tr, tc, side) {
        const piece = board[fr] && board[fr][fc];
        if (!piece || piece[0] !== sideColorChar(side)) return false;
        if (!isPseudoLegalMove(piece, fr, fc, tr, tc, board)) return false;
        const applied = applyMoveOnBoard(board, fr, fc, tr, tc);
        if (isInCheck(applied.board, side)) return false;
        return true;
    }

    function generateLegalMoves(board, side) {
        const moves = [];
        const ch = sideColorChar(side);
        for (let fr = 0; fr < BOARD_H; fr++) {
            for (let fc = 0; fc < BOARD_W; fc++) {
                const p = board[fr][fc];
                if (!p || p[0] !== ch) continue;
                for (let tr = 0; tr < BOARD_H; tr++) {
                    for (let tc = 0; tc < BOARD_W; tc++) {
                        if (isLegalMove(board, fr, fc, tr, tc, side)) {
                            moves.push({
                                fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                                capture: !!board[tr][tc]
                            });
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

    function hasUnpromotedPawn(board) {
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const p = board[r][c];
                if (p && p[1] === 'p') return true;
            }
        }
        return false;
    }

    function isInsufficientMaterial(board) {
        // 仅王 / 王+单士或单象或单马 通常无法强制将杀，作和简化
        const extras = [];
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const p = board[r][c];
                if (!p || p[1] === 'k') continue;
                if (p[1] === 'r' || p[1] === 'p') return false;
                extras.push(p[1]);
            }
        }
        if (extras.length === 0) return true;
        if (extras.length === 1) {
            const t = extras[0];
            return t === 'm' || t === 'e' || t === 'n';
        }
        if (extras.length === 2 && extras[0] === 'm' && extras[1] === 'm') return true;
        if (extras.length === 2 && extras[0] === 'n' && extras[1] === 'n') return true;
        return false;
    }

    function positionKey(board, sideToMove) {
        let s = sideToMove === 'red' ? 'r|' : 'b|';
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                s += board[r][c] || '.';
                s += ',';
            }
            s += ';';
        }
        return s;
    }

    function judgeRepetition(historyKeys) {
        if (!historyKeys || historyKeys.length < 3) return null;
        const cur = historyKeys[historyKeys.length - 1];
        let count = 0;
        for (let i = 0; i < historyKeys.length; i++) {
            if (historyKeys[i] === cur) count++;
        }
        if (count >= 3) return { result: 'draw', reason: 'repetition' };
        return null;
    }

    function pieceLabel(code) {
        return PIECE_CHAR[code] || '?';
    }

    return {
        BOARD_H, BOARD_W, PIECE_CHAR,
        emptyBoard, copyBoard, createInitialBoard,
        sideColorChar, oppositeSide, sideFromSlot, slotFromSide, inBounds,
        findKing, isInCheck, isPseudoLegalMove, applyMoveOnBoard, isLegalMove,
        generateLegalMoves, hasLegalMove, hasUnpromotedPawn, isInsufficientMaterial,
        positionKey, judgeRepetition, pieceLabel, pawnPromotesAt
    };
})();

class SimulatedMakrukRoom extends QiTwoPlayerRoomBase {
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
            noPawnMoveCount: this.noPawnMoveCount,
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
        return this.moveHistory.map((m) => ({
            type: 'move', player: m.player,
            fromRow: m.fromRow, fromCol: m.fromCol, toRow: m.toRow, toCol: m.toCol,
            piece: m.piece, captured: m.captured || ''
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '模拟泰国象棋',
            gameId: 'simulated-makruk',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) =>
                `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
            ),
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
        this.sideToMove = 'red';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySides = [];
        this.historyNoPawn = [];
        this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.noPawnMoveCount = 0;
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

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!R.isLegalMove(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const applied = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyNoPawn.push(this.noPawnMoveCount);

        this.board = applied.board;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot, fromRow, fromCol, toRow, toCol,
            piece: applied.placed, captured: applied.captured || ''
        });

        if (!R.hasUnpromotedPawn(this.board)) {
            this.noPawnMoveCount = (this.noPawnMoveCount || 0) + 1;
        } else {
            this.noPawnMoveCount = 0;
        }

        this.sideToMove = R.oppositeSide(side);
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove));
        const gaveCheck = R.isInCheck(this.board, this.sideToMove);
        return { ok: true, gaveCheck };
    }

    _resolveAfterMove() {
        const side = this.sideToMove;
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, side);
        if (!canMove) {
            if (inCheck) {
                const winnerSlot = R.slotFromSide(R.oppositeSide(side));
                this._endGame(winnerSlot, side === 'black' ? '红将死黑胜' : '黑将死红胜');
            } else {
                this._endGame('draw', '逼和');
            }
            return;
        }
        if (R.isInsufficientMaterial(this.board)) {
            this._endGame('draw', '子力不足作和');
            return;
        }
        const rep = R.judgeRepetition(this.historyKeys);
        if (rep) {
            this._endGame('draw', '三次重复作和');
            return;
        }
        // 双方均无未升变兵时，64 着内须将死否则作和（简化计数）
        if (!R.hasUnpromotedPawn(this.board) && this.noPawnMoveCount >= 64) {
            this._endGame('draw', '无兵限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'simulated-makruk') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要模拟泰国象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const entry = rawMoves[i];
            let player, fromRow, fromCol, toRow, toCol;
            if (typeof entry === 'string') {
                const m = entry.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'black' : 'white';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
            }
            if (player !== R.slotFromSide(this.sideToMove)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, player);
            if (!r.ok) {
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
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot);
                if (!r.ok) return;
                this._resolveAfterMove();
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
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
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.noPawnMoveCount = this.historyNoPawn.pop() || 0;
        this.moveHistory.pop();
        this.historyKeys.pop();
        const last = this.moveHistory[this.moveHistory.length - 1];
        if (last) {
            this.lastFrom = { row: last.fromRow, col: last.fromCol };
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
        room.gameLogic = new SimulatedMakrukRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    _rules: R
};
