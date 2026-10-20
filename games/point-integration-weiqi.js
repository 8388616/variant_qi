const crypto = require('crypto');

const { qiBoardSeatOverlay, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, encodeOpeningPositionCompact } = require('../common');

/** 白方初始点数 = 6.5 × 结束手数（19 路 360 手 → 2340；9 路 80 手 → 520）：
 *  等于围棋里「贴目」的位置，本棋种没有贴点，改成白棋先拿一笔（手数变了数额跟着变）。 */
const WHITE_INITIAL_POINTS_PER_MOVE = 6.5;

/** 点数文案：整数不带小数点，平分产生的 .5 保留一位（如 123.5） */
function formatPoints(v) {
    return String(Number(Number(v).toFixed(2)));
}

/**
 * 本棋种口径的「最近归属」：每个空点归给**曼哈顿距离最近的棋子**一方；同距 → 3
 * （`squareWeiqiRules.computeScore` 会把 3 给两边各记 0.5）。
 * 与公共 assignTerritoryWithRange 的唯一区别：**没有距离上限**（那里盘心 4、边两格内 5，
 * 超出即算公气；本棋种要全盘都归属）。
 * 多源 BFS：黑白各一趟 O(n²)，所以每一手都算也不慢。盘上没有任何棋子 → 全 0
 * （没有「最近的棋子」可归属，双方都是 0 点）。
 * 客户端 `room-plugins/point-integration-weiqi-room.js` 里有同一份（站点惯例：两端各一份副本，
 * 逐格对拍测试 `_t_pi_client.js` 保证一致）。
 */
function assignTerritoryNearestUnlimited(liveBoard, boardSize) {
    const isPassable = (v) => v !== -1;
    const distTo = (color) => {
        const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(-1));
        const queue = [];
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === color) { dist[r][c] = 0; queue.push([r, c]); }
            }
        }
        for (let front = 0; front < queue.length; front++) {
            const [cr, cc] = queue[front];
            const d = dist[cr][cc];
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nr = cr + dr;
                const nc = cc + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (dist[nr][nc] !== -1) continue;
                if (!isPassable(liveBoard[nr][nc])) continue;
                dist[nr][nc] = d + 1;
                queue.push([nr, nc]);
            }
        }
        return dist;
    };
    const distBlack = distTo(1);
    const distWhite = distTo(2);
    const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
            if (liveBoard[r][c] !== 0) continue;
            const b = distBlack[r][c];
            const w = distWhite[r][c];
            if (b < 0 && w < 0) territory[r][c] = 0;        // 盘上无子（或都不通）：无归属
            else if (w < 0) territory[r][c] = 1;            // 只有黑有子
            else if (b < 0) territory[r][c] = 2;            // 只有白有子
            else if (b < w) territory[r][c] = 1;
            else if (w < b) territory[r][c] = 2;
            else territory[r][c] = 3;                       // 同距：平分
        }
    }
    return territory;
}

/** 某局面下双方的「点数」= 自己的子 + 归属到自己的空点（同距两边各 0.5） */
function computePositionPoints(liveBoard, boardSize) {
    const territory = assignTerritoryNearestUnlimited(liveBoard, boardSize);
    return squareWeiqiRules.computeScore(liveBoard, territory, boardSize);
}

class PointIntegrationWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
        this.recordResultText = null;
        /** 累计点数（含白方初始点数）；对局中的每一手都把该局面的点数加进来 */
        this.pointTotals = { player1: 0, player2: WHITE_INITIAL_POINTS_PER_MOVE * this.moveCap() };
        /** 每一手（含虚着）结算后的累计点数快照，与 historyBoards 一一对应：悔棋/导入靠它回溯 */
        this.pointTotalsHistory = [];
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        /** 先落座者为房主（WebSocket） */
        this.hostWs = null;
        /** 是否启用棋盘落座蒙版协议（执子由房主在限时对话框选择） */
        this.boardSeatOverlay = true;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const snap = qiMatchTimeControl.snapshotForClient(this.tcClock);
        this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            if (this.pendingScore) return;
            const now = Date.now();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: lostSlot,
                    winner: winnerSlot,
                    ...this.getState()
                });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    /** 按「选择者己方执子」交换座位：colorChoice 为 black|white|random */

    /** 把当前协商界面重新推给某客户端，避免提交被忽略后卡死 */

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.setTimeLossResultText(lostSlot);
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: lostSlot,
                winner: winnerSlot,
                ...this.getState()
            });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize, (b) => this.copyBoard(b), 1
        );
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return squareWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this.boardSize
        );
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b));
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    /** 形势判断：当前局面的严格最近归属点数之差（无距离上限、不判死子、不计贴点） */
    computeLead() {
        const { blackTotal, whiteTotal } = this.currentPositionPoints();
        return blackTotal - whiteTotal;
    }

    /** 结束手数：路数² 以内最大的偶数（19 路 → 360、9 路 → 80、21 路 → 440），保证双方手数相同 */
    moveCap() {
        return 2 * Math.floor(this.boardSize * this.boardSize / 2);
    }

    /** 当前局面下双方的「点数」（含棋子本身；同距平分 0.5；盘上无子时为 0:0） */
    currentPositionPoints() {
        return computePositionPoints(this.board, this.boardSize);
    }

    /**
     * 一手（含虚着）提交后结算：把**该局面**的点数加进双方累计，并记一份快照。
     * 首手之前不计（「从第一手开始」），所以开局盘面/让子本身不产生点数。
     * 快照数组的长度 = 已结算的着手数（虚着也算），剩余手数、下满手数都由它推。
     * @returns {boolean} 是否已到下满手数（调用方据此不再换手）
     */
    recordPositionPoints() {
        const { blackTotal, whiteTotal } = this.currentPositionPoints();
        this.pointTotals.player1 += blackTotal;
        this.pointTotals.player2 += whiteTotal;
        this.pointTotalsHistory.push({ ...this.pointTotals });
        return this.pointTotalsHistory.length >= this.moveCap();
    }

    /** 初始（未落子）的累计点数：白方 = 6.5 × 结束手数 */
    basePointTotals() {
        return { player1: 0, player2: WHITE_INITIAL_POINTS_PER_MOVE * this.moveCap() };
    }

    /**
     * 终局结算：按总点数比大小。
     * @param {boolean} fillRemaining 是否把「当前局面的点数 × 剩余手数」补给双方——
     *   连续两虚 / 双方同意数点结束时为 true（后续视为双方一直虚着，局面不变），
     *   下满手数自然结束时为 false（最后那一手已经计过）。
     */
    finishByPoints(fillRemaining) {
        if (this.gameOver) return;
        if (fillRemaining) {
            const remain = Math.max(0, this.moveCap() - this.pointTotalsHistory.length);
            if (remain > 0) {
                const { blackTotal, whiteTotal } = this.currentPositionPoints();
                this.pointTotals.player1 += blackTotal * remain;
                this.pointTotals.player2 += whiteTotal * remain;
            }
        }
        const diff = this.pointTotals.player1 - this.pointTotals.player2;
        this.gameOver = true;
        this.winner = diff > 0 ? 'player1' : (diff < 0 ? 'player2' : 'draw');
        this.recordResultText = diff === 0
            ? '和棋'
            : `${diff > 0 ? '黑' : '白'}胜${formatPoints(Math.abs(diff))}点`;
        this._stopClockTicker();
    }

    /**
     * 「数点」通道：连续两虚（qiProtocol.weiqiPass）与「双方同意结束」都走这里。
     * 本棋种没有需要双方确认的盘面点目——等同双虚：保持当前局面，把剩余手数按当前局面点数补齐后结束。
     */
    startScoreCounting() {
        if (this.gameOver) return;
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        this.finishByPoints(true);
        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    getState()
    {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            boardSize: this.boardSize,
            komi: 0,                       // 本棋种没有贴点（白方的 2300 点是初始点数，随 pointTotals 下发）
            board: this.board,
            initialBoard,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            /** 终局文案（含分差，如「黑胜123.5点」）：随状态下发，客户端终局提示直接用它 */
            recordResultText: this.recordResultText,
            /** 双方此时的累计点数（客户端写在 scoreBoard 上：黑：X点　白：Y点） */
            pointTotals: { player1: this.pointTotals.player1, player2: this.pointTotals.player2 },
            /** 结束手数（路数² 以内最大的偶数）：客户端可用来提示进度 */
            pointCap: this.moveCap(),
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null,
            boardSeatOverlay: !!this.boardSeatOverlay,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getInitialState() {
        return this.getState();
    }

    getStateForClient() {
        return this.getState();
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const before = () => this._drainClockBeforeMove(moveSlot);
                qiProtocol.weiqiMove(this, ws, msg, moveSlot, {
                    beforeCommit: before,
                    // 落子已写进盘面、换手与广播之前：结算该局面的点数；到下满手数就终局（并压住换手）
                    afterPlace: () => {
                        if (this.recordPositionPoints()) {
                            this.finishByPoints(false);
                            return true;
                        }
                        return false;
                    }
                });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                // 虚着不改盘面：在提交前（时钟扣时之后）结算即可，这样紧随的广播就带着新点数
                const beforeP = () => {
                    if (!this._drainClockBeforeMove(passSlot)) return false;
                    if (this.recordPositionPoints()) {
                        this.finishByPoints(false);
                    }
                    return true;
                };
                qiProtocol.weiqiPass(this, ws, passSlot, { beforeCommit: beforeP });
                // 单方在场时 weiqiPass 会自己结束（不经过 startScoreCounting）→ 补一次终局结算
                if (this.gameOver && !this.winner && !this.recordResultText) {
                    this.finishByPoints(true);
                    this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                }
                this._syncClockAfterTurnChange();
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!endOpponent) {
                    this.startScoreCounting(ws, ws);
                } else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept) {
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                } else if (this.pendingEnd && !msg.accept) {
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                // 本棋种没有「双方确认盘面点目」这一步：数点即等同双虚，见 startScoreCounting。
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length)
            return;

        for (let i = 0; i < steps; i++)
        {
            if (this.historyBoards.length > 0) {
                // 只有进过集合的手才该删（虚着/踩雷等手同样推了历史快照、盘面与上一手相同，
                // 拿它的快照去 delete 会误删上一次落子的记录 → 禁全同随后失效）
                const skPopped = this.historyBoards.pop();
                const skCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
                if (skCoord && ['move'].includes(skCoord.type))
                    this.historyBoardSet.delete(this.boardToString(skPopped));
            }
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();
            // 点数同步回溯：丢掉被撤销手数的结算快照，回到那一手之前的累计
            if (this.pointTotalsHistory.length > 0)
                this.pointTotalsHistory.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        this.pointTotals = this.pointTotalsHistory.length > 0
            ? { ...this.pointTotalsHistory[this.pointTotalsHistory.length - 1] }
            : this.basePointTotals();
        if (this.historyBoards.length == 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.pointTotals = this.basePointTotals();
        this.pointTotalsHistory = [];
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {

            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord()
    {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '点数积分围棋',
            gameId: 'point-integration-weiqi',
            boardSize: this.boardSize,
            komi: 0,                       // 无贴点（白方初始点数是规则的一部分，不进棋谱）
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pointTotals = this.basePointTotals();
        this.pointTotalsHistory = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'point-integration-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要点数积分围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(PointIntegrationWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.recordPositionPoints();      // 导入同样逐手累计点数（虚着也算）
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.recordPositionPoints();
            }
        }

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
            }
            this.matchStarted = true;
        }

        if (data.result || data.resultText) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });

        if (this.hostWs === ws) {
            const other = slot === 'player1'
                ? this.room.getPlayerBySlot('player2')
                : this.room.getPlayerBySlot('player1');
            this.hostWs = other || null;
        }

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
            this.pendingScore = null;
            this.scoreProposalData = null;
        }
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    PointIntegrationWeiqiRoom,
    initRoom(room) {
        room.gameLogic = new PointIntegrationWeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};