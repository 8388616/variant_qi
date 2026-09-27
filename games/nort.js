const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');

/**
 * 放牛棋（nort）：一个棋种，两个子棋类。棋盘与棋子同不围棋（方格棋盘点 + 黑白子），黑先白后交替落子。
 *
 *   snort 小放牛棋：看上下左右**四邻**里对方棋子的枚数 —— **恰好 1 枚 → 禁入**（0 枚或 ≥2 枚可下）；
 *   lnort 大放牛棋：看上下左右**加四个斜角（共八邻）** —— **1 枚或 2 枚 → 禁入**（0 枚或 ≥3 枚可下）。
 *
 * 两子棋类其余完全相同（用户口径，2026-09-26）：
 *   - 只能落在**空点**；挨着自己的子无所谓；
 *   - 不吃子、不判自杀、**不允许虚着**；
 *   - **谁先不能下谁输**（轮到的这一方无子可下即判负，与标准 Snort 的 normal play 一致）；
 *   - 棋盘 5~21 路、默认 9 路；其余同不围棋（认输/求和/悔棋/限时/编辑棋盘/试下/打谱/棋谱导入导出）；
 *   - 子棋类**开局前**可改（`setSubGame`：有子或有人入座即静默拒绝），进房默认 snort。
 *
 * 判定口径（客户端插件里有一份必须逐字一致的实现，见 public/room-plugins/nort-room.js）：
 *   isLegalPoint = 空点 && 邻里的敌子枚数**不落在**本子棋类的禁入区间 [forbidLo, forbidHi] 内。
 */
/** 子棋类清单（顺序即下拉框顺序） */
const SUB_GAMES = ['snort', 'lnort'];
const DEFAULT_SUB_GAME = 'snort';
/** 子棋类元数据：near = 是否含四个斜角（八邻）；forbidLo~forbidHi = 禁入的敌子枚数区间 */
const SUB_META = {
    'snort': { near: false, forbidLo: 1, forbidHi: 1, name: '小放牛棋' },
    'lnort': { near: true, forbidLo: 1, forbidHi: 2, name: '大放牛棋' }
};
/** 八邻方向：前四条是上下左右（四邻只用这四条），后四条是斜角 */
const DIRS8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

