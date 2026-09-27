'use strict';

/**
 * 猜数字（guess-number）：双人、非棋盘游戏（对比 versus-schulte-grid 的接线方式）。
 *
 * 玩法：
 *   1) 落座：进房间先看到蒙版，点「入座」才占座位（与棋盘棋类一致）；双方入座后各自开始填数。
 *   2) 填数阶段：双方各在一张 n×n 方格（n = 3~6，双方相同）里填 1..(n+1)² 的数字，
 *      可重复、可留空；同一格各自独立，**看不到对方填的**（服务端只把自己的方格下发给自己）。
 *      限时 60 秒，超时按「当前已填内容」自动确定（未填的格子算空）。
 *   3) 对局阶段：回合制，每回合双方各提交一次猜测；双方都提交后结算——
 *      逐格完全一致（数字相同、空格也要对上）即为猜对；
 *      一方猜对则该方胜，同时猜对则平局；都没猜对则把本次结果记进历史（带每行/每列猜对数量）继续下一回合。
 *   4) 每回合限时 60 秒，超时**按当前已填内容自动提交**（未填算空）；若连续 4 回合双方都提交全空、或下满
 *      (n+1)² 回合仍无人猜中，判和棋。另有认输与求和（求和需对方同意）。
 *   5) 离开房间的座位不再允许入座；双方都离开房间 → 本局结束。旁观者只看得到双方的猜测（看不到任何人的方格）。
 *
 * 服务端是唯一权威：对方的方格在分出胜负前不会出现在任何下发给客户端的数据里。
 */

const N_MIN = 3;
const N_MAX = 6;
const FILL_MS = 60 * 1000;    // 填数阶段限时
const ROUND_MS = 60 * 1000;   // 每回合限时
const EMPTY_ROUNDS_TO_DRAW = 4;   // 连续这么多回合双方都提交全空 → 和棋

const SLOTS = ['player1', 'player2'];
function otherSlot(slot) { return slot === 'player1' ? 'player2' : 'player1'; }
function slotLabel(slot) { return slot === 'player2' ? '白方' : '黑方'; }

/** 空方格：全部为 null（= 空） */
function emptyGrid(n) {
    return Array.from({ length: n }, () => new Array(n).fill(null));
}

class GuessNumberRoom {
    constructor(room) {
        this.room = room;
        this.boardSize = 4;                 // n（3~6）
        this.phase = 'filling';             // filling | playing | over
        this.grids = { player1: null, player2: null };      // 已确定的私密方格
        this.drafts = { player1: null, player2: null };     // 客户端边改边报的草稿（超时按它确定）
        this.confirmed = { player1: false, player2: false };
        this.guesses = { player1: null, player2: null };    // 本回合已提交的猜测
        this.guessDrafts = { player1: null, player2: null };// 本回合边改边报的草稿（超时按它提交）
        this.submitted = { player1: false, player2: false };
        this.emptyRounds = 0;               // 连续「双方都提交全空」的回合数
        this.abandoned = { player1: false, player2: false };  // 该座位的人已离开房间（离开后不再允许入座）
        this.history = { player1: [], player2: [] };        // 各自猜过的（对阵对方方格）
        this.round = 0;
        this.deadline = { player1: null, player2: null };   // 当前阶段各自截止时间
        this._timer = null;
        this.gameOver = false;
        this.winner = null;                 // 'player1' | 'player2' | 'draw'
        this.resultText = '';
        this.pendingDraw = null;            // { requester }
        this._seq = 0;                      // 状态版本号（客户端用来丢弃过期状态）
    }

    /**
     * 入座：与棋盘棋类一致——进房间默认是旁观（房间页显示蒙版 + 「入座」按钮），
     * 只有客户端明确请求某个空位（棋盘棋类的断线续坐）才直接给座位；落座走 takeSeat。
     */
    assignSlot(ws, requestedSlot) {
        if (requestedSlot !== 'player1' && requestedSlot !== 'player2') return null;
        if (this.room.getPlayerBySlot(requestedSlot)) return null;
        return requestedSlot;
    }

    /** 填数阶段的限时：每人入座起 60 秒（幂等） */
    _ensureFillDeadline(slot) {
        if (!slot || this.phase !== 'filling' || this.confirmed[slot]) return;
        if (Number.isFinite(this.deadline[slot])) return;
        if (!this.room.getPlayerBySlot(slot)) return;
        this.deadline[slot] = this._now() + FILL_MS;
        this._armTimer();
    }

    getMoveCount() { return this.round; }

