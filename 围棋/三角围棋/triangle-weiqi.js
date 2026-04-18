const { QiTwoPlayerRoomBase, gridGraphGoRules } = require('../common');

class TriangleWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 27) {
        super(room);
        this.boardSize = initialSize;
        this.board = this.createEmptyBoard();
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

    /** 路数 = 最外圈边线上的点数 = 三角棋盘行数 */
    get ROWS() {
        return this.boardSize;
    }

    createEmptyBoard()
    {
        return Array(this.boardSize).fill().map((_, r) => Array(r + 1).fill(0));
    }

    isValidCoord(r, c)
    {
        return r >= 0 && r < this.boardSize && c >= 0 && c <= r;
    }

    copyBoard(src)
    {
        return src.map(row => row.slice());
    }

    boardToString(board)
    {
        const parts = [];
        for (let r = 0; r < this.boardSize; r++) {
            parts.push(board[r].join(','));
        }
        return parts.join(';');
    }

    getDirs() {
        return [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]];
    }

    _neighbors() {
        return (r, c) => {
            const out = [];
            for (const [dr, dc] of this.getDirs()) {
                const nr = r + dr, nc = c + dc;
                if (this.isValidCoord(nr, nc)) out.push([nr, nc]);
            }
            return out;
        };
    }

    countGroupLiberties(board, row, col) {
        return gridGraphGoRules.countGroupLiberties(board, row, col, this._neighbors());
    }

    hasLiberty(board, row, col) {
        return gridGraphGoRules.countGroupLiberties(board, row, col, this._neighbors()) > 0;
    }

    removeGroup(board, row, col, color) {
        gridGraphGoRules.removeGroup(board, row, col, color, this._neighbors());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidCoord(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphGoRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._neighbors(), 1
        );
    }

    removeDeadGroups(srcBoard) {
        return gridGraphGoRules.removeDeadAndDying(
            srcBoard,
            this.boardSize,
            this.boardSize,
            (b) => this.copyBoard(b),
            this._neighbors(),
            (r, c) => this.isValidCoord(r, c)
        );
    }

    gridDistance(r1, c1, r2, c2) {
        return Math.abs(r1 - r2) + Math.min(Math.abs(c1 - c2), Math.abs((r1 - c1) - (r2 - c2)));
    }

    computeLead() {
        const liveBoard = this.removeDeadGroups(this.board);
        const blackStones = [], whiteStones = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c <= r; c++) {
                if (liveBoard[r][c] === 1) blackStones.push([r, c]);
                else if (liveBoard[r][c] === 2) whiteStones.push([r, c]);
            }
        }
        let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c <= r; c++) {
                if (liveBoard[r][c] !== 0) continue;
                let minBlack = Infinity, minWhite = Infinity;
                for (const [br, bc] of blackStones) {
                    const d = this.gridDistance(r, c, br, bc);
                    if (d < minBlack) minBlack = d;
                }
                for (const [wr, wc] of whiteStones) {
                    const d = this.gridDistance(r, c, wr, wc);
                    if (d < minWhite) minWhite = d;
                }
                if (minBlack < minWhite) blackTerritory++;
                else if (minWhite < minBlack) whiteTerritory++;
                else publicTerritory++;
            }
        }
        const blackTotal = blackStones.length + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones.length + whiteTerritory + publicTerritory / 2;
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
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
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    startScoreCounting(requester, opponent) {
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 9 || newSize > 31) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效' }));
            return false;
        }
        const hasAnyStone = this.board.some((row, r) => row.some((v, c) => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        this.boardSize = newSize;
        this.board = this.createEmptyBoard();
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
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '三角围棋',
            gameId: 'triangle-weiqi',
            boardSize: this.boardSize,
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
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1;
        this.historyBoards = [];
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
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'triangle-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要三角围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 27;
        if (!Number.isInteger(newSize) || newSize < 9 || newSize > 31) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        if (data.initialPosition) {
            if (Array.isArray(data.initialPosition.black)) {
                for (const pos of data.initialPosition.black) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (this.isValidCoord(r, c))
                            this.board[r][c] = 1;
                    }
                }
            }
            if (Array.isArray(data.initialPosition.white)) {
                for (const pos of data.initialPosition.white) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (this.isValidCoord(r, c))
                            this.board[r][c] = 2;
                    }
                }
            }
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(TriangleWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (!this.isValidCoord(row, col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
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

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || { black: [], white: [] },
                moves: this.moveCoords.map(m => ({ ...m }))
            }
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
                if (!this.isValidCoord(row, col) || this.board[row][col] !== 0)
                    return;
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
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
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

    performUndo(steps, requesterWs)
    {
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
            this.board = this.createEmptyBoard();
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
        this.board = this.createEmptyBoard();
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
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    onPlayerLeave(ws)
    {
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
        room.gameLogic = new TriangleWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
