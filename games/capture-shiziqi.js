const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, squareWeiqiRules, qiBoardSeatOverlay } = require('../common');

class CaptureShiziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 19;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
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

    checkTenInRow(board, row, col, colorVal) {
        if (board[row][col] !== colorVal) return false;
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (const [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 10; step++) {
                const nr = row + dx * step;
                const nc = col + dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 10; step++) {
                const nr = row - dx * step;
                const nc = col - dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 10) return true;
        }
        return false;
    }

    wireMoveCoords() {
        return this.moveHistory.map(m => ({
            type: 'move',
            player: m.player,
            row: m.row,
            col: m.col
        }));
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
            moveHistory: this.moveHistory.map(m => ({ player: m.player, row: m.row, col: m.col })),
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
            gameType: '提子十字棋',
            gameId: 'capture-qiziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveHistory.map(m => `${(m.player === 'player1' ? 'B' : 'W')}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
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
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
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
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'capture-qiziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要提子十字棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
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
                const coords = entry.substring(1).split(',').map(Number);
                entry = { player, row: coords[0], col: coords[1] };
            }
            const { row, col, player } = entry;
            const slot = player;
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
            if (slot !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
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
            const boardBefore = this.copyBoard(this.board);
            const boardAfterPlacement = this.copyBoard(this.board);
            boardAfterPlacement[row][col] = playerVal;
            this.historyBoards.push(boardBefore);
            this.moveHistory.push({ player: slot, row, col });
            this.lastMoveMarkers = [{ row, col, color: playerVal }];

            if (this.checkTenInRow(boardAfterPlacement, row, col, playerVal)) {
                this.board = boardAfterPlacement;
                this.historyBoardSet.add(this.boardToString(this.board));
                this.gameOver = true;
                this.winner = slot;
                break;
            }

            const boardAfterCapture = squareWeiqiRules.tryPlaceStoneNLiberty(
                this.board, row, col, playerVal, this.BOARD_SIZE, (b) => this.copyBoard(b), 1
            );
            const boardStr = this.boardToString(boardAfterCapture);
            if (this.historyBoardSet.has(boardStr)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手触发禁全同。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.board = boardAfterCapture;
            this.historyBoardSet.add(boardStr);

            if (squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE)) {
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
                moves: this.moveHistory.map(m => `${(m.player === 'player1' ? 'B' : 'W')}${m.row},${m.col}`)
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
            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const boardBefore = this.copyBoard(this.board);
                const boardAfterPlacement = this.copyBoard(this.board);
                boardAfterPlacement[row][col] = playerVal;

                this.historyBoards.push(boardBefore);
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player: slot, row, col });

                if (this.checkTenInRow(boardAfterPlacement, row, col, playerVal)) {
                    this.board = boardAfterPlacement;
                    this.historyBoardSet.add(this.boardToString(this.board));
                    this.gameOver = true;
                    this.winner = slot;
                    this.recordResultText = slot === 'player1' ? '黑中盘胜' : '白中盘胜';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                const boardAfterCapture = squareWeiqiRules.tryPlaceStoneNLiberty(
                    this.board, row, col, playerVal, this.BOARD_SIZE, (b) => this.copyBoard(b), 1
                );
                const boardStr = this.boardToString(boardAfterCapture);
                if (this.historyBoardSet.has(boardStr)) {
                    this.historyBoards.pop();
                    this.lastMoveMarkers = [];
                    this.moveHistory.pop();
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                this.board = boardAfterCapture;
                this.historyBoardSet.add(boardStr);

                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this._syncClockAfterTurnChange();

                if (squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE)) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;
            }
            case 'requestUndo':
                qiProtocol.undoWuziqiHistory(this, ws, msg, slot);
                break;
            case 'undoResponse':
                qiProtocol.undoResponseWuziqiHistory(this, ws, msg);
                this.historyBoardSet = new Set();
                for (const b of this.historyBoards) this.historyBoardSet.add(this.boardToString(b));
                this.historyBoardSet.add(this.boardToString(this.board));
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
        this.historyBoardSet = new Set();
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
        for (let [client, seat] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(seat);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: seat }));
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
        room.gameLogic = new CaptureShiziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
