'use strict';

const { QiTwoPlayerRoomBase, qiProtocol } = require('../common');

const DIRS8 = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
];

const DEFAULT_BOARD_SIZE = 19;
const DEFAULT_MINE_COUNT = 72;
const DEFAULT_BURY_MINUTES = 2;
const DEFAULT_SWEEP_MINUTES = 5;

function cellKey(r, c) {
    return `${r},${c}`;
}

function parseKey(k) {
    const i = k.indexOf(',');
    return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

function countNeighborMines(mines, r, c, n) {
    let cnt = 0;
    for (const [dr, dc] of DIRS8) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && mines.has(cellKey(rr, cc))) cnt++;
    }
    return cnt;
}

function floodOpen(mines, opened, flags, r, c, n) {
    const stack = [[r, c]];
    while (stack.length) {
        const [cr, cc] = stack.pop();
        const k = cellKey(cr, cc);
        if (opened.has(k) || mines.has(k)) continue;
        if (flags.get(k) === 'flag') continue;
        // 问号不阻挡展开/双键打开（仅旗子阻挡）
        if (flags.get(k) === 'question') flags.delete(k);
        opened.add(k);
        if (countNeighborMines(mines, cr, cc, n) !== 0) continue;
        for (const [dr, dc] of DIRS8) {
            const rr = cr + dr;
            const cc2 = cc + dc;
            if (rr < 0 || rr >= n || cc2 < 0 || cc2 >= n) continue;
            const nk = cellKey(rr, cc2);
            if (!opened.has(nk) && !mines.has(nk)) stack.push([rr, cc2]);
        }
    }
}

