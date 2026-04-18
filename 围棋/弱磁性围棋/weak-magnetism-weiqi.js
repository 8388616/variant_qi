const { QiTwoPlayerRoomBase, qiProtocol, squareWeiqiRules, applyInitialPositionCompact } = require('../common');
/** 客户端「显示序号」按 moveCoords 与磁性规则重放，使序号随子移动（见 弱磁性围棋.html）。 */
class WeakMagneticWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
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
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    hasLiberty(board, row, col) {
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    applyMagneticMove(board, row, col, playerVal) {
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (let [dr, dc] of dirs) {
            let step = 1;
            let targetR = -1, targetC = -1;
            while (true) {
                const nr = row + dr * step, nc = col + dc * step;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) break;
                if (board[nr][nc] !== 0) {
                    targetR = nr; targetC = nc;
                    break;
                }
                step++;
            }
            if (targetR === -1) continue;
            const targetColor = board[targetR][targetC];
            const moveDr = (targetColor === playerVal) ? dr : -dr;
            const moveDc = (targetColor === playerVal) ? dc : -dc;
            const newR = targetR + moveDr, newC = targetC + moveDc;
            if (newR >= 0 && newR < this.boardSize && newC >= 0 && newC < this.boardSize && board[newR][newC] === 0) {
                board[newR][newC] = targetColor;
                board[targetR][targetC] = 0;
            }
        }
        return board;
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (boardBefore[row][col] !== 0) return null;
        let newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        newBoard = this.applyMagneticMove(newBoard, row, col, playerVal);
        let changed;
        do {
            changed = false;
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    const val = newBoard[i][j];
                    if (val !== 0 && !this.hasLiberty(newBoard, i, j)) {
                        this.removeGroup(newBoard, i, j, val);
                        changed = true;
                    }
                }
            }
        } while (changed);
        return newBoard;
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return squareWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this.boardSize
        );
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b));
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = this.boardSize <= 8 ? 4.25 : 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState()
    {
        return {
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
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
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move':
                qiProtocol.weiqiMove(this, ws, msg, slot);
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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
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
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
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
        this.passCounter = 0;
        for (const [client, slot] of this.room.players.entries())
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
            gameType: '弱磁性围棋',
            gameId: 'weak-magnetism-weiqi',
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            players: { black: null, white: null },
            initialPosition: [],
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
        if (!data || data.gameId !== 'weak-magnetism-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要弱磁性围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(WeakMagneticWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
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
                initialPosition: data.initialPosition || [],
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
        room.gameLogic = new WeakMagneticWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
