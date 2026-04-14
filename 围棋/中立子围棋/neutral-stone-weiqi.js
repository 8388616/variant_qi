const crypto = require('crypto');

const NEUTRAL = 3;

class NeutralStoneWeiqiRoom
{
    constructor(room, initialSize = 19) {
        this.room = room;
        this.BOARD_SIZE = initialSize;
        this.NEUTRAL_COUNT = Math.floor(0.083 * this.BOARD_SIZE * this.BOARD_SIZE);
        const { board, initialNeutralStones } = this.generateNeutralStonesAndBoard();
        this.board = board;
        this.initialNeutralStones = initialNeutralStones;
        this.currentPlayer = 1;
        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet = new Set();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.moveCoords = [];
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.BOARD_SIZE / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    generateNeutralStonesAndBoard()
    {
        const MAX_ATTEMPTS = 100;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const points = [];
            for (let r = 0; r < this.BOARD_SIZE; r++) {
                for (let c = 0; c < this.BOARD_SIZE; c++) {
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
                }
            }
            const selected = [];
            const temp = [...points];
            for (let i = 0; i < this.NEUTRAL_COUNT && temp.length > 0; i++) {
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
            const board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
            for (let h of selected) board[h.r][h.c] = NEUTRAL;

            return { board, initialNeutralStones: selected.map(p => ({ r: p.r, c: p.c })) };
        }
        const points = [];
        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const selected = [];
        const temp = [...points];
        for (let i = 0; i < this.NEUTRAL_COUNT && temp.length > 0; i++) {
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
        const board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        for (let h of selected) board[h.r][h.c] = NEUTRAL;
        return { board, initialNeutralStones: selected.map(p => ({ r: p.r, c: p.c })) };
    }

    copyBoard(src) {
        return src.map(row => row.slice());
    }

    boardToString(board) {
        return board.map(row => row.join(',')).join(';');
    }

    hasLiberty(board, row, col) {
        const color = board[row][col];
        if (color === 0 || color === NEUTRAL) return false;
        const visited = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE) continue;
                if (board[nr][nc] === 0) return true;
                if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return false;
    }

    removeGroup(board, row, col, color) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    removeNeutralGroupsWithoutLiberty(board) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(false));
            for (let r = 0; r < this.BOARD_SIZE; r++) {
                for (let c = 0; c < this.BOARD_SIZE; c++) {
                    if (board[r][c] !== NEUTRAL || visited[r][c]) continue;
                    const queue = [[r, c]];
                    visited[r][c] = true;
                    const stones = [[r, c]];
                    let hasLiberty = false;
                    let qi = 0;
                    while (qi < queue.length) {
                        const [cr, cc] = queue[qi++];
                        for (let [dr, dc] of dirs) {
                            const nr = cr + dr, nc = cc + dc;
                            if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE) continue;
                            if (board[nr][nc] === 0) hasLiberty = true;
                            else if (board[nr][nc] === NEUTRAL && !visited[nr][nc]) {
                                visited[nr][nc] = true;
                                queue.push([nr, nc]);
                                stones.push([nr, nc]);
                            }
                        }
                    }
                    if (!hasLiberty) {
                        for (const [gr, gc] of stones) board[gr][gc] = 0;
                        changed = true;
                    }
                }
            }
        }
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [dr, dc] of dirs) {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && newBoard[nr][nc] === 3 - playerVal) {
                if (!this.hasLiberty(newBoard, nr, nc)) {
                    this.removeGroup(newBoard, nr, nc, 3 - playerVal);
                }
            }
        }
        this.removeNeutralGroupsWithoutLiberty(newBoard);
        if (!this.hasLiberty(newBoard, row, col))
            this.removeGroup(newBoard, row, col, playerVal);
        return newBoard;
    }

    computeLead() {
        const KOMI = 4.75;
        const BOARD_SIZE = this.BOARD_SIZE;

        function copyBoard(board) { return board.map(row => row.slice()); }

        function hasLiberty(board, row, col) {
            const color = board[row][col];
            if (color === 0 || color === NEUTRAL) return false;
            const visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
            const queue = [[row, col]];
            visited[row][col] = true;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            while (queue.length) {
                const [r, c] = queue.shift();
                for (let [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                    if (board[nr][nc] === 0) return true;
                    if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }
            return false;
        }

        function removeGroup(board, row, col, color) {
            const queue = [[row, col]];
            board[row][col] = 0;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            while (queue.length) {
                const [r, c] = queue.shift();
                for (let [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (let [dr, dc] of dirs) {
                const nr = libertyRow + dr, nc = libertyCol + dc;
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === opponentColor) return true;
            }
            return false;
        }

        function removeDeadAndDying(srcBoard) {
            let boardCopy = copyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                const visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
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
                                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
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
                                    if (!isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color)) {
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

        function assignTerritoryWithRange(liveBoard) {
            const territory = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (liveBoard[r][c] !== 0) continue;
                    const maxDist = (r <= 1 || r >= BOARD_SIZE - 2 || c <= 1 || c >= BOARD_SIZE - 2) ? 5 : 4;
                    let blackMin = Infinity, whiteMin = Infinity;
                    const dist = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(Infinity));
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
                            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && liveBoard[nr][nc] !== NEUTRAL && dist[nr][nc] === Infinity) {
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

        function computeScore(liveBoard, territory) {
            let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
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

        const liveBoard = removeDeadAndDying(this.board);
        const territory = assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = computeScore(liveBoard, territory);
        const lead = blackTotal - whiteTotal - 2 * KOMI;
        return lead;
    }

    getNeutralStonesOnBoard() {
        const list = [];
        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                if (this.board[r][c] === NEUTRAL) list.push({ r, c });
            }
        }
        return list;
    }

    getState() {
        const initialBoard = this.historyBoards.length > 0
            ? this.copyBoard(this.historyBoards[0])
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            numberOfHands: this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            initialNeutralStones: this.initialNeutralStones,
            neutralStones: this.getNeutralStonesOnBoard(),
            moveCoords: this.moveCoords,
            boardSize: this.BOARD_SIZE,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    getInitialState() {
        const initialBoard = this.historyBoards.length > 0
            ? this.copyBoard(this.historyBoards[0])
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            initialNeutralStones: this.initialNeutralStones,
            neutralStones: this.getNeutralStonesOnBoard(),
            moveCoords: [],
            boardSize: this.BOARD_SIZE,
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
                    ws.send(JSON.stringify({ type: 'gameState', ...this.getState() }));
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用。' }));
                }
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效落子。' }));
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                this.historyBoards.push(newBoard);
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', player: slot, ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastMoveMarkers = [];
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                if (this.passCounter >= 2)
                {
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
                for (let i = this.moveHistory.length - 1; i >= 0; i--)
                {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
                }
                if (steps === 0 || steps >= this.historyBoards.length)
                {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else
                {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo)
                {
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
                if (!newGameOpponent)
                    this.resetGame();
                else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame) {
                    if (msg.accept)
                        this.resetGame();
                    else
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
                if (this.pendingDraw) {
                    if (msg.accept) {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                    } else
                        this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!endOpponent)
                    this.startScoreCounting(ws, ws);
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
                    this.pendingScore.agreed.add(ws);
                    if (this.pendingScore.agreed.size === 2) {
                        const lead = this.scoreProposalData.lead;
                        this.gameOver = true;
                        this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                        this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                    else if (!msg.accept) {
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
                    ws.send(JSON.stringify({ type: 'error', message: '有玩家在座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getInitialState() });
                break;

            case 'editBoard':
                if (this.gameOver || this.historyBoards.length > 1)
                {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
                    return;
                }
                const editedBoard = msg.board;
                if (!editedBoard || editedBoard.length !== this.BOARD_SIZE) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return;
                }
                for (let r = 0; r < this.BOARD_SIZE; r++) {
                    for (let c = 0; c < this.BOARD_SIZE; c++) {
                        const val = editedBoard[r][c];
                        if (val !== 0 && val !== 1 && val !== 2 && val !== NEUTRAL) {
                            ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                            return;
                        }
                    }
                }
                this.board = this.copyBoard(editedBoard);
                this.initialNeutralStones = [];
                for (let r = 0; r < this.BOARD_SIZE; r++) {
                    for (let c = 0; c < this.BOARD_SIZE; c++) {
                        if (this.board[r][c] === NEUTRAL) this.initialNeutralStones.push({ r, c });
                    }
                }
                this.historyBoards = [this.copyBoard(this.board)];
                this.historyBoardSet.clear();
                this.historyBoardSet.add(this.boardToString(this.board));
                this.moveHistory = [];
                this.moveCoords = [];
                this.historyMarkers = [];
                this.currentPlayer = 1;
                this.lastMoveMarkers = [];
                this.passCounter = 0;
                this.gameOver = false;
                this.winner = null;
                this.broadcast({ type: 'editBoardAccepted', ...this.getInitialState() });
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size) {
                    const newSize = msg.size;
                    if (newSize >= 7 && newSize <= 21) {
                        this.BOARD_SIZE = newSize;
                        this.NEUTRAL_COUNT = Math.floor(0.083 * this.BOARD_SIZE * this.BOARD_SIZE);
                        const { board, initialNeutralStones } = this.generateNeutralStonesAndBoard();
                        this.board = board;
                        this.initialNeutralStones = initialNeutralStones;
                        this.historyBoards = [this.copyBoard(this.board)];
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
                    }
                }
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
        this.board = this.copyBoard(this.historyBoards.at(-1));

        this.broadcast({ type: 'broadcast', action: 'undoAccept', undoSteps: steps, ...this.getState() });
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        const { board, initialNeutralStones } = this.generateNeutralStonesAndBoard();
        this.board = board;
        this.initialNeutralStones = initialNeutralStones;
        this.currentPlayer = 1;
        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.moveCoords = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        for (let [client, slot] of this.room.players.entries())
        {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getInitialState(), slots: { black: false, white: false } });
    }

    exportRecord() {
        const initialBoard = this.historyBoards.length > 0 ? this.historyBoards[0] : this.board;
        const black = [];
        const white = [];
        const neutral = [];
        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                const v = initialBoard[r][c];
                if (v === NEUTRAL) neutral.push([r, c]);
                else if (v === 1) black.push([r, c]);
                else if (v === 2) white.push([r, c]);
            }
        }
        const moves = this.moveCoords.map(m => {
            if (m.type === 'pass') return (m.player === 'black' ? 'B' : 'W') + 'p';
            return (m.player === 'black' ? 'B' : 'W') + m.row + ',' + m.col;
        });
        return {
            format: 'muzei',
            game: '中立子围棋',
            boardSize: this.BOARD_SIZE,
            players: { black: '', white: '' },
            initialPosition: { black, white, neutral },
            moves
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.initialNeutralStones = [];
        this.currentPlayer = 1;
        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
    }

    static parseMove(entry) {
        if (typeof entry === 'object') return entry;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        const coords = entry.substring(1).split(',').map(Number);
        return { type: 'move', player, row: coords[0], col: coords[1] };
    }

    importRecord(data, requesterWs) {
        if (data.boardSize && data.boardSize >= 7 && data.boardSize <= 21) {
            this.BOARD_SIZE = data.boardSize;
            this.NEUTRAL_COUNT = Math.floor(0.083 * this.BOARD_SIZE * this.BOARD_SIZE);
        }
        this.resetToEmpty();

        if (data.initialPosition) {
            if (Array.isArray(data.initialPosition.neutral)) {
                for (const pos of data.initialPosition.neutral) {
                    if (Array.isArray(pos) && pos.length === 2 && pos[0] < this.BOARD_SIZE && pos[1] < this.BOARD_SIZE) {
                        this.board[pos[0]][pos[1]] = NEUTRAL;
                        this.initialNeutralStones.push({ r: pos[0], c: pos[1] });
                    }
                }
            }
            if (Array.isArray(data.initialPosition.black)) {
                for (const pos of data.initialPosition.black)
                    if (Array.isArray(pos) && pos.length === 2) this.board[pos[0]][pos[1]] = 1;
            }
            if (Array.isArray(data.initialPosition.white)) {
                for (const pos of data.initialPosition.white)
                    if (Array.isArray(pos) && pos.length === 2) this.board[pos[0]][pos[1]] = 2;
            }
        }
        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const moves = (data.moves || []).map(m => NeutralStoneWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getInitialState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getInitialState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.historyBoards.push(newBoard);
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
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
                initialPosition: data.initialPosition || { black: [], white: [], neutral: [] },
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new NeutralStoneWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
