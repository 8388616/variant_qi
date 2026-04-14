class UkrainianWeiqiRoom {
    constructor(room) {
        this.room = room;
        this.boardSize = 19;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCoords = [];
        this.currentPlayer = 1; // 1 黑 2 白
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];          // 每步的槽位 black/white（含虚着）
        this.historyMarkers = [];       // 每步的 lastMoveMarkers
        this.historyLastUsed = [];     // 每步后的 lastUsedShapeByColor
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;

        // 五种复合棋子形状（相对参考点的偏移）
        this.SHAPES = [
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [0, 1], [1, -1]],
            [[-1, -1], [0, 1], [1, 0]],
            [[-1, -1], [1, -1], [-1, 1]]
        ];
    }

    // ================== 辅助函数 ==================
    copyBoard(src) { return src.map(row => row.slice()); }
    boardToString(board) { return board.map(row => row.join(',')).join(';'); }

    // 旋转、翻折变换相对偏移
    transformCoords(baseCoords, rot, flip) {
        return baseCoords.map(([dr, dc]) => {
            let r = dr, c = dc;
            for (let i = 0; i < rot; i++) { [r, c] = [-c, r]; }
            if (flip) c = -c;
            return [r, c];
        });
    }

    // 由形状与参考点生成盘上三子坐标
    generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol) {
        const base = this.SHAPES[shapeIdx];
        const transformed = this.transformCoords(base, rot, flip);
        return transformed.map(([dr, dc]) => [refRow + dr, refCol + dc]);
    }

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
                    liberties.add(`${nr},${nc}`);
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

    tryPlaceShape(boardBefore, shapeIdx, rot, flip, refRow, refCol, playerVal) {
        const coords = this.generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol);
        if (!coords) return null;
        // 三子必须在棋盘内且为空
        for (let [r, c] of coords) {
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }

        const newBoard = this.copyBoard(boardBefore);
        // 放置三子
        for (let [r, c] of coords) newBoard[r][c] = playerVal;

        // 邻接敌方块：无气则提
        const affectedEnemy = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of coords)
        {
            for (let [dr, dc] of dirs)
            {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal)
                {
                    affectedEnemy.add(`${nr},${nc}`);
                }
            }
        }

        for (let key of affectedEnemy)
        {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }

        for (let [r, c] of coords)
        {
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }

        return newBoard;
    }

    tryPlaceStonesAt(boardBefore, stoneCoords, playerVal) {
        if (!stoneCoords || stoneCoords.length === 0) return null;
        for (let [r, c] of stoneCoords) {
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }
        const newBoard = this.copyBoard(boardBefore);
        for (let [r, c] of stoneCoords) newBoard[r][c] = playerVal;

        const affectedEnemy = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of stoneCoords) {
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal)
                    affectedEnemy.add(`${nr},${nc}`);
            }
        }
        for (let key of affectedEnemy) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }
        for (let [r, c] of stoneCoords) {
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }
        return newBoard;
    }

    inferShapeIndexFromStones(stones) {
        if (!stones || stones.length !== 3) return -1;
        const norm = (arr) => [...arr].map(([r, c]) => `${r},${c}`).sort().join('|');
        const target = norm(stones);
        for (let shapeIdx = 0; shapeIdx < this.SHAPES.length; shapeIdx++) {
            for (let rot = 0; rot < 4; rot++) {
                for (let flip of [false, true]) {
                    const t = this.transformCoords(this.SHAPES[shapeIdx], rot, flip);
                    for (let refR = 0; refR < this.boardSize; refR++) {
                        for (let refC = 0; refC < this.boardSize; refC++) {
                            const placed = t.map(([dr, dc]) => [refR + dr, refC + dc]);
                            if (placed.some(([r, c]) => r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize)) continue;
                            if (norm(placed) === target) return shapeIdx;
                        }
                    }
                }
            }
        }
        return -1;
    }

    // ================== 形势判断（空点按曼哈顿距离归属最近棋子；中央≤4、边角≤5） ==================
    assignTerritoryWithRange(board) {
        const n = this.boardSize;
        const territory = Array(n).fill().map(() => Array(n).fill(0));
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= n - 2 || c <= 1 || c >= n - 2) ? 5 : 4;
                let blackMin = Infinity, whiteMin = Infinity;
                for (let sr = 0; sr < n; sr++) {
                    for (let sc = 0; sc < n; sc++) {
                        const v = board[sr][sc];
                        if (v !== 1 && v !== 2) continue;
                        const d = Math.abs(r - sr) + Math.abs(c - sc);
                        if (v === 1 && d < blackMin) blackMin = d;
                        else if (v === 2 && d < whiteMin) whiteMin = d;
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
        const territory = this.assignTerritoryWithRange(this.board);
        const { blackTotal, whiteTotal } = this.computeScore(this.board, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    // ================== 状态 ==================
    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            lastUsedShapeByColor: this.lastUsedShapeByColor,
            moveCoords: this.moveCoords,
            komi: 3.25,
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

    // 悔棋执行
    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                const lastBoardStr = this.boardToString(this.historyBoards[this.historyBoards.length - 1]);
                this.historyBoardSet.delete(lastBoardStr);
                this.historyBoards.pop();
            }
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.historyLastUsed.length > 0) this.lastUsedShapeByColor = this.historyLastUsed.pop();
            else this.lastUsedShapeByColor = { 1: -1, 2: -1 };
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        } else {
            this.board = this.copyBoard(this.historyBoards[this.historyBoards.length - 1]);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用。' }));
                }
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { shapeIndex, rotation, flipped, row, col } = msg;
                if (shapeIndex === undefined || rotation === undefined || flipped === undefined || row === undefined || col === undefined) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                if (this.lastUsedShapeByColor[playerVal] === shapeIndex) {
                    return;
                }
                const newBoard = this.tryPlaceShape(this.board, shapeIndex, rotation, flipped, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                } 
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push([...this.lastMoveMarkers]);
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.board = newBoard;
                const coords = this.generatePlacementCoords(shapeIndex, rotation, flipped, row, col);
                const stoneList = coords.map(([r, c]) => [r, c]);
                this.moveCoords.push({ type: 'move', player: slot, stones: stoneList });
                this.lastMoveMarkers = coords.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                this.lastUsedShapeByColor[playerVal] = shapeIndex;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const passPlayerVal = this.currentPlayer === 1 ? 1 : 2;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(this.boardToString(this.board));
                this.historyMarkers.push([...this.lastMoveMarkers]);
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastUsedShapeByColor[passPlayerVal] = -1;
                this.currentPlayer = 3 - this.currentPlayer;
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
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
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
                if (!opponent) {
                    this.performUndo(steps, ws);
                } else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo && msg.accept) {
                    this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
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
                    this.pendingScore.agreed.add(ws);
                    if (this.pendingScore.agreed.size === 2) {
                        const lead = this.scoreProposalData.lead;
                        this.gameOver = true;
                        this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                        this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    } else if (!msg.accept) {
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

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

            default:
                break;
        }
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '乌克兰围棋',
            gameId: 'ukrainian-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                return p + m.stones.map(([r, c]) => `${r},${c}`).join(';');
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
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
        if (typeof entry === 'object' && entry !== null) return entry;
        const s = entry;
        const player = s[0] === 'B' ? 'black' : 'white';
        if (s[1] === 'p') return { type: 'pass', player };
        const rest = s.slice(1);
        const parts = rest.split(';').filter(Boolean);
        const stones = parts.map(part => {
            const [r, c] = part.split(',').map(Number);
            return [r, c];
        });
        return { type: 'move', player, stones };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'ukrainian-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要乌克兰围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
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
        const moves = rawMoves.map(UkrainianWeiqiRoom.parseMove);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;

            if (move.type === 'move') {
                const stones = move.stones;
                if (!stones || stones.length === 0) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手缺少坐标` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                for (const [r, c] of stones) {
                    if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                }
                if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不一致` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStonesAt(this.board, stones, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push([...this.lastMoveMarkers]);
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, stones: stones.map(([r, c]) => [r, c]) });
                this.board = newBoard;
                this.lastMoveMarkers = stones.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                const si = this.inferShapeIndexFromStones(stones);
                this.lastUsedShapeByColor[playerVal] = si >= 0 ? si : -1;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手虚着方不一致` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(this.boardToString(this.board));
                this.historyMarkers.push([...this.lastMoveMarkers]);
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastUsedShapeByColor[playerVal] = -1;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
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
                moves: this.moveCoords.map(m => {
                    if (m.type === 'pass') return { type: 'pass', player: m.player };
                    return { type: 'move', player: m.player, stones: m.stones.map(([r, c]) => [r, c]) };
                })
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new UkrainianWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
