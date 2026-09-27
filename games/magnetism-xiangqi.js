const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

// 翻转方向：红方在 row 小侧（row 0-2）、显示在下；黑方在上（row 7-9）
const R = require('./xiangqi-rules').flipped;
if (!R || typeof R.createInitialBoard !== 'function') {
    throw new Error('xiangqi-rules.js not found or invalid (need createInitialBoard)');
}
/* ---------- 磁力规则：本棋种专属，不写进公共 xiangqi-rules.js ----------
   走子落点的上下左右四个方向上，各自「最近的一枚棋子」被磁力拉动一格：与落子方异色者靠近一格、
   同色者远离一格。目标格出界 / 已有棋子（含紧贴落点时想落到落点上）/ 帥將仕士出宫 / 相象过河时
   该子不动（遇到阻碍）。只结算一次、不连锁；四个方向一律按进入函数时的同一张盘面同时计算 ——
   四条射线只交于落点，而落点必被刚落下的棋子占住，故彼此的落点不可能相同。 */

/** 宫（本棋种用翻转方向：红方 row 0-2、黑方 row 7-9；列恒为 3-5） */
function magnetInPalace(side, row, col) {
    if (col < 3 || col > 5) return false;
    if (R.redAtTop) return side === 'red' ? (row >= 0 && row <= 2) : (row >= 7 && row <= 9);
    return side === 'red' ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
}

/** 磁力目标格是否可站：帥/將、仕/士不出宫；相/象不过河；其余棋子（車馬炮兵）不受限 */
function magnetCanStand(piece, row, col) {
    const side = piece[0] === 'r' ? 'red' : 'black';
    const type = piece[1];
    if (type === 'k' || type === 'a') return magnetInPalace(side, row, col);
    if (type === 'e') {
        if (R.redAtTop) return side === 'red' ? row <= 4 : row >= 5;
        return side === 'red' ? row >= 5 : row <= 4;
    }
    return true;
}

/**
 * 结算磁力。board 必须是**已经走完这一步**的盘面（落点 (row, col) 上有刚落的子）。
 * @returns {{board: string[][], moves: Array}} 结算后的盘面；moves = 实际被拉动的棋子
 */
function applyMagnetism(board, row, col, moverSide) {
    const next = R.copyBoard(board);
    const moves = [];
    const moverCh = R.sideColorChar(moverSide);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
        let r = row + dr;
        let c = col + dc;
        while (R.inBounds(r, c) && board[r][c] === '') { r += dr; c += dc; }
        if (!R.inBounds(r, c)) continue;                     // 该方向无棋子
        const piece = board[r][c];
        const away = piece[0] === moverCh;                   // 同色远离、异色靠近
        const tr = away ? r + dr : r - dr;
        const tc = away ? c + dc : c - dc;
        if (!R.inBounds(tr, tc)) continue;                   // 出界
        if (board[tr][tc] !== '') continue;                  // 被占（紧贴落点时即落在落点上）
        if (!magnetCanStand(piece, tr, tc)) continue;         // 出宫 / 过河
        next[tr][tc] = piece;
        next[r][c] = '';
        moves.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, piece });
    }
    return { board: next, moves };
}

/** 走子 + 磁力结算（合法性本身仍按普通象棋口径判） */
function applyMoveWithMagnetism(board, fromRow, fromCol, toRow, toCol, moverSide) {
    const moved = R.applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
    return applyMagnetism(moved, toRow, toCol, moverSide);
}

/**
 * 磁性象棋：基本规则同象棋，但**每走一手后**，落点的上下左右四个方向上各自「最近的一枚棋子」
 * 被磁力拉动一格 —— 与落子方异色者靠近一格、同色者远离一格；目标格出界 / 已有棋子（即遇到阻碍，
 * 包括紧贴落点想落到落点上的情况）/ 帥將仕士出宫 / 相象过河时，该棋子原地不动。
 *
 * 磁力只结算一次（不连锁），四个方向按同一张盘面同时计算；结算后的局面才是这手的最终局面，
 * 吃子、将军、将死、循环、限着都在它上面判定。玩家不承担磁力后果：只要求「走子本身」不送将
 * （同象棋的 isLegalMove），磁力把自己的将拉进将军是允许的。
 *
 * 协议座位：black=红方(先手)，white=黑方(后手)
 */
