class RandomInstabilityWuziqiRoom {
    constructor(room) {
        this.room = room;
        this.BOARD_SIZE = 9;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.nextLifetimePreview = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.generateNextPreview();
    }

    generateNextPreview() {
        const base = 5 + 0.05 * this.moveCount;
        const raw = base * Math.random() + 0.05 * this.moveCount;
        let lifetime = 2 * Math.floor(raw) + 5;
        this.nextLifetimePreview = Math.max(5, lifetime);
    }

    decrementLifetimesAndRemove() {
        let changed = false;
        for (let i = 0; i < this.BOARD_SIZE; i++) {
            for (let j = 0; j < this.BOARD_SIZE; j++) {
                if (this.lifetimes[i][j] > 0) {
                    this.lifetimes[i][j]--;
                    if (this.lifetimes[i][j] === 0) {
                        this.board[i][j] = 0;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    getMoveCount() {
        return this.moveLog.length;
    }

    checkWin(row, col, colorVal) {
        if (this.board[row][col] !== colorVal) return false;
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                let nr = row + dx * step, nc = col + dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                let nr = row - dx * step, nc = col - dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    isDraw() {
        for (let i = 0; i < this.BOARD_SIZE; i++) {
            for (let j = 0; j < this.BOARD_SIZE; j++) {
                if (this.board[i][j] === 0) return false;
            }
        }
        return true;
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            lifetimes: this.lifetimes,
            currentPlayer: this.currentPlayer,
            moveCount: this.moveCount,
            nextLifetimePreview: this.nextLifetimePreview,
            gameOver: this.gameOver,
            winner: this.winner,
            lastMoveMarkers: this.lastMoveMarkers,
            moveLog: this.moveLog.map(m => ({ ...m })),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    assignSlot(ws, requestedSlot) {
        const room = this.room;
        if (requestedSlot === 'black' && !room.getPlayerBySlot('black'))
            return 'black';
        else if (requestedSlot === 'white' && !room.getPlayerBySlot('white'))
            return 'white';
        return null;
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    sendState(ws) {
        ws.send(JSON.stringify({
            type: 'gameState',
            ...this.getState()
        }));
    }

    copyBoard(src) {
        return src.map(row => row.slice());
    }

    copyLifetimes(src) {
        return src.map(row => row.slice());
    }

    static encodeMove(m) {
        const h = m.player === 'black' ? 'B' : 'W';
        return `${h}${m.row},${m.col},${m.lifetime}`;
    }

    /** @returns {{ player: string, row: number, col: number, lifetime: number, nextPreview?: number|null } | null} */
    static parseMoveEntry(entry) {
        if (entry && typeof entry === 'object' && entry.player) {
            return {
                player: entry.player,
                row: entry.row,
                col: entry.col,
                lifetime: entry.lifetime,
                nextPreview: entry.nextPreview != null ? entry.nextPreview : null
            };
        }
        if (typeof entry !== 'string' || entry.length < 2) return null;
        const head = entry[0];
        if (head !== 'B' && head !== 'W') return null;
        const player = head === 'B' ? 'black' : 'white';
        const parts = entry.slice(1).split(',');
        if (parts.length < 3) return null;
        const row = +parts[0];
        const col = +parts[1];
        const lifetime = +parts[2];
        const nextPreview = parts.length >= 4 ? +parts[3] : null;
        if (!Number.isFinite(row) || !Number.isFinite(col) || !Number.isFinite(lifetime)) return null;
        return { player, row, col, lifetime, nextPreview: Number.isFinite(nextPreview) ? nextPreview : null };
    }

    buildSnapshotsFromMoves(moves, openingPreview, boardSize) {
        const size = boardSize;
        const snapshots = [];
        let board = Array(size).fill().map(() => Array(size).fill(0));
        let lifetimes = Array(size).fill().map(() => Array(size).fill(0));
        let currentPlayer = 'black';
        let moveCount = 0;
        const norm = (e) => RandomInstabilityWuziqiRoom.parseMoveEntry(e);
        let nextPreview;
        if (moves.length > 0) {
            const m0 = norm(moves[0]);
            if (!m0) return null;
            nextPreview = m0.lifetime;
        } else {
            nextPreview = openingPreview;
        }
        let lastMoveMarkers = [];

        snapshots.push({
            board: board.map(r => r.slice()),
            lifetimes: lifetimes.map(r => r.slice()),
            currentPlayer,
            moveCount,
            nextLifetimePreview: nextPreview,
            lastMoveMarkers: [],
            gameOver: false,
            winner: null
        });

        for (let i = 0; i < moves.length; i++) {
            const m = norm(moves[i]);
            if (!m) return null;
            const slot = m.player;
            if (slot !== currentPlayer) return null;
            const lifetimePlaced = m.lifetime;
            if (lifetimePlaced !== nextPreview) return null;

            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (lifetimes[r][c] > 0) {
                        lifetimes[r][c]--;
                        if (lifetimes[r][c] === 0) board[r][c] = 0;
                    }
                }
            }

            const playerVal = slot === 'black' ? 1 : 2;
            board[m.row][m.col] = playerVal;
            lifetimes[m.row][m.col] = lifetimePlaced;
            lastMoveMarkers = [{ row: m.row, col: m.col, color: playerVal }];

            let gameOver = false;
            let winner = null;
            if (this._checkWinBoard(board, m.row, m.col, playerVal, size)) {
                gameOver = true;
                winner = slot;
            } else {
                let full = true;
                for (let r = 0; r < size && full; r++)
                    for (let c = 0; c < size; c++)
                        if (board[r][c] === 0) { full = false; break; }
                if (full) {
                    gameOver = true;
                    winner = 'draw';
                }
            }

            if (gameOver) {
                snapshots.push({
                    board: board.map(r => r.slice()),
                    lifetimes: lifetimes.map(r => r.slice()),
                    currentPlayer: slot,
                    moveCount,
                    nextLifetimePreview: null,
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                    gameOver: true,
                    winner
                });
                break;
            }

            currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
            moveCount++;
            if (i + 1 < moves.length) {
                const mn = norm(moves[i + 1]);
                if (!mn) return null;
                nextPreview = mn.lifetime;
            } else {
                nextPreview = m.nextPreview != null ? m.nextPreview : null;
            }

            snapshots.push({
                board: board.map(r => r.slice()),
                lifetimes: lifetimes.map(r => r.slice()),
                currentPlayer,
                moveCount,
                nextLifetimePreview: nextPreview,
                lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                gameOver: false,
                winner: null
            });
        }
        return snapshots;
    }

    _checkWinBoard(board, row, col, colorVal, BOARD_SIZE) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                let nr = row + dx * step, nc = col + dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                let nr = row - dx * step, nc = col - dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    exportRecord() {
        const moves = this.moveLog.map(m => RandomInstabilityWuziqiRoom.encodeMove(m));
        const openPv = this.moveLog.length > 0 ? this.moveLog[0].previewBefore : this.nextLifetimePreview;
        return {
            format: 'muzei',
            version: 2,
            gameType: '随机不稳定五子棋',
            gameId: 'random-instability-wuziqi',
            boardSize: this.BOARD_SIZE,
            openingPreview: openPv,
            moves,
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.generateNextPreview();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变棋盘大小。' }));
            return false;
        }
        this.BOARD_SIZE = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'random-instability-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要随机不稳定五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        const rawMoves = data.moves || [];
        this.BOARD_SIZE = newSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];

        if (rawMoves.length > 0) {
            const m0 = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[0]);
            if (!m0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱第 1 手无法解析' }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (data.openingPreview != null && data.openingPreview !== m0.lifetime) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱 openingPreview 与第一手寿命不一致' }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.nextLifetimePreview = m0.lifetime;
        } else if (data.openingPreview != null) {
            this.nextLifetimePreview = data.openingPreview;
        } else {
            this.generateNextPreview();
        }

        for (let i = 0; i < rawMoves.length; i++) {
            const m = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[i]);
            if (!m) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手无法解析` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = m.player;
            if (slot !== this.currentPlayer) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 步行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (m.lifetime !== this.nextLifetimePreview) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手寿命预览与记录不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const previewBefore = this.nextLifetimePreview;
            this.historyBoards.push(this.copyBoard(this.board));
            this.historyLifetimes.push(this.copyLifetimes(this.lifetimes));

            this.decrementLifetimesAndRemove();

            const { row, col } = m;
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE || this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手落点非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const playerVal = slot === 'black' ? 1 : 2;
            this.board[row][col] = playerVal;
            this.lifetimes[row][col] = this.nextLifetimePreview;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];

            const lifetimeUsed = previewBefore;

            if (this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: null
                });
                break;
            }
            if (this.isDraw()) {
                this.gameOver = true;
                this.winner = 'draw';
                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: null
                });
                break;
            }

            this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
            this.moveCount++;

            let np = null;
            if (i + 1 < rawMoves.length) {
                const mn = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[i + 1]);
                if (!mn) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 2} 手无法解析` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                np = mn.lifetime;
            }
            if (m.nextPreview != null && np != null && m.nextPreview !== np) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手下一手寿命与记录不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (np != null) {
                this.nextLifetimePreview = np;
            } else {
                this.generateNextPreview();
            }
            const loggedNext = np != null ? np : this.nextLifetimePreview;

            this.moveLog.push({
                player: slot,
                row,
                col,
                lifetime: lifetimeUsed,
                previewBefore,
                nextPreview: loggedNext
            });
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        let snapshots = this.buildSnapshotsFromMoves(rawMoves, data.openingPreview, this.BOARD_SIZE);
        if (!snapshots) snapshots = [];

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: { snapshots }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
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

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== this.currentPlayer) return;

                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                const previewBefore = this.nextLifetimePreview;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyLifetimes.push(this.copyLifetimes(this.lifetimes));

                this.decrementLifetimesAndRemove();

                const playerVal = slot === 'black' ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lifetimes[row][col] = this.nextLifetimePreview;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                const lifetimeUsed = previewBefore;

                if (this.checkWin(row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = slot;
                    this.moveLog.push({
                        player: slot,
                        row,
                        col,
                        lifetime: lifetimeUsed,
                        previewBefore,
                        nextPreview: null
                    });
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        board: this.board,
                        lifetimes: this.lifetimes,
                        currentPlayer: this.currentPlayer,
                        moveCount: this.moveCount,
                        nextLifetimePreview: this.nextLifetimePreview,
                        lastMoveMarkers: this.lastMoveMarkers,
                        gameOver: true,
                        winner: this.winner
                    });
                    return;
                }

                if (this.isDraw()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.moveLog.push({
                        player: slot,
                        row,
                        col,
                        lifetime: lifetimeUsed,
                        previewBefore,
                        nextPreview: null
                    });
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        board: this.board,
                        lifetimes: this.lifetimes,
                        currentPlayer: this.currentPlayer,
                        moveCount: this.moveCount,
                        nextLifetimePreview: this.nextLifetimePreview,
                        lastMoveMarkers: this.lastMoveMarkers,
                        gameOver: true,
                        winner: 'draw'
                    });
                    return;
                }

