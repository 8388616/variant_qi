'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay,
    applyInitialPositionCompact, encodeOpeningPositionCompact } = require('../common');

const BLACK_VAL = 1;
const WHITE_VAL = 2;

/** 棋盘 5~15 路（默认 8 路：LOA 原版就是 8×8） */
const SIZE_MIN = 5;
const SIZE_MAX = 15;
const SIZE_DEFAULT = 8;

/** 八个方向：横、竖、斜 */
const LOA_DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
];

function createBoard(n) {
    return Array.from({ length: n }, () => Array(n).fill(0));
}

function copyBoard(board) {
    return board.map((row) => row.slice());
}

function inBounds(n, r, c) {
    return r >= 0 && r < n && c >= 0 && c < n;
}

/**
 * 初始局面（row 0 在下；白先，player1 执白）：
 *   白方占上、下两条横排（不含四角），黑方占左、右两条竖列（不含四角）——
 *   即「角落不放棋、边上摆满」，每方 2×(n-2) 枚（8 路 12 枚、10 路 16 枚，与 LOA 原版一致）。
 */
function initialBoard(n) {
    const b = createBoard(n);
    for (let c = 1; c <= n - 2; c++) {
        b[0][c] = WHITE_VAL;
        b[n - 1][c] = WHITE_VAL;
    }
    for (let r = 1; r <= n - 2; r++) {
        b[r][0] = BLACK_VAL;
        b[r][n - 1] = BLACK_VAL;
    }
    return b;
}

/**
 * 这一方向上整条线上的棋子数（含自己、黑白都算）——就是要走的格数。
 */
function linePieceCount(board, n, row, col, dr, dc) {
    let k = 1;                                  // 自己那一枚
    for (const sign of [1, -1]) {
        let r = row + dr * sign;
        let c = col + dc * sign;
        while (inBounds(n, r, c)) {
            if (board[r][c] !== 0) k += 1;
            r += dr * sign;
            c += dc * sign;
        }
    }
    return k;
}

/**
 * 一枚棋子的全部落点：沿横/竖/斜线走「这条线上棋子总数」格。
 * 途中可以穿过**己方**棋子，但不能穿过对方棋子；落点必须是空位或对方棋子（落在对方子上就吃掉它）。
 * 每个方向至多一个落点。
 */
function movesOf(board, n, row, col) {
    const out = [];
    if (!inBounds(n, row, col)) return out;
    const mine = board[row][col];
    if (mine === 0) return out;
    for (const [dr, dc] of LOA_DIRS) {
        const k = linePieceCount(board, n, row, col, dr, dc);
        const tr = row + dr * k;
        const tc = col + dc * k;
        if (!inBounds(n, tr, tc)) continue;                    // 走出盘外
        if (board[tr][tc] === mine) continue;                  // 不能落在己方棋子上
        let blocked = false;
        for (let step = 1; step < k; step++) {
            if (board[row + dr * step][col + dc * step] === 3 - mine) { blocked = true; break; }
        }
        if (blocked) continue;                                 // 不能穿过对方棋子
        out.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
    }
    return out;
}

/** 某方全部合法着法 */
function legalMoves(board, n, sideVal) {
    const out = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] !== sideVal) continue;
            for (const m of movesOf(board, n, r, c)) out.push(m);
        }
    }
    return out;
}

function hasMove(board, n, sideVal) {
    return legalMoves(board, n, sideVal).length > 0;
}

/**
 * 该方是否已把全部棋子连成一片（横/竖/斜相邻都算）。
 * 只剩一枚按规则算相连（所以把对方吃到剩一子会让对方获胜）；
 * 一枚不剩（只可能出现在手摆/编辑的局面里）**不算**相连，交给「对方无子可动」判负。
 */
function isConnected(board, n, sideVal) {
    const cells = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === sideVal) cells.push([r, c]);
        }
    }
    if (cells.length === 0) return false;
    if (cells.length === 1) return true;
    const key = (r, c) => r + ',' + c;
    const seen = new Set([key(cells[0][0], cells[0][1])]);
    const queue = [cells[0]];
    for (let head = 0; head < queue.length; head++) {
        const [r, c] = queue[head];
        for (const [dr, dc] of LOA_DIRS) {
            const nr = r + dr;
            const nc = c + dc;
            if (!inBounds(n, nr, nc) || board[nr][nc] !== sideVal) continue;
            if (seen.has(key(nr, nc))) continue;
            seen.add(key(nr, nc));
            queue.push([nr, nc]);
        }
    }
    return seen.size === cells.length;
}

function positionKey(board, currentPlayer) {
    return board.map((row) => row.join('')).join('/') + '#' + currentPlayer;
}

