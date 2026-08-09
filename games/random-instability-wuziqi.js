const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, qiBoardSeatOverlay } = require('../common');
class RandomInstabilityWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 9;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.nextLifetimePreview = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.matchStarted = false;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.generateNextPreview();
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

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer, Date.now());
        this._broadcastClock();
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== this.currentPlayer) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker();
        this.gameOver = true;
        this.winner = winnerSlot;
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveLog.length > 0 || this.gameOver) return;
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

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || slot !== this.tcNego.waitingSlot) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        this.tcNego.proposal = v;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) otherWs.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'respond', proposal: v }));
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond' || slot !== this.tcNego.waitingSlot) return;
        const p = this.tcNego.proposal;
        if (!p || p.ok !== true) return;
        this.tcSettings = p.timed
            ? { timed: true, mainMinutes: p.mainMinutes, byoyomiSeconds: p.byoyomiSeconds, maxTimeouts: p.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer, Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }

    generateNextPreview() {
        const base = 5 + 0.05 * this.moveCount;
        const raw = base * Math.random() + 0.05 * this.moveCount;
        let lifetime = 2 * Math.floor(raw) + 5;
        this.nextLifetimePreview = Math.max(5, lifetime);
    }

    decrementLifetimesAndRemove() {
        let changed = false;
        for (let i = 0; i < this.BOARD_SIZE; i++) {
            for (let j = 0; j < this.BOARD_SIZE; j++) {
                if (this.lifetimes[i][j] > 0) {
                    this.lifetimes[i][j]--;
                    if (this.lifetimes[i][j] === 0) {
                        this.board[i][j] = 0;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    getMoveCount() {
        return this.moveLog.length;
    }

    checkWin(row, col, colorVal) {
        return squareWuziqiRules.checkFiveInRow(this.board, row, col, colorVal, this.BOARD_SIZE);
    }

    isDraw() {
        return squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE);
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            lifetimes: this.lifetimes,
            currentPlayer: this.currentPlayer,
            moveCount: this.moveCount,
            nextLifetimePreview: this.nextLifetimePreview,
            gameOver: this.gameOver,
            winner: this.winner,
            lastMoveMarkers: this.lastMoveMarkers,
            moveLog: this.moveLog.map(m => ({ ...m })),
            matchStarted: this.matchStarted,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
            },
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    copyLifetimes(src) {
        return src.map(row => row.slice());
    }

    static encodeMove(m) {
        const h = m.player === 'black' ? 'B' : 'W';
        if (m.type === 'pass') {
            return m.nextPreview != null ? `${h}p,${m.nextPreview}` : `${h}p`;
        }
        return `${h}${m.row},${m.col},${m.lifetime}`;
    }

    /** @returns {{ type?: string, player: string, row?: number, col?: number, lifetime?: number, nextPreview?: number|null } | null} */
    static parseMoveEntry(entry) {
        if (entry && typeof entry === 'object' && entry.player) {
            if (entry.type === 'pass') {
                return {
                    type: 'pass',
                    player: entry.player,
                    nextPreview: entry.nextPreview != null ? entry.nextPreview : null
                };
            }
            return {
                player: entry.player,
                row: entry.row,
                col: entry.col,
                lifetime: entry.lifetime,
                nextPreview: entry.nextPreview != null ? entry.nextPreview : null
            };
        }
        if (typeof entry !== 'string' || entry.length < 2) return null;
        const head = entry[0];
        if (head !== 'B' && head !== 'W') return null;
        const player = head === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') {
            let nextPreview = null;
            if (entry.length > 2 && entry[2] === ',') {
                const n = +entry.slice(3);
                if (Number.isFinite(n)) nextPreview = n;
            }
            return { type: 'pass', player, nextPreview };
        }
        const parts = entry.slice(1).split(',');
        if (parts.length < 3) return null;
        const row = +parts[0];
        const col = +parts[1];
        const lifetime = +parts[2];
        const nextPreview = parts.length >= 4 ? +parts[3] : null;
        if (!Number.isFinite(row) || !Number.isFinite(col) || !Number.isFinite(lifetime)) return null;
        return { player, row, col, lifetime, nextPreview: Number.isFinite(nextPreview) ? nextPreview : null };
    }

    _trailingPassCount() {
        let n = 0;
        for (let i = this.moveLog.length - 1; i >= 0; i--) {
            if (this.moveLog[i].type === 'pass') n++;
            else break;
        }
        return n;
    }

    buildSnapshotsFromMoves(moves, openingPreview, boardSize) {
        const size = boardSize;
        const snapshots = [];
        let board = Array(size).fill().map(() => Array(size).fill(0));
        let lifetimes = Array(size).fill().map(() => Array(size).fill(0));
        let currentPlayer = 'black';
        let moveCount = 0;
        const norm = (e) => RandomInstabilityWuziqiRoom.parseMoveEntry(e);
        let nextPreview;
        if (moves.length > 0) {
            const m0 = norm(moves[0]);
            if (!m0) return null;
            nextPreview = m0.type === 'pass'
                ? (openingPreview != null ? openingPreview : null)
                : m0.lifetime;
            if (nextPreview == null) return null;
        } else {
            nextPreview = openingPreview;
        }
        let lastMoveMarkers = [];

        snapshots.push({
            board: board.map(r => r.slice()),
            lifetimes: lifetimes.map(r => r.slice()),
            currentPlayer,
            moveCount,
            nextLifetimePreview: nextPreview,
            lastMoveMarkers: [],
            gameOver: false,
            winner: null
        });

        for (let i = 0; i < moves.length; i++) {
            const m = norm(moves[i]);
            if (!m) return null;
            const slot = m.player;
            if (slot !== currentPlayer) return null;

            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (lifetimes[r][c] > 0) {
                        lifetimes[r][c]--;
                        if (lifetimes[r][c] === 0) board[r][c] = 0;
                    }
                }
            }

            if (m.type === 'pass') {
                lastMoveMarkers = [];
                if (m.nextPreview != null) nextPreview = m.nextPreview;
                let gameOver = false;
                let winner = null;
                const trailing = (() => {
                    let n = 1;
                    for (let j = i - 1; j >= 0; j--) {
                        const prev = norm(moves[j]);
                        if (prev && prev.type === 'pass') n++;
                        else break;
                    }
                    return n;
                })();
                if (trailing >= 2) {
                    gameOver = true;
                    winner = 'draw';
                }
                if (gameOver) {
                    snapshots.push({
                        board: board.map(r => r.slice()),
                        lifetimes: lifetimes.map(r => r.slice()),
                        currentPlayer: slot,
                        moveCount,
                        nextLifetimePreview: nextPreview,
                        lastMoveMarkers: [],
                        gameOver: true,
                        winner
                    });
                    break;
                }
                currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
                moveCount++;
                snapshots.push({
                    board: board.map(r => r.slice()),
                    lifetimes: lifetimes.map(r => r.slice()),
                    currentPlayer,
                    moveCount,
                    nextLifetimePreview: nextPreview,
                    lastMoveMarkers: [],
                    gameOver: false,
                    winner: null
                });
                continue;
            }

            const lifetimePlaced = m.lifetime;
            if (lifetimePlaced !== nextPreview) return null;

            const playerVal = slot === 'black' ? 1 : 2;
            board[m.row][m.col] = playerVal;
            lifetimes[m.row][m.col] = lifetimePlaced;
            lastMoveMarkers = [{ row: m.row, col: m.col, color: playerVal }];

            let gameOver = false;
            let winner = null;
            if (squareWuziqiRules.checkFiveInRow(board, m.row, m.col, playerVal, size)) {
                gameOver = true;
                winner = slot;
            } else {
                let full = true;
                for (let r = 0; r < size && full; r++)
                    for (let c = 0; c < size; c++)
                        if (board[r][c] === 0) { full = false; break; }
                if (full) {
                    gameOver = true;
                    winner = 'draw';
                }
            }

            if (gameOver) {
                snapshots.push({
                    board: board.map(r => r.slice()),
                    lifetimes: lifetimes.map(r => r.slice()),
                    currentPlayer: slot,
                    moveCount,
                    nextLifetimePreview: null,
                    lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                    gameOver: true,
                    winner
                });
                break;
            }

            currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
            moveCount++;
            if (i + 1 < moves.length) {
                const mn = norm(moves[i + 1]);
                if (!mn) return null;
                if (mn.type === 'pass') {
                    if (m.nextPreview != null) nextPreview = m.nextPreview;
                } else {
                    nextPreview = mn.lifetime;
                }
            } else {
                nextPreview = m.nextPreview != null ? m.nextPreview : null;
            }

            snapshots.push({
                board: board.map(r => r.slice()),
                lifetimes: lifetimes.map(r => r.slice()),
                currentPlayer,
                moveCount,
                nextLifetimePreview: nextPreview,
                lastMoveMarkers: lastMoveMarkers.map(x => ({ ...x })),
                gameOver: false,
                winner: null
            });
        }
        return snapshots;
    }

    exportRecord() {
        const moves = this.moveLog.map(m => RandomInstabilityWuziqiRoom.encodeMove(m));
        const openPv = this.moveLog.length > 0 ? this.moveLog[0].previewBefore : this.nextLifetimePreview;
        return {
            format: 'muzei',
            version: 2,
            gameType: '随机不稳定五子棋',
            gameId: 'random-instability-wuziqi',
            boardSize: this.BOARD_SIZE,
            openingPreview: openPv,
            moves,
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.matchStarted = false;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._stopClockTicker();
        this.generateNextPreview();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变棋盘大小。' }));
            return false;
        }
        this.BOARD_SIZE = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'random-instability-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要随机不稳定五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        const rawMoves = data.moves || [];
        this.BOARD_SIZE = newSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];

        if (rawMoves.length > 0) {
            const m0 = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[0]);
            if (!m0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱第 1 手无法解析' }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (m0.type === 'pass') {
                if (data.openingPreview != null) this.nextLifetimePreview = data.openingPreview;
                else this.generateNextPreview();
            } else {
                if (data.openingPreview != null && data.openingPreview !== m0.lifetime) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱 openingPreview 与第一手寿命不一致' }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.nextLifetimePreview = m0.lifetime;
            }
        } else if (data.openingPreview != null) {
            this.nextLifetimePreview = data.openingPreview;
        } else {
            this.generateNextPreview();
        }

        for (let i = 0; i < rawMoves.length; i++) {
            const m = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[i]);
            if (!m) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 1} 手无法解析` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = m.player;
            if (slot !== this.currentPlayer) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 步行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const previewBefore = this.nextLifetimePreview;
            this.historyBoards.push(this.copyBoard(this.board));
            this.historyLifetimes.push(this.copyLifetimes(this.lifetimes));
            this.decrementLifetimesAndRemove();

            if (m.type === 'pass') {
                this.lastMoveMarkers = [];
                if (m.nextPreview != null) {
                    this.nextLifetimePreview = m.nextPreview;
                } else {
                    this.generateNextPreview();
                }
                this.moveLog.push({
                    type: 'pass',
                    player: slot,
                    previewBefore,
                    nextPreview: this.nextLifetimePreview
                });
                this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
                this.moveCount++;
                if (this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    break;
                }
                continue;
            }

            if (m.lifetime !== this.nextLifetimePreview) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手寿命预览与记录不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const { row, col } = m;
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE || this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手落点非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const playerVal = slot === 'black' ? 1 : 2;
            this.board[row][col] = playerVal;
            this.lifetimes[row][col] = this.nextLifetimePreview;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];

            const lifetimeUsed = previewBefore;

            if (this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: null
                });
                break;
            }
            if (this.isDraw()) {
                this.gameOver = true;
                this.winner = 'draw';
                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: null
                });
                break;
            }

            this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
            this.moveCount++;

            let np = null;
            if (i + 1 < rawMoves.length) {
                const mn = RandomInstabilityWuziqiRoom.parseMoveEntry(rawMoves[i + 1]);
                if (!mn) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第 ${i + 2} 手无法解析` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (mn.type !== 'pass') np = mn.lifetime;
            }
            if (m.nextPreview != null && np != null && m.nextPreview !== np) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第 ${i + 1} 手下一手寿命与记录不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (np != null) {
                this.nextLifetimePreview = np;
            } else if (i + 1 >= rawMoves.length) {
                this.generateNextPreview();
            }
            /* next is pass：本手后的预览在落子时已 generate；虚着手内再刷新 */
            const loggedNext = np != null ? np : this.nextLifetimePreview;

            this.moveLog.push({
                player: slot,
                row,
                col,
                lifetime: lifetimeUsed,
                previewBefore,
                nextPreview: loggedNext
            });
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }
        if (!this.matchStarted && this.moveLog.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }

        let snapshots = this.buildSnapshotsFromMoves(rawMoves, data.openingPreview, this.BOARD_SIZE);
        if (!snapshots) snapshots = [];

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: { snapshots }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: this.afterColorAssigned.bind(this) });
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize': {
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;
            }

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!this.matchStarted || this.tcNego || this.tcSettings === null) return;
                if (!slot || slot !== this.currentPlayer) return;
                if (!this._drainClockBeforeMove(slot)) return;

                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                const previewBefore = this.nextLifetimePreview;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyLifetimes.push(this.copyLifetimes(this.lifetimes));

                this.decrementLifetimesAndRemove();

                const playerVal = slot === 'black' ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lifetimes[row][col] = this.nextLifetimePreview;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                const lifetimeUsed = previewBefore;

                if (this.checkWin(row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = slot;
                    this._stopClockTicker();
                    this.moveLog.push({
                        player: slot,
                        row,
                        col,
                        lifetime: lifetimeUsed,
                        previewBefore,
                        nextPreview: null
                    });
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        board: this.board,
                        lifetimes: this.lifetimes,
                        currentPlayer: this.currentPlayer,
                        moveCount: this.moveCount,
                        nextLifetimePreview: this.nextLifetimePreview,
                        lastMoveMarkers: this.lastMoveMarkers,
                        gameOver: true,
                        winner: this.winner
                    });
                    return;
                }

                if (this.isDraw()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this._stopClockTicker();
                    this.moveLog.push({
                        player: slot,
                        row,
                        col,
                        lifetime: lifetimeUsed,
                        previewBefore,
                        nextPreview: null
                    });
                    this.broadcast({
                        type: 'broadcast',
                        action: 'move',
                        board: this.board,
                        lifetimes: this.lifetimes,
                        currentPlayer: this.currentPlayer,
                        moveCount: this.moveCount,
                        nextLifetimePreview: this.nextLifetimePreview,
                        lastMoveMarkers: this.lastMoveMarkers,
                        gameOver: true,
                        winner: 'draw'
                    });
                    return;
                }

                this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                this.moveCount++;
                this.generateNextPreview();
                this._syncClockAfterTurnChange();
                const np = this.nextLifetimePreview;

                this.moveLog.push({
                    player: slot,
                    row,
                    col,
                    lifetime: lifetimeUsed,
                    previewBefore,
                    nextPreview: np
                });

                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: this.board,
                    lifetimes: this.lifetimes,
                    currentPlayer: this.currentPlayer,
                    moveCount: this.moveCount,
                    nextLifetimePreview: this.nextLifetimePreview,
                    lastMoveMarkers: this.lastMoveMarkers,
                    gameOver: false
                });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!this.matchStarted || this.tcNego || this.tcSettings === null) return;
                if (!slot || slot !== this.currentPlayer) return;
                if (!this._drainClockBeforeMove(slot)) return;

                {
                    const previewBefore = this.nextLifetimePreview;
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyLifetimes.push(this.copyLifetimes(this.lifetimes));
                    this.decrementLifetimesAndRemove();
                    this.lastMoveMarkers = [];
                    this.generateNextPreview();
                    this.moveLog.push({
                        type: 'pass',
                        player: slot,
                        previewBefore,
                        nextPreview: this.nextLifetimePreview
                    });
                    this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                    this.moveCount++;
                    if (this._trailingPassCount() >= 2) {
                        this.gameOver = true;
                        this.winner = 'draw';
                        this._stopClockTicker();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'pass',
                            board: this.board,
                            lifetimes: this.lifetimes,
                            currentPlayer: this.currentPlayer,
                            moveCount: this.moveCount,
                            nextLifetimePreview: this.nextLifetimePreview,
                            lastMoveMarkers: this.lastMoveMarkers,
                            gameOver: true,
                            winner: 'draw',
                            moveLog: this.moveLog.map(m => ({ ...m }))
                        });
                        return;
                    }
                    this._syncClockAfterTurnChange();
                    this.broadcast({
                        type: 'broadcast',
                        action: 'pass',
                        board: this.board,
                        lifetimes: this.lifetimes,
                        currentPlayer: this.currentPlayer,
                        moveCount: this.moveCount,
                        nextLifetimePreview: this.nextLifetimePreview,
                        lastMoveMarkers: this.lastMoveMarkers,
                        gameOver: false,
                        moveLog: this.moveLog.map(m => ({ ...m }))
                    });
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!undoOpponent) {
                    if (this.historyBoards.length > 0) {
                        this.board = this.copyBoard(this.historyBoards.pop());
                        this.lifetimes = this.copyLifetimes(this.historyLifetimes.pop());
                        this.moveLog.pop();
                        this.lastMoveMarkers = [];
                        this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                        this.moveCount--;
                        this.generateNextPreview();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: this.board,
                            lifetimes: this.lifetimes,
                            currentPlayer: this.currentPlayer,
                            moveCount: this.moveCount,
                            nextLifetimePreview: this.nextLifetimePreview,
                            lastMoveMarkers: this.lastMoveMarkers
                        });
                    }
                    return;
                }
                this.pendingUndo = ws;
                undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                break;

            case 'undoResponse':
                if (this.pendingUndo && this.historyBoards.length > 0) {
                    if (msg.accept) {
                        this.board = this.copyBoard(this.historyBoards.pop());
                        this.lifetimes = this.copyLifetimes(this.historyLifetimes.pop());
                        this.moveLog.pop();
                        this.lastMoveMarkers = [];
                        this.currentPlayer = (this.currentPlayer === 'black') ? 'white' : 'black';
                        this.moveCount--;
                        this.generateNextPreview();
                        this.broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: this.board,
                            lifetimes: this.lifetimes,
                            currentPlayer: this.currentPlayer,
                            moveCount: this.moveCount,
                            nextLifetimePreview: this.nextLifetimePreview,
                            lastMoveMarkers: this.lastMoveMarkers
                        });
                    } else {
                        this.pendingUndo.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                    }
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver) this._stopClockTicker();
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                if (this.gameOver) this._stopClockTicker();
                break;

            default:
                break;
        }
    }

    resetGame() {
        this._stopClockTicker();
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.lifetimes = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 'black';
        this.moveCount = 0;
        this.gameOver = false;
        this.winner = null;
        this.historyBoards = [];
        this.historyLifetimes = [];
        this.lastMoveMarkers = [];
        this.moveLog = [];
        this.matchStarted = false;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.generateNextPreview();

        const room = this.room;
        for (let [client, slot] of room.players.entries()) {
            room.slotOccupancy.delete(slot);
            room.players.delete(client);
            room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({
            type: 'newGameStarted',
            board: this.board,
            boardSize: this.BOARD_SIZE,
            lifetimes: this.lifetimes,
            currentPlayer: this.currentPlayer,
            moveCount: this.moveCount,
            nextLifetimePreview: this.nextLifetimePreview,
            slots: { black: false, white: false }
        });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) {
            this.slotJoinedAt[slot] = null;
            this.room.broadcast({ type: 'playerLeft', slot });
        }
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new RandomInstabilityWuziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
