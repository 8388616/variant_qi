const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

/**
 * 傀儡象棋（puppet-xiangqi）：每回合分两个阶段 ——
 *   第一阶段：走一枚**己方**棋子；
 *   第二阶段：走一枚**对方**棋子（走它自己那一方的走法/限制：前进方向、过河、九宫都不变），
 *             只要有棋可走就必须走、不能跳过；此时棋盘与视角都不变。
 *   两阶段走完才轮到对方。
 *
 * 归属不变：被操控的对方棋子仍属于对方（颜色/阵营/方向都不变），所以第二阶段可以吃掉自己的棋子
 * （包括自己的将/帅 —— 真发生时按「将帅被吃」判该方负）。
 *
 * 胜负：**两阶段都不限制**（任意送将、任意不应将、走成将帅照面都合法）——
 *   - 一手棋是否合法只看「几何走法」（isPseudoLegalMove），不再做送将/照面/应将检查；
 *   - **只有实际吃掉对方的将/帅才算胜**，不做将死判断：被将军、被将死、无子可动都不判负（照面同理）；
 *   - 唯一兜底：轮到该走的一方**几何走法上一步都走不出来**（无子可动）→ 该方负，
 *     否则对局会卡死（本棋种没有虚着）。
 *   - 其余同象棋（认输/求和/限时/悔棋/棋谱/编辑棋盘；和棋判定只在回合结束时做）。
 * 悔棋：退回请求方「回合开始、第一阶段之前」（自己那手 + 操控对方的那手一起撤回）。
 */
// 翻转方向：红方在 row 小侧（row 0-2）、显示在下；黑方在上（row 7-9）
const R = require('./xiangqi-rules').flipped;
if (!R || typeof R.createInitialBoard !== 'function') {
    throw new Error('xiangqi-rules.js not found or invalid (need createInitialBoard)');
}

/**
 * 协议座位：black=红方(先手)，white=黑方(后手)
 */
