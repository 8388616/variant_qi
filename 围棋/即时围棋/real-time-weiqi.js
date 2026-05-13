const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact } = require('../common');

/**
 * 即时围棋：非回合制，双方可同时落子；同一时刻的落子按服务端收到顺序依次执行。
 * 每步提子顺序与标准围棋一致（先对方无气子，再己方无气子）。禁全同。无贴目。
 * 限时：双方共用一盘棋钟（仅主时间），用尽后自动进入数子流程。
 */
class RealTimeWeiqiRoom extends QiTwoPlayerRoomBase {
    /** 用于 go-timer-rule：仅显示「05:00」或「01:05:00」形式的基本用时 */
    static formatMainMinutesAsClock(mainMinutes) {
        const m = Math.max(0, Math.floor(Number(mainMinutes) || 0));
        const h = Math.floor(m / 60);
        const mm = m % 60;
        if (h > 0)
            return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
        return `${String(mm).padStart(2, '0')}:00`;
    }

    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        /** @type {{ remainingMs: number, lastUpdateMs: number, pauseCount: number, mainMinutes: number }|null} */
        this.sharedClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        this._enteringScoreFromTime = false;
        /** 共用棋钟已耗尽后进入数子；拒绝数子结果时不恢复对弈，仅再次提议数子 */
        this._sharedTimeExhausted = false;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    /**
     * 与 qi.js 中 sync 模式展示兼容：黑白两侧显示相同倒计时。
     */
    _snapshotMatchClockForClient() {
        if (!this.tcSettings || this.tcSettings.timed !== true || !this.sharedClock) {
            return null;
        }
        const now = Date.now();
        let displayMs = this.sharedClock.remainingMs;
        if (this.sharedClock.pauseCount <= 0) {
            displayMs = Math.max(0, this.sharedClock.remainingMs - (now - this.sharedClock.lastUpdateMs));
        }
        const mm = Math.max(0, this.tcSettings.mainMinutes | 0);
        return {
            timed: true,
            activeSlot: 'black',
            mainMinutes: mm,
            byoyomiSeconds: this.tcSettings.byoyomiSeconds ?? 0,
            maxTimeouts: this.tcSettings.maxTimeouts ?? 0,
            serverNow: now,
            ruleLine: RealTimeWeiqiRoom.formatMainMinutesAsClock(mm),
            syncMode: true,
            black: {
                mainMs: displayMs,
                inByo: false,
                byoMs: 0,
                timeoutsUsed: 0
            },
            white: {
                mainMs: displayMs,
                inByo: false,
                byoMs: 0,
                timeoutsUsed: 0
            },
            display: {
                syncMode: true,
                blackLive: true,
                whiteLive: true,
                blackCountdownMs: displayMs,
                whiteCountdownMs: displayMs
            }
        };
    }

