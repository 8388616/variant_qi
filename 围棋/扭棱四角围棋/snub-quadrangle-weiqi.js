const { QiTwoPlayerRoomBase, gridGraphGoRules } = require('../common');

class SnubQuadrangleWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialLanes = 7) {
        super(room);
        this.boardLanes = initialLanes;
        this._allocBoard();
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

    _allocBoard() {
        const { w, h } = SnubQuadrangleWeiqiRoom.gridDims(this.boardLanes);
        this.gridW = w;
        this.gridH = h;
        this.board = Array(w).fill().map(() => Array(h).fill(-1));
        for (let r = 0; r < w; r++) {
            for (let c = 0; c < h; c++) {
                if (SnubQuadrangleWeiqiRoom.isValidVertex(r, c, w, h))
                    this.board[r][c] = 0;
            }
        }
    }

    static gridDims(lanes) {
        const n = lanes;
        return { w: 3 * n - 2, h: 3 * n - 2 };
    }

    static isValidVertex(row, col, gridW, gridH) {
        if (row < 0 || col < 0 || row >= gridW || col >= gridH) return false;
        if (row % 3 === 2 && col % 3 === 2) return false;
        if (row === gridW - 1 && row % 3 === 0 && col % 3 === 1) return false;
        if (col === gridH - 1 && row % 3 === 0 && col % 3 === 0) return false;
        return true;
    }

    isValidVertex(r, c) {
        return SnubQuadrangleWeiqiRoom.isValidVertex(r, c, this.gridW, this.gridH);
    }

    /** 与 C# 取得鄰點 一致 */
    static getNeighbors(row, col, gridW, gridH) {
        let arr = [];
        if (row % 3 === 0 && col % 3 === 0)
            arr = [[row - 1, col], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, col]];
        else if (row % 3 === 1 && col % 3 === 0)
            arr = [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col]];
        else if (row % 3 === 2 && col % 3 === 0)
            arr = [[row - 1, col - 1], [row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col]];
        else if (row % 3 === 0 && col % 3 === 1)
            arr = [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col], [1 + row, 1 + col]];
        else if (row % 3 === 1 && col % 3 === 1)
            arr = [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, col]];
        else if (row % 3 === 2 && col % 3 === 1)
            arr = [[row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col], [1 + row, 1 + col]];
        else if (row % 3 === 0 && col % 3 === 2)
            arr = [[row - 1, col - 1], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, 1 + col]];
        else if (row % 3 === 1 && col % 3 === 2)
            arr = [[row - 1, col - 1], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, 1 + col]];
        const out = [];
        for (const [a, b] of arr) {
            if (SnubQuadrangleWeiqiRoom.isValidVertex(a, b, gridW, gridH))
                out.push([a, b]);
        }
        return out;
    }

    getNeighbors(r, c) {
        return SnubQuadrangleWeiqiRoom.getNeighbors(r, c, this.gridW, this.gridH);
    }

    copyBoard(src) { return src.map(row => row.slice()); }

    boardToString(board) {
        let s = '';
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                if (this.isValidVertex(r, c))
                    s += board[r][c];
                else
                    s += 'x';
            }
        }
        return s;
    }

    _nb() {
        return (r, c) => this.getNeighbors(r, c);
    }

    countGroupLiberties(board, row, col) {
        return gridGraphGoRules.countGroupLiberties(board, row, col, this._nb());
    }

    removeGroup(board, row, col, color) {
        gridGraphGoRules.removeGroup(board, row, col, color, this._nb());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidVertex(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphGoRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._nb(), 1
        );
    }

    removeDeadAndDying(srcBoard) {
        return gridGraphGoRules.removeDeadAndDying(
            srcBoard,
            this.gridW,
            this.gridH,
            (b) => this.copyBoard(b),
            this._nb(),
            (r, c) => this.isValidVertex(r, c)
        );
    }

    assignTerritoryWithRange(liveBoard) {
        return gridGraphGoRules.assignTerritoryWithRange(
            liveBoard,
            this.gridW,
            this.gridH,
            this._nb(),
            (r, c) => this.isValidVertex(r, c)
        );
    }

    computeScore(liveBoard, territory) {
        return gridGraphGoRules.computeScore(
            liveBoard, territory, this.gridW, this.gridH,
            (r, c) => this.isValidVertex(r, c)
        );
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
            boardLanes: this.boardLanes,
            gridWidth: this.gridW,
            gridHeight: this.gridH,
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
                if (row < 0 || row >= this.gridW || col < 0 || col >= this.gridH) return;
                if (!this.isValidVertex(row, col)) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效交点' }));
                    return;
                }
                if (this.board[row][col] !== 0) {
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
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
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
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0) {
            this._allocBoard();
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this._allocBoard();
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

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 3 || newSize > 8) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效' }));
            return false;
        }
        const hasStone = this.board.some((row, r) => row.some((v, c) => this.isValidVertex(r, c) && v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        this.boardLanes = newSize;
        this._allocBoard();
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '扭棱四角围棋',
            gameId: 'snub-quadrangle-weiqi',
            boardLanes: this.boardLanes,
            gridWidth: this.gridW,
            gridHeight: this.gridH,
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
        this._allocBoard();
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
        const okId = data.gameId === 'snub-quadrangle-weiqi' || data.gameId === 'snub-square-weiqi';
        if (!data || (!okId && data.gameType !== '扭棱四角围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要扭棱四角围棋棋谱）' }));
            return;
        }
        const lanes = data.boardLanes != null ? data.boardLanes : data.boardSize;
        if (!Number.isInteger(lanes) || lanes < 3 || lanes > 8) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效' }));
            return;
        }

        this.boardLanes = lanes;
        this.resetToEmpty();

        if (data.initialPosition) {
            if (Array.isArray(data.initialPosition.black)) {
                for (const pos of data.initialPosition.black) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (this.isValidVertex(r, c)) this.board[r][c] = 1;
                    }
                }
            }
            if (Array.isArray(data.initialPosition.white)) {
                for (const pos of data.initialPosition.white) {
                    if (Array.isArray(pos) && pos.length === 2) {
                        const [r, c] = pos;
                        if (this.isValidVertex(r, c)) this.board[r][c] = 2;
                    }
                }
            }
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(SnubQuadrangleWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.gridW || col < 0 || col >= this.gridH || !this.isValidVertex(row, col)) {
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
                boardLanes: this.boardLanes,
                initialPosition: data.initialPosition || { black: [], white: [] },
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
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
        room.gameLogic = new SnubQuadrangleWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
