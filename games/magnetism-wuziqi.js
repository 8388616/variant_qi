const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWuziqiRules, qiBoardSeatOverlay } = require('../common');

/* ---------- 磁力规则：本棋种专属，不写进公共文件 ----------
   落子后，落点的**八个方向**（上下左右 + 左上/右上/左下/右下）上各自「最近的一枚棋子」被磁力
   拉动一格：与落子方**同色者远离一格、异色者靠近一格**；目标格出界、或已有棋子（遇到阻碍）时
   该子不动。只结算一次、不连锁；八个方向一律按进入函数时的同一张盘面同时计算（两条不同射线
   只交于落点，而落点必被刚落下的子占住，故彼此的落点不可能相同）。 */

/**
 * 结算磁力。board 必须是**已经落完这一子**的盘面（落点上有子）。
 * @returns {{board: number[][], moves: Array}} 结算后的盘面；moves = 实际被拉动的棋子
 */
function applyMagnetism(board, row, col, playerVal, boardSize) {
    const next = board.map((r) => r.slice());
    const moves = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    const inB = (r, c) => r >= 0 && r < boardSize && c >= 0 && c < boardSize;
    for (const [dr, dc] of dirs) {
        let r = row + dr;
        let c = col + dc;
        while (inB(r, c) && board[r][c] === 0) { r += dr; c += dc; }
        if (!inB(r, c)) continue;                     // 该方向没有棋子
        const v = board[r][c];
        const away = v === playerVal;                 // 同色远离、异色靠近
        const tr = away ? r + dr : r - dr;
        const tc = away ? c + dc : c - dc;
        if (!inB(tr, tc)) continue;                   // 出界
        if (board[tr][tc] !== 0) continue;            // 被占（紧贴落点时即落在落点上）
        next[tr][tc] = v;
        next[r][c] = 0;
        moves.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, color: v });
    }
    return { board: next, moves };
}


class MagnetismWuziqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.BOARD_SIZE = 13;
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
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
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
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
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }

    checkWin(row, col, colorVal) {
        return squareWuziqiRules.checkFiveInRow(this.board, row, col, colorVal, this.BOARD_SIZE);
    }

    /** 整盘扫描某色是否已成五：磁力可能把别处的棋子拉成五，不能只看落点那一路 */
    hasFive(colorVal) {
        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                if (this.board[r][c] === colorVal && this.checkWin(r, c, colorVal)) return true;
            }
        }
        return false;
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

    getState() {
        return {
            board: this.board,
            boardSize: this.BOARD_SIZE,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.wireMoveCoords(),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '磁性五子棋',
            gameId: 'magnetism-wuziqi',
            boardSize: this.BOARD_SIZE,
            moves: this.moveHistory.map(m => {
                const p = (m.player === 'player1' ? 'B' : 'W');
                return m.type === 'pass' ? `${p}p` : `${p}${m.row},${m.col}`;
            }),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.gameOver = false;
        this.importReplayNoJudge = false;
        this.winner = null;
        this.recordResultText = null;
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
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效。' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
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
        if (!data || data.gameId !== 'magnetism-wuziqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要磁性五子棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 13;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 15) {
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
                this.historyBoards.push(this.copyBoard(this.board));
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (!this.importReplayNoJudge && this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    break;
                }
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
            this.historyBoards.push(this.copyBoard(this.board));
            if (this._applyMoveCore(row, col, slot).ended) break;   // 回放期间不判定：ended 恒为 false
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
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
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
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

    /**
     * 走一手的完整结算：落子 → 磁力 → 判定。
     * 判定**先看对方、再看自己**：
     *   · 对方成五（含「双方同时成五」和「磁力把对方拉成五」）→ 对方胜，落子方负；
     *   · 自己成五 → 自己胜；棋盘满 → 和棋。
     * 回放棋谱期间只摆棋不判定（结果以棋谱记录为准）。
     */
    _applyMoveCore(row, col, slot) {
        const playerVal = slot === 'player1' ? 1 : 2;
        const oppVal = playerVal === 1 ? 2 : 1;
        this.board[row][col] = playerVal;
        this.board = applyMagnetism(this.board, row, col, playerVal, this.BOARD_SIZE).board;
        this.lastMoveMarkers = [{ row, col, color: playerVal }];
        this.moveHistory.push({ player: slot, row, col });

        if (this.importReplayNoJudge) return { ended: false };

        if (this.hasFive(oppVal)) {
            this.gameOver = true;
            this.winner = slot === 'player1' ? 'player2' : 'player1';
            this.recordResultText = this.hasFive(playerVal)
                ? '双方同时五连，落子方负'
                : '磁力凑成对方五连，落子方负';
            return { ended: true };
        }
        if (this.hasFive(playerVal)) {
            this.gameOver = true;
            this.winner = slot;
            this.recordResultText = slot === 'player1' ? '黑中盘胜' : '白中盘胜';
            return { ended: true };
        }
        if (this.isBoardFull()) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '和棋';
            return { ended: true };
        }
        return { ended: false };
    }

    /** 认输：resignSlot 是**认输方**（公共层契约），player1 执黑 */
    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
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
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.BOARD_SIZE || col < 0 || col >= this.BOARD_SIZE) return;
                if (this.board[row][col] !== 0) {
                    return;
                }
                // 磁力会改动盘面，悔棋要连磁力一起退：historyBoards 存**落子前**的盘面
                this.historyBoards.push(this.copyBoard(this.board));
                if (this._applyMoveCore(row, col, slot).ended) {
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                    return;
                }
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeMove(slot)) return;
                this.lastMoveMarkers = [];
                this.moveHistory.push({ type: 'pass', player: slot });
                this.historyBoards.push(this.copyBoard(this.board));
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (this._trailingPassCount() >= 2) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.recordResultText = '和棋';
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                    return;
                }
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                break;

            case 'requestUndo':
                qiProtocol.undoWuziqiHistory(this, ws, msg, slot);
                break;

            case 'undoResponse':
                qiProtocol.undoResponseWuziqiHistory(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                this._stopClockTicker();
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
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '和棋';
                        this._stopClockTicker();
                    }
                });
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
        this.gameOver = false;
        this.importReplayNoJudge = false;
        this.winner = null;
        this.recordResultText = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new MagnetismWuziqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
