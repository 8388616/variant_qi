const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');
/** 三种磁性围棋（弱/中/强）合并为一种棋类：磁性围棋 magnetism-weiqi。
 * 子棋类 id（subGameId）沿用旧棋类 id：weak/medium/strong-magnetism-weiqi。
 * 客户端「显示序号」按 moveCoords 与对应磁性规则重放，使序号随子移动。 */
function komiForSize(boardSize) {
    switch (boardSize) {
        case 3: return 1.5;
        case 4: return 3.5;
        case 5: return 4.5;
        case 6: return 2.0;
        case 7: return 3.5;
        case 8: return 2.0;
        case 9: return 3.5;
        case 10: return 2.25;
        case 11: return 2.75;
        case 12: return 2.25;
        default:
            if (boardSize % 2 === 0) return 1.75;
            return 2.25;
    }
}

class MagnetismWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 9, magnetism = 'weak') {
        super(room);
        this.magnetism = magnetism;          // 'weak' | 'medium' | 'strong'
        this.subGameId = (MagnetismWeiqiRoom.SUB_GAME_ID && MagnetismWeiqiRoom.SUB_GAME_ID[magnetism]) || 'weak-magnetism-weiqi';   // 子棋类 id（引擎检查兜底）
        this.boardSize = initialSize;
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
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
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
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
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
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
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
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
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
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker();
        this.gameOver = true;
        this.winner = winnerSlot;
        this.setTimeLossResultText(lostSlot);
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
        this._broadcastClock();
    }

    hasLiberty(board, row, col) {
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    /** 子棋类 id：棋谱中统一用 gameId=magnetism-weiqi，用 subGameId 区分三种磁性 */
    static SUB_GAME_ID = {
        weak: 'weak-magnetism-weiqi',
        medium: 'medium-magnetism-weiqi',
        strong: 'strong-magnetism-weiqi'
    };

    /** 贴目（服务端数子口径）：弱磁性按尺寸查表；中/强磁性 ≤8 路 4.25，其余 3.25 */
    _komi() {
        if (this.magnetism === 'weak') return komiForSize(this.boardSize);
        return this.boardSize <= 8 ? 4.25 : 3.25;
    }

    /**
     * 落子后应用磁性：沿四方向扫描射线，己方棋子从最远端先滑动，对方棋子从最近端先滑动。
     * 弱磁性：每方向只看最近的棋子，滑动一格（己方远离落子点，对方靠近落子点）。
     * 中磁性：每方向收集全部棋子，己方从远到近、对方从近到远，各滑动一格（一轮）。
     * 强磁性：与中磁性同序，但每「轮」每人最多一格；重复多轮直到一整轮内没有任何棋子能移动。
     */
    applyMagneticMove(board, row, col, playerVal) {
        if (this.magnetism === 'weak') return this.applyMagneticMoveWeak(board, row, col, playerVal);
        if (this.magnetism === 'strong') {
            let guard = 0;
            const maxRounds = this.boardSize * this.boardSize * this.boardSize * 8 + 1000;
            while (this.applyOneMagneticRound(board, row, col, playerVal)) {
                if (++guard > maxRounds) break;
            }
            return board;
        }
        this.applyOneMagneticRound(board, row, col, playerVal);
        return board;
    }

    /** 弱磁性：每方向找最近目标，滑动一格 */
    applyMagneticMoveWeak(board, row, col, playerVal) {
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [dr, dc] of dirs) {
            let step = 1;
            let targetR = -1, targetC = -1;
            while (true) {
                const nr = row + dr * step, nc = col + dc * step;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) break;
                if (board[nr][nc] !== 0) {
                    targetR = nr; targetC = nc;
                    break;
                }
                step++;
            }
            if (targetR === -1) continue;
            const targetColor = board[targetR][targetC];
            const moveDr = (targetColor === playerVal) ? dr : -dr;
            const moveDc = (targetColor === playerVal) ? dc : -dc;
            const newR = targetR + moveDr, newC = targetC + moveDc;
            if (newR >= 0 && newR < this.boardSize && newC >= 0 && newC < this.boardSize && board[newR][newC] === 0) {
                board[newR][newC] = targetColor;
                board[targetR][targetC] = 0;
            }
        }
        return board;
    }

    /** 中/强磁性单轮：己方从远到近、对方从近到远，若有任意子移动返回 true */
    applyOneMagneticRound(board, row, col, playerVal) {
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const ownList = [];
        const oppList = [];
        for (let dirIdx = 0; dirIdx < dirs.length; dirIdx++) {
            const [dr, dc] = dirs[dirIdx];
            for (let step = 1; ; step++) {
                const nr = row + dr * step, nc = col + dc * step;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) break;
                if (board[nr][nc] === 0) continue;
                const color = board[nr][nc];
                const entry = { r: nr, c: nc, step, dirIdx, dr, dc, color };
                if (color === playerVal) ownList.push(entry);
                else oppList.push(entry);
            }
        }
        ownList.sort((a, b) => b.step - a.step || a.dirIdx - b.dirIdx);
        oppList.sort((a, b) => a.step - b.step || a.dirIdx - b.dirIdx);
        let movedAny = false;
        const tryShift = (r, c, dr, dc, color) => {
            const moveDr = (color === playerVal) ? dr : -dr;
            const moveDc = (color === playerVal) ? dc : -dc;
            const newR = r + moveDr, newC = c + moveDc;
            if (newR >= 0 && newR < this.boardSize && newC >= 0 && newC < this.boardSize && board[newR][newC] === 0) {
                board[newR][newC] = color;
                board[r][c] = 0;
                movedAny = true;
            }
        };
        for (const item of ownList) {
            const { r, c, dr, dc } = item;
            if (board[r][c] === 0) continue;
            const color = board[r][c];
            if (color !== playerVal) continue;
            tryShift(r, c, dr, dc, color);
        }
        for (const item of oppList) {
            const { r, c, dr, dc } = item;
            if (board[r][c] === 0) continue;
            const color = board[r][c];
            if (color === playerVal) continue;
            tryShift(r, c, dr, dc, color);
        }
        return movedAny;
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (boardBefore[row][col] !== 0) return null;
        let newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        newBoard = this.applyMagneticMove(newBoard, row, col, playerVal);
        let changed;
        do {
            changed = false;
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    const val = newBoard[i][j];
                    if (val !== 0 && !this.hasLiberty(newBoard, i, j)) {
                        this.removeGroup(newBoard, i, j, val);
                        changed = true;
                    }
                }
            }
        } while (changed);
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
        const KOMI = this._komi();
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

    getState()
    {
        return {
            magnetism: this.magnetism,
            subGameId: (MagnetismWeiqiRoom.SUB_GAME_ID && MagnetismWeiqiRoom.SUB_GAME_ID[this.magnetism]) || 'weak-magnetism-weiqi',
            boardSize: this.boardSize,
            komi: this._komi(),
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
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
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
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (w, s) => this.afterColorAssigned(w, s) });
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

            case 'setMagnetism':
                this.setMagnetism(msg.magnetism, ws);
                break;

            case 'move':
                if (!this._timeAllowsPlay(slot)) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局尚未开始（请先完成限时协商）' }));
                    return;
                }
                qiProtocol.weiqiMove(this, ws, msg, slot, { beforeCommit: () => this._drainClockBeforeMove(slot) });
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (!this._timeAllowsPlay(slot)) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局尚未开始（请先完成限时协商）' }));
                    return;
                }
                qiProtocol.weiqiPass(this, ws, slot, { beforeCommit: () => this._drainClockBeforeMove(slot) });
                this._syncClockAfterTurnChange();
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot, { onResignResolved: (resignSlot) => this.onResignResolved(resignSlot) });
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
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
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
        this.passCounter = 0;
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.room.broadcast({ type: 'timeControlReset', reason: 'resetRoom' });
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setMagnetism(magnetism, requesterWs) {
        if (magnetism !== 'weak' && magnetism !== 'medium' && magnetism !== 'strong') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '子棋类无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            // 与 setBoardSize 一致：开局后静默忽略（客户端此时已隐藏选择器）
            return false;
        }
        this.magnetism = magnetism;
        this.broadcast({ type: 'magnetismChanged', ...this.getState() });
        return true;
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
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
        return {
            format: 'muzei',
            version: 2,
            gameType: '磁性围棋',
            gameId: 'magnetism-weiqi',
            subGameId: MagnetismWeiqiRoom.SUB_GAME_ID[this.magnetism] || 'weak-magnetism-weiqi',
            magnetism: this.magnetism,
            boardSize: this.boardSize,
            komi: this._komi(),
            players: { black: null, white: null },
            // 开局盘面（编辑模式的开局；默认空盘）——导出当前盘面会让导入时与 moves 重放冲突
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: this.tcSettings === null
                ? null
                : (this.tcSettings.timed
                    ? {
                        enabled: true,
                        mainMinutes: this.tcSettings.mainMinutes,
                        byoyomiSeconds: this.tcSettings.byoyomiSeconds,
                        maxTimeouts: this.tcSettings.maxTimeouts
                    }
                    : { enabled: false }),
            result: this.gameOver ? (this.recordResultText || this.winner || null) : null
        };
    }

    resetToEmpty() {
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
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        // 棋谱统一用 gameId=magnetism-weiqi，用 subGameId 区分三种磁性；兼容旧版三个棋类 id
        const oldId = data && data.gameId;
        const subGameId = data.subGameId || oldId;
        const magnetism = data.magnetism
            || (subGameId === 'medium-magnetism-weiqi' ? 'medium' : subGameId === 'strong-magnetism-weiqi' ? 'strong' : 'weak');
        if (!data || (oldId !== 'magnetism-weiqi' && oldId !== 'weak-magnetism-weiqi' && oldId !== 'medium-magnetism-weiqi' && oldId !== 'strong-magnetism-weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要磁性围棋棋谱）。' }));
            return;
        }
        this.magnetism = magnetism;
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(MagnetismWeiqiRoom.parseMove);
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
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
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
            this.winner = MagnetismWeiqiRoom.parseResultTextToWinner(importedResultText);
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
        room.gameLogic = new MagnetismWeiqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
