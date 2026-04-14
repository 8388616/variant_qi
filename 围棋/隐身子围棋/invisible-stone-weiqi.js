class InvisibleStoneWeiqiRoom {
    constructor(room, initialSize = 19) {
        this.room = room;
        this.boardSize = initialSize;
        this.board = this.emptyBoard();
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
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

    emptyBoard() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
    }

    emptyInvisible() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
    }

    copyBoard(src) { return src.map(row => row.slice()); }
    copyInvisible(src) { return src.map(row => row.slice()); }
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

    collectGroupCells(board, row, col) {
        const color = board[row][col];
        if (color === 0) return [];
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const out = [];
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        while (queue.length) {
            const [r, c] = queue.shift();
            out.push([r, c]);
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return out;
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

    diffRemovedStones(before, after) {
        const removed = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (before[r][c] !== 0 && after[r][c] === 0)
                    removed.push({ row: r, col: c, color: before[r][c] });
            }
        }
        return removed;
    }

    enemyCapturedAny(before, after, playerVal) {
        const enemy = 3 - playerVal;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (before[r][c] === enemy && after[r][c] === 0) return true;
            }
        }
        return false;
    }

    findMoveIndexForStoneAt(row, col, playerSlot) {
        for (let i = this.moveCoords.length - 1; i >= 0; i--) {
            const m = this.moveCoords[i];
            if (m.type === 'move' && m.player === playerSlot && m.row === row && m.col === col)
                return i;
        }
        return -1;
    }

    revealMoveAt(row, col, playerSlot) {
        const idx = this.findMoveIndexForStoneAt(row, col, playerSlot);
        if (idx >= 0 && this.moveCoords[idx].concealedFromOpponent)
            this.moveCoords[idx].concealedFromOpponent = false;
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
        const KOMI = 4.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    buildViewBoard(slot) {
        const out = this.emptyBoard();
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const v = this.board[r][c];
                if (v === 0) continue;
                if (this.invisible[r][c]) {
                    if (slot === null) {
                        continue;
                    } else if (slot === 'black') {
                        if (v === 1) out[r][c] = v;
                    } else {
                        if (v === 2) out[r][c] = v;
                    }
                } else {
                    out[r][c] = v;
                }
            }
        }
        return out;
    }

    buildInvisibleTint(slot) {
        const list = [];
        if (slot === null) return list;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === 0) continue;
                if (!this.invisible[r][c]) continue;
                if (slot === 'black' && this.board[r][c] === 1) {
                    list.push({ row: r, col: c });
                } else if (slot === 'white' && this.board[r][c] === 2) {
                    list.push({ row: r, col: c });
                }
            }
        }
        return list;
    }

    filterMoveCoordsForSlot(slot) {
        return this.moveCoords.map(m => {
            if (m.type !== 'move') return { ...m };
            if (slot === m.player)
                return { ...m };
            if (m.concealedFromOpponent)
                return { type: 'move', player: m.player, concealed: true };
            return { type: 'move', player: m.player, row: m.row, col: m.col, invisible: m.invisible };
        });
    }

    /** 对方与观战者不显示落在隐身子上的最后一手标记 */
    filterLastMoveMarkers(slot) {
        if (!this.lastMoveMarkers.length) return [];
        return this.lastMoveMarkers.filter(m => {
            const { row, col, color } = m;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return true;
            if (!this.invisible[row][col]) return true;
            if (slot === null) return false;
            const blackStone = color === 1;
            if (blackStone && slot === 'white') return false;
            if (!blackStone && slot === 'black') return false;
            return true;
        }).map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        return {
            boardSize: this.boardSize,
            board: this.buildViewBoard(slot),
            invisibleTint: this.buildInvisibleTint(slot),
            useServerBoard: true,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.filterLastMoveMarkers(slot),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.filterMoveCoordsForSlot(slot),
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
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
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
                }
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move': {
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const row = msg.row, col = msg.col;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const enemyVal = 3 - playerVal;

                if (this.board[row][col] !== 0) {
                    if (this.board[row][col] === enemyVal && this.invisible[row][col]) {
                        this.invisible[row][col] = false;
                        const enemySlot = enemyVal === 1 ? 'black' : 'white';
                        this.revealMoveAt(row, col, enemySlot);
                        this.broadcastState('invisibleReveal', { reason: 'hit', row, col });
                    }
                    return;
                }

                const oldBoard = this.copyBoard(this.board);
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                const nextHand = this.moveHistory.length + 1;
                const isInvisibleStone = nextHand >= 3 && nextHand % 3 === 0;

                this.board = this.copyBoard(newBoard);
                const removed = this.diffRemovedStones(oldBoard, this.board);
                for (const { row: rr, col: cc } of removed)
                    this.invisible[rr][cc] = false;

                for (const { row: rr, col: cc, color } of removed) {
                    const ps = color === 1 ? 'black' : 'white';
                    this.revealMoveAt(rr, cc, ps);
                }

                if (this.enemyCapturedAny(oldBoard, this.board, playerVal)) {
                    const group = this.collectGroupCells(this.board, row, col);
                    for (const [gr, gc] of group) {
                        if (this.invisible[gr][gc]) {
                            this.invisible[gr][gc] = false;
                            const ps = this.board[gr][gc] === 1 ? 'black' : 'white';
                            this.revealMoveAt(gr, gc, ps);
                        }
                    }
                }

                if (isInvisibleStone && this.board[row][col] === playerVal) {
                    this.invisible[row][col] = true;
                }

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    invisible: !!this.invisible[row][col],
                    concealedFromOpponent: !!(this.invisible[row][col])
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcastState('move');
                break;
            }

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
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
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
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
                if (!newGameOpponent) this.resetGame();
                else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) this.resetGame();
                else if (this.pendingNewGame && !msg.accept)
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
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
                if (!endOpponent) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept)
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept)
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
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
                        }
                    } else {
                        this.broadcast({ type: 'scoreRejected' });
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
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyInvisible.length > 0)
                this.historyInvisible.pop();
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) {
            this.board = this.emptyBoard();
            this.invisible = this.emptyInvisible();
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.invisible = this.copyInvisible(this.historyInvisible.at(-1));
        }
        this.broadcastState('undoAccept');
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = this.emptyBoard();
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
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

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '隐身子围棋',
            gameId: 'invisible-stone-weiqi',
            boardSize: this.boardSize,
            komi: 4.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                const inv = m.invisible ? 'i' : '';
                return p + m.row + ',' + m.col + inv;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = this.emptyBoard();
        this.invisible = this.emptyInvisible();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyInvisible = [];
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

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            let s = entry;
            let invisible = false;
            if (s.endsWith('i')) {
                invisible = true;
                s = s.slice(0, -1);
            }
            const coords = s.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1], invisible };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== 'invisible-stone-weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要隐身子围棋棋谱）。' }));
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
        const moves = rawMoves.map(InvisibleStoneWeiqiRoom.parseMove);
        const fromWeiqi = data.gameId === 'weiqi';
        let importHand = 0;
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                importHand++;
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcastPerClientReset();
                    return;
                }
                const oldBoard = this.copyBoard(this.board);
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcastPerClientReset();
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.board = this.copyBoard(newBoard);
                const removed = this.diffRemovedStones(oldBoard, this.board);
                for (const { row: rr, col: cc } of removed)
                    this.invisible[rr][cc] = false;
                for (const { row: rr, col: cc, color } of removed) {
                    const ps = color === 1 ? 'black' : 'white';
                    this.revealMoveAt(rr, cc, ps);
                }
                if (this.enemyCapturedAny(oldBoard, this.board, playerVal)) {
                    const group = this.collectGroupCells(this.board, row, col);
                    for (const [gr, gc] of group) {
                        if (this.invisible[gr][gc]) {
                            this.invisible[gr][gc] = false;
                            const ps = this.board[gr][gc] === 1 ? 'black' : 'white';
                            this.revealMoveAt(gr, gc, ps);
                        }
                    }
                }
                const wantInv = fromWeiqi
                    ? (importHand >= 3 && importHand % 3 === 0)
                    : !!move.invisible;
                if (wantInv && this.board[row][col] === playerVal)
                    this.invisible[row][col] = true;

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                const concealed = !!(this.invisible[row][col]);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    invisible: concealed,
                    concealedFromOpponent: concealed
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                importHand++;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyInvisible.push(this.copyInvisible(this.invisible));
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
        room.gameLogic = new InvisibleStoneWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
