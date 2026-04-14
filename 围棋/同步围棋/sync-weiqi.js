class SyncWeiqiRoom {
    constructor(room) {
        this.room = room;
        this.boardSize = 19;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.forbiddenPoints = [];
        this.numberOfHands = 1;
        this.historyStates = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingBlack = null;
        this.pendingWhite = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];

        this.saveStateToHistory();
    }

    saveStateToHistory() {
        this.historyStates.push({
            board: this.copyBoard(this.board),
            forbiddenPoints: this.copyForbiddenPoints(this.forbiddenPoints),
            turn: this.numberOfHands,
            lastMoveMarkers: this.copyMarkers(this.lastMoveMarkers)
        });
    }

    copyBoard(src) { return src.map(row => row.slice()); }
    copyForbiddenPoints(src) { return src.map(p => ({ row: p.row, col: p.col })); }
    copyMarkers(markers) { return markers.map(m => ({ row: m.row, col: m.col, color: m.color })); }

    boardToString(board) {
        return board.map(row => row.join(',')).join(';');
    }

    areForbiddenPointsEqual(fp1, fp2) {
        if (fp1.length !== fp2.length) return false;
        const set1 = new Set(fp1.map(p => `${p.row},${p.col}`));
        const set2 = new Set(fp2.map(p => `${p.row},${p.col}`));
        if (set1.size !== set2.size) return false;
        for (let key of set1) {
            if (!set2.has(key)) return false;
        }
        return true;
    }

    isStateDuplicate(board, forbiddenPoints) {
        const boardStr = this.boardToString(board);
        for (const state of this.historyStates) {
            if (this.boardToString(state.board) === boardStr &&
                this.areForbiddenPointsEqual(state.forbiddenPoints, forbiddenPoints)) {
                return true;
            }
        }
        return false;
    }

    isForbidden(row, col) {
        return this.forbiddenPoints.some(p => p.row === row && p.col === col);
    }

    /** 空点且为洞则不计入气 */
    isLibertyEmpty(nr, nc, board, forbiddenPoints) {
        if (board[nr][nc] !== 0) return false;
        return !forbiddenPoints.some(p => p.row === nr && p.col === nc);
    }

    addForbiddenPoint(row, col) {
        if (!this.isForbidden(row, col)) this.forbiddenPoints.push({ row, col });
    }

    hasLiberty(board, row, col, forbiddenPoints) {
        const color = board[row][col];
        if (color === 0) return false;
        const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (let [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                if (this.isLibertyEmpty(nr, nc, board, forbiddenPoints)) return true;
                if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return false;
    }

    removeDeadGroupsLocal(blackMove, whiteMove, board, forbiddenPoints) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const affectedStones = new Set();

        const addNeighborStones = (row, col) => {
            if (row === undefined || col === undefined) return;
            for (let [dr, dc] of dirs) {
                const nr = row + dr, nc = col + dc;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize && board[nr][nc] !== 0) {
                    affectedStones.add(`${nr},${nc}`);
                }
            }
        };

        if (blackMove) {
            const { row, col } = blackMove;
            affectedStones.add(`${row},${col}`);
            addNeighborStones(row, col);
        }
        if (whiteMove) {
            const { row, col } = whiteMove;
            affectedStones.add(`${row},${col}`);
            addNeighborStones(row, col);
        }

        const processed = new Set();
        const deadGroups = [];

        for (let key of affectedStones) {
            const [r, c] = key.split(',').map(Number);
            const color = board[r][c];
            if (color === 0) continue;
            const blockId = `${r},${c}`;
            if (processed.has(blockId)) continue;

            const visited = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(false));
            const queue = [[r, c]];
            visited[r][c] = true;
            const stones = [[r, c]];
            let hasLiberty = false;
            let idx = 0;

            while (idx < queue.length) {
                const [rr, cc] = queue[idx++];
                for (let [dr, dc] of dirs) {
                    const nr = rr + dr, nc = cc + dc;
                    if (nr < 0 || nr >= this.boardSize || nc < 0 || nc >= this.boardSize) continue;
                    if (this.isLibertyEmpty(nr, nc, board, forbiddenPoints)) {
                        hasLiberty = true;
                    } else if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                        stones.push([nr, nc]);
                    }
                }
            }

            processed.add(blockId);
            if (!hasLiberty) {
                deadGroups.push(stones);
            }
        }

        for (const stones of deadGroups) {
            for (let [rr, cc] of stones) {
                board[rr][cc] = 0;
            }
        }
    }

    applyMovesAndCapture(blackMove, whiteMove, currentBoard, currentForbidden) {
        const newBoard = this.copyBoard(currentBoard);
        const newForbidden = this.copyForbiddenPoints(currentForbidden);

        if (blackMove && whiteMove && blackMove.row === whiteMove.row && blackMove.col === whiteMove.col) {
            const { row, col } = blackMove;
            if (!newForbidden.some(p => p.row === row && p.col === col)) {
                newForbidden.push({ row, col });
            }
            return { newBoard, newForbidden };
        }

        if (blackMove) newBoard[blackMove.row][blackMove.col] = 1;
        if (whiteMove) newBoard[whiteMove.row][whiteMove.col] = 2;

        this.removeDeadGroupsLocal(blackMove, whiteMove, newBoard, newForbidden);

        return { newBoard, newForbidden };
    }

    pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, applied) {
        this.moveCoords.push({
            black: blackMove ? { row: blackMove.row, col: blackMove.col } : null,
            white: whiteMove ? { row: whiteMove.row, col: whiteMove.col } : null,
            blackPass: !!blackPass,
            whitePass: !!whitePass,
            applied: !!applied
        });
    }

    resolveTurn() {
        const blackMove = this.pendingBlack?.move || null;
        const whiteMove = this.pendingWhite?.move || null;
        const blackPass = this.pendingBlack?.pass || false;
        const whitePass = this.pendingWhite?.pass || false;

        if (blackPass && whitePass) {
            this.pushMoveCoord(null, null, true, true, true);
            this.gameOver = true;
            this.winner = 'draw';
            this.broadcastTurnResolved();
            this.clearPending();
            return;
        }

        const currentBoard = this.copyBoard(this.board);
        const currentForbidden = this.copyForbiddenPoints(this.forbiddenPoints);

        const { newBoard, newForbidden } = this.applyMovesAndCapture(blackMove, whiteMove, currentBoard, currentForbidden);

        const isDuplicate = this.isStateDuplicate(newBoard, newForbidden);

        let finalBoard, finalForbidden, lastMarkers = [];
        let success = false;

        if (isDuplicate) {
            finalBoard = currentBoard;
            finalForbidden = currentForbidden;
            if (blackMove && !blackPass) {
                const { row, col } = blackMove;
                if (!finalForbidden.some(p => p.row === row && p.col === col)) {
                    finalForbidden.push({ row, col });
                }
            }
            if (whiteMove && !whitePass) {
                const { row, col } = whiteMove;
                if (!finalForbidden.some(p => p.row === row && p.col === col)) {
                    finalForbidden.push({ row, col });
                }
            }
            success = false;
        } else {
            finalBoard = newBoard;
            finalForbidden = newForbidden;
            if (blackMove && !blackPass) lastMarkers.push({ row: blackMove.row, col: blackMove.col, color: 1 });
            if (whiteMove && !whitePass) lastMarkers.push({ row: whiteMove.row, col: whiteMove.col, color: 2 });
            success = true;
        }

        this.board = finalBoard;
        this.forbiddenPoints = finalForbidden;
        this.lastMoveMarkers = lastMarkers;

        this.pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, success);

        if (success) {
            this.numberOfHands++;
            this.saveStateToHistory();
        }

        this.clearPending();
        this.broadcastTurnResolved();
    }

    clearPending() {
        this.pendingBlack = null;
        this.pendingWhite = null;
    }

    broadcastTurnResolved() {
        this.broadcast({ type: 'broadcast', action: 'turnResolved', ...this.getState() });
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: this.numberOfHands,
            forbiddenPoints: this.forbiddenPoints,
            holes: this.forbiddenPoints,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    /**
     * 仅向当前连接者返回己方本回合已提交、等待对方的落子/虚着（不泄露给对手）。
     * 用于断线重连、重新选边后恢复界面。
     */
    getStateForClient(ws) {
        const base = this.getState();
        const slot = this.room.getSlotByWs(ws);
        let mySyncPending = null;
        if (slot === 'black' && this.pendingBlack) {
            if (this.pendingBlack.pass) mySyncPending = { pass: true };
            else if (this.pendingBlack.move) mySyncPending = { row: this.pendingBlack.move.row, col: this.pendingBlack.move.col };
        } else if (slot === 'white' && this.pendingWhite) {
            if (this.pendingWhite.pass) mySyncPending = { pass: true };
            else if (this.pendingWhite.move) mySyncPending = { row: this.pendingWhite.move.row, col: this.pendingWhite.move.col };
        }
        return { ...base, mySyncPending };
    }

    assignSlot(ws, requestedSlot) {
        if (requestedSlot === 'black' && !this.room.getPlayerBySlot('black')) return 'black';
        if (requestedSlot === 'white' && !this.room.getPlayerBySlot('white')) return 'white';
        return null;
    }

    broadcast(data, exclude = null) {
        const allClients = [...this.room.players.keys(), ...this.room.observers];
        for (let client of allClients) {
            if (client !== exclude && client.readyState === 1) {
                client.send(JSON.stringify(data));
            }
        }
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    /** 形势判断 pipeline 与前端一致：去死棋/欠气块 → 点目（洞不可穿行 BFS） */
    isLibertySurroundedByOpponentScore(board, libertyRow, libertyCol, opponentColor) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const n = this.boardSize;
        for (const [dr, dc] of dirs) {
            const nr = libertyRow + dr, nc = libertyCol + dc;
            if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === opponentColor) return true;
        }
        return false;
    }

    removeDeadAndDyingForScore(srcBoard) {
        const n = this.boardSize;
        let boardCopy = srcBoard.map(row => row.slice());
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(n).fill().map(() => Array(n).fill(false));
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr, nc = cc + dc;
                                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                                if (boardCopy[nr][nc] === 0 && !this.isForbidden(nr, nc)) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= 2) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponentScore(boardCopy, lr, lc, 3 - color)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    }

    assignTerritoryWithRangeForScore(liveBoard) {
        const n = this.boardSize;
        const territory = Array(n).fill().map(() => Array(n).fill(0));
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (liveBoard[r][c] !== 0) continue;
                if (this.isForbidden(r, c)) continue;
                const maxDist = (r <= 1 || r >= n - 2 || c <= 1 || c >= n - 2) ? 5 : 4;
                let blackMin = Infinity, whiteMin = Infinity;
                const dist = Array(n).fill().map(() => Array(n).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                        if (this.isForbidden(nr, nc)) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    }

    computeScoreTotals(liveBoard, territory) {
        const n = this.boardSize;
        let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0 && !this.isForbidden(r, c)) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    computeOfficialScore() {
        const liveBoard = this.removeDeadAndDyingForScore(this.copyBoard(this.board));
        const territory = this.assignTerritoryWithRangeForScore(liveBoard);
        return this.computeScoreTotals(liveBoard, territory);
    }

    /** 黑合计 − 白合计，无贴目 */
    computeLead() {
        const { blackTotal, whiteTotal } = this.computeOfficialScore();
        const lead = blackTotal - whiteTotal;
        return { blackTotal, whiteTotal, lead };
    }

    startScoreCounting(requester, opponent) {
        const { blackTotal, whiteTotal, lead } = this.computeLead();
        this.scoreProposalData = { lead, blackTotal, whiteTotal, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead, blackTotal, whiteTotal };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.forbiddenPoints = [];
        this.numberOfHands = 1;
        this.historyStates = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.clearPending();
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.saveStateToHistory();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer || this.forbiddenPoints.length > 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子、洞或玩家，不能改变棋盘大小' }));
            return false;
        }
        this.boardSize = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        const compressTurn = (t) => {
            let s = '';
            if (t.blackPass) s += 'Bp';
            else if (t.black) s += `B${t.black.row},${t.black.col}`;
            else s += 'B-';
            if (t.whitePass) s += 'Wp';
            else if (t.white) s += `W${t.white.row},${t.white.col}`;
            else s += 'W-';
            s += t.applied ? '1' : '0';
            return s;
        };
        return {
            format: 'muzei',
            version: 1,
            gameType: '同步围棋',
            gameId: 'sync-weiqi',
            boardSize: this.boardSize,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [], holes: [] },
            moves: this.moveCoords.map(compressTurn),
            result: this.gameOver ? this.winner : null
        };
    }

    static parseTurnEntry(str) {
        if (typeof str === 'object' && str !== null) {
            const t = { ...str };
            if (typeof t.applied !== 'boolean') t.applied = true;
            return t;
        }
        let applied = true;
        let body = str;
        if (str.endsWith('1') || str.endsWith('0')) {
            applied = str.endsWith('1');
            body = str.slice(0, -1);
        }
        let i = 0;
        const readSide = (prefix) => {
            if (body[i] !== prefix) return { err: true };
            i++;
            if (body[i] === 'p') {
                i++;
                return { pass: true };
            }
            if (body[i] === '-') {
                i++;
                return { empty: true };
            }
            const m = body.substring(i).match(/^(\d+),(\d+)/);
            if (!m) return { err: true };
            i += m[0].length;
            return { row: +m[1], col: +m[2] };
        };
        const b = readSide('B');
        const w = readSide('W');
        if (b.err || w.err || i !== body.length) return { err: true };
        const blackPass = !!b.pass;
        const whitePass = !!w.pass;
        return {
            black: blackPass ? null : (b.empty ? null : { row: b.row, col: b.col }),
            white: whitePass ? null : (w.empty ? null : { row: w.row, col: w.col }),
            blackPass,
            whitePass,
            applied
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'sync-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要同步围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        const raw = data.moves || [];
        const turns = raw.map(SyncWeiqiRoom.parseTurnEntry);

        for (let ti = 0; ti < turns.length; ti++) {
            const t = turns[ti];
            if (t.err) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手格式无效` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.pendingBlack = t.blackPass ? { pass: true } : (t.black ? { move: { row: t.black.row, col: t.black.col } } : null);
            this.pendingWhite = t.whitePass ? { pass: true } : (t.white ? { move: { row: t.white.row, col: t.white.col } } : null);

            if (!this.pendingBlack || !this.pendingWhite) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手数据不完整` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const blackMove = this.pendingBlack?.move || null;
            const whiteMove = this.pendingWhite?.move || null;
            const blackPass = this.pendingBlack?.pass || false;
            const whitePass = this.pendingWhite?.pass || false;

            if (blackPass && whitePass) {
                this.pushMoveCoord(null, null, true, true, true);
                this.gameOver = true;
                this.winner = 'draw';
                this.clearPending();
                break;
            }

            const currentBoard = this.copyBoard(this.board);
            const currentForbidden = this.copyForbiddenPoints(this.forbiddenPoints);
            const { newBoard, newForbidden } = this.applyMovesAndCapture(blackMove, whiteMove, currentBoard, currentForbidden);
            const isDuplicate = this.isStateDuplicate(newBoard, newForbidden);

            let finalBoard, finalForbidden, lastMarkers = [];
            let success = false;

            if (isDuplicate) {
                finalBoard = currentBoard;
                finalForbidden = currentForbidden;
                if (blackMove && !blackPass) {
                    const { row, col } = blackMove;
                    if (!finalForbidden.some(p => p.row === row && p.col === col)) finalForbidden.push({ row, col });
                }
                if (whiteMove && !whitePass) {
                    const { row, col } = whiteMove;
                    if (!finalForbidden.some(p => p.row === row && p.col === col)) finalForbidden.push({ row, col });
                }
                success = false;
            } else {
                finalBoard = newBoard;
                finalForbidden = newForbidden;
                if (blackMove && !blackPass) lastMarkers.push({ row: blackMove.row, col: blackMove.col, color: 1 });
                if (whiteMove && !whitePass) lastMarkers.push({ row: whiteMove.row, col: whiteMove.col, color: 2 });
                success = true;
            }

            this.board = finalBoard;
            this.forbiddenPoints = finalForbidden;
            this.lastMoveMarkers = lastMarkers;

            this.pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, success);

            if (success) {
                this.numberOfHands++;
                this.saveStateToHistory();
            }

            this.clearPending();

            if (typeof t.applied === 'boolean' && t.applied !== success) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手结果与记录不一致` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        const replayMoves = this.moveCoords.map(m => ({ ...m }));

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.boardSize,
            replayData: {
                initialPosition: data.initialPosition || { black: [], white: [], holes: [] },
                moves: replayMoves
            }
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
                const isBlack = (slot === 'black');
                if (isBlack && this.pendingBlack) return;
                if (!isBlack && this.pendingWhite) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                if (this.isForbidden(row, col)) return;
                const moveData = { move: { row, col } };
                if (isBlack) this.pendingBlack = moveData;
                else this.pendingWhite = moveData;
                const opponent = isBlack ? room.getPlayerBySlot('white') : room.getPlayerBySlot('black');
                if (opponent) {
                    opponent.send(JSON.stringify({ type: 'pendingUpdate', player: slot, move: true, pass: false }));
                }
                if (this.pendingBlack && this.pendingWhite) {
                    this.resolveTurn();
                }
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot) return;
                const isBlackPass = (slot === 'black');
                if (isBlackPass && this.pendingBlack) return;
                if (!isBlackPass && this.pendingWhite) return;
                if (isBlackPass) {
                    this.pendingBlack = { pass: true };
                } else {
                    this.pendingWhite = { pass: true };
                }
                const passOpponent = isBlackPass ? room.getPlayerBySlot('white') : room.getPlayerBySlot('black');
                if (passOpponent) {
                    passOpponent.send(JSON.stringify({ type: 'pendingUpdate', player: slot, move: false, pass: true }));
                }
                if (this.pendingBlack && this.pendingWhite) {
                    this.resolveTurn();
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!undoOpponent) {
                    if (this.historyStates.length > 1) {
                        this.undoOneStep();
                    }
                } else {
                    this.pendingUndo = { requester: ws, opponent: undoOpponent };
                    undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.undoOneStep();
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

    undoOneStep() {
        while (this.moveCoords.length > 0 && !this.moveCoords[this.moveCoords.length - 1].applied) {
            this.moveCoords.pop();
        }
        if (this.historyStates.length <= 1) return;
        this.historyStates.pop();
        if (this.moveCoords.length > 0) this.moveCoords.pop();
        if (this.historyStates.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.forbiddenPoints = [];
            this.numberOfHands = 1;
            this.lastMoveMarkers = [];
            this.gameOver = false;
            this.winner = null;
        } else {
            const prev = this.historyStates.at(-1);
            this.board = this.copyBoard(prev.board);
            this.forbiddenPoints = this.copyForbiddenPoints(prev.forbiddenPoints);
            this.numberOfHands = prev.turn;
            this.lastMoveMarkers = this.copyMarkers(prev.lastMoveMarkers);
            this.gameOver = false;
            this.winner = null;
        }
        this.clearPending();
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

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        // 不断开本回合已提交、等待对方的落子：刷新/重连后同一方再入座时，getStateForClient 仍可通过 mySyncPending 恢复界面。
        // pending 仅在 resolveTurn、新局、悔棋、导入等流程中由 clearPending/reset 清理。
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new SyncWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
