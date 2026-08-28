const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');

class UkrainianWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 19;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.moveCoords = [];
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.normalGoPhase = false;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;

        this.SHAPES = [
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [0, 1], [1, -1]],
            [[-1, -1], [0, 1], [1, 0]],
            [[-1, -1], [1, -1], [-1, 1]]
        ];
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.gameOver) return;
        if (this.moveHistory.length > 0) return;
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
        const activeSlot = this.currentPlayer === 1 ? 'black' : 'white';
        qiMatchTimeControl.setActiveSlot(this.tcClock, activeSlot, Date.now());
        this._broadcastClock();
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

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'black') this.recordResultText = '黑超时白胜';
        else if (lostSlot === 'white') this.recordResultText = '白超时黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    transformCoords(baseCoords, rot, flip) {
        return baseCoords.map(([dr, dc]) => {
            let r = dr, c = dc;
            for (let i = 0; i < rot; i++) { [r, c] = [-c, r]; }
            if (flip) c = -c;
            return [r, c];
        });
    }

    generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol) {
        const base = this.SHAPES[shapeIdx];
        const transformed = this.transformCoords(base, rot, flip);
        return transformed.map(([dr, dc]) => [refRow + dr, refCol + dc]);
    }

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b), 2);
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    tryPlaceShape(boardBefore, shapeIdx, rot, flip, refRow, refCol, playerVal) {
        const coords = this.generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol);
        if (!coords) return null;
        for (let [r, c] of coords) {
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }

        const newBoard = this.copyBoard(boardBefore);
        for (let [r, c] of coords) newBoard[r][c] = playerVal;

        const affectedEnemy = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of coords) {
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal)
                    affectedEnemy.add(`${nr},${nc}`);
            }
        }

        for (let key of affectedEnemy) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }

        for (let [r, c] of coords) {
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }

        return newBoard;
    }

    tryPlaceStonesAt(boardBefore, stoneCoords, playerVal) {
        if (!stoneCoords || stoneCoords.length === 0) return null;
        for (let [r, c] of stoneCoords) {
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }
        const newBoard = this.copyBoard(boardBefore);
        for (let [r, c] of stoneCoords) newBoard[r][c] = playerVal;

        const affectedEnemy = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of stoneCoords) {
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal)
                    affectedEnemy.add(`${nr},${nc}`);
            }
        }
        for (let key of affectedEnemy) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }
        for (let [r, c] of stoneCoords) {
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }
        return newBoard;
    }

    inferShapeIndexFromStones(stones) {
        if (!stones || stones.length !== 3) return -1;
        const norm = (arr) => [...arr].map(([r, c]) => `${r},${c}`).sort().join('|');
        const target = norm(stones);
        for (let shapeIdx = 0; shapeIdx < this.SHAPES.length; shapeIdx++) {
            for (let rot = 0; rot < 4; rot++) {
                for (let flip of [false, true]) {
                    const t = this.transformCoords(this.SHAPES[shapeIdx], rot, flip);
                    for (let refR = 0; refR < this.boardSize; refR++) {
                        for (let refC = 0; refC < this.boardSize; refC++) {
                            const placed = t.map(([dr, dc]) => [refR + dr, refC + dc]);
                            if (placed.some(([r, c]) => r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize)) continue;
                            if (norm(placed) === target) return shapeIdx;
                        }
                    }
                }
            }
        }
        return -1;
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        let matchClock = null;
        const tc = this.tcClock;
        if (tc && tc.timed) {
            matchClock = qiMatchTimeControl.snapshotForClient(tc);
        } else if (this.tcSettings && this.tcSettings.timed === false) {
            matchClock = { timed: false, ruleLine: '本局不限时' };
        }
        return {
            boardSize: this.boardSize,
            board: this.board,
            komi: 3.25,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            lastUsedShapeByColor: this.lastUsedShapeByColor,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: matchClock
            },
            matchStarted: this.matchStarted,
            normalGoPhase: this.normalGoPhase
        };
    }

    _syncPhaseFromMoveCoords() {
        let inNormal = false;
        let pc = 0;
        for (const m of this.moveCoords) {
            if (!m) continue;
            if (m.type === 'pass') {
                pc++;
            } else {
                // 旧棋谱可能含第二阶段单子着法；新规则不再进入正常围棋阶段
                if (m.singleStone) inNormal = true;
                pc = 0;
            }
        }
        this.normalGoPhase = inNormal;
        this.passCounter = pc;
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                const lastBoardStr = this.boardToString(this.historyBoards[this.historyBoards.length - 1]);
                this.historyBoardSet.delete(lastBoardStr);
                this.historyBoards.pop();
            }
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.historyLastUsed.length > 0) this.lastUsedShapeByColor = this.historyLastUsed.pop();
            else this.lastUsedShapeByColor = { 1: -1, 2: -1 };
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        } else {
            this.board = this.copyBoard(this.historyBoards[this.historyBoards.length - 1]);
        }
        this._syncPhaseFromMoveCoords();
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    resetGame() {
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
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.normalGoPhase = false;
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const single = requester === opponent;
        const proposalMsg = single
            ? { type: 'scoreProposal', lead, ...this.getState() }
            : { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        if (!single) opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set(), singlePlayerConfirm: single };
    }

    compoundPass(slot) {
        const room = this.room;
        const passPlayerVal = this.currentPlayer === 1 ? 1 : 2;
        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'pass', player: slot });
        this.lastUsedShapeByColor[passPlayerVal] = -1;
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter++;
        this.lastMoveMarkers = [];

        if (this.passCounter >= 4) {
            this.passCounter = 0;
            const blackPlayer = room.getPlayerBySlot('black');
            const whitePlayer = room.getPlayerBySlot('white');
            this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
            if (blackPlayer && whitePlayer) {
                this.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                this.gameOver = true;
                this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
            }
            return;
        }
        this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
    }

    /**
     * @param {{ preBoard?: number[][] }} [opts]
     * @returns {boolean}
     */
    _applyCompoundMove(moveSlot, shapeIndex, rotation, flipped, row, col, opts = {}) {
        if (this.normalGoPhase) return false;
        if (!this._timeAllowsPlay(moveSlot)) return false;
        if (this.gameOver) return false;
        if (moveSlot !== (this.currentPlayer === 1 ? 'black' : 'white')) return false;
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        if (this.lastUsedShapeByColor[playerVal] === shapeIndex) return false;
        const newBoard = opts.preBoard != null
            ? opts.preBoard
            : this.tryPlaceShape(this.board, shapeIndex, rotation, flipped, row, col, playerVal);
        if (!newBoard) return false;
        const newBoardStr = this.boardToString(newBoard);
        if (this.historyBoardSet.has(newBoardStr)) return false;
        if (!this._drainClockBeforeMove(moveSlot)) return false;

        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(newBoardStr);
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
        this.moveHistory.push(moveSlot);
        this.board = newBoard;
        const coords = this.generatePlacementCoords(shapeIndex, rotation, flipped, row, col);
        const stoneList = coords.map(([r, c]) => [r, c]);
        this.moveCoords.push({ type: 'move', player: moveSlot, stones: stoneList });
        this.lastMoveMarkers = coords.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
        this.lastUsedShapeByColor[playerVal] = shapeIndex;
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
        this._syncClockAfterTurnChange();
        return true;
    }

    /**
     * @param {{ preBoard?: number[][] }} [opts]
     * @returns {boolean}
     */
    _applySingleStoneMove(moveSlot, row, col, opts = {}) {
        if (!this.normalGoPhase) return false;
        if (!this._timeAllowsPlay(moveSlot)) return false;
        if (this.gameOver) return false;
        if (moveSlot !== (this.currentPlayer === 1 ? 'black' : 'white')) return false;
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return false;
        const newBoard = opts.preBoard != null
            ? opts.preBoard
            : this.tryPlaceStonesAt(this.board, [[row, col]], playerVal);
        if (!newBoard) return false;
        const newBoardStr = this.boardToString(newBoard);
        if (this.historyBoardSet.has(newBoardStr)) return false;
        if (!this._drainClockBeforeMove(moveSlot)) return false;

        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(newBoardStr);
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
        this.moveHistory.push(moveSlot);
        this.board = newBoard;
        this.moveCoords.push({ type: 'move', player: moveSlot, stones: [[row, col]], singleStone: true });
        this.lastMoveMarkers = [{ row, col, color: playerVal }];
        this.lastUsedShapeByColor[playerVal] = -1;
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
        this._syncClockAfterTurnChange();
        return true;
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
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (this.normalGoPhase) {
                    if (!msg.singleStone || msg.row === undefined || msg.col === undefined) return;
                    const { row, col } = msg;
                    const playerVal = this.currentPlayer === 1 ? 1 : 2;
                    const newBoard = this.tryPlaceStonesAt(this.board, [[row, col]], playerVal);
                    if (!newBoard) return;
                    const newBoardStr = this.boardToString(newBoard);
                    if (this.historyBoardSet.has(newBoardStr)) {
                        ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                        return;
                    }
                    if (!this._applySingleStoneMove(moveSlot, row, col, { preBoard: newBoard })) return;
                    break;
                }
                const { shapeIndex, rotation, flipped, row, col } = msg;
                if (shapeIndex === undefined || rotation === undefined || flipped === undefined || row === undefined || col === undefined) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                if (this.lastUsedShapeByColor[playerVal] === shapeIndex) return;
                const newBoard = this.tryPlaceShape(this.board, shapeIndex, rotation, flipped, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                if (!this._applyCompoundMove(moveSlot, shapeIndex, rotation, flipped, row, col, { preBoard: newBoard })) return;
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(passSlot)) return;
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.compoundPass(slot);
                this._syncClockAfterTurnChange();
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot, { cannotUndoMsg: '无法悔棋。' });
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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        const need = this.pendingScore.singlePlayerConfirm ? 1 : 2;
                        if (this.pendingScore.agreed.size >= need) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._stopClockTicker();
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱。' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            default:
                break;
        }
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.normalGoPhase = false;
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
            gameType: '乌克兰围棋',
            gameId: 'ukrainian-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                return p + m.stones.map(([r, c]) => `${r},${c}`).join(';');
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
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
        this.moveCoords = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.normalGoPhase = false;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'object' && entry !== null) return entry;
        const s = entry;
        const player = s[0] === 'B' ? 'black' : 'white';
        if (s[1] === 'p') return { type: 'pass', player };
        const rest = s.slice(1);
        const parts = rest.split(';').filter(Boolean);
        const stones = parts.map(part => {
            const [r, c] = part.split(',').map(Number);
            return [r, c];
        });
        return { type: 'move', player, stones, singleStone: stones.length === 1 };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'ukrainian-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要乌克兰围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(UkrainianWeiqiRoom.parseMove);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;

            if (move.type === 'move') {
                const stones = move.stones;
                if (!stones || stones.length === 0) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手缺少坐标` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                for (const [r, c] of stones) {
                    if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                }
                if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不一致` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStonesAt(this.board, stones, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                const singleStone = stones.length === 1 || move.singleStone === true;
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    stones: stones.map(([r, c]) => [r, c]),
                    ...(singleStone ? { singleStone: true } : {})
                });
                this.board = newBoard;
                this.lastMoveMarkers = stones.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                if (singleStone) this.lastUsedShapeByColor[playerVal] = -1;
                else {
                    const si = this.inferShapeIndexFromStones(stones);
                    this.lastUsedShapeByColor[playerVal] = si >= 0 ? si : -1;
                }
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手虚着方不一致` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(this.boardToString(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastUsedShapeByColor[playerVal] = -1;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
        }

        this._syncPhaseFromMoveCoords();

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
            this.winner = UkrainianWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => {
                    if (m.type === 'pass') return { type: 'pass', player: m.player };
                    return { type: 'move', player: m.player, stones: m.stones.map(([r, c]) => [r, c]) };
                })
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
    initRoom(room) {
        room.gameLogic = new UkrainianWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
