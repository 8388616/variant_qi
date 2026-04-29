const crypto = require('crypto');
const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact } = require('../common');

class TranspositionWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19)
    {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;          // 1:黑, 2:白
        this.historyBoards = [];          // 历史棋盘（深拷贝）
        this.historyBoardSet = new Set(); // 历史棋盘字符串集合，用于禁全同
        this.moveHistory = [];             // 记录每步是谁走的（用于悔棋）
        this.historyMarkers = [];          // 历史落子标记
        this.lastMoveMarkers = [];         // 最后一步的落子标记（小三角）
        this.moveHighlightMarkers = [];     // 易位时两个位置的外框标记 {row, col, frameOnly}
        this.movePlayerColor = null;        // 记录最后一步的移动方颜色 (1黑 2白)
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.maxTranspositionMoves = this.computeMaxTranspositionMoves(this.boardSize);
        this.moveCount = 0;                
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { black: null, white: null };
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
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        const room = this.room;
        if (!room.getPlayerBySlot('black') || !room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null) return;
        if (this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first,
            lastProposerSlot: null
        };
        const ws = room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? {
                timed: true,
                mainMinutes: valid.mainMinutes,
                byoyomiSeconds: valid.byoyomiSeconds,
                maxTimeouts: valid.maxTimeouts
            }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', now);
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

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: proposal.timed,
                    mainMinutes: proposal.mainMinutes,
                    byoyomiSeconds: proposal.byoyomiSeconds,
                    maxTimeouts: proposal.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
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
        const slot = this.currentPlayer === 1 ? 'black' : 'white';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜';
        this._stopClockTicker();
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
        this._stopClockTicker();
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和胜';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'black') this.recordResultText = '黑超时白胜';
        else if (lostSlot === 'white') this.recordResultText = '白超时黑胜';
    }

    // ---------- 工具函数 ----------

    computeMaxTranspositionMoves(size)
    {
        let limit = Math.ceil(size * size * 0.8);
        if (limit % 2 !== 0)
            limit++;
        return limit;
    }

    // 计算连通块的气数（标准围棋规则：气为相邻空点）
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

    /**
     * 易位：己方棋与相邻对方棋交换；提子与气规则同标准围棋。
     * @returns {number[][]|null} 新棋盘，非法则 null
     */
    trySwapPiece(boardBefore, fromRow, fromCol, toRow, toCol, playerVal) {
        const bs = this.boardSize;
        if (fromRow < 0 || fromRow >= bs || fromCol < 0 || fromCol >= bs ||
            toRow < 0 || toRow >= bs || toCol < 0 || toCol >= bs)
            return null;
        if (boardBefore[fromRow][fromCol] !== playerVal) return null;
        if (boardBefore[toRow][toCol] !== 3 - playerVal) return null;
        if (Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol) !== 1) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[fromRow][fromCol] = 3 - playerVal;
        newBoard[toRow][toCol] = playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const enemyPositions = new Set();
        enemyPositions.add(`${fromRow},${fromCol}`);
        for (const [dr, dc] of dirs) {
            const nr = toRow + dr;
            const nc = toCol + dc;
            if (nr >= 0 && nr < bs && nc >= 0 && nc < bs && newBoard[nr][nc] === 3 - playerVal)
                enemyPositions.add(`${nr},${nc}`);
        }
        for (const key of enemyPositions) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }
        const friendlyPositions = new Set();
        for (const [dr, dc] of dirs) {
            const nr = fromRow + dr;
            const nc = fromCol + dc;
            if (nr >= 0 && nr < bs && nc >= 0 && nc < bs && newBoard[nr][nc] === playerVal)
                friendlyPositions.add(`${nr},${nc}`);
        }
        for (const key of friendlyPositions) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }
        return newBoard;
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

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    // ---------- 状态同步 ----------
    getState()
    {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            moveHighlightMarkers: this.moveHighlightMarkers,
            movePlayerColor: this.movePlayerColor,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCount: this.moveCount,
            canTransposition: this.moveCount < this.maxTranspositionMoves,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
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
        };
    }

    // ---------- 悔棋实现 ----------
    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            }
            if (this.historyMarkers.length > 0) {
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
                this.moveHighlightMarkers = []; // 悔棋后清除易位高亮
            } else {
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
            }
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
            this.moveCount--;
        }
        if (this.historyBoards.length === 0)
        {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.moveCount = 0;
        }
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));

        this.movePlayerColor = null;
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    // 新局：清空棋盘与对局状态
    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
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
        this.moveHighlightMarkers = [];
        this.movePlayerColor = null;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCount = 0;
        this.moveCoords = [];
        // 释放所有玩家槽位
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效（7-21）' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        // 设置路数后按新路数清空盘面与对局记录（不释放座位）
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    // 数子流程：向双方发送形势判断提议
    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    // ---------- 消息处理 ----------
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

            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const { moveType, row, col, fromRow, fromCol } = msg;
                let newBoard = null;
                let newMoveMarkers = [];
                let newHighlightMarkers = [];

                if (moveType === 'place')
                {
                    newBoard = this.tryPlaceStone(this.board, row, col, this.currentPlayer === 1 ? 1 : 2);
                    if (newBoard) {
                        newMoveMarkers = [{ row, col, color: this.currentPlayer === 1 ? 1 : 2 }];
                        newHighlightMarkers = [];
                    }
                }
                else if (moveType === 'swap')
                {
                    if (this.moveCount >= this.maxTranspositionMoves)
                        return;
                    if (fromRow === undefined || fromCol === undefined) return;
                    newBoard = this.trySwapPiece(this.board, fromRow, fromCol, row, col, this.currentPlayer === 1 ? 1 : 2);
                    if (newBoard) {
                        // 易位：标出原位置与目标位置（若该格已无子则只画框）
                        newHighlightMarkers = [
                            { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
                            { row, col, frameOnly: newBoard[row][col] === 0 }
                        ];
                        if (newBoard[row][col] === (this.currentPlayer === 1 ? 1 : 2)) {
                            newMoveMarkers = [{ row, col, color: this.currentPlayer === 1 ? 1 : 2 }];
                        } else {
                            newMoveMarkers = [];
                        }
                    }
                }
                else
                    return;

                if (!newBoard)
                    return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                // 记录本步
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                if (moveType === 'place')
                    this.moveCoords.push({ type: 'move', player: slot, row, col });
                else
                    this.moveCoords.push({ type: 'swap', player: slot, fromRow, fromCol, row, col });

                this.board = newBoard;
                this.lastMoveMarkers = newMoveMarkers;
                this.moveHighlightMarkers = newHighlightMarkers;
                // 记录本步行棋方颜色（易位前的 currentPlayer）
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = null;   // 虚手无高亮
                this.moveCount++;
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyBoards.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) {
                    this.performUndo(steps, ws);
                } else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo && msg.accept) {
                    this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                } else if (this.pendingUndo && !msg.accept) {
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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝新开一局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (!msg.accept) {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        break;
                    }
                    this.pendingScore.agreed.add(ws);
                    if (this.pendingScore.agreed.size === 2) {
                        const lead = this.scoreProposalData.lead;
                        this.gameOver = true;
                        this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                        this.setScoreResultTextByLead(lead);
                        this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        this._stopClockTicker();
                    }
                }
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '对局中不能导入棋谱。' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            default:
                break;
        }
    }

    exportRecord() {
        const emptyBoard = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        return {
            format: 'muzei',
            version: 1,
            gameType: '易位围棋',
            gameId: 'translocation-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(emptyBoard, this.boardSize),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                if (m.type === 'swap') return p + 's' + [m.fromRow, m.fromCol, m.row, m.col].join(',');
                return p + m.row + ',' + m.col;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHighlightMarkers = [];
        this.movePlayerColor = null;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCount = 0;
        this.moveCoords = [];
        this.maxTranspositionMoves = this.computeMaxTranspositionMoves(this.boardSize);
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
    }

    /** 棋谱 initialPosition：优先紧凑字符串数组 ["B3,3","W4,4"]；兼容旧版 { black:[], white:[] } */
    applyInitialPositionFromRecord(initialPosition) {
        if (!initialPosition) return;
        if (Array.isArray(initialPosition)) {
            applyInitialPositionCompact(this.board, this.boardSize, initialPosition);
        } else if (typeof initialPosition === 'object') {
            if (Array.isArray(initialPosition.black)) {
                for (const pos of initialPosition.black) {
                    if (Array.isArray(pos) && pos.length === 2) this.board[pos[0]][pos[1]] = 1;
                }
            }
            if (Array.isArray(initialPosition.white)) {
                for (const pos of initialPosition.white) {
                    if (Array.isArray(pos) && pos.length === 2) this.board[pos[0]][pos[1]] = 2;
                }
            }
        }
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
    }

    static parseMove(entry) {
        if (entry && typeof entry === 'object') return entry;
        if (typeof entry !== 'string') return null;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        if (entry[1] === 's') {
            const parts = entry.substring(2).split(',').map(Number);
            if (parts.length === 4)
                return { type: 'swap', player, fromRow: parts[0], fromCol: parts[1], row: parts[2], col: parts[3] };
            return null;
        }
        const coords = entry.substring(1).split(',').map(Number);
        if (coords.length >= 2 && !coords.some(x => Number.isNaN(x)))
            return { type: 'move', player, row: coords[0], col: coords[1] };
        return null;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'translocation-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要易位围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        this.applyInitialPositionFromRecord(data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(TranspositionWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            if (!move) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            const expectedSlot = this.currentPlayer === 1 ? 'black' : 'white';
            if (slot !== expectedSlot) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方错误。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手出现重复局面。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;
            } else if (move.type === 'swap') {
                if (this.moveCount >= this.maxTranspositionMoves) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手易位次数已用尽。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const { fromRow, fromCol, row, col } = move;
                const newBoard = this.trySwapPiece(this.board, fromRow, fromCol, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法易位。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手出现重复局面。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'swap', player: slot, fromRow, fromCol, row, col });
                this.board = newBoard;
                const newHighlightMarkers = [
                    { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
                    { row, col, frameOnly: newBoard[row][col] === 0 }
                ];
                let newMoveMarkers = [];
                if (newBoard[row][col] === playerVal)
                    newMoveMarkers = [{ row, col, color: playerVal }];
                this.lastMoveMarkers = newMoveMarkers;
                this.moveHighlightMarkers = newHighlightMarkers;
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = null;
                this.moveCount++;
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
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = TranspositionWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition != null ? data.initialPosition : [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

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

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new TranspositionWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};