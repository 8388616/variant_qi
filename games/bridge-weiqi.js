const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact, qiBoardSeatOverlay } = require('../common');
const BRIDGE = -2;

/**
 * 形势判断：在带桥的棋盘上按「桥缩短邻接」的图距离（每步沿四方向直穿连续桥格只计 1）做 BFS，
 * 落点格仍受 isPassable 约束（默认仅洞 -1 不可落脚）。
 */
function assignTerritoryBridgeAware(liveBoard, boardSize, options = {}) {
    const isPassable = options.isPassable ?? ((v) => v !== -1);
    const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
    const bridgeTerritoryNeighbors = (row, col) => {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const out = [];
        const seen = new Set();
        for (const [dr, dc] of dirs) {
            let nr = row + dr;
            let nc = col + dc;
            if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
            while (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && liveBoard[nr][nc] === BRIDGE) {
                nr += dr;
                nc += dc;
            }
            if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
            if (!isPassable(liveBoard[nr][nc])) continue;
            const key = `${nr},${nc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push([nr, nc]);
        }
        return out;
    };
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
            if (liveBoard[r][c] !== 0) continue;
            const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
            let blackMin = Infinity;
            let whiteMin = Infinity;
            const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
            dist[r][c] = 0;
            const queue = [[r, c]];
            let front = 0;
            while (front < queue.length) {
                const [cr, cc] = queue[front++];
                const d = dist[cr][cc];
                if (d > maxDist) continue;
                if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                for (const [nr, nc] of bridgeTerritoryNeighbors(cr, cc)) {
                    if (dist[nr][nc] !== Infinity) continue;
                    dist[nr][nc] = d + 1;
                    queue.push([nr, nc]);
                }
            }
            if (blackMin <= maxDist && whiteMin <= maxDist) {
                if (blackMin < whiteMin) territory[r][c] = 1;
                else if (whiteMin < blackMin) territory[r][c] = 2;
                else territory[r][c] = 3;
            } else if (blackMin <= maxDist) territory[r][c] = 1;
            else if (whiteMin <= maxDist) territory[r][c] = 2;
            else territory[r][c] = 3;
        }
    }
    return territory;
}

class BridgeWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.editBoardAllowedValues = [0, 1, 2, BRIDGE];
        this.afterEditBoard = function () {
            this.bridges = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    if (this.board[r][c] === BRIDGE) this.bridges.push({ r, c });
                }
            }
        };
        this.boardSize = initialSize;
        this.BRIDGE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, bridges } = this.generateBridgesAndBoard();
        this.board = board;
        this.bridges = bridges;
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.moveCoords = [];
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    _stopClockTicker() { if (this._clockInterval) { clearInterval(this._clockInterval); this._clockInterval = null; } }
    _broadcastClock() { if (this.tcClock && this.tcClock.timed && !this.gameOver) this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) }); }
    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return this._stopClockTicker();
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
    _firstPickerSlot() { const tb = this.slotJoinedAt.black, tw = this.slotJoinedAt.white; if (tb == null || tw == null) return 'black'; return tb <= tw ? 'black' : 'white'; }
    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        const ws = this.room.getPlayerBySlot(first); if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const ws2 = this.room.getPlayerBySlot(first === 'black' ? 'white' : 'black'); if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }
    afterColorAssigned(ws, slot) { this.slotJoinedAt[slot] = Date.now(); this._maybeBeginTimeNegotiation(); }
    _sendRespondDialog(toSlot, proposal) { const ws = this.room.getPlayerBySlot(toSlot); if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'respond', proposal: { ok: true, timed: proposal.timed, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts } })); }
    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws); if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg); if (!v.ok) return ws.send(JSON.stringify({ type: 'error', message: v.error }));
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v; this.tcNego.lastProposerSlot = slot; this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black'; this.tcNego.waitingSlot = other;
        const me = this.room.getPlayerBySlot(slot); if (me) me.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
        this._sendRespondDialog(other, v);
    }
    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond' || slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal; if (!prop || prop.ok !== true) return;
        this.tcSettings = prop.timed ? { timed: true, mainMinutes: prop.mainMinutes, byoyomiSeconds: prop.byoyomiSeconds, maxTimeouts: prop.maxTimeouts } : { timed: false };
        this.tcNego = null; this.matchStarted = true; this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) { qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now()); this._startClockTicker(); this._broadcastClock(); } else this.tcClock = null;
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }
    _timeAllowsPlay(slot) { if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false; if (!this.tcClock || !this.tcClock.timed) return true; return slot === (this.currentPlayer === 1 ? 'black' : 'white'); }
    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker(); this.gameOver = true; this.winner = winnerSlot; this.setTimeLossResultText(lostSlot);
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }
    _syncClockAfterTurnChange() { if (this.tcClock && this.tcClock.timed && !this.gameOver) { qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now()); this._broadcastClock(); } }
    onResignResolved(resignSlot) { this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜'; }
    onDrawResolved() { this.recordResultText = '和胜'; }
    setScoreResultTextByLead(lead) { if (lead > 0) this.recordResultText = `黑胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`; else if (lead < 0) this.recordResultText = `白胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`; else this.recordResultText = '和胜'; }
    setTimeLossResultText(lostSlot) { if (lostSlot === 'black') this.recordResultText = '黑超时白胜'; else if (lostSlot === 'white') this.recordResultText = '白超时黑胜'; }
    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    inBounds(r, c) {
        return r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize;
    }

    resolveBridgeStep(board, row, col, dr, dc) {
        let r = row + dr;
        let c = col + dc;
        while (this.inBounds(r, c) && board[r][c] === BRIDGE) {
            r += dr;
            c += dc;
        }
        if (!this.inBounds(r, c)) return null;
        return [r, c];
    }

    getBridgeNeighbors(board, row, col) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const out = [];
        const seen = new Set();
        for (const [dr, dc] of dirs) {
            const p = this.resolveBridgeStep(board, row, col, dr, dc);
            if (!p) continue;
            const key = `${p[0]},${p[1]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
        return out;
    }

    isBoardConnected(board)
    {
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        let startRow = -1, startCol = -1;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== BRIDGE) {
                    startRow = r;
                    startCol = c;
                    break;
                }
            }
            if (startRow !== -1) break;
        }
        if (startRow === -1) return true;

        const queue = [[startRow, startCol]];
        visited[startRow][startCol] = true;
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                if (!visited[nr][nc] && board[nr][nc] !== BRIDGE) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }

        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== BRIDGE && !visited[r][c]) return false;
            }
        }
        return true;
    }

    generateBridgesAndBoard()
    {
        const MAX_ATTEMPTS = 100;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const points = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
                }
            }
            const selected = [];
            const temp = [...points];
            for (let i = 0; i < this.BRIDGE_COUNT && temp.length > 0; i++) {
                const total = temp.reduce((s, p) => s + p.weight, 0);
                let rand = Math.random() * total;
                let accum = 0, idx = -1;
                for (let j = 0; j < temp.length; j++) {
                    accum += temp[j].weight;
                    if (rand <= accum) { idx = j; break; }
                }
                if (idx === -1) idx = temp.length - 1;
                selected.push({ r: temp[idx].r, c: temp[idx].c });
                temp.splice(idx, 1);
            }
            const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            for (const b of selected) board[b.r][b.c] = BRIDGE;

            if (this.isBoardConnected(board)) return { board, bridges: selected };
        }

        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const selected = [];
        const temp = [...points];
        for (let i = 0; i < this.BRIDGE_COUNT && temp.length > 0; i++) {
            const total = temp.reduce((s, p) => s + p.weight, 0);
            let rand = Math.random() * total;
            let accum = 0, idx = -1;
            for (let j = 0; j < temp.length; j++) {
                accum += temp[j].weight;
                if (rand <= accum) { idx = j; break; }
            }
            if (idx === -1) idx = temp.length - 1;
            selected.push({ r: temp[idx].r, c: temp[idx].c });
            temp.splice(idx, 1);
        }
        const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        for (const b of selected) board[b.r][b.c] = BRIDGE;
        return { board, bridges: selected };
    }

    collectGroup(board, row, col, color) {
        const group = [];
        const visited = new Set();
        const stack = [[row, col]];
        while (stack.length) {
            const [r, c] = stack.pop();
            const key = `${r},${c}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (!this.inBounds(r, c) || board[r][c] !== color) continue;
            group.push([r, c]);
            for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                if (board[nr][nc] === color) stack.push([nr, nc]);
            }
        }
        return group;
    }

    hasLiberty(board, row, col) {
        const v = board[row][col];
        if (v === 0 || v === BRIDGE) return false;
        const group = this.collectGroup(board, row, col, v);
        for (const [r, c] of group) {
            for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                if (board[nr][nc] === 0) return true;
            }
        }
        return false;
    }

    removeGroup(board, row, col, color) {
        const group = this.collectGroup(board, row, col, color);
        for (const [r, c] of group) board[r][c] = 0;
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.inBounds(row, col)) return null;
        if (boardBefore[row][col] !== 0) return null;
        const board = this.copyBoard(boardBefore);
        board[row][col] = playerVal;
        const opp = 3 - playerVal;
        for (const [nr, nc] of this.getBridgeNeighbors(board, row, col)) {
            if (board[nr][nc] === opp && !this.hasLiberty(board, nr, nc)) {
                this.removeGroup(board, nr, nc, opp);
            }
        }
        if (!this.hasLiberty(board, row, col)) {
            this.removeGroup(board, row, col, playerVal);
        }
        return board;
    }

    removeDeadAndDyingForBridge(boardSrc) {
        const board = this.copyBoard(boardSrc);
        let changed = true;
        while (changed) {
            changed = false;
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = board[r][c];
                    if ((v === 1 || v === 2) && !this.hasLiberty(board, r, c)) {
                        this.removeGroup(board, r, c, v);
                        changed = true;
                    }
                }
            }
        }
        return board;
    }

    computeLead() {
        const KOMI = 4.75;
        const liveBoard = this.removeDeadAndDyingForBridge(this.board);
        const territory = assignTerritoryBridgeAware(liveBoard, this.boardSize);
        const { blackTotal, whiteTotal } = squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        const initialBoard = this.openingBoard ? this.copyBoard(this.openingBoard) : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: 4.75,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            bridges: this.bridges,
            moveCoords: this.moveCoords,
            boardSize: this.boardSize,
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

    getInitialState() {
        const initialBoard = this.openingBoard ? this.copyBoard(this.openingBoard) : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: 4.75,
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            bridges: this.bridges,
            moveCoords: [],
            boardSize: this.boardSize,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true, Date.now());
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
        switch (msg.type)
        {
            case 'selectColor': qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) }); break;
            case 'timeControlSubmit': this._handleTimeControlSubmit(ws, msg); break;
            case 'timeControlAccept': this._handleTimeControlAccept(ws); break;
            case 'move':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                qiProtocol.weiqiMove(this, ws, msg, slot, { beforeCommit: () => this._drainClockBeforeMove(slot) });
                this._syncClockAfterTurnChange();
                break;
            case 'pass':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                qiProtocol.weiqiPass(this, ws, slot, { beforeCommit: () => this._drainClockBeforeMove(slot) });
                this._syncClockAfterTurnChange();
                break;
            case 'requestUndo': qiProtocol.weiqiRequestUndo(this, ws, slot); break;
            case 'undoResponse': qiProtocol.weiqiUndoResponse(this, ws, msg); break;
            case 'resign': qiProtocol.resign(this, ws, slot, { onResignResolved: (logic, s) => logic.onResignResolved(s) }); break;
            case 'requestNewGame': qiProtocol.requestNewGame(this, ws, slot); break;
            case 'newGameResponse': qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' }); break;
            case 'requestDraw': qiProtocol.requestDraw(this, ws, slot); break;
            case 'drawResponse': qiProtocol.drawResponse(this, ws, msg, { onDrawResolved: (logic) => logic.onDrawResolved() }); break;
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
                if (this.pendingEnd && msg.accept) this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept) this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
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
                            this._stopClockTicker();
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false, Date.now());
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;
            case 'exportRecord': qiProtocol.exportRecord(this, ws); break;
            case 'importRecord': qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' }); break;
            case 'resetRoom': qiProtocol.resetRoomToEmpty(this, ws); break;
            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;
            default:
                break;
        }
    }

    performUndo(steps) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) this.board = this.copyBoard(this.openingBoard);
        else this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', undoSteps: steps, ...this.getState() });
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
        this.matchStarted = false;
        const { board, bridges } = this.generateBridgesAndBoard();
        this.board = board;
        this.bridges = bridges;
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.moveCoords = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getInitialState(), slots: { black: false, white: false } });
    }

    exportRecord() {
        const initialBoard = this.openingBoard || this.board;

        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        return {
            format: 'muzei',
            game: '桥围棋',
            gameId: 'bridge-weiqi',
            boardSize: this.boardSize,
            komi: 4.75,
            players: { black: '', white: '' },
            initialPosition: encodeInitialPositionCompact(initialBoard, this.boardSize),
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
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.bridges = [];
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'object') return entry;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        const coords = entry.substring(1).split(',').map(Number);
        return { type: 'move', player, row: coords[0], col: coords[1] };
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId && data.gameId !== 'bridge-weiqi' && data.game !== '桥围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要桥围棋棋谱）。' }));
            return;
        }
        if (data.boardSize && data.boardSize >= 7 && data.boardSize <= 21) {
            this.boardSize = data.boardSize;
            this.BRIDGE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        }
        this.resetToEmpty();
        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.bridges = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === BRIDGE) this.bridges.push({ r, c });
            }
        }
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        const moves = (data.moves || []).map(m => BridgeWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'black' ? 1 : 2;
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
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'pass', player: move.player });
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

        if ((data.result || data.resultText) && !this.gameOver) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = BridgeWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw')) this.winner = data.result;
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

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.BRIDGE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, bridges } = this.generateBridgesAndBoard();
        this.board = board;
        this.bridges = bridges;
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.currentPlayer = 1;
        this.passCounter = 0;
        this.gameOver = false;
        this.winner = null;
        this.broadcast({ type: 'boardSizeChanged', ...this.getInitialState() });
        return true;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
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
        room.gameLogic = new BridgeWeiqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
