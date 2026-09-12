const { QiTwoPlayerRoomBase, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact, qiProtocol } = require('../common');
const {
    acquireKatagoSession,
    releaseKatagoSession,
    canAcquireKatagoNow,
    isKatagoBusyError,
    KATAGO_BUSY_MESSAGE,
    fromGtpVertex
} = require('../katago-gtp');

function normalizeLegacyInitialToCompact(initialPosition) {
    if (!initialPosition) return [];
    if (Array.isArray(initialPosition)) return initialPosition;
    if (typeof initialPosition !== 'object') return [];
    const out = [];
    for (const pos of initialPosition.black || []) {
        if (Array.isArray(pos) && pos.length === 2) out.push(`B${pos[0]},${pos[1]}`);
    }
    for (const pos of initialPosition.white || []) {
        if (Array.isArray(pos) && pos.length === 2) out.push(`W${pos[0]},${pos[1]}`);
    }
    return out;
}
class ChoiceWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 9) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        this.candidates = [];
        this.aiCandidatesEnabled = false;   // AI 生成选点模式
        this._aiSession = null;             // weiqi 引擎会话（复用与电脑对弈的引擎池）
        this._aiGen = 0;                    // 会话代次：防止旧异步结果覆盖新状态
        this._aiAcquiring = false;          // 引擎会话获取中（启动进程/加载模型，耗时数秒）
        this._engineSyncedMoves = 0;        // 引擎已同步的 moveCoords 步数（增量 play 依据）
        this._engineDirty = false;          // 盘面被直接替换（导入棋谱等）时强制全盘重放
        this.matchStarted = false;
        this.slotJoinedAt = { player1: null, player2: null };
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
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveCoords.length > 0 || this.gameOver) return;
        const room = this.room;
        if (!room.getPlayerBySlot('player1') || !room.getPlayerBySlot('player2')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        const ws1 = room.getPlayerBySlot(first);
        const other = first === 'player1' ? 'player2' : 'player1';
        const ws2 = room.getPlayerBySlot(other);
        if (ws1) ws1.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
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

    async _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        // 候选异步生成（不阻塞开局广播；引擎启动中时 acquire 完成会自动生成）
        this.generateCandidates().then(() => { this._broadcastCandidates(); });
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', now);
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null,
            ...this.getState()
        });
        this.broadcast({ type: 'gameState', ...this.getState() });
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
        const other = slot === 'player1' ? 'player2' : 'player1';
        this.tcNego.waitingSlot = other;
        const selfWs = this.room.getPlayerBySlot(slot);
        if (selfWs) selfWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        this._sendRespondDialog(other, v);
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
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        return slot === (this.currentPlayer === 1 ? 'player1' : 'player2');
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

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize, (b) => this.copyBoard(b), 1
        );
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return squareWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this.boardSize
        );
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b));
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 2.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    edgeDist(row, col) {
        return Math.min(row, col, this.boardSize - 1 - row, this.boardSize - 1 - col);
    }

    getCandidateCount() {
        return Math.max(1, Math.floor(this.boardSize / 2) - 1);
    }

    /** 当前行棋方可下且不构成劫争的空白点（含提子与自杀规则，禁全同） */
    collectLegalEmpties() {
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        const legal = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] !== 0) continue;
                const newBoard = this.tryPlaceStone(this.board, r, c, playerVal);
                if (!newBoard) continue;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) continue;
                legal.push({ row: r, col: c });
            }
        }
        return legal;
    }

    filterByEdgeMode(points, mode) {
        return points.filter(p => {
            const d = this.edgeDist(p.row, p.col);
            if (mode === 'strict5') return d >= 2;
            if (mode === 'strict10') return d >= 1;
            return true;
        });
    }

    shufflePick(pool, k) {
        const a = pool.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a.slice(0, k).map(p => ({ row: p.row, col: p.col }));
    }

    /** 候选生成串行链：落子广播已不再等待候选，连续快速落子时后一次生成须等前一次完成，
     *  否则两个 setupGame 交错会污染引擎局面、给出错误候选 */
    generateCandidates() {
        const prev = this._candidatesChain || Promise.resolve();
        const run = prev.then(() => this._generateCandidatesOnce());
        // 链上某次失败不阻断后续，且返回的 promise 永不 reject（调用方 .then 广播必须执行，
        // 否则候选永远为空、玩家无法落子）
        this._candidatesChain = run.catch(() => {});
        return run.catch(() => {});
    }

    async _generateCandidatesOnce() {
        // 未开局（时间协商完成前/新局）：不显示任何候选
        if (!this.matchStarted) {
            this.candidates = [];
            return;
        }
        // AI 生成选点模式：调 weiqi 引擎 kata-search_analyze 取 1 选到 n 选
        if (this.aiCandidatesEnabled) {
            if (!this._aiSession || this._aiSession.dead) {
                // 会话不可用：引擎还在启动（acquire 进行中）时跳过本次（完成后会自动生成），
                // 只有确定失败/被回收时才提示回退随机
                if (!this._aiAcquiring) this._notifyAiFallback();
            } else {
                try {
                    const cands = await this._aiGenerateCandidates();
                    if (cands && cands.length) {
                        this.candidates = cands;
                        return;
                    }
                    // AI 分析未返回任何候选（引擎出错/无输出）：提示后回退随机，不静默
                    console.error('AI 选点无结果，回退随机选点');
                    this._notifyAiFallback();
                } catch (e) {
                    console.error('AI 选点失败，回退随机选点', e && e.message);
                    this._notifyAiFallback();
                }
            }
        }
        const need = this.getCandidateCount();
        const legal = this.collectLegalEmpties();
        if (legal.length === 0) {
            this.candidates = [];
            return;
        }
        const totalPoints = this.boardSize * this.boardSize;
        const p5 = Math.floor(0.05 * totalPoints);
        const p10 = Math.floor(0.1 * totalPoints);
        const ply = this.moveHistory.length;

        let pool;
        if (ply < p5) {
            pool = this.filterByEdgeMode(legal, 'strict5');
            if (pool.length < need) pool = this.filterByEdgeMode(legal, 'strict10');
            if (pool.length < need) pool = legal;
        } else if (ply < p10) {
            pool = this.filterByEdgeMode(legal, 'strict10');
            if (pool.length < need) pool = legal;
        } else {
            pool = legal;
        }

        const pick = Math.min(need, pool.length);
        this.candidates = this.shufflePick(pool, pick);
    }

    /** AI 生成候选点：同步局面后取模型策略网络的前 need 个点（与电脑对弈的落子一致） */
    async _aiGenerateCandidates() {
        const session = this._aiSession;
        const gen = this._aiGen;
        await this._syncEngineBoard(session);
        if (gen !== this._aiGen || !this.aiCandidatesEnabled) return null;
        const need = this.getCandidateCount();
        const points = await session.analyzeMoves(this.boardSize, { minMoves: need });
        if (gen !== this._aiGen || !this.aiCandidatesEnabled) return null;
        // 与随机候选一致：只保留当前规则下合法（可落子且非禁全同）的点
        const legalSet = new Set(this.collectLegalEmpties().map(c => c.row + ',' + c.col));
        const filtered = points.filter(c => legalSet.has(c.row + ',' + c.col));
        return filtered.length ? filtered : points;
    }

    /**
     * 增量同步引擎局面：AI 会话在勾选期间被本房间独占，引擎盘面停留在上次分析后的局面，
     * 只需把新增落子逐手 play 给引擎（毫秒级）；悔棋/新局（服务器步数少于引擎已同步）、
     * 导入棋谱（_engineDirty）或首次同步时才全盘 setupGame。
     * 这取代了每步全盘重放，是候选快速生成的关键。
     */
    async _syncEngineBoard(session) {
        const synced = this._engineSyncedMoves || 0;
        const mcs = this.moveCoords;
        // 服务器棋盘尺寸与引擎不一致（勾选 AI 后改棋盘大小再开局等）：
        // 必须全盘重设，否则 raw-nn 按旧尺寸输出、候选错乱
        const engineSize = session.boardWidth || session.boardSize;
        if (engineSize && engineSize !== this.boardSize) {
            await session.setupGame(this._buildSetupOpts());
            this._engineSyncedMoves = mcs.length;
            this._engineDirty = false;
            return;
        }
        if (mcs.length === synced && !this._engineDirty) return;
        if (mcs.length < synced || this._engineDirty) {
            // 悔棋/新局/导入：引擎盘面与服务器不一致，只能全盘重放
            await session.setupGame(this._buildSetupOpts());
            this._engineSyncedMoves = mcs.length;
            this._engineDirty = false;
            return;
        }
        for (let i = synced; i < mcs.length; i++) {
            const m = mcs[i];
            if (m.type === 'pass') await session.play(m.player, null, null);
            else if (m.type === 'move' && Number.isInteger(m.row) && Number.isInteger(m.col))
                await session.play(m.player, m.row, m.col);
        }
        this._engineSyncedMoves = mcs.length;
    }

    /** 构造引擎局面同步参数（与「与电脑对弈」的 buildKatagoSetupOpts 一致） */
    _buildSetupOpts() {
        const opts = {
            boardSize: this.boardSize,
            komi: 2.25,
            board: this.board,
            gameId: 'weiqi'
        };
        // set_position 后引擎行棋方恒为黑；当前轮到白时去掉最后一手再重放以翻转行棋方
        const nextPlayer = this.currentPlayer === 1 ? 'player1' : 'player2';
        const mcs = Array.isArray(this.moveCoords) ? this.moveCoords : [];
        const last = mcs.length ? mcs[mcs.length - 1] : null;
        if (nextPlayer === 'player2' && last && (last.player === 'player1' || last.player === 'player2')) {
            if (last.type === 'move' && Number.isInteger(last.row) && Number.isInteger(last.col)) {
                opts.lastMove = { player: last.player, row: last.row, col: last.col, shapeIndex: null, stones: null };
            } else if (last.type === 'pass') {
                opts.lastMove = { player: last.player, type: 'pass' };
            }
        }
        return opts;
    }

    /** 解析引擎分析输出的 info 行（格式：info move <loc> visits N ... prior P ... order N pv ...）。
     *  引擎内部已排序（search/analysisdata.cpp operator<：0-visits 排最后，
     *  其余按 playSelectionValue → visits → policyPrior，0-visits 间等价于按 prior 降序），
     *  直接按输出顺序取前 need 个，按坐标去重即可 */
    _parseAnalyzeMoves(lines, need) {
        const out = [];
        const seen = new Set();
        for (const line of lines) {
            const m = String(line).match(/\bmove\s+(\S+)/);
            if (!m) continue;
            const vertex = m[1];
            if (!vertex || /^pass$/i.test(vertex) || /^resign$/i.test(vertex)) continue;
            const v = fromGtpVertex(vertex, this.boardSize, this.boardSize);
            if (!v || v.pass) continue;
            const key = v.row + ',' + v.col;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ row: v.row, col: v.col });
            if (out.length >= need) break;
        }
        return out;
    }

    /** AI 选点失败时通知客户端（5 秒节流，避免连续落子刷屏） */
    _notifyAiFallback() {
        const now = Date.now();
        if (this._lastFallbackAt && now - this._lastFallbackAt < 5000) return;
        this._lastFallbackAt = now;
        this.broadcast({ type: 'aiCandidatesFallback', message: '引擎启动失败，回退为随机选点。' });
    }

    /** 释放 AI 选点引擎会话（引擎归还空闲池） */
    _releaseAiEngine() {
        this._aiGen++;
        if (this._aiSession) {
            releaseKatagoSession(this._aiSession).catch(err => {
                console.warn('AI 选点引擎归还失败', err && err.message);
                try { this._aiSession.destroy(); } catch (_) { /* ignore */ }
            });
            this._aiSession = null;
        }
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            komi: 2.25,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            candidates: this.candidates,
            aiCandidates: this.aiCandidatesEnabled,
            matchStarted: this.matchStarted,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true, Date.now());
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot)
                    return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    this.slotJoinedAt[newSlot] = Date.now();
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                    this._maybeBeginTimeNegotiation();
                }
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

            case 'setAiCandidates':
                this.setAiCandidates(!!msg.enabled, ws);
                break;

            case 'move':
                if (this.gameOver)
                    return;
                if (!slot || !this._timeAllowsPlay(slot))
                    return;
                if (slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize)
                    return;
                // 落子必须命中当前候选点；候选未就绪（空）时拒绝，绝不允许自由落子
                if (!this.candidates.some(c => c.row === row && c.col === col))
                    return;
                if (this.board[row][col] !== 0) {
                    return;
                }
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard)
                    return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                const candidatesBefore = this.candidates.map(c => ({ row: c.row, col: c.col }));
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col, candidatesBefore });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this._syncClockAfterTurnChange();
                // 先立即广播落子（候选清空），AI 候选生成完后再单独广播更新 —— 落子显示不等待引擎
                this.candidates = [];
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this.generateCandidates().then(() => { this._broadcastCandidates(); });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || !this._timeAllowsPlay(slot)) return;
                if (slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                if (!this._drainClockBeforeMove(slot)) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this._syncClockAfterTurnChange();
                // 先立即广播虚着（候选清空），候选生成完后再单独广播更新
                this.candidates = [];
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this.generateCandidates().then(() => { this._broadcastCandidates(); });
                if (this.passCounter >= 2) {
                    this.passCounter = 0;
                    const blackPlayer = room.getPlayerBySlot('player1');
                    const whitePlayer = room.getPlayerBySlot('player2');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver)
                    return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot)
                        break;
                }
                if (steps === 0 || steps > this.historyBoards.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
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
                this.winner = slot === 'player1' ? 'player2' : 'player1';
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                const drawOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
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
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this._stopClockTicker();
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false, Date.now());
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
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
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

    performUndo(steps, requesterWs) {
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
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.passCounter = 0;
        for (let i = this.moveCoords.length - 1; i >= 0; i--) {
            if (this.moveCoords[i].type === 'pass') this.passCounter++;
            else break;
        }
        this._syncClockAfterTurnChange();
        // 先立即广播悔棋（候选清空），候选生成完后再单独广播更新
        this.candidates = [];
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this.generateCandidates().then(() => { this._broadcastCandidates(); });
    }

    /** 广播最新候选点（轻量消息：只更新候选，不重建整局状态） */
    _broadcastCandidates() {
        this.broadcast({
            type: 'broadcast',
            action: 'candidatesUpdated',
            candidates: this.candidates.map(c => ({ row: c.row, col: c.col }))
        });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this._stopClockTicker();
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        this.candidates = [];
        // 新局保留前一局的 AI 生成选点选项（引擎会话继续复用）
        this.matchStarted = false;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    /** 启用/停用 AI 生成选点：启用时从引擎池获取 weiqi 会话（与「与电脑对弈」同池，
     *  受总进程数限制），繁忙时给出与其它棋类一致的提示；停用时归还引擎 */
    setAiCandidates(enabled, ws) {
        const want = !!enabled;
        if (want === !!this.aiCandidatesEnabled) return;
        if (want) {
            if (!this._aiSession && !canAcquireKatagoNow('weiqi')) {
                if (ws) ws.send(JSON.stringify({ type: 'error', message: KATAGO_BUSY_MESSAGE }));
                return;
            }
            // acquire 可能耗时数秒（启动进程/加载模型）：期间不误报「引擎启动失败」，
            // 开局时若会话未就绪则跳过本次分析，acquire 完成后自动生成并广播
            this._aiAcquiring = true;
            acquireKatagoSession('weiqi', { boardSize: this.boardSize }).then((session) => {
                this._aiAcquiring = false;
                if (!this.aiCandidatesEnabled && this._aiSession === null) {
                    this._aiSession = session;
                    this.aiCandidatesEnabled = true;
                    // 会话可能来自空闲池（已 clear_board）：引擎盘面未知，首次同步须全盘 setupGame
                    this._engineSyncedMoves = 0;
                    // 立即用 AI 刷新当前候选点
                    this.generateCandidates().then(() => {
                        this.broadcast({ type: 'broadcast', action: 'aiCandidatesChanged', ...this.getState() });
                    });
                } else {
                    // 获取期间已被关闭：直接归还
                    releaseKatagoSession(session);
                }
            }).catch((err) => {
                this._aiAcquiring = false;
                const msg = isKatagoBusyError(err)
                    ? (err.message || KATAGO_BUSY_MESSAGE)
                    : 'AI 选点引擎启动失败。';
                console.error('AI 选点引擎获取失败', err);
                // 广播 aiCandidates=false：让所有客户端（含发起方）回滚勾选状态
                this.broadcast({ type: 'broadcast', action: 'aiCandidatesChanged', ...this.getState() });
                if (ws) {
                    try { ws.send(JSON.stringify({ type: 'error', message: msg })); } catch (_) { /* ignore */ }
                }
            });
        } else {
            this.aiCandidatesEnabled = false;
            this._releaseAiEngine();
            this.generateCandidates().then(() => {
                this.broadcast({ type: 'broadcast', action: 'aiCandidatesChanged', ...this.getState() });
            });
        }
    }

    /**
     * 紧凑棋谱：落子为 B/W + 坐标 @ 本手之前候选点，例如 B3,4@5,7;5,8;5,9；虚着仍为 Bp。
     */
    static encodeMove(m) {
        const p = m.player === 'player1' ? 'B' : 'W';
        const cands = m.candidatesBefore.map(c => `${c.row},${c.col}`).join(';');
        return `${p}${m.row},${m.col}@${cands}`;
    }

    static parseMoveEntry(entry) {
        if (entry && typeof entry === 'object' && entry.player != null) {
            const row = Number(entry.row);
            const col = Number(entry.col);
            if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
            const cb = entry.candidatesBefore;
            if (!Array.isArray(cb) || cb.length < 1) return null;
            const candidatesBefore = [];
            for (const c of cb) {
                if (!c) return null;
                const cr = Number(c.row);
                const cc = Number(c.col);
                if (!Number.isFinite(cr) || !Number.isFinite(cc)) return null;
                candidatesBefore.push({ row: cr, col: cc });
            }
            const pl = entry.player === 'player1' || entry.player === 'player2' ? entry.player : null;
            if (!pl) return null;
            return { player: pl, row, col, candidatesBefore };
        }
        if (typeof entry !== 'string') return null;
        const at = entry.indexOf('@');
        if (at === -1) return null;
        const head = entry.slice(0, at);
        const tail = entry.slice(at + 1).trim();
        if (head.length < 3 || (head[0] !== 'B' && head[0] !== 'W')) return null;
        const comma = head.indexOf(',');
        if (comma <= 1) return null;
        const row = Number(head.slice(1, comma));
        const col = Number(head.slice(comma + 1));
        if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
        const player = head[0] === 'B' ? 'player1' : 'player2';
        const candidatesBefore = [];
        for (const seg of tail.split(';')) {
            const s = seg.trim();
            if (!s) continue;
            const parts = s.split(',');
            if (parts.length !== 2) return null;
            const r = Number(parts[0].trim());
            const c = Number(parts[1].trim());
            if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
            candidatesBefore.push({ row: r, col: c });
        }
        if (candidatesBefore.length < 1) return null;
        return { player, row, col, candidatesBefore };
    }

    static parseRecordedMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player };
            const m = ChoiceWeiqiRoom.parseMoveEntry(entry);
            if (!m) return null;
            return { type: 'move', ...m };
        }
        if (entry && typeof entry === 'object') {
            if (entry.type === 'pass') return { type: 'pass', player: entry.player };
            if (entry.row != null && entry.candidatesBefore) {
                const m = ChoiceWeiqiRoom.parseMoveEntry(entry);
                return m ? { type: 'move', ...m } : null;
            }
        }
        return null;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 3,
            gameType: '选点围棋',
            gameId: 'choice-weiqi',
            boardSize: this.boardSize,
            komi: 2.25,
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                return ChoiceWeiqiRoom.encodeMove(m);
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        this.candidates = [];
        // 重置房间/导入后保留 AI 生成选点选项（引擎会话继续复用）
        this.matchStarted = false;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._engineDirty = true;   // 棋盘/手序列被直接替换（导入等），引擎盘面须全盘重放
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'choice-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要选点围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        const compactInit = normalizeLegacyInitialToCompact(data.initialPosition);
        if (compactInit.length) {
            applyInitialPositionCompact(this.board, this.boardSize, compactInit);
            this.historyBoards = [this.copyBoard(this.board)];
            this.historyBoardSet.add(this.boardToString(this.board));
        }

        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const move = ChoiceWeiqiRoom.parseRecordedMove(rawMoves[i]);
            if (!move) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法解析` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手行棋方不符` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (move.type === 'move') {
                const { row, col, candidatesBefore } = move;
                this.candidates = candidatesBefore.map(c => ({ row: c.row, col: c.col }));
                if (!this.candidates.some(c => c.row === row && c.col === col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手落子不在候选点内` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const cb = this.candidates.map(c => ({ row: c.row, col: c.col }));
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col, candidatesBefore: cb });
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

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        // 候选生成（AI 模式为异步）完成后再广播导入结果
        this.generateCandidates().then(() => {
            this.broadcast({
                type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: compactInit.length ? compactInit : [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
            });
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            this.pendingScore = null;
            this.scoreProposalData = null;
            if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false, Date.now());
        }
        if (this.tcNego && slot) {
            this.tcNego = null;
            this.tcSettings = null;
            this.tcClock = null;
            this.matchStarted = false;
            this.candidates = [];
            this.broadcast({ type: 'timeControlReset', ...this.getState() });
        }
        // 房间无人时释放 AI 选点引擎
        if (this.room.getPlayerCount() === 0 && this._aiSession) {
            this.aiCandidatesEnabled = false;
            this._releaseAiEngine();
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new ChoiceWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