class PuppetXiangqiRoom extends QiTwoPlayerRoomBase {
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
                this.recordResultText = lostSlot === 'player1' ? '红方超时，黑胜' : '黑方超时，红胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
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
            this.recordResultText = lostSlot === 'player1' ? '红方超时，黑胜' : '黑方超时，红胜';
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
            phase: this.phase,
            // 本阶段该动哪一方（第一阶段 = 回合方；第二阶段 = 对方）
            movableSide: this.phase === 2 ? R.oppositeSide(this.sideToMove) : this.sideToMove,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'red' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmove.halfmoveClock,
            inCheck: R.isInCheck(this.board, this.phase === 2 ? R.oppositeSide(this.sideToMove) : this.sideToMove),
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
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
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
            phase: m.phase || 1
        }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '傀儡象棋',
            gameId: 'puppet-xiangqi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => (
                `${(m.player === 'player1' ? 'R' : 'B')}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
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
        this.currentPlayer = 1; // 与围棋协议一致：1=红(座位 black)，2=黑(座位 white)
        this.historyBoards = [];
        this.historySides = [];
        this.historyHalfmoves = [];
        this.historyKeys = [R.positionKey(this.board, this.sideToMove)];
        this.checkFlags = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.historyPhases = [];
        this.phase = 1;                 // 1 = 走己方棋子；2 = 走对方棋子
        this.gameOver = false;
        this.importReplayNoJudge = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.halfmove = { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.hostWs = null;
        this._stopClockTicker();
    }

    _endGame(winnerSlot, resultText) {
        // 导入棋谱回放期间不判终局：只摆棋，结果以棋谱记录为准
        if (this.importReplayNoJudge) return;
        this.gameOver = true;
        this.winner = winnerSlot;
        this.recordResultText = resultText;
        this._stopClockTicker();
    }

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot) {
        const turnSide = R.sideFromSlot(slot);
        if (turnSide !== this.sideToMove) return { ok: false };
        // 傀儡象棋：第一阶段走己方子；第二阶段走对方子（走它自己那一方的走法/限制）
        const side = this.phase === 2 ? R.oppositeSide(turnSide) : turnSide;
        // 照面不再判负：照面也是一种「送将」，两阶段都允许（胜负只看是否真吃到将/帅）
        if (!this._isPhaseLegalMove(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] || '';
        const nextBoard = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(nextBoard, opp);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyPhases.push(this.phase);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.board = nextBoard;
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };
        this.moveHistory.push({
            player: R.slotFromSide(side),      // 记实际动的那一方（回合内会红黑交替）
            fromRow, fromCol, toRow, toCol,
            piece, captured,
            phase: this.phase
        });

        this.halfmove = R.nextHalfmoveState(this.halfmove, !!captured, gaveCheck, side);
        // 阶段流转与轮次切换都交给 _resolveAfterMove（它还要判吃掉将帅、以及无子可动兜底）
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove) + '|' + this.phase);
        this.checkFlags.push(gaveCheck);

        return { ok: true, gaveCheck, captured: !!captured };
    }

    /**
     * 本棋种的一手是否合法：**两阶段同一口径，只看几何走法**
     * （任意送将、任意不应将、走成照面都允许；胜负只由「实际吃掉对方将/帅」决定，所以不做将死判断）。
     * side = 这枚子属于哪一方（第一阶段＝回合方，第二阶段＝对方）。
     */
    _isPhaseLegalMove(board, fromRow, fromCol, toRow, toCol, side) {
        const piece = board[fromRow] && board[fromRow][fromCol];
        if (!piece || piece[0] !== R.sideColorChar(side)) return false;
        return R.isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board);
    }

    /** 该方还有没有「走得动」的一手（几何走法口径；用来兜底判断无子可动） */
    _hasAnyMove(side) {
        const ch = R.sideColorChar(side);
        for (let fr = 0; fr < R.BOARD_H; fr++) {
            for (let fc = 0; fc < R.BOARD_W; fc++) {
                const p = this.board[fr][fc];
                if (!p || p[0] !== ch) continue;
                for (let tr = 0; tr < R.BOARD_H; tr++) {
                    for (let tc = 0; tc < R.BOARD_W; tc++) {
                        if (this._isPhaseLegalMove(this.board, fr, fc, tr, tc, side)) return true;
                    }
                }
            }
        }
        return false;
    }

    /** 阶段推进：第一阶段 → 第二阶段（同一人继续）；第二阶段 → 换对方、回到第一阶段 */
    _advancePhase() {
        if (this.phase === 1) {
            this.phase = 2;
            return;
        }
        this.phase = 1;
        this.sideToMove = R.oppositeSide(this.sideToMove);
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
    }

    /** 行棋方无将/帅：直接判负（编辑盘面可能出现） */
    _resolveTurnStartLoss() {
        if (this.gameOver) return false;
        const side = this.sideToMove;
        if (R.countKings(this.board, side) === 0) {
            const winnerSlot = R.slotFromSide(R.oppositeSide(side));
            this._endGame(winnerSlot, side === 'red' ? '红方无帥，黑胜' : '黑方无將，红胜');
            return true;
        }
        return false;
    }

    /**
     * 开局判定（编辑盘面）：只有「无将/帅」和「一步都走不出来」判负。
     * 被将军 / 被将死 / 照面都不判负（两阶段都允许送将与不应将，胜负只看是否真吃到将/帅）。
     */
    onMatchStarted() {
        this._resolveTurnStartLoss();
        if (this.gameOver) return;
        const side = this.sideToMove;
        if (this._hasAnyMove(side)) return;
        const winnerSlot = R.slotFromSide(R.oppositeSide(side));
        this._endGame(winnerSlot, side === 'red' ? '红方无子可动，黑胜' : '黑方无子可动，红胜');
    }

    _resolveAfterMove() {
        if (this.importReplayNoJudge) return;
        const turnSide = this.sideToMove;                 // 回合方（两个阶段都是它）
        const puppetSide = R.oppositeSide(turnSide);
        const turnSlot = R.slotFromSide(turnSide);
        const puppetSlot = R.slotFromSide(puppetSide);

        // 胜负唯一来源：**实际吃掉对方的将/帅**（送将/不应将都合法，所以被将军不判负）
        if (R.countKings(this.board, turnSide) === 0) {
            this._endGame(puppetSlot, turnSide === 'red' ? '红方无帥，黑胜' : '黑方无將，红胜');
            return;
        }
        if (R.countKings(this.board, puppetSide) === 0) {
            this._endGame(turnSlot, turnSide === 'red' ? '红方吃掉对方將，红胜' : '黑方吃掉对方帥，黑胜');
            return;
        }

        // 兜底：轮到该走的一方**几何走法上一步都走不出来**（无子可动）→ 该方负。
        // 本棋种没有虚着，不这样判对局会卡死；被将军/被将死不判负（送将与不应将都合法）。
        const nextSide = this.phase === 1 ? puppetSide : turnSide;
        if (!this._hasAnyMove(nextSide)) {
            const loserSide = nextSide;
            const winnerSlot = nextSide === turnSide ? puppetSlot : turnSlot;
            const loserName = loserSide === 'red' ? '红方' : '黑方';
            const winnerName = loserSide === 'red' ? '黑方' : '红方';
            this._endGame(winnerSlot, loserName + '无子可动，' + winnerName + '胜');
            return;
        }

        if (this.phase === 1) {
            // 第一阶段结束 → 进入第二阶段（操控对方棋子），回合方不变
            this._advancePhase();
            return;
        }

        // 第二阶段结束 → 换对方、回到第一阶段
        this._advancePhase();

        // 和棋判定只在回合结束时做（与象棋同一套）
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
                const winnerSlot = loserSlot === 'player1' ? 'player2' : 'player1';
                this._endGame(winnerSlot, rep.loserSide === 'red' ? '红方长将，黑胜' : '黑方长将，红胜');
                return;
            }
        }
        if (this.halfmove.halfmoveClock >= 120) {
            this._endGame('draw', '自然限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'puppet-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要傀儡象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        this.importReplayNoJudge = true;   // 回放期间不判终局（结果只按棋谱记录）
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            if (typeof entry === 'string') {
                const m = entry.match(/^([RB])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'R' ? 'player1' : 'player2';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
            }
            const expect = R.slotFromSide(this.phase === 2 ? R.oppositeSide(this.sideToMove) : this.sideToMove);
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
            if (this.importReplayNoJudge) this._advancePhase();   // 回放期间不判定，阶段自己推进
            else {
                this._resolveAfterMove();
                if (this.gameOver) break;
            }
        }
        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        // 记录里的胜负先认出执方颜色（公共层把棋谱里的「黑胜」折成 result='player1'、
        // 「白胜」折成 result='player2'，所以不能直接当座位名用），再落到本棋种的座位。
        if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw') {
            this.gameOver = true;
            this.winner = data.result;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
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

    /** 聊天里显示的执方名：本棋种是「红方 / 黑方」，不是黑/白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '红方' : (slot === 'player2' ? '黑方' : String(slot));
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
                if (!this.gameOver && this.phase === 1) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'player1' ? 'player2' : 'player1';
                const oppWs = this.room.getPlayerBySlot(opp);
                if (!oppWs) {
                    // 无对手：直接退到请求方回合开始
                    this._undoToTurnStart(slot);
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
                this._undoToTurnStart(this.room.getSlotByWs(requester) || null);
                this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                break;
            }
            case 'resign':
                if (slot && !this.gameOver) {
                    this.recordResultText = slot === 'player1' ? '红方认输，黑胜' : '黑方认输，红胜';
                    this._stopClockTicker();
                }
                qiProtocol.resign(this, ws, slot);
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
        this.phase = this.historyPhases.pop() || 1;
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
        this.importReplayNoJudge = false;
        this.winner = null;
        this.recordResultText = null;
        if (this.tcClock && this.tcClock.timed) this._syncClockAfterTurnChange();
    }

    /**
     * 悔棋：一直退到「请求方的回合、第一阶段」之前 ——
     * 也就是把自己回合的走子（己方那手 + 操控对方的那手）一起撤回；
     * 若正处在对方回合中途，则连对方这一手也一起退掉（否则回不到自己的第一阶段）。
     */
    _undoToTurnStart(requesterSlot) {
        if (!requesterSlot) {
            this._undoOne();
            return;
        }
        const mySide = R.sideFromSlot(requesterSlot);
        let popped = 0;
        while (this.moveHistory.length > 0 && popped < 3) {
            this._undoOne();
            popped++;
            if (this.phase === 1 && this.sideToMove === mySide) break;
        }
    }

    resetGame() {
        this.resetToEmpty();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
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
        room.gameLogic = new PuppetXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
