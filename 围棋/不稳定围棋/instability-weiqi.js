/**
 * 不稳定围棋：空位落子为不稳定子（记录出生手数）；可落在己方不稳定子上将其变为稳定子。
 * 提子与标准围棋相同；每手结束后，出生手数 = 当前手数 − 不稳定寿命 的不稳定子被移除。
 * 寿命 = (0.1×路数×路数) 向上取为不小于该值的最小奇数。棋盘 7～21 路。
 */

class InstabilityWeiqiRoom
{
    constructor(room, initialSize = 19) {
        this.room = room;
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        /** 每手成功后的完整局面快照，用于悔棋 */
        this.historySnapshots = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
    }

    unstableLifetime() {
        const x = 0.1 * this.boardSize * this.boardSize;
        let c = Math.ceil(x);
        if (c % 2 === 0) c += 1;
        return c;
    }

    copyBoard(src) { return src.map(row => row.slice()); }

    stateToString(board, unstableInfo) {
        const rows = [];
        for (let r = 0; r < this.boardSize; r++) {
            const row = [];
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] === 0) {
                    row.push('0');
                } else {
                    const colorChar = board[r][c] === 1 ? 'B' : 'W';
                    if (unstableInfo[r][c] === 0)
                        row.push(colorChar + 'S');
                    else
                        row.push(colorChar + 'U' + unstableInfo[r][c]);
                }
            }
            rows.push(row.join(','));
        }
        return rows.join(';');
    }

    rebuildBornAt(unstableInfo) {
        const bornAt = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const b = unstableInfo[r][c];
                if (b !== 0)
                    bornAt[b] = [r, c];
            }
        }
        return bornAt;
    }

    hasLiberty(board, row, col) {
        const color = board[row][col];
        if (color === 0) return false;
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (board[nr][nc] === 0) return true;
                if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return false;
    }

    removeGroup(board, unstableInfo, bornAt, row, col, color) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const ub = unstableInfo[row][col];
        unstableInfo[row][col] = 0;
        if (ub !== 0)
            bornAt[ub] = null;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    const u2 = unstableInfo[nr][nc];
                    unstableInfo[nr][nc] = 0;
                    if (u2 !== 0)
                        bornAt[u2] = null;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    /**
     * 从当前局面应用一手；成功返回 { board, unstableInfo, moveCount }，失败返回 null。
     */
    applyPly(board, unstableInfo, moveCount, row, col, playerVal) {
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return null;

        const b = this.copyBoard(board);
        const u = this.copyBoard(unstableInfo);
        const bornAt = this.rebuildBornAt(u);

        if (b[row][col] !== 0) {
            if (u[row][col] === 0 || b[row][col] !== playerVal) return null;
            const born = u[row][col];
            if (bornAt[born] && bornAt[born][0] === row && bornAt[born][1] === col)
                bornAt[born] = null;
            b[row][col] = 0;
            u[row][col] = 0;
        }

        const newMoveCount = moveCount + 1;
        const wasReplaceOwnUnstable = board[row][col] !== 0;

        b[row][col] = playerVal;
        if (!wasReplaceOwnUnstable) {
            u[row][col] = newMoveCount;
            bornAt[newMoveCount] = [row, col];
        } else {
            u[row][col] = 0;
        }

        const enemy = 3 - playerVal;
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (b[i][j] === enemy && !this.hasLiberty(b, i, j))
                    this.removeGroup(b, u, bornAt, i, j, enemy);
            }
        }
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (b[i][j] === playerVal && !this.hasLiberty(b, i, j))
                    this.removeGroup(b, u, bornAt, i, j, playerVal);
            }
        }

        const life = this.unstableLifetime();
        const toDieBorn = newMoveCount - life;
        if (toDieBorn >= 0 && bornAt[toDieBorn]) {
            const [r, c] = bornAt[toDieBorn];
            if (r !== undefined && c !== undefined && b[r][c] !== 0 && u[r][c] === toDieBorn) {
                b[r][c] = 0;
                u[r][c] = 0;
                bornAt[toDieBorn] = null;
            }
        }

        return { board: b, unstableInfo: u, moveCount: newMoveCount };
    }

    applyPass(board, unstableInfo, moveCount) {
        const b = this.copyBoard(board);
        const u = this.copyBoard(unstableInfo);
        const bornAt = this.rebuildBornAt(u);
        const newMoveCount = moveCount + 1;
        const life = this.unstableLifetime();
        const toDieBorn = newMoveCount - life;
        if (toDieBorn >= 0 && bornAt[toDieBorn]) {
            const [r, c] = bornAt[toDieBorn];
            if (r !== undefined && c !== undefined && b[r][c] !== 0 && u[r][c] === toDieBorn) {
                b[r][c] = 0;
                u[r][c] = 0;
            }
        }
        return { board: b, unstableInfo: u, moveCount: newMoveCount };
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
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            unstableInfo: this.unstableInfo,
            moveCount: this.moveCount,
            unstableLifetime: this.unstableLifetime(),
            numberOfHands: this.moveCount + 1,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
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

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const result = this.applyPly(this.board, this.unstableInfo, this.moveCount, row, col, playerVal);
                if (!result) {
                    return;
                }
                const newStr = this.stateToString(result.board, result.unstableInfo);
                if (this.historyBoardSet.has(newStr)) 
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                } 
                this.historyBoardSet.add(newStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = result.board;
                this.unstableInfo = result.unstableInfo;
                this.moveCount = result.moveCount;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const passResult = this.applyPass(this.board, this.unstableInfo, this.moveCount);
                const passStr = this.stateToString(passResult.board, passResult.unstableInfo);
                if (this.historyBoardSet.has(passStr)) {
                    return;
                }
                this.historyBoardSet.add(passStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = passResult.board;
                this.unstableInfo = passResult.unstableInfo;
                this.moveCount = passResult.moveCount;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
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
                if (steps === 0 || steps > this.historySnapshots.length) {
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
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
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
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局。' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
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
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historySnapshots.length)
            return;

        for (let i = 0; i < steps; i++) {
            const popped = this.historySnapshots.pop();
            if (popped)
                this.historyBoardSet.delete(this.stateToString(popped.board, popped.unstableInfo));
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();
            if (this.historyMarkers.length > 0)
                this.historyMarkers.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historySnapshots.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.moveCount = 0;
            this.lastMoveMarkers = [];
        } else {
            const s = this.historySnapshots[this.historySnapshots.length - 1];
            this.board = this.copyBoard(s.board);
            this.unstableInfo = this.copyBoard(s.unstableInfo);
            this.moveCount = s.moveCount;
            if (this.moveCoords.length > 0) {
                const last = this.moveCoords[this.moveCoords.length - 1];
                if (last.type === 'move')
                    this.lastMoveMarkers = [{ row: last.row, col: last.col, color: last.player === 'black' ? 1 : 2 }];
                else
                    this.lastMoveMarkers = [];
            } else
                this.lastMoveMarkers = [];
        }

        this.passCounter = 0;
        for (const m of this.moveCoords) {
            if (m.type === 'pass')
                this.passCounter++;
            else
                this.passCounter = 0;
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        this.historySnapshots = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.moveCoords = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
        const toRelease = [...this.room.players.entries()];
        for (const [client, s] of toRelease) {
            this.room.players.delete(client);
            this.room.slotOccupancy.delete(s);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer)
            return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '不稳定围棋',
            gameId: 'instability-weiqi',
            boardSize: this.boardSize,
            unstableLifetime: this.unstableLifetime(),
            komi: 3.25,
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
        this.unstableInfo = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCount = 0;
        this.currentPlayer = 1;
        this.historySnapshots = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.stateToString(this.board, this.unstableInfo));
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
        if (!data || data.gameId !== 'instability-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要不稳定围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(InstabilityWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const r = this.applyPly(this.board, this.unstableInfo, this.moveCount, row, col, playerVal);
                if (!r) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newStr = this.stateToString(r.board, r.unstableInfo);
                if (this.historyBoardSet.has(newStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手违反禁全同。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoardSet.add(newStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = r.board;
                this.unstableInfo = r.unstableInfo;
                this.moveCount = r.moveCount;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
            } else if (move.type === 'pass') {
                const pr = this.applyPass(this.board, this.unstableInfo, this.moveCount);
                const passStr = this.stateToString(pr.board, pr.unstableInfo);
                if (this.historyBoardSet.has(passStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手虚着违反禁全同。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoardSet.add(passStr);
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.board = pr.board;
                this.unstableInfo = pr.unstableInfo;
                this.moveCount = pr.moveCount;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.historySnapshots.push({
                    board: this.copyBoard(this.board),
                    unstableInfo: this.copyBoard(this.unstableInfo),
                    moveCount: this.moveCount
                });
            }
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || { black: [], white: [] },
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveCoords.length;
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
        room.gameLogic = new InstabilityWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