/** 三次重复局面判和 */
function judgeRepetition(historyKeys) {
    if (!historyKeys || !historyKeys.length) return false;
    const last = historyKeys[historyKeys.length - 1];
    let cnt = 0;
    for (const k of historyKeys) if (k === last) cnt++;
    return cnt >= 3;
}

class LinesOfActionRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = SIZE_DEFAULT;
        this.resetToInitial();
        this.pendingUndo = null;
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.moveHistory = [];
        this.historySnapshots = [];
        this.matchStarted = false;
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = lostSlot === 'player2' ? 'player1' : 'player2';
                this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: this.winner, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player2;
        const tw = this.slotJoinedAt.player1;
        if (tb == null || tw == null) return 'player2';
        return tb <= tw ? 'player2' : 'player1';
    }
    _finishTimeControl(proposal) {
        this.tcSettings = proposal.timed
            ? { timed: true, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === BLACK_VAL ? 'player2' : 'player1', Date.now());
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
        this.broadcast({ type: 'gameState', ...this.getState() });
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === (this.currentPlayer === BLACK_VAL ? 'player2' : 'player1');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== (this.currentPlayer === BLACK_VAL ? 'player2' : 'player1')) return true;
        const { lostSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = lostSlot === 'player2' ? 'player1' : 'player2';
            this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: this.winner, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === BLACK_VAL ? 'player2' : 'player1', Date.now());
        this._broadcastClock();
    }

    hasMove(playerVal) {
        return hasMove(this.board, this.boardSize, playerVal);
    }

    /** 改棋盘路数（5~15）：无人入座且还没走过棋时才允许（观战者才能发起，见 qiProtocol.setBoardSizeObserverOnly） */
    setBoardSize(newSize, requesterWs) {
        const n = parseInt(newSize, 10);
        if (!Number.isInteger(n) || n < SIZE_MIN || n > SIZE_MAX) {
            if (requesterWs) requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘大小无效（需为 ${SIZE_MIN}-${SIZE_MAX}）。` }));
            return false;
        }
        if (this.room.getPlayerBySlot('player2') || this.room.getPlayerBySlot('player1')) return false;
        if (this.moveHistory.length > 0 || this.gameOver) return false;
        this.boardSize = n;
        this.resetToInitial();
        this.broadcast({ type: 'boardSizeChanged', ...this.getState() });
        return true;
    }

    /**
     * 走子：沿横/竖/斜走「这条线上棋子总数」格（可穿己方子、不可穿对方子），落在对方子上则吃掉它。
     * 走完依次判定：1 双方都相连 → 和；2 自己相连 → 胜；3 对方相连（被吃到只剩一子等）→ 对方胜；
     * 4 对方无子可动 → 胜；5 三次重复局面 → 和。
     */
    applyMove(slot, fromRow, fromCol, toRow, toCol) {
        if (this.gameOver) return false;
        const mine = slot === 'player2' ? BLACK_VAL : WHITE_VAL;
        const n = this.boardSize;
        if (this.currentPlayer !== mine) return false;
        if (!inBounds(n, fromRow, fromCol) || this.board[fromRow][fromCol] !== mine) return false;
        const legal = movesOf(this.board, n, fromRow, fromCol)
            .some((m) => m.toRow === toRow && m.toCol === toCol);
        if (!legal) return false;

        this.historySnapshots.push(this.snapshot());

        const opp = mine === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        const captured = this.board[toRow][toCol] === opp;
        this.board[fromRow][fromCol] = 0;
        this.board[toRow][toCol] = mine;
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, fromRow, fromCol, toRow, toCol });
        this.lastMoveMarkers = [
            { row: fromRow, col: fromCol, color: mine },
            { row: toRow, col: toCol, color: mine }
        ];
        this.lastCaptured = captured ? [{ row: toRow, col: toCol, color: opp }] : [];

        this.historyKeys.push(positionKey(this.board, opp));

        if (this.resolvePositionOutcome(opp)) return true;
        if (!this.importReplayNoJudge && judgeRepetition(this.historyKeys)) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '三次重复局面，和棋';
            return true;
        }
        this.currentPlayer = opp;
        return true;
    }

    /**
     * 按当前局面判定终局（**走子后与开赛时共用，勿只写在一处**）：
     *   双方都相连 → 和；某一方相连 → 该方胜（**相连优先**，与无子可动同时成立时判胜）；
     *   该走棋的一方（sideToMove）无子可动 → 该方负。
     * 返回 true 表示对局已结束（调用方不要再换手）。
     */
    resolvePositionOutcome(sideToMove) {
        if (this.importReplayNoJudge) return false;   // 回放棋谱期间不判终局
        const n = this.boardSize;
        const others = sideToMove === BLACK_VAL ? WHITE_VAL : BLACK_VAL;
        const myName = sideToMove === BLACK_VAL ? '黑' : '白';
        const oppName = others === BLACK_VAL ? '黑' : '白';
        const myConnected = isConnected(this.board, n, sideToMove);
        const oppConnected = isConnected(this.board, n, others);
        if (myConnected && oppConnected) {
            this.gameOver = true;
            this.winner = 'draw';
            this.recordResultText = '双方同时相连，和棋';
            return true;
        }
        if (myConnected) {
            this.gameOver = true;
            this.winner = sideToMove === BLACK_VAL ? 'player2' : 'player1';
            this.recordResultText = `${myName}胜`;
            return true;
        }
        if (oppConnected) {
            this.gameOver = true;
            this.winner = others === BLACK_VAL ? 'player2' : 'player1';
            this.recordResultText = `${oppName}胜`;
            return true;
        }
        if (!hasMove(this.board, n, sideToMove)) {
            this.gameOver = true;
            this.winner = others === BLACK_VAL ? 'player2' : 'player1';
            this.recordResultText = `${myName}方无子可动，${oppName}胜`;
            return true;
        }
        return false;
    }

    /**
     * 开赛（含编辑盘面后开局）即判定：轮到走棋的一方连成一片 → 他胜；无子可动 → 他负（相连优先）。
     * 公共壳在双方选色确定后会调这个钩子，判终局时会广播 matchStartOver。
     */
    onMatchStarted() {
        if (this.gameOver) return;
        this.resolvePositionOutcome(this.currentPlayer);
    }

    snapshot() {
        return {
            board: copyBoard(this.board),
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map((m) => ({ ...m })),
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            historyKeys: this.historyKeys.slice(),
            moveCoordsLen: this.moveCoords.length,
            moveHistoryLen: this.moveHistory.length
        };
    }

    restoreSnapshot(s) {
        this.board = copyBoard(s.board);
        if (this.openingBoard === undefined) this.openingBoard = copyBoard(this.board);
        this.currentPlayer = s.currentPlayer;
        this.lastMoveMarkers = s.lastMoveMarkers.map((m) => ({ ...m }));
        this.gameOver = s.gameOver;
        this.winner = s.winner;
        this.recordResultText = s.recordResultText != null ? s.recordResultText : null;
        this.historyKeys = (s.historyKeys || []).slice();
        this.moveCoords.length = s.moveCoordsLen;
        this.moveHistory.length = s.moveHistoryLen;
    }

    /** 聊天/棋谱里显示的执方名：这些棋种白方先行，player1 座执白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '白方' : (slot === 'player2' ? '黑方' : String(slot));
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            // 开局局面（棋谱回放/试下需要它作为起点，集结棋开局即有子）
            openingBoard: this.openingBoard || initialBoard(this.boardSize),
            lastCaptured: this.lastCaptured || [],
            numberOfHands: this.moveCoords.length + 1,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.gameOver ? this.recordResultText : null,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted,
            slots: {
                player2: !!this.room.getPlayerBySlot('player2'),
                player1: !!this.room.getPlayerBySlot('player1')
            }
        };
    }

    /** 重置为开局：白方占上下两条横排、黑方占左右两条竖列（都不含四角），白先 */
    resetToInitial() {
        this.importReplayNoJudge = false;
        this.board = initialBoard(this.boardSize);
        this.openingBoard = copyBoard(this.board);
        this.currentPlayer = WHITE_VAL;
        this.recordResultText = null;
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.moveHistory = [];
        this.historySnapshots = [];
        this.historyKeys = [positionKey(this.board, this.currentPlayer)];
        this.pendingUndo = null;
        this.pendingNewGame = null;
        this.pendingDraw = null;
        this.gameOver = false;
        this.winner = null;
        this.lastCaptured = [];
        this.slotJoinedAt = { player2: null, player1: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
    }

    /** 编辑盘面后：白先（本棋种白方先行），并重置重复局面记录 */
    afterEditBoard() {
        this.currentPlayer = WHITE_VAL;
        this.lastMoveMarkers = [];
        this.historyKeys = [positionKey(this.board, this.currentPlayer)];
    }

    resetGame() {
        this.resetToInitial();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player2: false, player1: false } });
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '集结棋',
            gameId: 'lines-of-action',
            boardSize: this.boardSize,
            // 开局局面（编辑过的局面也在里面）：导入时按它摆盘，否则用标准开局
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map((m) => `${m.player === 'player2' ? 'B' : 'W'}`
                + `${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`),
            result: this.gameOver ? this.winner : null,
            resultText: this.recordResultText
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'lines-of-action') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要集结棋棋谱）。' }));
            return;
        }
        const newSize = parseInt(data.boardSize, 10);
        if (Number.isInteger(newSize) && newSize >= SIZE_MIN && newSize <= SIZE_MAX) this.boardSize = newSize;
        this.resetToInitial();
        // 棋谱里带了开局局面（编辑过的局面）就按它摆盘
        if (Array.isArray(data.initialPosition) && data.initialPosition.length) {
            // 先清空：initialPosition 只往里加子，不清空会把标准开局和记录里的开局叠在一起
            this.board = createBoard(this.boardSize);
            applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
            this.openingBoard = copyBoard(this.board);
            this.historyKeys = [positionKey(this.board, this.currentPlayer)];
        }
        // 回放期间不做任何终局判定：只把棋谱里的着法摆上去，结果按记录显示
        this.importReplayNoJudge = true;
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const entry = rawMoves[i];
            let player; let fromRow; let fromCol; let toRow; let toCol;
            if (typeof entry === 'string') {
                const m = entry.match(/^([WB])(\d+),(\d+)-(\d+),(\d+)$/i);
                if (!m) {
                    this.resetToInitial();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手格式错误。` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                player = m[1].toUpperCase() === 'B' ? 'player2' : 'player1';
                fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
            } else {
                player = entry.player;
                fromRow = entry.fromRow; fromCol = entry.fromCol;
                toRow = entry.toRow; toCol = entry.toCol;
            }
            const expect = this.currentPlayer === BLACK_VAL ? 'player2' : 'player1';
            if (player !== expect) {
                this.resetToInitial();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (!this.applyMove(player, fromRow, fromCol, toRow, toCol)) {
                this.resetToInitial();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手非法。` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (this.gameOver) break;
        }

        this.importReplayNoJudge = false;
        // 导入不做任何判定：结果只按棋谱记录显示（局面与记录不一致时也以记录为准）。
        // 记录里的胜负先认出执方颜色（公共层把棋谱里的「黑胜」折成 result='player1'、
        // 「白胜」折成 result='player2'，所以不能直接当座位名用），再落到本棋种的座位。
        const recResult = data.result != null && data.result !== '' ? data.result
            : (data.resultText != null && data.resultText !== '' ? data.resultText : null);
        if (recResult != null) {
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : String(recResult);
            const rt = String(this.recordResultText);
            const SLOT_OF_COLOR = { 白: 'player1', 黑: 'player2' };   // player1 执白、player2 执黑
            const win = /(黑|白|红|绿|蓝)\s*(?:方)?[^，。]{0,6}胜/.exec(rt);
            let color = win ? win[1] : null;
            if (!color) {
                const lose = /(黑|白|红|绿|蓝)\s*(?:方)?[^，。]{0,6}判负/.exec(rt);
                if (lose) color = Object.keys(SLOT_OF_COLOR).find((k) => k !== lose[1]) || null;
                else if (recResult === 'black' || recResult === 'player1') color = '黑';
                else if (recResult === 'white' || recResult === 'player2') color = '白';
            }
            if (recResult === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (color && SLOT_OF_COLOR[color]) this.winner = SLOT_OF_COLOR[color];
            else this.winner = recResult;
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { initialPosition: data.initialPosition || [], moves: this.moveCoords.map((m) => ({ ...m })) }
        });
    }

    performUndo(steps) {
        if (!Number.isInteger(steps) || steps <= 0) return;
        if (this.historySnapshots.length < steps) return;
        for (let i = 0; i < steps; i++) {
            const snap = this.historySnapshots.pop();
            this.restoreSnapshot(snap);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;
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
            case 'move': {
                if (!slot || this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!this.applyMove(slot, msg.fromRow, msg.fromCol, msg.toRow, msg.toCol)) return;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                if (this.gameOver) this._stopClockTicker();
                else this._syncClockAfterTurnChange();
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps <= 0 || steps > this.historySnapshots.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const oppSlot = slot === 'player2' ? 'player1' : 'player2';
                const opp = room.getPlayerBySlot(oppSlot);
                if (!opp) this.performUndo(steps);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opp.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }
            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                if (this.gameOver) this._stopClockTicker();
                break;
            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;
            case 'setBoardSize':
                qiProtocol.setBoardSizeObserverOnly(this, ws, msg, slot);
                break;
            case 'resetRoom':
                if (this.room.getPlayerBySlot('player2') || this.room.getPlayerBySlot('player1')) return;
                this.resetToInitial();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;
            default:
                break;
        }
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player2' ? '白胜' : '黑胜';
    }

    onDrawResolved() {
        this.recordResultText = '双方同意作和';
    }

    getMoveCount() {
        return this.moveHistory.length;
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

    afterColorAssigned(_ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
}

module.exports = {
    LinesOfActionRoom,
    initRoom(room) {
        room.gameLogic = new LinesOfActionRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    LinesOfActionEngine: {
        SIZE_MIN, SIZE_MAX, SIZE_DEFAULT, LOA_DIRS,
        initialBoard, linePieceCount, movesOf, legalMoves, hasMove, isConnected, positionKey
    }
};
