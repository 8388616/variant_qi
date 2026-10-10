'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, qiBoardSeatOverlay } = require('../common');

const MAX_DRIFTS = 8;

function computeDriftInterval(n) {
    let x = Math.ceil(0.07 * n * n);
    if (x % 2 === 0) x += 1;
    return x;
}

/** 与漂移围棋/drift-weiqi.js 中象限顺时针漂移一致 */
function driftCell(r, c, half) {
    if (r < half && c < half) return [r, c + half];
    if (r < half) return [r + half, c];
    if (c < half) return [r - half, c];
    return [r, c - half];
}

function initZero2D(n) {
    return Array(n).fill(0).map(() => Array(n).fill(0));
}

function driftBoardLike(board, n, mapCell) {
    const nb = initZero2D(n);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const [nr, nc] = mapCell(r, c);
            nb[nr][nc] = board[r][c];
        }
    }
    return nb;
}

function driftQuadrantsClockwise(board, handNumAt, n) {
    const half = n / 2;
    const mapCell = (r, c) => driftCell(r, c, half);
    return {
        board: driftBoardLike(board, n, mapCell),
        handNumAt: driftBoardLike(handNumAt, n, mapCell)
    };
}

function driftLastMoveMarkers(markers, n) {
    if (!markers || !markers.length) return [];
    const half = n / 2;
    return markers.map(m => {
        const [nr, nc] = driftCell(m.row, m.col, half);
        return { row: nr, col: nc, color: m.color };
    });
}

function syncHandNumWithBoard(board, handNumAt) {
    const n = board.length;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === 0) handNumAt[r][c] = 0;
        }
    }
}

function maybeDriftAfterPly(opts) {
    const {
        board,
        handNumAt,
        driftCount,
        n,
        driftInterval,
        completedPlyCount,
        lastMoveMarkers
    } = opts;
    if (driftCount >= MAX_DRIFTS) {
        return { board, handNumAt, driftCount, lastMoveMarkers };
    }
    if (completedPlyCount <= 0 || completedPlyCount % driftInterval !== 0) {
        return { board, handNumAt, driftCount, lastMoveMarkers };
    }
    const r = driftQuadrantsClockwise(board, handNumAt, n);
    return {
        board: r.board,
        handNumAt: r.handNumAt,
        driftCount: driftCount + 1,
        lastMoveMarkers: driftLastMoveMarkers(lastMoveMarkers, n)
    };
}

/** 全盘是否存在该颜色的连五（用于板块漂移后的胜负判定） */
function boardHasFiveForColor(board, n, colorVal) {
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === colorVal && squareWuziqiRules.checkFiveInRow(board, r, c, colorVal, n)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 漂移后若形成连五则终局。双方同时连五判和棋。
 * @returns {'player1'|'player2'|'draw'|null} 座位名（player1 执黑、黑先）
 */
function winnerSlotAfterDrift(board, n) {
    const blackFive = boardHasFiveForColor(board, n, 1);
    const whiteFive = boardHasFiveForColor(board, n, 2);
    if (blackFive && whiteFive) return 'draw';
    if (blackFive) return 'player1';
    if (whiteFive) return 'player2';
    return null;
}

class DriftWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 12) {
        super(room);
        this.BOARD_SIZE = initialSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.handNumAt = initZero2D(this.BOARD_SIZE);
        this.driftCount = 0;
        this.driftInterval = computeDriftInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    checkWin(row, col, colorVal) {
        return squareWuziqiRules.checkFiveInRow(this.board, row, col, colorVal, this.BOARD_SIZE);
    }

    isBoardFull() {
        return squareWuziqiRules.isBoardFull(this.board, this.BOARD_SIZE);
    }

    _trailingPassCount() {
        let n = 0;
        for (let i = this.moveHistory.length - 1; i >= 0; i--) {
            if (this.moveHistory[i].type === 'pass') n++;
            else break;
        }
        return n;
    }

