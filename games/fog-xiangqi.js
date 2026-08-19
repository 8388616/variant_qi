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

/**
 * 迷雾象棋：走子几何同象棋；允许送将/不应将；将帅照面合法但立即判负；吃将即胜。
 * 视野：己方棋子所在格 + 己方棋子可走到的格（含可吃子处）。观战者为双方视野交集。
 * 协议座位：black=红方(先手)，white=黑方(后手)
 */
class FogXiangqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        // 开局前编辑允许的棋子值（字符串棋盘：空 '' + 全部棋子编码）
        this.editBoardAllowedValues = ['', 'rk', 'ra', 're', 'rn', 'rr', 'rc', 'rp', 'bk', 'ba', 'be', 'bn', 'br', 'bc', 'bp'];
        // 棋盘维度（非方形 10×9，公共编辑校验用）
        this.boardRows = R.BOARD_H;
        this.boardCols = R.BOARD_W;
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
                this.broadcastState('timeLoss', { player: lostSlot, winner: winnerSlot });
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
            this.broadcastState('timeLoss', { player: lostSlot, winner: winnerSlot });
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

    /** 允许送将：仅要求己方子 + 几何走法合法 */
    isFogLegalMove(board, fromRow, fromCol, toRow, toCol, side) {
        const piece = board[fromRow] && board[fromRow][fromCol];
        if (!piece || piece[0] !== R.sideColorChar(side)) return false;
        return R.isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board);
    }

    generateFogLegalMoves(board, side) {
        const moves = [];
        const ch = R.sideColorChar(side);
        for (let fr = 0; fr < R.BOARD_H; fr++) {
            for (let fc = 0; fc < R.BOARD_W; fc++) {
                const p = board[fr][fc];
                if (!p || p[0] !== ch) continue;
                for (let tr = 0; tr < R.BOARD_H; tr++) {
                    for (let tc = 0; tc < R.BOARD_W; tc++) {
                        if (this.isFogLegalMove(board, fr, fc, tr, tc, side)) {
                            moves.push({ fromRow: fr, fromCol: fc, toRow: tr, toCol: tc });
                        }
                    }
                }
            }
        }
        return moves;
    }

    /** 己方棋子格 + 可走到的格 */
    computeVisionForSide(board, side) {
        const vis = Array(R.BOARD_H).fill(null).map(() => Array(R.BOARD_W).fill(false));
        const ch = R.sideColorChar(side);
        for (let r = 0; r < R.BOARD_H; r++) {
            for (let c = 0; c < R.BOARD_W; c++) {
                const p = board[r][c];
                if (!p || p[0] !== ch) continue;
                vis[r][c] = true;
                for (let tr = 0; tr < R.BOARD_H; tr++) {
                    for (let tc = 0; tc < R.BOARD_W; tc++) {
                        if (R.isPseudoLegalMove(p, r, c, tr, tc, board)) vis[tr][tc] = true;
                    }
                }
            }
        }
        return vis;
    }

    emptyFogMask() {
        return Array(R.BOARD_H).fill(null).map(() => Array(R.BOARD_W).fill(false));
    }

    fogCleared() {
        return this.gameOver;
    }

    buildFogMaskFromVision(vis) {
        const fog = this.emptyFogMask();
        for (let r = 0; r < R.BOARD_H; r++) {
            for (let c = 0; c < R.BOARD_W; c++) fog[r][c] = !vis[r][c];
        }
        return fog;
    }

    buildFogMask(slot) {
        if (this.fogCleared()) return this.emptyFogMask();
        const rVis = this.computeVisionForSide(this.board, 'red');
        const bVis = this.computeVisionForSide(this.board, 'black');
        if (slot === 'black') return this.buildFogMaskFromVision(rVis);
        if (slot === 'white') return this.buildFogMaskFromVision(bVis);
        const fog = this.emptyFogMask();
        for (let r = 0; r < R.BOARD_H; r++) {
            for (let c = 0; c < R.BOARD_W; c++) fog[r][c] = !(rVis[r][c] && bVis[r][c]);
        }
        return fog;
    }

    buildMaskedBoardFromFull(fullBoard, slot) {
        const out = R.emptyBoard();
        if (this.fogCleared()) return R.copyBoard(fullBoard);

        const rVis = this.computeVisionForSide(fullBoard, 'red');
        const bVis = this.computeVisionForSide(fullBoard, 'black');
        let vis;
        if (slot === 'black') vis = rVis;
        else if (slot === 'white') vis = bVis;
        else {
            vis = Array(R.BOARD_H).fill(null).map(() => Array(R.BOARD_W).fill(false));
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) vis[r][c] = rVis[r][c] && bVis[r][c];
            }
        }

        const myCh = slot === 'black' ? 'r' : (slot === 'white' ? 'b' : null);
        for (let r = 0; r < R.BOARD_H; r++) {
            for (let c = 0; c < R.BOARD_W; c++) {
                const v = fullBoard[r][c];
                if (!v) continue;
                if (myCh && v[0] === myCh) {
                    out[r][c] = v;
                    continue;
                }
                if (vis[r][c]) out[r][c] = v;
            }
        }
        return out;
    }

    buildMaskedBoard(slot) {
        return this.buildMaskedBoardFromFull(this.board, slot);
    }

    getMaskedBoardHistoryForSlot(slot) {
        const boards = [];
        let b = R.createInitialBoard();
        boards.push(this.buildMaskedBoardFromFull(b, slot));
        for (const m of this.moveHistory) {
            b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
            boards.push(this.buildMaskedBoardFromFull(b, slot));
        }
        return boards;
    }

    getFogMaskHistoryForSlot(slot) {
        const masks = [];
        let b = R.createInitialBoard();
        const pushMask = (board) => {
            if (this.fogCleared()) {
                masks.push(this.emptyFogMask());
                return;
            }
            const rVis = this.computeVisionForSide(board, 'red');
            const bVis = this.computeVisionForSide(board, 'black');
            if (slot === 'black') masks.push(this.buildFogMaskFromVision(rVis));
            else if (slot === 'white') masks.push(this.buildFogMaskFromVision(bVis));
            else {
                const fog = this.emptyFogMask();
                for (let r = 0; r < R.BOARD_H; r++) {
                    for (let c = 0; c < R.BOARD_W; c++) fog[r][c] = !(rVis[r][c] && bVis[r][c]);
                }
                masks.push(fog);
            }
        };
        pushMask(b);
        for (const m of this.moveHistory) {
            b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
            pushMask(b);
        }
        return masks;
    }

    /** 仅发送当前视角可见的最后一手标记 */
    filterLastMove(slot) {
        if (!this.lastFrom || !this.lastTo) return { lastFrom: null, lastTo: null };
        if (this.fogCleared()) {
            return {
                lastFrom: { ...this.lastFrom },
                lastTo: { ...this.lastTo }
            };
        }
        const fog = this.buildFogMask(slot);
        const fromOk = this.lastFrom && !fog[this.lastFrom.row][this.lastFrom.col];
        const toOk = this.lastTo && !fog[this.lastTo.row][this.lastTo.col];
        return {
            lastFrom: fromOk ? { ...this.lastFrom } : null,
            lastTo: toOk ? { ...this.lastTo } : null
        };
    }

    filterMoveHistoryForSlot(slot) {
        if (this.fogCleared()) return this.moveHistory.map((m) => ({ ...m }));
        if (!slot) {
            // 观战：仅保留双方视野下均可见的着法端点信息（用逐步复盘判定）
            const out = [];
            let b = R.createInitialBoard();
            for (const m of this.moveHistory) {
                const rVis = this.computeVisionForSide(b, 'red');
                const bVis = this.computeVisionForSide(b, 'black');
                const fromVis = rVis[m.fromRow][m.fromCol] && bVis[m.fromRow][m.fromCol];
                const toVis = rVis[m.toRow][m.toCol] && bVis[m.toRow][m.toCol];
                if (fromVis && toVis) out.push({ ...m });
                else out.push({
                    player: m.player,
                    fromRow: -1, fromCol: -1, toRow: -1, toCol: -1,
                    piece: '', captured: '', hidden: true
                });
                b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
            }
            return out;
        }
        const mySide = R.sideFromSlot(slot);
        const out = [];
        let b = R.createInitialBoard();
        for (const m of this.moveHistory) {
            const vis = this.computeVisionForSide(b, mySide);
            const ownMove = m.player === slot;
            const fromVis = vis[m.fromRow][m.fromCol];
            const toVis = vis[m.toRow][m.toCol];
            if (ownMove || (fromVis && toVis)) out.push({ ...m });
            else out.push({
                player: m.player,
                fromRow: -1, fromCol: -1, toRow: -1, toCol: -1,
                piece: '', captured: '', hidden: true
            });
            b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
        }
        return out;
    }

    wireMoveCoordsForSlot(slot) {
        return this.filterMoveHistoryForSlot(slot).map((m) => ({
            type: m.hidden ? 'hidden' : 'move',
            player: m.player,
            fromRow: m.fromRow,
            fromCol: m.fromCol,
            toRow: m.toRow,
            toCol: m.toCol,
            piece: m.piece || '',
            captured: m.captured || '',
            hidden: !!m.hidden
        }));
    }

    baseStateFields() {
        return {
            boardSize: R.BOARD_W,
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'red' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmove.halfmoveClock,
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
            },
            useServerBoard: true
        };
    }

    getStateForSlot(slot) {
        const cleared = this.fogCleared();
        const board = cleared ? R.copyBoard(this.board) : this.buildMaskedBoard(slot);
        const fogMask = cleared ? this.emptyFogMask() : this.buildFogMask(slot);
        const last = this.filterLastMove(slot);
        const moveHistory = this.filterMoveHistoryForSlot(slot);
        const mySide = slot === 'black' || slot === 'white' ? R.sideFromSlot(slot) : null;
        const fogLegalMoves = (!cleared && mySide)
            ? this.generateFogLegalMoves(this.board, mySide)
            : (cleared && mySide ? this.generateFogLegalMoves(this.board, mySide) : []);

        // 将军提示：给所有人看（不泄露来源），对局结束时不再闪
        const inCheck = !this.gameOver && R.isInCheck(this.board, this.sideToMove);

        return {
            ...this.baseStateFields(),
            board,
            fogMask,
            fogCleared: cleared,
            lastFrom: last.lastFrom,
            lastTo: last.lastTo,
            lastMoveMarkers: last.lastTo
                ? [{ row: last.lastTo.row, col: last.lastTo.col, color: this.sideToMove === 'red' ? 2 : 1 }]
                : [],
            inCheck,
            moveHistory,
            moveCoords: this.wireMoveCoordsForSlot(slot),
            maskedBoardHistory: cleared ? null : this.getMaskedBoardHistoryForSlot(slot),
            fogMaskHistory: cleared ? null : this.getFogMaskHistoryForSlot(slot),
            fogLegalMoves
        };
    }

    getState() {
        return this.getStateForSlot(undefined);
    }

    getStateForClient(ws) {
        return this.getStateForSlot(this.room.getSlotByWs(ws));
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    broadcastState(action, extra = {}) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            const state = this.getStateForClient(client);
            client.send(JSON.stringify({ type: 'broadcast', action, ...state, ...extra }));
        }
    }

    broadcastPerClientReset() {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({ type: 'roomReset', ...this.getStateForClient(client) }));
        }
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '迷雾象棋',
            gameId: 'fog-xiangqi',
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
        this.board = R.createInitialBoard();
        this.sideToMove = 'red';
        this.currentPlayer = 1;
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
        if (!this.isFogLegalMove(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] || '';
        const nextBoard = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        const opp = R.oppositeSide(side);
        const faced = R.kingsFaceEachOther(nextBoard);
        const capturedKing = captured.length === 2 && captured[1] === 'k';
        // 照面已在上面判负路径处理；此处 isInCheck 含照面，照面时不单独闪「将军」
        const gaveCheck = !faced && !capturedKing && R.isInCheck(nextBoard, opp);

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

        return { ok: true, gaveCheck, captured: !!captured, capturedKing, faced, side };
    }

    /** 行棋方无将/帅：直接判负（编辑盘面可能出现） */
    _resolveTurnStartLoss() {
        if (this.gameOver) return false;
        const side = this.sideToMove;
        if (R.countKings(this.board, side) === 0) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            this._endGame(winnerSlot, side === 'red' ? '红方无帅黑胜' : '黑方无将红胜');
            return true;
        }
        return false;
    }

    /** 开局（时间协商完成/双方入座即开始）时判定：编辑盘面某方无将/帅则直接判负 */
    onMatchStarted() {
        this._resolveTurnStartLoss();
    }

    _resolveAfterMove(moveResult) {
        if (!moveResult || !moveResult.ok) return;
        if (this._resolveTurnStartLoss()) return;

        // 将帅照面：着法合法，行棋方立即判负
        if (moveResult.faced) {
            const loserSide = moveResult.side;
            const winnerSlot = R.slotFromSide(R.oppositeSide(loserSide));
            this._endGame(winnerSlot, loserSide === 'red' ? '红送将（照面）黑胜' : '黑送将（照面）红胜');
            return;
        }

        // 吃尽对方所有将/帅才胜（多王编辑盘面：吃一枚不算，须吃光）
        if (moveResult.capturedKing && R.countKings(this.board, R.oppositeSide(moveResult.side)) === 0) {
            const winnerSlot = R.slotFromSide(moveResult.side);
            this._endGame(winnerSlot, moveResult.side === 'red' ? '红吃尽将胜' : '黑吃尽帅胜');
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
        if (!data || data.gameId !== 'fog-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要迷雾象棋棋谱）。' }));
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
                    this.broadcastPerClientReset();
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
                this.broadcastPerClientReset();
                return;
            }
            const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, player);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcastPerClientReset();
                return;
            }
            this._resolveAfterMove(r);
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
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({
                type: 'importSuccess',
                ...this.getStateForClient(client),
                replayData: {
                    moves: this.moveHistory.map((m) => ({
                        type: 'move',
                        player: m.player,
                        fromRow: m.fromRow,
                        fromCol: m.fromCol,
                        toRow: m.toRow,
                        toCol: m.toCol,
                        piece: m.piece,
                        captured: m.captured || ''
                    })),
                    resultText: this.recordResultText
                }
            }));
        }
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
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcastPerClientReset();
                break;
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { fromRow, fromCol, toRow, toCol } = msg;
                if (![fromRow, fromCol, toRow, toCol].every((n) => Number.isInteger(n))) return;
                const r = this._applyMoveCore(fromRow, fromCol, toRow, toCol, slot);
                if (!r.ok) return;
                this._resolveAfterMove(r);
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcastState('move', { showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'black' ? 'white' : 'black';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    this._undoOne();
                    this.broadcastState('undoAccept');
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
                this.broadcastState('undoAccept');
                break;
            }
            case 'resign':
                if (slot && !this.gameOver) {
                    this.recordResultText = slot === 'black' ? '红认输黑胜' : '黑认输红胜';
                    this._stopClockTicker();
                }
                qiProtocol.resign(this, ws, slot, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
                });
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;
            case 'requestDraw':
                this.onDrawResolved = () => {
                    this.recordResultText = '双方同意作和';
                    this._stopClockTicker();
                };
                qiProtocol.requestDraw(this, ws, slot, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
                });
                break;
            case 'drawResponse':
                this.onDrawResolved = () => {
                    this.recordResultText = '双方同意作和';
                    this._stopClockTicker();
                };
                qiProtocol.drawResponse(this, ws, msg, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
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
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({
                type: 'newGameStarted',
                ...this.getStateForClient(client),
                slots: { black: false, white: false }
            }));
        }
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
        room.gameLogic = new FogXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
