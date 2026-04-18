const { QiTwoPlayerRoomBase, qiProtocol, squareWeiqiRules, applyInitialPositionCompact } = require('../common');

class RussianWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 19;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.moveCoords = [];
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.historyLastUsed = [];
        this.lastMoveMarkers = [];
        this.lastUsedShapeByColor = { 1: -1, 2: -1 };
        this.historyNextShape = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;

        this.SHAPES = [
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [-1, 1], [1, -1]],
            [[-1, -1], [-1, 1], [1, 0]],
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [1, -1], [-1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [-1, 1], [1, -1]],
            [[-1, -1], [-1, 1], [1, 0]],
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [1, -1], [-1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [-1, 1], [1, -1]],
            [[-1, -1], [-1, 1], [1, 0]],
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [1, -1], [-1, 1]],
            [[0, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 0]],
            [[0, -1], [-1, 0], [0, 1]],
            [[0, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 0]],
            [[0, -1], [-1, 0], [0, 1]],
            [[0, -1], [0, 0], [0, 1]],
            [[0, -1], [0, 0], [-1, 0]],
        ];
        this.nextShapeIndex = this.rollNextShapeIndex();
        /** 第 k 手局面（已下 k 手）时要求的复合形状索引；长度 = moveCoords.length + 1 */
        this.nextShapeSnapshots = [this.nextShapeIndex];
    }

    rollNextShapeIndex() {
        return Math.floor(Math.random() * this.SHAPES.length);
    }

    transformCoords(baseCoords, rot, flip) {
        return baseCoords.map(([dr, dc]) => {
            let r = dr, c = dc;
            for (let i = 0; i < rot; i++) { [r, c] = [-c, r]; }
            if (flip) c = -c;
            return [r, c];
        });
    }

    generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol) {
        const base = this.SHAPES[shapeIdx];
        const transformed = this.transformCoords(base, rot, flip);
        return transformed.map(([dr, dc]) => [refRow + dr, refCol + dc]);
    }

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b), 2);
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    tryPlaceShape(boardBefore, shapeIdx, rot, flip, refRow, refCol, playerVal) {
        const coords = this.generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol);
        if (!coords) return null;
        for (let [r, c] of coords) {
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }

        const newBoard = this.copyBoard(boardBefore);
        for (let [r, c] of coords) newBoard[r][c] = playerVal;

        const affectedEnemy = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of coords) {
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

        for (let [r, c] of coords) {
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
            komi: 3.25,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            lastUsedShapeByColor: this.lastUsedShapeByColor,
            nextShapeIndex: this.nextShapeIndex,
            nextShapeSnapshots: [...this.nextShapeSnapshots],
            moveCoords: this.moveCoords,
            komi: 3.25,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

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
            if (this.historyNextShape.length > 0) this.nextShapeIndex = this.historyNextShape.pop();
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            if (this.nextShapeSnapshots.length > 1) this.nextShapeSnapshots.pop();
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
        this.historyNextShape = [];
        this.nextShapeIndex = this.rollNextShapeIndex();
        this.nextShapeSnapshots = [this.nextShapeIndex];
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

    compoundPass(slot) {
        const room = this.room;
        const passPlayerVal = this.currentPlayer === 1 ? 1 : 2;
        this.historyNextShape.push(this.nextShapeIndex);
        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'pass', player: slot });
        this.lastUsedShapeByColor[passPlayerVal] = -1;
        this.currentPlayer = 3 - this.currentPlayer;
        this.nextShapeIndex = this.rollNextShapeIndex();
        this.nextShapeSnapshots.push(this.nextShapeIndex);
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
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { shapeIndex, rotation, flipped, row, col } = msg;
                if (shapeIndex === undefined || rotation === undefined || flipped === undefined || row === undefined || col === undefined) return;
                if (shapeIndex !== this.nextShapeIndex) {
                    ws.send(JSON.stringify({ type: 'error', message: '复合棋子形状与当前要求不一致。' }));
                    return;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceShape(this.board, shapeIndex, rotation, flipped, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                this.historyNextShape.push(this.nextShapeIndex);
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.board = newBoard;
                const coords = this.generatePlacementCoords(shapeIndex, rotation, flipped, row, col);
                const stoneList = coords.map(([r, c]) => [r, c]);
                this.moveCoords.push({ type: 'move', player: slot, stones: stoneList });
                this.lastMoveMarkers = coords.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                this.lastUsedShapeByColor[playerVal] = shapeIndex;
                this.currentPlayer = 3 - this.currentPlayer;
                this.nextShapeIndex = this.rollNextShapeIndex();
                this.nextShapeSnapshots.push(this.nextShapeIndex);
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.compoundPass(slot);
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot, { cannotUndoMsg: '无法悔棋。' });
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
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱。' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
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
        if (hasAnyStone || hasPlayer) return false;
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
        this.historyNextShape = [];
        this.nextShapeIndex = this.rollNextShapeIndex();
        this.nextShapeSnapshots = [this.nextShapeIndex];
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
            gameType: '俄罗斯围棋',
            gameId: 'russian-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: [],
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
        this.historyNextShape = [];
        this.nextShapeIndex = this.rollNextShapeIndex();
        this.nextShapeSnapshots = [this.nextShapeIndex];
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
        if (!data || data.gameId !== 'russian-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要俄罗斯围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(RussianWeiqiRoom.parseMove);

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
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, stones: stones.map(([r, c]) => [r, c]) });
                this.board = newBoard;
                this.lastMoveMarkers = stones.map(([r, c]) => ({ row: r, col: c, color: playerVal }));
                const si = this.inferShapeIndexFromStones(stones);
                this.lastUsedShapeByColor[playerVal] = si >= 0 ? si : -1;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.nextShapeIndex = this.rollNextShapeIndex();
                this.nextShapeSnapshots.push(this.nextShapeIndex);
            } else if (move.type === 'pass') {
                if (slot !== (this.currentPlayer === 1 ? 'black' : 'white')) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手虚着方不一致` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(this.boardToString(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastUsedShapeByColor[playerVal] = -1;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.nextShapeIndex = this.rollNextShapeIndex();
                this.nextShapeSnapshots.push(this.nextShapeIndex);
            }
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.nextShapeIndex = this.rollNextShapeIndex();
        if (this.nextShapeSnapshots.length) this.nextShapeSnapshots[this.nextShapeSnapshots.length - 1] = this.nextShapeIndex;

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
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
        room.gameLogic = new RussianWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
