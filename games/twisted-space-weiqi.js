const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, gridGraphWeiqiRules, qiBoardSeatOverlay } = require('../common');

class TwistedSpaceWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 9) {
        super(room);
        this.boardSize = initialSize; // 扭曲空间路数（比三角围棋少一路）
        this.editBoardMode = 'jagged';
        this.editBoardRowLength = (r) => 2 * r + 1;
        this.board = this.createEmptyBoard();
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        this.cellNumbers = null;
        this.pairedLinks = null;
        this._ensureCellNumbersReady();
    }

    createEmptyBoard() {
        return Array(this.boardSize).fill().map((_, r) => Array(2 * r + 1).fill(0));
    }

    isValidCoord(r, c) {
        return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < this.boardSize && c >= 0 && c <= 2 * r;
    }

    copyBoard(src) {
        return src.map(row => row.slice());
    }

    boardToString(board) {
        return board.map(row => row.join(',')).join(';');
    }

    _neighbors() {
        return (r, c) => {
            const out = [];
            const seen = new Set();
            const add = (nr, nc) => {
                const k = `${nr},${nc}`;
                if (!seen.has(k) && this.isValidCoord(nr, nc)) {
                    seen.add(k);
                    out.push([nr, nc]);
                }
            };
            const left = c - 1;
            const right = c + 1;
            add(r, left);
            add(r, right);
            if ((c & 1) === 0) {
                const nr = r + 1;
                const nc = c + 1;
                add(nr, nc);
            } else {
                const nr = r - 1;
                const nc = c - 1;
                add(nr, nc);
            }
            if (this.pairedLinks && this.pairedLinks[r] && this.pairedLinks[r][c]) {
                for (const [nr, nc] of this.pairedLinks[r][c]) add(nr, nc);
            }
            return out;
        };
    }

    _createEmptyPairLinks() {
        return Array(this.boardSize).fill().map((_, r) => Array(2 * r + 1).fill().map(() => []));
    }

    _isValidCellNumbersShape(nums) {
        if (!Array.isArray(nums) || nums.length !== this.boardSize) return false;
        for (let r = 0; r < this.boardSize; r++) {
            if (!Array.isArray(nums[r]) || nums[r].length !== 2 * r + 1) return false;
            for (let c = 0; c <= 2 * r; c++) {
                if (!Number.isInteger(nums[r][c]) || nums[r][c] <= 0) return false;
            }
        }
        return true;
    }

    _buildPairLinksFromNumbers(nums) {
        const links = this._createEmptyPairLinks();
        const buckets = new Map();
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c <= 2 * r; c++) {
                const v = nums[r][c];
                if (!buckets.has(v)) buckets.set(v, []);
                buckets.get(v).push([r, c]);
            }
        }
        for (const arr of buckets.values()) {
            if (arr.length < 2) continue;
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const [r1, c1] = arr[i];
                    const [r2, c2] = arr[j];
                    links[r1][c1].push([r2, c2]);
                    links[r2][c2].push([r1, c1]);
                }
            }
        }
        return links;
    }

    _generateRandomCellNumbers() {
        const total = this.boardSize * this.boardSize;
        const maxNum = Math.ceil(total / 2);
        const pool = [];
        for (let i = 1; i <= maxNum; i++) {
            pool.push(i);
            if (!(total % 2 === 1 && i === maxNum)) pool.push(i);
        }
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const nums = Array(this.boardSize).fill().map((_, r) => Array(2 * r + 1).fill(0));
        let idx = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c <= 2 * r; c++) nums[r][c] = pool[idx++];
        }
        return nums;
    }

    _setCellNumbers(nums) {
        if (!this._isValidCellNumbersShape(nums)) {
            this.cellNumbers = null;
            this.pairedLinks = null;
            return;
        }
        this.cellNumbers = nums.map(row => row.slice());
        this.pairedLinks = this._buildPairLinksFromNumbers(this.cellNumbers);
    }

    _ensureCellNumbersReady() {
        if (this.cellNumbers && this.pairedLinks) return;
        this._setCellNumbers(this._generateRandomCellNumbers());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidCoord(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._neighbors(), 1
        );
    }

    removeDeadGroups(srcBoard) {
        return gridGraphWeiqiRules.removeDeadAndDying(
            srcBoard,
            this.boardSize,
            this.boardSize * 2 - 1,
            (b) => this.copyBoard(b),
            this._neighbors(),
            (r, c) => this.isValidCoord(r, c)
        );
    }

    computeLead() {
        const KOMI = 4.75;
        const liveBoard = this.removeDeadGroups(this.board);
        const territory = gridGraphWeiqiRules.assignTerritoryWithRange(
            liveBoard,
            this.boardSize,
            this.boardSize * 2 - 1,
            this._neighbors(),
            (r, c) => this.isValidCoord(r, c)
        );
        const { blackTotal, whiteTotal } = gridGraphWeiqiRules.computeScore(
            liveBoard,
            territory,
            this.boardSize,
            this.boardSize * 2 - 1,
            (r, c) => this.isValidCoord(r, c)
        );
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            cellNumbers: this.cellNumbers,
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
        const ws2 = this.room.getPlayerBySlot(first === 'black' ? 'white' : 'black');
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(_ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
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

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) return ws.send(JSON.stringify({ type: 'error', message: v.error }));
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v;
        this.tcNego.lastProposerSlot = slot;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        const me = this.room.getPlayerBySlot(slot);
        if (me) me.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
        this._sendRespondDialog(other, v);
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this.tcSettings = prop.timed
            ? { timed: true, mainMinutes: prop.mainMinutes, byoyomiSeconds: prop.byoyomiSeconds, maxTimeouts: prop.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
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
        this.broadcast({ type: 'gameState', ...this.getState() });
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
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
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
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
        this.recordResultText = `${lead > 0 ? '黑' : '白'}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'black') this.recordResultText = '黑超时白胜';
        else if (lostSlot === 'white') this.recordResultText = '白超时黑胜';
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        requester.send(JSON.stringify({ type: 'scoreProposal', lead }));
        opponent.send(JSON.stringify({ type: 'scoreProposal', lead }));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效' }));
            return false;
        }
        const hasAnyStone = this.board.some((row, r) => row.some((v, c) => this.isValidCoord(r, c) && v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        const exportedTimeControl = (this.tcSettings && this.tcSettings.timed)
            ? `S${this.tcSettings.mainMinutes},${this.tcSettings.byoyomiSeconds},${this.tcSettings.maxTimeouts}`
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
            gameType: '扭曲空间围棋',
            gameId: 'twisted-space-weiqi',
            boardSize: this.boardSize,
            komi: 4.75,
            players: { black: null, white: null },
            initialPosition: [],
            cellNumbers: this.cellNumbers ? this.cellNumbers.map(row => row.slice()) : null,
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : `${p}${m.row},${m.col}`;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const [row, col] = entry.slice(1).split(',').map(Number);
            return { type: 'move', player, row, col };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'twisted-space-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要扭曲空间围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效' }));
            return;
        }
        this.boardSize = newSize;
        this.resetToEmpty();
        if (this._isValidCellNumbersShape(data.cellNumbers)) this._setCellNumbers(data.cellNumbers);
        else this._ensureCellNumbersReady();
        const moves = (data.moves || []).map(TwistedSpaceWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'black' ? 1 : 2;
            if (move.type === 'move') {
                if (!this.isValidCoord(move.row, move.col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, move.row, move.col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(this.boardToString(newBoard));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, row: move.row, col: move.col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row: move.row, col: move.col, color: playerVal }];
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
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                boardSize: this.boardSize,
                initialPosition: [],
                cellNumbers: this.cellNumbers ? this.cellNumbers.map(row => row.slice()) : null,
                moves: moves.map(m => m.type === 'pass' ? { type: 'pass', player: m.player } : ({ type: 'move', player: m.player, row: m.row, col: m.col }))
            }
        });
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
        this.board = this.historyBoards.length === 0 ? this.createEmptyBoard() : this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = this.createEmptyBoard();
        this.cellNumbers = null;
        this.pairedLinks = null;
        this._ensureCellNumbersReady();
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

    resetGame() {
        this.resetToEmpty();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;
            case 'move':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                {
                    const { row, col } = msg;
                    if (!this.isValidCoord(row, col) || this.board[row][col] !== 0) return;
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
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                }
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
            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;
            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;
            case 'resign':
                qiProtocol.resign(this, ws, slot, { onResignResolved: (logic, s) => logic.onResignResolved(s) });
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot, { onDrawResolved: (logic) => logic.onDrawResolved() });
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, { onDrawResolved: (logic) => logic.onDrawResolved() });
                break;
            case 'requestEnd':
                if (!slot) return;
                {
                    const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!endOpponent) this.startScoreCounting(ws, ws);
                    else {
                        this.pendingEnd = { requester: ws, opponent: endOpponent };
                        endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                    }
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
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new TwistedSpaceWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
