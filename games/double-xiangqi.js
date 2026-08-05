const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

const R = require('./xiangqi-rules');
if (!R || typeof R.createInitialBoard !== 'function') {
    throw new Error('xiangqi-rules.js not found or invalid (need createInitialBoard)');
}

/** 二象棋专属开局（子力加倍，花心多一将） */
function createDoubleInitialBoard() {
    const b = R.emptyBoard();
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'ba'; b[0][4] = 'bk';
    b[0][5] = 'ba'; b[0][6] = 'be'; b[0][7] = 'bn'; b[0][8] = 'br';
    b[1][0] = 'br'; b[1][1] = 'bn'; b[1][2] = 'bc'; b[1][3] = 'bc'; b[1][4] = 'bk';
    b[1][5] = 'bc'; b[1][6] = 'bc'; b[1][7] = 'bn'; b[1][8] = 'br';
    b[2][3] = 'ba'; b[2][4] = 'bp'; b[2][5] = 'ba';
    for (let c = 0; c < R.BOARD_W; c++) b[3][c] = 'bp';
    b[4][2] = 'be'; b[4][6] = 'be';
    b[5][2] = 're'; b[5][6] = 're';
    for (let c = 0; c < R.BOARD_W; c++) b[6][c] = 'rp';
    b[7][3] = 'ra'; b[7][4] = 'rp'; b[7][5] = 'ra';
    b[8][0] = 'rr'; b[8][1] = 'rn'; b[8][2] = 'rc'; b[8][3] = 'rc'; b[8][4] = 'rk';
    b[8][5] = 'rc'; b[8][6] = 'rc'; b[8][7] = 'rn'; b[8][8] = 'rr';
    b[9][0] = 'rr'; b[9][1] = 'rn'; b[9][2] = 're'; b[9][3] = 'ra'; b[9][4] = 'rk';
    b[9][5] = 'ra'; b[9][6] = 're'; b[9][7] = 'rn'; b[9][8] = 'rr';
    return b;
}

function countKings(board, side) {
    const code = side === 'red' ? 'rk' : 'bk';
    let n = 0;
    for (let r = 0; r < R.BOARD_H; r++) {
        for (let c = 0; c < R.BOARD_W; c++) {
            if (board[r][c] === code) n++;
        }
    }
    return n;
}

function findKings(board, side) {
    const code = side === 'red' ? 'rk' : 'bk';
    const list = [];
    for (let r = 0; r < R.BOARD_H; r++) {
        for (let c = 0; c < R.BOARD_W; c++) {
            if (board[r][c] === code) list.push({ row: r, col: c });
        }
    }
    return list;
}

function kingsFaceEachOtherMulti(board) {
    const reds = findKings(board, 'red');
    const blacks = findKings(board, 'black');
    for (const rk of reds) {
        for (const bk of blacks) {
            if (rk.col !== bk.col) continue;
            let blocked = false;
            const minR = Math.min(rk.row, bk.row);
            const maxR = Math.max(rk.row, bk.row);
            for (let r = minR + 1; r < maxR; r++) {
                if (board[r][rk.col] !== '') { blocked = true; break; }
            }
            if (!blocked) return true;
        }
    }
    return false;
}

function isSquareAttackedBy(board, row, col, bySide) {
    const ch = R.sideColorChar(bySide);
    for (let r = 0; r < R.BOARD_H; r++) {
        for (let c = 0; c < R.BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (R.isPseudoLegalMove(p, r, c, row, col, board)) return true;
        }
    }
    return false;
}

/** 任一将被攻击或对脸即视为被将军/叫吃 */
function isInCheckDouble(board, side) {
    const kings = findKings(board, side);
    if (kings.length === 0) return true;
    if (kingsFaceEachOtherMulti(board)) return true;
    const opp = R.oppositeSide(side);
    for (const k of kings) {
        if (isSquareAttackedBy(board, k.row, k.col, opp)) return true;
    }
    return false;
}

/** 仅剩一将时的真将军（用于长将/限着） */
function isTrueCheck(board, side) {
    return countKings(board, side) === 1 && isInCheckDouble(board, side);
}

function isLegalMoveDouble(board, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== R.sideColorChar(side)) return false;
    if (!R.isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board)) return false;
    const next = R.applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
    const kingsLeft = countKings(next, side);
    if (kingsLeft === 0) return false;
    // 双将时可送将、可不应；只剩一将时必须应将且不得自送
    if (kingsLeft === 1 && isInCheckDouble(next, side)) return false;
    return true;
}

