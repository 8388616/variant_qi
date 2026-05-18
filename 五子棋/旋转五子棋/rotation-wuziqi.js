'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules } = require('../common');

const MAX_ROTATIONS = 8;

function computeRotationInterval(n) {
    let x = Math.ceil(0.07 * n * n);
    if (x % 2 === 0) x += 1;
    return x;
}

/** 与旋转围棋/rotation-weiqi.js 中象限顺时针轮换一致 */
function rotateCell(r, c, half) {
    if (r < half && c < half) return [r, c + half];
    if (r < half) return [r + half, c];
    if (c < half) return [r - half, c];
    return [r, c - half];
}

function initZero2D(n) {
    return Array(n).fill(0).map(() => Array(n).fill(0));
}

function rotateBoardLike(board, n, mapCell) {
    const nb = initZero2D(n);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const [nr, nc] = mapCell(r, c);
            nb[nr][nc] = board[r][c];
        }
    }
    return nb;
}

function rotateQuadrantsClockwise(board, handNumAt, n) {
    const half = n / 2;
    const mapCell = (r, c) => rotateCell(r, c, half);
    return {
        board: rotateBoardLike(board, n, mapCell),
        handNumAt: rotateBoardLike(handNumAt, n, mapCell)
    };
}

function rotateLastMoveMarkers(markers, n) {
    if (!markers || !markers.length) return [];
    const half = n / 2;
    return markers.map(m => {
        const [nr, nc] = rotateCell(m.row, m.col, half);
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

function maybeRotateAfterPly(opts) {
    const {
        board,
        handNumAt,
        rotationCount,
        n,
        rotationInterval,
        completedPlyCount,
        lastMoveMarkers
    } = opts;
    if (rotationCount >= MAX_ROTATIONS) {
        return { board, handNumAt, rotationCount, lastMoveMarkers };
    }
    if (completedPlyCount <= 0 || completedPlyCount % rotationInterval !== 0) {
        return { board, handNumAt, rotationCount, lastMoveMarkers };
    }
    const r = rotateQuadrantsClockwise(board, handNumAt, n);
    return {
        board: r.board,
        handNumAt: r.handNumAt,
        rotationCount: rotationCount + 1,
        lastMoveMarkers: rotateLastMoveMarkers(lastMoveMarkers, n)
    };
}

/** 全盘是否存在该颜色的连五（用于板块旋转后的胜负判定） */
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
 * 旋转后若形成连五则终局。双方同时连五判和棋。
 * @returns {'black'|'white'|'draw'|null}
 */
function winnerSlotAfterRotation(board, n) {
    const blackFive = boardHasFiveForColor(board, n, 1);
    const whiteFive = boardHasFiveForColor(board, n, 2);
    if (blackFive && whiteFive) return 'draw';
    if (blackFive) return 'black';
    if (whiteFive) return 'white';
    return null;
}

class RotationWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 12) {
        super(room);
        this.BOARD_SIZE = initialSize;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.handNumAt = initZero2D(this.BOARD_SIZE);
        this.rotationCount = 0;
        this.rotationInterval = computeRotationInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { black: null, white: null };
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

    wireMoveCoords() {
        return this.moveHistory.map(m => ({
            type: 'move',
            player: m.player,
            row: m.row,
            col: m.col
        }));
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
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
        this._broadcastClock();
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expected = this.currentPlayer === 1 ? 'black' : 'white';
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
        const firstWs = this.room.getPlayerBySlot(first);
        if (firstWs) firstWs.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) otherWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'respond', proposal }));
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else this.tcClock = null;
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || slot !== this.tcNego.waitingSlot) return;
        const valid = qiMatchTimeControl.validateProposal(msg);
        if (!valid.ok) {
            ws.send(JSON.stringify({ type: 'error', message: valid.error }));
            return;
        }
        this.tcNego.proposal = valid;
        this.tcNego.phase = 'respond';
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        this._sendRespondDialog(other, valid);
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond' || slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            handNumAt: this.handNumAt,
            rotationCount: this.rotationCount,
            rotationInterval: this.rotationInterval,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveHistory: this.moveHistory.map(m => ({ player: m.player, row: m.row, col: m.col })),
            moveCoords: this.wireMoveCoords(),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
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
            gameType: '旋转五子棋',
            gameId: 'rotation-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveHistory.map(m => `${m.player[0].toUpperCase()}${m.row},${m.col}`),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.handNumAt = initZero2D(this.BOARD_SIZE);
        this.rotationCount = 0;
        this.rotationInterval = computeRotationInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { black: null, white: null };
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

    performUndoSteps(steps) {
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                this.historyBoards.pop();
                this.historyHandNumAts.pop();
                this.historyRotationCounts.pop();
            }
            if (this.moveHistory.length > 0) this.moveHistory.pop();
        }
        if (this.historyBoards.length === 0) {
            this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
            this.handNumAt = initZero2D(this.BOARD_SIZE);
            this.rotationCount = 0;
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.handNumAt = this.copyBoard(this.historyHandNumAts.at(-1));
            this.rotationCount = this.historyRotationCounts.at(-1);
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

    undoRotationWuziqi(ws, msg, slot) {
        if (!slot || this.gameOver) return;
        const room = this.room;
        const isMyTurn = (slot === 'black' && this.currentPlayer === 1) || (slot === 'white' && this.currentPlayer === 2);
        const steps = isMyTurn ? 2 : 1;
        if (this.historyBoards.length < steps) {
            ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
            return;
        }
        const opponentSlot = slot === 'black' ? 'white' : 'black';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) {
            this.performUndoSteps(steps);
        } else {
            this.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    }

    undoResponseRotationWuziqi(ws, msg) {
        if (this.pendingUndo && msg.accept) {
            this.performUndoSteps(this.pendingUndo.steps);
        } else if (this.pendingUndo && !msg.accept) {
            this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
        }
        this.pendingUndo = null;
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
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
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

                const prevRotationCount = this.rotationCount;
                const preBoardAnim = this.copyBoard(this.board);
                const preHandAnim = this.copyBoard(this.handNumAt);
                const preMarkersAnim = [{ row, col, color: playerVal }];

                const rot = maybeRotateAfterPly({
                    board: this.board,
                    handNumAt: this.handNumAt,
                    rotationCount: this.rotationCount,
                    n: this.BOARD_SIZE,
                    rotationInterval: this.rotationInterval,
                    completedPlyCount,
                    lastMoveMarkers: this.lastMoveMarkers
                });

                const rotatedThisPly = rot.rotationCount > prevRotationCount;
                this.board = rot.board;
                this.handNumAt = rot.handNumAt;
                this.rotationCount = rot.rotationCount;
                this.lastMoveMarkers = rot.lastMoveMarkers;

                this.historyBoards.push(this.copyBoard(this.board));
                this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
                this.historyRotationCounts.push(this.rotationCount);

                if (rotatedThisPly) {
                    const rotWin = winnerSlotAfterRotation(this.board, this.BOARD_SIZE);
                    if (rotWin) {
                        this.gameOver = true;
                        this.winner = rotWin;
                        this._stopClockTicker();
                    }
                }

                if (!this.gameOver) {
                    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                } else if (this.winner === 'black' || this.winner === 'white') {
                    this.currentPlayer = this.winner === 'black' ? 1 : 2;
                }

                if (!this.gameOver && this.isBoardFull()) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this._stopClockTicker();
                }

                const payload = { type: 'broadcast', action: 'move', ...this.getState() };
                if (rotatedThisPly) {
                    payload.rotationAnimation = {
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
                    && (this.moveHistory.length + 1) % this.rotationInterval === 0
                    && this.rotationCount < MAX_ROTATIONS
                ) {
                    this.broadcast({ type: 'rotatePrepare' });
                }
                break;

            case 'requestUndo':
                this.undoRotationWuziqi(ws, msg, slot);
                break;

            case 'undoResponse':
                this.undoResponseRotationWuziqi(ws, msg);
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
        this.rotationCount = 0;
        this.rotationInterval = computeRotationInterval(this.BOARD_SIZE);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
        this.moveHistory = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        for (const [client, s] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(s);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'rotation-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要旋转五子棋棋谱）。' }));
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
        for (let i = 0; i < rawMoves.length; i++) {
            let entry = rawMoves[i];
            if (typeof entry === 'string') {
                const player = entry[0] === 'B' ? 'black' : 'white';
                const coords = entry.substring(1).split(',').map(Number);
                entry = { player, row: coords[0], col: coords[1] };
            }
            const { row, col, player } = entry;
            const slot = player;
            const expect = this.currentPlayer === 1 ? 'black' : 'white';
            if (slot !== expect) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
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

            const playerVal = slot === 'black' ? 1 : 2;
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

            if (this.checkWin(row, col, playerVal)) {
                this.gameOver = true;
                this.winner = slot;
                break;
            }

            const prevRotationForImport = this.rotationCount;
            const rot = maybeRotateAfterPly({
                board: this.board,
                handNumAt: this.handNumAt,
                rotationCount: this.rotationCount,
                n: this.BOARD_SIZE,
                rotationInterval: this.rotationInterval,
                completedPlyCount,
                lastMoveMarkers: this.lastMoveMarkers
            });
            this.board = rot.board;
            this.handNumAt = rot.handNumAt;
            this.rotationCount = rot.rotationCount;
            this.lastMoveMarkers = rot.lastMoveMarkers;

            this.historyBoards.push(this.copyBoard(this.board));
            this.historyHandNumAts.push(this.copyBoard(this.handNumAt));
            this.historyRotationCounts.push(this.rotationCount);

            const rotatedThisPlyImport = rot.rotationCount > prevRotationForImport;
            if (rotatedThisPlyImport) {
                const rotWin = winnerSlotAfterRotation(this.board, this.BOARD_SIZE);
                if (rotWin) {
                    this.gameOver = true;
                    this.winner = rotWin;
                    if (rotWin === 'black' || rotWin === 'white') {
                        this.currentPlayer = rotWin === 'black' ? 1 : 2;
                    }
                    break;
                }
            }

            if (!this.gameOver) {
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
            } else if (this.winner === 'black' || this.winner === 'white') {
                this.currentPlayer = this.winner === 'black' ? 1 : 2;
            }

            if (!this.gameOver && this.isBoardFull()) {
                this.gameOver = true;
                this.winner = 'draw';
                break;
            }
        }

        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            boardSize: this.BOARD_SIZE,
            replayData: {
                boardSize: this.BOARD_SIZE,
                moves: this.moveHistory.map(m => `${m.player[0].toUpperCase()}${m.row},${m.col}`)
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
        room.gameLogic = new RotationWuziqiRoom(room);
        room.maxPlayers = 2;
    }
};
