const {
    qiProtocol,
    qiMatchTimeControl,
    applyInitialPositionCompact
} = require('../common');
const { WeiqiRoom } = require('./weiqi');

function mineKey(row, col) {
    return `${row},${col}`;
}

function parseMineKey(key) {
    const [r, c] = String(key).split(',').map(Number);
    return { row: r, col: c };
}

function setToMineList(set) {
    return [...set].map(parseMineKey);
}

/** 埋雷上限：ceil(总点数/91)，如 9 路 1 颗、19 路 4 颗 */
function defaultMineQuota(boardSize) {
    const n = boardSize | 0;
    return Math.max(0, Math.ceil((n * n) / 91));
}

class BuryMineWeiqiRoom extends WeiqiRoom {
    constructor(room, initialSize = 19) {
        super(room, initialSize);
        this._initMineFields();
    }

    _initMineFields() {
        const q = defaultMineQuota(this.boardSize);
        /** @type {'waiting'|'burying'|'playing'} */
        this.phase = 'waiting';
        this.mines = { player1: new Set(), player2: new Set() };
        this.mineQuota = { player1: q, player2: q };
        this.buryDone = { player1: false, player2: false };
        this.lockedMines = { player1: new Set(), player2: new Set() };
        this.pendingRebury = { player1: 0, player2: 0 };
        this.reburySkipOpp = { player1: false, player2: false };
        this.minesRevealedPublicly = false;
        this.isInitialBury = false;
    }

    _resetMineSessionForNewGame() {
        this._initMineFields();
    }

    _opponent(slot) {
        return slot === 'player1' ? 'player2' : 'player1';
    }

    _mineOwnersAt(row, col) {
        const k = mineKey(row, col);
        const owners = [];
        if (this.mines.player1.has(k)) owners.push('black');   // 展示用执方名（player1 在此棋种执黑）
        if (this.mines.player2.has(k)) owners.push('white');
        return owners;
    }

    _clearMinesAt(row, col) {
        const k = mineKey(row, col);
        const owners = [];
        if (this.mines.player1.has(k)) {
            this.mines.player1.delete(k);
            owners.push('black');
        }
        if (this.mines.player2.has(k)) {
            this.mines.player2.delete(k);
            owners.push('white');
        }
        return owners;
    }

    getMineFieldsForSlot(slot) {
        const revealed = this.minesRevealedPublicly || this.gameOver;
        const myMines = slot && this.mines[slot] ? setToMineList(this.mines[slot]) : [];
        const myLocked = slot && this.lockedMines[slot] ? setToMineList(this.lockedMines[slot]) : [];
        const allMines = revealed
            ? {
                player1: setToMineList(this.mines.player1),
                player2: setToMineList(this.mines.player2)
            }
            : null;
        return {
            phase: this.phase,
            isInitialBury: !!this.isInitialBury,
            buryDone: {
                player1: !!this.buryDone.player1,
                player2: !!this.buryDone.player2
            },
            mineQuota: {
                player1: this.mineQuota.player1 | 0,
                player2: this.mineQuota.player2 | 0
            },
            pendingRebury: {
                player1: this.pendingRebury.player1 | 0,
                player2: this.pendingRebury.player2 | 0
            },
            myMines,
            myLockedMines: myLocked,
            myMineCount: myMines.length,
            myMineQuota: slot ? (this.mineQuota[slot] | 0) : 0,
            myBuryDone: slot ? !!this.buryDone[slot] : true,
            minesRevealedPublicly: revealed,
            allMines
        };
    }

    getPublicMineFields() {
        return {
            phase: this.phase,
            isInitialBury: !!this.isInitialBury,
            buryDone: {
                player1: !!this.buryDone.player1,
                player2: !!this.buryDone.player2
            },
            mineQuota: {
                player1: this.mineQuota.player1 | 0,
                player2: this.mineQuota.player2 | 0
            },
            pendingRebury: {
                player1: this.pendingRebury.player1 | 0,
                player2: this.pendingRebury.player2 | 0
            },
            minesRevealedPublicly: !!(this.minesRevealedPublicly || this.gameOver),
            allMines: (this.minesRevealedPublicly || this.gameOver)
                ? {
                    player1: setToMineList(this.mines.player1),
                    player2: setToMineList(this.mines.player2)
                }
                : null
        };
    }