function hasLegalMoveDouble(board, side) {
    const ch = R.sideColorChar(side);
    for (let fr = 0; fr < R.BOARD_H; fr++) {
        for (let fc = 0; fc < R.BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < R.BOARD_H; tr++) {
                for (let tc = 0; tc < R.BOARD_W; tc++) {
                    if (isLegalMoveDouble(board, fr, fc, tr, tc, side)) return true;
                }
            }
        }
    }
    return false;
}

/**
 * 二象棋：规则同象棋；双将，吃尽对方两将获胜。
 * 协议座位：black=红方(先手)，white=黑方(后手)
 */
class DoubleXiangqiRoom extends QiTwoPlayerRoomBase {
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

    getMoveCount() {
        return this.moveHistory.length;
    }

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
            halfmoveClock: this.halfmove.halfmoveClock,
            inCheck: isInCheckDouble(this.board, this.sideToMove),
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
            captured: m.captured || ''
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '二象棋',
            gameId: 'double-xiangqi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => (
                `${m.player[0].toUpperCase()}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
            )),
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
        this.board = createDoubleInitialBoard();
        this.sideToMove = 'red';
        this.currentPlayer = 1; // 与围棋协议一致：1=红(座位 black)，2=黑(座位 white)
        this.historyBoards = [];
        this.historySides = [];
        this.historyHalfmoves = [];
        this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
        this.checkFlags = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.halfmove = { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
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
        if (!isLegalMoveDouble(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] || '';
        const nextBoard = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        const opp = R.oppositeSide(side);
        // 仅剩一将时的将军才计入长将/自然限着
        const gaveCheck = isTrueCheck(nextBoard, opp);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.board = nextBoard;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: slot,
            fromRow, fromCol, toRow, toCol,
            piece, captured
        });

        this.halfmove = R.nextHalfmoveState(this.halfmove, !!captured, gaveCheck, side);
        this.sideToMove = opp;
        this.currentPlayer = opp === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove));
        this.checkFlags.push(gaveCheck);

        return { ok: true, gaveCheck, captured: !!captured };
    }

    _resolveAfterMove() {
        const side = this.sideToMove;
        const kings = countKings(this.board, side);

        // 吃尽对方两将即胜
        if (kings === 0) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            const text = side === 'black' ? '红吃尽双将胜' : '黑吃尽双将胜';
            this._endGame(winnerSlot, text);
            return;
        }

        // 将死 / 困毙优先于限着与循环（仅剩一将时将死才成立；双将时可不应）
        const inCheck = isInCheckDouble(this.board, side);
        const canMove = hasLegalMoveDouble(this.board, side);

        if (!canMove) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            const text = (kings === 1 && inCheck)
                ? (side === 'black' ? '红将死黑胜' : '黑将死红胜')
                : (side === 'black' ? '红困毙黑胜' : '黑困毙红胜');
            this._endGame(winnerSlot, text);
            return;
        }

        if (R.isInsufficientMaterial(this.board)) {
            this._endGame('draw', '子力不足作和');
            return;
        }

        const rep = R.judgeRepetition(this.historyKeys, this.checkFlags);
        if (rep) {
            if (rep.result === 'draw') {
                this._endGame('draw', '循环局面作和');
                return;
            }
            if (rep.result === 'loss') {
                const loserSlot = R.slotFromSide(rep.loserSide);
                const winnerSlot = loserSlot === 'black' ? 'white' : 'black';
                this._endGame(winnerSlot, rep.loserSide === 'red' ? '红长将黑胜' : '黑长将红胜');
                return;
            }
        }

        if (this.halfmove.halfmoveClock >= 120) {
            this._endGame('draw', '自然限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'double-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要二象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
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
            const expect = R.slotFromSide(this.sideToMove);
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
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
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'black' || /红胜/.test(rt)) this.winner = 'black';
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
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
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
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'black' ? 'white' : 'black';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    // 无对手：直接悔一手
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
                    this.recordResultText = slot === 'black' ? '红认输黑胜' : '黑认输红胜';
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
        this.board = this.historyBoards.pop();
        this.sideToMove = this.historySides.pop();
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.halfmove = this.historyHalfmoves.pop() || { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.checkFlags.pop();
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
        room.gameLogic = new DoubleXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
