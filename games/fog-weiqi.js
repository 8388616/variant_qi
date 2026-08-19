const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, qiBoardSeatOverlay } = require('../common');

class FogWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = this.emptyBoard();
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
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
        this.room.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
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
        this.room.broadcast({
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
            this.broadcastState('timeLoss', { player: lostSlot, winner: winnerSlot });
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

    onResignResolved(resignSlot, _winner) {
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

    emptyBoard() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        const KOMI = this.boardSize <= 8 ? 4.25 : 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    /** 己方棋子提供周围 3×3 视野（含自身格） */
    computeVisionFromColor(board, colorVal) {
        const vis = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== colorVal) continue;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize)
                            vis[nr][nc] = true;
                    }
                }
            }
        }
        return vis;
    }

    /**
     * 客户端棋盘：0 空，1 黑，2 白。无视野处的对方子不发送（当作空点）。
     */
    buildMaskedBoard(slot) {
        const out = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (slot === 'black') {
            const vis = this.computeVisionFromColor(this.board, 1);
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = this.board[r][c];
                    if (v === 0) continue;
                    if (v === 1) out[r][c] = 1;
                    else if (v === 2 && vis[r][c]) out[r][c] = 2;
                }
            }
            return out;
        }
        if (slot === 'white') {
            const vis = this.computeVisionFromColor(this.board, 2);
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = this.board[r][c];
                    if (v === 0) continue;
                    if (v === 2) out[r][c] = 2;
                    else if (v === 1 && vis[r][c]) out[r][c] = 1;
                }
            }
            return out;
        }
        const bVis = this.computeVisionFromColor(this.board, 1);
        const wVis = this.computeVisionFromColor(this.board, 2);
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const v = this.board[r][c];
                if (v === 0) continue;
                if (bVis[r][c] && wVis[r][c]) out[r][c] = v;
            }
        }
        return out;
    }

    buildMaskedBoardFromFull(fullBoard, slot) {
        const out = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (slot === 'black') {
            const vis = this.computeVisionFromColor(fullBoard, 1);
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = fullBoard[r][c];
                    if (v === 0) continue;
                    if (v === 1) out[r][c] = 1;
                    else if (v === 2 && vis[r][c]) out[r][c] = 2;
                }
            }
            return out;
        }
        if (slot === 'white') {
            const vis = this.computeVisionFromColor(fullBoard, 2);
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = fullBoard[r][c];
                    if (v === 0) continue;
                    if (v === 2) out[r][c] = 2;
                    else if (v === 1 && vis[r][c]) out[r][c] = 1;
                }
            }
            return out;
        }
        const bVis = this.computeVisionFromColor(fullBoard, 1);
        const wVis = this.computeVisionFromColor(fullBoard, 2);
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const v = fullBoard[r][c];
                if (v === 0) continue;
                if (bVis[r][c] && wVis[r][c]) out[r][c] = v;
            }
        }
        return out;
    }

    /** 完整对局每一手之后、当前视角可见的棋盘（用于前端回放，不泄露迷雾中的对方子） */
    getMaskedBoardHistoryForSlot(slot) {
        const boards = [];
        boards.push(this.buildMaskedBoardFromFull(this.emptyBoard(), slot));
        for (let i = 0; i < this.historyBoards.length; i++)
            boards.push(this.buildMaskedBoardFromFull(this.historyBoards[i], slot));
        return boards;
    }

    getReplayStepPlayers() {
        const out = [0];
        for (const m of this.moveCoords)
            out.push(m.player === 'black' ? 1 : 2);
        return out;
    }

    copyNumGrid(g) {
        return g.map(row => row.slice());
    }

    /**
     * 全局手数（第 1 手起）。每格为该子落下时的全局序号；提子后该格清空。
     */
    getFullStoneMoveNumbersHistory() {
        const n = this.boardSize;
        const history = [];
        const handGrid = Array(n).fill().map(() => Array(n).fill(0));
        let simBoard = this.emptyBoard();
        history.push(this.copyNumGrid(handGrid));
        for (let i = 0; i < this.moveCoords.length; i++) {
            const m = this.moveCoords[i];
            const hand = i + 1;
            if (m.type === 'pass') {
                history.push(this.copyNumGrid(handGrid));
                continue;
            }
            const playerVal = m.player === 'black' ? 1 : 2;
            const nb = this.tryPlaceStone(simBoard, m.row, m.col, playerVal);
            if (!nb) {
                history.push(this.copyNumGrid(handGrid));
                continue;
            }
            simBoard = this.removeDeadAndDying(nb);
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (simBoard[r][c] === 0) handGrid[r][c] = 0;
                }
            }
            if (simBoard[m.row][m.col] === playerVal) handGrid[m.row][m.col] = hand;
            history.push(this.copyNumGrid(handGrid));
        }
        return history;
    }

    /**
     * 仅己方棋子有非零序号（全局手数）；对方子即使可见也为 0（前端不显示对方手数）。
     */
    getOwnStoneMoveNumbersHistoryForSlot(slot) {
        const n = this.boardSize;
        if (!slot) return null;
        const myVal = slot === 'black' ? 1 : 2;
        const history = [];
        const handGrid = Array(n).fill().map(() => Array(n).fill(0));
        let simBoard = this.emptyBoard();
        history.push(this.copyNumGrid(handGrid));
        for (let i = 0; i < this.moveCoords.length; i++) {
            const m = this.moveCoords[i];
            const hand = i + 1;
            if (m.type === 'pass') {
                history.push(this.copyNumGrid(handGrid));
                continue;
            }
            const playerVal = m.player === 'black' ? 1 : 2;
            const nb = this.tryPlaceStone(simBoard, m.row, m.col, playerVal);
            if (!nb) {
                history.push(this.copyNumGrid(handGrid));
                continue;
            }
            simBoard = this.removeDeadAndDying(nb);
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (simBoard[r][c] === 0) handGrid[r][c] = 0;
                }
            }
            if (simBoard[m.row][m.col] === playerVal) {
                if (playerVal === myVal) handGrid[m.row][m.col] = hand;
                else handGrid[m.row][m.col] = 0;
            }
            history.push(this.copyNumGrid(handGrid));
        }
        return history;
    }

    filterMoveCoordsForPlayerSlot(slot) {
        const myVal = slot === 'black' ? 1 : 2;
        let simBoard = this.emptyBoard();
        const out = [];
        for (const m of this.moveCoords) {
            if (m.type === 'pass') {
                out.push({ type: 'pass', player: m.player });
                continue;
            }
            const playerVal = m.player === 'black' ? 1 : 2;
            const vis = this.computeVisionFromColor(simBoard, myVal);
            if (m.player === slot) {
                out.push({ type: 'move', player: m.player, row: m.row, col: m.col });
            } else if (vis[m.row][m.col]) {
                out.push({ type: 'move', player: m.player, row: m.row, col: m.col });
            }
            const nb = this.tryPlaceStone(simBoard, m.row, m.col, playerVal);
            if (nb) simBoard = this.removeDeadAndDying(nb);
        }
        return out;
    }

    filterMoveCoordsForObserver() {
        let simBoard = this.emptyBoard();
        const out = [];
        for (const m of this.moveCoords) {
            if (m.type === 'pass') {
                out.push({ type: 'pass', player: m.player });
                continue;
            }
            const playerVal = m.player === 'black' ? 1 : 2;
            const bVis = this.computeVisionFromColor(simBoard, 1);
            const wVis = this.computeVisionFromColor(simBoard, 2);
            if (bVis[m.row][m.col] && wVis[m.row][m.col])
                out.push({ type: 'move', player: m.player, row: m.row, col: m.col });
            const nb = this.tryPlaceStone(simBoard, m.row, m.col, playerVal);
            if (nb) simBoard = this.removeDeadAndDying(nb);
        }
        return out;
    }

    filterMoveCoordsForSlot(slot) {
        if (slot === 'black') return this.filterMoveCoordsForPlayerSlot('black');
        if (slot === 'white') return this.filterMoveCoordsForPlayerSlot('white');
        return this.filterMoveCoordsForObserver();
    }

    /**
     * 完整盘面统计：黑 — 白方视野内看不到的黑子数；白 — 黑方视野内看不到的白子数。
     */
    countUnknownFogStonesOnBoard(board) {
        const bVis = this.computeVisionFromColor(board, 1);
        const wVis = this.computeVisionFromColor(board, 2);
        let black = 0;
        let white = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const v = board[r][c];
                if (v === 1 && !wVis[r][c]) black++;
                if (v === 2 && !bVis[r][c]) white++;
            }
        }
        return { black, white };
    }

    getUnknownFogCountsHistory() {
        const hist = [];
        hist.push(this.countUnknownFogStonesOnBoard(this.emptyBoard()));
        for (let i = 0; i < this.historyBoards.length; i++)
            hist.push(this.countUnknownFogStonesOnBoard(this.historyBoards[i]));
        return hist;
    }

    buildFogMask(slot) {
        const bVis = this.computeVisionFromColor(this.board, 1);
        const wVis = this.computeVisionFromColor(this.board, 2);
        const fog = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (slot === 'black') fog[r][c] = !bVis[r][c];
                else if (slot === 'white') fog[r][c] = !wVis[r][c];
                else fog[r][c] = !(bVis[r][c] && wVis[r][c]);
            }
        }
        return fog;
    }

    emptyFogMask() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
    }

    fogCleared() {
        return this.pendingScore !== null || this.gameOver;
    }

    filterLastMoveMarkers(slot) {
        if (!this.lastMoveMarkers.length) return [];
        const masked = this.buildMaskedBoard(slot);
        return this.lastMoveMarkers.filter(m => {
            const { row, col, color } = m;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return true;
            return masked[row][col] === color;
        }).map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    getStateForSlot(slot) {
        const cleared = this.fogCleared();
        const board = cleared ? this.board : this.buildMaskedBoard(slot);
        const fogMask = cleared ? this.emptyFogMask() : this.buildFogMask(slot);
        const moveCoords = cleared ? this.moveCoords.map(m => ({ ...m })) : this.filterMoveCoordsForSlot(slot);
        const replayStepPlayers = this.getReplayStepPlayers();
        const maskedBoardHistory = cleared ? null : this.getMaskedBoardHistoryForSlot(slot);
        const stoneMoveNumbersHistory = cleared ? this.getFullStoneMoveNumbersHistory() : null;
        const ownStoneMoveNumbersHistory = !cleared && slot ? this.getOwnStoneMoveNumbersHistoryForSlot(slot) : null;
        const unknownFogCounts = cleared ? null : this.countUnknownFogStonesOnBoard(this.board);
        const unknownFogCountsHistory = cleared ? null : this.getUnknownFogCountsHistory();
        return {
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            board,
            fogMask,
            fogCleared: cleared,
            useServerBoard: true,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: cleared ? this.lastMoveMarkers : this.filterLastMoveMarkers(slot),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords,
            replayStepPlayers,
            maskedBoardHistory,
            stoneMoveNumbersHistory,
            ownStoneMoveNumbersHistory,
            unknownFogCounts,
            unknownFogCountsHistory,
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

    getState() {
        return this.getStateForSlot(undefined);
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        return this.getStateForSlot(slot);
    }

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

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        this.pendingScore = { requester, opponent, agreed: new Set() };
        this.broadcastState('scoreCounting');
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
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
                if (this.board[row][col] !== 0) {
                    const playerVal = this.currentPlayer === 1 ? 1 : 2;
                    const enemyVal = 3 - playerVal;
                    if (this.board[row][col] === enemyVal)
                        ws.send(JSON.stringify({ type: 'error', message: '该处已有棋子。' }));
                    return;
                }
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
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcastState('move');
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
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcastState('pass');
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    this.passCounter = 0;
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
                qiProtocol.resign(this, ws, slot, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
                });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
                });
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, {
                    broadcastPerClient: (action, extra = {}) => this.broadcastState(action, extra)
                });
                break;

            case 'requestEnd':
                qiProtocol.requestEnd(this, ws, slot);
                break;

            case 'endResponse':
                qiProtocol.endResponse(this, ws, msg, { endDeniedMsg: '对方拒绝数点。' });
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (!msg.accept) {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        this.broadcastState('scoreRejected');
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
                        this.broadcastState('scoreSettled');
                    }
                }
                break;

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord(ws) }));
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
            this.board = this.emptyBoard();
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcastState('undoAccept');
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
        this.board = this.emptyBoard();
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

    /**
     * 未终局且未进入数点（迷雾未解除）时：只导出己方真实着手；对方每手记为 Bi 或 Wi（落子与虚着均如此）。
     * 观战者导出为 Bi、Wi 交替。终局或数点阶段导出完整棋谱。
     */
    exportMovesPartialForSlot(slot) {
        const out = [];
        for (const m of this.moveCoords) {
            const blackMove = m.player === 'black';
            if (slot === 'black') {
                if (blackMove)
                    out.push(m.type === 'pass' ? 'Bp' : `B${m.row},${m.col}`);
                else
                    out.push('Wi');
            } else if (slot === 'white') {
                if (!blackMove)
                    out.push(m.type === 'pass' ? 'Wp' : `W${m.row},${m.col}`);
                else
                    out.push('Bi');
            } else {
                out.push(blackMove ? 'Bi' : 'Wi');
            }
        }
        return out;
    }

    exportRecord(ws) {
        const base = {
            format: 'muzei',
            version: 1,
            gameType: '迷雾围棋',
            gameId: 'fog-weiqi',
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] }
        };
        const fullTruth = this.gameOver || this.fogCleared();
        if (fullTruth) {
            return {
                ...base,
                moves: this.moveCoords.map(m => {
                    const p = m.player === 'black' ? 'B' : 'W';
                    return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
                }),
                timeControl: (this.tcSettings && this.tcSettings.timed)
                    ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                    : null,
                result: this.gameOver ? this.winner : null
            };
        }
        const slot = this.room.getSlotByWs(ws);
        return {
            ...base,
            moves: this.exportMovesPartialForSlot(slot),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: null
        };
    }

    resetToEmpty() {
        this.board = this.emptyBoard();
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
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            if (entry === 'Bi' || entry === 'Wi') {
                const player = entry === 'Bi' ? 'black' : 'white';
                return { type: 'pass', player };
            }
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== 'fog-weiqi' && data.gameId !== 'weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要迷雾围棋或围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        if (data.initialPosition) {
            if (Array.isArray(data.initialPosition.black)) {
                for (const pos of data.initialPosition.black) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
                            this.board[r][c] = 1;
                    }
                }
            }
            if (Array.isArray(data.initialPosition.white)) {
                for (const pos of data.initialPosition.white) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
                            this.board[r][c] = 2;
                    }
                }
            }
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(FogWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcastPerClientReset();
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcastPerClientReset();
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
            this.winner = FogWeiqiRoom.parseResultTextToWinner(importedResultText);
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
                    initialPosition: data.initialPosition || { black: [], white: [] },
                    moves: this.moveCoords.map(m => ({ ...m }))
                }
            }));
        }
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
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
        room.gameLogic = new FogWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