    _now() { return Date.now(); }

    /** 1..(n+1)² */
    maxNumber() { return (this.boardSize + 1) * (this.boardSize + 1); }

    /** 回合上限：(n+1)² —— 下满仍无人猜中则和棋 */
    maxRounds() { return this.maxNumber(); }

    /** 校验并归一化一张 n×n 方格：每格 null 或 1..max 的整数；不合法返回 null */
    _normalizeGrid(raw) {
        const n = this.boardSize;
        if (!Array.isArray(raw) || raw.length !== n) return null;
        const max = this.maxNumber();
        const out = emptyGrid(n);
        for (let r = 0; r < n; r++) {
            const row = raw[r];
            if (!Array.isArray(row) || row.length !== n) return null;
            for (let c = 0; c < n; c++) {
                const v = row[c];
                if (v === null || v === undefined || v === '' ) { out[r][c] = null; continue; }
                const num = Number(v);
                if (!Number.isInteger(num) || num < 1 || num > max) return null;
                out[r][c] = num;
            }
        }
        return out;
    }

    /** 是否一格都没有（全空） */
    static isGridEmpty(grid) {
        if (!grid) return true;
        for (const row of grid) {
            for (const v of row) if (v != null) return false;
        }
        return true;
    }

    /** 两张方格是否逐格一致（含空格） */
    static gridsEqual(a, b) {
        for (let r = 0; r < a.length; r++) {
            for (let c = 0; c < a[r].length; c++) {
                if (a[r][c] !== b[r][c]) return false;
            }
        }
        return true;
    }

    /**
     * 一行（或一列）的「匹配数」：不看位置，按出现次数计；**空格也当成一个值参与**
     * （答案有空格、猜的也是空格，就算猜对一个）。
     * 答案 [1,1,2,3] 对猜测 [3,2,1,1] → 4；答案两个 1、猜测一个 1 → 只算 1 次。
     */
    static rowMatchCount(gRow, tRow) {
        const used = new Array(tRow.length).fill(false);
        let hit = 0;
        for (let i = 0; i < gRow.length; i++) {
            for (let j = 0; j < tRow.length; j++) {
                if (used[j]) continue;
                if (gRow[i] === tRow[j]) { used[j] = true; hit += 1; break; }
            }
        }
        return hit;
    }

    /**
     * 两个格子的值是否「接近」（用于红色的差值提示）：
     *   都空 → 算接近；一空一数 → 不算；
     *   都是数 → 直接比较绝对差：**差 ≤ n 或者 差 ≥ n²+n+1** 都算
     *   （4 路即差 ≤ 4 或 ≥ 21；等价于按 (n+1)² 取模的循环距离 ≤ n，1 与 25 只差 1）。
     */
    static nearValue(n, a, b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        const d = Math.abs(Number(a) - Number(b));
        return d <= n || d >= n * n + n + 1;
    }

    /**
     * 一条猜测的提示数：
     *   rowHits/colHits（绿）＝ 每行/每列「数字匹配数」（不看位置，按出现次数计）；
     *   rowNear/colNear（红）＝ 每行/每列「值接近且位置正确」的格数；
     *   exactTotal（整张）＝ 完全猜对（位置和数字都对，空格对空格也算）的格数。
     */
    static matchHits(guess, truth, n) {
        const size = truth.length;
        const nn = Number.isInteger(n) ? n : size;
        const rowHits = new Array(size).fill(0);
        const colHits = new Array(size).fill(0);
        const rowNear = new Array(size).fill(0);
        const colNear = new Array(size).fill(0);
        let exactTotal = 0;
        for (let r = 0; r < size; r++) {
            rowHits[r] = GuessNumberRoom.rowMatchCount(guess[r], truth[r]);
            for (let c = 0; c < size; c++) {
                if (guess[r][c] === truth[r][c]) exactTotal += 1;
                if (GuessNumberRoom.nearValue(nn, guess[r][c], truth[r][c])) {
                    rowNear[r] += 1;
                    colNear[c] += 1;
                }
            }
        }
        for (let c = 0; c < size; c++) {
            colHits[c] = GuessNumberRoom.rowMatchCount(guess.map((row) => row[c]), truth.map((row) => row[c]));
        }
        return { rowHits, colHits, rowNear, colNear, exactTotal };
    }

    _deny(ws, message) {
        try { ws.send(JSON.stringify({ type: 'error', message })); } catch (_) { /* ignore */ }
    }