                this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                this.moveCount++;
                this.generateNextPreview();
                const np = this.nextLifetimePreview;

                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: np
                });

                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: this.board,
                    lifetimes: this.lifetimes,
                    currentPlayer: this.currentPlayer,
                    moveCount: this.moveCount,
                    nextLifetimePreview: this.nextLifetimePreview,
                    lastMoveMarkers: this.lastMoveMarkers,
                    gameOver: false
                });
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!undoOpponent) {
                    if (this.historyBoards.length > 0) {
                        this.board = this.copyBoard(this.historyBoards.pop());
                        this.lifetimes = this.copyLifetimes(this.historyLifetimes.pop());
                        this.moveLog.pop();
                        this.lastMoveMarkers = [];
                        this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                        this.moveCount--;
                        this.generateNextPreview();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: this.board,
                            lifetimes: this.lifetimes,
                            currentPlayer: this.currentPlayer,
                            moveCount: this.moveCount,
                            nextLifetimePreview: this.nextLifetimePreview,
                            lastMoveMarkers: this.lastMoveMarkers
                        });
                    }
                    return;
                }
                this.pendingUndo = ws;
                undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                break;

            case 'undoResponse':
                if (this.pendingUndo && this.historyBoards.length > 0) {
                    if (msg.accept) {
                        this.board = this.copyBoard(this.historyBoards.pop());
                        this.lifetimes = this.copyLifetimes(this.historyLifetimes.pop());
                        this.moveLog.pop();
                        this.lastMoveMarkers = [];
                        this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                        this.moveCount--;
                        this.generateNextPreview();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: this.board,
                            lifetimes: this.lifetimes,
                            currentPlayer: this.currentPlayer,
                            moveCount: this.moveCount,
                            nextLifetimePreview: this.nextLifetimePreview,
                            lastMoveMarkers: this.lastMoveMarkers
                        });
                    } else {
                        this.pendingUndo.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                    }
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: slot,
                    winner: this.winner
                });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                    return;
                }
                this.pendingNewGame = ws;
                newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept)
                    this.resetGame();
                else if (this.pendingNewGame && !msg.accept)
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局。' }));
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'drawAgreed', winner: 'draw' });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw) {
                    if (msg.accept) {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.broadcast({ type: 'drawAgreed', winner: 'draw' });
                    } else {
                        this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                    }
                }
                this.pendingDraw = null;
                break;

            default:
                break;
        }
    }

    resetGame() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.generateNextPreview();

        const room = this.room;
        for (let [client, slot] of room.players.entries()) {
            room.slotOccupancy.delete(slot);
            room.players.delete(client);
            room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({
            type: 'newGameStarted',
            board: this.board,
            boardSize: this.BOARD_SIZE,
            lifetimes: this.lifetimes,
            currentPlayer: this.currentPlayer,
            moveCount: this.moveCount,
            nextLifetimePreview: this.nextLifetimePreview,
            slots: { black: false, white: false }
        });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) {
            this.room.broadcast({ type: 'playerLeft', slot });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new RandomInstabilityWuziqiRoom(room);
        room.maxPlayers = 2;
    }
};
