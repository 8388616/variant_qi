const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, qiBoardSeatOverlay } = require('../common');

class WuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
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
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
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
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }

    checkWin(row, col, colorVal) {
        return squareWuziqiRules.checkFiveInRow(this.board, row, col, colorVal, this.BOARD_SIZE);
    }

    isBoardFull() {
        return squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE);
    }

    _trailingPassCount() {
        let n = 0;
        for (let i = this.moveHistory.length - 1; i >= 0; i--) {
            if (this.moveHistory[i].type === 'pass') n++;
            else break;
        }
        return n;
    }

    wireMoveCoords() {
        return this.moveHistory.map(m => {
            if (m.type === 'pass') return { type: 'pass', player: m.player };
            return { type: 'move', player: m.player, row: m.row, col: m.col };
        });
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveHistory: this.moveHistory.map(m => (
                m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, row: m.row, col: m.col }
            )),
            moveCoords: this.wireMoveCoords(),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '五子棋',
            gameId: 'wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveHistory.map(m => {
                const p = (m.player === 'player1' ? 'B' : 'W');
                return m.type === 'pass' ? `${p}p` : `${p}${m.row},${m.col}`;
            }),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数。' }));
            return false;
        }
        this.BOARD_SIZE = newSize;
        this.resetToEmpty();
        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            this.tcSettings = tc.enabled ? {
                timed: true,
                mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
            } : { timed: false };
            this.matchStarted = true;
        }
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 13;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.BOARD_SIZE = newSize;
        this.resetToEmpty();

        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            if (typeof entry === 'string') {
                const player = entry[0] === 'B' ? 'player1' : 'player2';
                if (entry.length >= 2 && entry[1] === 'p') {
                    entry = { type: 'pass', player };
                } else {
                    const coords = entry.substring(1).split(',').map(Number);
                    entry = { player, row: coords[0], col: coords[1] };
                }
            }
            const slot = entry.player;
            const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
            if (slot !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (entry.type === 'pass') {
                this.lastMoveMarkers = [];
                this.moveHistory.push({ type: 'pass', player: slot });
                this.historyBoards.push(this.copyBoard(this.board));
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    break;
                }
                continue;
            }
            const { row, col } = entry;
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const playerVal = slot === 'player1' ? 1 : 2;
            this.board[row][col] = playerVal;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];
            this.moveHistory.push({ player: slot, row, col });
            this.historyBoards.push(this.copyBoard(this.board));

            if (this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                break;
            }
            if (this.isBoardFull()) {
                this.gameOver = true;
                this.winner = 'draw';
                break;
            }
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.result;
            if (String(data.result).includes('白胜') || data.result === 'player2') this.winner = 'player2';
            else if (String(data.result).includes('黑胜') || data.result === 'player1') this.winner = 'player1';
            else this.winner = 'draw';
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                moves: this.moveHistory.map(m => {
                    const p = (m.player === 'player1' ? 'B' : 'W');
                    return m.type === 'pass' ? `${p}p` : `${p}${m.row},${m.col}`;
                })
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);

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
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) {
                    return;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player: slot, row, col });

                if (this.checkWin(row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = slot;
                    this.recordResultText = slot === 'player1' ? '黑中盘胜' : '白中盘胜';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                this.historyBoards.push(this.copyBoard(this.board));
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this._syncClockAfterTurnChange();

                if (this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                this.lastMoveMarkers = [];
                this.moveHistory.push({ type: 'pass', player: slot });
                this.historyBoards.push(this.copyBoard(this.board));
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                    return;
                }
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                break;

            case 'requestUndo':
                qiProtocol.undoWuziqiHistory(this, ws, msg, slot);
                break;

            case 'undoResponse':
                qiProtocol.undoResponseWuziqiHistory(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot, {
                    onResignResolved: (winnerSlot) => {
                        this.recordResultText = winnerSlot === 'player1' ? '黑中盘胜' : '白中盘胜';
                        this._stopClockTicker();
                    }
                });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '和棋';
                        this._stopClockTicker();
                    }
                });
                break;

            default:
                break;
        }
    }

    resetGame() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.slotJoinedAt = { player1: null, player2: null };
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
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new WuziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
