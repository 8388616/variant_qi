const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, qiBoardSeatOverlay } = require('../common');

const MATCH_BLACK_WIN_SCORE = 22;
const MATCH_WHITE_WIN_SCORE = 20;

class MatchWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = []; // only placements, for hand index
        /** 棋谱：仅字符串数组。"B5,5" 落子；"B5,5,7,8" 落子后移除对手 (7,8) */
        this.recordMoves = [];
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.matchStarted = false;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
    }
    getCurrentSlot() { return this.currentPlayer === 1 ? 'black' : 'white'; }
    getOpponentVal(v) { return v === 1 ? 2 : 1; }

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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        const ws1 = this.room.getPlayerBySlot(first);
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws1) ws1.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.getCurrentSlot(), Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
        this.broadcast({ type: 'gameState', ...this.getState() });
    }

    _clearTimeNegotiation() {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset' });
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
        this.tcNego.lastProposerSlot = slot;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        const selfWs = this.room.getPlayerBySlot(slot);
        const peerWs = this.room.getPlayerBySlot(other);
        if (selfWs) selfWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        if (peerWs) {
            peerWs.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: v.timed,
                    mainMinutes: v.mainMinutes,
                    byoyomiSeconds: v.byoyomiSeconds,
                    maxTimeouts: v.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

    _timeAllowsPlay(slot) {
        if (!slot || this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (slot !== this.getCurrentSlot()) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        if (this.tcClock.paused) return false;
        return this.tcClock.activeSlot === slot;
    }

    _drainClockBeforeAction(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const now = Date.now();
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, now);
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        this._broadcastClock();
        return true;
    }

    _syncClockAfterTurnChange(previousSlot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const nextSlot = this.getCurrentSlot();
        if (nextSlot === previousSlot) {
            this._broadcastClock();
            return;
        }
        qiMatchTimeControl.setActiveSlot(this.tcClock, nextSlot, Date.now());
        this._broadcastClock();
    }

    afterColorAssigned(_ws, slot) {
        if (slot === 'black' || slot === 'white') this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    /** 仅在一方完整回合结束（轮到对方行棋）时根据积分判定胜负 */
    checkWinByScoreIfTurnEnded() {
        if (this.gameOver) return;
        if (this.blackScore >= MATCH_BLACK_WIN_SCORE) {
            this.gameOver = true;
            this.winner = 'black';
        } else if (this.whiteScore >= MATCH_WHITE_WIN_SCORE) {
            this.gameOver = true;
            this.winner = 'white';
        }
    }

    createSnapshot() {
        return {
            board: this.copyBoard(this.board),
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map(m => ({ ...m })),
            moveHistory: this.moveHistory.map(m => ({ ...m })),
            recordMoves: this.recordMoves.slice(),
            gameOver: this.gameOver,
            winner: this.winner,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            pendingRemoval: this.pendingRemoval ? { ...this.pendingRemoval } : null,
            recentClearedStones: this.recentClearedStones.map(s => ({ ...s })),
            recentClearedOwner: this.recentClearedOwner
        };
    }

    restoreSnapshot(snap) {
        this.board = this.copyBoard(snap.board);
        this.currentPlayer = snap.currentPlayer;
        this.lastMoveMarkers = (snap.lastMoveMarkers || []).map(m => ({ ...m }));
        this.moveHistory = (snap.moveHistory || []).map(m => ({ ...m }));
        this.recordMoves = (snap.recordMoves || []).slice();
        this.gameOver = !!snap.gameOver;
        this.winner = snap.winner ?? null;
        this.blackScore = snap.blackScore || 0;
        this.whiteScore = snap.whiteScore || 0;
        this.pendingRemoval = snap.pendingRemoval ? { ...snap.pendingRemoval } : null;
        this.recentClearedStones = (snap.recentClearedStones || []).map(s => ({ ...s }));
        this.recentClearedOwner = snap.recentClearedOwner || null;
    }

    collectLineCoords(row, col, dx, dy, colorVal) {
        const seq = [{ row, col }];
        for (let step = 1; step < this.BOARD_SIZE; step++) {
            const nr = row + dx * step;
            const nc = col + dy * step;
            if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
            seq.push({ row: nr, col: nc });
        }
        for (let step = 1; step < this.BOARD_SIZE; step++) {
            const nr = row - dx * step;
            const nc = col - dy * step;
            if (nr < 0 || nr >= this.BOARD_SIZE || nc < 0 || nc >= this.BOARD_SIZE || this.board[nr][nc] !== colorVal) break;
            seq.unshift({ row: nr, col: nc });
        }
        return seq;
    }

    resolveScoringAfterPlacement(row, col, colorVal) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        let scoreGain = 0;
        const toRemove = new Set();
        for (const [dx, dy] of directions) {
            const seq = this.collectLineCoords(row, col, dx, dy, colorVal);
            if (seq.length >= 5) {
                scoreGain += (seq.length - 4);
                for (const p of seq) toRemove.add(`${p.row},${p.col}`);
            }
        }
        const removed = [];
        if (scoreGain > 0) {
            for (const key of toRemove) {
                const [r, c] = key.split(',').map(Number);
                this.board[r][c] = 0;
                removed.push({ row: r, col: c, color: colorVal });
            }
        }
        return { gain: scoreGain, removed };
    }

    countStones(stoneVal) {
        let n = 0;
        for (let r = 0; r < this.BOARD_SIZE; r++)
            for (let c = 0; c < this.BOARD_SIZE; c++)
                if (this.board[r][c] === stoneVal) n++;
        return n;
    }

    isBoardFull() {
        return squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE);
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore,
            pendingRemoval: this.pendingRemoval,
            recentClearedStones: this.recentClearedStones,
            matchStarted: this.matchStarted,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            moves: this.recordMoves.slice(),
            moveHistory: this.moveHistory.map(m => ({ player: m.player, row: m.row, col: m.col })),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    /**
     * @returns {{ player: 'black'|'white', place: {row:number,col:number}, remove: {row:number,col:number}|null }|null}
     */
    parseMoveRecordString(s) {
        if (typeof s !== 'string' || s.length < 3) return null;
        const ch = s[0];
        if (ch !== 'B' && ch !== 'W') return null;
        const player = ch === 'B' ? 'black' : 'white';
        const parts = s.substring(1).split(',').map(Number);
        if (parts.length !== 2 && parts.length !== 4) return null;
        if (!parts.every(x => Number.isFinite(x))) return null;
        const row = parts[0];
        const col = parts[1];
        if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return null;
        if (parts.length === 2) return { player, place: { row, col }, remove: null };
        const rr = parts[2];
        const rc = parts[3];
        if (rr < 0 || rr >= this.BOARD_SIZE || rc < 0 || rc >= this.BOARD_SIZE) return null;
        return { player, place: { row, col }, remove: { row: rr, col: rc } };
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '消除五子棋',
            gameId: 'match-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.recordMoves.slice(),
            result: this.gameOver ? this.winner : null,
            blackScore: this.blackScore,
            whiteScore: this.whiteScore
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.recordMoves = [];
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.matchStarted = false;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._stopClockTicker();
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
        if (!data || data.gameId !== 'match-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要消除五子棋棋谱）。' }));
            return;
        }
        const newSize = Number(data.boardSize || 13);
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.BOARD_SIZE = newSize;
        this.resetToEmpty();

        if (!Array.isArray(data.moves)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱缺少 moves。' }));
            return;
        }

        for (let i = 0; i < data.moves.length; i++) {
            const parsed = this.parseMoveRecordString(data.moves[i]);
            if (!parsed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式无效。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const { player, place: { row, col }, remove } = parsed;
            const expect = this.getCurrentSlot();
            if (player !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.pendingRemoval) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手应先完成移除。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手落子点非空。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const playerVal = player === 'black' ? 1 : 2;
            this.board[row][col] = playerVal;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];
            this.moveHistory.push({ player, row, col });

            const { gain, removed } = this.resolveScoringAfterPlacement(row, col, playerVal);
            if (player === 'black') this.blackScore += gain;
            else this.whiteScore += gain;
            this.recentClearedStones = removed;
            this.recentClearedOwner = removed.length > 0 ? player : null;

            let turnEnded = false;
            if (gain > 0) {
                const opponentVal = this.getOpponentVal(playerVal);
                const canRemove = Math.min(1, this.countStones(opponentVal));
                if (canRemove > 0) {
                    this.pendingRemoval = {
                        player,
                        remaining: canRemove,
                        total: canRemove,
                        removed: 0,
                        hand: this.moveHistory.length
                    };
                } else {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                    turnEnded = true;
                }
            } else {
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                turnEnded = true;
            }

            if (turnEnded) this.checkWinByScoreIfTurnEnded();

            if (!this.gameOver && !this.pendingRemoval && this.isBoardFull()) {
                this.checkWinByScoreIfTurnEnded();
                if (!this.gameOver) {
                    this.gameOver = true;
                    this.winner = 'draw';
                }
            }

            if (remove) {
                if (!this.pendingRemoval) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手不应包含移除坐标。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const rr = remove.row;
                const rc = remove.col;
                const opponentVal = this.getOpponentVal(playerVal);
                if (this.board[rr][rc] !== opponentVal) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手移除点不是对手棋子。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.board[rr][rc] = 0;
                this.pendingRemoval.remaining -= 1;
                this.pendingRemoval.removed += 1;
                if (this.pendingRemoval.remaining <= 0) {
                    this.pendingRemoval = null;
                }
            } else if (this.pendingRemoval) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手缺少移除坐标（应与本手落子合并为一条）。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            if (this.gameOver) break;
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.recordMoves = data.moves.map(s => String(s));
        this.historyBoards = [];
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                moves: this.recordMoves.slice()
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws, msg);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'move': {
                if (this.gameOver || this.pendingRemoval) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeAction(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                this.historyBoards.push(this.createSnapshot());
                if (this.recentClearedStones.length > 0 && this.recentClearedOwner && this.recentClearedOwner !== slot) {
                    this.recentClearedStones = [];
                    this.recentClearedOwner = null;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                this.board[row][col] = playerVal;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player: slot, row, col });

                const { gain, removed } = this.resolveScoringAfterPlacement(row, col, playerVal);
                if (slot === 'black') this.blackScore += gain;
                else this.whiteScore += gain;
                this.recentClearedStones = removed;
                this.recentClearedOwner = removed.length > 0 ? slot : null;

                const pushPlaceOnly = () => {
                    this.recordMoves.push(`${slot === 'black' ? 'B' : 'W'}${row},${col}`);
                };

                const beforeSlot = this.getCurrentSlot();
                if (gain > 0) {
                    const opponentVal = this.getOpponentVal(playerVal);
                    const canRemove = Math.min(1, this.countStones(opponentVal));
                    if (canRemove > 0) {
                        this.pendingRemoval = { player: slot, remaining: canRemove, total: canRemove, removed: 0, hand: this.moveHistory.length };
                    } else {
                        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                        this.checkWinByScoreIfTurnEnded();
                        pushPlaceOnly();
                    }
                } else {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                    this.checkWinByScoreIfTurnEnded();
                    pushPlaceOnly();
                }

                if (!this.pendingRemoval && this.isBoardFull()) {
                    this.checkWinByScoreIfTurnEnded();
                    if (!this.gameOver) {
                        this.gameOver = true;
                        this.winner = 'draw';
                    }
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }
                if (this.gameOver) {
                    this._stopClockTicker();
                } else {
                    this._syncClockAfterTurnChange(beforeSlot);
                }
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;
            }

            case 'removeOpponent': {
                if (this.gameOver || !this.pendingRemoval) return;
                if (!slot || slot !== this.pendingRemoval.player) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeAction(slot)) return;
                const row = msg.row;
                const col = msg.col;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                const playerVal = slot === 'black' ? 1 : 2;
                const opponentVal = this.getOpponentVal(playerVal);
                if (this.board[row][col] !== opponentVal) return;

                this.board[row][col] = 0;
                this.pendingRemoval.remaining -= 1;
                this.pendingRemoval.removed += 1;

                if (this.pendingRemoval.remaining <= 0) {
                    const pl = this.moveHistory[this.pendingRemoval.hand - 1];
                    this.recordMoves.push(`${pl.player === 'black' ? 'B' : 'W'}${pl.row},${pl.col},${row},${col}`);
                    this.pendingRemoval = null;
                }
                this._broadcastClock();
                this.broadcast({ type: 'broadcast', action: 'remove', ...this.getState() });
                break;
            }

            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                const isMyTurn = (slot === 'black' && this.currentPlayer === 1) || (slot === 'white' && this.currentPlayer === 2);
                let steps = isMyTurn ? 2 : 1;
                if (this.pendingRemoval && slot === this.pendingRemoval.player) steps = 1;
                if (this.historyBoards.length < steps) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = this.room.getPlayerBySlot(opponentSlot);
                if (!opponent) {
                    for (let i = 0; i < steps; i++) this.restoreSnapshot(this.historyBoards.pop());
                    this.lastMoveMarkers = [];
                    this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                } else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse':
                if (this.pendingUndo && msg.accept) {
                    const steps = this.pendingUndo.steps;
                    if (this.historyBoards.length >= steps) {
                        for (let i = 0; i < steps; i++) this.restoreSnapshot(this.historyBoards.pop());
                        this.lastMoveMarkers = [];
                        if (this.tcClock && this.tcClock.timed && !this.gameOver) {
                            qiMatchTimeControl.setActiveSlot(this.tcClock, this.getCurrentSlot(), Date.now());
                            this._broadcastClock();
                        }
                        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
                    }
                } else if (this.pendingUndo && !msg.accept) {
                    this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
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
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.recordMoves = [];
        this.gameOver = false;
        this.winner = null;
        this.blackScore = 0;
        this.whiteScore = 0;
        this.pendingRemoval = null;
        this.recentClearedStones = [];
        this.recentClearedOwner = null;
        this.matchStarted = false;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._stopClockTicker();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) {
            this.room.broadcast({ type: 'playerLeft', slot });
            this.slotJoinedAt[slot] = null;
            if (!this.matchStarted) this._clearTimeNegotiation();
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new MatchWuziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
