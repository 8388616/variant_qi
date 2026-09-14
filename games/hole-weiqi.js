const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');

/** 洞围棋贴目（按路数）：7 路 4.75，其余（含默认 19 路）4.25 */
function komiForSizeHole(boardSize) {
    if (boardSize === 7) return 4.75;
    return 4.25;
}

class HoleWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.editBoardAllowedValues = [0, 1, 2, -1];
        this.afterEditBoard = function () {
            this.holes = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    if (this.board[r][c] === -1) this.holes.push({ r, c });
                }
            }
        };
        this.boardSize = initialSize;
        this.HOLE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, holes } = this.generateHolesAndBoard();
        this.board = board;
        this.holes = holes;
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
        this.slotJoinedAt = { player1: null, player2: null };
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        return slot === (this.currentPlayer === 1 ? 'player1' : 'player2');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
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
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (lead > 0) this.recordResultText = `黑胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else if (lead < 0) this.recordResultText = `白胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else this.recordResultText = '和棋';
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和棋' || resultText === 'draw') return 'draw';
        if (resultText.includes('白胜')) return 'player2';
        if (resultText.includes('黑胜')) return 'player1';
        if (resultText === 'player1' || resultText === 'player2' || resultText === 'draw') return resultText;
        return null;
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    isBoardConnected(board)
    {
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        let startRow = -1, startCol = -1;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== -1) {
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
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize &&
                    !visited[nr][nc] && board[nr][nc] !== -1) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }

        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== -1 && !visited[r][c]) {
                    return false;
                }
            }
        }
        return true;
    }

    generateHolesAndBoard()
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
            for (let i = 0; i < this.HOLE_COUNT && temp.length > 0; i++) {
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
            const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            for (let h of selected) board[h.r][h.c] = -1;

            if (this.isBoardConnected(board)) {
                return { board, holes: selected };
            }
        }
        console.warn(`经过 ${MAX_ATTEMPTS} 次尝试仍未生成连通棋盘，使用最后一次结果`);
        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const selected = [];
        const temp = [...points];
        for (let i = 0; i < this.HOLE_COUNT && temp.length > 0; i++) {
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
        const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        for (let h of selected) board[h.r][h.c] = -1;
        return { board, holes: selected };
    }

    hasLiberty(board, row, col) {
        const v = board[row][col];
        if (v === 0 || v === -1) return false;
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize,
            (b) => this.copyBoard(b), 1
        );
    }

    computeLead() {
        const KOMI = komiForSizeHole(this.boardSize);
        const size = this.boardSize;
        const isHoleBoard = (bd) => (r, c) => bd[r][c] === -1;
        // Benson（洞版）：洞不可落子、无气、不连通，不参与分析
        const benson = squareWeiqiRules.bensonAliveWithHoles(this.board, size, isHoleBoard(this.board));
        let liveBoard = this.board.map((row) => row.slice());
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = squareWeiqiRules.removeDeadAndDying(liveBoard, size, (b) => this.copyBoard(b));
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const v = this.board[r][c];
                    if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
            }
            liveBoard = cleaned;
        }
        const territory = squareWeiqiRules.assignTerritoryWithRange(liveBoard, size);
        const secure = squareWeiqiRules.bensonAliveWithHoles(liveBoard, size, isHoleBoard(liveBoard));
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
        }
        const { blackTotal, whiteTotal } = squareWeiqiRules.computeScore(liveBoard, territory, size);
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: komiForSizeHole(this.boardSize),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            holes: this.holes,
            moveCoords: this.moveCoords,
            boardSize: this.boardSize,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
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
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: komiForSizeHole(this.boardSize),
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            holes: this.holes,
            moveCoords: [],
            boardSize: this.boardSize,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
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
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) });
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, { onDrawResolved: (logic) => logic.onDrawResolved() });
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
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

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
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
            if (this.moveCoords.length > 0) this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = this.copyBoard(this.openingBoard);
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));

        this.broadcast({ type: 'broadcast', action: 'undoAccept', undoSteps: steps, ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        const { board, holes } = this.generateHolesAndBoard();
        this.board = board;
        this.holes = holes;
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
        for (let [client, slot] of this.room.players.entries())
        {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getInitialState(), slots: { player1: false, player2: false } });
    }

    exportRecord() {
        const initialBoard = this.openingBoard || this.board;

        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
                return {
            format: 'muzei',
            game: '洞围棋',
            gameId: 'hole-weiqi',
            boardSize: this.boardSize,
            komi: komiForSizeHole(this.boardSize),
            players: { player1: '', player2: '' },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
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
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        if (entry[1] === 'p') return { type: 'pass', player };
        const coords = entry.substring(1).split(',').map(Number);
        return { type: 'move', player, row: coords[0], col: coords[1] };
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId && data.gameId !== 'hole-weiqi' && data.game !== '洞围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要洞围棋棋谱）。' }));
            return;
        }
        if (data.boardSize && data.boardSize >= 7 && data.boardSize <= 31) {
            this.boardSize = data.boardSize;
            this.HOLE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        }
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.holes = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === -1) this.holes.push({ r, c });
            }
        }
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const moves = (data.moves || []).map(m => HoleWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'player1' ? 1 : 2;
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
            this.winner = HoleWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')) this.winner = data.result;
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
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 31) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {
            return false;
        }
        this.boardSize = newSize;
        this.HOLE_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, holes } = this.generateHolesAndBoard();
        this.board = board;
        this.holes = holes;
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
        room.gameLogic = new HoleWeiqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
