class GuessWuziqiRoom {
    constructor(room) {
        this.room = room;
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveCount = 0;
        this.gameOver = false;
        this.phase = 'select';
        this.selectedMove = null;
        this.guessCandidates = [];
        this.rightGuessPoint = null;
        this.wrongGuessPoint = null;
        this.candidates = [];
        this.eventLog = [];
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.winner = null;
        this.generateCandidates();
    }

    copyBoard(src) {
        return src.map(row => row.slice());
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
        return this.eventLog.length;
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

    getEventLogForWire() {
        return this.eventLog.map(e => ({
            ...e,
            candidatesBefore: e.candidatesBefore ? e.candidatesBefore.map(c => ({ row: c.row, col: c.col })) : undefined
        }));
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            currentPlayer: this.currentPlayer,
            numberOfHands: 1 + this.historyBoards.length,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            phase: this.phase,
            selectedMove: this.selectedMove,
            guessCandidates: this.guessCandidates,
            rightGuessPoint: this.rightGuessPoint,
            wrongGuessPoint: this.wrongGuessPoint,
            candidates: this.candidates,
            winner: this.winner,
            eventLog: this.getEventLogForWire(),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    /**
     * 紧凑棋谱：一行一手（含迷惑点、选点、猜点）
     * 格式：B r1,c1;r2,c2;r3,c3|sr,sc|gr,gc（B/W 为行棋方）
     */
    static encodeMoveRound(selectEv, guessEv) {
        const h = selectEv.player === 'black' ? 'B' : 'W';
        const pts = (selectEv.candidatesBefore || []).map(p => `${p.row},${p.col}`).join(';');
        return `${h}${pts}|${selectEv.row},${selectEv.col}|${guessEv.row},${guessEv.col}`;
    }

    /** @returns {{ select: object, guess: object } | null} */
    static parseMoveRound(s) {
        if (typeof s !== 'string' || s.length < 2) return null;
        const head = s[0];
        if (head !== 'B' && head !== 'W') return null;
        const player = head === 'B' ? 'black' : 'white';
        const rest = s.slice(1);
        const segs = rest.split('|');
        if (segs.length !== 3) return null;
        const candParts = segs[0].split(';').map(x => x.trim()).filter(Boolean);
        if (candParts.length < 1) return null;
        const candidatesBefore = [];
        for (const seg of candParts) {
            const parts = seg.split(',');
            if (parts.length !== 2) return null;
            const r = +parts[0];
            const c = +parts[1];
            if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
            candidatesBefore.push({ row: r, col: c });
        }
        const selParts = segs[1].split(',');
        const gParts = segs[2].split(',');
        if (selParts.length !== 2 || gParts.length !== 2) return null;
        const sr = +selParts[0];
        const sc = +selParts[1];
        const gr = +gParts[0];
        const gc = +gParts[1];
        if (![sr, sc, gr, gc].every(Number.isFinite)) return null;
        const guessPlayer = player === 'black' ? 'white' : 'black';
        return {
            select: { type: 'select', player, row: sr, col: sc, candidatesBefore },
            guess: { type: 'guess', player: guessPlayer, row: gr, col: gc }
        };
    }

    static expandMovesToEvents(moves) {
        const events = [];
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (typeof m !== 'string') return null;
            const round = GuessWuziqiRoom.parseMoveRound(m);
            if (!round) return null;
            events.push(round.select, round.guess);
        }
        return events;
    }

    pushSnapshot(snapshots, board, phase, currentPlayer, candidates, selectedMove, guessCandidates, rightGuessPoint, wrongGuessPoint, lastMoveMarkers, gameOver, winner, handNumber = null) {
        const gc = guessCandidates || [];
        snapshots.push({
            board: board.map(row => row.slice()),
            phase,
            currentPlayer,
            candidates: (candidates || []).map(c => ({ row: c.row, col: c.col })),
            selectedMove: selectedMove ? { ...selectedMove } : null,
            guessCandidates: gc.map(c => ({ row: c.row, col: c.col })),
            rightGuessPoint: rightGuessPoint ? { ...rightGuessPoint } : null,
            wrongGuessPoint: wrongGuessPoint ? { ...wrongGuessPoint } : null,
            lastMoveMarkers: (lastMoveMarkers || []).map(m => ({ ...m })),
            gameOver,
            winner,
            handNumber
        });
    }

    /** 打谱：每回合三步——①迷惑点 ②迷惑点+选点 ③猜点结果（绿/红与落子） */
    buildGuessSnapshotsFromEvents(events) {
        const size = this.BOARD_SIZE;
        const snapshots = [];
        if (!events || events.length === 0) {
            const b0 = Array(size).fill().map(() => Array(size).fill(0));
            this.pushSnapshot(snapshots, b0, 'select', 'black', [], null, [], null, null, [], false, null, 0);
            return snapshots;
        }

        let board = Array(size).fill().map(() => Array(size).fill(0));
        let currentPlayer = 'black';
        let lastMoveMarkers = [];

        this.pushSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], null, null, lastMoveMarkers, false, null, 0);

