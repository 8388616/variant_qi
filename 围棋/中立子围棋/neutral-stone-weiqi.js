const { QiTwoPlayerRoomBase, qiProtocol, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact } = require('../common');

const NEUTRAL = 3;

class NeutralStoneWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.NEUTRAL_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, initialNeutralStones } = this.generateNeutralStonesAndBoard();
        this.board = board;
        this.openingBoard = this.copyBoard(this.board);
        this.initialNeutralStones = initialNeutralStones;
        this.currentPlayer = 1;
        this.historyBoards = [];
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
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    generateNeutralStonesAndBoard()
    {
        const MAX_ATTEMPTS = 100;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const points = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
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
            const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            for (let h of selected) board[h.r][h.c] = NEUTRAL;

            return { board, initialNeutralStones: selected.map(p => ({ r: p.r, c: p.c })) };
        }
        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
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
        const board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        for (let h of selected) board[h.r][h.c] = NEUTRAL;
        return { board, initialNeutralStones: selected.map(p => ({ r: p.r, c: p.c })) };
    }

    hasLiberty(board, row, col)
    {
        const v = board[row][col];
        if (v === 0) 
            return false;
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal)
    {
        if (boardBefore[row][col] !== 0)
             return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [dr, dc] of dirs)
        {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === NEUTRAL) 
                if (!this.hasLiberty(newBoard, nr, nc)) 
                    this.removeGroup(newBoard, nr, nc, NEUTRAL);
        }

        for (let [dr, dc] of dirs)
        {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === 3 - playerVal) 
                if (!this.hasLiberty(newBoard, nr, nc)) 
                    this.removeGroup(newBoard, nr, nc, 3 - playerVal);
        }
        if (!this.hasLiberty(newBoard, row, col))
            this.removeGroup(newBoard, row, col, playerVal);
        return newBoard;
    }

    neutralWeiqiMove(self, ws, msg, slot) {
        if (self.gameOver) return;
        if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
        const { row, col } = msg;
        if (row < 0 || row >= self.boardSize || col < 0 || col >= self.boardSize) return;
        if (self.board[row][col] !== 0) return;
        const playerVal = self.currentPlayer === 1 ? 1 : 2;
        const newBoard = self.tryPlaceStone(self.board, row, col, playerVal);
        if (!newBoard) {
            ws.send(JSON.stringify({ type: 'error', message: '无效落子。' }));
            return;
        }
        const newBoardStr = self.boardToString(newBoard);
        if (self.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }
        self.historyBoards.push(self.copyBoard(newBoard));
        self.historyBoardSet.add(newBoardStr);
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'move', player: slot, row, col });
        self.board = newBoard;
        self.lastMoveMarkers = [{ row, col, color: playerVal }];
        self.currentPlayer = 3 - self.currentPlayer;
        self.passCounter = 0;
        self.broadcast({ type: 'broadcast', action: 'move', player: slot, ...self.getState() });
    }

    computeLead() {
        const KOMI = 4.75;
        const liveBoard = squareWeiqiRules.removeDeadAndDying(
            this.board, this.boardSize, (b) => this.copyBoard(b)
        );
        const territory = squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize, {
            isPassable: (v) => v !== NEUTRAL
        });
        const { blackTotal, whiteTotal } = squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getNeutralStonesOnBoard() {
        const list = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === NEUTRAL) list.push({ r, c });
            }
        }
        return list;
    }

    getState() {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: 4.75,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            initialNeutralStones: this.initialNeutralStones,
            neutralStones: this.getNeutralStonesOnBoard(),
            moveCoords: this.moveCoords,
            boardSize: this.boardSize,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    getInitialState() {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: 4.75,
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            initialNeutralStones: this.initialNeutralStones,
            neutralStones: this.getNeutralStonesOnBoard(),
            moveCoords: [],
            boardSize: this.boardSize,
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

        switch (msg.type)
        {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'move':
                this.neutralWeiqiMove(this, ws, msg, slot);
                break;

            case 'pass':
                qiProtocol.weiqiPass(this, ws, slot);
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
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
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'editBoard':
                if (this.gameOver || this.historyBoards.length > 0)
                {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
                    return;
                }
                const editedBoard = msg.board;
                if (!editedBoard || editedBoard.length !== this.boardSize) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return;
                }
                for (let r = 0; r < this.boardSize; r++) {
                    for (let c = 0; c < this.boardSize; c++) {
                        const val = editedBoard[r][c];
                        if (val !== 0 && val !== 1 && val !== 2 && val !== NEUTRAL) {
                            ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                            return;
                        }
                    }
                }
                this.board = this.copyBoard(editedBoard);
                this.openingBoard = this.copyBoard(this.board);
                this.initialNeutralStones = [];
                for (let r = 0; r < this.boardSize; r++) {
                    for (let c = 0; c < this.boardSize; c++) {
                        if (this.board[r][c] === NEUTRAL) this.initialNeutralStones.push({ r, c });
                    }
                }
                this.historyBoards = [];
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
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
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
        if (this.historyBoards.length === 0)
            this.board = this.copyBoard(this.openingBoard);
        else
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
        this.openingBoard = this.copyBoard(this.board);
        this.initialNeutralStones = initialNeutralStones;
        this.currentPlayer = 1;
        this.historyBoards = [];
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
        const initialBoard = this.openingBoard || this.board;
        const moves = this.moveCoords.map(m => {
            if (m.type === 'pass') return (m.player === 'black' ? 'B' : 'W') + 'p';
            return (m.player === 'black' ? 'B' : 'W') + m.row + ',' + m.col;
        });
        return {
            format: 'muzei',
            game: '中立子围棋',
            gameId: 'neutral-stone-weiqi',
            boardSize: this.boardSize,
            komi: 4.75,
            players: { black: '', white: '' },
            initialPosition: encodeInitialPositionCompact(initialBoard, this.boardSize),
            moves
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.openingBoard = this.copyBoard(this.board);
        this.initialNeutralStones = [];
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
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
        if (!data || (data.gameId && data.gameId !== 'neutral-stone-weiqi' && data.game !== '中立子围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要中立子围棋棋谱）。' }));
            return;
        }
        if (data.boardSize && data.boardSize >= 7 && data.boardSize <= 21) {
            this.boardSize = data.boardSize;
            this.NEUTRAL_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        }
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.initialNeutralStones = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === NEUTRAL) this.initialNeutralStones.push({ r, c });
            }
        }
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const moves = (data.moves || []).map(m => NeutralStoneWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
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
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
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
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            return false;
        }
        this.boardSize = newSize;
        this.NEUTRAL_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board, initialNeutralStones } = this.generateNeutralStonesAndBoard();
        this.board = board;
        this.openingBoard = this.copyBoard(this.board);
        this.initialNeutralStones = initialNeutralStones;
        this.historyBoards = [];
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
        return true;
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
        room.gameLogic = new NeutralStoneWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