    handleMessage(ws, msg) {
        if (!msg || !msg.type) return;
        const slot = this.room.getSlotByWs(ws);

        switch (msg.type) {
            case 'takeSeat': {
                if (slot) return;                              // 已经有座位
                if (this.phase === 'over' || this.gameOver) {   // 对局已结束：只能观战
                    this._deny(ws, '对局已结束，可等新局或观战。');
                    return;
                }
                if (this.abandoned.player1 && this.abandoned.player2) {
                    this._deny(ws, '双方都已离开房间，本局已结束。');
                    return;
                }
                const free = SLOTS.find((s) => !this.abandoned[s] && !this.room.getPlayerBySlot(s));
                if (!free) {
                    this._deny(ws, '双方均已落座。');
                    return;
                }
                this.room.setPlayerSlot(ws, free);
                if (this.room.observers && typeof this.room.observers.delete === 'function')
                    this.room.observers.delete(ws);
                this._ensureFillDeadline(free);                   // 填数阶段：入座即开始 60 秒
                if (this.phase === 'playing' && !Number.isFinite(this.deadline[free]))
                    this.deadline[free] = this._now() + ROUND_MS;  // 对局中途入座：本回合也有表
                this._armTimer();
                this._send(ws, { type: 'seatTaken', slot: free });
                this._broadcastState();
                return;
            }

            case 'setBoardSize': {
                const n = parseInt(String(msg.size ?? ''), 10);
                if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) {
                    this._deny(ws, `方格大小只能是 ${N_MIN}~${N_MAX}`);
                    return;
                }
                if (!slot) return;
                if (this.phase !== 'filling' || this.confirmed.player1 || this.confirmed.player2) {
                    this._deny(ws, '已经开始，不能改方格大小');
                    return;
                }
                this.boardSize = n;
                this._broadcastState();
                return;
            }

            case 'draftGrid': {
                if (!slot || this.gameOver) return;
                const grid = this._normalizeGrid(msg.grid);
                if (!grid) return;                       // 草稿容错：非法就忽略，不当错误提示
                if (this.phase === 'filling') {
                    if (this.confirmed[slot]) return;
                    this.drafts[slot] = grid;            // 填数草稿：超时按它自动确定
                } else if (this.phase === 'playing') {
                    if (this.submitted[slot]) return;
                    this.guessDrafts[slot] = grid;       // 猜测草稿：超时按它自动提交
                }
                return;
            }

            case 'confirmGrid': {
                if (!slot) return;
                if (this.phase !== 'filling' || this.confirmed[slot]) return;
                const grid = this._normalizeGrid(msg.grid);
                if (!grid) {
                    this._deny(ws, `每格填 1~${this.maxNumber()} 的整数，或留空`);
                    return;
                }
                this._confirm(slot, grid);
                return;
            }

            case 'submitGuess': {
                if (!slot) return;
                if (this.phase !== 'playing' || this.submitted[slot] || this.gameOver) return;
                const grid = this._normalizeGrid(msg.grid);
                if (!grid) {
                    this._deny(ws, `每格填 1~${this.maxNumber()} 的整数，或留空`);
                    return;
                }
                this._submit(slot, grid);
                return;
            }

            case 'resign': {
                if (!slot || this.gameOver || this.phase === 'over') return;
                this._finish(otherSlot(slot), `${slotLabel(slot)}认输`, `${slotLabel(slot)}认输，${slotLabel(otherSlot(slot))}胜`);
                return;
            }

            case 'requestDraw': {
                if (!slot || this.gameOver || this.phase === 'over') return;
                if (this.pendingDraw) return;
                this.pendingDraw = { requester: slot };
                this._sendSlot(otherSlot(slot), { type: 'drawRequest' });
                this._broadcastState();
                return;
            }

            case 'drawResponse': {
                if (!slot || !this.pendingDraw || this.gameOver) return;
                if (slot === this.pendingDraw.requester) return;
                const accepted = !!msg.accept;
                this.pendingDraw = null;
                if (accepted) {
                    this.winner = 'draw';
                    this._finish('draw', '双方同意和棋', '和棋');
                } else {
                    this._sendSlot(this.pendingDraw ? otherSlot(slot) : otherSlot(slot), { type: 'drawDeclined' });
                    this._broadcastState();
                }
                return;
            }

            case 'requestNewGame': {
                if (!slot) return;
                this._reset(true);
                return;
            }

            default:
                return;
        }
    }

    _send(ws, payload) {
        if (!ws) return;
        try { ws.send(JSON.stringify(payload)); } catch (_) { /* ignore */ }
    }

    /** 按座位发消息 */
    _sendSlot(slot, payload) {
        this._send(this.room.getPlayerBySlot(slot), payload);
    }

    /** 确定方格：写死不可改；双方都确定后开赛 */
    _confirm(slot, grid) {
        this.grids[slot] = grid;
        this.confirmed[slot] = true;
        this.drafts[slot] = grid;
        if (this.confirmed.player1 && this.confirmed.player2) {
            this.phase = 'playing';
            this.round = 1;
            const now = this._now();
            this.deadline = { player1: now + ROUND_MS, player2: now + ROUND_MS };
        } else {
            this.deadline[slot] = null;
        }
        this._armTimer();
        this._broadcastState();
    }

    /** 提交猜测：双方都提交后结算 */
    _submit(slot, grid) {
        if (this.submitted[slot] || this.gameOver || this.phase !== 'playing') return;
        this.guesses[slot] = grid;
        this.guessDrafts[slot] = grid;
        this.submitted[slot] = true;
        this.deadline[slot] = null;
        if (this.submitted.player1 && this.submitted.player2) {
            this._resolveRound();
        } else {
            this._armTimer();
            this._broadcastState();
        }
    }

    /** 一回合结算：都提交后判定猜对/记录历史 */
    _resolveRound() {
        const g1 = this.guesses.player1;
        const g2 = this.guesses.player2;
        const ok1 = g1 && this.grids.player2 && GuessNumberRoom.gridsEqual(g1, this.grids.player2);
        const ok2 = g2 && this.grids.player1 && GuessNumberRoom.gridsEqual(g2, this.grids.player1);
        if (ok1 || ok2) {
            // 猜对优先：对方方格本身就是全空时，第一次提交全空即可猜中（不会被下面的空回合规则吃掉）
            if (ok1 && ok2) {
                this._finish('draw', '双方同回合猜对', '和棋');
            } else if (ok1) {
                this._finish('player1', '黑方猜对', `${slotLabel('player2')}被猜中，${slotLabel('player1')}胜`);
            } else {
                this._finish('player2', '白方猜对', `${slotLabel('player1')}被猜中，${slotLabel('player2')}胜`);
            }
            return;
        }
        // 都没猜对：累计「双方都提交全空」的连续回合，够 4 回合直接判和（避免空转）
        if (GuessNumberRoom.isGridEmpty(g1) && GuessNumberRoom.isGridEmpty(g2)) {
            this.emptyRounds += 1;
            if (this.emptyRounds >= EMPTY_ROUNDS_TO_DRAW) {
                this._finish('draw', '连续空提交', `连续 ${EMPTY_ROUNDS_TO_DRAW} 回合双方都未提交有效猜测，和棋`);
                return;
            }
        } else {
            this.emptyRounds = 0;
        }
        // 记进历史（带每行/每列的匹配数、接近数、整张完全猜对格数），进入下一回合
        for (const slot of SLOTS) {
            const guess = this.guesses[slot];
            const truth = this.grids[otherSlot(slot)];
            if (!guess || !truth) continue;
            const hits = GuessNumberRoom.matchHits(guess, truth, this.boardSize);
            this.history[slot].push({
                round: this.round,
                grid: guess,
                rowHits: hits.rowHits,
                colHits: hits.colHits,
                rowNear: hits.rowNear,
                colNear: hits.colNear,
                exactTotal: hits.exactTotal
            });
        }
        this.round += 1;
        if (this.round > this.maxRounds()) {
            this._finish('draw', '达到回合上限', `已下满 ${this.maxRounds()} 回合仍无人猜中，和棋`);
            return;
        }
        this.guesses = { player1: null, player2: null };
        this.guessDrafts = { player1: null, player2: null };
        this.submitted = { player1: false, player2: false };
        const now = this._now();
        this.deadline = { player1: now + ROUND_MS, player2: now + ROUND_MS };
        this._armTimer();
        this._broadcastState();
    }

    _finish(winner, reason, text) {
        this.gameOver = true;
        this.phase = 'over';
        this.winner = winner;
        this.resultText = text || '';
        this.pendingDraw = null;
        this.deadline = { player1: null, player2: null };
        this._armTimer();
        this._broadcastState();
    }

    /** 定时器：只挂一个，取最近的一个截止时间 */
    _armTimer() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this.gameOver) return;
        const times = SLOTS.map((s) => this.deadline[s]).filter((t) => Number.isFinite(t));
        if (!times.length) return;
        const wait = Math.max(30, Math.min(...times) - this._now());
        this._timer = setTimeout(() => this._checkTimeouts(), wait + 10);
        if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
    }

    /** 超时处理：填数阶段按草稿自动确定；对局阶段按草稿自动提交（未填算空） */
    _checkTimeouts() {
        this._timer = null;
        if (this.gameOver) return;
        const now = this._now();
        if (this.phase === 'filling') {
            let changed = false;
            for (const slot of SLOTS) {
                if (this.confirmed[slot]) continue;
                const dl = this.deadline[slot];
                if (!Number.isFinite(dl) || now < dl) continue;
                const grid = this.drafts[slot] || emptyGrid(this.boardSize);
                this.grids[slot] = grid;
                this.confirmed[slot] = true;
                changed = true;
            }
            if (changed) {
                if (this.confirmed.player1 && this.confirmed.player2) {
                    this.phase = 'playing';
                    this.round = 1;
                    this.deadline = { player1: now + ROUND_MS, player2: now + ROUND_MS };
                }
                this._armTimer();
                this._broadcastState();
                return;
            }
        } else if (this.phase === 'playing') {
            const late = SLOTS.filter((s) => !this.submitted[s] && Number.isFinite(this.deadline[s]) && now >= this.deadline[s]);
            if (late.length) {
                // 超时不判负：把「当前已填的方格」直接提交（没填的格子算空），随后正常结算
                for (const slot of late) {
                    this._submit(slot, this.guessDrafts[slot] || emptyGrid(this.boardSize));
                }
                return;      // _submit 里已经广播 / 结算，无需再挂表
            }
        }
        this._armTimer();
    }

    /** 客户端视角的状态：对方的方格只在结束后揭晓 */
    _stateFor(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this._ensureFillDeadline(slot);
        const other = slot ? otherSlot(slot) : null;
        const reveal = this.phase === 'over';
        const mine = slot ? this.grids[slot] : null;
        const oppGrid = slot ? this.grids[other] : null;
        return {
            seq: ++this._seq,
            boardSize: this.boardSize,
            maxNumber: this.maxNumber(),
            phase: this.phase,
            round: this.round,
            gameOver: this.gameOver,
            winner: this.winner,
            resultText: this.resultText,
            serverNow: this._now(),
            mySlot: slot || null,
            slots: { player1: !!this.room.getPlayerBySlot('player1'), player2: !!this.room.getPlayerBySlot('player2') },
            confirmed: { player1: this.confirmed.player1, player2: this.confirmed.player2 },
            submitted: { player1: this.submitted.player1, player2: this.submitted.player2 },
            // 自己填的方格：随时可见；对方的方格只有结束后才揭晓
            myGrid: mine,
            myDraft: slot ? this.drafts[slot] : null,
            myGuessDraft: slot ? this.guessDrafts[slot] : null,
            oppRevealed: reveal ? oppGrid : null,
            // 历史：自己猜的 + 对方猜的（对方猜的是「我方方格」，行/列提示数都基于各自那张方格算好）
            myHistory: slot ? this.history[slot] : [],
            otherHistory: slot ? this.history[other] : [],
            // 旁观者：只看得到双方的猜测，看不到任何人填的数字（myGrid / oppRevealed 恒为 null）
            allHistory: slot ? null : { player1: this.history.player1, player2: this.history.player2 },
            pendingDraw: this.pendingDraw ? { requester: this.pendingDraw.requester, mine: this.pendingDraw.requester === slot } : null,
            fillLimitMs: FILL_MS,
            roundLimitMs: ROUND_MS,
            myDeadline: slot ? this.deadline[slot] : null,
            otherDeadline: slot ? this.deadline[other] : null
        };
    }

    _allClients() {
        const out = [];
        if (this.room.players) for (const ws of this.room.players.keys()) out.push(ws);
        for (const slot of SLOTS) {
            const ws = this.room.getPlayerBySlot(slot);
            if (ws && out.indexOf(ws) < 0) out.push(ws);
        }
        if (this.room.observers) for (const ws of this.room.observers) if (out.indexOf(ws) < 0) out.push(ws);
        return out;
    }

    _broadcastState() {
        for (const slot of SLOTS) this._ensureFillDeadline(slot);
        for (const ws of this._allClients()) {
            this._send(ws, { type: 'stateUpdate', state: this._stateFor(ws) });
        }
    }

    getStateForClient(ws) { return this._stateFor(ws); }
    getState() { return this._stateFor(null); }

    _reset(keepPlayers) {
        this.phase = 'filling';
        this.grids = { player1: null, player2: null };
        this.drafts = { player1: null, player2: null };
        this.confirmed = { player1: false, player2: false };
        this.guesses = { player1: null, player2: null };
        this.guessDrafts = { player1: null, player2: null };
        this.submitted = { player1: false, player2: false };
        this.emptyRounds = 0;
        this.history = { player1: [], player2: [] };
        this.round = 0;
        this.gameOver = false;
        this.winner = null;
        this.resultText = '';
        this.pendingDraw = null;
        const now = this._now();
        this.deadline = { player1: null, player2: null };
        for (const slot of SLOTS) {
            if (this.room.getPlayerBySlot(slot)) this.deadline[slot] = now + FILL_MS;
        }
        this._armTimer();
        this._broadcastState();
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        this.abandoned[slot] = true;      // 离开房间的座位不再允许入座
        // 对局中走人且本回合还没提交：按草稿自动提交（未填算空），别把对方卡在等待里
        if (this.phase === 'playing' && !this.submitted[slot] && !this.gameOver) {
            this._submit(slot, this.guessDrafts[slot] || emptyGrid(this.boardSize));
            if (this.gameOver) return;
        }
        this.deadline[slot] = null;
        this.drafts[slot] = null;
        // 房内一个入座者都不剩：双方都离开了 → 本局结束；只是掉线 → 回到填数前
        const others = SLOTS.filter((s) => s !== slot);
        if (!others.some((s) => !!this.room.getPlayerBySlot(s))) {
            if (this.abandoned.player1 && this.abandoned.player2) {
                if (this.phase !== 'over') {
                    this._finish('draw', '双方离开房间', '双方都离开了房间，本局结束');
                }
                return;
            }
            this.abandoned = { player1: false, player2: false };   // 房间空了，当新房间用
            this._reset(false);
            return;
        }
        // 走的人若已确定，保留其方格（重新入座是另一回事）；对局中停表等人
        this._armTimer();
        this._broadcastState();
    }

    dispose() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }

    /** 棋谱：一张对局快照（含双方方格与全部猜测），导入后直接是终局视图 */
    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '猜数字',
            gameId: 'guess-number',
            boardSize: this.boardSize,
            phase: this.phase,
            grids: { player1: this.grids.player1, player2: this.grids.player2 },
            history: { player1: this.history.player1, player2: this.history.player2 },
            round: this.round,
            winner: this.winner,
            result: this.winner,          // 座位（导出时公共层会按执方色写成「黑胜/白胜…」）
            resultText: this.resultText
        };
    }

    importRecord(data) {
        if (!data || data.gameId !== 'guess-number') return '棋谱格式不匹配';
        const n = parseInt(String(data.boardSize), 10);
        if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return '棋谱里方格大小无效';
        this.boardSize = n;
        // 填数阶段照原样；开过的局按回顾（over）导入：双方方格与历史都看得到，不再有计时
        this.phase = data.phase === 'filling' ? 'filling' : 'over';
        this.grids = { player1: null, player2: null };
        const norm = (g) => (Array.isArray(g) ? this._normalizeGrid(g) : null);
        this.grids.player1 = norm(data.grids && data.grids.player1);
        this.grids.player2 = norm(data.grids && data.grids.player2);
        this.history = {
            player1: Array.isArray(data.history && data.history.player1) ? data.history.player1 : [],
            player2: Array.isArray(data.history && data.history.player2) ? data.history.player2 : []
        };
        this.round = Number(data.round) || 0;
        this.winner = data.winner || null;
        // 棋谱里的终局是文案（resultText）；result 由公共层折成座位，不能当文案用
        this.resultText = data.resultText ? String(data.resultText) : '';
        this.gameOver = this.phase === 'over';
        this.confirmed = { player1: !!this.grids.player1, player2: !!this.grids.player2 };
        this.drafts = { player1: this.grids.player1, player2: this.grids.player2 };
        this.guesses = { player1: null, player2: null };
        this.guessDrafts = { player1: null, player2: null };
        this.submitted = { player1: false, player2: false };
        this.emptyRounds = 0;
        this.deadline = { player1: null, player2: null };
        this._armTimer();
        this._broadcastState();
        return null;
    }
}

module.exports = {
    N_MIN,
    N_MAX,
    FILL_MS,
    ROUND_MS,
    GuessNumberRoom,
    initRoom(room) {
        room.maxPlayers = 2;
        room.gameLogic = new GuessNumberRoom(room);
    }
};