    getState() {
        return {
            ...super.getState(),
            ...this.getPublicMineFields(),
            myMines: [],
            myLockedMines: [],
            myMineCount: 0,
            myMineQuota: 0,
            myBuryDone: true
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        return {
            ...super.getState(),
            ...this.getMineFieldsForSlot(slot)
        };
    }

    getInitialState() {
        return this.getState();
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    /**
     * 带每方可见雷的广播。对仅含 clock 等非棋盘消息仍走普通 broadcast。
     */
    broadcast(data, exclude = null) {
        if (!data || typeof data !== 'object') {
            return super.broadcast(data, exclude);
        }
        const needsPerClient = data.board !== undefined
            || data.type === 'gameState'
            || data.type === 'newGameStarted'
            || data.type === 'roomReset'
            || data.type === 'importSuccess'
            || data.type === 'editBoardAccepted'
            || data.type === 'scoreAgreed'
            || data.type === 'scoreRejected'
            || data.type === 'scoreProposal'
            || (data.type === 'broadcast' && data.action);
        if (!needsPerClient) {
            return super.broadcast(data, exclude);
        }
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (exclude && client === exclude) continue;
            if (client.readyState !== 1) continue;
            const slot = this.room.getSlotByWs(client);
            const mineFields = this.getMineFieldsForSlot(slot);
            const { myMines, myLockedMines, myMineCount, myMineQuota, myBuryDone, allMines, ...restPublic } = data;
            void myMines; void myLockedMines; void myMineCount; void myMineQuota; void myBuryDone; void allMines;
            client.send(JSON.stringify({
                ...restPublic,
                ...this.getPublicMineFields(),
                ...mineFields
            }));
        }
    }

    onResignResolved(resignSlot) {
        this.minesRevealedPublicly = true;
        super.onResignResolved(resignSlot);
    }

    onDrawResolved() {
        this.minesRevealedPublicly = true;
        super.onDrawResolved();
    }

    setTimeLossResultText(lostSlot) {
        this.minesRevealedPublicly = true;
        super.setTimeLossResultText(lostSlot);
    }

    startScoreCounting(requester, opponent) {
        this.minesRevealedPublicly = true;
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        for (const client of [requester, opponent]) {
            if (!client || client.readyState !== 1) continue;
            client.send(JSON.stringify({
                type: 'scoreProposal',
                lead,
                ...this.getStateForClient(client)
            }));
        }
        this.pendingScore = { requester, opponent, agreed: new Set() };
        this.broadcast({ type: 'broadcast', action: 'scoreCountingStarted', ...this.getState() });
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
                this.minesRevealedPublicly = true;
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

    _convertClockToNormalPlay(nowMs) {
        if (!this.tcClock || !this.tcClock.timed) return;
        const now = nowMs != null ? nowMs : Date.now();
        qiMatchTimeControl.drain(this.tcClock, now);
        this.tcClock.syncMode = false;
        this.tcClock.player1Running = false;
        this.tcClock.player2Running = false;
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, now);
    }

    _beginBuryPhase({ initial }) {
        this.phase = 'burying';
        this.isInitialBury = !!initial;
        this.buryDone = { player1: false, player2: false };
        if (initial) {
            const q = defaultMineQuota(this.boardSize);
            this.mineQuota = { player1: q, player2: q };
            this.mines = { player1: new Set(), player2: new Set() };
            this.lockedMines = { player1: new Set(), player2: new Set() };
            this.pendingRebury = { player1: 0, player2: 0 };
            this.reburySkipOpp = { player1: false, player2: false };
        }
        const now = Date.now();
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.drain(this.tcClock, now);
            this.tcClock.syncMode = true;
            this.tcClock.player1Running = !this.buryDone.player1;
            this.tcClock.player2Running = !this.buryDone.player2;
            this.tcClock.lastUpdateMs = now;
            this._startClockTicker();
            this._broadcastClock();
        }
    }

