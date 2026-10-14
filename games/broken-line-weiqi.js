const crypto = require('crypto');

const { qiApplyRecordKomi, qiEffectiveKomi, qiBoardSeatOverlay, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, gridGraphWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, encodeOpeningPositionCompact } = require('../common');

/**
 * 断线围棋（broken-line-weiqi）＝ 围棋 + 棋盘上随机切断一部分相邻点之间的连线。
 *
 * 断线的含义（只影响「相邻关系」这一件事）：
 *   - 被切断的两点**不再相连**：互相不提供气；
 *   - 计算棋组（连通块）时不能穿过这根线；
 *   - 提子 / 自杀 / 禁全同 / 双虚着数点……全部按断线后的邻接走；
 *   - 其它完全同围棋（黑先、贴目、虚着、认输、求和、悔棋、限时、编辑棋盘、棋谱导入导出）。
 *
 * 生成：开局时从全部 2N(N−1) 条线里随机挑 floor(BROKEN_EDGE_RATIO × 条数) 根切断，
 * 每局（新局 / 改路数）重新随机。两条硬约束（违反就撤销这根、换下一根候选）：
 *   - **每个点至少留两个邻点**：角点的线不切（它本来只有 2 个邻点）、边点最多切 1 根、中腹点最多切 2 根；
 *   - **不允许出现孤岛**：切断后整盘图必须仍连通。
 * 断线随棋谱导出/导入（以记录为准）。
 *
 * 实现：几何仍走公共层 gridGraphWeiqiRules / gridGraphWeiqiScoringOps，
 * 只把「邻居函数」换成断线后的四邻（`_nb()`），于是气、提子、Benson、空点归属全部自动按断线算。
 * 形势判断用围棋默认那档（Benson），其中「距离扩张」走的是图上 BFS 距离，所以距离不会穿过断线。
 */
/** 切断比例（占全部连线数的比例，向下取整）—— 想调比例改这里即可 */
const BROKEN_EDGE_RATIO = 0.125;
const RECORD_GAME_ID = 'broken-line-weiqi';
const RECORD_GAME_TYPE = '断线围棋';

class BrokenLineWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        /** 断线：cutMask[r][c] 用位标记该点四条边里哪几条被切断（1=上 2=下 4=左 8=右） */
        this.cutMask = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        /** 断线：可序列化的 [r1,c1,r2,c2] 列表（下发给客户端 / 进棋谱） */
        this.brokenEdgeList = [];
        /** 只在「重置/换路数/房间重置」那一帧让 getState() 带上断线 */
        this._withBrokenEdges = false;
        this._generateBrokenEdges();
        this.openingBoard = this.copyBoard(this.board);
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

    /* ---------- 断线：生成 / 查询 ---------- */

    /** 从 (r,c) 指向 (r+dr,c+dc) 的方向位 */
    _dirBit(dr, dc) {
        if (dr === -1) return 1;
        if (dr === 1) return 2;
        if (dc === -1) return 4;
        return 8;
    }

    _isValidPoint(r, c) {
        return r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize;
    }

    /** 这两个相邻点之间的线是否被切断（不相邻则恒为 false） */
    isCutEdge(r1, c1, r2, c2) {
        if (!this._isValidPoint(r1, c1) || !this._isValidPoint(r2, c2)) return false;
        if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
        return (this.cutMask[r1][c1] & this._dirBit(r2 - r1, c2 - c1)) !== 0;
    }

    _setCut(r1, c1, r2, c2, on) {
        const b1 = this._dirBit(r2 - r1, c2 - c1);
        const b2 = this._dirBit(r1 - r2, c1 - c2);
        this.cutMask[r1][c1] = on ? (this.cutMask[r1][c1] | b1) : (this.cutMask[r1][c1] & ~b1);
        this.cutMask[r2][c2] = on ? (this.cutMask[r2][c2] | b2) : (this.cutMask[r2][c2] & ~b2);
    }

    /** 公共层的邻居函数：四邻里**没被切断**的那些点（气、棋组、Benson、数点全走这里） */
    _nb() {
        const size = this.boardSize;
        const self = this;
        return function getNeighbors(r, c) {
            const out = [];
            if (r > 0 && !self.isCutEdge(r, c, r - 1, c)) out.push([r - 1, c]);
            if (r + 1 < size && !self.isCutEdge(r, c, r + 1, c)) out.push([r + 1, c]);
            if (c > 0 && !self.isCutEdge(r, c, r, c - 1)) out.push([r, c - 1]);
            if (c + 1 < size && !self.isCutEdge(r, c, r, c + 1)) out.push([r, c + 1]);
            return out;
        };
    }

    /** 某个点切断后还剩几个邻点（角点 2、边点 3、中腹点 4 起步，减掉已切断的方向） */
    _degreeAfterCuts(r, c) {
        const n = this.boardSize;
        let base = 0;
        if (r > 0) base++;
        if (r + 1 < n) base++;
        if (c > 0) base++;
        if (c + 1 < n) base++;
        const m = (this.cutMask[r] && this.cutMask[r][c]) || 0;
        let cut = 0;
        if (m & 1) cut++;
        if (m & 2) cut++;
        if (m & 4) cut++;
        if (m & 8) cut++;
        return base - cut;
    }

    /** 断线后整盘图是否仍连通（不连通 = 出现孤岛） */
    _isBoardConnected() {
        const n = this.boardSize;
        const nb = this._nb();
        const seen = new Uint8Array(n * n);
        const queue = [0];
        seen[0] = 1;
        let count = 1;
        for (let head = 0; head < queue.length; head++) {
            const v = queue[head];
            const r = (v / n) | 0;
            const c = v % n;
            for (const [nr, nc] of nb(r, c)) {
                const idx = nr * n + nc;
                if (seen[idx]) continue;
                seen[idx] = 1;
                count++;
                queue.push(idx);
            }
        }
        return count === n * n;
    }

    /**
     * 生成断线：从全部连线里随机挑 floor(BROKEN_EDGE_RATIO × 条数) 根切断。
     * 每切一根都要过两道检查，任一不过就撤销这根、换下一根候选：
     *   1) **每个点至少剩两个邻点**（角点不切、边点 ≤1 根、中腹点 ≤2 根）；
     *   2) 整盘图仍连通（不出现孤岛）。
     * 贪心一轮万一凑不满目标（极小概率），重新洗牌再来，最多 5 轮。
     * @param {() => number} [rand] 随机源（测试可注入）
     */
    _generateBrokenEdges(rand = Math.random) {
        const n = this.boardSize;
        const edges = [];
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (c + 1 < n) edges.push([r, c, r, c + 1]);
                if (r + 1 < n) edges.push([r, c, r + 1, c]);
            }
        }
        const target = Math.floor(BROKEN_EDGE_RATIO * edges.length);
        for (let attempt = 0; attempt < 5; attempt++) {
            this.cutMask = Array(n).fill().map(() => Array(n).fill(0));
            this.brokenEdgeList = [];
            for (let i = edges.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                const t = edges[i];
                edges[i] = edges[j];
                edges[j] = t;
            }
            let cut = 0;
            for (const [r1, c1, r2, c2] of edges) {
                if (cut >= target) break;
                this._setCut(r1, c1, r2, c2, true);
                if (this._degreeAfterCuts(r1, c1) < 2 || this._degreeAfterCuts(r2, c2) < 2) {
                    this._setCut(r1, c1, r2, c2, false);   // 会让某个点只剩一个邻点 → 恢复，换下一根
                    continue;
                }
                if (!this._isBoardConnected()) {
                    this._setCut(r1, c1, r2, c2, false);   // 会造成孤岛 → 恢复这根线，换下一根
                    continue;
                }
                this.brokenEdgeList.push([r1, c1, r2, c2]);
                cut++;
            }
            if (cut >= target) return;
        }
    }

    /** 按棋谱里的断线还原（格式 [[r1,c1,r2,c2], …]，非法项忽略） */
    _setBrokenEdgesFromList(list) {
        const n = this.boardSize;
        this.cutMask = Array(n).fill().map(() => Array(n).fill(0));
        this.brokenEdgeList = [];
        if (!Array.isArray(list)) return;
        for (const e of list) {
            if (!Array.isArray(e) || e.length !== 4) continue;
            const nums = e.map((v) => Number(v));
            if (!nums.every((v) => Number.isInteger(v))) continue;
            const [r1, c1, r2, c2] = nums;
            if (!this._isValidPoint(r1, c1) || !this._isValidPoint(r2, c2)) continue;
            if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) continue;
            this._setCut(r1, c1, r2, c2, true);
            this.brokenEdgeList.push([r1, c1, r2, c2]);
        }
    }

    /** 下发给客户端的断线（外层数组是新的一份，内层数组只读共享） */
    _brokenEdgesForState() {
        return this.brokenEdgeList.slice();
    }

    /* ---------- 规则：全部走公共层 gridGraphWeiqiRules（邻接 = 断线后的四邻） ---------- */

    countGroupLiberties(board, row, col) {
        return gridGraphWeiqiRules.countGroupLiberties(board, row, col, this._nb());
    }

    removeGroup(board, row, col, color) {
        gridGraphWeiqiRules.removeGroup(board, row, col, color, this._nb());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this._isValidPoint(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._nb(), 1
        );
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return gridGraphWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this._nb()
        );
    }

    removeDeadAndDying(srcBoard) {
        return gridGraphWeiqiRules.removeDeadAndDying(
            srcBoard, this.boardSize, this.boardSize,
            (b) => this.copyBoard(b), this._nb(), (r, c) => this._isValidPoint(r, c)
        );
    }

    assignTerritoryWithRange(liveBoard) {
        return gridGraphWeiqiRules.assignTerritoryWithRange(
            liveBoard, this.boardSize, this.boardSize, this._nb(), (r, c) => this._isValidPoint(r, c)
        );
    }

    computeScore(liveBoard, territory) {
        return gridGraphWeiqiRules.computeScore(
            liveBoard, territory, this.boardSize, this.boardSize, (r, c) => this._isValidPoint(r, c)
        );
    }

    /**
     * 形势判断 / 数点：与普通围棋同一档（弱气去死子 ↔ Benson 保活 → 空点归属 → 确定领地覆盖），
     * 但气 / 死子 / 归属全部按**断线后的邻接**算；归属里的「距离扩张」是图上 BFS 距离（不穿断线）。
     */
    computeLead() {
        const KOMI = qiEffectiveKomi(this, this.boardSize <= 8 ? 4.25 : 3.25);
        const nb = this._nb();
        const isPoint = (r, c) => this._isValidPoint(r, c);
        const bensonOf = (bd) => gridGraphWeiqiRules.bensonAlive(bd, this.boardSize, this.boardSize, nb, isPoint);
        const benson = bensonOf(this.board);
        let liveBoard = this.removeDeadAndDying(this.board);
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = this.removeDeadAndDying(liveBoard);
            for (let r = 0; r < this.boardSize; r++) {
                for (let c = 0; c < this.boardSize; c++) {
                    const v = this.board[r][c];
                    if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
            }
            liveBoard = cleaned;
        }
        const territory = this.assignTerritoryWithRange(liveBoard);
        const secure = bensonOf(liveBoard);
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
        }
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和棋';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    getState()
    {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        const st = {
            boardSize: this.boardSize,
            komi: qiEffectiveKomi(this, this.boardSize <= 8 ? 4.25 : 3.25),
            board: this.board,
            initialBoard,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
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
        // 平时不带断线（每手广播要省带宽）；只有 _withBrokenEdges 临时打开时带 ——
        // 见 resetGame() 里的说明（公共层的 broadcast 包装会拿 getState() 重建成载荷）
        if (this._withBrokenEdges) st.brokenEdges = this._brokenEdgesForState();
        return st;
    }

    /**
     * 带断线的整盘状态：**断线只在下列时刻下发**
     *   - 进房 joined（qi-server 用 getStateForClient，玩家/观战者都在这里拿到）
     *   - 开局 newGameStarted、改路数 boardSizeChanged、导入 importSuccess、房间重置 roomReset
     * 对局中每手的广播（move/pass/undo/…）一律不带 —— 客户端自己缓存着，断线一局内不变。
     */
    getStateWithBrokenEdges() {
        return { ...this.getState(), brokenEdges: this._brokenEdgesForState() };
    }

    getInitialState() {
        return this.getStateWithBrokenEdges();
    }

    getStateForClient() {
        return this.getStateWithBrokenEdges();
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
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const before = () => this._drainClockBeforeMove(moveSlot);
                qiProtocol.weiqiMove(this, ws, msg, moveSlot, { beforeCommit: before });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const beforeP = () => this._drainClockBeforeMove(passSlot);
                qiProtocol.weiqiPass(this, ws, passSlot, { beforeCommit: beforeP });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
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
                // 与公共 qiProtocol.resetRoomToEmpty 同逻辑；断线在 resetToEmpty 里已重随机，
                // 所以这一条要带断线下发（否则客户端还画着上一局的断线）
                if (!this.room.getPlayerBySlot('player1') && !this.room.getPlayerBySlot('player2')) {
                    this.resetToEmpty();
                    this._withBrokenEdges = true;
                    try {
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                    } finally {
                        this._withBrokenEdges = false;
                    }
                }
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
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.importedKomi = undefined;
        this.matchStarted = false;
        this.brokenEdgeList = [];
        this._generateBrokenEdges();
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
        qiProtocol.releaseAllSeats(this);
        // 公共 qiProtocol 给 resetGame/resetToEmpty 装了 broadcast 包装（wrapResetSyncOpening）：
        // 它会把 newGameStarted / roomReset 的载荷**换成 self.getState() 的结果** ——
        // 直接塞在载荷里的断线会被丢掉，所以这里临时让 getState() 自己带上断线。
        this._withBrokenEdges = true;
        try {
            this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
        } finally {
            this._withBrokenEdges = false;
        }
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {

            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize, brokenEdges: this._brokenEdgesForState() });
        return true;
    }

    exportRecord()
    {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: RECORD_GAME_TYPE,
            gameId: RECORD_GAME_ID,
            boardSize: this.boardSize,
            komi: qiEffectiveKomi(this, this.boardSize <= 8 ? 4.25 : 3.25),
            brokenEdges: this._brokenEdgesForState(),
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
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
        this.importedKomi = undefined;
        this.matchStarted = false;
        this.brokenEdgeList = [];
        this._generateBrokenEdges();
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
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== RECORD_GAME_ID) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要断线围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        this._setBrokenEdgesFromList(data.brokenEdges);   // 断线以棋谱记录为准

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(BrokenLineWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
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
        }

        if (data.result || data.resultText) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        qiApplyRecordKomi(this, data);   // 导入棋谱采纳记录贴目（新局/重置时清掉）
        this.broadcast({
            type: 'importSuccess',
            ...this.getStateWithBrokenEdges(),
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
    BrokenLineWeiqiRoom,
    initRoom(room) {
        room.gameLogic = new BrokenLineWeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};