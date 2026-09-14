const crypto = require('crypto');

const { qiBoardSeatOverlay, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, encodeOpeningPositionCompact  } = require('../common');

// ======================== 双人四色围棋 ========================
// 两人对弈四色围棋：黑蓝方执黑(1)/蓝(4)，白红方执白(2)/红(3)。
// 颜色回合固定循环 黑→白→红→蓝：轮到某色时由持有方落该色子（落子或虚着都推进回合）。
// 棋盘规则与标准围棋一致：同色四连成组、组无气整组提、落子后先提异色再判己色、
// 允许自杀、禁全同。同方两色互不相认：黑与蓝互相紧气（黑可提蓝），
// 黑与白也可合力堵气提红。
// 虚着：虚当前颜色回合；连续 4 个虚着（黑白红蓝各一次）进入数点。
// 数点：不做自动判死；每个点归最近的颜色，多个颜色并列最近则平分。
const ORTH_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const inB = (r, c, n) => r >= 0 && r < n && c >= 0 && c < n;
const nextColor = (c) => (c % 4) + 1;                 // 1黑→2白→3红→4蓝→1黑
/** 颜色所属阵营：1=黑蓝方（黑/蓝），2=白红方（白/红） */
const sideOfColor = (c) => (c === 1 || c === 4) ? 1 : 2;
const sideName = (s) => (s === 1 ? '黑蓝方' : '白红方');
const colorName = (c) => ['', '黑', '白', '红', '蓝'][c];

/** 收集 (r,c) 同色棋子所在的组（标准四连闭包） */
function colorGroupStones(board, r, c, n) {
    const color = board[r][c];
    if (color === 0) return [];
    const stones = [];
    const visited = Array.from({ length: n }, () => new Uint8Array(n));
    visited[r][c] = 1;
    const queue = [[r, c]];
    for (let i = 0; i < queue.length; i++) {
        const [cr, cc] = queue[i];
        stones.push([cr, cc]);
        for (const [dr, dc] of ORTH_DIRS) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (inB(nr, nc, n) && board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = 1;
                queue.push([nr, nc]);
            }
        }
    }
    return stones;
}

/** (r,c) 所在同色组的气数（四邻空点数） */
function colorGroupLiberties(board, r, c, n) {
    const color = board[r][c];
    if (color === 0) return 0;
    const libs = new Set();
    const visited = Array.from({ length: n }, () => new Uint8Array(n));
    visited[r][c] = 1;
    const queue = [[r, c]];
    for (let i = 0; i < queue.length; i++) {
        const [cr, cc] = queue[i];
        for (const [dr, dc] of ORTH_DIRS) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (!inB(nr, nc, n)) continue;
            if (board[nr][nc] === 0) libs.add(nr + ',' + nc);
            else if (board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = 1;
                queue.push([nr, nc]);
            }
        }
    }
    return libs.size;
}

/** 在盘面上把 (r,c) 所在的整组（四连同色）清空 */
function colorRemoveGroup(board, r, c, n) {
    const color = board[r][c];
    if (color === 0) return;
    const queue = [[r, c]];
    board[r][c] = 0;
    for (let i = 0; i < queue.length; i++) {
        const [cr, cc] = queue[i];
        for (const [dr, dc] of ORTH_DIRS) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (inB(nr, nc, n) && board[nr][nc] === color) {
                board[nr][nc] = 0;
                queue.push([nr, nc]);
            }
        }
    }
}

/**
 * 四色标准围棋落子：占位后先提四邻中其它颜色的无气组，再判己色组（无气则提，允许自杀）。
 * 返回新盘面；占点/越界由调用方保证，落点在空位时永不返回 null。
 */
function tryPlaceColorStone(boardBefore, row, col, colorVal, n, copyFn) {
    if (boardBefore[row][col] !== 0) return null;
    const newBoard = copyFn(boardBefore);
    newBoard[row][col] = colorVal;
    const checked = new Set();
    for (const [dr, dc] of ORTH_DIRS) {
        const nr = row + dr;
        const nc = col + dc;
        if (!inB(nr, nc, n)) continue;
        const v = newBoard[nr][nc];
        if (v !== 0 && v !== colorVal) {
            const key = nr + ',' + nc;
            if (!checked.has(key)) {
                checked.add(key);
                if (colorGroupLiberties(newBoard, nr, nc, n) === 0) colorRemoveGroup(newBoard, nr, nc, n);
            }
        }
    }
    if (colorGroupLiberties(newBoard, row, col, n) === 0) colorRemoveGroup(newBoard, row, col, n);
    return newBoard;
}

/**
 * 数点/形势判断算分（不做自动判死）：棋子点 1 分归该色；
 * 空点归最近的颜色，多个颜色并列最近则平分；空盘（无子）时四色均分。
 * 返回 { black, white, red, blue }（四色点数）。
 */
