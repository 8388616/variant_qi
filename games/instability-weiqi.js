/**
 * 不稳定围棋：空位落子为不稳定子（记录出生手数）；可落在己方不稳定子上将其变为稳定子。
 * 提子与标准围棋相同；每手结束后，出生手数 = 当前手数 − 不稳定寿命 的不稳定子被移除。
 * 寿命 = (0.1×路数×路数) 向上取为不小于该值的最小奇数。棋盘 7～21 路。
 */

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact, qiBoardSeatOverlay } = require('../common');
class InstabilityWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        /** 每手成功后的完整局面快照，用于悔棋 */
        this.historySnapshots = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
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

    unstableLifetime() {
        const x = 0.1 * this.boardSize * this.boardSize;
        let c = Math.ceil(x);
        if (c % 2 === 0) c += 1;
        return c;
    }

    stateToString(board, unstableInfo) {
        const rows = [];
        for (let r = 0; r < this.boardSize; r++) {
            const row = [];
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] === 0) {
                    row.push('0');
                } else {
                    const colorChar = board[r][c] === 1 ? 'B' : 'W';
                    if (unstableInfo[r][c] === 0)
                        row.push(colorChar + 'S');
                    else
                        row.push(colorChar + 'U' + unstableInfo[r][c]);
                }
            }
            rows.push(row.join(','));
        }
        return rows.join(';');
    }

    rebuildBornAt(unstableInfo) {
        const bornAt = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const b = unstableInfo[r][c];
                if (b !== 0)
                    bornAt[b] = [r, c];
            }
        }
        return bornAt;
    }

    hasLiberty(board, row, col) {
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, unstableInfo, bornAt, row, col, color) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const ub = unstableInfo[row][col];
        unstableInfo[row][col] = 0;
        if (ub !== 0)
            bornAt[ub] = null;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    const u2 = unstableInfo[nr][nc];
                    unstableInfo[nr][nc] = 0;
                    if (u2 !== 0)
                        bornAt[u2] = null;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    /**
     * 从当前局面应用一手；成功返回 { board, unstableInfo, moveCount }，失败返回 null。
     */
    applyPly(board, unstableInfo, moveCount, row, col, playerVal) {
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return null;

        const b = this.copyBoard(board);
        const u = this.copyBoard(unstableInfo);
        const bornAt = this.rebuildBornAt(u);

        if (b[row][col] !== 0) {
            if (u[row][col] === 0 || b[row][col] !== playerVal) return null;
            const born = u[row][col];
            if (bornAt[born] && bornAt[born][0] === row && bornAt[born][1] === col)
                bornAt[born] = null;
            b[row][col] = 0;
            u[row][col] = 0;
        }

        const newMoveCount = moveCount + 1;
        const wasReplaceOwnUnstable = board[row][col] !== 0;

        b[row][col] = playerVal;
        if (!wasReplaceOwnUnstable) {
            u[row][col] = newMoveCount;
            bornAt[newMoveCount] = [row, col];
        } else {
            u[row][col] = 0;
        }

        const enemy = 3 - playerVal;
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (b[i][j] === enemy && !this.hasLiberty(b, i, j))
                    this.removeGroup(b, u, bornAt, i, j, enemy);
            }
        }
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (b[i][j] === playerVal && !this.hasLiberty(b, i, j))
                    this.removeGroup(b, u, bornAt, i, j, playerVal);
            }
        }

        const life = this.unstableLifetime();
        const toDieBorn = newMoveCount - life;
        if (toDieBorn >= 0 && bornAt[toDieBorn]) {
            const [r, c] = bornAt[toDieBorn];
            if (r !== undefined && c !== undefined && b[r][c] !== 0 && u[r][c] === toDieBorn) {
                b[r][c] = 0;
                u[r][c] = 0;
                bornAt[toDieBorn] = null;
            }
        }

        return { board: b, unstableInfo: u, moveCount: newMoveCount };
    }

    applyPass(board, unstableInfo, moveCount) {
        const b = this.copyBoard(board);
        const u = this.copyBoard(unstableInfo);
        const bornAt = this.rebuildBornAt(u);
        const newMoveCount = moveCount + 1;
        const life = this.unstableLifetime();
        const toDieBorn = newMoveCount - life;
        if (toDieBorn >= 0 && bornAt[toDieBorn]) {
            const [r, c] = bornAt[toDieBorn];
            if (r !== undefined && c !== undefined && b[r][c] !== 0 && u[r][c] === toDieBorn) {
                b[r][c] = 0;
                u[r][c] = 0;
            }
        }
        return { board: b, unstableInfo: u, moveCount: newMoveCount };
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

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            unstableInfo: this.unstableInfo,
            moveCount: this.moveCount,
            unstableLifetime: this.unstableLifetime(),
            numberOfHands: this.moveCount + 1,
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
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted
        };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
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
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const result = this.applyPly(this.board, this.unstableInfo, this.moveCount, row, col, playerVal);
                if (!result) {
                    return;
                }
                const newStr = this.stateToString(result.board, result.unstableInfo);
                if (this.historyBoardSet.has(newStr)) 
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                } 
                this.historyBoardSet.add(newStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = result.board;
                this.unstableInfo = result.unstableInfo;
                this.moveCount = result.moveCount;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
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
                const passResult = this.applyPass(this.board, this.unstableInfo, this.moveCount);
                const passStr = this.stateToString(passResult.board, passResult.unstableInfo);
                if (this.historyBoardSet.has(passStr)) {
                    return;
                }
                this.historyBoardSet.add(passStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = passResult.board;
                this.unstableInfo = passResult.unstableInfo;
                this.moveCount = passResult.moveCount;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    this.passCounter = 0;
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
                if (!slot || this.gameOver)
                    return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
                }
                if (steps === 0 || steps > this.historySnapshots.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
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
        if (steps === 0 || steps > this.historySnapshots.length)
            return;

        for (let i = 0; i < steps; i++) {
            const popped = this.historySnapshots.pop();
            if (popped)
                this.historyBoardSet.delete(this.stateToString(popped.board, popped.unstableInfo));
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();
            if (this.historyMarkers.length > 0)
                this.historyMarkers.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historySnapshots.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.moveCount = 0;
            this.lastMoveMarkers = [];
        } else {
            const s = this.historySnapshots[this.historySnapshots.length - 1];
            this.board = this.copyBoard(s.board);
            this.unstableInfo = this.copyBoard(s.unstableInfo);
            this.moveCount = s.moveCount;
            if (this.moveCoords.length > 0) {
                const last = this.moveCoords[this.moveCoords.length - 1];
                if (last.type === 'move')
                    this.lastMoveMarkers = [{ row: last.row, col: last.col, color: last.player === 'black' ? 1 : 2 }];
                else
                    this.lastMoveMarkers = [];
            } else
                this.lastMoveMarkers = [];
        }

        this.passCounter = 0;
        for (const m of this.moveCoords) {
            if (m.type === 'pass')
                this.passCounter++;
            else
                this.passCounter = 0;
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
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
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        this.historySnapshots = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.moveCoords = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
        const toRelease = [...this.room.players.entries()];
        for (const [client, s] of toRelease) {
            this.room.players.delete(client);
            this.room.slotOccupancy.delete(s);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer)
            return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        const emptyBoard = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        return {
            format: 'muzei',
            version: 1,
            gameType: '不稳定围棋',
            gameId: 'instability-weiqi',
            boardSize: this.boardSize,
            unstableLifetime: this.unstableLifetime(),
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(emptyBoard, this.boardSize),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        this.historySnapshots = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
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
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
    }

    /** 棋谱 initialPosition：优先紧凑字符串数组 ["B3,3","W4,4"]；兼容旧版 { black:[], white:[] }。初始棋子均为稳定子（unstableInfo 为 0）。 */
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
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
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
        if (!data || data.gameId !== 'instability-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要不稳定围棋棋谱）。' }));
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
        const moves = rawMoves.map(InstabilityWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const r = this.applyPly(this.board, this.unstableInfo, this.moveCount, row, col, playerVal);
                if (!r) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newStr = this.stateToString(r.board, r.unstableInfo);
                if (this.historyBoardSet.has(newStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手违反禁全同。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoardSet.add(newStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = r.board;
                this.unstableInfo = r.unstableInfo;
                this.moveCount = r.moveCount;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
            } else if (move.type === 'pass') {
                const pr = this.applyPass(this.board, this.unstableInfo, this.moveCount);
                const passStr = this.stateToString(pr.board, pr.unstableInfo);
                if (this.historyBoardSet.has(passStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手虚着违反禁全同。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoardSet.add(passStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = pr.board;
                this.unstableInfo = pr.unstableInfo;
                this.moveCount = pr.moveCount;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
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
            this.winner = InstabilityWeiqiRoom.parseResultTextToWinner(importedResultText);
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

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    getMoveCount() {
        return this.moveCoords.length;
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
        room.gameLogic = new InstabilityWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
