const { QiTwoPlayerRoomBase, gridGraphWeiqiRules, qiMatchTimeControl, qiBoardSeatOverlay, qiProtocol } = require('../common');

class TriangleWeiqiRoom extends QiTwoPlayerRoomBase
{
    /** 三种棋盘形状的路数范围与默认路数 */
    static SHAPE_CONFIG = {
        triangle: { min: 9, max: 31, def: 27 },
        rhombus: { min: 5, max: 21, def: 13 },
        hexagon: { min: 3, max: 15, def: 6 }
    };

    /** 子棋类 id：棋谱中统一用 gameId=triangle-weiqi，用 subGameId 区分三种形状 */
    static SUB_GAME_ID = {
        triangle: 'triangle-weiqi',
        rhombus: 'rhom-triangle-weiqi',
        hexagon: 'hexagon-triangle-weiqi'
    };

    constructor(room, initialSize = 27, shape = 'triangle') {
        super(room);
        this.shape = shape;          // 'triangle' | 'rhombus' | 'hexagon'
        this.boardSize = initialSize;
        this.editBoardMode = 'triangle';
        this.board = this.createEmptyBoard();
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    shapeCfg() {
        return TriangleWeiqiRoom.SHAPE_CONFIG[this.shape] || TriangleWeiqiRoom.SHAPE_CONFIG.triangle;
    }

    /** 行数：三角/菱形 = 路数；六角 = 2×路数-1 */
    get ROWS() {
        return this.shape === 'hexagon' ? this.boardSize * 2 - 1 : this.boardSize;
    }

    /** 行 r 的格点数：三角 r+1；菱形恒为路数；六角 N+min(r, 2N-2-r) */
    rowLen(r) {
        if (this.shape === 'triangle') return r + 1;
        if (this.shape === 'rhombus') return this.boardSize;
        const m = Math.min(r, 2 * this.boardSize - 2 - r);
        return this.boardSize + m;
    }

    createEmptyBoard()
    {
        return Array(this.ROWS).fill().map((_, r) => Array(this.rowLen(r)).fill(0));
    }

    isValidCoord(r, c)
    {
        return r >= 0 && r < this.ROWS && c >= 0 && c < this.rowLen(r);
    }

    /** 编辑校验：每行长度按形状 */
    editBoardRowLength(r) {
        return this.rowLen(r);
    }

    copyBoard(src)
    {
        return src.map(row => row.slice());
    }

    boardToString(board)
    {
        const parts = [];
        for (let r = 0; r < this.ROWS; r++) {
            parts.push(board[r].join(','));
        }
        return parts.join(';');
    }

    /** 各形状的 6 向邻接（菱形方格斜向与三角相反） */
    _neighbors() {
        return (r, c) => {
            const out = [];
            const push = (nr, nc) => {
                if (this.isValidCoord(nr, nc)) out.push([nr, nc]);
            };
            if (this.shape === 'triangle') {
                for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) {
                    push(r + dr, c + dc);
                }
            } else if (this.shape === 'rhombus') {
                for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, -1], [-1, 1]]) {
                    push(r + dr, c + dc);
                }
            } else {
                // 六角：居中布局，相邻行偏移在中间行翻转
                push(r, c - 1);
                push(r, c + 1);
                if (r > 0) {
                    if (this.rowLen(r - 1) > this.rowLen(r)) { push(r - 1, c); push(r - 1, c + 1); }
                    else { push(r - 1, c - 1); push(r - 1, c); }
                }
                if (r < this.ROWS - 1) {
                    if (this.rowLen(r + 1) > this.rowLen(r)) { push(r + 1, c); push(r + 1, c + 1); }
                    else { push(r + 1, c - 1); push(r + 1, c); }
                }
            }
            return out;
        };
    }

    countGroupLiberties(board, row, col) {
        return gridGraphWeiqiRules.countGroupLiberties(board, row, col, this._neighbors());
    }

    hasLiberty(board, row, col) {
        return gridGraphWeiqiRules.countGroupLiberties(board, row, col, this._neighbors()) > 0;
    }

    removeGroup(board, row, col, color) {
        gridGraphWeiqiRules.removeGroup(board, row, col, color, this._neighbors());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidCoord(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._neighbors(), 1
        );
    }

    removeDeadGroups(srcBoard) {
        return gridGraphWeiqiRules.removeDeadAndDying(
            srcBoard,
            this.boardSize,
            this.boardSize,
            (b) => this.copyBoard(b),
            this._neighbors(),
            (r, c) => this.isValidCoord(r, c)
        );
    }

    /** 网格最短距离（BFS，适用于三种形状） */
    gridDistance(r1, c1, r2, c2) {
        if (r1 === r2 && c1 === c2) return 0;
        const nb = this._neighbors();
        const visited = new Set();
        let frontier = [[r1, c1]];
        visited.add(r1 + ',' + c1);
        let dist = 0;
        while (frontier.length) {
            dist++;
            const next = [];
            for (const [fr, fc] of frontier) {
                for (const [nr, nc] of nb(fr, fc)) {
                    const key = nr + ',' + nc;
                    if (visited.has(key)) continue;
                    if (nr === r2 && nc === c2) return dist;
                    visited.add(key);
                    next.push([nr, nc]);
                }
            }
            frontier = next;
        }
        return Infinity;
    }

    computeLead() {
        const liveBoard = this.removeDeadGroups(this.board);
        const blackStones = [], whiteStones = [];
        for (let r = 0; r < this.ROWS; r++) {
            for (let c = 0; c < this.rowLen(r); c++) {
                if (liveBoard[r][c] === 1) blackStones.push([r, c]);
                else if (liveBoard[r][c] === 2) whiteStones.push([r, c]);
            }
        }
        let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let r = 0; r < this.ROWS; r++) {
            for (let c = 0; c < this.rowLen(r); c++) {
                if (liveBoard[r][c] !== 0) continue;
                let minBlack = Infinity, minWhite = Infinity;
                for (const [br, bc] of blackStones) {
                    const d = this.gridDistance(r, c, br, bc);
                    if (d < minBlack) minBlack = d;
                }
                for (const [wr, wc] of whiteStones) {
                    const d = this.gridDistance(r, c, wr, wc);
                    if (d < minWhite) minWhite = d;
                }
                if (minBlack < minWhite) blackTerritory++;
                else if (minWhite < minBlack) whiteTerritory++;
                else publicTerritory++;
            }
        }
        const blackTotal = blackStones.length + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones.length + whiteTerritory + publicTerritory / 2;
        const KOMI = this._komi();
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    /** 贴目（服务端数子口径）：菱形 ≤8 路 4.25，其余 3.25 */
    _komi() {
        if (this.shape === 'rhombus') return this.boardSize <= 8 ? 4.25 : 3.25;
        return 3.25;
    }

    getState()
    {
        return {
            shape: this.shape,
            boardSize: this.boardSize,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
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
        };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    setBoardSize(newSize, requesterWs)
    {
        const cfg = this.shapeCfg();
        if (!Number.isInteger(newSize) || newSize < cfg.min || newSize > cfg.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效' }));
            return false;
        }
        const hasAnyStone = this.board.some((row, r) => row.some((v, c) => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        this.boardSize = newSize;
        this.board = this.createEmptyBoard();
        // 同步 openingBoard，避免 initialBoard 与 board 尺寸不一致（改大路数时客户端会把旧尺寸盘面当新尺寸渲染）
        this.openingBoard = this.copyBoard(this.board);
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    /** 切换棋盘形状（仅开局前）：重置为新形状的默认路数 */
    setShape(shape, requesterWs) {
        if (!TriangleWeiqiRoom.SHAPE_CONFIG[shape]) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘形状无效' }));
            return false;
        }
        if (shape === this.shape) return true;
        const hasAnyStone = this.board.some((row, r) => row.some((v, c) => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变棋盘形状' }));
            return false;
        }
        this.shape = shape;
        this.boardSize = this.shapeCfg().def;
        this.board = this.createEmptyBoard();
        this.openingBoard = this.copyBoard(this.board);
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        this.broadcast({ type: 'shapeChanged', shape, boardSize: this.boardSize, ...this.getState() });
        return true;
    }

    exportRecord() {
        const mainMinutes = (this.tcSettings && this.tcSettings.timed) ? this.tcSettings.mainMinutes : 0;
        const byoyomiSeconds = (this.tcSettings && this.tcSettings.timed) ? this.tcSettings.byoyomiSeconds : 0;
        const maxTimeouts = (this.tcSettings && this.tcSettings.timed) ? this.tcSettings.maxTimeouts : 0;
        const exportedTimeControl = (this.tcSettings && this.tcSettings.timed)
            ? `S${mainMinutes},${byoyomiSeconds},${maxTimeouts}`
            : null;
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        // 只用手顺即可从空盘复原终局；不要把全盘快照放进 initialPosition，
        // 否则与 moves 重复，导入时第一手会因“已有子”而失败。
        return {
            format: 'muzei',
            version: 2,
            gameType: '三角围棋',
            gameId: 'triangle-weiqi',
            subGameId: TriangleWeiqiRoom.SUB_GAME_ID[this.shape] || 'triangle-weiqi',
            shape: this.shape,
            boardSize: this.boardSize,
            komi: this._komi(),
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
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

    _clearTimeNegotiation(reason) {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset', reason: reason || 'cleared' });
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        const room = this.room;
        if (!room.getPlayerBySlot('black') || !room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null) return;
        if (this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first,
            lastProposerSlot: null
        };
        const ws = room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? {
                timed: true,
                mainMinutes: valid.mainMinutes,
                byoyomiSeconds: valid.byoyomiSeconds,
                maxTimeouts: valid.maxTimeouts
            }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', now);
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

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: proposal.timed,
                    mainMinutes: proposal.mainMinutes,
                    byoyomiSeconds: proposal.byoyomiSeconds,
                    maxTimeouts: proposal.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
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
        const slot = this.currentPlayer === 1 ? 'black' : 'white';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和胜';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'black') this.recordResultText = '黑超时白胜';
        else if (lostSlot === 'white') this.recordResultText = '白超时黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    parseInitialPositionCompact(initialPosition) {
        if (!Array.isArray(initialPosition)) return [];
        const out = [];
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 4) continue;
            const p = s[0];
            if (p !== 'B' && p !== 'W') continue;
            const comma = s.indexOf(',');
            if (comma <= 1) continue;
            const r = parseInt(s.slice(1, comma), 10);
            const c = parseInt(s.slice(comma + 1), 10);
            if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
            if (!this.isValidCoord(r, c)) continue;
            out.push(`${p}${r},${c}`);
        }
        return out;
    }

    importRecord(data, requesterWs) {
        // 棋谱统一用 gameId=triangle-weiqi，用 subGameId 区分形状；
        // 兼容旧版：旧棋谱 gameId 直接是 rhom-triangle-weiqi / hexagon-triangle-weiqi（无 subGameId）
        const oldId = data && data.gameId;
        if (!data || (oldId !== 'triangle-weiqi' && oldId !== 'rhom-triangle-weiqi' && oldId !== 'hexagon-triangle-weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要三角围棋棋谱）' }));
            return;
        }
        const subGameId = data.subGameId || oldId;
        const shape = data.shape
            || (subGameId === 'rhom-triangle-weiqi' ? 'rhombus' : subGameId === 'hexagon-triangle-weiqi' ? 'hexagon' : 'triangle');
        if (!TriangleWeiqiRoom.SHAPE_CONFIG[shape]) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘形状无效' }));
            return;
        }
        const cfg = TriangleWeiqiRoom.SHAPE_CONFIG[shape];
        const newSize = data.boardSize || cfg.def;
        if (!Number.isInteger(newSize) || newSize < cfg.min || newSize > cfg.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效' }));
            return;
        }

        this.shape = shape;
        this.boardSize = newSize;
        this.resetToEmpty();

        let compactInitialPosition = this.parseInitialPositionCompact(data.initialPosition);
        for (const s of compactInitialPosition) {
            const p = s[0];
            const comma = s.indexOf(',');
            const r = parseInt(s.slice(1, comma), 10);
            const c = parseInt(s.slice(comma + 1), 10);
            this.board[r][c] = p === 'B' ? 1 : 2;
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(TriangleWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (!this.isValidCoord(row, col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                // 兼容旧版导出：initialPosition 含全盘快照且 moves 仍含相同落子——盘面不变但仍记入手顺，供客户端从空盘复原。
                if (this.board[row][col] === playerVal) {
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'move', player: slot, row, col });
                    this.lastMoveMarkers = [{ row, col, color: playerVal }];
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    continue;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
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
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
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
        } else if (typeof data.timeControl === 'string') {
            const m = /^S(\d+),(\d+),(\d+)$/.exec(data.timeControl);
            if (m) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(m[1], 10) || 0,
                    byoyomiSeconds: parseInt(m[2], 10) || 0,
                    maxTimeouts: parseInt(m[3], 10) || 0
                };
                this.matchStarted = true;
            }
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = TriangleWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                boardSize: this.boardSize,
                // 打谱从空盘 + 全手顺即可；避免 initialPosition 与 moves 重复导致客户端回放失败
                initialPosition: [],
                moves: moves.map(m => (m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, row: m.row, col: m.col }))
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.afterColorAssigned(ws, newSlot);
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws, msg);
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'setShape':
                if (!slot && !this.room.players.size)
                    this.setShape(msg.shape, ws);
                break;

            case 'move':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (!this.isValidCoord(row, col) || this.board[row][col] !== 0)
                    return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard)
                    return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr))
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                } 
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                qiProtocol.weiqiPass(this, ws, slot, {
                    afterBroadcast: () => this._syncClockAfterTurnChange(),
                });
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
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
                const opponentSlot = slot === 'black' ? 'white' : 'black';
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
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.onResignResolved(slot);
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                } else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this._stopClockTicker();
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
                    this.onDrawResolved();
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
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

    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length)
            return;

        for (let i = 0; i < steps; i++) {
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

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length == 0)
            this.board = this.createEmptyBoard();
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = this.createEmptyBoard();
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
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

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
            this._clearTimeNegotiation('playerLeft');
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new TriangleWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