class NortRoom extends QiTwoPlayerRoomBase
{
    constructor(room)
    {
        super(room);
        this.subGameId = DEFAULT_SUB_GAME;   // 子棋类 id（snort / lnort）
        this.boardSize = 9;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
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
        const snap = qiMatchTimeControl.snapshotForClient(this.tcClock);
        this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            const now = Date.now();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: lostSlot,
                    winner: winnerSlot,
                    ...this.getState()
                });
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
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
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
            this.setTimeLossResultText(lostSlot);
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: lostSlot,
                winner: winnerSlot,
                ...this.getState()
            });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    /**
     * 开局判定（含编辑盘面后开局）：轮到的一方若一步都下不了 → 按「谁先不能下谁负」直接判负。
     */
    onMatchStarted() {
        if (this.gameOver) return;
        if (this.hasAnyMove(this.board, this.currentPlayer)) return;
        const loserSlot = this.currentPlayer === 1 ? 'player1' : 'player2';
        this.gameOver = true;
        this.winner = loserSlot === 'player1' ? 'player2' : 'player1';
        this.setNoMoveLossResultText(loserSlot);
        this._stopClockTicker();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    /** 谁先不能下谁负：无子可下的一方判负（文案先负后胜） */
    setNoMoveLossResultText(loserSlot) {
        this.recordResultText = loserSlot === 'player1' ? '白胜' : '黑胜';
    }

    /** 本棋种不允许虚着（引擎 pass 时由人机对战自行处理） */
    passIsIllegal() {
        return true;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    /** 本子棋类元数据（near = 八邻；forbidLo~forbidHi = 禁入的敌子枚数区间） */
    _meta() {
        return SUB_META[this.subGameId] || SUB_META[DEFAULT_SUB_GAME];
    }

    /**
     * 该点能不能落子：空点 + 邻里的**对方棋子**枚数不在本子棋类的禁入区间内。
     *   小放牛棋（snort）：四邻，恰好 1 枚禁入（0 枚或 ≥2 枚可下，贴着对方一大片反而能下）；
     *   大放牛棋（lnort）：八邻（含四个斜角），1 枚或 2 枚禁入（0 枚或 ≥3 枚可下）。
     */
    isLegalPoint(board, row, col, playerVal) {
        if (board[row] === undefined || board[row][col] !== 0) return false;
        const meta = this._meta();
        const enemy = 3 - playerVal;
        const n = this.boardSize;
        const dirCount = meta.near ? 8 : 4;
        let foe = 0;
        for (let i = 0; i < dirCount; i++) {
            const r = row + DIRS8[i][0];
            const c = col + DIRS8[i][1];
            if (r < 0 || r >= n || c < 0 || c >= n) continue;
            if (board[r][c] === enemy) foe++;
        }
        return !(foe >= meta.forbidLo && foe <= meta.forbidHi);
    }

    /** 切换子棋类（小/大放牛棋）：开局前可改，有子或有人入座时静默拒绝（与 setBoardSize 同口径） */
    setSubGame(subGameId, requesterWs) {
        if (!SUB_GAMES.includes(subGameId)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '子棋类无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) return false;
        this.subGameId = subGameId;
        this.broadcast({ type: 'subGameChanged', subGameId, ...this.getState() });
        return true;
    }

    /** 落子并返回新盘面（不吃子、不判自杀） */
    tryPlaceStoneResult(boardBefore, row, col, playerVal)
    {
        if (!this.isLegalPoint(boardBefore, row, col, playerVal)) return null;
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        return { newBoard, capturedOpponent: false };
    }

    /** 该方还有没有能落子的点 */
    hasAnyMove(board, playerVal) {
        for (let r = 0; r < this.boardSize; r++)
            for (let c = 0; c < this.boardSize; c++)
                if (this.isLegalPoint(board, r, c, playerVal)) return true;
        return false;
    }

    /** 标准落子接口：返回新盘面或 null（与其它棋类一致，供人机对战 applyComputerMove 等调用） */
    tryPlaceStone(boardBefore, row, col, playerVal)
    {
        const r = this.tryPlaceStoneResult(boardBefore, row, col, playerVal);
        return r ? r.newBoard : null;
    }


    getState()
    {
        return {
            subGameId: this.subGameId,
            subGameName: this._meta().name,
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted
        }
        ;
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
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
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'setSubGame':
                // 被拒绝（已开局/有人入座）时回推当前状态：客户端是「本地乐观切换」，不回推会与服务端脱钩
                if (!this.setSubGame(msg.subGameId, ws)) this.sendState(ws);
                break;

            case 'move':
                if (!slot || this.gameOver) return;          // 观战者不能落子
                // 必须是轮到的那一方（不限时的对局 _timeAllowsPlay 不校验行棋方，这里补上；
                // 不围棋本体缺这一条，导致不限时下能替对方落子）
                if (slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const result = this.tryPlaceStoneResult(this.board, row, col, playerVal);
                if (!result) return;

                const { newBoard } = result;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                    return;
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];

                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (!this.hasAnyMove(this.board, this.currentPlayer))
                {
                    // 谁先不能下谁负：轮到这一方却无子可下 → 该方负、对方胜
                    this.gameOver = true;
                    const loserSlot = this.currentPlayer === 1 ? 'player1' : 'player2';
                    this.winner = loserSlot === 'player1' ? 'player2' : 'player1';
                    this.setNoMoveLossResultText(loserSlot);
                    this._stopClockTicker();
                }
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;

            case 'requestUndo':
                if (!slot || this.gameOver)
                    return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--)
                {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
                }
                if (steps === 0 || steps > this.historyBoards.length)
                {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else
                {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo)
                {
                    if (msg.accept)
                        this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else
                        this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length)
            return;

        for (let i = 0; i < steps; i++)
        {
            if (this.historyBoards.length > 0) {
                // 只有进过集合的手才该删（虚着/踩雷等手同样推了历史快照、盘面与上一手相同，
                // 拿它的快照去 delete 会误删上一次落子的记录 → 禁全同随后失效）
                const skPopped = this.historyBoards.pop();
                const skCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
                if (skCoord && ['move'].includes(skCoord.type))
                    this.historyBoardSet.delete(this.boardToString(skPopped));
            }
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length == 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效（5-21）' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {

        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 2,
            gameType: this._meta().name,
            gameId: 'nort',
            subGameId: this.subGameId,
            boardSize: this.boardSize,
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'nort') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要放牛棋棋谱）。' }));
            return;
        }
        // 棋谱统一用 gameId=nort，用 subGameId 区分小/大放牛棋（缺省=小放牛棋）
        this.subGameId = SUB_GAMES.includes(data.subGameId) ? data.subGameId : DEFAULT_SUB_GAME;
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 5 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(NortRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            if (this.gameOver) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手时对局已结束` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const move = moves[i];
            const slot = move.player;
            const expectedSlot = this.currentPlayer === 1 ? 'player1' : 'player2';
            if (move.type !== 'move' || slot !== expectedSlot) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const playerVal = slot === 'player1' ? 1 : 2;
            const { row, col } = move;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const result = this.tryPlaceStoneResult(this.board, row, col, playerVal);
            if (!result) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const { newBoard } = result;
            const newBoardStr = this.boardToString(newBoard);
            this.historyBoards.push(this.copyBoard(newBoard));
            this.historyBoardSet.add(newBoardStr);
            this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
            this.moveHistory.push(slot);
            this.moveCoords.push({ type: 'move', player: slot, row, col });
            this.board = newBoard;
            this.lastMoveMarkers = [{ row, col, color: playerVal }];
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
            }
            this.matchStarted = true;
        }

        if ((data.result || data.resultText) && !this.gameOver) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    NortRoom,
    initRoom(room) {
        room.gameLogic = new NortRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
