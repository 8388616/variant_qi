class MatchWuziqiRoom {
    constructor(room) {
        this.room = room;
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = []; // only placements, for hand index
        this.recordActions = []; // placements + removals, for record import/export
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    copyBoard(src) { return src.map(row => row.slice()); }
    getCurrentSlot() { return this.currentPlayer === 1 ? 'black' : 'white'; }
    getOpponentVal(v) { return v === 1 ? 2 : 1; }

    createSnapshot() {
        return {
            board: this.copyBoard(this.board),
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map(m => ({ ...m })),
            moveHistory: this.moveHistory.map(m => ({ ...m })),
            recordActions: this.recordActions.map(a => ({ ...a })),
            gameOver: this.gameOver,
            winner: this.winner,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            pendingRemoval: this.pendingRemoval ? { ...this.pendingRemoval } : null,
            recentClearedStones: this.recentClearedStones.map(s => ({ ...s })),
            recentClearedOwner: this.recentClearedOwner
        };
    }

    restoreSnapshot(snap) {
        this.board = this.copyBoard(snap.board);
        this.currentPlayer = snap.currentPlayer;
        this.lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
        this.moveHistory = (snap.moveHistory || []).map(m => ({ ...m }));
        this.recordActions = (snap.recordActions || []).map(a => ({ ...a }));
        this.gameOver = !!snap.gameOver;
        this.winner = snap.winner ?? null;
        this.blackScore = snap.blackScore || 0;
        this.whiteScore = snap.whiteScore || 0;
        this.pendingRemoval = snap.pendingRemoval ? { ...snap.pendingRemoval } : null;
        this.recentClearedStones = (snap.recentClearedStones || []).map(s => ({ ...s }));
        this.recentClearedOwner = snap.recentClearedOwner || null;
    }

    collectLineCoords(row, col, dx, dy, colorVal) {
        const seq = [{ row, col }];
        for (let step = 1; step < this.BOARD_SIZE; step++) {
            const nr = row + dx * step;
            const nc = col + dy * step;
            if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
            seq.push({ row: nr, col: nc });
        }
        for (let step = 1; step < this.BOARD_SIZE; step++) {
            const nr = row - dx * step;
            const nc = col - dy * step;
            if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
            seq.unshift({ row: nr, col: nc });
        }
        return seq;
    }

    resolveScoringAfterPlacement(row, col, colorVal) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        let scoreGain = 0;
        const toRemove = new Set();
        for (const [dx, dy] of directions) {
            const seq = this.collectLineCoords(row, col, dx, dy, colorVal);
            if (seq.length >= 5) {
                scoreGain += (seq.length - 4);
                for (const p of seq) toRemove.add(`${p.row},${p.col}`);
            }
        }
        const removed = [];
        if (scoreGain > 0) {
            for (const key of toRemove) {
                const [r, c] = key.split(',').map(Number);
                this.board[r][c] = 0;
                removed.push({ row: r, col: c, color: colorVal });
            }
        }
        return { gain: scoreGain, removed };
    }

    countStones(stoneVal) {
        let n = 0;
        for (let r = 0; r < this.BOARD_SIZE; r++)
            for (let c = 0; c < this.BOARD_SIZE; c++)
                if (this.board[r][c] === stoneVal) n++;
        return n;
    }

    isBoardFull() {
        for (let r = 0; r < this.BOARD_SIZE; r++)
            for (let c = 0; c < this.BOARD_SIZE; c++)
                if (this.board[r][c] === 0) return false;
        return true;
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
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            pendingRemoval: this.pendingRemoval,
            recentClearedStones: this.recentClearedStones,
            actions: this.recordActions.map(a => ({ ...a })),
            moveHistory: this.moveHistory.map(m => ({ player: m.player, row: m.row, col: m.col })),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    assignSlot(ws, requestedSlot) {
        if (requestedSlot === 'black' && !this.room.getPlayerBySlot('black')) return 'black';
        if (requestedSlot === 'white' && !this.room.getPlayerBySlot('white')) return 'white';
        return null;
    }

    broadcast(data, exclude = null) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client !== exclude && client.readyState === 1) {
                client.send(JSON.stringify(data));
            }
        }
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getState() }));
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '消除五子棋',
            gameId: 'match-wuziqi',
            boardSize: this.BOARD_SIZE,
            actions: this.recordActions.map(a => ({ ...a })),
            moves: this.moveHistory.map(m => `${m.player[0].toUpperCase()}${m.row},${m.col}`), // legacy compatibility
            result: this.gameOver ? this.winner : null,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.recordActions = [];
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
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
        if (!data || data.gameId !== 'match-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要消除五子棋棋谱）。' }));
            return;
        }
        const newSize = Number(data.boardSize || 13);
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.BOARD_SIZE = newSize;
        this.resetToEmpty();

        let actions = [];
        if (Array.isArray(data.actions)) {
            actions = data.actions.map(a => ({ ...a }));
        } else if (Array.isArray(data.moves)) {
            actions = data.moves.map((entry) => {
                if (typeof entry === 'string') {
                    const player = entry[0] === 'B' ? 'black' : 'white';
                    const [row, col] = entry.substring(1).split(',').map(Number);
                    return { type: 'place', player, row, col };
                }
                return entry;
            });
        } else {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱缺少 actions 或 moves。' }));
            return;
        }

        for (let i = 0; i < actions.length; i++) {
            const a = actions[i] || {};
            const type = a.type || 'place';
            const row = Number(a.row);
            const col = Number(a.col);
            const player = a.player;
            if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条坐标无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (player !== 'black' && player !== 'white') {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条玩家无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            if (type === 'place') {
                const expect = this.getCurrentSlot();
                if (player !== expect) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条落子方与回合不符。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.pendingRemoval) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条应先移除对手棋子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.board[row][col] !== 0) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条落子点非空。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                const playerVal = player === 'black' ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player, row, col });
                this.recordActions.push({ type: 'place', player, row, col, hand: this.moveHistory.length });

                const { gain, removed } = this.resolveScoringAfterPlacement(row, col, playerVal);
                if (player === 'black') this.blackScore += gain;
                else this.whiteScore += gain;
                this.recentClearedStones = removed;
                this.recentClearedOwner = removed.length > 0 ? player : null;

                if (this.blackScore >= 32) {
                    this.gameOver = true;
                    this.winner = 'black';
                    break;
                }
                if (this.whiteScore >= 30) {
                    this.gameOver = true;
                    this.winner = 'white';
                    break;
                }

                if (gain > 0) {
                    const opponentVal = this.getOpponentVal(playerVal);
                    const canRemove = Math.min(1, this.countStones(opponentVal));
                    if (canRemove > 0) {
                        this.pendingRemoval = {
                            player,
                            remaining: canRemove,
                            total: canRemove,
                            removed: 0,
                            hand: this.moveHistory.length
                        };
                    } else {
                        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                    }
                } else {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                }
                if (!this.pendingRemoval && this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    break;
                }
            } else if (type === 'remove') {
                if (!this.pendingRemoval) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条移除动作时机错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (player !== this.pendingRemoval.player) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条移除方错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const playerVal = player === 'black' ? 1 : 2;
                const opponentVal = this.getOpponentVal(playerVal);
                if (this.board[row][col] !== opponentVal) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条移除点不是对手棋子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                this.board[row][col] = 0;
                this.pendingRemoval.remaining -= 1;
                this.pendingRemoval.removed += 1;
                this.recordActions.push({
                    type: 'remove',
                    player,
                    row,
                    col,
                    hand: this.pendingRemoval.hand,
                    index: this.pendingRemoval.removed
                });
                if (this.pendingRemoval.remaining <= 0) {
                    this.pendingRemoval = null;
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                }
            } else {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}条动作类型无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.historyBoards = [];
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                actions: this.recordActions.map(a => ({ ...a }))
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor': {
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用。' }));
                }
                break;
            }

            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱。' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            case 'move': {
                if (this.gameOver || this.pendingRemoval) return;
                if (!slot || slot !== this.getCurrentSlot()) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                this.historyBoards.push(this.createSnapshot());
                if (this.recentClearedStones.length > 0 && this.recentClearedOwner && this.recentClearedOwner !== slot) {
                    this.recentClearedStones = [];
                    this.recentClearedOwner = null;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player: slot, row, col });
                this.recordActions.push({ type: 'place', player: slot, row, col, hand: this.moveHistory.length });

                const { gain, removed } = this.resolveScoringAfterPlacement(row, col, playerVal);
                if (slot === 'black') this.blackScore += gain;
                else this.whiteScore += gain;
                this.recentClearedStones = removed;
                this.recentClearedOwner = removed.length > 0 ? slot : null;

                if (this.blackScore >= 32) {
                    this.gameOver = true;
                    this.winner = 'black';
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }
                if (this.whiteScore >= 30) {
                    this.gameOver = true;
                    this.winner = 'white';
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                if (gain > 0) {
                    const opponentVal = this.getOpponentVal(playerVal);
                    const canRemove = Math.min(1, this.countStones(opponentVal));
                    if (canRemove > 0) {
                        this.pendingRemoval = { player: slot, remaining: canRemove, total: canRemove, removed: 0, hand: this.moveHistory.length };
                    } else {
                        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                    }
                } else {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                }

                if (!this.pendingRemoval && this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;
            }

            case 'removeOpponent': {
                if (this.gameOver || !this.pendingRemoval) return;
                if (!slot || slot !== this.pendingRemoval.player) return;
                const row = msg.row;
                const col = msg.col;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                const playerVal = slot === 'black' ? 1 : 2;
                const opponentVal = this.getOpponentVal(playerVal);
                if (this.board[row][col] !== opponentVal) return;

                this.board[row][col] = 0;
                this.pendingRemoval.remaining -= 1;
                this.pendingRemoval.removed += 1;
                this.recordActions.push({
                    type: 'remove',
                    player: slot,
                    row,
                    col,
                    hand: this.pendingRemoval.hand,
                    index: this.pendingRemoval.removed
                });

                if (this.pendingRemoval.remaining <= 0) {
                    this.pendingRemoval = null;
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                }
                this.broadcast({ type: 'broadcast', action: 'remove', ...this.getState() });
                break;
            }

            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                const isMyTurn = (slot === 'black' && this.currentPlayer === 1) || (slot === 'white' && this.currentPlayer === 2);
                let steps = isMyTurn ? 2 : 1;
                if (this.pendingRemoval && slot === this.pendingRemoval.player) steps = 1;
                if (this.historyBoards.length < steps) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) {
                    for (let i = 0; i < steps; i++) this.restoreSnapshot(this.historyBoards.pop());
                    this.lastMoveMarkers = [];
                    this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                } else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse':
                if (this.pendingUndo && msg.accept) {
                    const steps = this.pendingUndo.steps;
                    if (this.historyBoards.length >= steps) {
                        for (let i = 0; i < steps; i++) this.restoreSnapshot(this.historyBoards.pop());
                        this.lastMoveMarkers = [];
                        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                    }
                } else if (this.pendingUndo && !msg.accept) {
                    this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame': {
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                } else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;
            }

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局。' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;
            }

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
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
        this.recordActions = [];
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        for (const [client, slot] of this.room.players.entries()) {
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
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new MatchWuziqiRoom(room);
        room.maxPlayers = 2;
    }
};