/** 多源 BFS：雷格距离 0，向外递增，取距离最大的非雷格（并列随机） */
function furthestFromMines(mines, n) {
    const dist = Array.from({ length: n }, () => Array(n).fill(-1));
    const q = [];
    for (const k of mines) {
        const [r, c] = parseKey(k);
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        dist[r][c] = 0;
        q.push([r, c]);
    }
    if (q.length === 0) {
        return { r: Math.floor(Math.random() * n), c: Math.floor(Math.random() * n) };
    }
    let qi = 0;
    while (qi < q.length) {
        const [r, c] = q[qi++];
        for (const [dr, dc] of DIRS8) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            if (dist[rr][cc] >= 0) continue;
            dist[rr][cc] = dist[r][c] + 1;
            q.push([rr, cc]);
        }
    }
    let best = -1;
    const candidates = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (mines.has(cellKey(r, c))) continue;
            const d = dist[r][c];
            if (d > best) {
                best = d;
                candidates.length = 0;
                candidates.push({ r, c });
            } else if (d === best) {
                candidates.push({ r, c });
            }
        }
    }
    if (candidates.length === 0) {
        return { r: 0, c: 0 };
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function clampInt(v, lo, hi, fallback) {
    const n = parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
}

class VersusMinesweeperRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.mineCount = DEFAULT_MINE_COUNT;
        this.buryMinutes = DEFAULT_BURY_MINUTES;
        this.sweepMinutes = DEFAULT_SWEEP_MINUTES;
        /** @type {'waiting'|'negotiating'|'burying'|'sweeping'|'finished'} */
        this.phase = 'waiting';
        this.matchStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.resultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.settingsNego = null;
        this.settingsLocked = null;
        /** 各方埋雷集合 */
        this.buryMines = { black: new Set(), white: new Set() };
        /** 各方是否已确认埋雷结束 */
        this.buryDone = { black: false, white: false };
        /** 扫雷状态（扫的是对方埋的雷） */
        this.sweep = { black: null, white: null };
        this.sharedClock = null;
        this._clockInterval = null;
        this.pendingNewGame = null;
        this.recordResultText = null;
    }

    _other(slot) {
        return slot === 'black' ? 'white' : 'black';
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _stopClock() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _clockSnapshot() {
        if (!this.sharedClock) return null;
        const now = Date.now();
        let remaining = this.sharedClock.remainingMs;
        if (this.sharedClock.running) {
            remaining = Math.max(0, this.sharedClock.remainingMs - (now - this.sharedClock.lastUpdateMs));
        }
        return {
            timed: true,
            phase: this.phase,
            remainingMs: remaining,
            totalMs: this.sharedClock.totalMs,
            serverNow: now,
            label: this.sharedClock.label
        };
    }

    _broadcastClock() {
        const snap = this._clockSnapshot();
        if (snap) this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _applyClockElapsed(now) {
        const c = this.sharedClock;
        if (!c || !c.running) return false;
        let elapsed = now - c.lastUpdateMs;
        if (elapsed < 0) elapsed = 0;
        c.remainingMs = Math.max(0, c.remainingMs - elapsed);
        c.lastUpdateMs = now;
        return c.remainingMs <= 0;
    }

    _startPhaseClock(totalMs, label) {
        this._stopClock();
        const now = Date.now();
        this.sharedClock = {
            remainingMs: totalMs,
            totalMs,
            lastUpdateMs: now,
            running: true,
            label
        };
        this._broadcastClock();
        this._clockInterval = setInterval(() => {
            if (this.gameOver || (this.phase !== 'burying' && this.phase !== 'sweeping')) {
                this._stopClock();
                return;
            }
            if (this._applyClockElapsed(Date.now())) {
                this._onPhaseTimeout();
            } else {
                this._broadcastClock();
            }
        }, 250);
    }

    _onPhaseTimeout() {
        if (this.phase === 'burying') {
            this._beginSweepPhase();
            return;
        }
        if (this.phase === 'sweeping') {
            this._finishByTimeout();
        }
    }

    _emptyFlags() {
        return new Map();
    }

    _makeSweepState(mines) {
        const mineSet = new Set(mines);
        const recommend = furthestFromMines(mineSet, this.boardSize);
        return {
            mines: mineSet,
            opened: new Set(),
            flags: this._emptyFlags(),
            failed: false,
            finished: false,
            failAt: null,
            finishAt: null,
            recommend,
            hitMines: new Set(),
            revealed: false
        };
    }

    _safeTotal(slot) {
        const sw = this.sweep[slot];
        if (!sw) return this.boardSize * this.boardSize;
        return this.boardSize * this.boardSize - sw.mines.size;
    }

    _openedCount(slot) {
        const sw = this.sweep[slot];
        return sw ? sw.opened.size : 0;
    }

    _progressRatio(slot) {
        const total = this.boardSize * this.boardSize;
        if (total <= 0) return 0;
        return this._openedCount(slot) / total;
    }

    _progressPercent(slot) {
        return Math.floor(this._progressRatio(slot) * 100 + 1e-9);
    }

    _flagCount(slot) {
        const sw = this.sweep[slot];
        if (!sw) return 0;
        let n = 0;
        for (const v of sw.flags.values()) {
            if (v === 'flag') n++;
        }
        return n;
    }

    _remainingSafe(slot) {
        return Math.max(0, this._safeTotal(slot) - this._openedCount(slot));
    }

    _remainingMines(slot) {
        const sw = this.sweep[slot];
        if (!sw) return 0;
        return Math.max(0, sw.mines.size - this._flagCount(slot));
    }

    _clientBoard(slot, forSlot) {
        const sw = this.sweep[slot];
        const n = this.boardSize;
        const cells = [];
        const showMines = !!(sw && (sw.revealed || this.gameOver || sw.failed || sw.finished));
        for (let r = 0; r < n; r++) {
            const row = [];
            for (let c = 0; c < n; c++) {
                const k = cellKey(r, c);
                const mark = sw ? (sw.flags.get(k) || null) : null;
                const isMine = sw ? sw.mines.has(k) : false;
                const opened = sw ? sw.opened.has(k) : false;
                let kind = 'closed';
                let number = 0;
                if (mark === 'flag') kind = 'flag';
                else if (mark === 'question') kind = 'question';
                else if (opened) {
                    number = countNeighborMines(sw.mines, r, c, n);
                    kind = number > 0 ? 'number' : 'empty';
                }
                if (showMines && isMine) {
                    kind = sw.hitMines.has(k) ? 'mine-hit' : 'mine';
                }
                row.push({ kind, number });
            }
            cells.push(row);
        }
        const recommend = sw && forSlot === slot && this.phase === 'sweeping' && !sw.failed && !sw.finished
            ? sw.recommend
            : null;
        return {
            cells,
            recommend,
            opened: sw ? sw.opened.size : 0,
            remainingSafe: this._remainingSafe(slot),
            flagged: this._flagCount(slot),
            remainingMines: this._remainingMines(slot),
            mineTotal: sw ? sw.mines.size : 0,
            progressPercent: this._progressPercent(slot),
            failed: !!(sw && sw.failed),
            finished: !!(sw && sw.finished)
        };
    }

    _buryBoardForClient(slot) {
        const n = this.boardSize;
        const mines = this.buryMines[slot];
        const cells = [];
        for (let r = 0; r < n; r++) {
            const row = [];
            for (let c = 0; c < n; c++) {
                row.push(mines.has(cellKey(r, c)) ? { kind: 'mine' } : { kind: 'closed' });
            }
            cells.push(row);
        }
        return {
            cells,
            placed: mines.size,
            target: this.mineCount,
            buryDone: !!this.buryDone[slot]
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        const base = this.getState();
        if (this.phase === 'burying' && slot) {
            return {
                ...base,
                myBoard: this._buryBoardForClient(slot),
                mySlot: slot
            };
        }
        if ((this.phase === 'sweeping' || this.phase === 'finished') && slot) {
            return {
                ...base,
                myBoard: this._clientBoard(slot, slot),
                oppProgressPercent: this._progressPercent(this._other(slot)),
                mySlot: slot
            };
        }
        if ((this.phase === 'sweeping' || this.phase === 'finished') && !slot) {
            return {
                ...base,
                myBoard: this._clientBoard('black', null),
                whiteBoard: this._clientBoard('white', null),
                mySlot: null
            };
        }
        return { ...base, myBoard: null, mySlot: slot || null };
    }

    getState() {
        return {
            boardSize: this.boardSize,
            mineCount: this.mineCount,
            buryMinutes: this.buryMinutes,
            sweepMinutes: this.sweepMinutes,
            phase: this.phase,
            matchStarted: this.matchStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            resultText: this.resultText,
            clock: this._clockSnapshot(),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            progress: {
                black: this._progressPercent('black'),
                white: this._progressPercent('white')
            },
            buryCounts: {
                black: this.buryMines.black.size,
                white: this.buryMines.white.size
            },
            buryDone: {
                black: !!this.buryDone.black,
                white: !!this.buryDone.white
            },
            settingsLocked: this.settingsLocked
        };
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    broadcastState() {
        for (const [ws] of this.room.players) {
            this.sendState(ws);
        }
        for (const ws of this.room.observers) {
            this.sendState(ws);
        }
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginSettingsNegotiation();
    }

    _maybeBeginSettingsNegotiation() {
        if (this.matchStarted || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.settingsNego || this.settingsLocked) return;
        const first = this._firstPickerSlot();
        this.phase = 'negotiating';
        this.settingsNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first
        };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'settingsNegotiation',
                mode: 'propose',
                defaults: {
                    mineCount: this.mineCount,
                    buryMinutes: this.buryMinutes,
                    sweepMinutes: this.sweepMinutes,
                    boardSize: this.boardSize
                }
            }));
        }
        const other = this._other(first);
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) {
            ws2.send(JSON.stringify({
                type: 'settingsWaitPeer',
                text: '等待对方设置规则...'
            }));
        }
        this.broadcastState();
    }

    _validateSettings(msg) {
        const boardSize = clampInt(msg.boardSize, 7, 27, this.boardSize);
        const maxCells = boardSize * boardSize - 1;
        const mineCount = clampInt(msg.mineCount, 1, Math.max(1, maxCells), DEFAULT_MINE_COUNT);
        const buryMinutes = clampInt(msg.buryMinutes, 1, 60, DEFAULT_BURY_MINUTES);
        const sweepMinutes = clampInt(msg.sweepMinutes, 1, 120, DEFAULT_SWEEP_MINUTES);
        return { ok: true, boardSize, mineCount, buryMinutes, sweepMinutes };
    }

    _sendRespondSettings(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'settingsNegotiation',
            mode: 'respond',
            proposal: {
                boardSize: proposal.boardSize,
                mineCount: proposal.mineCount,
                buryMinutes: proposal.buryMinutes,
                sweepMinutes: proposal.sweepMinutes
            }
        }));
    }

    _finalizeSettings(valid) {
        this.boardSize = valid.boardSize;
        this.mineCount = valid.mineCount;
        this.buryMinutes = valid.buryMinutes;
        this.sweepMinutes = valid.sweepMinutes;
        this.settingsLocked = {
            boardSize: valid.boardSize,
            mineCount: valid.mineCount,
            buryMinutes: valid.buryMinutes,
            sweepMinutes: valid.sweepMinutes
        };
        this.settingsNego = null;
        this.matchStarted = true;
        this.buryMines = { black: new Set(), white: new Set() };
        this.buryDone = { black: false, white: false };
        this.sweep = { black: null, white: null };
        this.gameOver = false;
        this.winner = null;
        this.resultText = null;
        this.phase = 'burying';
        this.broadcast({
            type: 'settingsAgreed',
            settings: this.settingsLocked
        });
        this._startPhaseClock(this.buryMinutes * 60 * 1000, '埋雷');
        this.broadcastState();
    }

    _handleSettingsSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.settingsNego) return;
        const v = this._validateSettings(msg);
        if (this.settingsNego.phase === 'propose') {
            if (slot !== this.settingsNego.waitingSlot) return;
            this.settingsNego.proposal = v;
            this.settingsNego.phase = 'respond';
            const other = this._other(slot);
            this.settingsNego.waitingSlot = other;
            ws.send(JSON.stringify({ type: 'settingsWaitPeer', text: '等待对方确认...' }));
            this._sendRespondSettings(other, v);
            return;
        }
        if (this.settingsNego.phase === 'respond') {
            if (slot !== this.settingsNego.waitingSlot) return;
            this.settingsNego.proposal = v;
            const other = this._other(slot);
            this.settingsNego.waitingSlot = other;
            ws.send(JSON.stringify({ type: 'settingsWaitPeer', text: '等待对方确认...' }));
            this._sendRespondSettings(other, v);
        }
    }

    _handleSettingsAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.settingsNego || this.settingsNego.phase !== 'respond') return;
        if (slot !== this.settingsNego.waitingSlot) return;
        const prop = this.settingsNego.proposal;
        if (!prop || !prop.ok) return;
        this._finalizeSettings(prop);
    }

    _bothBuryReady() {
        return !!this.buryDone.black && !!this.buryDone.white;
    }

    _finishBury(slot) {
        if (this.phase !== 'burying' || this.gameOver) return;
        if (!slot || this.buryDone[slot]) return;
        this.buryDone[slot] = true;
        if (this._bothBuryReady()) {
            this._beginSweepPhase();
            return;
        }
        this.broadcastState();
    }

    _beginSweepPhase() {
        this._stopClock();
        this.sharedClock = null;
        this.sweep = {
            black: this._makeSweepState(this.buryMines.white),
            white: this._makeSweepState(this.buryMines.black)
        };
        this.phase = 'sweeping';
        this._startPhaseClock(this.sweepMinutes * 60 * 1000, '扫雷');
        this.broadcast({ type: 'phaseChanged', phase: 'sweeping' });
        this.broadcastState();
    }

    _checkSweepComplete(slot) {
        const sw = this.sweep[slot];
        if (!sw || sw.failed || sw.finished) return;
        if (sw.opened.size >= this._safeTotal(slot)) {
            sw.finished = true;
            sw.finishAt = Date.now();
            sw.revealed = true;
            this._declareWinner(slot, `${slot === 'black' ? '黑方' : '白方'}完成扫雷获胜`);
        }
    }

    _declareWinner(winnerSlot, text) {
        if (this.gameOver) return;
        this.gameOver = true;
        this.winner = winnerSlot;
        this.resultText = text;
        this.recordResultText = text;
        this.phase = 'finished';
        this._stopClock();
        if (this.sharedClock) this.sharedClock.running = false;
        if (this.sweep.black) this.sweep.black.revealed = true;
        if (this.sweep.white) this.sweep.white.revealed = true;
        this.broadcast({
            type: 'broadcast',
            action: 'gameResult',
            winner: winnerSlot,
            resultText: text,
            ...this.getState()
        });
        this.broadcastState();
    }

    _compareFailedOrTimeout() {
        const b = this.sweep.black;
        const w = this.sweep.white;
        const bp = this._progressRatio('black');
        const wp = this._progressRatio('white');
        if (bp > wp) return { winner: 'black', text: '黑方进度更高获胜' };
        if (wp > bp) return { winner: 'white', text: '白方进度更高获胜' };
        const bt = b && b.failAt != null ? b.failAt : Number.POSITIVE_INFINITY;
        const wt = w && w.failAt != null ? w.failAt : Number.POSITIVE_INFINITY;
        if (bt < wt) return { winner: 'black', text: '进度相同，黑方先触雷（用时更短）获胜' };
        if (wt < bt) return { winner: 'white', text: '进度相同，白方先触雷（用时更短）获胜' };
        return { winner: 'draw', text: '双方进度与用时相同，和棋' };
    }

    _maybeFinishBothFailed() {
        const b = this.sweep.black;
        const w = this.sweep.white;
        if (!b || !w) return;
        if (b.failed && w.failed) {
            const r = this._compareFailedOrTimeout();
            this._declareWinner(r.winner, r.text);
        }
    }

    _finishByTimeout() {
        if (this.gameOver) return;
        const b = this.sweep.black;
        const w = this.sweep.white;
        if (b && b.finished && (!w || !w.finished)) {
            this._declareWinner('black', '黑方完成扫雷获胜');
            return;
        }
        if (w && w.finished && (!b || !b.finished)) {
            this._declareWinner('white', '白方完成扫雷获胜');
            return;
        }
        const r = this._compareFailedOrTimeout();
        this._declareWinner(r.winner, `对局结束，${r.text}`);
    }

    _failPlayer(slot, hitKeys) {
        const sw = this.sweep[slot];
        if (!sw || sw.failed || sw.finished || this.gameOver) return;
        sw.failed = true;
        sw.failAt = Date.now();
        sw.revealed = true;
        for (const k of hitKeys) sw.hitMines.add(k);
        this._maybeFinishBothFailed();
        if (!this.gameOver) this.broadcastState();
    }

    _openCell(slot, r, c, chordHits) {
        const sw = this.sweep[slot];
        const n = this.boardSize;
        const k = cellKey(r, c);
        if (!sw || sw.failed || sw.finished || this.gameOver) return;
        if (r < 0 || r >= n || c < 0 || c >= n) return;
        const mark = sw.flags.get(k);
        if (mark === 'flag' || mark === 'question') return;
        if (sw.opened.has(k)) return;
        if (sw.mines.has(k)) {
            const hits = chordHits || new Set([k]);
            hits.add(k);
            this._failPlayer(slot, hits);
            return;
        }
        floodOpen(sw.mines, sw.opened, sw.flags, r, c, n);
        this._checkSweepComplete(slot);
        if (!this.gameOver) this.broadcastState();
    }

    _chord(slot, r, c) {
        const sw = this.sweep[slot];
        const n = this.boardSize;
        if (!sw || sw.failed || sw.finished || this.gameOver) return;
        const k = cellKey(r, c);
        if (!sw.opened.has(k)) return;
        const num = countNeighborMines(sw.mines, r, c, n);
        if (num <= 0) return;
        let flagCnt = 0;
        const neighbors = [];
        for (const [dr, dc] of DIRS8) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            const nk = cellKey(rr, cc);
            neighbors.push([rr, cc, nk]);
            if (sw.flags.get(nk) === 'flag') flagCnt++;
        }
        if (flagCnt !== num) return;
        const hitMines = new Set();
        const toOpen = [];
        for (const [rr, cc, nk] of neighbors) {
            if (sw.flags.get(nk) === 'flag') continue;
            if (sw.opened.has(nk)) continue;
            if (sw.mines.has(nk)) hitMines.add(nk);
            else toOpen.push([rr, cc]);
        }
        if (hitMines.size > 0) {
            this._failPlayer(slot, hitMines);
            return;
        }
        for (const [rr, cc] of toOpen) {
            floodOpen(sw.mines, sw.opened, sw.flags, rr, cc, n);
        }
        this._checkSweepComplete(slot);
        if (!this.gameOver) this.broadcastState();
    }

    _cycleMark(slot, r, c) {
        const sw = this.sweep[slot];
        const n = this.boardSize;
        if (!sw || sw.failed || sw.finished || this.gameOver) return;
        if (r < 0 || r >= n || c < 0 || c >= n) return;
        const k = cellKey(r, c);
        if (sw.opened.has(k)) return;
        const cur = sw.flags.get(k) || null;
        if (cur == null) sw.flags.set(k, 'flag');
        else if (cur === 'flag') sw.flags.set(k, 'question');
        else sw.flags.delete(k);
        this.broadcastState();
    }

    _buryClick(slot, r, c, right) {
        if (this.phase !== 'burying' || this.gameOver) return;
        if (this.buryDone[slot]) return;
        const n = this.boardSize;
        if (r < 0 || r >= n || c < 0 || c >= n) return;
        const set = this.buryMines[slot];
        const k = cellKey(r, c);
        if (right) {
            set.delete(k);
        } else if (set.has(k)) {
            set.delete(k);
        } else {
            if (set.size >= this.mineCount) return;
            set.add(k);
        }
        this.broadcastState();
    }

    resetToEmpty() {
        this._stopClock();
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.mineCount = DEFAULT_MINE_COUNT;
        this.buryMinutes = DEFAULT_BURY_MINUTES;
        this.sweepMinutes = DEFAULT_SWEEP_MINUTES;
        this.phase = 'waiting';
        this.matchStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.resultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.settingsNego = null;
        this.settingsLocked = null;
        this.buryMines = { black: new Set(), white: new Set() };
        this.buryDone = { black: false, white: false };
        this.sweep = { black: null, white: null };
        this.sharedClock = null;
        this.pendingNewGame = null;
    }

    _resetMatchKeepSeats() {
        this._stopClock();
        this.phase = 'waiting';
        this.matchStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.resultText = null;
        this.settingsNego = null;
        this.settingsLocked = null;
        this.buryMines = { black: new Set(), white: new Set() };
        this.buryDone = { black: false, white: false };
        this.sweep = { black: null, white: null };
        this.sharedClock = null;
        this.pendingNewGame = null;
        this._maybeBeginSettingsNegotiation();
        this.broadcastState();
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;
            case 'setBoardSize': {
                if (this.matchStarted || this.phase === 'negotiating') {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始或正在确认规则，无法修改棋盘大小。' }));
                    return;
                }
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法修改棋盘大小。' }));
                    return;
                }
                const size = clampInt(msg.boardSize, 7, 27, this.boardSize);
                this.boardSize = size;
                this.broadcast({ type: 'boardSizeChanged', boardSize: size, ...this.getState() });
                this.broadcastState();
                break;
            }
            case 'settingsSubmit':
                this._handleSettingsSubmit(ws, msg);
                break;
            case 'settingsAccept':
                this._handleSettingsAccept(ws);
                break;
            case 'buryClick': {
                if (!slot) return;
                this._buryClick(slot, msg.row | 0, msg.col | 0, !!msg.right);
                break;
            }
            case 'buryFinish': {
                if (!slot) return;
                this._finishBury(slot);
                break;
            }
            case 'openCell': {
                if (!slot || this.phase !== 'sweeping') return;
                this._openCell(slot, msg.row | 0, msg.col | 0);
                break;
            }
            case 'chordCell': {
                if (!slot || this.phase !== 'sweeping') return;
                this._chord(slot, msg.row | 0, msg.col | 0);
                break;
            }
            case 'markCell': {
                if (!slot || this.phase !== 'sweeping') return;
                this._cycleMark(slot, msg.row | 0, msg.col | 0);
                break;
            }
            case 'requestNewGame': {
                if (!slot) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有对局者可以开始新局' }));
                    return;
                }
                if (!this.gameOver && this.matchStarted) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局尚未结束' }));
                    return;
                }
                const other = this._other(slot);
                const opp = this.room.getPlayerBySlot(other);
                if (!opp) {
                    this._resetMatchKeepSeats();
                    return;
                }
                if (this.pendingNewGame && this.pendingNewGame !== slot) {
                    this.pendingNewGame = null;
                    this._resetMatchKeepSeats();
                    return;
                }
                this.pendingNewGame = slot;
                opp.send(JSON.stringify({ type: 'newGameRequest', from: slot }));
                ws.send(JSON.stringify({ type: 'info', message: '已请求新局，等待对方确认' }));
                break;
            }
            case 'newGameResponse': {
                if (!slot || !this.pendingNewGame) return;
                if (slot === this.pendingNewGame) return;
                if (msg.accept) {
                    this.pendingNewGame = null;
                    this._resetMatchKeepSeats();
                } else {
                    this.pendingNewGame = null;
                    const req = this.room.getPlayerBySlot(this._other(slot));
                    if (req) req.send(JSON.stringify({ type: 'info', message: '对方拒绝了新局请求' }));
                }
                break;
            }
            case 'resign': {
                if (!slot || this.gameOver || !this.matchStarted) return;
                const winner = this._other(slot);
                this._declareWinner(winner, `${slot === 'black' ? '黑方' : '白方'}认输，${winner === 'black' ? '黑方' : '白方'}获胜`);
                break;
            }
            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        if (this.settingsNego) {
            this.settingsNego = null;
            this.phase = 'waiting';
        }
        if (!this.matchStarted) {
            this.slotJoinedAt[slot] = null;
        }
    }
}

module.exports = {
    initRoom(room) {
        room.maxPlayers = 2;
        room.gameLogic = new VersusMinesweeperRoom(room);
    }
};
