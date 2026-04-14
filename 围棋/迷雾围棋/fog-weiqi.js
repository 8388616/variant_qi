class FogWeiqiRoom {
    constructor(room, initialSize = 19) {
        this.room = room;
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
    }

    copyBoard(src) { return src.map(row => row.slice()); }
    boardToString(board) { return board.map(row => row.join(',')).join(';'); }

    countGroupLiberties(board, row, col) {
        const color = board[row][col];
        if (color === 0) return 0;
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (board[nr][nc] === 0) {
                    liberties.add(nr + ',' + nc);
                } else if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    }

    removeGroup(board, row, col, color) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;

        const enemyColor = 3 - playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (let [dr, dc] of dirs) {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === enemyColor) {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) {
                    checkedEnemy.add(key);
                    if (this.countGroupLiberties(newBoard, nr, nc) < 1) {
                        this.removeGroup(newBoard, nr, nc, enemyColor);
                    }
                }
            }
        }

        if (this.countGroupLiberties(newBoard, row, col) < 1)
            this.removeGroup(newBoard, row, col, playerVal);

        return newBoard;
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [dr, dc] of dirs) {
            const nr = libertyRow + dr, nc = libertyCol + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === opponentColor) return true;
        }
        return false;
    }

    removeDeadAndDying(srcBoard) {
        let boardCopy = this.copyBoard(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (let [dr, dc] of dirs) {
                                const nr = rr + dr, nc = cc + dc;
                                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (let [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= 2) {
                            let allControlled = true;
                            for (let lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (let [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    }

    assignTerritoryWithRange(liveBoard) {
        const territory = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= this.boardSize - 2 || c <= 1 || c >= this.boardSize - 2) ? 5 : 4;
                let blackMin = Infinity, whiteMin = Infinity;
                const dist = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (let [dr, dc] of dirs) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && liveBoard[nr][nc] !== -1 && dist[nr][nc] === Infinity) {
                            dist[nr][nc] = d + 1;
                            queue.push([nr, nc]);
                        }
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

    computeScore(liveBoard, territory) {
        let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
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
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize)
                            vis[nr][nc] = true;
                    }
                }
            }
        }
        return vis;
    }

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

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        const cleared = this.fogCleared();
        return {
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            board: cleared ? this.board : this.buildMaskedBoard(slot),
            fogMask: cleared ? this.emptyFogMask() : this.buildFogMask(slot),
            fogCleared: cleared,
            useServerBoard: true,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: cleared ? this.lastMoveMarkers : this.filterLastMoveMarkers(slot),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    broadcastState(action, extra = {}) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client.readyState !== 1) continue;
            const state = this.getStateForClient(client);
            client.send(JSON.stringify({ type: 'broadcast', action, ...state, ...extra }));
        }
    }

    broadcastFlat(payload, exclude = null) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client !== exclude && client.readyState === 1)
                client.send(JSON.stringify(payload));
        }
    }

    assignSlot(ws, requestedSlot) {
        if (requestedSlot === 'black' && !this.room.getPlayerBySlot('black')) return 'black';
        if (requestedSlot === 'white' && !this.room.getPlayerBySlot('white')) return 'white';
        return null;
    }

    broadcast(data, exclude = null) {
        this.broadcastFlat(data, exclude);
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    startScoreCounting(requester, opponent) {
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
                if (slot)
                    return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                }
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move':
                if (this.gameOver)
                    return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white'))
                    return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize)
                    return;
                if (this.board[row][col] !== 0) {
                    const playerVal = this.currentPlayer === 1 ? 1 : 2;
                    const enemyVal = 3 - playerVal;
                    if (this.board[row][col] === enemyVal)
                        ws.send(JSON.stringify({ type: 'error', message: '该处已有棋子。' }));
                    return;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard)
                    return;
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
                this.broadcastState('move');
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcastState('pass');
                if (this.passCounter >= 2) {
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
                if (!slot || this.gameOver)
                    return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
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
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcastState('resign', { player: slot, winner: this.winner });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                } else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcastState('drawAgreed');
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcastState('drawAgreed');
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
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
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this.broadcastState('scoreSettled');
                        }
                    } else {
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        this.broadcastState('scoreRejected');
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
                this.broadcastPerClientReset();
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
        if (steps === 0 || steps > this.historyBoards.length)
            return;

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
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcastState('undoAccept');
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
            version: 1,
            gameType: '迷雾围棋',
            gameId: 'fog-weiqi',
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            result: this.gameOver ? this.winner : null
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

        if (data.result) {
            this.gameOver = true;
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
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new FogWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
