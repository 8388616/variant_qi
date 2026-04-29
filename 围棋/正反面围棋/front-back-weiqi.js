const { QiTwoPlayerRoomBase, qiMatchTimeControl, squareWeiqiRules } = require('../common');

class FrontBackWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = 15;
        this.boardA = this.emptyBoard();
        this.boardB = this.emptyBoard();
        /** 雷：仅占位、提供气、不可被提；不可落子，但选择该点会清除雷 */
        this.minesA = [];
        this.minesB = [];
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;

        this.pushSnapshot();
        this.positionHistorySet.add(this.stateToString());
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            if (this.pendingScore) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'black' ? '黑超时白胜' : '白超时黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveCoords.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego || this.tcSettings) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) {
            otherWs.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: { ok: true, timed: v.timed, mainMinutes: v.mainMinutes, byoyomiSeconds: v.byoyomiSeconds, maxTimeouts: v.maxTimeouts }
            }));
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const p = this.tcNego.proposal;
        if (!p || p.ok !== true) return;
        this.tcSettings = p.timed
            ? { timed: true, mainMinutes: p.mainMinutes, byoyomiSeconds: p.byoyomiSeconds, maxTimeouts: p.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.expectedSlot(), Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
        });
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === this.expectedSlot();
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== this.expectedSlot()) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'black' ? '黑超时白胜' : '白超时黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.expectedSlot(), Date.now());
        this._broadcastClock();
    }

    emptyBoard() {
        return Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
    }

    copyMineList(src) {
        return src.map(p => ({ row: p.row, col: p.col }));
    }

    expectedSlot() {
        const m = this.nextMoveNumber % 4;
        return m === 0 || m === 1 ? 'black' : 'white';
    }

    /** 'A' 或 'B' */
    expectedBoard() {
        const m = this.nextMoveNumber % 4;
        return m === 1 || m === 2 ? 'A' : 'B';
    }

    isMine(mines, row, col) {
        return mines.some(p => p.row === row && p.col === col);
    }

    /** 邻接空点作气：雷位 board 为 0，与空点相同，提供气 */
    isLibertyEmpty(nr, nc, board) {
        return board[nr][nc] === 0;
    }

    countGroupLiberties(board, row, col) {
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
                if (this.isLibertyEmpty(nr, nc, board)) liberties.add(nr + ',' + nc);
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

    tryPlaceStone(board, mines, row, col, playerVal) {
        if (board[row][col] !== 0) return null;
        if (this.isMine(mines, row, col)) return null;
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
                    if (this.countGroupLiberties(newBoard, nr, nc) < 1) {
                        this.removeGroup(newBoard, nr, nc, enemyColor);
                    }
                }
            }
        }

        if (this.countGroupLiberties(newBoard, row, col) < 1) {
            this.removeGroup(newBoard, row, col, playerVal);
        }

        return newBoard;
    }

    stateToString() {
        const ba = this.boardA.map(row => row.join(',')).join(';');
        const bb = this.boardB.map(row => row.join(',')).join(';');
        const ma = this.minesA.map(p => `${p.row},${p.col}`).sort().join('|');
        const mb = this.minesB.map(p => `${p.row},${p.col}`).sort().join('|');
        return `${ba}#${bb}#${ma}#${mb}`;
    }

    /**
     * 形势（与洞围棋的洞类似）：距离扩张不可穿行雷；雷点不作 BFS 起点；数子用 computeScoreWithHoles 不计雷目。
     * 对局作气仍按正反面规则（雷为气），仅形势/数子按上处理。
     */
    assignTerritoryBlockingMines(liveBoard, mines) {
        const isMine = (r, c) => this.isMine(mines, r, c);
        const territory = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        const n = this.boardSize;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (liveBoard[r][c] !== 0) continue;
                if (isMine(r, c)) continue;
                const maxDist = (r <= 1 || r >= n - 2 || c <= 1 || c >= n - 2) ? 5 : 4;
                let blackMin = Infinity, whiteMin = Infinity;
                const dist = Array(n).fill().map(() => Array(n).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                let front = 0;
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (let [dr, dc] of dirs) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                        if (isMine(nr, nc)) continue;
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

    applyStoneMove(which, row, col, playerVal) {
        const board = which === 'A' ? this.boardA : this.boardB;
        const minesOnPlayed = which === 'A' ? this.minesA : this.minesB;
        const minesOnOther = which === 'A' ? this.minesB : this.minesA;
        const boardOther = which === 'A' ? this.boardB : this.boardA;

        const newBoard = this.tryPlaceStone(board, minesOnPlayed, row, col, playerVal);
        if (!newBoard) return null;

        const newMinesPlayed = this.copyMineList(minesOnPlayed);
        const newMinesOther = this.copyMineList(minesOnOther);
        if (boardOther[row][col] === 0 && !this.isMine(newMinesOther, row, col)) {
            newMinesOther.push({ row, col });
        }

        const newBoardA = which === 'A' ? newBoard : this.copyBoard(this.boardA);
        const newBoardB = which === 'B' ? newBoard : this.copyBoard(this.boardB);
        const newMinesA = which === 'A' ? newMinesPlayed : newMinesOther;
        const newMinesB = which === 'B' ? newMinesPlayed : newMinesOther;

        return { newBoardA, newBoardB, newMinesA, newMinesB };
    }

    tryApplyMove(which, row, col, playerVal) {
        const minesOnPlayed = which === 'A' ? this.minesA : this.minesB;
        if (this.isMine(minesOnPlayed, row, col)) {
            const cleared = this.tryClearMine(which, row, col);
            if (!cleared) return null;
            return { ...cleared, nextStr: cleared.nextStr };
        }
        const applied = this.applyStoneMove(which, row, col, playerVal);
        if (!applied) return null;
        const nextStr = (() => {
            const ba = applied.newBoardA.map(row => row.join(',')).join(';');
            const bb = applied.newBoardB.map(row => row.join(',')).join(';');
            const ma = applied.newMinesA.map(p => `${p.row},${p.col}`).sort().join('|');
            const mb = applied.newMinesB.map(p => `${p.row},${p.col}`).sort().join('|');
            return `${ba}#${bb}#${ma}#${mb}`;
        })();
        if (this.positionHistorySet.has(nextStr)) return null;
        return { ...applied, nextStr };
    }

    tryClearMine(which, row, col) {
        const minesOnPlayed = which === 'A' ? this.minesA : this.minesB;
        if (!this.isMine(minesOnPlayed, row, col)) return null;
        const newMinesPlayed = this.copyMineList(minesOnPlayed).filter(p => !(p.row === row && p.col === col));
        const newMinesA = which === 'A' ? newMinesPlayed : this.copyMineList(this.minesA);
        const newMinesB = which === 'B' ? newMinesPlayed : this.copyMineList(this.minesB);
        const newBoardA = this.copyBoard(this.boardA);
        const newBoardB = this.copyBoard(this.boardB);
        const nextStr = (() => {
            const ba = newBoardA.map(row => row.join(',')).join(';');
            const bb = newBoardB.map(row => row.join(',')).join(';');
            const ma = newMinesA.map(p => `${p.row},${p.col}`).sort().join('|');
            const mb = newMinesB.map(p => `${p.row},${p.col}`).sort().join('|');
            return `${ba}#${bb}#${ma}#${mb}`;
        })();
        if (this.positionHistorySet.has(nextStr)) return null;
        return { newBoardA, newBoardB, newMinesA, newMinesB, nextStr };
    }

    pushSnapshot() {
        this.historySnapshots.push({
            boardA: this.copyBoard(this.boardA),
            boardB: this.copyBoard(this.boardB),
            minesA: this.copyMineList(this.minesA),
            minesB: this.copyMineList(this.minesB),
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
            minesA: this.minesA,
            minesB: this.minesB,
            nextMoveNumber: this.nextMoveNumber,
            expectedBoard: this.expectedBoard(),
            expectedSlot: this.expectedSlot(),
            numberOfHands: this.nextMoveNumber,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            passCounter: this.passCounter,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    computeOfficialScoreOne(board, mines) {
        const liveBoard = squareWeiqiRules.removeDeadAndDying(
            this.copyBoard(board), this.boardSize, (b) => this.copyBoard(b)
        );
        const territory = this.assignTerritoryBlockingMines(liveBoard, mines);
        const isMineCell = (r, c) => this.isMine(mines, r, c);
        return squareWeiqiRules.computeScoreWithHoles(liveBoard, territory, this.boardSize, isMineCell);
    }

    computeLead() {
        const a = this.computeOfficialScoreOne(this.boardA, this.minesA);
        const b = this.computeOfficialScoreOne(this.boardB, this.minesB);
        const blackTotal = a.blackTotal + b.blackTotal;
        const whiteTotal = a.whiteTotal + b.whiteTotal;
        const lead = blackTotal - whiteTotal;
        return { blackTotal, whiteTotal, lead, boardA: a, boardB: b };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
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
        this.minesA = [];
        this.minesB = [];
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 19) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasStone = this.boardA.some(row => row.some(v => v !== 0)) || this.boardB.some(row => row.some(v => v !== 0));
        const hasMine = this.minesA.length > 0 || this.minesB.length > 0;
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasStone || hasMine || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子、雷或玩家，不能改变棋盘大小' }));
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
        this.minesA = this.copyMineList(prev.minesA);
        this.minesB = this.copyMineList(prev.minesB);
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
            const ma = s.minesA.map(p => `${p.row},${p.col}`).sort().join('|');
            const mb = s.minesB.map(p => `${p.row},${p.col}`).sort().join('|');
            this.positionHistorySet.add(`${ba}#${bb}#${ma}#${mb}`);
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
                if (m.type === 'clearMine') return `${m.player === 'black' ? 'B' : 'W'}m${m.board}${m.row},${m.col}`;
                return `${m.player === 'black' ? 'B' : 'W'}${m.board}${m.row},${m.col}`;
            }),
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            result: this.recordResultText || (this.gameOver ? this.winner : null)
        };
    }

    static parseMoveEntry(str) {
        if (typeof str === 'object' && str !== null) return str;
        if (str.endsWith('p')) {
            return { type: 'pass', player: str[0] === 'B' ? 'black' : 'white' };
        }
        const player = str[0] === 'B' ? 'black' : 'white';
        if (str[1] === 'm') {
            const board = str[2];
            const rest = str.slice(3);
            const [r, c] = rest.split(',').map(Number);
            return { type: 'clearMine', player, board, row: r, col: c };
        }
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
            if (m.type === 'clearMine') {
                const trial = this.tryClearMine(m.board, m.row, m.col);
                if (!trial) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手无法清除雷` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.boardA = trial.newBoardA;
                this.boardB = trial.newBoardB;
                this.minesA = trial.newMinesA;
                this.minesB = trial.newMinesB;
                this.positionHistorySet.add(trial.nextStr);
                this.lastMoveMarkers = [{ board: m.board, row: m.row, col: m.col, color: playerVal }];
                this.nextMoveNumber++;
                this.passCounter = 0;
                this.moveCoords.push({ type: 'clearMine', board: m.board, row: m.row, col: m.col, player: slot });
                this.pushSnapshot();
                continue;
            }
            const minesPlayed = m.board === 'A' ? this.minesA : this.minesB;
            if (this.isMine(minesPlayed, m.row, m.col)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手为落子记录但该点为雷` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const trial = this.tryApplyMove(m.board, m.row, m.col, playerVal);
            if (!trial) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.boardA = trial.newBoardA;
            this.boardB = trial.newBoardB;
            this.minesA = trial.newMinesA;
            this.minesB = trial.newMinesB;
            this.positionHistorySet.add(trial.nextStr);
            this.lastMoveMarkers = [{ board: m.board, row: m.row, col: m.col, color: playerVal }];
            this.nextMoveNumber++;
            this.passCounter = 0;
            this.moveCoords.push({ type: 'move', board: m.board, row: m.row, col: m.col, player: slot });
            this.pushSnapshot();
        }

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            this.tcSettings = tc.enabled ? {
                timed: true,
                mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
            } : { timed: false };
            this.matchStarted = true;
        }
        if (data.result) {
            this.gameOver = true;
            this.recordResultText = data.result;
            if (String(data.result).includes('白胜') || data.result === 'white') this.winner = 'white';
            else if (String(data.result).includes('黑胜') || data.result === 'black') this.winner = 'black';
            else this.winner = 'draw';
        }
        if (!this.matchStarted && this.moveCoords.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
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
                    this.slotJoinedAt[newSlot] = Date.now();
                    this._maybeBeginTimeNegotiation();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                {
                    const { row, col, board: which } = msg;
                    const wb = this.expectedBoard();
                    if (which !== wb) return;
                    if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                    const playerVal = slot === 'black' ? 1 : 2;
                    const minesBefore = which === 'A' ? this.minesA : this.minesB;
                    const hadMineBefore = this.isMine(minesBefore, row, col);
                    const trial = this.tryApplyMove(which, row, col, playerVal);
                    if (!trial) return;
                    this.boardA = trial.newBoardA;
                    this.boardB = trial.newBoardB;
                    this.minesA = trial.newMinesA;
                    this.minesB = trial.newMinesB;
                    this.positionHistorySet.add(trial.nextStr);
                    this.lastMoveMarkers = [{ board: which, row, col, color: playerVal }];
                    this.nextMoveNumber++;
                    this.passCounter = 0;
                    if (hadMineBefore) {
                        this.moveCoords.push({ type: 'clearMine', board: which, row, col, player: slot });
                        this.pushSnapshot();
                        this.broadcast({ type: 'broadcast', action: 'clearMine', ...this.getState() });
                        this._syncClockAfterTurnChange();
                    } else {
                        this.moveCoords.push({ type: 'move', board: which, row, col, player: slot });
                        this.pushSnapshot();
                        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                        this._syncClockAfterTurnChange();
                    }
                }
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                this.passCounter++;
                this.nextMoveNumber++;
                this.moveCoords.push({ type: 'pass', player: slot });
                this.lastMoveMarkers = [];
                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
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
                {
                    const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!undoOpponent) this.performUndoOneStep();
                    else {
                        this.pendingUndo = { requester: ws, opponent: undoOpponent };
                        undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                    }
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
                this.recordResultText = this.winner === 'black' ? '黑中盘胜' : '白中盘胜';
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                {
                    const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!newGameOpponent) this.resetGame();
                    else {
                        this.pendingNewGame = ws;
                        newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                    }
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) this.resetGame();
                else if (this.pendingNewGame && !msg.accept) this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                {
                    const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!drawOpponent) {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this.recordResultText = '和胜';
                        this._stopClockTicker();
                        this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                    } else {
                        this.pendingDraw = ws;
                        drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                    }
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和胜';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                {
                    const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!endOpponent) this.startScoreCounting(ws, ws);
                    else {
                        this.pendingEnd = { requester: ws, opponent: endOpponent };
                        endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                    }
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
                    if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
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
                    this.recordResultText = lead === 0 ? '和胜' : `${lead > 0 ? '黑' : '白'}胜${Math.abs(lead).toFixed(2)}点`;
                    this._stopClockTicker();
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
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
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
