const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay } = require('../common');

function applyInitialPositionFromRecord(board, boardSize, initialPosition) {
    if (!initialPosition) return;
    if (Array.isArray(initialPosition)) {
        applyInitialPositionCompact(board, boardSize, initialPosition);
        return;
    }
}

function normalizeInitialPositionForReplayPayload(initialPosition) {
    if (!initialPosition) return [];
    if (Array.isArray(initialPosition)) return initialPosition;
    if (typeof initialPosition !== 'object') return [];
    const out = [];
    for (const pos of initialPosition.black || []) {
        if (Array.isArray(pos) && pos.length === 2) out.push(`B${pos[0]},${pos[1]}`);
    }
    for (const pos of initialPosition.white || []) {
        if (Array.isArray(pos) && pos.length === 2) out.push(`W${pos[0]},${pos[1]}`);
    }
    return out;
}

class TriweightWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 19;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.weights = this.generateWeights();
        this.currentPlayer = 1;         // 1黑 2白
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];           // 存储每一步的玩家slot
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

    /** 每点独立随机：1、2、3，概率 4:2:1 */
    generateWeights() {
        const weights = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        const pool = [1, 1, 1, 1, 2, 2, 3];
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const randomIndex = Math.floor(Math.random() * pool.length);
                weights[i][j] = pool[randomIndex];
            }
        }
        return weights;
    }

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    getGroupWeight(board, row, col, color) {
        let total = 0;
        const queue = [[row, col]];
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            total += this.weights[r][c];
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return total;
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
        let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones += this.weights[r][c];
                else if (liveBoard[r][c] === 2) whiteStones += this.weights[r][c];
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory += this.weights[r][c];
                    else if (territory[r][c] === 2) whiteTerritory += this.weights[r][c];
                    else if (territory[r][c] === 3) publicTerritory += this.weights[r][c];
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 6.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            weights: this.weights,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
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
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const before = () => this._drainClockBeforeMove(moveSlot);
                qiProtocol.weiqiMove(this, ws, msg, moveSlot, { beforeCommit: before });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const beforeP = () => this._drainClockBeforeMove(passSlot);
                qiProtocol.weiqiPass(this, ws, passSlot, { beforeCommit: beforeP });
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
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'estimate':
                // 前端请求形势判断结果
                const liveBoard = this.removeDeadAndDying(this.board);
                const territory = this.assignTerritoryWithRange(liveBoard);
                const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
                const lead = blackTotal - whiteTotal - 2 * 6.25;
                ws.send(JSON.stringify({
                    type: 'estimateResult',
                    liveBoard,
                    territory,
                    blackTotal,
                    whiteTotal,
                    lead
                }));
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
            this.board = this.copyBoard(this.historyBoards[this.historyBoards.length - 1]);
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
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
            gameType: '三权重围棋',
            gameId: 'triweight-weiqi',
            boardSize: this.boardSize,
            komi: 6.25,
            weights: this.weights.map(row => row.slice()),
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(this.board, this.boardSize),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
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
        this.weights = this.generateWeights();
        this.currentPlayer = 1;
        this.historyBoards = [];
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
        if (!data || data.gameId !== 'triweight-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要三权重围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        if (!data.weights || !Array.isArray(data.weights) || data.weights.length !== newSize) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱需包含与路数一致的棋盘权重 weights。' }));
            return;
        }
        let weightsOk = true;
        for (let r = 0; r < newSize; r++) {
            if (!Array.isArray(data.weights[r]) || data.weights[r].length !== newSize) {
                weightsOk = false;
                break;
            }
            if (!weightsOk) break;
        }
        if (!weightsOk) {
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();
        this.weights = data.weights.map(row => row.slice());

        applyInitialPositionFromRecord(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(TriweightWeiqiRoom.parseMove);
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
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
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
            this.winner = TriweightWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: normalizeInitialPositionForReplayPayload(data.initialPosition),
                moves: this.moveCoords.map(m => ({ ...m })),
                weights: this.weights.map(row => row.slice())
            }
        });
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
        this.weights = this.generateWeights();  // 重新生成权重
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        // 清除所有玩家槽位
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
        room.gameLogic = new TriweightWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
