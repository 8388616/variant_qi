const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');

/**
 * 不夹棋（nopincer）：双方轮流落子，不可以虚着。
 * 某一手落下后，若同一条线上（横、竖、两个斜向）出现「两端颜色相同、中间的棋子全是另一种颜色」的
 * 连续一段（至少三颗，即 白-黑-白 / 黑-白-黑 这种夹形），则**落子的一方负**。
 * 任意连续的一段都算（白黑白黑 里有 白黑白，也算夹成形）。
 * 不吃子、不判自杀；棋盘走满判和。
 */
class NoPincerRoom extends QiTwoPlayerRoomBase
{
    constructor(room)
    {
        super(room);
        this.boardSize = 9;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
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

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    /** 夹成形的那一方（落子方）负：先负后胜 */
    setPincerLossResultText(lostByPincerSlot) {
        this.recordResultText = lostByPincerSlot === 'player1' ? '白胜' : '黑胜';
    }

    setPassLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑虚着白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白虚着黑胜';
    }

    /** 不夹棋不允许虚着：引擎 pass 时由人机对战按「棋盘走满判和、否则判负」处理 */
    passIsIllegal() {
        return true;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和棋' || resultText === 'draw') return 'draw';
        if (resultText.includes('白胜')) return 'player2';
        if (resultText.includes('黑胜')) return 'player1';
        if (resultText === 'player1' || resultText === 'player2' || resultText === 'draw') return resultText;
        return null;
    }

    /**
     * 这条线（方向 dr,dc）上，是否存在包含 (row,col) 的「夹形」：
     * 相邻的若干颗棋子里，两端同色、中间每一颗都是另一种颜色，且至少三颗。
     * 任意连续的一段都算（用户口径）：白黑白黑 里含「白黑白」这一段，就成立。
     * 边界按盘面实际尺寸取（不依赖 this.boardSize，手摆/测试用的小盘也不会越界）。
     */
    pincerOnLine(board, row, col, dr, dc) {
        const n = board.length;
        const inB = (r, c) => r >= 0 && r < n && c >= 0 && c < n && board[r] !== undefined && board[r][c] !== undefined;
        // 先把包含 (row,col) 的那一整段连续子取出来（存颜色），再看有没有夹形段
        let r0 = row, c0 = col;
        while (inB(r0 - dr, c0 - dc) && board[r0 - dr][c0 - dc] !== 0) { r0 -= dr; c0 -= dc; }
        const seq = [];
        for (let r = r0, c = c0; inB(r, c) && board[r][c] !== 0; r += dr, c += dc) seq.push(board[r][c]);
        const self = Math.max(Math.abs(row - r0), Math.abs(col - c0));   // 本手在这段里的下标
        for (let i = 0; i <= self; i++) {
            for (let j = self; j < seq.length; j++) {
                if (j - i + 1 < 3) continue;                              // 少于三颗不成夹
                if (seq[i] !== seq[j]) continue;                          // 两端必须同色
                let allOther = true;
                for (let k = i + 1; k < j; k++) {
                    if (seq[k] === seq[i]) { allOther = false; break; }   // 中间必须全是另一色
                }
                if (allOther) return true;
            }
        }
        return false;
    }

    /**
     * 只判落子点所在的线：4 条轴 = 8 个方向（横/竖/两条斜线各含正反两向）。
     * 不走全盘：新落一子只可能「造出」包含它自己的那段棋，所以只看经过它的 4 条线即可；
     * 又因为一条轴上的两向共用同一段连续子（夹形段可以跨过落子点），所以按「轴」扫一遍，
     * 而不是把 8 个方向各扫一遍。
     */
    hasPincer(board, row, col) {
        return this.pincerOnLine(board, row, col, 0, 1)
            || this.pincerOnLine(board, row, col, 1, 0)
            || this.pincerOnLine(board, row, col, 1, 1)
            || this.pincerOnLine(board, row, col, 1, -1);
    }

