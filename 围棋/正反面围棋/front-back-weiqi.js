const { QiTwoPlayerRoomBase, squareWeiqiRules } = require('../common');
class FrontBackWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 15;
        this.boardA = this.emptyBoard();
        this.boardB = this.emptyBoard();
        this.holesA = [];
        this.holesB = [];
        /** 下一手序号（从 1 起）；第一手为黑 @ A */
        this.nextMoveNumber = 1;
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.positionHistorySet = new Set();
        this.historySnapshots = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;

        this.pushSnapshot();
        this.positionHistorySet.add(this.stateToString());
    }

    emptyBoard() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
    }
    copyHoles(src) { return src.map(p => ({ row: p.row, col: p.col })); }

    expectedSlot() {
        const m = this.nextMoveNumber % 4;
        return m === 0 || m === 1 ? 'black' : 'white';
    }

    /** 'A' 或 'B' */
    expectedBoard() {
        const m = this.nextMoveNumber % 4;
        return m === 1 || m === 2 ? 'A' : 'B';
    }

    isHole(holes, row, col) {
        return holes.some(p => p.row === row && p.col === col);
    }

    isLibertyEmpty(nr, nc, board, holes) {
        if (board[nr][nc] !== 0) return false;
        return !this.isHole(holes, nr, nc);
    }

    countGroupLiberties(board, holes, row, col) {
        const color = board[row][col];
        if (color === 0) return 0;
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const liberties = new Set();
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (this.isLibertyEmpty(nr, nc, board, holes)) liberties.add(nr + ',' + nc);
                else if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    }

    removeGroup(board, row, col, color) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    tryPlaceStone(board, holes, row, col, playerVal) {
        if (board[row][col] !== 0) return null;
        if (this.isHole(holes, row, col)) return null;
        const newBoard = this.copyBoard(board);
        newBoard[row][col] = playerVal;
        const enemyColor = 3 - playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (let [dr, dc] of dirs) {
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && newBoard[nr][nc] === enemyColor) {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) {
                    checkedEnemy.add(key);
                    if (this.countGroupLiberties(newBoard, holes, nr, nc) < 1) {
                        this.removeGroup(newBoard, nr, nc, enemyColor);
                    }
                }
            }
        }

        if (this.countGroupLiberties(newBoard, holes, row, col) < 1) {
            this.removeGroup(newBoard, row, col, playerVal);
        }

        return newBoard;
    }

    stateToString() {
        const ba = this.boardA.map(row => row.join(',')).join(';');
        const bb = this.boardB.map(row => row.join(',')).join(';');
        const ha = this.holesA.map(p => `${p.row},${p.col}`).sort().join('|');
        const hb = this.holesB.map(p => `${p.row},${p.col}`).sort().join('|');
        return `${ba}#${bb}#${ha}#${hb}`;
    }

    applyStoneMove(which, row, col, playerVal) {
        const board = which === 'A' ? this.boardA : this.boardB;
        const holesOnPlayed = which === 'A' ? this.holesA : this.holesB;
        const holesOnOther = which === 'A' ? this.holesB : this.holesA;

        const newBoard = this.tryPlaceStone(board, holesOnPlayed, row, col, playerVal);
        if (!newBoard) return null;

        const newHolesPlayed = this.copyHoles(holesOnPlayed);
        const newHolesOther = this.copyHoles(holesOnOther);
        if (!this.isHole(newHolesOther, row, col)) newHolesOther.push({ row, col });

        const newBoardA = which === 'A' ? newBoard : this.copyBoard(this.boardA);
        const newBoardB = which === 'B' ? newBoard : this.copyBoard(this.boardB);
        const newHolesA = which === 'A' ? newHolesPlayed : newHolesOther;
        const newHolesB = which === 'B' ? newHolesPlayed : newHolesOther;

        return { newBoardA, newBoardB, newHolesA, newHolesB };
    }

    tryApplyMove(which, row, col, playerVal) {
        const applied = this.applyStoneMove(which, row, col, playerVal);
        if (!applied) return null;
        const nextStr = (() => {
            const ba = applied.newBoardA.map(row => row.join(',')).join(';');
            const bb = applied.newBoardB.map(row => row.join(',')).join(';');
            const ha = applied.newHolesA.map(p => `${p.row},${p.col}`).sort().join('|');
            const hb = applied.newHolesB.map(p => `${p.row},${p.col}`).sort().join('|');
            return `${ba}#${bb}#${ha}#${hb}`;
        })();
        if (this.positionHistorySet.has(nextStr)) return null;
        return { ...applied, nextStr };
    }

    pushSnapshot() {
        this.historySnapshots.push({
            boardA: this.copyBoard(this.boardA),
            boardB: this.copyBoard(this.boardB),
            holesA: this.copyHoles(this.holesA),
            holesB: this.copyHoles(this.holesB),
            nextMoveNumber: this.nextMoveNumber,
            passCounter: this.passCounter,
            lastMoveMarkers: this.copyMarkers(this.lastMoveMarkers)
        });
    }

    copyMarkers(m) {
        return m.map(x => ({ board: x.board, row: x.row, col: x.col, color: x.color }));
    }

    getState() {
        return {
            boardSize: this.boardSize,
            boardA: this.boardA,
            boardB: this.boardB,
            holesA: this.holesA,
            holesB: this.holesB,
            nextMoveNumber: this.nextMoveNumber,
            expectedBoard: this.expectedBoard(),
            expectedSlot: this.expectedSlot(),
            numberOfHands: this.nextMoveNumber,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            passCounter: this.passCounter,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    // ---------- 形势判断（洞不可作气/穿行；squareWeiqiRules 洞点扩展） ----------
    computeOfficialScoreOne(board, holes) {
        const isHole = (r, c) => this.isHole(holes, r, c);
        const liveBoard = squareWeiqiRules.removeDeadAndDyingWithHoles(
            this.copyBoard(board), this.boardSize, (b) => this.copyBoard(b), isHole
        );
        const territory = squareWeiqiRules.assignTerritoryWithRangeWithHoles(liveBoard, this.boardSize, isHole);
        return squareWeiqiRules.computeScoreWithHoles(liveBoard, territory, this.boardSize, isHole);
    }

    computeLead() {
        const a = this.computeOfficialScoreOne(this.boardA, this.holesA);
        const b = this.computeOfficialScoreOne(this.boardB, this.holesB);
        const blackTotal = a.blackTotal + b.blackTotal;
        const whiteTotal = a.whiteTotal + b.whiteTotal;
        const lead = blackTotal - whiteTotal;
        return { blackTotal, whiteTotal, lead, boardA: a, boardB: b };
    }

    startScoreCounting(requester, opponent) {
        const { blackTotal, whiteTotal, lead, boardA, boardB } = this.computeLead();
        this.scoreProposalData = { lead, blackTotal, whiteTotal, boardA, boardB, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead, blackTotal, whiteTotal, boardA, boardB };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    resetToEmpty() {
        this.boardA = this.emptyBoard();
        this.boardB = this.emptyBoard();
        this.holesA = [];
        this.holesB = [];
        this.nextMoveNumber = 1;
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.positionHistorySet = new Set();
        this.historySnapshots = [];
        this.pushSnapshot();
        this.positionHistorySet.add(this.stateToString());
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 19) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasStone = this.boardA.some(row => row.some(v => v !== 0)) || this.boardB.some(row => row.some(v => v !== 0));
        const hasHole = this.holesA.length > 0 || this.holesB.length > 0;
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasStone || hasHole || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子、洞或玩家，不能改变棋盘大小' }));
            return false;
        }
        this.boardSize = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    performUndoOneStep() {
        if (this.historySnapshots.length <= 1) return;
        this.historySnapshots.pop();
        const prev = this.historySnapshots[this.historySnapshots.length - 1];
        this.boardA = this.copyBoard(prev.boardA);
        this.boardB = this.copyBoard(prev.boardB);
        this.holesA = this.copyHoles(prev.holesA);
        this.holesB = this.copyHoles(prev.holesB);
        this.nextMoveNumber = prev.nextMoveNumber;
        this.passCounter = prev.passCounter;
        this.lastMoveMarkers = this.copyMarkers(prev.lastMoveMarkers);
        if (this.moveCoords.length > 0) this.moveCoords.pop();
        this.gameOver = false;
        this.winner = null;
        this.positionHistorySet = new Set();
        for (let i = 0; i < this.historySnapshots.length; i++) {
            const s = this.historySnapshots[i];
            const ba = s.boardA.map(row => row.join(',')).join(';');
            const bb = s.boardB.map(row => row.join(',')).join(';');
            const ha = s.holesA.map(p => `${p.row},${p.col}`).sort().join('|');
            const hb = s.holesB.map(p => `${p.row},${p.col}`).sort().join('|');
            this.positionHistorySet.add(`${ba}#${bb}#${ha}#${hb}`);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    resetGame() {
        this.resetToEmpty();
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '正反面围棋',
            gameId: 'front-back-weiqi',
            boardSize: this.boardSize,
            players: { black: null, white: null },
            moves: this.moveCoords.map(m => {
                if (m.type === 'pass') return (m.player === 'black' ? 'B' : 'W') + 'p';
                return `${m.player === 'black' ? 'B' : 'W'}${m.board}${m.row},${m.col}`;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    static parseMoveEntry(str) {
        if (typeof str === 'object' && str !== null) return str;
        if (str.endsWith('p')) {
            return { type: 'pass', player: str[0] === 'B' ? 'black' : 'white' };
        }
        const player = str[0] === 'B' ? 'black' : 'white';
        const board = str[1];
        const rest = str.slice(2);
        const [r, c] = rest.split(',').map(Number);
        return { type: 'move', player, board, row: r, col: c };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'front-back-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要正反面围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 15;
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 19) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }
        this.boardSize = newSize;
        this.resetToEmpty();

        const raw = data.moves || [];
        for (let i = 0; i < raw.length; i++) {
            const m = FrontBackWeiqiRoom.parseMoveEntry(raw[i]);
            const slot = m.player;
            const expected = this.expectedSlot();
            if (slot !== expected) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手行棋方与规则不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (m.type === 'pass') {
                this.passCounter++;
                this.nextMoveNumber++;
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastMoveMarkers = [];
                this.pushSnapshot();
                if (this.passCounter >= 4) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    break;
                }
                continue;
            }
            const wb = this.expectedBoard();
            if (m.board !== wb) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手盘面与规则不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const playerVal = slot === 'black' ? 1 : 2;
            const trial = this.tryApplyMove(m.board, m.row, m.col, playerVal);
            if (!trial) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.boardA = trial.newBoardA;
            this.boardB = trial.newBoardB;
            this.holesA = trial.newHolesA;
            this.holesB = trial.newHolesB;
            this.positionHistorySet.add(trial.nextStr);
            this.lastMoveMarkers = [{ board: m.board, row: m.row, col: m.col, color: playerVal }];
            this.nextMoveNumber++;
            this.passCounter = 0;
            this.moveCoords.push({ type: 'move', board: m.board, row: m.row, col: m.col, player: slot });
            this.pushSnapshot();
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { moves: this.moveCoords.map(m => ({ ...m })) }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

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

            case 'move':
                if (this.gameOver) return;
                if (!slot) return;
                if (slot !== this.expectedSlot()) return;
                const { row, col, board: which } = msg;
                const wb = this.expectedBoard();
                if (which !== wb) return;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                const playerVal = slot === 'black' ? 1 : 2;
                const trial = this.tryApplyMove(which, row, col, playerVal);
                if (!trial) return;
                this.boardA = trial.newBoardA;
                this.boardB = trial.newBoardB;
                this.holesA = trial.newHolesA;
                this.holesB = trial.newHolesB;
                this.positionHistorySet.add(trial.nextStr);
                this.lastMoveMarkers = [{ board: which, row, col, color: playerVal }];
                this.nextMoveNumber++;
                this.passCounter = 0;
                this.moveCoords.push({ type: 'move', board: which, row, col, player: slot });
                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot) return;
                if (slot !== this.expectedSlot()) return;
                this.passCounter++;
                this.nextMoveNumber++;
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastMoveMarkers = [];
                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                if (this.passCounter >= 4) {
                    const bp = room.getPlayerBySlot('black');
                    const wp = room.getPlayerBySlot('white');
                    if (bp && wp) this.startScoreCounting(bp, wp);
                    else {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                if (this.moveCoords.length === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!undoOpponent) this.performUndoOneStep();
                else {
                    this.pendingUndo = { requester: ws, opponent: undoOpponent };
                    undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndoOneStep();
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
                else if (this.pendingNewGame && !msg.accept) this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
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
                if (this.pendingEnd && msg.accept) this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept) this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (!this.pendingScore || (ws !== this.pendingScore.requester && ws !== this.pendingScore.opponent)) break;
                if (!msg.accept) {
                    this.broadcast({ type: 'scoreRejected' });
                    this.pendingScore = null;
                    this.scoreProposalData = null;
                    break;
                }
                this.pendingScore.agreed.add(ws);
                if (this.pendingScore.agreed.size === 2) {
                    const { lead, blackTotal, whiteTotal } = this.scoreProposalData;
                    this.gameOver = true;
                    this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                    this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead, blackTotal, whiteTotal });
                    this.pendingScore = null;
                    this.scoreProposalData = null;
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

    getMoveCount() {
        return this.moveCoords.length;
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
        room.gameLogic = new FrontBackWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