    _beginReburyFor(owners) {
        if (!owners || !owners.length || this.gameOver) return;
        const uniq = [...new Set(owners)].filter(s => s === 'black' || s === 'white');
        if (!uniq.length) return;
        this.phase = 'burying';
        this.isInitialBury = false;
        this.buryDone = { player1: true, player2: true };
        for (const slot of uniq) {
            this.buryDone[slot] = false;
            this.lockedMines[slot] = new Set(this.mines[slot]);
        }
        for (const slot of ['player1', 'player2']) {
            if (this.buryDone[slot]) this.lockedMines[slot] = new Set();
        }
        const now = Date.now();
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.drain(this.tcClock, now);
            this.tcClock.syncMode = true;
            this.tcClock.player1Running = !this.buryDone.player1;
            this.tcClock.player2Running = !this.buryDone.player2;
            this.tcClock.lastUpdateMs = now;
            this._startClockTicker();
            this._broadcastClock();
        }
        this.broadcast({ type: 'broadcast', action: 'buryPhase', ...this.getState() });
    }

    _bothBuryReady() {
        return !!this.buryDone.player1 && !!this.buryDone.player2;
    }

    _finishBury(slot) {
        if (this.phase !== 'burying' || this.gameOver) return;
        if (!slot || this.buryDone[slot]) return;

        // 未埋满则永久减少配额
        this.mineQuota[slot] = this.mines[slot].size;
        this.pendingRebury[slot] = 0;
        this.buryDone[slot] = true;
        this.lockedMines[slot] = new Set(this.mines[slot]);

        const now = Date.now();
        if (this.tcClock && this.tcClock.timed && this.tcClock.syncMode) {
            const r = qiMatchTimeControl.commitSyncSide(this.tcClock, slot, now);
            if (r.lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = r.winnerSlot;
                this.minesRevealedPublicly = true;
                this.setTimeLossResultText(r.lostSlot);
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: r.lostSlot,
                    winner: r.winnerSlot,
                    ...this.getState()
                });
                return;
            }
            this._broadcastClock();
        }

        if (this._bothBuryReady()) {
            this.phase = 'playing';
            this.isInitialBury = false;
            this.lockedMines = { player1: new Set(), player2: new Set() };
            this._convertClockToNormalPlay(now);
            this._broadcastClock();
            this.broadcast({ type: 'broadcast', action: 'buryDoneAll', ...this.getState() });
        } else {
            this.broadcast({ type: 'broadcast', action: 'buryDone', player: slot, ...this.getState() });
        }
    }

    _noteMineCleared(owner, hitterSlot) {
        this.pendingRebury[owner] = (this.pendingRebury[owner] | 0) + 1;
        if (hitterSlot === this._opponent(owner)) {
            this.reburySkipOpp[owner] = true;
        }
    }

    _afterActionComplete(actingSlot) {
        if (this.phase !== 'playing' || this.gameOver) return;
        const toRebury = [];
        for (const owner of ['black', 'white']) {
            if ((this.pendingRebury[owner] | 0) <= 0) continue;
            const opp = this._opponent(owner);
            if (actingSlot !== opp) continue;
            if (this.reburySkipOpp[owner]) {
                this.reburySkipOpp[owner] = false;
                continue;
            }
            toRebury.push(owner);
        }
        if (toRebury.length) this._beginReburyFor(toRebury);
    }

    _timeAllowsPlay(slot) {
        if (this.phase === 'burying') return false;
        return super._timeAllowsPlay(slot);
    }

    _finalizeTimeControl(valid) {
        if (this.boardSeatOverlay) {
            const chooserSlot = (valid && valid.colorChooserSlot)
                || (this.tcNego && this.tcNego.lastProposerSlot)
                || this._firstPickerSlot();
            this._applyChooserColorChoice((valid && valid.colorChoice) || 'black', chooserSlot);
            this._notifyColorsAfterHostChoice();
        }
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
        if (valid.timed) {
            this.tcClock = qiMatchTimeControl.createSyncClock(this.tcSettings, now);
        } else {
            this.tcClock = null;
        }
        this._beginBuryPhase({ initial: true });
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null,
            ...this.getState()
        });
    }

    _handleBuryClick(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (this.phase !== 'burying' || this.gameOver) return;
        if (!slot || this.buryDone[slot]) return;
        const row = msg.row | 0;
        const col = msg.col | 0;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
        if (this.board[row][col] !== 0) {
            ws.send(JSON.stringify({ type: 'error', message: '该处已有棋子，不能埋雷。' }));
            return;
        }
        const k = mineKey(row, col);
        const set = this.mines[slot];
        const locked = this.lockedMines[slot];
        if (set.has(k)) {
            if (locked.has(k)) {
                ws.send(JSON.stringify({ type: 'error', message: '已埋好的雷不能取消。' }));
                return;
            }
            set.delete(k);
            this.broadcast({ type: 'broadcast', action: 'buryClick', player: slot, ...this.getState() });
            return;
        }
        if (set.size >= (this.mineQuota[slot] | 0)) {
            ws.send(JSON.stringify({ type: 'error', message: '埋雷数量已达上限。' }));
            return;
        }
        set.add(k);
        this.broadcast({ type: 'broadcast', action: 'buryClick', player: slot, ...this.getState() });
    }

    _handleMineHit(ws, slot, row, col, owners) {
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        this._clearMinesAt(row, col);
        for (const owner of owners) this._noteMineCleared(owner, slot);

        this.historyBoards.push(this.copyBoard(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'mineHit', player: slot, row, col, owners: owners.slice() });
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this.lastMoveMarkers = [{ row, col, color: playerVal }];

        this.broadcast({
            type: 'broadcast',
            action: 'mineHit',
            player: slot,
            row,
            col,
            ...this.getState()
        });
        this._syncClockAfterTurnChange();
        this._afterActionComplete(slot);
    }

    _handleMove(ws, msg) {
        const moveSlot = this.room.getSlotByWs(ws);
        if (this.phase === 'burying') {
            if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '埋雷阶段不能落子。' }));
            return;
        }
        if (!this._timeAllowsPlay(moveSlot)) {
            if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
            return;
        }
        if (!this._drainClockBeforeMove(moveSlot)) return;
        if (this.gameOver) return;
        if (!moveSlot || moveSlot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;

        const row = msg.row | 0;
        const col = msg.col | 0;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;

        const owners = this._mineOwnersAt(row, col);
        if (owners.length) {
            this._handleMineHit(ws, moveSlot, row, col, owners);
            return;
        }

        if (this.board[row][col] !== 0) return;

        const playerVal = this.currentPlayer === 1 ? 1 : 2;
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
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;

        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
        this._syncClockAfterTurnChange();
        this._afterActionComplete(moveSlot);
    }

    _handlePass(ws) {
        const passSlot = this.room.getSlotByWs(ws);
        if (this.phase === 'burying') return;
        if (!this._timeAllowsPlay(passSlot)) {
            if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
            return;
        }
        if (!this._drainClockBeforeMove(passSlot)) return;
        if (this.gameOver) return;
        if (!passSlot || passSlot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;

        this.historyBoards.push(this.copyBoard(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(passSlot);
        this.moveCoords.push({ type: 'pass', player: passSlot });
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.passCounter++;
        this.lastMoveMarkers = [];
        this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
        if (this.passCounter >= 2) {
            this.passCounter = 0;
            const blackPlayer = this.room.getPlayerBySlot('player1');
            const whitePlayer = this.room.getPlayerBySlot('player2');
            if (blackPlayer && whitePlayer) {
                this.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                this.gameOver = true;
                this.minesRevealedPublicly = true;
                this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
            }
        }
        this._syncClockAfterTurnChange();
        this._afterActionComplete(passSlot);
    }

    handleMessage(ws, msg) {
        switch (msg.type) {
            case 'buryClick':
                this._handleBuryClick(ws, msg);
                return;
            case 'buryFinish': {
                const slot = this.room.getSlotByWs(ws);
                this._finishBury(slot);
                return;
            }
            case 'move':
                this._handleMove(ws, msg);
                return;
            case 'pass':
                this._handlePass(ws);
                return;
            case 'resign':
                this.minesRevealedPublicly = true;
                break;
            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.minesRevealedPublicly = true;
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead, ...this.getState() });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._stopClockTicker();
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected', ...this.getState() });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                return;
            case 'requestUndo':
            case 'undoResponse':
                if (this.phase === 'burying') return;
                break;
            case 'requestEnd':
            case 'endResponse':
            case 'requestDraw':
            case 'drawResponse':
                if (this.phase === 'burying') return;
                break;
            default:
                break;
        }
        super.handleMessage(ws, msg);
    }

    performUndo(steps, requesterWs) {
        if (this.phase === 'burying') return;
        super.performUndo(steps, requesterWs);
        this.pendingRebury = { player1: 0, player2: 0 };
        this.reburySkipOpp = { player1: false, player2: false };
    }

    resetGame() {
        super.resetGame();
        this._resetMineSessionForNewGame();
    }

    resetToEmpty() {
        super.resetToEmpty();
        this._resetMineSessionForNewGame();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            if (requesterWs) requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        const base = super.exportRecord();
        base.gameType = '埋雷围棋';
        base.gameId = 'bury-mine-weiqi';
        base.mines = {
            player1: setToMineList(this.mines.player1),
            player2: setToMineList(this.mines.player2)
        };
        base.mineQuota = {
            player1: this.mineQuota.player1 | 0,
            player2: this.mineQuota.player2 | 0
        };
        base.moves = this.moveCoords.map(m => {
            const p = m.player === 'player1' ? 'B' : 'W';
            if (m.type === 'pass') return p + 'p';
            if (m.type === 'mineHit') return p + 'm' + m.row + ',' + m.col;
            return p + m.row + ',' + m.col;
        });
        return base;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player };
            if (entry[1] === 'm') {
                const coords = entry.substring(2).split(',').map(Number);
                return { type: 'mineHit', player, row: coords[0], col: coords[1] };
            }
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'bury-mine-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要埋雷围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();
        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        if (data.mines) {
            for (const slot of ['player1', 'player2']) {
                const list = data.mines[slot] || [];
                this.mines[slot] = new Set();
                for (const m of list) {
                    const r = m.row != null ? m.row : m.r;
                    const c = m.col != null ? m.col : m.c;
                    if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize) {
                        this.mines[slot].add(mineKey(r, c));
                    }
                }
            }
        }
        if (data.mineQuota) {
            this.mineQuota.player1 = data.mineQuota.player1 | 0;
            this.mineQuota.player2 = data.mineQuota.player2 | 0;
        } else {
            const q = defaultMineQuota(this.boardSize);
            this.mineQuota = { player1: q, player2: q };
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(BuryMineWeiqiRoom.parseMove);
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
            } else if (move.type === 'mineHit') {
                const { row, col } = move;
                this._clearMinesAt(row, col);
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
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

        this.phase = 'playing';
        this.buryDone = { player1: true, player2: true };
        this.minesRevealedPublicly = true;

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
            this.winner = WeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')) {
                this.winner = data.result;
            }
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
}

module.exports = {
    BuryMineWeiqiRoom,
    initRoom(room) {
        room.gameLogic = new BuryMineWeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};