    /** 落子并返回 { newBoard, pincer }（pincer = 这一手夹成形，落子方负）。不吃子，棋子永不消失。 */
    tryPlaceStoneResult(boardBefore, row, col, playerVal)
    {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        return { newBoard, pincer: this.hasPincer(newBoard, row, col) };
    }

    /** 标准落子接口：返回新盘面或 null（与其它棋类一致，供人机对战 applyComputerMove 等调用） */
    tryPlaceStone(boardBefore, row, col, playerVal)
    {
        const r = this.tryPlaceStoneResult(boardBefore, row, col, playerVal);
        return r ? r.newBoard : null;
    }

    /**
     * 落子即终局：夹成形的一方（落子方）负。房间的人类着法与人机对战的电脑着法都走这一个函数。
     * 返回 true = 这一手已终局、不要再换手。
     */
    resolveMoveOutcome(prevBoard, newBoard, row, col, playerVal, moveSlot)
    {
        if (this.importReplayNoJudge) return false;   // 回放棋谱期间不判终局
        if (!this.hasPincer(newBoard, row, col)) return false;
        this.gameOver = true;
        this.winner = moveSlot === 'player1' ? 'player2' : 'player1';
        this.setPincerLossResultText(moveSlot);
        return true;
    }

    isBoardFull()
    {
        for (let r = 0; r < this.boardSize; r++)
            for (let c = 0; c < this.boardSize; c++)
                if (this.board[r][c] === 0) return false;
        return true;
    }

    getState()
    {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
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
        }
        ;
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move':
                if (!slot || this.gameOver) return;          // 观战者不能落子
                // 必须是轮到的那一方（不限时的对局 _timeAllowsPlay 不校验行棋方，这里补上）
                if (slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const prevBoard = this.board;
                const result = this.tryPlaceStoneResult(this.board, row, col, playerVal);
                if (!result) return;

                const { newBoard } = result;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                    return;
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                if (this.resolveMoveOutcome(prevBoard, newBoard, row, col, playerVal, slot))
                {
                    // 夹成形：落子方负，不换手
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                }
                else
                {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;

                    if (this.isBoardFull())
                    {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.recordResultText = '和棋';
                    }
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                }
                this._syncClockAfterTurnChange();
                break;

            case 'requestUndo':
                if (!slot || this.gameOver)
                    return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--)
                {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
                }
                if (steps === 0 || steps > this.historyBoards.length)
                {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else
                {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo)
                {
                    if (msg.accept)
                        this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else
                        this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
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
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
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
        this.importReplayNoJudge = false;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（5-21）' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {

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
            gameType: '不夹棋',
            gameId: 'nopincer',
            boardSize: this.boardSize,
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.importReplayNoJudge = false;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
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
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'nopincer') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要不夹棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(NoPincerRoom.parseMove);
        this.importReplayNoJudge = true;   // 回放期间不判终局（结果只按棋谱记录）
        for (let i = 0; i < moves.length; i++) {
            if (this.gameOver) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手时对局已结束` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const move = moves[i];
            const slot = move.player;
            const expectedSlot = this.currentPlayer === 1 ? 'player1' : 'player2';
            if (move.type !== 'move' || slot !== expectedSlot) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const playerVal = slot === 'player1' ? 1 : 2;
            const { row, col } = move;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const result = this.tryPlaceStoneResult(this.board, row, col, playerVal);
            if (!result) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            // 回放期间不做判定：夹成形也照摆、棋盘走满也不判和，整份棋谱都要摆完（结果以记录为准）
            const { newBoard } = result;
            const newBoardStr = this.boardToString(newBoard);
            this.historyBoards.push(this.copyBoard(newBoard));
            this.historyBoardSet.add(newBoardStr);
            this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
            this.moveHistory.push(slot);
            this.moveCoords.push({ type: 'move', player: slot, row, col });
            this.board = newBoard;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];
            this.currentPlayer = 3 - this.currentPlayer;
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
            const SLOT_OF_COLOR = { 黑: 'player1', 白: 'player2' };   // player1 执黑、player2 执白
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

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    NoPincerRoom,
    initRoom(room) {
        room.gameLogic = new NoPincerRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