    wireMoveCoords() {
        return this.moveHistory.map(m => {
            if (m.type === 'pass') return { type: 'pass', player: m.player };
            return { type: 'move', player: m.player, row: m.row, col: m.col };
        });
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

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expected = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expected) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker();
        this.gameOver = true;
        this.winner = winnerSlot;
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else this.tcClock = null;
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }
    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            handNumAt: this.handNumAt,
            driftCount: this.driftCount,
            driftInterval: this.driftInterval,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.wireMoveCoords(),
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '漂移五子棋',
            gameId: 'drift-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveHistory.map(m => {
                const p = (m.player === 'player1' ? 'B' : 'W');
                return m.type === 'pass' ? `${p}p` : `${p}${m.row},${m.col}`;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.handNumAt = initZero2D(this.BOARD_SIZE);
        this.driftCount = 0;
        this.driftInterval = computeDriftInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.importReplayNoJudge = false;
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小须为 8～20 之间的偶数路。' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有多人落座，不能修改棋盘大小' }));
            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.BOARD_SIZE = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.BOARD_SIZE });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    performUndoSteps(steps) {
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                this.historyBoards.pop();
                this.historyHandNumAts.pop();
                this.historyDriftCounts.pop();
            }
            if (this.moveHistory.length > 0) this.moveHistory.pop();
        }
        if (this.historyBoards.length === 0) {
            this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
            this.handNumAt = initZero2D(this.BOARD_SIZE);
            this.driftCount = 0;
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.handNumAt = this.copyBoard(this.historyHandNumAts.at(-1));
            this.driftCount = this.historyDriftCounts.at(-1);
        }
        let newPlayer = this.currentPlayer;
        for (let i = 0; i < steps; i++) {
            newPlayer = newPlayer === 1 ? 2 : 1;
        }
        this.currentPlayer = newPlayer;
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: this.afterColorAssigned ? this.afterColorAssigned.bind(this) : undefined });
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
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

            case 'move':
                if (this.gameOver) return;
                if (!this.matchStarted || this.tcSettings === null || this.tcNego) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.copyBoard(this.board);
                newBoard[row][col] = playerVal;

                const handNumAt = this.copyBoard(this.handNumAt);
                syncHandNumWithBoard(newBoard, handNumAt);
                const completedPlyCount = this.moveHistory.length + 1;
                handNumAt[row][col] = completedPlyCount;

                this.board = newBoard;
                this.handNumAt = handNumAt;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.moveHistory.push({ player: slot, row, col });

                if (this.checkWin(row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = slot;
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }

                const prevDriftCount = this.driftCount;
                const preBoardAnim = this.copyBoard(this.board);
                const preHandAnim = this.copyBoard(this.handNumAt);
                const preMarkersAnim = [{ row, col, color: playerVal }];

                const rot = maybeDriftAfterPly({
                    board: this.board,
                    handNumAt: this.handNumAt,
                    driftCount: this.driftCount,
                    n: this.BOARD_SIZE,
                    driftInterval: this.driftInterval,
                    completedPlyCount,
                    lastMoveMarkers: this.lastMoveMarkers
                });

                const driftedThisPly = rot.driftCount > prevDriftCount;
                this.board = rot.board;
                this.handNumAt = rot.handNumAt;
                this.driftCount = rot.driftCount;
                this.lastMoveMarkers = rot.lastMoveMarkers;

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
                this.historyDriftCounts.push(this.driftCount);

                if (driftedThisPly) {
                    const rotWin = winnerSlotAfterDrift(this.board, this.BOARD_SIZE);
                    if (rotWin) {
                        this.gameOver = true;
                        this.winner = rotWin;
                        this._stopClockTicker();
                    }
                }

                if (!this.gameOver) {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                } else if (this.winner === 'player1' || this.winner === 'player2') {
                    this.currentPlayer = this.winner === 'player1' ? 1 : 2;
                }

                if (!this.gameOver && this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this._stopClockTicker();
                }

                const payload = { type: 'broadcast', action: 'move', ...this.getState() };
                if (driftedThisPly) {
                    payload.driftAnimation = {
                        preBoard: preBoardAnim,
                        postBoard: this.copyBoard(this.board),
                        preHandNumAt: preHandAnim,
                        postHandNumAt: this.copyBoard(this.handNumAt),
                        preMarkers: preMarkersAnim,
                        postMarkers: this.lastMoveMarkers.map(m => ({ ...m }))
                    };
                }
                this.broadcast(payload);
                this._syncClockAfterTurnChange();

                if (
                    !this.gameOver
                    && (this.moveHistory.length + 1) % this.driftInterval === 0
                    && this.driftCount < MAX_DRIFTS
                ) {
                    this.broadcast({ type: 'driftPrepare' });
                }
                break;

            case 'pass': {
                if (this.gameOver) return;
                if (!this.matchStarted || this.tcSettings === null || this.tcNego) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._drainClockBeforeMove(slot)) return;

                this.lastMoveMarkers = [];
                this.moveHistory.push({ type: 'pass', player: slot });
                const completedPlyCount = this.moveHistory.length;

                const prevDriftCount = this.driftCount;
                const preBoardAnim = this.copyBoard(this.board);
                const preHandAnim = this.copyBoard(this.handNumAt);
                const preMarkersAnim = [];

                const rot = maybeDriftAfterPly({
                    board: this.board,
                    handNumAt: this.handNumAt,
                    driftCount: this.driftCount,
                    n: this.BOARD_SIZE,
                    driftInterval: this.driftInterval,
                    completedPlyCount,
                    lastMoveMarkers: this.lastMoveMarkers
                });

                const driftedThisPly = rot.driftCount > prevDriftCount;
                this.board = rot.board;
                this.handNumAt = rot.handNumAt;
                this.driftCount = rot.driftCount;
                this.lastMoveMarkers = rot.lastMoveMarkers;

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
                this.historyDriftCounts.push(this.driftCount);

                if (driftedThisPly) {
                    const rotWin = winnerSlotAfterDrift(this.board, this.BOARD_SIZE);
                    if (rotWin) {
                        this.gameOver = true;
                        this.winner = rotWin;
                        this._stopClockTicker();
                    }
                }

                if (!this.gameOver && this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this._stopClockTicker();
                }

                if (!this.gameOver) {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                } else if (this.winner === 'player1' || this.winner === 'player2') {
                    this.currentPlayer = this.winner === 'player1' ? 1 : 2;
                }

                if (!this.gameOver && this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this._stopClockTicker();
                }

                const passPayload = { type: 'broadcast', action: 'pass', ...this.getState() };
                if (driftedThisPly) {
                    passPayload.driftAnimation = {
                        preBoard: preBoardAnim,
                        postBoard: this.copyBoard(this.board),
                        preHandNumAt: preHandAnim,
                        postHandNumAt: this.copyBoard(this.handNumAt),
                        preMarkers: preMarkersAnim,
                        postMarkers: this.lastMoveMarkers.map(m => ({ ...m }))
                    };
                }
                this.broadcast(passPayload);
                this._syncClockAfterTurnChange();

                if (
                    !this.gameOver
                    && (this.moveHistory.length + 1) % this.driftInterval === 0
                    && this.driftCount < MAX_DRIFTS
                ) {
                    this.broadcast({ type: 'driftPrepare' });
                }
                break;
            }

            case 'requestUndo':
                qiProtocol.undoWuziqiHistory(this, ws, msg, slot);
                break;

            case 'undoResponse':
                qiProtocol.undoResponseWuziqiHistory(this, ws, msg);
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
        this.handNumAt = initZero2D(this.BOARD_SIZE);
        this.driftCount = 0;
        this.driftInterval = computeDriftInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.importReplayNoJudge = false;
        this.winner = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'drift-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要漂移五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 12;
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效。' }));
            return;
        }

        this.BOARD_SIZE = newSize;
        this.resetToEmpty();

        const rawMoves = data.moves || [];
        this.importReplayNoJudge = true;   // 回放期间不判终局（结果只按棋谱记录）
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            if (typeof entry === 'string') {
                const player = entry[0] === 'B' ? 'player1' : 'player2';
                if (entry.length >= 2 && entry[1] === 'p') {
                    entry = { type: 'pass', player };
                } else {
                    const coords = entry.substring(1).split(',').map(Number);
                    entry = { player, row: coords[0], col: coords[1] };
                }
            }
            const slot = entry.player;
            const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
            if (slot !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            if (entry.type === 'pass') {
                this.lastMoveMarkers = [];
                this.moveHistory.push({ type: 'pass', player: slot });
                const completedPlyCount = this.moveHistory.length;
                const prevDriftForImport = this.driftCount;
                const rot = maybeDriftAfterPly({
                    board: this.board,
                    handNumAt: this.handNumAt,
                    driftCount: this.driftCount,
                    n: this.BOARD_SIZE,
                    driftInterval: this.driftInterval,
                    completedPlyCount,
                    lastMoveMarkers: this.lastMoveMarkers
                });
                this.board = rot.board;
                this.handNumAt = rot.handNumAt;
                this.driftCount = rot.driftCount;
                this.lastMoveMarkers = rot.lastMoveMarkers;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
                this.historyDriftCounts.push(this.driftCount);
                const driftedThisPlyImport = rot.driftCount > prevDriftForImport;
                if (!this.importReplayNoJudge && driftedThisPlyImport) {
                    const rotWin = winnerSlotAfterDrift(this.board, this.BOARD_SIZE);
                    if (rotWin) {
                        this.gameOver = true;
                        this.winner = rotWin;
                        if (rotWin === 'black' || rotWin === 'white') {
                            this.currentPlayer = rotWin === 'player1' ? 1 : 2;
                        }
                        break;
                    }
                }
                if (!this.importReplayNoJudge && this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    break;
                }
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                continue;
            }

            const { row, col } = entry;
            if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.board[row][col] !== 0) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const playerVal = slot === 'player1' ? 1 : 2;
            const newBoard = this.copyBoard(this.board);
            newBoard[row][col] = playerVal;
            const hn = this.copyBoard(this.handNumAt);
            syncHandNumWithBoard(newBoard, hn);
            const completedPlyCount = this.moveHistory.length + 1;
            hn[row][col] = completedPlyCount;
            this.board = newBoard;
            this.handNumAt = hn;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];
            this.moveHistory.push({ player: slot, row, col });

            if (!this.importReplayNoJudge && this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                break;
            }

            const prevDriftForImport = this.driftCount;
            const rot = maybeDriftAfterPly({
                board: this.board,
                handNumAt: this.handNumAt,
                driftCount: this.driftCount,
                n: this.BOARD_SIZE,
                driftInterval: this.driftInterval,
                completedPlyCount,
                lastMoveMarkers: this.lastMoveMarkers
            });
            this.board = rot.board;
            this.handNumAt = rot.handNumAt;
            this.driftCount = rot.driftCount;
            this.lastMoveMarkers = rot.lastMoveMarkers;

            this.historyBoards.push(this.copyBoard(this.board));
            this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
            this.historyDriftCounts.push(this.driftCount);

            const driftedThisPlyImport = rot.driftCount > prevDriftForImport;
            if (!this.importReplayNoJudge && driftedThisPlyImport) {
                const rotWin = winnerSlotAfterDrift(this.board, this.BOARD_SIZE);
                if (rotWin) {
                    this.gameOver = true;
                    this.winner = rotWin;
                    if (rotWin === 'black' || rotWin === 'white') {
                        this.currentPlayer = rotWin === 'player1' ? 1 : 2;
                    }
                    break;
                }
            }

            if (!this.gameOver) {
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
            } else if (this.winner === 'player1' || this.winner === 'player2') {
                this.currentPlayer = this.winner === 'player1' ? 1 : 2;
            }

            if (!this.importReplayNoJudge && !this.gameOver && this.isBoardFull()) {
                this.gameOver = true;
                this.winner = 'draw';
                break;
            }
        }

        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        // 记录里的胜负先认出执方颜色（公共层把棋谱里的「黑胜」折成 result='player1'、
        // 「白胜」折成 result='player2'，所以不能直接当座位名用），再落到本棋种的座位。
        if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw') {
            this.gameOver = true;
            this.winner = data.result;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                moves: this.moveHistory.map(m => {
                    const p = (m.player === 'player1' ? 'B' : 'W');
                    return m.type === 'pass' ? `${p}p` : `${p}${m.row},${m.col}`;
                })
            }
        });
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
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new DriftWuziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
