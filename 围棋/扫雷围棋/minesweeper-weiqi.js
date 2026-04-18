const { QiTwoPlayerRoomBase, squareWeiqiRules } = require('../common');
class MinesweeperWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
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

    holeCountForBoard() {
        return Math.ceil(0.2 * this.boardSize * this.boardSize);
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    isBoardConnected(board) {
        const n = this.boardSize;
        const visited = Array(n).fill().map(() => Array(n).fill(false));
        let startRow = -1, startCol = -1;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== -1) {
                    startRow = r;
                    startCol = c;
                    break;
                }
            }
            if (startRow !== -1) break;
        }
        if (startRow === -1) return true;

        const queue = [[startRow, startCol]];
        visited[startRow][startCol] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < n && nc >= 0 && nc < n &&
                    !visited[nr][nc] && board[nr][nc] !== -1) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }

        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== -1 && !visited[r][c]) {
                    return false;
                }
            }
        }
        return true;
    }

    generateHolesAfterSecondMove() {
        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        if (stoneMoves.length < 2) return;

        const exclude = new Set([
            `${stoneMoves[0].row},${stoneMoves[0].col}`,
            `${stoneMoves[1].row},${stoneMoves[1].col}`
        ]);

        const HOLE_COUNT = this.holeCountForBoard();
        const MAX_ATTEMPTS = 100;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const points = [];
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const key = `${r},${c}`;
                    if (exclude.has(key)) continue;
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
                }
            }
            const selected = [];
            const temp = [...points];
            for (let i = 0; i < HOLE_COUNT && temp.length > 0; i++) {
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

            const trial = this.copyBoard(this.board);
            for (let h of selected) trial[h.r][h.c] = -1;

            if (this.isBoardConnected(trial)) {
                this.board = trial;
                this.holes = selected.map(h => ({ r: h.r, c: h.c }));
                this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
                return;
            }
        }

        console.warn(`扫雷围棋：${MAX_ATTEMPTS} 次尝试后仍未能生成连通洞分布，使用最后一次`);
        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const key = `${r},${c}`;
                if (!exclude.has(key))
                    points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const selected = [];
        const temp = [...points];
        for (let i = 0; i < HOLE_COUNT && temp.length > 0; i++) {
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
        for (let h of selected) this.board[h.r][h.c] = -1;
        this.holes = selected.map(h => ({ r: h.r, c: h.c }));
        this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
    }

    hasLiberty(board, row, col) {
        const v = board[row][col];
        if (v === 0 || v === -1) return false;
        return squareWeiqiRules.hasLiberty(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize,
            (b) => this.copyBoard(b), 1
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

    computeMinesweeperHints(board) {
        const hints = {};
        const dirs8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (board[r][c] !== 1 && board[r][c] !== 2) continue;
                let cnt = 0;
                for (let [dr, dc] of dirs8) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === -1)
                        cnt++;
                }
                if (cnt > 0) hints[`${r},${c}`] = cnt;
            }
        }
        return hints;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            minesweeperHints: this.computeMinesweeperHints(this.board),
            holesGenerated: this.holesGenerated,
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

    replaceLastHistorySnapshot() {
        if (this.historyBoards.length === 0) return;
        const last = this.historyBoards[this.historyBoards.length - 1];
        this.historyBoardSet.delete(this.boardToString(last));
        const next = this.copyBoard(this.board);
        this.historyBoards[this.historyBoards.length - 1] = next;
        this.historyBoardSet.add(this.boardToString(next));
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
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;

                if (this.board[row][col] === -1) {
                    this.board[row][col] = 0;
                    this.holes = this.holes.filter(h => !(h.r === row && h.c === col));
                    const afterRevealStr = this.boardToString(this.board);
                    if (this.historyBoardSet.has(afterRevealStr))
                        return;
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyBoardSet.add(afterRevealStr);
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'holeReveal', player: slot, row, col });
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    this.lastMoveMarkers = [];
                    this.broadcast({ type: 'broadcast', action: 'holeReveal', player: slot, ...this.getState() });
                    return;
                }

                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
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

                const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
                if (!this.holesGenerated && stoneMoves.length === 2) {
                    this.generateHolesAfterSecondMove();
                    this.holesGenerated = true;
                    this.replaceLastHistorySnapshot();
                }

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
                if (!opponent)
                    this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
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

            case 'editBoard':
                if (this.gameOver || this.historyBoards.length > 1) {
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
                        if (val !== -1 && val !== 0 && val !== 1 && val !== 2) {
                            ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                            return;
                        }
                    }
                }
                this.board = this.copyBoard(editedBoard);
                this.holes = [];
                for (let r = 0; r < this.boardSize; r++) {
                    for (let c = 0; c < this.boardSize; c++) {
                        if (this.board[r][c] === -1) this.holes.push({ r, c });
                    }
                }
                this.holesGenerated = this.holes.length > 0;
                this.snapshotHolesAfterGen = this.holesGenerated ? this.holes.map(h => ({ r: h.r, c: h.c })) : null;
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

            default:
                break;
        }
    }

    getInitialState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            minesweeperHints: this.computeMinesweeperHints(this.board),
            holesGenerated: this.holesGenerated,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: [],
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
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
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));

        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
        this.holes = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === -1) this.holes.push({ r, c });
            }
        }
        if (stoneMoves.length >= 2 && this.holes.length > 0) {
            this.holesGenerated = true;
            this.snapshotHolesAfterGen = this.holes.map(h => ({ r: h.r, c: h.c }));
        }

        this.broadcast({ type: 'broadcast', action: 'undoAccept', undoSteps: steps, ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
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
        for (let [client, slot] of this.room.players.entries()) {
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
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        const stoneMoves = this.moveCoords.filter(m => m.type === 'move');
        let initialPosition = { black: [], white: [], holes: [] };
        const encodeMove = (m) => {
            const p = m.player === 'black' ? 'B' : 'W';
            if (m.type === 'pass') return p + 'p';
            if (m.type === 'holeReveal') return p + 'h' + m.row + ',' + m.col;
            return p + m.row + ',' + m.col;
        };

        let movesForExport = this.moveCoords.map(encodeMove);

        if (stoneMoves.length >= 2 && this.snapshotHolesAfterGen && this.snapshotHolesAfterGen.length > 0) {
            initialPosition.black = [[stoneMoves[0].row, stoneMoves[0].col]];
            initialPosition.white = [[stoneMoves[1].row, stoneMoves[1].col]];
            initialPosition.holes = this.snapshotHolesAfterGen.map(h => [h.r, h.c]);
            movesForExport = this.moveCoords.slice(2).map(encodeMove);
        }

        return {
            format: 'muzei',
            version: 1,
            gameType: '扫雷围棋',
            gameId: 'minesweeper-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition,
            moves: movesForExport,
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.holes = [];
        this.holesGenerated = false;
        this.snapshotHolesAfterGen = null;
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
            if (entry[1] === 'h') {
                const coords = entry.substring(2).split(',').map(Number);
                return { type: 'holeReveal', player, row: coords[0], col: coords[1] };
            }
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'minesweeper-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要扫雷围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        const ip = data.initialPosition || {};
        if (Array.isArray(ip.black)) {
            for (const pos of ip.black) {
                if (Array.isArray(pos) && pos.length === 2) {
                    const [r, c] = pos;
                    if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
                        this.board[r][c] = 1;
                }
            }
        }
        if (Array.isArray(ip.white)) {
            for (const pos of ip.white) {
                if (Array.isArray(pos) && pos.length === 2) {
                    const [r, c] = pos;
                    if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
                        this.board[r][c] = 2;
                }
            }
        }
        if (Array.isArray(ip.holes)) {
            for (const pos of ip.holes) {
                if (Array.isArray(pos) && pos.length === 2) {
                    const [r, c] = pos;
                    if (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
                        this.board[r][c] = -1;
                }
            }
        }
        this.holes = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === -1) this.holes.push({ r, c });
            }
        }
        this.holesGenerated = this.holes.length > 0;
        this.snapshotHolesAfterGen = this.holesGenerated ? this.holes.map(h => ({ r: h.r, c: h.c })) : null;

        this.historyBoards = [this.copyBoard(this.board)];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(MinesweeperWeiqiRoom.parseMove);
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
            } else if (move.type === 'holeReveal') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.board[row][col] !== -1) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手踩洞与局面不符` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.board[row][col] = 0;
                this.holes = this.holes.filter(h => !(h.r === row && h.c === col));
                const afterStr = this.boardToString(this.board);
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(afterStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'holeReveal', player: slot, row, col });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.lastMoveMarkers = [];
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
                initialPosition: data.initialPosition || { black: [], white: [], holes: [] },
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
        room.gameLogic = new MinesweeperWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