        let ei = 0;
        while (ei < events.length) {
            const ev = events[ei];
            if (ev.type !== 'select') return null;

            const cb = (ev.candidatesBefore || []).map(c => ({ row: c.row, col: c.col }));
            if (ev.player !== currentPlayer) return null;
            if (cb.length < 1) return null;

            const { row, col } = ev;
            if (row < 0 || row >= size || col < 0 || col >= size || board[row][col] !== 0) return null;

            const handNum = 1 + Math.floor(ei / 2);

            this.pushSnapshot(snapshots, board, 'select', currentPlayer, cb, null, [], null, null, lastMoveMarkers, false, null, handNum);

            const selectedMove = { row, col };
            let guessCandidates;
            if (cb.some(c => c.row === row && c.col === col)) {
                guessCandidates = cb.map(c => ({ ...c }));
            } else {
                guessCandidates = [...cb, { row, col }];
            }
            // 第二步：迷惑点 + 行棋方选点（圆圈）
            this.pushSnapshot(snapshots, board, 'select', currentPlayer, cb, selectedMove, [], null, null, lastMoveMarkers, false, null, handNum);

            ei++;
            if (ei >= events.length) break;

            const gev = events[ei];
            if (gev.type !== 'guess' || gev.player === currentPlayer) return null;
            const guessRow = gev.row, guessCol = gev.col;
            if (!guessCandidates.some(p => p.row === guessRow && p.col === guessCol)) return null;

            const isHit = (guessRow === selectedMove.row && guessCol === selectedMove.col);
            lastMoveMarkers = [];
            let gameOver = false;
            let roundWinner = null;

            if (!isHit) {
                const playerVal = currentPlayer === 'black' ? 1 : 2;
                board[selectedMove.row][selectedMove.col] = playerVal;
                lastMoveMarkers = [{ row: selectedMove.row, col: selectedMove.col, color: playerVal }];
                if (this._checkWinOnBoard(board, selectedMove.row, selectedMove.col, playerVal, size)) {
                    gameOver = true;
                    roundWinner = currentPlayer;
                }
            }

            if (gameOver) {
                const rightGuessPoint = isHit ? { row: guessRow, col: guessCol } : null;
                const wrongGuessPoint = !isHit ? { row: guessRow, col: guessCol } : null;
                this.pushSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], rightGuessPoint, wrongGuessPoint, lastMoveMarkers, true, roundWinner, handNum);
                break;
            }

            currentPlayer = currentPlayer === 'black' ? 'white' : 'black';

            let emptyCount = 0;
            for (let r = 0; r < size; r++)
                for (let c = 0; c < size; c++)
                    if (board[r][c] === 0) emptyCount++;
            if (emptyCount < 4) {
                this.pushSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], null, null, lastMoveMarkers, true, 'draw', handNum);
                break;
            }

            let rightGuessPoint = null;
            let wrongGuessPoint = null;
            if (isHit) {
                rightGuessPoint = { row: guessRow, col: guessCol };
            } else {
                wrongGuessPoint = { row: guessRow, col: guessCol };
            }

            this.pushSnapshot(snapshots, board, 'select', currentPlayer, [], null, [], rightGuessPoint, wrongGuessPoint, lastMoveMarkers, false, null, handNum);

            ei++;
        }

        return snapshots;
    }

    _checkWinOnBoard(board, row, col, colorVal, BOARD_SIZE) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                let nr = row + dx * step, nc = col + dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                let nr = row - dx * step, nc = col - dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    exportRecord() {
        const moves = [];
        for (let i = 0; i + 1 < this.eventLog.length; i += 2) {
            const sel = this.eventLog[i];
            const g = this.eventLog[i + 1];
            if (sel && sel.type === 'select' && g && g.type === 'guess') {
                moves.push(GuessWuziqiRoom.encodeMoveRound(sel, g));
            }
        }
        return {
            format: 'muzei',
            version: 2,
            gameType: '猜点五子棋',
            gameId: 'guess-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves,
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.phase = 'select';
        this.selectedMove = null;
        this.guessCandidates = [];
        this.rightGuessPoint = null;
        this.wrongGuessPoint = null;
        this.eventLog = [];
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.generateCandidates();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数。' }));
            return false;
        }
        this.BOARD_SIZE = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'guess-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要猜点五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 13;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        let events;
        if (Array.isArray(data.moves) && data.moves.length > 0 && typeof data.moves[0] === 'string') {
            const expanded = GuessWuziqiRoom.expandMovesToEvents(data.moves);
            if (!expanded) {
                requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱 moves 无法解析。' }));
                return;
            }
            events = expanded;
        } else if (Array.isArray(data.events)) {
            events = data.events;
        } else if (Array.isArray(data.moves) && data.moves.length === 0) {
            events = [];
        } else {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱缺少对局记录。' }));
            return;
        }

        this.BOARD_SIZE = newSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.phase = 'select';
        this.selectedMove = null;
        this.guessCandidates = [];
        this.rightGuessPoint = null;
        this.wrongGuessPoint = null;
        this.winner = null;
        this.eventLog = [];
        this.candidates = [];
        this.generateCandidates();

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.type === 'select') {
                const cb = ev.candidatesBefore;
                if (!Array.isArray(cb) || cb.length < 1) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}步：缺少候选点信息。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.candidates = cb.map(c => ({ row: c.row, col: c.col }));
                if (this.phase !== 'select' || this.gameOver) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}步阶段错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const slot = ev.player;
                if (slot !== this.currentPlayer) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}步行棋方不符。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const { row, col } = ev;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE || this.board[row][col] !== 0) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手选点非法。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.selectedMove = { row, col };
                if (this.candidates.some(c => c.row === row && c.col === col)) {
                    this.guessCandidates = this.candidates.map(c => ({ row: c.row, col: c.col }));
                } else {
                    this.guessCandidates = this.candidates.map(c => ({ row: c.row, col: c.col }));
                    this.guessCandidates.push({ row, col });
                }
                this.phase = 'guess';
                this.rightGuessPoint = null;
                this.wrongGuessPoint = null;
                this.eventLog.push({ type: 'select', player: slot, row, col, candidatesBefore: cb.map(c => ({ row: c.row, col: c.col })) });
            } else if (ev.type === 'guess') {
                if (this.phase !== 'guess' || !this.selectedMove || this.gameOver) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}步猜点阶段错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const slot = ev.player;
                if (slot === this.currentPlayer) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}步猜点方错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const { row: guessRow, col: guessCol } = ev;
                if (!this.guessCandidates.some(p => p.row === guessRow && p.col === guessCol)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手猜点不在候选内。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(this.board));
                const isHit = (guessRow === this.selectedMove.row && guessCol === this.selectedMove.col);
                let winner = null;
                if (!isHit) {
                    const playerVal = this.currentPlayer === 'black' ? 1 : 2;
                    this.board[this.selectedMove.row][this.selectedMove.col] = playerVal;
                    this.lastMoveMarkers = [{ row: this.selectedMove.row, col: this.selectedMove.col, color: playerVal }];
                    if (this.checkWin(this.selectedMove.row, this.selectedMove.col, playerVal)) {
                        this.gameOver = true;
                        winner = this.currentPlayer;
                        this.winner = winner;
                    }
                } else this.lastMoveMarkers = [];

                this.eventLog.push({ type: 'guess', player: slot, row: guessRow, col: guessCol });

                if (this.gameOver) {
                    this.phase = 'select';
                    this.selectedMove = null;
                    this.guessCandidates = [];
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = null;
                    this.candidates = [];
                    break;
                }

                this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
                const empty = this.getEmptyCells();
                if (empty.length < 4) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.phase = 'select';
                    this.selectedMove = null;
                    this.guessCandidates = [];
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = null;
                    this.candidates = [];
                    break;
                }

                if (isHit) {
                    this.rightGuessPoint = { row: guessRow, col: guessCol };
                    this.wrongGuessPoint = null;
                } else {
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = { row: guessRow, col: guessCol };
                }
                this.generateCandidates();
                this.phase = 'select';
                this.selectedMove = null;
                this.guessCandidates = [];
            }
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        let snapshots = this.buildGuessSnapshotsFromEvents(this.eventLog);
        if (!snapshots) snapshots = [];

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: { snapshots }
        });
    }

    assignSlot(ws, requestedSlot) {
        const room = this.room;
        if (requestedSlot === 'black' && !room.getPlayerBySlot('black')) {
            return 'black';
        } else if (requestedSlot === 'white' && !room.getPlayerBySlot('white')) {
            return 'white';
        }
        return null;
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    sendState(ws) {
        ws.send(JSON.stringify({
            type: 'gameState',
            ...this.getState()
        }));
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
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用。' }));
                }
                break;

            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱。' }));
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
                if (this.phase !== 'select') return;
                if (!slot || slot !== this.currentPlayer) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                const candidatesBefore = this.candidates.map(c => ({ row: c.row, col: c.col }));
                this.eventLog.push({ type: 'select', player: slot, row, col, candidatesBefore });

                this.selectedMove = { row, col };
                if (this.candidates.some(c => c.row === row && c.col === col)) {
                    this.guessCandidates = this.candidates.map(c => ({ row: c.row, col: c.col }));
                } else {
                    this.guessCandidates = this.candidates.map(c => ({ row: c.row, col: c.col }));
                    this.guessCandidates.push({ row, col });
                }
                this.phase = 'guess';
                this.rightGuessPoint = null;
                this.wrongGuessPoint = null;
                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: this.board,
                    currentPlayer: this.currentPlayer,
                    phase: this.phase,
                    selectedMove: this.selectedMove,
                    guessCandidates: this.guessCandidates,
                    rightGuessPoint: this.rightGuessPoint,
                    wrongGuessPoint: this.wrongGuessPoint,
                    candidates: this.candidates,
                    lastMoveMarkers: this.lastMoveMarkers,
                    numberOfHands: 1 + this.historyBoards.length,
                    gameOver: this.gameOver,
                    eventLog: this.getEventLogForWire()
                });
                break;

            case 'guess':
                if (this.gameOver) return;
                if (this.phase !== 'guess') return;
                if (!slot || slot === this.currentPlayer) return;

                const { row: guessRow, col: guessCol } = msg;
                if (!this.guessCandidates.some(p => p.row === guessRow && p.col === guessCol)) return;

                this.eventLog.push({ type: 'guess', player: slot, row: guessRow, col: guessCol });

                this.historyBoards.push(this.copyBoard(this.board));

                const isHit = (guessRow === this.selectedMove.row && guessCol === this.selectedMove.col);
                let winner = null;

                if (!isHit) {
                    const playerVal = this.currentPlayer === 'black' ? 1 : 2;
                    this.board[this.selectedMove.row][this.selectedMove.col] = playerVal;
                    this.lastMoveMarkers = [{ row: this.selectedMove.row, col: this.selectedMove.col, color: playerVal }];
                    if (this.checkWin(this.selectedMove.row, this.selectedMove.col, playerVal)) {
                        this.gameOver = true;
                        winner = this.currentPlayer;
                        this.winner = winner;
                    }
                } else this.lastMoveMarkers = [];

                if (this.gameOver) {
                    this.phase = 'select';
                    this.selectedMove = null;
                    this.guessCandidates = [];
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = null;
                    this.candidates = [];
                    this.broadcast({
                        type: 'broadcast',
                        action: 'guess',
                        board: this.board,
                        currentPlayer: this.currentPlayer,
                        phase: this.phase,
                        selectedMove: this.selectedMove,
                        guessCandidates: this.guessCandidates,
                        rightGuessPoint: this.rightGuessPoint,
                        wrongGuessPoint: this.wrongGuessPoint,
                        candidates: this.candidates,
                        lastMoveMarkers: this.lastMoveMarkers,
                        numberOfHands: 1 + this.historyBoards.length,
                        gameOver: true,
                        winner: winner,
                        eventLog: this.getEventLogForWire()
                    });
                    return;
                }

                this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                const empty = this.getEmptyCells();

                if (empty.length < 4) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.phase = 'select';
                    this.selectedMove = null;
                    this.guessCandidates = [];
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = null;
                    this.candidates = [];
                    this.broadcast({
                        type: 'broadcast',
                        action: 'guess',
                        board: this.board,
                        currentPlayer: this.currentPlayer,
                        phase: this.phase,
                        selectedMove: this.selectedMove,
                        guessCandidates: this.guessCandidates,
                        rightGuessPoint: this.rightGuessPoint,
                        wrongGuessPoint: this.wrongGuessPoint,
                        candidates: this.candidates,
                        lastMoveMarkers: this.lastMoveMarkers,
                        numberOfHands: 1 + this.historyBoards.length,
                        gameOver: true,
                        winner: 'draw',
                        eventLog: this.getEventLogForWire()
                    });
                    return;
                }

                if (isHit) {
                    this.rightGuessPoint = { row: guessRow, col: guessCol };
                    this.wrongGuessPoint = null;
                } else {
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = { row: guessRow, col: guessCol };
                }
                this.generateCandidates();
                this.phase = 'select';
                this.selectedMove = null;
                this.guessCandidates = [];
                this.broadcast({
                    type: 'broadcast',
                    action: 'guess',
                    board: this.board,
                    currentPlayer: this.currentPlayer,
                    phase: this.phase,
                    selectedMove: this.selectedMove,
                    guessCandidates: this.guessCandidates,
                    rightGuessPoint: this.rightGuessPoint,
                    wrongGuessPoint: this.wrongGuessPoint,
                    candidates: this.candidates,
                    lastMoveMarkers: this.lastMoveMarkers,
                    numberOfHands: 1 + this.historyBoards.length,
                    gameOver: false,
                    eventLog: this.getEventLogForWire()
                });
                break;

            case 'resign':
                if (!slot) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: slot,
                    winner: this.winner,
                    gameOver: true,
                    eventLog: this.getEventLogForWire()
                });
                break;

            case 'requestNewGame':
                if (!slot) return;
                if (this.pendingNewGame) return;
                const newGameOpponentSlot = slot === 'black' ? 'white' : 'black';
                const newGameOpponent = room.getPlayerBySlot(newGameOpponentSlot);
                if (!newGameOpponent) {
                    this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
                    this.currentPlayer = 'black';
                    this.historyBoards = [];
                    this.lastMoveMarkers = [];
                    this.gameOver = false;
                    this.winner = null;
                    this.phase = 'select';
                    this.selectedMove = null;
                    this.guessCandidates = [];
                    this.rightGuessPoint = null;
                    this.wrongGuessPoint = null;
                    this.eventLog = [];
                    this.generateCandidates();
                    // 必须先广播 newGameStarted：broadcast 只遍历 players 与 observers。
                    // 若先清空 players，原对局连接收不到消息，客户端局面不会更新。
                    this.broadcast({
                        type: 'newGameStarted',
                        board: this.board,
                        boardSize: this.BOARD_SIZE,
                        currentPlayer: this.currentPlayer,
                        phase: this.phase,
                        numberOfHands: 1,
                        candidates: this.candidates,
                        slots: { black: false, white: false },
                        eventLog: []
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
                if (this.pendingNewGame) {
                    if (msg.accept) {
                        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
                        this.currentPlayer = 'black';
                        this.historyBoards = [];
                        this.lastMoveMarkers = [];
                        this.gameOver = false;
                        this.winner = null;
                        this.phase = 'select';
                        this.selectedMove = null;
                        this.guessCandidates = [];
                        this.rightGuessPoint = null;
                        this.wrongGuessPoint = null;
                        this.eventLog = [];
                        this.generateCandidates();
                        // 同上：须在仍保留 players 时 broadcast，否则无人收到 newGameStarted。
                        this.broadcast({
                            type: 'newGameStarted',
                            board: this.board,
                            boardSize: this.BOARD_SIZE,
                            currentPlayer: this.currentPlayer,
                            phase: this.phase,
                            numberOfHands: 1,
                            candidates: this.candidates,
                            slots: { black: false, white: false },
                            eventLog: []
                        });
                        const toRelease = [...room.players.entries()];
                        for (const [client, oldSlot] of toRelease) {
                            room.players.delete(client);
                            room.slotOccupancy.delete(oldSlot);
                            client.send(JSON.stringify({ type: 'slotReleased', slot: oldSlot }));
                        }
                    } else {
                        this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局。' }));
                    }
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
                        gameOver: true,
                        winner: 'draw'
                    });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    if (msg.accept) {
                        this.gameOver = true;
                        this.broadcast({
                            type: 'drawAgreed',
                            gameOver: true,
                            winner: 'draw'
                        });
                    } else {
                        this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                    }
                }
                this.pendingDraw = null;
                break;

            default:
                break;
        }
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
        room.gameLogic = new GuessWuziqiRoom(room);
        room.maxPlayers = 2;
    }
};
