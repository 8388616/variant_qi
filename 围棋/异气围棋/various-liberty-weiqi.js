'use strict';

const { QiTwoPlayerRoomBase, squareWeiqiRules, applyInitialPositionCompact } = require('../common');

const BACKPACK_CAP = 8;

function initialBag() {
    return [1, 1, 2, 2, 3, 3, 4, 4];
}

function copyBoard(src) {
    return src.map(row => row.slice());
}

function copyLevelBoard(boardSize) {
    return Array(boardSize).fill().map(() => Array(boardSize).fill(0));
}

function collectGroup(board, levelBoard, boardSize, startR, startC) {
    const color = board[startR][startC];
    if (color === 0) return null;
    const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const queue = [[startR, startC]];
    visited[startR][startC] = true;
    const stones = [];
    const libSet = new Set();
    while (queue.length) {
        const [r, c] = queue.shift();
        stones.push([r, c]);
        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
            if (board[nr][nc] === 0) {
                libSet.add(nr + ',' + nc);
            } else if (board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push([nr, nc]);
            }
        }
    }
    const libertyCount = libSet.size;
    let sumLevel = 0;
    for (const [r, c] of stones) sumLevel += levelBoard[r][c];
    return { stones, libertyCount, sumLevel, color };
}

function removeGroupWithLevels(board, levelBoard, row, col, color, boardSize) {
    const queue = [[row, col]];
    board[row][col] = 0;
    levelBoard[row][col] = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
        const [r, c] = queue.shift();
        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                board[nr][nc] = 0;
                levelBoard[nr][nc] = 0;
                queue.push([nr, nc]);
            }
        }
    }
}

function removeFailingGroupsOfColor(board, levelBoard, boardSize, targetColor) {
    let changed = true;
    while (changed) {
        changed = false;
        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (board[r][c] !== targetColor || visited[r][c]) continue;
                const g = collectGroup(board, levelBoard, boardSize, r, c);
                if (!g) continue;
                for (const [rr, cc] of g.stones) visited[rr][cc] = true;
                const { libertyCount, stones, sumLevel } = g;
                if (libertyCount * stones.length < sumLevel) {
                    removeGroupWithLevels(board, levelBoard, r, c, targetColor, boardSize);
                    changed = true;
                }
            }
        }
    }
}

/**
 * 落子并依异气规则提子：先对方、再己方。
 */
function tryPlaceStoneVariousLiberty(board, levelBoard, boardSize, row, col, playerVal, level) {
    if (board[row][col] !== 0) return null;
    const newBoard = copyBoard(board);
    const newLevel = copyBoard(levelBoard);
    newBoard[row][col] = playerVal;
    newLevel[row][col] = level;

    const enemyColor = 3 - playerVal;
    removeFailingGroupsOfColor(newBoard, newLevel, boardSize, enemyColor);
    removeFailingGroupsOfColor(newBoard, newLevel, boardSize, playerVal);

    if (newBoard[row][col] === 0) return null;
    return { board: newBoard, levelBoard: newLevel };
}

function replenishAfterPly(bag, moveNumber) {
    if (bag.length >= BACKPACK_CAP) return;
    const r = moveNumber % 8;
    let level;
    if (r === 0 || r === 1) level = 1;
    else if (r === 2 || r === 3) level = 2;
    else if (r === 4 || r === 5) level = 3;
    else level = 4;
    bag.push(level);
    bag.sort((a, b) => a - b);
}

/** 从已排序背包中移除该等级的第一枚（同等级棋子等价） */
function removeFirstOfLevel(bag, level) {
    const i = bag.indexOf(level);
    if (i === -1) return false;
    bag.splice(i, 1);
    return true;
}

function encodeMoveToRecordString(m) {
    const prefix = m.player === 'black' ? 'B' : 'W';
    if (m.type === 'pass') return `${prefix}p`;
    return `${prefix}${m.row},${m.col},${m.level}`;
}

class VariousLibertyWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet = new Set();
        /** 与 historyStacks 对齐：仅落子步对应禁全同哈希，虚着为 null */
        this.koStack = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
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

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color, level: m.level }));
    }

    boardToString(board, levelBoard) {
        const rows = [];
        for (let r = 0; r < this.boardSize; r++) {
            const cells = [];
            for (let c = 0; c < this.boardSize; c++) {
                cells.push(`${board[r][c]}:${levelBoard[r][c]}`);
            }
            rows.push(cells.join(','));
        }
        return rows.join(';');
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
            levelBoard: this.levelBoard,
            blackBag: [...this.blackBag],
            whiteBag: [...this.whiteBag],
            komi: 3.25,
            numberOfHands: 1 + this.historyStacks.length,
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

    pushSnapshot() {
        this.historyStacks.push({
            board: copyBoard(this.board),
            levelBoard: copyBoard(this.levelBoard),
            blackBag: [...this.blackBag],
            whiteBag: [...this.whiteBag]
        });
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyStacks.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyStacks.length > 0) {
                this.historyStacks.pop();
                const ko = this.koStack.pop();
                if (ko) this.historyBoardSet.delete(ko);
            }
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historyStacks.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.levelBoard = copyLevelBoard(this.boardSize);
            this.blackBag = initialBag();
            this.whiteBag = initialBag();
        } else {
            const s = this.historyStacks[this.historyStacks.length - 1];
            this.board = copyBoard(s.board);
            this.levelBoard = copyBoard(s.levelBoard);
            this.blackBag = [...s.blackBag];
            this.whiteBag = [...s.whiteBag];
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.currentPlayer = 1;
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
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

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '异气围棋',
            gameId: 'various-liberty-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => encodeMoveToRecordString(m)),
            result: this.gameOver ? this.winner : null
        };
    }

    /**
     * 每步为字符串：Bp / Wp 表示虚着；B3,5,3 表示黑在 (3,5) 用 3 级子。
     */
    static parseMoveString(entry) {
        if (typeof entry !== 'string' || entry.length < 2) return null;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        const rest = entry.slice(1);
        const parts = rest.split(',');
        if (parts.length < 3) return null;
        const row = parseInt(parts[0], 10);
        const col = parseInt(parts[1], 10);
        const level = parseInt(parts[2], 10);
        if (!Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(level)) return null;
        return { type: 'move', player, row, col, level };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'various-liberty-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要异气围棋棋谱）。' }));
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
        const moves = [];
        for (let j = 0; j < rawMoves.length; j++) {
            const parsed = VariousLibertyWeiqiRoom.parseMoveString(rawMoves[j]);
            if (!parsed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱解析失败：第${j + 1}手格式无效` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            moves.push(parsed);
        }

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            const bag = slot === 'black' ? this.blackBag : this.whiteBag;

            if (move.type === 'move') {
                const { row, col, level } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (level < 1 || level > 4 || !removeFirstOfLevel(bag, level)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手背包中无该等级棋子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                const placed = tryPlaceStoneVariousLiberty(
                    this.board, this.levelBoard, this.boardSize, row, col, playerVal, level
                );
                if (!placed) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.board = placed.board;
                this.levelBoard = placed.levelBoard;

                const newBoardStr = this.boardToString(this.board, this.levelBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                this.historyBoardSet.add(newBoardStr);
                this.koStack.push(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    level
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal, level }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.pushSnapshot();
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.koStack.push(null);
                this.pushSnapshot();
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
                moves: this.moveCoords.map(m => encodeMoveToRecordString(m))
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
                if (!slot && !this.room.players.size) this.setBoardSize(msg.size, ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { row, col, level } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                if (!Number.isInteger(level) || level < 1 || level > 4) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const bag = playerVal === 1 ? this.blackBag : this.whiteBag;
                if (bag.length === 0) return;
                if (!removeFirstOfLevel(bag, level)) return;

                const placed = tryPlaceStoneVariousLiberty(
                    this.board, this.levelBoard, this.boardSize, row, col, playerVal, level
                );
                if (!placed) {
                    bag.push(level);
                    bag.sort((a, b) => a - b);
                    return;
                }

                const newBoardStr = this.boardToString(placed.board, placed.levelBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    bag.push(level);
                    bag.sort((a, b) => a - b);
                    return;
                }

                this.board = placed.board;
                this.levelBoard = placed.levelBoard;

                this.historyBoardSet.add(newBoardStr);
                this.koStack.push(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    level
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal, level }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;

                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];

                const nPass = this.moveCoords.length;
                const bagPass = slot === 'black' ? this.blackBag : this.whiteBag;
                replenishAfterPly(bagPass, nPass);

                this.koStack.push(null);
                this.pushSnapshot();
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
                if (steps === 0 || steps > this.historyStacks.length) {
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
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new VariousLibertyWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
