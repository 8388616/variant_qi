const { QiTwoPlayerRoomBase, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact } = require('../common');
class InvisibleStoneWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = this.emptyBoard();
        this.openingBoard = this.copyBoard(this.board);
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
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
        this.plainWeiqiStartHand = null;
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
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
        this.broadcastFlat({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
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
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
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
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        this.room.getPlayerBySlot(first)?.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        this.room.getPlayerBySlot(other)?.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'timeControlNegotiation',
            mode: 'respond',
            proposal: { ok: true, timed: proposal.timed, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts }
        }));
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
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
        this.broadcastFlat({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.room.getPlayerBySlot(slot)?.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.room.getPlayerBySlot(slot)?.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
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
        return slot === (this.currentPlayer === 1 ? 'black' : 'white');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker();
        this.gameOver = true;
        this.winner = winnerSlot;
        this.setTimeLossResultText(lostSlot);
        this.broadcastState('timeLoss', { player: lostSlot, winner: winnerSlot });
        return false;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
        this._broadcastClock();
    }

    emptyBoard() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
    }

    emptyInvisible() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
    }
    copyInvisible(src) { return src.map(row => row.slice()); }

    diffRemovedStones(oldBoard, newBoard) {
        const out = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const o = oldBoard[r][c];
                const n = newBoard[r][c];
                if (o !== 0 && n === 0) out.push({ row: r, col: c, color: o });
            }
        }
        return out;
    }

    /**
     * 本手落子点落子前为空；若落子后该点被提（整块被提），diffRemovedStones 不会包含该点，
     * 但参与「提子邻格显形」时必须把该点当作被提子之一。
     */
    dedupeRemovedStones(removed) {
        const seen = new Set();
        const out = [];
        for (const x of removed) {
            const k = `${x.row},${x.col}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(x);
        }
        return out;
    }

    removedStonesForCapture(oldBoard, newBoard, moveRow, moveCol, playerVal) {
        let removed = this.diffRemovedStones(oldBoard, newBoard);
        if (oldBoard[moveRow][moveCol] === 0 && newBoard[moveRow][moveCol] === 0)
            removed = removed.concat([{ row: moveRow, col: moveCol, color: playerVal }]);
        return this.dedupeRemovedStones(removed);
    }

    revealMoveAt(row, col, playerSlot) {
        for (const m of this.moveCoords) {
            if (m.type !== 'move') continue;
            if (m.player !== playerSlot) continue;
            if (m.row === row && m.col === col) {
                m.invisible = false;
                m.concealedFromOpponent = false;
            }
        }
    }

    /**
     * 与任一方被提子四邻、仍留在盘上的隐身子均显形（含：提对方子时邻格我方隐子、自提时邻格对方隐子）。
     */
    revealParticipatingInvisibleForCapture(removed) {
        if (!removed || removed.length === 0) return;
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const seen = new Set();
        for (const { row: rr, col: cc } of removed) {
            for (const [dr, dc] of dirs) {
                const nr = rr + dr;
                const nc = cc + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                const v = this.board[nr][nc];
                if (v !== 1 && v !== 2) continue;
                if (!this.invisible[nr][nc]) continue;
                const key = `${nr},${nc}`;
                if (seen.has(key)) continue;
                seen.add(key);
                this.invisible[nr][nc] = false;
                const ps = v === 1 ? 'black' : 'white';
                this.revealMoveAt(nr, nc, ps);
            }
        }
    }

    revealAllInvisible() {
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (!this.invisible[r][c]) continue;
                this.invisible[r][c] = false;
                const v = this.board[r][c];
                if (v === 0) continue;
                const ps = v === 1 ? 'black' : 'white';
                this.revealMoveAt(r, c, ps);
            }
        }
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

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 4.25;
        return blackTotal - whiteTotal - 2 * KOMI;
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
        this.recordResultText = `${lead > 0 ? '黑' : '白'}胜${Math.abs(lead).toFixed(2)}点`;
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

    /**
     * @param {boolean} gameOver 终局后全员可见完整盘面，不再遮蔽隐身子
     */
    buildViewBoardFromState(board, inv, slot, gameOver) {
        if (gameOver)
            return this.copyBoard(board);
        const isSpectator = slot !== 'black' && slot !== 'white';
        const out = this.emptyBoard();
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const v = board[r][c];
                if (v === 0) continue;
                if (inv[r][c]) {
                    if (isSpectator) {
                        continue;
                    } else if (slot === 'black') {
                        if (v === 1) out[r][c] = v;
                    } else {
                        if (v === 2) out[r][c] = v;
                    }
                } else {
                    out[r][c] = v;
                }
            }
        }
        return out;
    }

    buildViewBoard(slot) {
        return this.buildViewBoardFromState(this.board, this.invisible, slot, this.gameOver);
    }

    buildInvisibleTintFromState(board, inv, slot, gameOver) {
        const list = [];
        if (gameOver) return list;
        if (slot !== 'black' && slot !== 'white') return list;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] === 0) continue;
                if (!inv[r][c]) continue;
                if (slot === 'black' && board[r][c] === 1) {
                    list.push({ row: r, col: c });
                } else if (slot === 'white' && board[r][c] === 2) {
                    list.push({ row: r, col: c });
                }
            }
        }
        return list;
    }

    buildInvisibleTint(slot) {
        return this.buildInvisibleTintFromState(this.board, this.invisible, slot, this.gameOver);
    }

    /** 与客户端 liveReplay 逐步 tint 一致：每步为 "row,col" 字符串数组 */
    buildInvisibleTintKeyStringsFromState(board, inv, slot, gameOver) {
        if (gameOver) return [];
        if (slot !== 'black' && slot !== 'white') return [];
        const list = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] === 0) continue;
                if (!inv[r][c]) continue;
                if (slot === 'black' && board[r][c] === 1)
                    list.push(`${r},${c}`);
                else if (slot === 'white' && board[r][c] === 2)
                    list.push(`${r},${c}`);
            }
        }
        return list;
    }

    /** 逐步「本座位可见」盘面，供前端打谱条与中途进房使用（不依赖向对手下发完整手顺）。 */
    buildReplayViewBoardsForSlot(slot) {
        const gameOver = this.gameOver;
        const out = [];
        let board = this.copyBoard(this.openingBoard);
        let inv = this.emptyInvisible();
        out.push(this.buildViewBoardFromState(board, inv, slot, gameOver));
        for (let i = 0; i < this.historyBoards.length; i++) {
            board = this.copyBoard(this.historyBoards[i]);
            inv = this.copyInvisible(this.historyInvisible[i]);
            out.push(this.buildViewBoardFromState(board, inv, slot, gameOver));
        }
        return out;
    }

    buildReplayInvisibleTintKeyStringsForSlot(slot) {
        const gameOver = this.gameOver;
        const out = [];
        let board = this.copyBoard(this.openingBoard);
        let inv = this.emptyInvisible();
        out.push(this.buildInvisibleTintKeyStringsFromState(board, inv, slot, gameOver));
        for (let i = 0; i < this.historyBoards.length; i++) {
            board = this.copyBoard(this.historyBoards[i]);
            inv = this.copyInvisible(this.historyInvisible[i]);
            out.push(this.buildInvisibleTintKeyStringsFromState(board, inv, slot, gameOver));
        }
        return out;
    }

    /** 盘上仍为隐身状态（未显形）的隐身子枚数，双方各计（与视角无关）。 */
    countInvisibleOn(board, inv) {
        let black = 0;
        let white = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (!inv[r][c]) continue;
                const v = board[r][c];
                if (v === 1) black++;
                else if (v === 2) white++;
            }
        }
        return { black, white };
    }

    getInvisibleStoneCounts() {
        return this.countInvisibleOn(this.board, this.invisible);
    }

    /**
     * 与 numberOfHands 对齐：第 0 项为开局（含让子初始局面），第 k 项为第 k 手结束后。
     * 供客户端打谱式前进后退与进度条使用（不依赖被遮蔽的 moveCoords）。
     */
    buildInvisibleStoneCountsTimeline() {
        const out = [];
        let board = this.copyBoard(this.openingBoard);
        let inv = this.emptyInvisible();
        out.push(this.countInvisibleOn(board, inv));
        for (let i = 0; i < this.historyBoards.length; i++) {
            board = this.copyBoard(this.historyBoards[i]);
            inv = this.copyInvisible(this.historyInvisible[i]);
            out.push(this.countInvisibleOn(board, inv));
        }
        return out;
    }

    filterMoveCoordsForSlot(slot) {
        if (this.gameOver)
            return this.moveCoords.map(m => ({ ...m }));
        return this.moveCoords.map(m => {
            if (m.type === 'pass' && m.reason === 'hitInvisible') {
                if (slot === m.player)
                    return { ...m };
                return { type: 'pass', player: m.player, reason: 'hitInvisible' };
            }
            if (m.type !== 'move') return { ...m };
            if (slot === m.player)
                return { ...m };
            if (m.concealedFromOpponent)
                return { type: 'move', player: m.player, concealed: true };
            return { type: 'move', player: m.player, row: m.row, col: m.col, invisible: m.invisible };
        });
    }

    /** 对方与观战者不显示落在隐身子上的最后一手标记 */
    filterLastMoveMarkers(slot) {
        if (this.gameOver)
            return this.lastMoveMarkers.map(m => ({ row: m.row, col: m.col, color: m.color }));
        const isSpectator = slot !== 'black' && slot !== 'white';
        if (!this.lastMoveMarkers.length) return [];
        return this.lastMoveMarkers.filter(m => {
            const { row, col, color } = m;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return true;
            if (!this.invisible[row][col]) return true;
            if (isSpectator) return false;
            const blackStone = color === 1;
            if (blackStone && slot === 'white') return false;
            if (!blackStone && slot === 'black') return false;
            return true;
        }).map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        return {
            boardSize: this.boardSize,
            board: this.buildViewBoard(slot),
            invisibleTint: this.buildInvisibleTint(slot),
            useServerBoard: true,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.filterLastMoveMarkers(slot),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.filterMoveCoordsForSlot(slot),
            plainWeiqiStartHand: this.plainWeiqiStartHand,
            invisibleStoneCounts: this.getInvisibleStoneCounts(),
            invisibleStoneCountsTimeline: this.buildInvisibleStoneCountsTimeline(),
            replayViewBoards: this.buildReplayViewBoardsForSlot(slot),
            replayViewInvisibleTints: this.buildReplayInvisibleTintKeyStringsForSlot(slot),
            /** 完整手顺；对局中向对方/观战者不下发隐身子坐标（与 filterMoveCoordsForSlot 一致）。终局后全员下发完整手顺。 */
            replaySync: {
                initialPosition: encodeInitialPositionCompact(this.openingBoard, this.boardSize),
                plainWeiqiStartHand: this.plainWeiqiStartHand,
                moves: (this.gameOver ? this.moveCoords : this.filterMoveCoordsForSlot(slot)).map(m => ({ ...m }))
            },
            komi: 4.25,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
            },
            matchStarted: this.matchStarted
        };
    }

    /** 基类 sendState 依赖 getState()；本玩法按连接返回不同棋盘，故覆盖为 getStateForClient。 */
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

    broadcastFlat(payload, exclude = null) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client !== exclude && client.readyState === 1)
                client.send(JSON.stringify(payload));
        }
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        this.revealAllInvisible();
        this.plainWeiqiStartHand = this.moveHistory.length + 1;
        if (this.historyInvisible.length > 0)
            this.historyInvisible[this.historyInvisible.length - 1] = this.copyInvisible(this.invisible);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        this.broadcastState('scoreCountingStarted');
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    this.afterColorAssigned(newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws, msg);
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move': {
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const row = msg.row, col = msg.col;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const enemyVal = 3 - playerVal;

                if (this.board[row][col] !== 0) {
                    if (this.board[row][col] === enemyVal && this.invisible[row][col]) {
                        this.invisible[row][col] = false;
                        const enemySlot = enemyVal === 1 ? 'black' : 'white';
                        this.revealMoveAt(row, col, enemySlot);
                        this.historyBoards.push(this.copyBoard(this.board));
                        this.historyInvisible.push(this.copyInvisible(this.invisible));
                        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                        this.moveHistory.push(slot);
                        this.moveCoords.push({
                            type: 'pass',
                            player: slot,
                            reason: 'hitInvisible',
                            revealRow: row,
                            revealCol: col
                        });
                        this.lastMoveMarkers = [];
                        this.currentPlayer = 3 - this.currentPlayer;
                        this.passCounter = 0;
                        this._syncClockAfterTurnChange();
                        this.broadcastState('invisibleReveal', { reason: 'hitPass', row, col });
                    }
                    return;
                }

                const oldBoard = this.copyBoard(this.board);
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                const nextHand = this.moveHistory.length + 1;
                const isInvisibleStone =
                    (this.plainWeiqiStartHand == null || nextHand < this.plainWeiqiStartHand) &&
                    nextHand >= 3 &&
                    nextHand % 3 === 0;

                this.board = this.copyBoard(newBoard);
                const removed = this.removedStonesForCapture(oldBoard, this.board, row, col, playerVal);
                for (const { row: rr, col: cc } of removed)
                    this.invisible[rr][cc] = false;

                for (const { row: rr, col: cc, color } of removed) {
                    const ps = color === 1 ? 'black' : 'white';
                    this.revealMoveAt(rr, cc, ps);
                }

                // 须先于 revealParticipatingInvisibleForCapture 标记本手隐身子，否则邻格显形遍历时该点仍为 false，参与提子的新落隐身子不会被显形。
                if (isInvisibleStone && this.board[row][col] === playerVal) {
                    this.invisible[row][col] = true;
                }

                this.revealParticipatingInvisibleForCapture(removed);

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    invisible: !!this.invisible[row][col],
                    concealedFromOpponent: !!(this.invisible[row][col])
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcastState('move');
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass':
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcastState('pass');
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcastState('endAgreed');
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
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.onResignResolved(slot);
                this.broadcastState('resign', { player: slot, winner: this.winner });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) this.resetGame();
                else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) this.resetGame();
                else if (this.pendingNewGame && !msg.accept)
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this.broadcastState('drawAgreed');
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this.broadcastState('drawAgreed');
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!endOpponent) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept)
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept)
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
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
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord(ws) }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcastPerClientReset();
                break;

            default:
                break;
        }
    }

    broadcastPerClientReset() {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({ type: 'roomReset', ...this.getStateForClient(client) }));
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyInvisible.length > 0)
                this.historyInvisible.pop();
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) {
            this.board = this.emptyBoard();
            this.invisible = this.emptyInvisible();
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.invisible = this.copyInvisible(this.historyInvisible.at(-1));
        }
        if (this.moveHistory.length === 0)
            this.plainWeiqiStartHand = null;
        else if (this.plainWeiqiStartHand != null && this.moveHistory.length < this.plainWeiqiStartHand - 1)
            this.plainWeiqiStartHand = null;
        this.broadcastState('undoAccept');
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = this.emptyBoard();
        this.openingBoard = this.copyBoard(this.board);
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.plainWeiqiStartHand = null;
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        for (let [client, s] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(s);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({ type: 'newGameStarted', ...this.getStateForClient(client), slots: { black: false, white: false } }));
        }
        this.broadcastFlat({ type: 'timeControlReset', reason: 'resetRoom' });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    serializeMoveForExport(m) {
        const p = m.player === 'black' ? 'B' : 'W';
        if (m.type === 'pass') {
            if (m.reason === 'hitInvisible') {
                if (typeof m.revealRow === 'number' && typeof m.revealCol === 'number')
                    return `${p}ph${m.revealRow},${m.revealCol}`;
                return `${p}ph`;
            }
            return p + 'p';
        }
        if (m.type === 'move' && m.concealed)
            return p + 'i';
        const inv = m.invisible ? 'i' : '';
        return p + m.row + ',' + m.col + inv;
    }

    /** 对局未结束时按座位过滤手顺，避免向对方/观战者导出隐身子坐标 */
    exportRecord(ws) {
        const slot = this.room.getSlotByWs(ws);
        const movesSrc = this.gameOver ? this.moveCoords : this.filterMoveCoordsForSlot(slot);
        return {
            format: 'muzei',
            version: 1,
            gameType: '隐身子围棋',
            gameId: 'invisible-stone-weiqi',
            boardSize: this.boardSize,
            komi: 4.25,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(this.openingBoard, this.boardSize),
            plainWeiqiStartHand: this.plainWeiqiStartHand,
            moves: movesSrc.map(m => this.serializeMoveForExport(m)),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: this.gameOver ? (this.recordResultText || this.winner || null) : null
        };
    }

    resetToEmpty() {
        this.board = this.emptyBoard();
        this.openingBoard = this.copyBoard(this.board);
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
        this.historyBoardSet.clear();
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
        this.plainWeiqiStartHand = null;
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') {
                if (entry[2] === 'h') {
                    const rest = entry.substring(3);
                    if (!rest)
                        return { type: 'pass', player, reason: 'hitInvisible' };
                    const coords = rest.split(',').map(Number);
                    if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1]))
                        return { type: 'pass', player, reason: 'hitInvisible' };
                    return {
                        type: 'pass',
                        player,
                        reason: 'hitInvisible',
                        revealRow: coords[0],
                        revealCol: coords[1]
                    };
                }
                return { type: 'pass', player };
            }
            /** Bi/Wi/Bx/Wx：棋谱占位，导入时视为虚着 */
            if (entry.length === 2 && (entry[1] === 'i' || entry[1] === 'x'))
                return { type: 'pass', player };
            let s = entry;
            let invisible = false;
            if (s.endsWith('i')) {
                invisible = true;
                s = s.slice(0, -1);
            }
            const coords = s.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1], invisible };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== 'invisible-stone-weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要隐身子围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();
        this.plainWeiqiStartHand = data.plainWeiqiStartHand != null ? data.plainWeiqiStartHand : null;

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.openingBoard = this.copyBoard(this.board);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(InvisibleStoneWeiqiRoom.parseMove);
        const fromWeiqi = data.gameId === 'weiqi';
        const pwsh = data.plainWeiqiStartHand != null ? data.plainWeiqiStartHand : null;
        let importHand = 0;
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                importHand++;
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcastPerClientReset();
                    return;
                }
                const oldBoard = this.copyBoard(this.board);
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcastPerClientReset();
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.board = this.copyBoard(newBoard);
                const removed = this.removedStonesForCapture(oldBoard, this.board, row, col, playerVal);
                for (const { row: rr, col: cc } of removed)
                    this.invisible[rr][cc] = false;
                for (const { row: rr, col: cc, color } of removed) {
                    const ps = color === 1 ? 'black' : 'white';
                    this.revealMoveAt(rr, cc, ps);
                }
                const wantInv =
                    (pwsh == null || importHand < pwsh) &&
                    (fromWeiqi ? importHand >= 3 && importHand % 3 === 0 : !!move.invisible);
                if (wantInv && this.board[row][col] === playerVal)
                    this.invisible[row][col] = true;
                this.revealParticipatingInvisibleForCapture(removed);

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                const concealed = !!(this.invisible[row][col]);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    invisible: concealed,
                    concealedFromOpponent: concealed
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                importHand++;
                if (move.reason === 'hitInvisible') {
                    if (typeof move.revealRow !== 'number' || typeof move.revealCol !== 'number') {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱缺少试入隐子坐标，无法完整导入' }));
                        this.broadcastPerClientReset();
                        return;
                    }
                    this.invisible[move.revealRow][move.revealCol] = false;
                    const v = this.board[move.revealRow][move.revealCol];
                    const ps = v === 1 ? 'black' : 'white';
                    this.revealMoveAt(move.revealRow, move.revealCol, ps);
                }
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push(
                    move.reason === 'hitInvisible'
                        ? {
                            type: 'pass',
                            player: slot,
                            reason: 'hitInvisible',
                            revealRow: move.revealRow,
                            revealCol: move.revealCol
                        }
                        : { type: 'pass', player: slot }
                );
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = move.reason === 'hitInvisible' ? 0 : this.passCounter + 1;
                this.lastMoveMarkers = [];
            }
        }

        if (data.timeControl === null) {
            this.tcSettings = { timed: false };
            this.matchStarted = true;
        } else if (typeof data.timeControl === 'string') {
            const m = /^S(\d+),(\d+),(\d+)$/.exec(data.timeControl.trim());
            if (m) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(m[1], 10) || 0,
                    byoyomiSeconds: parseInt(m[2], 10) || 0,
                    maxTimeouts: parseInt(m[3], 10) || 0
                };
                this.matchStarted = true;
            }
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = InvisibleStoneWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            client.send(JSON.stringify({
                type: 'importSuccess',
                ...this.getStateForClient(client),
                replayData: {
                    initialPosition: data.initialPosition || [],
                    plainWeiqiStartHand: this.plainWeiqiStartHand,
                    moves: this.moveCoords.map(m => ({ ...m }))
                }
            }));
        }
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
            this.broadcastFlat({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new InvisibleStoneWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
