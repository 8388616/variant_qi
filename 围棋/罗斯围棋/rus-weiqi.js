const { QiTwoPlayerRoomBase, qiProtocol, squareWeiqiRules, applyInitialPositionCompact } = require('../common');

class RusWeiqiRoom extends QiTwoPlayerRoomBase {
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
            [[-1, -1], [0, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 1]],
            [[-1, -1], [-1, 0], [1, 0]],
            [[-1, -1], [0, 1], [1, 0]],
            [[1, -1], [-1, -1], [-1, 1]]
        ];
        this.SHAPE_STONE_OWNERS = ['self', 'opp', 'self'];
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
        const owners = this.SHAPE_STONE_OWNERS;
        const affectedEnemy = new Set();
        const affectedFriend = new Set();
        for (let i = 0; i < coords.length; i++) {
            const [r, c] = coords[i];
            if (owners[i] === 'opp') {
                newBoard[r][c] = 3 - playerVal;
                affectedEnemy.add(`${r},${c}`);
            } else if (owners[i] === 'self') {
                newBoard[r][c] = playerVal;
                affectedFriend.add(`${r},${c}`);
            }
        }

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of coords) {
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                    if (newBoard[r][c] === playerVal && newBoard[nr][nc] === 3 - playerVal)
                        affectedEnemy.add(`${nr},${nc}`);
                    else if (newBoard[r][c] === 3 - playerVal && newBoard[nr][nc] === playerVal)
                        affectedFriend.add(`${nr},${nc}`);
                }
            }
        }

        for (let key of affectedEnemy) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }

        for (let [r, c] of affectedFriend) {
            if (newBoard[r][c] === playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, playerVal);
        }

        return newBoard;
    }

    tryPlaceStonesAt(boardBefore, stoneCoords, playerVal, stoneOwners) {
        if (!stoneCoords || stoneCoords.length !== 3) return null;
        if (!stoneOwners || stoneOwners.length !== 3) return null;
        let oppN = 0;
        for (const o of stoneOwners) { if (o === 'opp') oppN++; }
        if (oppN !== 1) return null;

        for (let i = 0; i < stoneCoords.length; i++) {
            const [r, c] = stoneCoords[i];
            if (r < 0 || r >= this.boardSize || c < 0 || c >= this.boardSize) return null;
            if (boardBefore[r][c] !== 0) return null;
        }

        const newBoard = this.copyBoard(boardBefore);
        const affectedEnemy = new Set();
        const affectedFriend = new Set();
        for (let i = 0; i < stoneCoords.length; i++) {
            const [r, c] = stoneCoords[i];
            if (stoneOwners[i] === 'opp') {
                newBoard[r][c] = 3 - playerVal;
                affectedEnemy.add(`${r},${c}`);
            } else if (stoneOwners[i] === 'self') {
                newBoard[r][c] = playerVal;
                affectedFriend.add(`${r},${c}`);
            }
        }

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let [r, c] of stoneCoords) {
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                    if (newBoard[r][c] === playerVal && newBoard[nr][nc] === 3 - playerVal)
                        affectedEnemy.add(`${nr},${nc}`);
                    else if (newBoard[r][c] === 3 - playerVal && newBoard[nr][nc] === playerVal)
                        affectedFriend.add(`${nr},${nc}`);
                }
            }
        }
        for (let key of affectedEnemy) {
            const [r, c] = key.split(',').map(Number);
            if (newBoard[r][c] === 3 - playerVal && this.countGroupLiberties(newBoard, r, c) === 0)
                this.removeGroup(newBoard, r, c, 3 - playerVal);
        }
        for (let [r, c] of affectedFriend) {
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
        const KOMI = 2.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            komi: 2.25,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            lastUsedShapeByColor: this.lastUsedShapeByColor,
            moveCoords: this.moveCoords,
            komi: 2.25,
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

    compoundPass(slot) {
        const room = this.room;
        const passPlayerVal = this.currentPlayer === 1 ? 1 : 2;
        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
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
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;
        const owners = this.SHAPE_STONE_OWNERS;

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
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                if (this.lastUsedShapeByColor[playerVal] === shapeIndex) return;
                const newBoard = this.tryPlaceShape(this.board, shapeIndex, rotation, flipped, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.historyLastUsed.push({ 1: this.lastUsedShapeByColor[1], 2: this.lastUsedShapeByColor[2] });
                this.moveHistory.push(slot);
                this.board = newBoard;
                const coords = this.generatePlacementCoords(shapeIndex, rotation, flipped, row, col);
                const stoneList = coords.map(([r, c]) => [r, c]);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    stones: stoneList,
                    stoneOwners: [...owners]
                });
                this.lastMoveMarkers = coords.map(([r, c], i) => ({
                    row: r,
                    col: c,
                    color: owners[i] === 'opp' ? (3 - playerVal) : playerVal
                }));
                this.lastUsedShapeByColor[playerVal] = shapeIndex;
                this.currentPlayer = 3 - this.currentPlayer;
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
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '罗斯围棋',
            gameId: 'rus-weiqi',
            boardSize: this.boardSize,
            komi: 2.25,
            stoneEncoding: 'plusMinus',
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                return p + m.stones.map(([r, c], i) => {
                    const suf = m.stoneOwners[i] === 'opp' ? '-' : '+';
                    return `${r},${c}${suf}`;
                }).join(';');
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

    static normalizeMoveObject(entry) {
        if (typeof entry !== 'object' || entry === null || entry.type !== 'move') return entry;
        if (entry.stones && entry.stones.length === 3 && (!entry.stoneOwners || entry.stoneOwners.length !== 3)) {
            entry = { ...entry, stoneOwners: ['self', 'opp', 'self'] };
        }
        return entry;
    }

    static parseMove(entry) {
        if (typeof entry === 'object' && entry !== null) {
            return RusWeiqiRoom.normalizeMoveObject(entry);
        }
        const s = String(entry);
        const player = s[0] === 'B' ? 'black' : 'white';
        if (s[1] === 'p') return { type: 'pass', player };
        const rest = s.slice(1);
        const parts = rest.split(';').filter(Boolean);
        const stones = [];
        const stoneOwners = [];
        for (const part of parts) {
            const m = part.match(/^(\d+),(\d+)([+-])$/);
            if (!m) {
                return { type: 'invalid', message: '罗斯围棋棋谱每坐标须带 +（己方）或 -（对方）后缀。' };
            }
            stones.push([Number(m[1]), Number(m[2])]);
            stoneOwners.push(m[3] === '-' ? 'opp' : 'self');
        }
        return { type: 'move', player, stones, stoneOwners };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'rus-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要罗斯围棋棋谱）。' }));
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
        const moves = rawMoves.map(RusWeiqiRoom.parseMove);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            if (move.type === 'invalid') {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: move.message || `棋谱第${i + 1}手格式错误` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;

            if (move.type === 'move') {
                const stones = move.stones;
                const stoneOwners = move.stoneOwners;
                if (!stones || stones.length !== 3 || !stoneOwners || stoneOwners.length !== 3) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手缺少坐标或己方/对方标记` }));
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
                const newBoard = this.tryPlaceStonesAt(this.board, stones, playerVal, stoneOwners);
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
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    stones: stones.map(([r, c]) => [r, c]),
                    stoneOwners: [...stoneOwners]
                });
                this.board = newBoard;
                this.lastMoveMarkers = stones.map(([r, c], j) => ({
                    row: r,
                    col: c,
                    color: stoneOwners[j] === 'opp' ? (3 - playerVal) : playerVal
                }));
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
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
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
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => {
                    if (m.type === 'pass') return { type: 'pass', player: m.player };
                    return {
                        type: 'move',
                        player: m.player,
                        stones: m.stones.map(([r, c]) => [r, c]),
                        stoneOwners: [...m.stoneOwners]
                    };
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
        room.gameLogic = new RusWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