    _broadcastClock() {
        if (!this.tcSettings || this.tcSettings.timed !== true || this.gameOver) return;
        const snap = this._snapshotMatchClockForClient();
        if (snap) this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.sharedClock || !this.tcSettings || this.tcSettings.timed !== true) return;
        this._clockInterval = setInterval(() => {
            if (!this.sharedClock || !this.tcSettings || this.tcSettings.timed !== true || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            if (this.pendingScore) return;
            const hit = this._applySharedElapsed(Date.now());
            if (hit) {
                this._stopClockTicker();
                this._beginScoreCountingFromSharedTimeUp();
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    /** @returns {boolean} true 表示棋钟已用尽 */
    _applySharedElapsed(nowMs) {
        const sc = this.sharedClock;
        if (!sc || sc.pauseCount > 0) {
            if (sc) sc.lastUpdateMs = nowMs;
            return false;
        }
        let elapsed = nowMs - sc.lastUpdateMs;
        if (elapsed < 0) elapsed = 0;
        sc.remainingMs = Math.max(0, sc.remainingMs - elapsed);
        sc.lastUpdateMs = nowMs;
        return sc.remainingMs <= 0;
    }

    _sharedPause(inc) {
        if (!this.sharedClock) return;
        const wasRunning = this.sharedClock.pauseCount <= 0;
        this.sharedClock.pauseCount = Math.max(0, this.sharedClock.pauseCount + inc);
        const now = Date.now();
        if (wasRunning && inc > 0) {
            this._applySharedElapsed(now);
        }
        if (inc < 0 && this.sharedClock.pauseCount <= 0) {
            this.sharedClock.lastUpdateMs = Date.now();
        }
    }

    _beginScoreCountingFromSharedTimeUp() {
        if (this.pendingScore || this.gameOver || this._enteringScoreFromTime) return;
        this._enteringScoreFromTime = true;
        this._sharedTimeExhausted = true;
        const room = this.room;
        const bp = room.getPlayerBySlot('black');
        const wp = room.getPlayerBySlot('white');
        try {
            if (bp && wp) this.startScoreCounting(bp, wp);
            else if (bp) this.startScoreCounting(bp, bp);
            else if (wp) this.startScoreCounting(wp, wp);
        } finally {
            this._enteringScoreFromTime = false;
        }
        this._broadcastClock();
    }

    _drainSharedBeforeAction(nowMs) {
        if (!this.sharedClock || !this.tcSettings || this.tcSettings.timed !== true || this.gameOver) return true;
        if (this.pendingScore) return true;
        const hit = this._applySharedElapsed(nowMs);
        if (hit) {
            this._beginScoreCountingFromSharedTimeUp();
            return false;
        }
        return true;
    }

    _clearTimeNegotiation(reason) {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset', reason: reason || 'cleared' });
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
        if (this.tcSettings.timed) {
            const mainMs = this.tcSettings.mainMinutes * 60 * 1000;
            this.sharedClock = {
                remainingMs: mainMs,
                lastUpdateMs: now,
                pauseCount: 0,
                mainMinutes: this.tcSettings.mainMinutes
            };
            this._sharedTimeExhausted = false;
            this._startClockTicker();
        } else {
            this.sharedClock = null;
            this._sharedTimeExhausted = false;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this._snapshotMatchClockForClient()
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

    _handleTimeControlAccept(ws, msg) {
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
        if (!slot) return false;
        return true;
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize, (b) => this.copyBoard(b), 1
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
        return blackTotal - whiteTotal;
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和胜';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            komi: 0,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcSettings && this.tcSettings.timed === false
                    ? { timed: false, ruleLine: '本局不限时' }
                    : this._snapshotMatchClockForClient()
            },
            matchStarted: this.matchStarted
        };
    }

    getStateForClient() {
        return this.getState();
    }

    /**
     * @param {{ skipClockPause?: boolean }} [opts]
     */
    startScoreCounting(requester, opponent, opts = {}) {
        if (!opts.skipClockPause && this.sharedClock && this.tcSettings && this.tcSettings.timed === true) {
            this._sharedPause(1);
        }
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    /**
     * 即时制落子：不检验 currentPlayer；禁全同与提子规则仍由 tryPlaceStone 与 historyBoardSet 保证。
     */
    _realtimePlaceStone(ws, msg, moveSlot) {
        if (this.gameOver) return;
        if (!this._timeAllowsPlay(moveSlot)) {
            if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
            return;
        }
        if (this.pendingScore) {
            ws.send(JSON.stringify({ type: 'error', message: '正在数子确认中，无法落子。' }));
            return;
        }
        const now = Date.now();
        if (!this._drainSharedBeforeAction(now)) {
            ws.send(JSON.stringify({ type: 'error', message: '共用棋钟已用尽，已进入数子。' }));
            return;
        }

        const { row, col } = msg;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
        if (this.board[row][col] !== 0) return;

        const playerVal = moveSlot === 'black' ? 1 : 2;
        const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
        if (!newBoard) return;

        const newBoardStr = this.boardToString(newBoard);
        if (this.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }

        this.historyBoards.push(this.copyBoard(newBoard));
        this.historyBoardSet.add(newBoardStr);
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(moveSlot);
        this.moveCoords.push({ type: 'move', player: moveSlot, row, col });
        this.board = newBoard;
        this.lastMoveMarkers = [{ row, col, color: playerVal }];
        this.currentPlayer = 3 - playerVal;
        this.passCounter = 0;

        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
        this._broadcastClock();
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws, msg);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move':
                this._realtimePlaceStone(ws, msg, slot);
                break;

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
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._sharedTimeExhausted = false;
                            this._stopClockTicker();
                        }
                    } else {
                        const req = this.pendingScore.requester;
                        const opp = this.pendingScore.opponent;
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        this.broadcast({ type: 'scoreRejected' });
                        if (this._sharedTimeExhausted) {
                            this.startScoreCounting(req, opp, { skipClockPause: true });
                        } else if (this.sharedClock && this.tcSettings && this.tcSettings.timed === true) {
                            this._sharedPause(-1);
                            this._startClockTicker();
                            this._broadcastClock();
                        }
                    }
                }
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

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
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
        if (this.historyBoards.length === 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._broadcastClock();
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.sharedClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this._enteringScoreFromTime = false;
        this._sharedTimeExhausted = false;
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
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
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
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '即时围棋',
            gameId: 'real-time-weiqi',
            boardSize: this.boardSize,
            komi: 0,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(this.board, this.boardSize),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.sharedClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this._enteringScoreFromTime = false;
        this._sharedTimeExhausted = false;
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
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'real-time-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要即时围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(RealTimeWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
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
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手违反禁全同` }));
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
                this.currentPlayer = 3 - playerVal;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
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
            this.winner = RealTimeWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
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

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            this.pendingScore = null;
            this.scoreProposalData = null;
            if (!this._sharedTimeExhausted && this.sharedClock && this.tcSettings && this.tcSettings.timed === true) {
                this._sharedPause(-1);
                this._startClockTicker();
                this._broadcastClock();
            }
        }
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new RealTimeWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