class MagnetismXiangqiRoom extends QiTwoPlayerRoomBase {
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
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'red' ? 2 : 1 }] : [],
            gameOver: this.gameOver,
            winner: this.winner,
            halfmoveClock: this.halfmove.halfmoveClock,
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
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    wireMoveCoords() {
        return this.moveHistory.map((m) => (
            m.type === 'pass'
                ? { type: 'pass', player: m.player }
                : {
                    type: 'move',
                    player: m.player,
                    fromRow: m.fromRow,
                    fromCol: m.fromCol,
                    toRow: m.toRow,
                    toCol: m.toCol,
                    piece: m.piece,
                    captured: m.captured || ''
                }
        ));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '磁性象棋',
            gameId: 'magnetism-xiangqi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            moves: this.moveHistory.map((m) => (
                m.type === 'pass'
                    ? `${(m.player === 'player1' ? 'R' : 'B')}p`
                    : `${(m.player === 'player1' ? 'R' : 'B')}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`
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
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        // 照面不在此处判负：磁力可能把挡在两将之间的棋子拉开而走出照面（照面在规则里等于被将军，
        // 由行棋方自行化解；化解不了则按下文将死/困毙判负）。编辑盘面走出的照面同理。
        if (!R.isLegalMove(this.board, fromRow, fromCol, toRow, toCol, side)) return { ok: false };

        const piece = this.board[fromRow][fromCol];
        const captured = this.board[toRow][toCol] || '';
        const movedBoard = R.applyMoveOnBoard(this.board, fromRow, fromCol, toRow, toCol);
        // 磁力：落点四方各自最近的棋子被吸/斥一格，结算后的局面才是这手的最终局面
        const nextBoard = applyMagnetism(movedBoard, toRow, toCol, side).board;
        const opp = R.oppositeSide(side);
        const gaveCheck = R.isInCheck(nextBoard, opp);

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

    /** 开局判定（编辑盘面）：只剩「无将/帅判负」——本棋种不做将死/困毙判断 */
    onMatchStarted() {
        this._resolveTurnStartLoss();
    }

    /** 末尾连续虚着手数 */
    _trailingPassCount() {
        let n = 0;
        for (let i = this.moveHistory.length - 1; i >= 0; i--) {
            if (this.moveHistory[i].type === 'pass') n++;
            else break;
        }
        return n;
    }

    /**
     * 虚着。本棋种**不做将死判断**（必须实际吃到将/帅才算胜利），所以被将死、无子可动时
     * 靠虚着把行棋权交出去；双方连续虚着则作和（同朝鲜将棋）。
     */
    _applyPassCore(slot) {
        const side = R.sideFromSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const opp = R.oppositeSide(side);

        this.historyBoards.push(R.copyBoard(this.board));
        this.historySides.push(this.sideToMove);
        this.historyHalfmoves.push({ ...this.halfmove });

        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory.push({
            player: slot, type: 'pass', pass: true,
            fromRow: -1, fromCol: -1, toRow: -1, toCol: -1, piece: '', captured: ''
        });
        this.halfmove = R.nextHalfmoveState(this.halfmove, false, false, side);
        this.sideToMove = opp;
        this.currentPlayer = opp === 'red' ? 1 : 2;
        this.historyKeys.push(R.positionKey(this.board, this.sideToMove));
        this.checkFlags.push(false);
        return { ok: true, doublePass: this._trailingPassCount() >= 2 };
    }

    _resolveAfterMove() {
        if (this.importReplayNoJudge) return;
        if (this._resolveTurnStartLoss()) return;
        const side = this.sideToMove;
        // 吃光对方所有王：立即获胜（多王编辑盘面规则，不必等对方无着法）
        if (R.countKings(this.board, R.oppositeSide(side)) === 0) {
            const winnerSlot = R.slotFromSide(side);
            this._endGame(winnerSlot, side === 'red' ? '红方吃掉对方王获胜' : '黑方吃掉对方王获胜');
            return;
        }
        // 将死 / 困毙优先于限着与循环（限着满 120 时若同时将死/困毙/循环则限着失效）
        const inCheck = R.isInCheck(this.board, side);
        const canMove = R.hasLegalMove(this.board, side);

        // 不做将死/困毙判断：被将军、无子可动都不判负，必须**实际吃到将/帅**才算胜利
        // （无子可动的一方靠虚着继续；双方连续虚着作和，见 _applyPassCore）

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
                const winnerSlot = loserSlot === 'player1' ? 'player2' : 'player1';   // 胜方座位（player1 执红/蓝先手）
                this._endGame(winnerSlot, rep.loserSide === 'red' ? '红方长将，黑胜' : '黑方长将，红胜');
                return;
            }
        }

        if (this.halfmove.halfmoveClock >= 120) {
            this._endGame('draw', '自然限着作和');
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'magnetism-xiangqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要磁性象棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        this.importReplayNoJudge = true;   // 回放期间不判终局（结果只按棋谱记录）
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            let isPass = false;
            if (typeof entry === 'string') {
                const mp = entry.match(/^([RB])p$/i);
                const m = mp ? null : entry.match(/^([RB])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!mp && !m) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = (mp ? mp[1] : m[1]).toUpperCase() === 'R' ? 'player1' : 'player2';
                if (mp) isPass = true;
                else {
                    fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
                }
            } else {
                player = entry.player;
                isPass = entry.type === 'pass';
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
            const r = isPass ? this._applyPassCore(player) : this._applyMoveCore(fromRow, fromCol, toRow, toCol, player);
            if (!r.ok) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this._resolveAfterMove();
            if (this.gameOver) break;
        }
        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        // 记录里的胜负先认出执方颜色（公共层把棋谱里的「黑胜」折成 result='player1'、
        // 「白胜」折成 result='player2'，所以不能直接当座位名用），再落到本棋种的座位。
        const recResult = data.result != null && data.result !== '' ? data.result
            : (data.resultText != null && data.resultText !== '' ? data.resultText : null);
        if (recResult != null) {
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : String(recResult);
            const rt = String(this.recordResultText);
            const SLOT_OF_COLOR = { 红: 'player1', 黑: 'player2' };   // player1 执红、player2 执黑
            const win = /(黑|白|红|绿|蓝)\s*(?:方)?[^，。]{0,6}胜/.exec(rt);
            let color = win ? win[1] : null;
            if (!color) {
                const lose = /(黑|白|红|绿|蓝)\s*(?:方)?[^，。]{0,6}判负/.exec(rt);
                if (lose) color = Object.keys(SLOT_OF_COLOR).find((k) => k !== lose[1]) || null;
                else if (recResult === 'black' || recResult === 'player1') color = '黑';
                else if (recResult === 'white' || recResult === 'player2') color = '白';
            }
            if (recResult === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (color && SLOT_OF_COLOR[color]) this.winner = SLOT_OF_COLOR[color];
            else this.winner = recResult;
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
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'pass': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const rp = this._applyPassCore(slot);
                if (!rp.ok) return;
                if (rp.doublePass) {
                    this._endGame('draw', '双方虚着作和');
                    this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                    return;
                }
                this._resolveAfterMove();   // 循环 / 自然限着仍照常判
                if (!this.gameOver) this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) return;
                const opp = slot === 'player1' ? 'player2' : 'player1';
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
        this.currentPlayer = this.sideToMove === 'red' ? 1 : 2;
        this.halfmove = this.historyHalfmoves.pop() || { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
        this.moveHistory.pop();
        this.historyKeys.pop();
        this.checkFlags.pop();
        const last = this.moveHistory[this.moveHistory.length - 1];
        if (last && last.type !== 'pass') {
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
        room.gameLogic = new MagnetismXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
