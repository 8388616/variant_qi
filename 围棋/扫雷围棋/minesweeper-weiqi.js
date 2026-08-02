const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, qiBoardSeatOverlay } = require('../common');
const MINE = -3;
class MinesweeperWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.useCustomEditBoard = true;
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
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
        this.moveCoords = [];
        /** 对局中随机雷未向客户端公开时为 true；编辑棋盘摆洞为 false */
        this.randomMinesFromGame = false;
        /** 终局、或进入数点阶段后，客户端可见全部 -1 雷位；数点被拒后仍保持 */
        this.minesRevealedPublicly = false;
        this.clientBoardHistory = [];
        this.clientMarkerHistory = [];
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
                this.minesRevealedPublicly = true;
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
    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot); if (!ws) return;
        ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'respond', proposal: { ok: true, timed: proposal.timed, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts } }));
    }
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
        this._stopClockTicker(); this.gameOver = true; this.winner = winnerSlot; this.minesRevealedPublicly = true; this.setTimeLossResultText(lostSlot);
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }
    _syncClockAfterTurnChange() { if (this.tcClock && this.tcClock.timed && !this.gameOver) { qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now()); this._broadcastClock(); } }
    onResignResolved(resignSlot) { this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜'; this.minesRevealedPublicly = true; }
    onDrawResolved() { this.recordResultText = '和胜'; this.minesRevealedPublicly = true; }
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

    scrubBoardForViewer(brd) {
        const b = this.copyBoard(brd);
        if (this.randomMinesFromGame && !this.minesRevealedPublicly && !this.gameOver) {
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    if (b[r][c] === MINE) b[r][c] = 0;
                }
            }
        }
        return b;
    }

    getClientBoard() {
        return this.scrubBoardForViewer(this.board);
    }

    rebuildClientBoardHistory() {
        this.clientBoardHistory = [];
        this.clientMarkerHistory = [];
        const empty = () => Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        const hasInitialSnapshot = this.historyBoards.length === this.moveCoords.length + 1;
        let cur = hasInitialSnapshot ? this.copyBoard(this.historyBoards[0]) : empty();
        let markers = [];
        const push = () => {
            const sb = this.scrubBoardForViewer(cur);
            this.clientBoardHistory.push(sb.map(row => [...row]));
            this.clientMarkerHistory.push(markers.map(m => ({ ...m })));
        };
        push();
        let stoneMoveCount = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (cur[r][c] === 1 || cur[r][c] === 2) stoneMoveCount++;
            }
        }
        let minesInjected = false;
        for (const m of this.moveCoords) {
            const pv = m.player === 'black' ? 1 : 2;
            if (m.type === 'move') {
                const nb = this.tryPlaceStone(cur, m.row, m.col, pv);
                if (nb) cur = nb;
                stoneMoveCount++;
                markers = [{ row: m.row, col: m.col, color: pv }];
                if (this.randomMinesFromGame && this.snapshotHolesAfterGen && !minesInjected && stoneMoveCount >= 2) {
                    for (const h of this.snapshotHolesAfterGen) {
                        if (cur[h.r][h.c] === 0) cur[h.r][h.c] = MINE;
                    }
                    minesInjected = true;
                }
            } else if (m.type === 'mineHit') {
                markers = [{ row: m.row, col: m.col, color: pv }];
                if (cur[m.row][m.col] === MINE) cur[m.row][m.col] = 0;
            } else if (m.type === 'holeReveal') {
                if (cur[m.row][m.col] === MINE) cur[m.row][m.col] = 0;
                markers = [{ row: m.row, col: m.col, color: pv }];
            } else if (m.type === 'pass') {
                markers = [];
            }
            push();
        }
    }

    holeCountForBoard() {
        return Math.ceil(0.2 * this.boardSize * this.boardSize);
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    isBoardConnected(board) {
        const n = this.boardSize;
        const visited = Array(n).fill().map(() => Array(n).fill(false));
        let startRow = -1, startCol = -1;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== MINE) {
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
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < n && nc >= 0 && nc < n &&
                    !visited[nr][nc] && board[nr][nc] !== MINE) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }

        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== MINE && !visited[r][c]) {
                    return false;
                }
            }
        }
        return true;
    }

    generateHolesAfterSecondMove() {
        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        if (stoneMoves.length < 2) return;

        const exclude = new Set([
            `${stoneMoves[0].row},${stoneMoves[0].col}`,
            `${stoneMoves[1].row},${stoneMoves[1].col}`
        ]);

        const HOLE_COUNT = this.holeCountForBoard();
        const MAX_ATTEMPTS = 100;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const points = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const key = `${r},${c}`;
                    if (exclude.has(key)) continue;
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
                }
            }
            const selected = [];
            const temp = [...points];
            for (let i = 0; i < HOLE_COUNT && temp.length > 0; i++) {
                let total = temp.reduce((s, p) => s + p.weight, 0);
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

            const trial = this.copyBoard(this.board);
            for (let h of selected) trial[h.r][h.c] = MINE;

            if (this.isBoardConnected(trial)) {
                this.board = trial;
                this.holes = selected.map(h => ({ r: h.r, c: h.c }));
                this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
                this.randomMinesFromGame = true;
                return;
            }
        }

        console.warn(`扫雷围棋：${MAX_ATTEMPTS} 次尝试后仍未能生成连通洞分布，使用最后一次`);
        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const key = `${r},${c}`;
                if (!exclude.has(key))
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const selected = [];
        const temp = [...points];
        for (let i = 0; i < HOLE_COUNT && temp.length > 0; i++) {
            let total = temp.reduce((s, p) => s + p.weight, 0);
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
        for (let h of selected) this.board[h.r][h.c] = MINE;
        this.holes = selected.map(h => ({ r: h.r, c: h.c }));
        this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
        this.randomMinesFromGame = true;
    }

    /**
     * 第二手实着之后：若有棋谱/预设的雷快照则铺到空点上，否则随机生成。
     * 铺雷后刷新最后一帧历史快照（与对局 move 一致）。
     */
    maybeGenerateOrInjectMinesAfterSecondStoneMove() {
        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        if (this.holesGenerated || stoneMoves.length < 2) return;
        if (this.snapshotHolesAfterGen && this.snapshotHolesAfterGen.length > 0) {
            for (const h of this.snapshotHolesAfterGen) {
                if (this.board[h.r][h.c] === 0) this.board[h.r][h.c] = MINE;
            }
            this.holes = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    if (this.board[r][c] === MINE) this.holes.push({ r, c });
                }
            }
            this.randomMinesFromGame = false;
        } else {
            this.generateHolesAfterSecondMove();
        }
        this.holesGenerated = true;
        this.replaceLastHistorySnapshot();
    }

    hasLiberty(board, row, col) 
    {
        const color = board[row][col];
        if (color === 0 || color === MINE)
            return false;

        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        visited[row][col] = true;
        while (queue.length) 
        {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) 
            {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize)
                    continue;
                if (board[nr][nc] === 0 || board[nr][nc] === MINE)
                    return true;
                if (board[nr][nc] === color && !visited[nr][nc])
                {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]); 
                }
            }
        }
        return false;
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal)
    {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal) 
            {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) 
                {
                    checkedEnemy.add(key);
                    if (!this.hasLiberty(newBoard, nr, nc))
                        this.removeGroup(newBoard, nr, nc, 3 - playerVal, this.boardSize);
                }
            }
        }

        if (!this.hasLiberty(newBoard, row, col))
            this.removeGroup(newBoard, row, col, playerVal, this.boardSize);

        return newBoard;
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

    computeMinesweeperHints(board) {
        const hints = {};
        const dirs8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== 1 && board[r][c] !== 2) continue;
                let cnt = 0;
                for (let [dr, dc] of dirs8) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === MINE)
                        cnt++;
                }
                if (cnt > 0) hints[`${r},${c}`] = cnt;
            }
        }
        return hints;
    }

    getState() {
        this.rebuildClientBoardHistory();
        return {
            boardSize: this.boardSize,
            board: this.getClientBoard(),
            minesweeperHints: this.computeMinesweeperHints(this.board),
            holesGenerated: this.holesGenerated,
            minesRevealedPublicly: this.minesRevealedPublicly,
            randomMinesFromGame: this.randomMinesFromGame,
            boardHistory: this.clientBoardHistory.map(rowset => rowset.map(r => [...r])),
            markerHistory: this.clientMarkerHistory.map(arr => arr.map(m => ({ ...m }))),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map(m => ({ ...m })),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords.map(m => ({ ...m })),
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
        this.minesRevealedPublicly = true;
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true, Date.now());
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead, ...this.getState() };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    replaceLastHistorySnapshot() {
        if (this.historyBoards.length === 0) return;
        const last = this.historyBoards[this.historyBoards.length - 1];
        this.historyBoardSet.delete(this.boardToString(last));
        const next = this.copyBoard(this.board);
        this.historyBoards[this.historyBoards.length - 1] = next;
        this.historyBoardSet.add(this.boardToString(next));
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) });
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
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;

                if (this.board[row][col] === MINE) {
                    const playerVal = this.currentPlayer === 1 ? 1 : 2;
                    this.board[row][col] = 0;
                    this.holes = this.holes.filter(h => !(h.r === row && h.c === col));
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    this.lastMoveMarkers = [{ row, col, color: playerVal }];
                    this.broadcast({ type: 'broadcast', action: 'mineHit', player: slot, row, col, ...this.getState() });
                    this._syncClockAfterTurnChange();
                    return;
                }

                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) 
                {
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

                this.maybeGenerateOrInjectMinesAfterSecondStoneMove();

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.minesRevealedPublicly = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                this._syncClockAfterTurnChange();
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
                this.minesRevealedPublicly = true;
                qiProtocol.resign(this, ws, slot, { onResignResolved: (logic, s) => logic.onResignResolved(s) });
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
                qiProtocol.drawResponse(this, ws, msg, { onDrawResolved: (logic) => logic.onDrawResolved() });
                if (this.winner === 'draw') this.minesRevealedPublicly = true;
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
                            this._stopClockTicker();
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead, ...this.getState() });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false, Date.now());
                        this.broadcast({ type: 'scoreRejected', ...this.getState() });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
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
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            case 'editBoard':
                if (this.gameOver || this.historyBoards.length > 1) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
                    return;
                }
                const editedBoard = msg.board;
                if (!editedBoard || editedBoard.length !== this.boardSize) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return;
                }
                for (let r = 0; r < this.boardSize; r++) {
                    for (let c = 0; c < this.boardSize; c++) {
                        const val = editedBoard[r][c];
                        if (val !== MINE && val !== 0 && val !== 1 && val !== 2) {
                            ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                            return;
                        }
                    }
                }
                this.board = this.copyBoard(editedBoard);
                this.holes = [];
                for (let r = 0; r < this.boardSize; r++) {
                    for (let c = 0; c < this.boardSize; c++) {
                        if (this.board[r][c] === MINE) this.holes.push({ r, c });
                    }
                }
                this.holesGenerated = this.holes.length > 0;
                this.snapshotHolesAfterGen = this.holesGenerated ? this.holes.map(h => ({ r: h.r, c: h.c })) : null;
                this.randomMinesFromGame = false;
                this.minesRevealedPublicly = false;
                this.historyBoards = [this.copyBoard(this.board)];
                this.historyBoardSet.clear();
                this.historyBoardSet.add(this.boardToString(this.board));
                this.moveHistory = [];
                this.moveCoords = [];
                this.historyMarkers = [];
                this.currentPlayer = 1;
                this.lastMoveMarkers = [];
                this.passCounter = 0;
                this.gameOver = false;
                this.winner = null;
                this.broadcast({ type: 'editBoardAccepted', ...this.getInitialState() });
                break;

            default:
                break;
        }
    }

    getInitialState() {
        this.rebuildClientBoardHistory();
        return {
            boardSize: this.boardSize,
            board: this.getClientBoard().map(r => [...r]),
            minesweeperHints: this.computeMinesweeperHints(this.board),
            holesGenerated: this.holesGenerated,
            minesRevealedPublicly: this.minesRevealedPublicly,
            randomMinesFromGame: this.randomMinesFromGame,
            boardHistory: this.clientBoardHistory.map(rowset => rowset.map(row => [...row])),
            markerHistory: this.clientMarkerHistory.map(arr => arr.map(m => ({ ...m }))),
            numberOfHands: 1,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: [],
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: [],
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

        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
        this.holes = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === MINE) this.holes.push({ r, c });
            }
        }
        if (stoneMoves.length >= 2 && this.holes.length > 0) {
            this.holesGenerated = true;
            this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
        }
        this.randomMinesFromGame = this.holesGenerated && this.snapshotHolesAfterGen && this.snapshotHolesAfterGen.length > 0
            && stoneMoves.length >= 2;

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
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.minesRevealedPublicly = false;
        this.randomMinesFromGame = false;
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        const includeMines = this.minesRevealedPublicly || this.gameOver;
        let initialPosition = [];
        const encodeMove = (m) => {
            const p = m.player === 'black' ? 'B' : 'W';
            if (m.type === 'pass') return p + 'p';
            if (m.type === 'mineHit') {
                if (!includeMines) return p + 'p';
                return p + 'm' + m.row + ',' + m.col;
            }
            if (m.type === 'holeReveal') {
                if (!includeMines) return p + 'p';
                return p + 'h' + m.row + ',' + m.col;
            }
            return p + m.row + ',' + m.col;
        };

        if (includeMines && stoneMoves.length >= 2 && this.snapshotHolesAfterGen && this.snapshotHolesAfterGen.length > 0) {
            initialPosition = this.snapshotHolesAfterGen.map(h => `M${h.r},${h.c}`);
        }

        const exportedTimeControl = (this.tcSettings && this.tcSettings.timed)
            ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
            : null;

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
            gameType: '扫雷围棋',
            gameId: 'minesweeper-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition,
            moves: this.moveCoords.map(encodeMove),
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
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
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
        this.minesRevealedPublicly = false;
        this.randomMinesFromGame = false;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            if (entry[1] === 'm') {
                const coords = entry.substring(2).split(',').map(Number);
                return { type: 'mineHit', player, row: coords[0], col: coords[1] };
            }
            if (entry[1] === 'h') {
                const coords = entry.substring(2).split(',').map(Number);
                return { type: 'holeReveal', player, row: coords[0], col: coords[1] };
            }
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    static isLegacyMinesweeperInitial(ip) {
        if (!Array.isArray(ip)) return false;
        return ip.some(s => typeof s === 'string' && s.length >= 2 && (s[0] === 'B' || s[0] === 'W'));
    }

    /** 从棋谱 initialPosition 中解析仅含 M 的雷布局（新格式）。 */
    static parseMineSnapshotFromInitial(ip, boardSize) {
        const out = [];
        if (!Array.isArray(ip) || !Number.isInteger(boardSize)) return out;
        for (const s of ip) {
            if (typeof s !== 'string' || s.length < 3 || s[0] !== 'M') continue;
            const comma = s.indexOf(',');
            if (comma <= 1) continue;
            const r = parseInt(s.slice(1, comma), 10);
            const c = parseInt(s.slice(comma + 1), 10);
            if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
            if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
            out.push({ r, c });
        }
        return out;
    }

    /**
     * 棋谱 initialPosition：
     * - 旧格式：紧凑数组含 B/W/M，如 ["B3,3","W4,4","M5,5"]（开局即含子与雷）。
     * - 新格式（导出含雷时）：仅 M 列表，前两子与后续手均在 moves；第二手实着后铺雷。
     */
    static applyInitialPositionCompactMinesweeper(board, boardSize, ip) {
        if (!ip) return;
        if (Array.isArray(ip)) {
            for (const s of ip) {
                if (typeof s !== 'string' || s.length < 3) continue;
                const prefix = s[0];
                if (prefix !== 'B' && prefix !== 'W' && prefix !== 'M') continue;
                const comma = s.indexOf(',');
                if (comma <= 1) continue;
                const r = parseInt(s.slice(1, comma), 10);
                const c = parseInt(s.slice(comma + 1), 10);
                if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (prefix === 'B') board[r][c] = 1;
                else if (prefix === 'W') board[r][c] = 2;
                else if (prefix === 'M') board[r][c] = MINE;
            }
            return;
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'minesweeper-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要扫雷围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        const ip = data.initialPosition || [];
        const legacyInitial = MinesweeperWeiqiRoom.isLegacyMinesweeperInitial(ip);
        if (legacyInitial) {
            MinesweeperWeiqiRoom.applyInitialPositionCompactMinesweeper(this.board, this.boardSize, ip);
            this.holes = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    if (this.board[r][c] === MINE) this.holes.push({ r, c });
                }
            }
            this.holesGenerated = this.holes.length > 0;
            this.snapshotHolesAfterGen = this.holesGenerated ? this.holes.map(h => ({ r: h.r, c: h.c })) : null;
        } else {
            const mineSnap = MinesweeperWeiqiRoom.parseMineSnapshotFromInitial(ip, this.boardSize);
            this.snapshotHolesAfterGen = mineSnap.length > 0 ? mineSnap.map(h => ({ r: h.r, c: h.c })) : null;
            this.holes = [];
            this.holesGenerated = false;
        }

        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(MinesweeperWeiqiRoom.parseMove);
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
                this.maybeGenerateOrInjectMinesAfterSecondStoneMove();
            } else if (move.type === 'mineHit') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.board[row][col] === MINE) {
                    this.board[row][col] = 0;
                    this.holes = this.holes.filter(h => !(h.r === row && h.c === col));
                }
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
            } else if (move.type === 'holeReveal') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.board[row][col] === MINE) {
                    this.board[row][col] = 0;
                    this.holes = this.holes.filter(h => !(h.r === row && h.c === col));
                    const afterStr = this.boardToString(this.board);
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyBoardSet.add(afterStr);
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'holeReveal', player: slot, row, col });
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    this.lastMoveMarkers = [];
                } else {
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    this.lastMoveMarkers = [{ row, col, color: playerVal }];
                }
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

        if ((data.result || data.resultText) && !this.gameOver) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = MinesweeperWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw')) this.winner = data.result;
        }

        const holesFromFile =
            (Array.isArray(ip) && ip.some(entry => typeof entry === 'string' && entry[0] === 'M')) ||
            (ip && typeof ip === 'object' && Array.isArray(ip.holes) && ip.holes.length > 0);
        const smAfter = this.moveCoords.filter(m => m.type === 'move');
        this.randomMinesFromGame = !holesFromFile && !!(this.snapshotHolesAfterGen && this.snapshotHolesAfterGen.length) && smAfter.length >= 2;
        this.minesRevealedPublicly = !!data.result || holesFromFile;

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition != null ? data.initialPosition : [],
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
        room.gameLogic = new MinesweeperWeiqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
