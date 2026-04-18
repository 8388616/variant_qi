const { QiTwoPlayerRoomBase } = require('../common');
class ChoiceWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.candidates = [];
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.generateCandidates();
    }

    getEmptyCells() {
        const empty = [];
        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                if (this.board[r][c] === 0) empty.push({ row: r, col: c });
            }
        }
        return empty;
    }

    getWeight(row, col) {
        const center = (this.BOARD_SIZE - 1) / 2;
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        const maxd = Math.floor(this.BOARD_SIZE / 2);
        const weights = [];
        for (let i = 0; i <= maxd; i++) weights.push(maxd + 1 - i);
        return weights[Math.min(d, weights.length - 1)] || 1;
    }

    generateCandidates() {
        const empty = this.getEmptyCells();
        if (empty.length < 3) {
            this.candidates = [];
            return;
        }

        const weightedPoints = empty.map(point => ({
            ...point,
            weight: this.getWeight(point.row, point.col)
        }));

        const candidates = [];
        const remaining = [...weightedPoints];
        for (let i = 0; i < 3; i++) {
            if (remaining.length === 0) break;
            let totalWeight = 0;
            for (const p of remaining) totalWeight += p.weight;
            let rand = Math.random() * totalWeight;
            let accum = 0;
            let selectedIndex = -1;
            for (let j = 0; j < remaining.length; j++) {
                accum += remaining[j].weight;
                if (rand <= accum) {
                    selectedIndex = j;
                    break;
                }
            }
            if (selectedIndex === -1) selectedIndex = remaining.length - 1;
            const selected = remaining[selectedIndex];
            candidates.push({ row: selected.row, col: selected.col });
            remaining.splice(selectedIndex, 1);
        }
        this.candidates = candidates;
    }

    getMoveCount() {
        return this.moveLog.length;
    }

    checkWin(row, col, colorVal) {
        if (this.board[row][col] !== colorVal) return false;
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                let nr = row + dx * step, nc = col + dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                let nr = row - dx * step, nc = col - dy * step;
                if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    serializeMoveLog() {
        return this.moveLog.map(m => ({
            player: m.player,
            row: m.row,
            col: m.col,
            candidatesBefore: m.candidatesBefore.map(c => ({ row: c.row, col: c.col }))
        }));
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            currentPlayer: this.currentPlayer,
            numberOfHands: 1 + this.moveLog.length,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            candidates: this.candidates,
            moveLog: this.serializeMoveLog(),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    /**
     * 紧凑棋谱串：行棋方 B/W + 落子坐标 @ 本手之前的三个候选点，例如 B3,4@5,7;5,8;5,9
     * 候选点顺序须与当回合可选点一致。
     */
    static encodeMove(m) {
        const p = m.player === 'black' ? 'B' : 'W';
        const cands = m.candidatesBefore.map(c => `${c.row},${c.col}`).join(';');
        return `${p}${m.row},${m.col}@${cands}`;
    }

    /** 解析棋谱：支持紧凑字符串或 JSON 对象（player / row / col / candidatesBefore） */
    static parseMoveEntry(entry) {
        if (entry && typeof entry === 'object' && entry.player != null) {
            const row = Number(entry.row);
            const col = Number(entry.col);
            if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
            const cb = entry.candidatesBefore;
            if (!Array.isArray(cb) || cb.length < 1) return null;
            const candidatesBefore = [];
            for (const c of cb) {
                if (!c) return null;
                const cr = Number(c.row);
                const cc = Number(c.col);
                if (!Number.isFinite(cr) || !Number.isFinite(cc)) return null;
                candidatesBefore.push({ row: cr, col: cc });
            }
            const pl = entry.player === 'black' || entry.player === 'white' ? entry.player : null;
            if (!pl) return null;
            return { player: pl, row, col, candidatesBefore };
        }
        if (typeof entry !== 'string') return null;
        const at = entry.indexOf('@');
        if (at === -1) return null;
        const head = entry.slice(0, at);
        const tail = entry.slice(at + 1).trim();
        if (head.length < 3 || (head[0] !== 'B' && head[0] !== 'W')) return null;
        const comma = head.indexOf(',');
        if (comma <= 1) return null;
        const row = Number(head.slice(1, comma));
        const col = Number(head.slice(comma + 1));
        if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
        const player = head[0] === 'B' ? 'black' : 'white';
        const candidatesBefore = [];
        for (const seg of tail.split(';')) {
            const s = seg.trim();
            if (!s) continue;
            const parts = s.split(',');
            if (parts.length !== 2) return null;
            const r = Number(parts[0].trim());
            const c = Number(parts[1].trim());
            if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
            candidatesBefore.push({ row: r, col: c });
        }
        if (candidatesBefore.length < 1) return null;
        return { player, row, col, candidatesBefore };
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '选点五子棋',
            gameId: 'choice-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveLog.map(m => ChoiceWuziqiRoom.encodeMove(m)),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.generateCandidates();
    }

    setBoardSize(newSize, requesterWs) {
        const n = parseInt(newSize, 10);
        if (!Number.isFinite(n) || n < 7 || n > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            return false;
        }
        this.BOARD_SIZE = n;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'choice-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式错误或不是选点五子棋。' }));
            return;
        }
        const newSize = data.boardSize || 13;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中的棋盘大小无效。' }));
            return;
        }

        const rawMoves = data.moves || [];
        this.BOARD_SIZE = newSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.moveLog = [];
        this.candidates = [];
        this.generateCandidates();

        for (let i = 0; i < rawMoves.length; i++) {
            const m = ChoiceWuziqiRoom.parseMoveEntry(rawMoves[i]);
            if (!m) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手无法解析` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = m.player;
            if (slot !== this.currentPlayer) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手行棋方与预期不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const cb = m.candidatesBefore;
            this.candidates = cb.map(c => ({ row: c.row, col: c.col }));
            const { row, col } = m;
            if (!this.candidates.some(c => c.row === row && c.col === col)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手落子不在当回合候选点内` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE || this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手落子位置非法` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            this.moveLog.push({
                player: slot,
                row,
                col,
                candidatesBefore: this.candidates.map(c => ({ row: c.row, col: c.col }))
            });

            this.historyBoards.push(this.copyBoard(this.board));
            const playerVal = slot === 'black' ? 1 : 2;
            this.board[row][col] = playerVal;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];

            if (this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                break;
            }

            this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
            const empty = this.getEmptyCells();
            if (empty.length === 0) {
                this.gameOver = true;
                this.winner = 'draw';
                break;
            }
            this.generateCandidates();
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        const payload = {
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                moves: this.moveLog.map(m => ChoiceWuziqiRoom.encodeMove(m))
            }
        };
        const json = JSON.stringify(payload);
        // 导入请求方可能尚未被加入 observers（例如 join 与 import 竞态），仅靠 broadcast 会收不到消息
        try {
            if (requesterWs.readyState === 1) requesterWs.send(json);
        } catch (e) { /* ignore */ }
        this.broadcast(payload, requesterWs);
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
                    ws.send(JSON.stringify({ type: 'error', message: '无法选择该颜色。）' }));
                }
                break;

            case 'setBoardSize':
                this.setBoardSize(msg.size, ws);
                break;

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局中无法导入棋谱。' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== this.currentPlayer) return;
                const { row, col } = msg;
                if (!this.candidates.some(c => c.row === row && c.col === col)) return;
                if (this.board[row][col] !== 0) return;

                const candidatesBefore = this.candidates.map(c => ({ row: c.row, col: c.col }));
                this.moveLog.push({ player: slot, row, col, candidatesBefore });

                this.historyBoards.push(this.copyBoard(this.board));

                const playerVal = this.currentPlayer === 'black' ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                if (this.checkWin(row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = this.currentPlayer;
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        ...this.getState()
                    });
                    return;
                }

                this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';

                const empty = this.getEmptyCells();
                if (empty.length === 0) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        ...this.getState()
                    });
                    return;
                }

                this.generateCandidates();

                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    ...this.getState()
                });
                break;

            case 'requestUndo':
                if (!slot) return;
                if (this.gameOver) return;
                const undoOpponentSlot = slot === 'black' ? 'white' : 'black';
                const undoOpponent = room.getPlayerBySlot(undoOpponentSlot);
                if (!undoOpponent) {
                    if (this.historyBoards.length > 0) {
                        this.board = this.copyBoard(this.historyBoards.pop());
                        this.moveLog.pop();
                        this.lastMoveMarkers = [];
                        this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                        this.gameOver = false;
                        this.winner = null;
                        this.generateCandidates();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            ...this.getState()
                        });
                    }
                    return;
                }
                this.pendingUndo = ws;
                undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) {
                        if (this.historyBoards.length > 0) {
                            this.board = this.copyBoard(this.historyBoards.pop());
                            this.moveLog.pop();
                            this.lastMoveMarkers = [];
                            this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                            this.gameOver = false;
                            this.winner = null;
                            this.generateCandidates();
                            this.broadcast({
                                type: 'broadcast',
                                action: 'undoAccept',
                                ...this.getState()
                            });
                        }
                    } else {
                        this.pendingUndo.send(JSON.stringify({ type: 'error', message: '对方拒绝了悔棋。' }));
                    }
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: slot,
                    ...this.getState()
                });
                break;

            case 'requestNewGame':
                if (!slot) return;
                if (this.pendingNewGame) return;
                const newGameOpponentSlot = slot === 'black' ? 'white' : 'black';
                const newGameOpponent = room.getPlayerBySlot(newGameOpponentSlot);
                if (!newGameOpponent) {
                    this.resetGame();
                    // 无对手时直接 newGameStarted：清空座位并通知所有客户端
                    this.broadcast({
                        type: 'newGameStarted',
                        ...this.getState(),
                        slots: { black: false, white: false }
                    });
                    const toRelease = [...room.players.entries()];
                    for (const [client, oldSlot] of toRelease) {
                        room.players.delete(client);
                        room.slotOccupancy.delete(oldSlot);
                        client.send(JSON.stringify({ type: 'slotReleased', slot: oldSlot }));
                    }
                    return;
                }
                this.pendingNewGame = ws;
                newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                    this.broadcast({
                        type: 'newGameStarted',
                        ...this.getState(),
                        slots: { black: false, white: false }
                    });
                    const toRelease = [...room.players.entries()];
                    for (const [client, oldSlot] of toRelease) {
                        room.players.delete(client);
                        room.slotOccupancy.delete(oldSlot);
                        client.send(JSON.stringify({ type: 'slotReleased', slot: oldSlot }));
                    }
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝了新开一局。' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot) return;
                if (this.gameOver) return;
                const drawOpponentSlot = slot === 'black' ? 'white' : 'black';
                const drawOpponent = room.getPlayerBySlot(drawOpponentSlot);
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({
                        type: 'drawAgreed',
                        ...this.getState()
                    });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({
                        type: 'drawAgreed',
                        ...this.getState()
                    });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝了和棋。' }));
                }
                this.pendingDraw = null;
                break;

            default:
                break;
        }
    }

    resetGame() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.moveLog = [];
        this.generateCandidates();
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) {
            this.room.broadcast({ type: 'playerLeft', slot });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new ChoiceWuziqiRoom(room);
        room.maxPlayers = 2;
    }
};
