const crypto = require('crypto');
const { QiTwoPlayerRoomBase, squareWeiqiRules } = require('../common');

class TranspositionWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19)
    {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;          // 1:黑, 2:白
        this.historyBoards = [];          // 历史棋盘（深拷贝）
        this.historyBoardSet = new Set(); // 历史棋盘字符串集合，用于禁全同
        this.moveHistory = [];             // 记录每步是谁走的（用于悔棋）
        this.historyMarkers = [];          // 历史落子标记
        this.lastMoveMarkers = [];         // 最后一步的落子标记（小三角）
        this.moveHighlightMarkers = [];     // 易位时两个位置的外框标记 {row, col, frameOnly}
        this.movePlayerColor = null;        // 记录最后一步的移动方颜色 (1黑 2白)
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.maxTranspositionMoves = this.computeMaxTranspositionMoves(this.boardSize);
        this.moveCount = 0;                
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
    }

    // ---------- 工具函数 ----------

    computeMaxTranspositionMoves(size)
    {
        let limit = Math.ceil(size * size * 0.8);
        if (limit % 2 !== 0)
            limit++;
        return limit;
    }

    // 计算连通块的气数（标准围棋规则：气为相邻空点）
    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize, (b) => this.copyBoard(b), 1
        );
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
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    // ---------- 状态同步 ----------
    getState()
    {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            moveHighlightMarkers: this.moveHighlightMarkers,
            movePlayerColor: this.movePlayerColor,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCount: this.moveCount,
            canTransposition: this.moveCount < this.maxTranspositionMoves,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    // ---------- 悔棋实现 ----------
    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            }
            if (this.historyMarkers.length > 0) {
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
                this.moveHighlightMarkers = []; // 悔棋后清除易位高亮
            } else {
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
            }
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
            this.moveCount--;
        }
        if (this.historyBoards.length === 0)
        {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.moveCount = 0;
        }
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));

        this.movePlayerColor = null;
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    // 新局：清空棋盘与对局状态
    resetGame()
    {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHighlightMarkers = [];
        this.movePlayerColor = null;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCount = 0;
        this.moveCoords = [];
        // 释放所有玩家槽位
        for (let [client, slot] of this.room.players.entries()) {
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
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效（7-21）' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        // 设置路数后按新路数清空盘面与对局记录（不释放座位）
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    // 数子流程：向双方发送形势判断提议
    startScoreCounting(requester, opponent) {
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    // ---------- 消息处理 ----------
    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'selectColor':
                if (slot)
                    return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot)
                {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                }
                break;

            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { moveType, row, col, fromRow, fromCol } = msg;
                let newBoard = null;
                let newMoveMarkers = [];
                let newHighlightMarkers = [];

                if (moveType === 'place')
                {
                    newBoard = this.tryPlaceStone(this.board, row, col, this.currentPlayer === 1 ? 1 : 2);
                    if (newBoard) {
                        newMoveMarkers = [{ row, col, color: this.currentPlayer === 1 ? 1 : 2 }];
                        newHighlightMarkers = [];
                    }
                }
                else if (moveType === 'swap')
                {
                    if (this.moveCount >= this.maxTranspositionMoves)
                        return;
                    if (fromRow === undefined || fromCol === undefined) return;
                    newBoard = this.trySwapPiece(this.board, fromRow, fromCol, row, col, this.currentPlayer === 1 ? 1 : 2);
                    if (newBoard) {
                        // 易位：标出原位置与目标位置（若该格已无子则只画框）
                        newHighlightMarkers = [
                            { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
                            { row, col, frameOnly: newBoard[row][col] === 0 }
                        ];
                        if (newBoard[row][col] === (this.currentPlayer === 1 ? 1 : 2)) {
                            newMoveMarkers = [{ row, col, color: this.currentPlayer === 1 ? 1 : 2 }];
                        } else {
                            newMoveMarkers = [];
                        }
                    }
                }
                else
                    return;

                if (!newBoard)
                    return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                // 记录本步
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                if (moveType === 'place')
                    this.moveCoords.push({ type: 'move', player: slot, row, col });
                else
                    this.moveCoords.push({ type: 'swap', player: slot, fromRow, fromCol, row, col });

                this.board = newBoard;
                this.lastMoveMarkers = newMoveMarkers;
                this.moveHighlightMarkers = newHighlightMarkers;
                // 记录本步行棋方颜色（易位前的 currentPlayer）
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = null;   // 虚手无高亮
                this.moveCount++;
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
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝新开一局' }));
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

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局中不能导入棋谱。' }));
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

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '易位围棋',
            gameId: 'translocation-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                if (m.type === 'swap') return p + 's' + [m.fromRow, m.fromCol, m.row, m.col].join(',');
                return p + m.row + ',' + m.col;
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
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHighlightMarkers = [];
        this.movePlayerColor = null;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCount = 0;
        this.moveCoords = [];
        this.maxTranspositionMoves = this.computeMaxTranspositionMoves(this.boardSize);
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (entry && typeof entry === 'object') return entry;
        if (typeof entry !== 'string') return null;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        if (entry[1] === 's') {
            const parts = entry.substring(2).split(',').map(Number);
            if (parts.length === 4)
                return { type: 'swap', player, fromRow: parts[0], fromCol: parts[1], row: parts[2], col: parts[3] };
            return null;
        }
        const coords = entry.substring(1).split(',').map(Number);
        if (coords.length >= 2 && !coords.some(x => Number.isNaN(x)))
            return { type: 'move', player, row: coords[0], col: coords[1] };
        return null;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'translocation-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要易位围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        let curBoard = QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
        if (data.initialPosition && Array.isArray(data.initialPosition))
            QiWeiqiSquarePageRuntime.applyInitialPositionCompact(curBoard, ps.BOARD_SIZE, data.initialPosition);


        const rawMoves = data.moves || [];
        const moves = rawMoves.map(TranspositionWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            if (!move) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            const expectedSlot = this.currentPlayer === 1 ? 'black' : 'white';
            if (slot !== expectedSlot) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方错误。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手出现重复局面。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;
            } else if (move.type === 'swap') {
                if (this.moveCount >= this.maxTranspositionMoves) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手易位次数已用尽。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const { fromRow, fromCol, row, col } = move;
                const newBoard = this.trySwapPiece(this.board, fromRow, fromCol, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法易位。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手出现重复局面。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'swap', player: slot, fromRow, fromCol, row, col });
                this.board = newBoard;
                const newHighlightMarkers = [
                    { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
                    { row, col, frameOnly: newBoard[row][col] === 0 }
                ];
                let newMoveMarkers = [];
                if (newBoard[row][col] === playerVal)
                    newMoveMarkers = [{ row, col, color: playerVal }];
                this.lastMoveMarkers = newMoveMarkers;
                this.moveHighlightMarkers = newHighlightMarkers;
                this.movePlayerColor = this.currentPlayer;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.moveCount++;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.moveHighlightMarkers = [];
                this.movePlayerColor = null;
                this.moveCount++;
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

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new TranspositionWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};