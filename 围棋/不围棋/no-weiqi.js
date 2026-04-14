class NoWeiqiRoom
{
    constructor(room)
    {
        this.room = room;
        this.boardSize = 9;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    copyBoard(src)
    {
        return src.map(row => row.slice());
    }

    boardToString(board)
    {
        return board.map(row => row.join(',')).join(';');
    }

    hasLiberty(board, row, col)
    {
        const color = board[row][col];
        if (color === 0) return false;
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length)
        {
            const [r, c] = queue.shift();
            for (let[dr, dc] of dirs)
            {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (board[nr][nc] === 0) return true;
                if (board[nr][nc] === color && !visited[nr][nc])
                {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return false;
    }

    removeGroup(board, row, col, color)
    {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length)
        {
            const [r, c] = queue.shift();
            for (let[dr, dc] of dirs)
            {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color)
                {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    tryPlaceStone(boardBefore, row, col, playerVal)
    {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        let capturedOpponent = false;
        for (let i = 0; i < this.boardSize; i++)
        {
            for (let j = 0; j < this.boardSize; j++)
            {
                if (newBoard[i][j] === 3 - playerVal && !this.hasLiberty(newBoard, i, j))
                {
                    capturedOpponent = true;
                    this.removeGroup(newBoard, i, j, 3 - playerVal);
                }
            }
        }
        // 先提子的一方负：提子后局面有效，但落子方立即告负
        if (capturedOpponent)
            return { newBoard, capturedOpponent: true }
        ;

        for (let i = 0; i < this.boardSize; i++)
        {
            for (let j = 0; j < this.boardSize; j++)
            {
                if (newBoard[i][j] === playerVal && !this.hasLiberty(newBoard, i, j))
                {
                    return null;
                }
            }
        }
        return { newBoard, capturedOpponent: false }
        ;
    }

    isBoardFull()
    {
        for (let r = 0; r < this.boardSize; r++)
            for (let c = 0; c < this.boardSize; c++)
                if (this.board[r][c] === 0) return false;
        return true;
    }

    getState()
    {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots:
            {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        }
        ;
    }

    assignSlot(ws, requestedSlot)
    {
        if (requestedSlot === 'black' && !this.room.getPlayerBySlot('black')) return 'black';
        if (requestedSlot === 'white' && !this.room.getPlayerBySlot('white')) return 'white';
        return null;
    }

    broadcast(data, exclude = null)
    {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (const client of allClients) {
            if (client !== exclude && client.readyState === 1)
            {
                client.send(JSON.stringify(data));
            }
        }
    }

    sendState(ws)
    {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getState() }));
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot)
                {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                }
                else
                {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
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
                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const result = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!result) return;

                const { newBoard, capturedOpponent } = result;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                    return;
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                if (capturedOpponent)
                {
                    this.gameOver = true;
                    this.winner = slot === 'black' ? 'white' : 'black';
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                }
                else
                {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;

                    if (this.isBoardFull())
                    {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    }
                    else
                    {
                        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
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
                if (steps === 0 || steps > this.historyBoards.length)
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
                {
                    this.resetGame();
                }
                else
                {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame)
                {
                    if (msg.accept)
                    {
                        this.resetGame();
                    }
                    else
                    {
                        this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局。' }));
                    }
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent)
                {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                }
                else
                {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw)
                {
                    if (msg.accept)
                    {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                    }
                    else
                    {
                        this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                    }
                }
                this.pendingDraw = null;
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
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length == 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        for (let[client, slot] of this.room.players.entries())
        {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（5-21）' }));
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
            gameType: '不围棋',
            gameId: 'no-weiqi',
            boardSize: this.boardSize,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return p + m.row + ',' + m.col;
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
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'no-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要不围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
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
        const moves = rawMoves.map(NoWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            if (this.gameOver) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手时对局已结束` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const move = moves[i];
            const slot = move.player;
            const expectedSlot = this.currentPlayer === 1 ? 'black' : 'white';
            if (move.type !== 'move' || slot !== expectedSlot) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const playerVal = slot === 'black' ? 1 : 2;
            const { row, col } = move;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const result = this.tryPlaceStone(this.board, row, col, playerVal);
            if (!result) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const { newBoard, capturedOpponent } = result;
            const newBoardStr = this.boardToString(newBoard);
            this.historyBoards.push(this.copyBoard(newBoard));
            this.historyBoardSet.add(newBoardStr);
            this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
            this.moveHistory.push(slot);
            this.moveCoords.push({ type: 'move', player: slot, row, col });
            this.board = newBoard;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];

            if (capturedOpponent) {
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                break;
            }
            this.currentPlayer = 3 - this.currentPlayer;
            if (this.isBoardFull()) {
                this.gameOver = true;
                this.winner = 'draw';
                break;
            }
        }

        if (data.result && !this.gameOver) {
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

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new NoWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