function scoreFourColors(board, n) {
    const scores = [0, 0, 0, 0];
    let hasStone = false;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const v = board[r][c];
            if (v !== 0) { scores[v - 1] += 1; hasStone = true; }
        }
    }
    if (!hasStone) {
        const quarter = (n * n) / 4;
        return { black: quarter, white: quarter, red: quarter, blue: quarter };
    }
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] !== 0) continue;
            // BFS 逐层扩张，停在首个含子的层；该层出现的颜色并列最近、平分此点
            const visited = Array.from({ length: n }, () => new Uint8Array(n));
            visited[r][c] = 1;
            const queue = [[r, c, 0]];
            let minLayer = Infinity;
            let layerColors = new Set();
            for (let i = 0; i < queue.length; i++) {
                const [cr, cc, d] = queue[i];
                if (d >= minLayer) continue;
                for (const [dr, dc] of ORTH_DIRS) {
                    const nr = cr + dr;
                    const nc = cc + dc;
                    if (!inB(nr, nc, n) || visited[nr][nc]) continue;
                    visited[nr][nc] = 1;
                    const v = board[nr][nc];
                    if (v !== 0) {
                        const layer = d + 1;
                        if (layer < minLayer) { minLayer = layer; layerColors = new Set([v]); }
                        else if (layer === minLayer) layerColors.add(v);
                    } else {
                        queue.push([nr, nc, d + 1]);
                    }
                }
            }
            const share = 1 / Math.max(1, layerColors.size);
            for (const v of layerColors) scores[v - 1] += share;
        }
    }
    return { black: scores[0], white: scores[1], red: scores[2], blue: scores[3] };
}

class DuoQuadricolourRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.openingBoard = this.copyBoard(this.board);
        /** 下一行动颜色 1黑 2白 3红 4蓝（固定循环，落子/虚着后推进） */
        this.turnColor = 1;
        /** 每步行动的颜色记录（悔棋/导入回放回退用） */
        this.actionColors = [];
        /** 行动方玩家：1=黑蓝方(black 槽) 2=白红方(white 槽)，由 turnColor 推导 */
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        /** 先落座者为房主（WebSocket） */
        this.hostWs = null;
        /** 是否启用棋盘落座蒙版协议（执子由房主在限时对话框选择） */
        this.boardSeatOverlay = true;
    }

    /** 当前行动颜色所属座位：1/4(黑/蓝)→black，2/3(白/红)→white */
    _slotOfTurn() {
        return sideOfColor(this.turnColor) === 1 ? 'player1' : 'player2';
    }

    /** 行动(落子/虚着)后推进颜色回合与行动方 */
    _advanceTurn() {
        this.turnColor = nextColor(this.turnColor);
        this.currentPlayer = sideOfColor(this.turnColor);
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
            if (this.pendingScore) return;
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

    /** 按「选择者己方执子」交换座位：colorChoice 为 black|white|random */

    /** 把当前协商界面重新推给某客户端，避免提交被忽略后卡死 */

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

    countGroupLiberties(board, row, col) {
        return colorGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        colorRemoveGroup(board, row, col, this.boardSize);
    }

    /** 四色标准落子（颜色 1..4）：先提四邻其它颜色无气组，再判己色（允许自杀） */
    tryPlaceStone(boardBefore, row, col, colorVal) {
        return tryPlaceColorStone(boardBefore, row, col, colorVal, this.boardSize, (b) => this.copyBoard(b));
    }

    /** 数点不做自动判死（无气提子只发生在落子时）：返回原盘 */
    removeDeadAndDying(srcBoard) {
        return this.copyBoard(srcBoard);
    }

    /** 四色算分（点归最近色、并列平分），供形势判断与数点共用 */
    scoreFourColorsNow(board) {
        return scoreFourColors(board, this.boardSize);
    }

    /** 黑蓝方 − 白红方（无贴点）；正 = 黑蓝方胜 */
    computeLead()
    {
        const s = scoreFourColors(this.board, this.boardSize);
        return (s.black + s.blue) - (s.white + s.red);
    }

    /** 四色点数（黑/白/红/蓝） */
    computeFourScores() {
        return scoreFourColors(this.board, this.boardSize);
    }

    onResignResolved(resignSlot) {
        // resignSlot: black=黑蓝方认输, white=白红方认输
        this.recordResultText = resignSlot === 'player1' ? '白红方中盘胜' : '黑蓝方中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和棋';
            return;
        }
        const winnerSide = lead > 0 ? '黑蓝方' : '白红方';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑蓝方超时白红方胜';
        else if (lostSlot === 'player2') this.recordResultText = '白红方超时黑蓝方胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和棋' || resultText === 'draw') return 'draw';
        if (resultText.includes('黑蓝方胜')) return 'player1';
        if (resultText.includes('白红方胜')) return 'player2';
        if (resultText === 'player1' || resultText === 'player2' || resultText === 'draw') return resultText;
        return null;
    }

    getState()
    {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            boardSize: this.boardSize,
            komi: 0,                                    // 无贴点
            turnColor: this.turnColor,                  // 1黑 2白 3红 4蓝
            board: this.board,
            initialBoard,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,          // 行动方:1=黑蓝方 2=白红方
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            sideLabels: { player1: '黑蓝方', player2: '白红方' },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null,
            boardSeatOverlay: !!this.boardSeatOverlay,
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
        };
    }

    getInitialState() {
        return this.getState();
    }

    getStateForClient() {
        return this.getState();
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        const scores = this.computeFourScores();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead, scores };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    /** 聊天/棋谱里显示的执方名：player1 执黑蓝、player2 执白红 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '黑蓝方' : (slot === 'player2' ? '白红方' : String(slot));
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (this.gameOver) return;
                if (moveSlot !== this._slotOfTurn()) return;            // 只有当前颜色回合的行动者可落子
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(moveSlot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                const colorNow = this.turnColor;
                const newBoard = this.tryPlaceStone(this.board, row, col, colorNow);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(moveSlot);
                this.actionColors.push(colorNow);
                this.moveCoords.push({ type: 'move', player: moveSlot, color: colorNow, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: colorNow }];
                this.passCounter = 0;
                this._advanceTurn();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (this.gameOver) return;
                if (passSlot !== this._slotOfTurn()) return;            // 虚当前颜色回合
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(passSlot)) return;
                const colorNow = this.turnColor;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(passSlot);
                this.actionColors.push(colorNow);
                this.moveCoords.push({ type: 'pass', player: passSlot, color: colorNow });
                this.lastMoveMarkers = [];
                this.passCounter++;
                this._advanceTurn();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                // 连续 4 个虚着（黑白红蓝各一次）→ 数点
                if (this.passCounter >= 4) {
                    this.passCounter = 0;
                    const blackPlayer = room.getPlayerBySlot('player1');
                    const whitePlayer = room.getPlayerBySlot('player2');
                    if (blackPlayer && whitePlayer) this.startScoreCounting(blackPlayer, whitePlayer);
                    else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;
            }

            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                // 双人四色悔棋:仅当前颜色回合的行动者可请求,
                // 撤销最近 4 个行动(不足则撤到开局),回到「上一次轮到该色」
                if (slot !== this._slotOfTurn()) return;
                const steps = Math.min(4, this.historyBoards.length);
                if (steps === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
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
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!endOpponent) {
                    this.startScoreCounting(ws, ws);
                } else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept) {
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                } else if (this.pendingEnd && !msg.accept) {
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._stopClockTicker();
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
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
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();
            if (this.actionColors.length > 0)
                this.actionColors.pop();
        }
        if (this.historyBoards.length == 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        // 回合颜色:回到剩余历史最后一手的下一色;全部撤掉则从黑重新开始
        if (this.actionColors.length === 0) this.turnColor = 1;
        else this.turnColor = nextColor(this.actionColors.at(-1));
        this.currentPlayer = sideOfColor(this.turnColor);
        // 连续虚着计数按剩余历史尾部重算
        this.passCounter = 0;
        for (let i = this.moveCoords.length - 1; i >= 0 && this.moveCoords[i].type === 'pass'; i--)
            this.passCounter++;
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
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.turnColor = 1;
        this.actionColors = [];
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        for (let [client, slot] of this.room.players.entries())
        {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
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

    exportRecord()
    {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑蓝方胜';
            else if (this.winner === 'player2') resultText = '白红方胜';
        }
        // 每手编码:首字母=颜色(B黑 W白 R红 L蓝),p=虚着
        return {
            format: 'muzei',
            version: 1,
            gameType: '双人四色围棋',
            gameId: 'duo-quadricolour-weiqi',
            boardSize: this.boardSize,
            komi: 0,
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const ch = ['', 'B', 'W', 'R', 'L'][m.color];
                return m.type === 'pass' ? ch + 'p' : ch + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.turnColor = 1;
        this.actionColors = [];
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const colorMap = { B: 1, W: 2, R: 3, L: 4 };
            const color = colorMap[entry[0]] || 1;
            const slot = sideOfColor(color) === 1 ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player: slot, color };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player: slot, color, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'duo-quadricolour-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要双人四色围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(DuoQuadricolourRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const colorVal = move.color || 1;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, colorVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.actionColors.push(colorVal);
                this.moveCoords.push({ type: 'move', player: slot, color: colorVal, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: colorVal }];
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.actionColors.push(colorVal);
                this.moveCoords.push({ type: 'pass', player: slot, color: colorVal });
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
        }
        // 回合恢复到剩余历史最后一手的下一色（全空则黑先）
        if (this.actionColors.length === 0) this.turnColor = 1;
        else this.turnColor = nextColor(this.actionColors.at(-1));
        this.currentPlayer = sideOfColor(this.turnColor);

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

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = DuoQuadricolourRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'player1' || data.result === 'player2' || data.result === 'draw'))
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

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });

        if (this.hostWs === ws) {
            const other = slot === 'player1'
                ? this.room.getPlayerBySlot('player2')
                : this.room.getPlayerBySlot('player1');
            this.hostWs = other || null;
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
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    DuoQuadricolourRoom,
    initRoom(room) {
        room.gameLogic = new DuoQuadricolourRoom(room);
        room.maxPlayers = 2;
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};