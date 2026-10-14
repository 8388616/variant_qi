'use strict';

function copyBoard(src) {
    return src.map(row => row.slice());
}

function boardToString(board) {
    return board.map(row => row.join(',')).join(';');
}

/**
 * 紧凑棋谱初始局面：字符串数组，如 ["B3,3","W15,15","N0,6","H2,2","I4,4","M5,5"]
 * 前缀 B/W/N/H/I/M，后为 row,col（与着手坐标串格式一致，无空格）
 */
function encodeInitialPositionCompact(board, boardSize, opts) {
    const out = [];
    const stride = (opts && Number.isInteger(opts.stride)) ? opts.stride : boardSize;
    const isValid = (opts && typeof opts.isValid === 'function') ? opts.isValid : null;
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < stride; c++) {
            if (isValid && !isValid(r, c)) continue;   // 掩码盘的盘外格不写进棋谱
            const v = board[r][c];
            if (v === 1) out.push(`B${r},${c}`);
            else if (v === 2) out.push(`W${r},${c}`);
            else if (v === 10000) out.push(`N${r},${c}`);
            else if (v === -1) out.push(`H${r},${c}`);
            else if (v === -2) out.push(`I${r},${c}`);
            else if (v === -3) out.push(`M${r},${c}`);
        }
    }
    return out;
}

/**
 * 导出开局盘面（编辑模式的开局；默认空盘）→ 紧凑棋谱格式。
 * 所有支持编辑的棋类统一调用：开局编辑（openingBoard）必须随棋谱导出，
 * 否则导入时开局丢失；也不得导出当前盘面（this.board），否则与 moves 重放冲突。
 * 尺寸推导：boardSize → boardLanes → ROWS → board 行数；openingBoard 缺失时用空盘。
 * @param {object} self room.gameLogic
 * @returns {string[]} 紧凑开局编码（如 ["B3,3","H1,0"]）
 */
function encodeOpeningPositionCompact(self) {
    if (!self) return [];
    let boardSize = Number(self.boardSize);
    if (!Number.isFinite(boardSize) || boardSize <= 0) boardSize = Number(self.boardLanes);
    if (!Number.isFinite(boardSize) || boardSize <= 0) boardSize = Number(self.ROWS);
    if (!Number.isFinite(boardSize) || boardSize <= 0) boardSize = (Array.isArray(self.board) ? self.board.length : 0);
    if (!Number.isFinite(boardSize) || boardSize <= 0) return [];
    const opening = (self.openingBoard && Array.isArray(self.openingBoard) && Array.isArray(self.openingBoard[0]))
        ? self.openingBoard
        : Array(boardSize).fill().map(() => Array(boardSize).fill(0));
    // 非方形棋盘（掩码盘）：按实际行列遍历（只导出有值点；导入时按几何恢复盘形）
    if (opening.length !== boardSize || (opening[0] && opening[0].length !== boardSize)) {
        const isValid = (typeof self.isValidVertex === 'function') ? (r, c) => self.isValidVertex(r, c) : null;
        return encodeInitialPositionCompact(opening, opening.length, {
            stride: opening[0] ? opening[0].length : 0,
            isValid
        });
    }
    return encodeInitialPositionCompact(opening, boardSize);
}

function applyInitialPositionCompact(board, boardSize, initialPosition, opts) {
    if (!initialPosition || !Array.isArray(initialPosition)) return;
    const isValid = (opts && typeof opts.isValid === 'function')
        ? opts.isValid
        : ((r, cc) => r >= 0 && r < boardSize && cc >= 0 && cc < boardSize);
    for (const s of initialPosition) {
        if (typeof s !== 'string' || s.length < 3) continue;
        const prefix = s[0];
        if (prefix !== 'B' && prefix !== 'W' && prefix !== 'N' && prefix !== 'H' && prefix !== 'I' && prefix !== 'M') continue;
        const comma = s.indexOf(',');
        if (comma <= 1) continue;
        const r = parseInt(s.slice(1, comma), 10);
        const c = parseInt(s.slice(comma + 1), 10);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        if (!isValid(r, c)) continue;
        if (prefix === 'B') board[r][c] = 1;
        else if (prefix === 'W') board[r][c] = 2;
        else if (prefix === 'N') board[r][c] = 10000;
        else if (prefix === 'H') board[r][c] = -1;
        else if (prefix === 'I') board[r][c] = -2;
        else if (prefix === 'M') board[r][c] = -3;
    }
}

/**
 * 标准围棋对弈限时：主时间（分）+ 读秒（秒）+ 可超时次数。
 * 双方主时间独立；主时间用完后进入读秒；读秒用尽消耗一次超时并重新读秒；超时次数用尽后再超时判负。
 */
const qiMatchTimeControl = {
    /**
     * @param {object} msg 客户端提交：timed false 或 unlimited true 表示不限时；否则 mainMinutes / byoyomiSeconds / maxTimeouts（整数）
     * @returns {{ ok: true, timed: false } | { ok: true, timed: true, mainMinutes: number, byoyomiSeconds: number, maxTimeouts: number } | { ok: false, error: string }}
     */
    validateProposal(msg) {
        const unlimited = msg.timed === false || msg.unlimited === true || msg.unlimited === '1';
        let result;
        if (unlimited) {
            result = { ok: true, timed: false };
        } else {
            const mainMinutes = parseInt(String(msg.mainMinutes ?? msg.mainMin ?? ''), 10);
            const byoyomiSeconds = parseInt(String(msg.byoyomiSeconds ?? msg.byoSec ?? ''), 10);
            const maxTimeouts = parseInt(String(msg.maxTimeouts ?? msg.periods ?? ''), 10);
            if (!Number.isFinite(mainMinutes) || !Number.isFinite(byoyomiSeconds) || !Number.isFinite(maxTimeouts)) {
                return { ok: false, error: '限时对局请填写主时间、读秒与超时次数。' };
            }
            if (mainMinutes < 1 || mainMinutes > 10080) return { ok: false, error: '主时间须在 1~10080 分钟之间。' };
            if (byoyomiSeconds < 0 || byoyomiSeconds > 7200) return { ok: false, error: '读秒须在 0~7200 秒之间。' };
            if (maxTimeouts < 0 || maxTimeouts > 100) return { ok: false, error: '超时次数须在 0~100 之间。' };
            result = {
                ok: true,
                timed: true,
                mainMinutes,
                byoyomiSeconds,
                maxTimeouts
            };
        }
        if (msg.colorChoice != null && msg.colorChoice !== '') {
            // 执子选项就是座位名（player1 = 先手）；random 表示猜先。
            // 兼容旧颜色写法：black→player1、white→player2（新客户端不再发送）。
            const cc = String(msg.colorChoice);
            if (cc === 'player1' || cc === 'player2' || cc === 'random') {
                result.colorChoice = cc;
            } else if (cc === 'black' || cc === 'hostBlack') {
                result.colorChoice = 'player1';
            } else if (cc === 'white' || cc === 'hostWhite') {
                result.colorChoice = 'player2';
            } else {
                return { ok: false, error: '执子选项无效。' };
            }
        }
        if (msg.handicap != null && msg.handicap !== '') {
            // 让子数：0 = 不让子；上限按棋盘星位再夹一次（validateProposal 拿不到 self，实际夹在提交处）
            const h = parseInt(String(msg.handicap), 10);
            if (!Number.isFinite(h) || h < 0 || h > 9) return { ok: false, error: '让子数须在 0~9 之间。' };
            result.handicap = h;
        }
        return result;
    },

    /**
     * @param {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }} settings
     */
    createClock(settings, nowMs) {
        const t = nowMs != null ? nowMs : Date.now();
        if (!settings || !settings.timed) {
            return {
                timed: false,
                activeSlot: 'player1',
                lastUpdateMs: t,
                player1: { mainMs: 0, inByo: false, byoMs: 0, timeoutsUsed: 0 },
                player2: { mainMs: 0, inByo: false, byoMs: 0, timeoutsUsed: 0 },
                mainMinutes: 0,
                byoyomiSeconds: 0,
                maxTimeouts: 0
            };
        }
        const mainMs = settings.mainMinutes * 60 * 1000;
        return {
            timed: true,
            activeSlot: 'player1',
            lastUpdateMs: t,
            mainMinutes: settings.mainMinutes,
            byoyomiSeconds: settings.byoyomiSeconds,
            maxTimeouts: settings.maxTimeouts,
            player1: { mainMs, inByo: false, byoMs: 0, timeoutsUsed: 0 },
            player2: { mainMs, inByo: false, byoMs: 0, timeoutsUsed: 0 }
        };
    },

    /**
     * 将 elapsed 毫秒扣在 clock[slot]（player1/player2 座位）上；可能触发判负。
     * @returns {{ lostSlot: string|null, winnerSlot: string|null }}
     */
    applyElapsedToSlot(clock, slot, elapsed) {
        const p = clock[slot];
        if (!p) return { lostSlot: null, winnerSlot: null };
        let elapsedLeft = elapsed;
        const byoMsFull = clock.byoyomiSeconds * 1000;
        for (;;) {
            if (elapsedLeft <= 0 && !(p.inByo && p.byoMs <= 0)) break;
            if (!p.inByo) {
                if (p.mainMs > 0) {
                    const take = Math.min(elapsedLeft, p.mainMs);
                    p.mainMs -= take;
                    p.spentMs = (p.spentMs || 0) + take;
                    elapsedLeft -= take;
                    continue;
                }
                p.inByo = true;
                p.mainMs = 0;
                if (clock.byoyomiSeconds <= 0) {
                    return { lostSlot: slot, winnerSlot: slot === 'player1' ? 'player2' : 'player1' };
                }
                p.byoMs = byoMsFull;
                continue;
            }
            if (p.byoMs > 0) {
                const take = Math.min(elapsedLeft, p.byoMs);
                p.byoMs -= take;
                p.spentMs = (p.spentMs || 0) + take;
                elapsedLeft -= take;
            }
            if (p.byoMs <= 0) {
                if (p.timeoutsUsed < clock.maxTimeouts) {
                    p.timeoutsUsed++;
                    p.byoMs = byoMsFull;
                    continue;
                }
                return { lostSlot: slot, winnerSlot: slot === 'player1' ? 'player2' : 'player1' };
            }
            break;
        }
        return { lostSlot: null, winnerSlot: null };
    },

    /**
     * 同步围棋：每「一手」窗口内双方并行扣时；一方提交后该方暂停扣时，另一方继续。
     * @returns {{ lostSlot: string|null, winnerSlot: string|null }}
     */
    drainSyncClock(clock, nowMs) {
        if (!clock || !clock.timed || !clock.syncMode) {
            if (clock) clock.lastUpdateMs = nowMs;
            return { lostSlot: null, winnerSlot: null };
        }
        if (clock.pauseCount) {
            clock.lastUpdateMs = nowMs;
            return { lostSlot: null, winnerSlot: null };
        }
        let elapsed = nowMs - clock.lastUpdateMs;
        if (elapsed < 0) elapsed = 0;
        if (clock.player1Running) {
            const r = this.applyElapsedToSlot(clock, 'player1', elapsed);
            if (r.lostSlot) {
                clock.lastUpdateMs = nowMs;
                return r;
            }
        }
        if (clock.player2Running) {
            const r = this.applyElapsedToSlot(clock, 'player2', elapsed);
            if (r.lostSlot) {
                clock.lastUpdateMs = nowMs;
                return r;
            }
        }
        clock.lastUpdateMs = nowMs;
        return { lostSlot: null, winnerSlot: null };
    },

    /** 同步围棋：一方落子/虚着提交后调用（先 drain 再冻结该方）。 */
    commitSyncSide(clock, slot, nowMs) {
        const t = nowMs != null ? nowMs : Date.now();
        if (!clock || !clock.timed || !clock.syncMode) return { lostSlot: null, winnerSlot: null };
        const r = this.drainSyncClock(clock, t);
        if (r.lostSlot) return r;
        if (slot === 'player1') clock.player1Running = false;
        else if (slot === 'player2') clock.player2Running = false;
        clock.lastUpdateMs = t;
        return { lostSlot: null, winnerSlot: null };
    },

    /** 同步围棋：双方均提交并结算后，下一手窗口开始（读秒方重置到满读秒）。 */
    openSyncMoveWindow(clock, nowMs) {
        if (!clock || !clock.syncMode || !clock.timed) return;
        const t = nowMs != null ? nowMs : Date.now();
        if (clock.byoyomiSeconds > 0) {
            const full = clock.byoyomiSeconds * 1000;
            if (clock.player1 && clock.player1.inByo) clock.player1.byoMs = full;
            if (clock.player2 && clock.player2.inByo) clock.player2.byoMs = full;
        }
        clock.player1Running = true;
        clock.player2Running = true;
        clock.lastUpdateMs = t;
    },

    createSyncClock(settings, nowMs) {
        const c = this.createClock(settings, nowMs);
        if (!c.timed) return c;
        c.syncMode = true;
        c.player1Running = true;
        c.player2Running = true;
        return c;
    },

    /**
     * 消耗 activeSlot 一方自 lastUpdateMs 至 nowMs 的时间；可能触发判负。
     * @returns {{ lostSlot: string|null, winnerSlot: string|null }}
     */
    drain(clock, nowMs) {
        if (!clock || !clock.timed) {
            if (clock) clock.lastUpdateMs = nowMs;
            return { lostSlot: null, winnerSlot: null };
        }
        if (clock.syncMode) {
            return this.drainSyncClock(clock, nowMs);
        }
        if (clock.pauseCount) {
            clock.lastUpdateMs = nowMs;
            return { lostSlot: null, winnerSlot: null };
        }
        let elapsed = nowMs - clock.lastUpdateMs;
        if (elapsed < 0) elapsed = 0;
        const slot = clock.activeSlot;
        const r = this.applyElapsedToSlot(clock, slot, elapsed);
        if (r.lostSlot) {
            clock.lastUpdateMs = nowMs;
            return r;
        }
        clock.lastUpdateMs = nowMs;
        return { lostSlot: null, winnerSlot: null };
    },

    setActiveSlot(clock, slot, nowMs) {
        if (!clock) return;
        if (clock.timed && clock.byoyomiSeconds > 0) {
            const full = clock.byoyomiSeconds * 1000;
            if (clock.player1 && clock.player1.inByo) clock.player1.byoMs = full;
            if (clock.player2 && clock.player2.inByo) clock.player2.byoMs = full;
        }
        clock.activeSlot = slot;
        clock.lastUpdateMs = nowMs != null ? nowMs : Date.now();
    },

    /** 数点等待等：暂停扣时（仍保留 lastUpdateMs） */
    setPaused(clock, paused) {
        if (!clock) return;
        if (paused) {
            clock.pauseCount = (clock.pauseCount || 0) + 1;
        } else {
            clock.pauseCount = Math.max(0, (clock.pauseCount || 0) - 1);
            if (clock.pauseCount === 0 && clock.timed) clock.lastUpdateMs = Date.now();
        }
    },

    /**
     * 客户端展示用快照（当前思考方剩余显示；键为座位 player1/player2）
     * @returns {{ serverNow: number, timed: boolean, activeSlot: string, player1: object, player2: object, ruleLine: string }}
     */
    snapshotForClient(clock) {
        if (!clock) {
            return { serverNow: Date.now(), timed: false, activeSlot: 'player1', player1: null, player2: null, ruleLine: '' };
        }
        const now = Date.now();
        const c = {
            timed: clock.timed,
            activeSlot: clock.activeSlot,
            mainMinutes: clock.mainMinutes,
            byoyomiSeconds: clock.byoyomiSeconds,
            maxTimeouts: clock.maxTimeouts,
            serverNow: now,
            player1: clock.player1 ? { ...clock.player1 } : null,
            player2: clock.player2 ? { ...clock.player2 } : null,
            ruleLine: this.formatRuleLine(clock)
        };
        if (!clock.timed) return c;
        if (clock.syncMode) {
            c.syncMode = true;
            c.player1Running = !!clock.player1Running;
            c.player2Running = !!clock.player2Running;
            const b = clock.player1;
            const w = clock.player2;
            c.display = {
                syncMode: true,
                player1Live: c.player1Running,
                player2Live: c.player2Running,
                player1CountdownMs: b.inByo ? b.byoMs : b.mainMs,
                player2CountdownMs: w.inByo ? w.byoMs : w.mainMs
            };
            return c;
        }
        const slot = clock.activeSlot;
        const p = clock[slot];
        let displayMs = 0;
        if (!p.inByo) displayMs = p.mainMs;
        else displayMs = p.byoMs;
        c.display = {
            slot,
            countdownMs: displayMs,
            timeoutsRemaining: Math.max(0, clock.maxTimeouts - p.timeoutsUsed),
            timeoutsTotal: clock.maxTimeouts
        };
        return c;
    },

    formatRuleLine(clock) {
        if (!clock || !clock.timed) return '本局不限时';
        const m = Math.max(0, clock.mainMinutes | 0);
        const h = Math.floor(m / 60);
        const mm = m % 60;
        const head = h > 0 ? `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00` : `${String(mm).padStart(2, '0')}:00`;
        return `${head} ${clock.byoyomiSeconds}秒${clock.maxTimeouts}次`;
    },

    formatCountdown(ms) {
        if (!Number.isFinite(ms) || ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0)
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
};

function assignBlackWhiteSlot(room, requestedSlot) {
    if (requestedSlot === 'player1' && !room.getPlayerBySlot('player1')) return 'player1';
    if (requestedSlot === 'player2' && !room.getPlayerBySlot('player2')) return 'player2';
    return null;
}

/** 房主执子选项 → 房主最终执黑/白 */
function resolveHostTargetColor(colorChoice) {
    if (colorChoice === 'hostWhite') return 'player2';
    if (colorChoice === 'random') return Math.random() < 0.5 ? 'player1' : 'player2';
    return 'player1';
}

/**
 * 按房主执子选项交换两个座位（双方均已入座时）。
 * @returns {'player1'|'player2'|null} 房主最终座位
 */
function applyHostColorChoice(room, hostWs, colorChoice) {
    if (!hostWs || !room) return null;
    const hostSlot = room.getSlotByWs(hostWs);
    if (!hostSlot) return null;
    const target = resolveHostTargetColor(colorChoice);
    if (hostSlot === target) return target;
    if (typeof room.swapSlots === 'function')
        room.swapSlots('player1', 'player2');
    else {
        const a = room.slotOccupancy.get('player1') || null;
        const b = room.slotOccupancy.get('player2') || null;
        room.slotOccupancy.delete('player1');
        room.slotOccupancy.delete('player2');
        if (a) {
            room.players.set(a, 'player2');
            room.slotOccupancy.set('player2', a);
        }
        if (b) {
            room.players.set(b, 'player1');
            room.slotOccupancy.set('player1', b);
        }
    }
    return target;
}

/**
 * 座位 → 该棋种执方名（黑方/白方/红方…）。棋种实现 getChatSideLabel 时优先用它，
 * 否则按默认约定 player1=黑方、player2=白方。
 */
function qiSideLabelOfSlot(self, slot) {
    if (!slot) return '';
    if (self && typeof self.getChatSideLabel === 'function') {
        try {
            const custom = self.getChatSideLabel(slot);
            if (custom) return String(custom);
        } catch (_) { /* ignore */ }
    }
    if (slot === 'player1') return '黑方';
    if (slot === 'player2') return '白方';
    return String(slot);
}

/** 胜方座位 → 「黑胜/白胜/红胜…」（导出棋谱用实际行棋方） */
function qiWinnerResultText(self, slot) {
    const label = qiSideLabelOfSlot(self, slot);
    return label.replace(/方$/, '') + '胜';
}

/** 座位 → 终局文案（和棋 / 按本棋种执方名的「X胜」）。棋种内部一律用座位，只在这里变文案 */
function qiResultTextOfSeat(self, seat) {
    if (seat === 'draw') return '和棋';
    if (seat === 'player1' || seat === 'player2') return qiWinnerResultText(self, seat);
    return '';
}

/**
 * 棋谱里的终局文案 → 座位（'player1'/'player2'/'draw'）。认不出来返回 null。
 *
 * 站内的约定是「内部一律用座位、颜色只出现在文案里」，所以颜色→座位的换算只在这里做一次：
 *   1. 含「和」按和棋；
 *   2. 取「胜」字前、最后一个逗号/顿号/冒号之后那一段里的颜色字
 *      （「红方超时，绿胜」→绿、「黑 40 : 白 24，黑胜」→黑、「白方吃掉对方4枚获胜」→白），
 *      段里没颜色就退回整段里最靠近「胜」的那个颜色字；
 *   3. 只有「判负」时取另一方（两方棋种）；
 *   4. 颜色再按本棋种声明的执方名定位座位（四色围棋「黑蓝胜」→player1）。
 */
/* ---------- 让子（围棋类） ---------- */

/**
 * 星位（与客户端 room.js 的 getStarPoints 同口径）：角上偏移 2（≤11 路）或 3，天元（≥9 且奇数路），
 * 边星（≥15 且奇数路）。返回 [row, col] 列表，row 0 = 棋盘最下（站内约定），顺序＝让子取用顺序。
 */
function qiStarPoints(boardSize) {
    const n = Number(boardSize);
    if (!Number.isInteger(n) || n < 5) return [];
    const o = n <= 11 ? 2 : 3;
    const S = n - 1;
    const out = [];
    const push = (r, c) => {
        if (r < 0 || c < 0 || r >= n || c >= n) return;
        if (out.some(([rr, cc]) => rr === r && cc === c)) return;
        out.push([r, c]);
    };
    push(o, S - o);          // 右下
    push(S - o, o);          // 左上
    push(o, o);              // 左下
    push(S - o, S - o);      // 右上
    if (n >= 9 && n % 2 === 1) { const c0 = (n - 1) / 2; push(c0, c0); }              // 天元
    if (n >= 15 && n % 2 === 1) {
        const c0 = (n - 1) / 2;
        push(c0, o); push(c0, S - o); push(o, c0); push(S - o, c0);                   // 边星
    }
    return out;
}

/**
 * 让 n 子的摆法（用户定；被让子方执白、摆的是白子）：
 *   1 右下星位 / 2 右下+左上 / 3 右下+左上+左下 / 4 四角 / 5 四角+天元 /
 *   6 四角+左右边星（＝左右各三个星位）/ 7 6+天元 / 8 除天元外的星位 / 9 全部星位
 * 该路数摆不下（没有天元/边星）返回 null。
 */
function qiHandicapStones(boardSize, n) {
    const count = Number(n);
    const size = Number(boardSize);
    if (!Number.isInteger(count) || count <= 0 || count > 9) return null;
    const stars = qiStarPoints(size);
    if (stars.length === 0) return null;
    const S = size - 1;
    const o = size <= 11 ? 2 : 3;
    const has = (r, c) => stars.some(([rr, cc]) => rr === r && cc === c);
    /** 摆法里可能重名（小路数上几个星位是同一格）：去重后不足 n 颗就算这个路数摆不下 */
    const uniq = (pts) => {
        const out = [];
        for (const [r, c] of pts) if (!out.some(([rr, cc]) => rr === r && cc === c)) out.push([r, c]);
        return out;
    };
    const done = (pts) => {
        const u = uniq(pts);
        return u.length === count ? u : null;
    };
    const RB = [o, S - o], LT = [S - o, o], LB = [o, o], RT = [S - o, S - o];
    const corners = [RB, LT, LB, RT];
    if (!corners.every(([r, c]) => has(r, c))) return null;
    const odd = size % 2 === 1;
    const c0 = odd ? (size - 1) / 2 : 0;
    const CEN = [c0, c0];
    const LEFTMID = [c0, o], RIGHTMID = [c0, S - o], BOTMID = [o, c0], TOPMID = [S - o, c0];
    const hasCenter = odd && has(CEN[0], CEN[1]);
    const hasLeftRight = odd && has(LEFTMID[0], LEFTMID[1]) && has(RIGHTMID[0], RIGHTMID[1]);
    const hasAllSides = hasLeftRight && has(BOTMID[0], BOTMID[1]) && has(TOPMID[0], TOPMID[1]);
    switch (count) {
        case 1: return done([RB]);
        case 2: return done([RB, LT]);
        case 3: return done([RB, LT, LB]);
        case 4: return done(corners);
        case 5: return hasCenter ? done(corners.concat([CEN])) : null;
        case 6: return hasLeftRight ? done(corners.concat([LEFTMID, RIGHTMID])) : null;
        case 7: return (hasLeftRight && hasCenter) ? done(corners.concat([LEFTMID, RIGHTMID, CEN])) : null;
        case 8: return hasAllSides ? done(corners.concat([LEFTMID, RIGHTMID, BOTMID, TOPMID])) : null;
        case 9: return (hasAllSides && hasCenter)
            ? done(corners.concat([LEFTMID, RIGHTMID, BOTMID, TOPMID, CEN])) : null;
        default: return null;
    }
}

/** 该路数能选的最大让子数（0 = 这个棋盘给不了让子选项） */
function qiMaxHandicap(boardSize) {
    let max = 0;
    for (let n = 1; n <= 9; n++) if (qiHandicapStones(boardSize, n)) max = n;
    return max;
}

/** 棋种当前路数（各棋种字段不一：boardSize / BOARD_SIZE / boardLength…） */
function qiBoardSizeOf(self) {
    if (!self) return 0;
    const cand = [self.boardSize, self.BOARD_SIZE, self.boardLength, self.roadCount, self.gridW];
    for (const v of cand) if (Number.isInteger(v) && v > 0) return v;
    return 0;
}

/**
 * 让子后的开局盘：在棋种当前的开局盘（重置后多为空盘；先一各二等有标准开局的就在其基础上加）上
 * 摆 n 颗白子（星位已有子的跳过）。摆不出来（非二维盘/星位不够）返回 null。
 */
function qiHandicapBoard(self, n) {
    const size = qiBoardSizeOf(self);
    if (!size) return null;
    const base = (self && Array.isArray(self.openingBoard) && Array.isArray(self.openingBoard[0]))
        ? self.openingBoard
        : (self && Array.isArray(self.board) && Array.isArray(self.board[0]) ? self.board : null);
    if (!base || base.length !== size) return null;
    const stones = qiHandicapStones(size, n);
    if (!stones) return null;
    const out = base.map((row) => row.slice());
    let placed = 0;
    for (const [r, c] of stones) {
        if (out[r] && out[r][c] === 0) { out[r][c] = 2; placed++; }   // 2 = 白子
    }
    return placed > 0 ? out : null;
}

/**
 * 对局开始时的让子处理：按请求数记到棋种上（按路数星位夹一次）并摆子。
 * 限时协商与人机开局都走这里。返回实际生效的让子数。
 */
function qiApplyHandicapFromRequest(self, want) {
    const maxH = qiMaxHandicap(qiBoardSizeOf(self));
    const n = Math.floor(Number(want) || 0);
    self.handicap = maxH > 0 ? Math.max(0, Math.min(n, maxH)) : 0;
    if (self.handicap > 0) qiApplyHandicap(self);
    return self.handicap;
}

/** 把让子摆上去（对局开始时、每次重置后都要调）：成功返回 true */
function qiApplyHandicap(self) {
    const n = Number(self && self.handicap) || 0;
    if (n <= 0) return false;
    const board = qiHandicapBoard(self, n);
    if (!board) return false;
    try {
        return qiProtocol.applyOpeningBoard(self, board);
    } catch (_) {
        return false;
    }
}

function qiSeatOfResultText(self, resultText) {
    if (typeof resultText !== 'string') return null;
    const text = resultText.trim();
    if (!text) return null;
    const SEPARATORS = ['，', ',', '、', '：', ':'];
    const lastSeparator = (s) => {
        let at = -1;
        for (const sep of SEPARATORS) at = Math.max(at, s.lastIndexOf(sep));
        return at;
    };
    const colorIn = (s, fromEnd) => {
        const hits = s.match(/[黑白红绿蓝]/g);
        if (!hits || hits.length === 0) return null;
        return fromEnd ? hits[hits.length - 1] : hits[0];
    };
    const seatOfColor = (color) => {
        if (!color) return null;
        if (qiSideLabelOfSlot(self, 'player1').includes(color)) return 'player1';
        if (qiSideLabelOfSlot(self, 'player2').includes(color)) return 'player2';
        return null;
    };
    /** 「胜」「判负」之前那一段的（最后一个分隔符之后的）颜色 */
    const colorBefore = (idx) => {
        const head = text.slice(0, idx);
        const cut = lastSeparator(head);
        const segment = cut >= 0 ? head.slice(cut + 1) : head;
        return colorIn(segment, false) || colorIn(head, true);
    };
    if (text.includes('和')) return 'draw';
    const winIdx = text.lastIndexOf('胜');
    if (winIdx >= 0) return seatOfColor(colorBefore(winIdx));
    const loseIdx = text.lastIndexOf('判负');
    if (loseIdx >= 0) {
        const loser = seatOfColor(colorBefore(loseIdx));
        if (loser === 'player1') return 'player2';
        if (loser === 'player2') return 'player1';
    }
    return null;
}

function encodeCompactTimeControl(tcSettings) {
    if (!tcSettings || tcSettings.timed !== true) return null;
    const mainMinutes = parseInt(String(tcSettings.mainMinutes ?? 0), 10) || 0;
    const byoyomiSeconds = parseInt(String(tcSettings.byoyomiSeconds ?? 0), 10) || 0;
    const maxTimeouts = parseInt(String(tcSettings.maxTimeouts ?? 0), 10) || 0;
    return `S${mainMinutes},${byoyomiSeconds},${maxTimeouts}`;
}

function decodeCompactTimeControl(timeControl) {
    if (timeControl === null) return { enabled: false };
    if (typeof timeControl !== 'string') return null;
    const m = /^S(\d+),(\d+),(\d+)$/.exec(timeControl.trim());
    if (!m) return null;
    return {
        enabled: true,
        mainMinutes: parseInt(m[1], 10) || 0,
        byoyomiSeconds: parseInt(m[2], 10) || 0,
        maxTimeouts: parseInt(m[3], 10) || 0
    };
}

function normalizeQiRecordForExport(self, record) {
    if (!record || typeof record !== 'object') return record;
    const out = { ...record };
    if (typeof out.timeControl === 'string') {
        const parsed = decodeCompactTimeControl(out.timeControl);
        out.timeControl = parsed && parsed.enabled === true
            ? encodeCompactTimeControl({
                timed: true,
                mainMinutes: parsed.mainMinutes,
                byoyomiSeconds: parsed.byoyomiSeconds,
                maxTimeouts: parsed.maxTimeouts
            })
            : null;
    } 
    else if (out.timeControl === null)
        out.timeControl = null;
    else
        out.timeControl = encodeCompactTimeControl(self && self.tcSettings ? self.tcSettings : null);
    if (self && self.gameOver) {
        // 内部一律是座位 → 导出时按棋种自己声明的执方名变成「黑胜/白胜/红胜…」
        if (typeof self.recordResultText === 'string' && self.recordResultText.length > 0) {
            out.result = self.recordResultText;
        } else if (self.winner === 'draw') {
            out.result = '和棋';
        } else if (self.winner === 'player1' || self.winner === 'player2') {
            out.result = qiWinnerResultText(self, self.winner);
        }
    }
    return out;
}

/**
 * 导入棋谱的规范化。棋谱里的终局是文案（「黑胜」「红方超时，绿胜」…），
 * 这里按**本棋种声明的执方名**折成座位后交给棋种；棋种内部只认座位。
 */
function normalizeQiRecordForImport(self, data) {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    if (Object.prototype.hasOwnProperty.call(out, 'timeControl')) {
        out.timeControl = decodeCompactTimeControl(out.timeControl);
    } else {
        out.timeControl = null;
    }
    const rawText = typeof out.resultText === 'string' && out.resultText.trim() !== '' ? out.resultText : null;
    const rawResult = typeof out.result === 'string' && out.result.trim() !== '' ? out.result.trim() : null;
    const seatLike = rawResult === 'player1' || rawResult === 'player2' || rawResult === 'draw';
    const text = rawText || (seatLike ? null : rawResult);
    if (text != null) {
        out.resultText = text;                            // 文案留着给界面显示
        out.result = qiSeatOfResultText(self, text);      // 座位给棋种用（棋种内部只认座位）
    } else {
        out.resultText = rawText;
        out.result = seatLike ? rawResult : null;         // 记录里本来就是座位：原样保留
    }
    // 「空棋谱」= 没有着法、也没有胜负记录（相当于只是导入了开局盘面/一块空盘）：**视为开局前**，
    // 与「刚编辑过棋盘」完全同态。棋种侧的 importRecord 都是看到 data.timeControl 才置
    // matchStarted/tcSettings 的，所以这里把 timeControl 去掉即可 —— 否则状态里 matchStarted
    // 与 matchTime.settings 都是「已开局」，而房间里一个人也没有，客户端会按
    // 「对局已开始但双方已退出」显示（时间框写「黑(已退出)」、棋盘也不许再编辑）。
    const hasMoves = Array.isArray(out.moves) && out.moves.some((m) => (typeof m === 'string' && m.trim() !== '')
        || (m && typeof m === 'object' && typeof m.type === 'string'));
    const hasResult = out.result != null
        || (out.resultText != null && String(out.resultText).trim() !== '');
    if (!hasMoves && !hasResult) {
        out.timeControl = null;                           // 限时也当作没协商过：回到开局前，让双方重新确认
    }
    return out;
}

/**
 * 导入棋谱时采纳记录里的贴目（读 `data.komi`，存到 `self.importedKomi`）。
 * 棋种在 `importRecord` 末尾（回放完、广播前）调用即可；新局/重置时把 `this.importedKomi` 清成
 * `undefined`（写在各棋种的 resetToEmpty / resetGame 里）就回落到各棋种自己的默认贴目。
 * 继续围棋（continuous-weiqi）此前已有此做法（`this.komi`），这里收归公共。
 */
function qiApplyRecordKomi(self, data) {
    if (!self || !data || data.komi == null) return;
    const k = Number(data.komi);
    if (Number.isFinite(k) && Math.abs(k) <= 100) self.importedKomi = k;
}

/**
 * 棋种报贴目统一走它：导入过（`this.importedKomi` 有值）就用记录里的贴目，否则用 `fallback`
 * （各棋种自己的默认：常量、`komiForSize(this.boardSize)`、`this._komi()` 等，原样传进来）。
 */
function qiEffectiveKomi(self, fallback) {
    if (self && self.importedKomi != null && Number.isFinite(Number(self.importedKomi))) return Number(self.importedKomi);
    return typeof fallback === 'function' ? fallback() : fallback;
}

/** 方格五子棋：连五判定与棋盘是否已满（与前端 qi.js 中同名逻辑保持一致） */
const squareWuziqiRules = {
    checkNInRow(board, row, col, colorVal, boardSize, n) {
        if (board[row][col] !== colorVal) return false;
        const need = Math.max(1, n | 0);
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < need; step++) {
                const nr = row + dx * step;
                const nc = col + dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < need; step++) {
                const nr = row - dx * step;
                const nc = col - dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= need) return true;
        }
        return false;
    },

    checkFiveInRow(board, row, col, colorVal, boardSize) {
        return this.checkNInRow(board, row, col, colorVal, boardSize, 5);
    },

    isBoardFull(board, boardSize) {
        for (let r = 0; r < boardSize; r++)
            for (let c = 0; c < boardSize; c++)
                if (board[r][c] === 0) return false;
        return true;
    }
};

class QiTwoPlayerRoomBase {
    constructor(room) {
        this.room = room;
    }

    copyBoard(src) {
        return copyBoard(src);
    }

    boardToString(board) {
        return boardToString(board);
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    assignSlot(ws, requestedSlot) {
        return assignBlackWhiteSlot(this.room, requestedSlot);
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getState() }));
    }
}

/**
 * 共享 WebSocket 协议片段：选色、导入导出、新局/认输/和棋、
 * 方格围棋 move/pass/requestUndo/undoResponse（weiqiMove 等）、
 * 五子棋式悔棋（historyBoards + moveHistory 同步回退）等。
 * 各 Room 在 handleMessage 里按需调用，减少 switch 重复。
 */
const qiProtocol = {
    selectColor(self, ws, msg, opts = {}) {
        const occupiedMsg = opts.colorOccupiedMsg ?? '该颜色已被占用。';
        const slot = self.room.getSlotByWs(ws);
        const room = self.room;
        if (slot) return;
        const newSlot = self.assignSlot(ws, msg.color);
        if (newSlot) {
            room.setPlayerSlot(ws, newSlot);
            if (typeof self.afterColorAssigned === 'function') self.afterColorAssigned(ws, newSlot);
            const isHost = !!(self.hostWs && self.hostWs === ws);
            ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot, isHost }));
            self.sendState(ws);
            room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
        } else {
            ws.send(JSON.stringify({ type: 'error', message: occupiedMsg }));
        }
    },

    /**
     * 棋盘蒙版落座：开局前由服务端分配空位（忽略客户端指定颜色，避免抢座误报）；
     * 对局中途需指定 color 续坐空缺方；对局已结束后不允许落座（观战）。
     */
    takeSeat(self, ws, msg, opts = {}) {
        const occupiedMsg = opts.colorOccupiedMsg ?? '该座位已被占用。';
        const fullMsg = opts.seatsFullMsg ?? '双方均已落座。';
        const slot = self.room.getSlotByWs(ws);
        if (slot) return;
        if (self.gameOver) return;

        const seatFree = (color) => {
            if (self.computerSlot && self.computerSlot === color) return false;
            return !self.room.getPlayerBySlot(color);
        };

        let color = null;
        if (self.matchStarted) {
            color = msg && (msg.color === 'player1' || msg.color === 'player2') ? msg.color : null;
            if (!color) {
                ws.send(JSON.stringify({ type: 'error', message: '请选择继续执黑或执白。' }));
                return;
            }
            if (!seatFree(color)) {
                ws.send(JSON.stringify({ type: 'error', message: occupiedMsg }));
                return;
            }
        } else {
            // 开局前不采纳客户端 color，按空位依次分配，避免两人同时点落座都抢 player1
            if (seatFree('player1')) color = 'player1';
            else if (seatFree('player2')) color = 'player2';
            else {
                // 座位已满：静默忽略，不弹错误
                return;
            }
        }

        this.selectColor(self, ws, { color }, Object.assign({}, opts, {
            colorOccupiedMsg: self.matchStarted ? occupiedMsg : fullMsg
        }));
    },

    exportRecord(self, ws) {
        const raw = self.exportRecord(ws);
        ws.send(JSON.stringify({ type: 'gameRecord', data: normalizeQiRecordForExport(self, raw) }));
    },

    importRecord(self, ws, msg, opts = {}) {
        const blockedMsg = opts.importBlockedMsg ?? '已有玩家入座，无法导入棋谱。';
        if (self.room.getPlayerBySlot('player1') || self.room.getPlayerBySlot('player2')) {
            ws.send(JSON.stringify({ type: 'error', message: blockedMsg }));
            return;
        }
        self.importRecord(normalizeQiRecordForImport(self, msg.data), ws);
    },

    /** 观战且无人入座时清空房间（需实现 resetToEmpty） */
    resetRoomToEmpty(self, ws) {
        if (self.room.getPlayerBySlot('player1') || self.room.getPlayerBySlot('player2')) return;
        self.resetToEmpty();
        self.broadcast({ type: 'roomReset', ...self.getState() });
    },

    /**
     * 开局前离座：转为观战，并取消未完成的对局设置协商。
     * 对局已开始后不可离座（应认输/断线等）。
     */
    leaveSeat(self, ws) {
        const room = self.room;
        const slot = room.getSlotByWs(ws);
        if (self.matchStarted) {
            try {
                ws.send(JSON.stringify({ type: 'error', message: '对局已开始，无法离座。' }));
            } catch (_) { /* ignore */ }
            return;
        }
        if (!slot) {
            try {
                ws.send(JSON.stringify({
                    type: 'seatLeft',
                    slot: null,
                    ...(typeof self.getState === 'function' ? self.getState() : {})
                }));
            } catch (_) { /* ignore */ }
            return;
        }

        room.slotOccupancy.delete(slot);
        room.players.delete(ws);
        room.observers.add(ws);

        if (self.slotJoinedAt && Object.prototype.hasOwnProperty.call(self.slotJoinedAt, slot)) {
            self.slotJoinedAt[slot] = null;
        }
        if (self.hostWs === ws) {
            const other = slot === 'player1'
                ? room.getPlayerBySlot('player2')
                : room.getPlayerBySlot('player1');
            self.hostWs = other || null;
        }
        if (self.tcNego) self.tcNego = null;

        room.broadcast({ type: 'timeControlReset', reason: 'leaveSeat' });
        room.broadcast({ type: 'slotReleased', slot });
        const state = typeof self.getState === 'function' ? self.getState() : {};
        const hostSlot = self.hostWs ? room.getSlotByWs(self.hostWs) : null;
        try {
            ws.send(JSON.stringify({ type: 'seatLeft', slot, hostSlot, ...state }));
        } catch (_) { /* ignore */ }
        room.broadcast({ type: 'gameState', hostSlot, ...state }, ws);
    },

    resign(self, ws, slot, opts = {}) {
        if (!slot || self.gameOver) return;
        self.gameOver = true;
        self.winner = slot === 'player1' ? 'player2' : 'player1';
        if (typeof self.onResignResolved === 'function') self.onResignResolved(slot, self.winner);
        if (typeof opts.broadcastPerClient === 'function') {
            opts.broadcastPerClient('resign', { player: slot, winner: self.winner });
        } else {
            self.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: self.winner, ...self.getState() });
        }
    },

    requestNewGame(self, ws, slot) {
        const room = self.room;
        if (!room.getPlayerBySlot('player1') && !room.getPlayerBySlot('player2')) {
            self.resetGame();
            return;
        }
        if (!slot) return;
        const newGameOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
        if (!newGameOpponent) {
            self.resetGame();
        } else {
            self.pendingNewGame = ws;
            newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
        }
    },

    newGameResponse(self, ws, msg, opts = {}) {
        const denyMsg = opts.newGameDeniedMsg ?? '对方拒绝开始新局。';
        if (self.pendingNewGame && msg.accept) {
            self.resetGame();
        } else if (self.pendingNewGame && !msg.accept) {
            self.pendingNewGame.send(JSON.stringify({ type: 'error', message: denyMsg }));
        }
        self.pendingNewGame = null;
    },

    requestDraw(self, ws, slot, opts = {}) {
        if (!slot || self.gameOver) return;
        const room = self.room;
        const drawOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
        if (!drawOpponent) {
            self.gameOver = true;
            self.winner = 'draw';
            if (typeof self.onDrawResolved === 'function') self.onDrawResolved();
            if (typeof opts.broadcastPerClient === 'function') {
                opts.broadcastPerClient('drawAgreed');
            } else {
                self.broadcast({ type: 'broadcast', action: 'drawAgreed', ...self.getState() });
            }
        } else {
            self.pendingDraw = ws;
            drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
        }
    },

    drawResponse(self, ws, msg, opts = {}) {
        if (self.pendingDraw && msg.accept) {
            self.gameOver = true;
            self.winner = 'draw';
            if (typeof self.onDrawResolved === 'function') self.onDrawResolved();
            if (typeof opts.broadcastPerClient === 'function') {
                opts.broadcastPerClient('drawAgreed');
            } else {
                self.broadcast({ type: 'broadcast', action: 'drawAgreed', ...self.getState() });
            }
        } else if (self.pendingDraw && !msg.accept) {
            self.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
        }
        self.pendingDraw = null;
    },

    requestEnd(self, ws, slot) {
        if (!slot) return;
        const room = self.room;
        const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
        if (!endOpponent) {
            self.startScoreCounting(ws, ws);
        } else {
            self.pendingEnd = { requester: ws, opponent: endOpponent };
            endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
        }
    },

    endResponse(self, ws, msg, opts = {}) {
        const denyMsg = opts.endDeniedMsg ?? '对方拒绝数点。';
        if (self.pendingEnd && msg.accept) {
            self.startScoreCounting(self.pendingEnd.requester, self.pendingEnd.opponent);
        } else if (self.pendingEnd && !msg.accept) {
            self.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: denyMsg }));
        }
        self.pendingEnd = null;
    },

    /**
     * 五子棋类悔棋（统一协议）：requestUndo → undoRequest → undoResponse → undoAccept。
     * historyBoards 存落子前快照，悔棋时 pop 恢复；currentPlayer 可为 1/2 或 'black'/'white'。
     * 可选钩子（不提供则按通用五子规则）：
     *   self.undoStepsFor(slot, isMyTurn) —— 自定义悔棋步数（默认轮到自己悔 2 步、否则 1 步）
     *   self.performUndoSteps(steps) —— 自定义恢复（需自行广播 undoAccept；默认 pop 棋盘/记录并翻转回合）
     */
    undoWuziqiHistory(self, ws, msg, slot) {
        if (!slot || self.gameOver) return;
        const room = self.room;
        const numeric = typeof self.currentPlayer === 'number';
        const myColor = numeric ? (slot === 'player1' ? 1 : 2) : (slot === 'player1' ? 'player1' : 'player2');
        const isMyTurn = self.currentPlayer === myColor;
        const steps = typeof self.undoStepsFor === 'function'
            ? self.undoStepsFor(slot, isMyTurn)
            : (isMyTurn ? 2 : 1);
        if (self.historyBoards.length < steps) {
            ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
            return;
        }
        const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) {
            qiProtocol.performWuziqiUndo(self, steps);
        } else {
            self.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    },

    undoResponseWuziqiHistory(self, ws, msg) {
        if (self.pendingUndo && msg.accept) {
            const steps = self.pendingUndo.steps;
            if (self.historyBoards.length >= steps) {
                qiProtocol.performWuziqiUndo(self, steps);
            }
        } else if (self.pendingUndo && !msg.accept) {
            self.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
        }
        self.pendingUndo = null;
    },

    /**
     * 五子棋类悔棋的实际恢复与广播。游戏自定义恢复时实现 performUndoSteps(steps)，
     * 需自行翻转回合并广播 undoAccept；否则按通用规则恢复并广播。
     */
    performWuziqiUndo(self, steps) {
        if (typeof self.performUndoSteps === 'function') {
            self.performUndoSteps(steps);
            return;
        }
        for (let i = 0; i < steps; i++) {
            self.board = self.copyBoard(self.historyBoards.pop());
            self.moveHistory.pop();
            if (Array.isArray(self.moveCoords) && self.moveCoords.length > 0) self.moveCoords.pop();
        }
        let newPlayer = self.currentPlayer;
        for (let i = 0; i < steps; i++) {
            newPlayer = newPlayer === 1 ? 2 : (newPlayer === 2 ? 1 : (newPlayer === 'player1' ? 'player2' : 'player1'));
        }
        self.currentPlayer = newPlayer;
        self.lastMoveMarkers = [];
        self.broadcast({ type: 'broadcast', action: 'undoAccept', ...self.getState() });
    },

    /**
     * 开新局/重开：释放房内全部座位，并把退座连接登记为观战者。
     *
     * 三步一个都不能少（顺序无所谓，缺 observers.add 会静默丢广播）：
     *   1. players / slotOccupancy 删掉座位（否则 getSlotByWs 仍认为在座：改路数会被静默忽略）
     *   2. observers.add(连接)——room.broadcast() 只遍历 players + observers，
     *      漏了这步这条连接两边都不在，之后所有广播（boardSizeChanged / gameState / 对手落子…）
     *      都收不到，客户端要刷新页面才恢复
     *   3. 逐个直接发 slotReleased（这是直发，不受上面影响）
     *
     * 调用方自己决定前后广播什么（newGameStarted / roomReset / gameState…）：退座后连接已是
     * 观战者，广播放在退座前或后都能收到。返回 [{ client, slot }] 供调用方使用。
     */
    releaseAllSeats(self) {
        const room = self.room;
        const released = [];
        for (const [client, slot] of [...room.players.entries()]) {
            room.players.delete(client);
            room.slotOccupancy.delete(slot);
            room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
            released.push({ client, slot });
        }
        return released;
    },

    /** 只有多人落座时锁定棋类、子棋类和路数；单人模式只统计真人座位。 */
    canChangeRoomSettings(self) {
        const room = self && self.room;
        if (!room) return false;
        if (typeof room.getSeatedCount === 'function') return room.getSeatedCount() < 2;
        const count = room.players.size + (self.computerSlot && !room.getPlayerBySlot(self.computerSlot) ? 1 : 0);
        return count < 2;
    },

    /** 已通过参数和人数校验后，清理上一局；各棋种随后应用新尺寸/子棋类。 */
    prepareRoomSettingsChange(self) {
        self.openingBoard = undefined;
        if (typeof self._releaseAiEngine === 'function') self._releaseAiEngine();
        if (typeof self.resetToEmpty === 'function') self.resetToEmpty();
        else if (typeof self.resetGame === 'function') self.resetGame();
        // reset 的公共包装会保存旧尺寸开局盘；随后重建时必须重新生成。
        self.openingBoard = undefined;
    },

    /** parseInt size，调用 setBoardSize(n, ws)；保留旧方法名兼容棋种。 */
    setBoardSizeObserverOnly(self, ws, msg, slot) {
        if (!this.canChangeRoomSettings(self)) return;
        const n = parseInt(String(msg.size ?? ''), 10);
        self.setBoardSize(n, ws);
    },

    /**
     * 围棋等与其它棋种采用同一落座人数限制。
     */
    setBoardSizeWeiqiObserver(self, ws, msg, slot) {
        if (this.canChangeRoomSettings(self)) {
            const n = parseInt(String(msg.size ?? ''), 10);
            self.setBoardSize(n, ws);
        }
    },

    /**
     * 开局后禁止编辑棋盘（含绕过 UI 直接发 editBoard）。
     * 限时已确认 / matchStarted / 已有着手 / 对局结束均锁定。
     * historyBoards 仅在长度 > 1 时锁定（扫雷等会保留 length===1 的开局快照）。
     */
    isBoardEditLocked(self) {
        if (!self) return true;
        if (self.gameOver) return true;
        if (self.matchStarted) return true;
        if (self.tcSettings) return true;
        if (Array.isArray(self.moveHistory) && self.moveHistory.length > 0) return true;
        if (Array.isArray(self.moveCoords) && self.moveCoords.length > 0) return true;
        if (Array.isArray(self.historyBoards) && self.historyBoards.length > 1) return true;
        return false;
    },

    /**
     * 开局前编辑棋盘（空/黑/白）。
     * 默认校验二维 board[r][c] ∈ {0,1,2}；异形可设 self.editBoardMode：
     * - 'flat'：一维 board[i]，长度 self.vertexCount || board.length
     * - 'triangle' / 'jagged'：锯齿二维盘；行长默认 r+1，可用 self.editBoardRowLength(r) 覆盖（如扭曲空间 2r+1）
     * - 'maskedGrid'：扭棱等，board[r][c] 为 0/1/2 或无效点 -1（须与 isValidVertex 一致）
     * - 自定义：self.applyEditBoard(ws, msg) 优先
     * 成功后写入 openingBoard 并广播 editBoardAccepted。
     */
    /**
     * 把「开局盘」应用成当前局面（编辑盘面、让子共用）：写入 board 与 openingBoard、
     * 清空着手历史、重置胜负，并广播 editBoardAccepted（客户端据此重建开局与盘面）。
     */
    applyOpeningBoard(self, board, mode) {
        if (!self || !Array.isArray(board) || !Array.isArray(board[0])) return false;
        self.board = typeof self.copyBoard === 'function' ? self.copyBoard(board) : copyBoard(board);
        // 先按「player1 先手」的默认约定摆好行棋方，再让棋种自己覆盖
        // （白先棋种如结子棋/五道棋的 afterEditBoard 会把 currentPlayer 设成白方，不能被这里再改回去）
        self.currentPlayer = 1;
        if (typeof self.afterEditBoard === 'function') self.afterEditBoard();

        self.openingBoard = typeof self.copyBoard === 'function'
            ? self.copyBoard(self.board)
            : (mode === 'flat' ? self.board.slice() : (
                Array.isArray(self.board[0]) ? self.board.map((row) => row.slice()) : self.board.slice()
            ));
        if (Array.isArray(self.historyBoards)) self.historyBoards = [];
        if (self.historyBoardSet && typeof self.historyBoardSet.clear === 'function') {
            self.historyBoardSet.clear();
            // 棋种把「局面」定义得比盘面宽（含雷/隐身分布/棋子年龄/手数等）时，用它的 key 种这一手。
            // 取 key 失败（有的棋种 boardToString 还要第二参数）不该影响摆子本身，吞掉即可。
            try {
                if (typeof self.superKoSeedKey === 'function') {
                    self.historyBoardSet.add(self.superKoSeedKey());
                } else if (typeof self.boardToString === 'function') {
                    self.historyBoardSet.add(self.boardToString(self.board));
                }
            } catch (_) { /* ignore */ }
        }
        if (Array.isArray(self.moveHistory)) self.moveHistory = [];
        if (Array.isArray(self.moveCoords)) self.moveCoords = [];
        if (Array.isArray(self.historyMarkers)) self.historyMarkers = [];
        self.lastMoveMarkers = [];
        if ('passCounter' in self) self.passCounter = 0;
        self.gameOver = false;
        self.winner = null;

        const state = typeof self.getInitialState === 'function'
            ? self.getInitialState()
            : (typeof self.getState === 'function' ? self.getState() : {});
        self.broadcast({ type: 'editBoardAccepted', ...state });
        return true;
    },

    editSquareBoard(self, ws, msg) {
        if (qiProtocol.isBoardEditLocked(self)) {
            ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
            return true;
        }
        if (typeof self.applyEditBoard === 'function') {
            self.applyEditBoard(ws, msg);
            return true;
        }
        if (self.useCustomEditBoard) return false;

        const allowed = self.editBoardAllowedValues || [0, 1, 2];
        const mode = self.editBoardMode || 'grid2d';
        const asInt = (v) => {
            if (v === '') return '';   // 象棋等字符串棋盘的空格保持 ''，勿转成 0
            const n = Number(v);
            return Number.isInteger(n) ? n : v;
        };

        if (mode === 'flat') {
            const edited = msg.board;
            const n = self.vertexCount != null ? self.vertexCount
                : (Array.isArray(self.board) ? self.board.length : 0);
            if (!Array.isArray(edited) || edited.length !== n) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return true;
            }
            const next = new Array(n);
            for (let i = 0; i < n; i++) {
                const v = asInt(edited[i]);
                if (!allowed.includes(v)) {
                    ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                    return true;
                }
                next[i] = v;
            }
            self.board = next;
        } else if (mode === 'triangle' || mode === 'jagged') {
            const editedBoard = msg.board;
            const size = self.boardSize != null ? self.boardSize : self.BOARD_SIZE;
            const rowLenFn = typeof self.editBoardRowLength === 'function'
                ? (r) => self.editBoardRowLength(r)
                : (r) => r + 1;
            if (!editedBoard || !Array.isArray(editedBoard) || editedBoard.length !== size) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return true;
            }
            const next = new Array(size);
            for (let r = 0; r < size; r++) {
                const row = editedBoard[r];
                const expectLen = rowLenFn(r);
                if (!Number.isInteger(expectLen) || expectLen < 1
                    || !Array.isArray(row) || row.length !== expectLen) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return true;
                }
                next[r] = new Array(expectLen);
                for (let c = 0; c < expectLen; c++) {
                    const v = asInt(row[c]);
                    if (!allowed.includes(v)) {
                        ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                        return true;
                    }
                    next[r][c] = v;
                }
            }
            self.board = next;
        } else if (mode === 'maskedGrid') {
            const editedBoard = msg.board;
            const w = self.gridW != null ? self.gridW : self.boardSize;
            const h = self.gridH != null ? self.gridH : self.boardSize;
            if (!editedBoard || !Array.isArray(editedBoard) || editedBoard.length !== w) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return true;
            }
            const isValid = typeof self.isValidVertex === 'function'
                ? (r, c) => self.isValidVertex(r, c)
                : () => true;
            const next = new Array(w);
            for (let r = 0; r < w; r++) {
                const row = editedBoard[r];
                if (!Array.isArray(row) || row.length !== h) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return true;
                }
                next[r] = new Array(h);
                for (let c = 0; c < h; c++) {
                    const v = asInt(row[c]);
                    if (!isValid(r, c)) {
                        if (v !== -1 && v !== 0) {
                            ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                            return true;
                        }
                        next[r][c] = -1;
                    } else {
                        if (!allowed.includes(v)) {
                            ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                            return true;
                        }
                        next[r][c] = v;
                    }
                }
            }
            self.board = next;
        } else {
            // 默认方格盘：支持非方形（象棋 10×9 等）——用 boardRows/boardCols，回退 boardSize
            const editedBoard = msg.board;
            const rows = self.boardRows != null ? self.boardRows
                : (self.boardSize != null ? self.boardSize : self.BOARD_SIZE);
            const cols = self.boardCols != null ? self.boardCols : rows;
            if (!editedBoard || !Array.isArray(editedBoard) || editedBoard.length !== rows) {
                ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                return true;
            }
            for (let r = 0; r < rows; r++) {
                if (!Array.isArray(editedBoard[r]) || editedBoard[r].length !== cols) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋盘数据' }));
                    return true;
                }
                for (let c = 0; c < cols; c++) {
                    if (!allowed.includes(asInt(editedBoard[r][c]))) {
                        ws.send(JSON.stringify({ type: 'error', message: '棋盘数据包含非法值' }));
                        return true;
                    }
                }
            }
            self.board = typeof self.copyBoard === 'function'
                ? self.copyBoard(editedBoard)
                : copyBoard(editedBoard);
        }

        return qiProtocol.applyOpeningBoard(self, self.board, mode);
    },

    /** 为 Room 安装标准 editBoard（openingBoard + getState.initialBoard + 消息处理） */
    installStandardEditBoard(self) {
        if (!self || self._qiStandardEditBoardInstalled) return self;
        self._qiStandardEditBoardInstalled = true;

        /** 连续围棋等：board 为对象而非数组，且 useCustomEditBoard 时勿用二维 copyBoard */
        const copyGridBoard = (roomSelf, src) => {
            if (src == null) return src;
            if (roomSelf && roomSelf.useCustomEditBoard && !Array.isArray(src)) return null;
            if (!Array.isArray(src)) return null;
            if (typeof roomSelf.copyBoard === 'function' && Array.isArray(src[0])) {
                return roomSelf.copyBoard(src);
            }
            if (Array.isArray(src[0])) return copyBoard(src);
            return src.slice();
        };

        if (self.openingBoard === undefined && self.board && Array.isArray(self.board)) {
            const ob = copyGridBoard(self, self.board);
            if (ob != null) self.openingBoard = ob;
        }
        const copyOpeningFromBoard = (roomSelf) => {
            if (!roomSelf || !roomSelf.board || !Array.isArray(roomSelf.board)) return;
            const ob = copyGridBoard(roomSelf, roomSelf.board);
            if (ob != null) roomSelf.openingBoard = ob;
        };
        const enrich = (state) => {
            if (!state || typeof state !== 'object') return state;
            if (state.initialBoard == null && self.openingBoard && Array.isArray(self.openingBoard)) {
                const ib = copyGridBoard(self, self.openingBoard);
                if (ib != null) state.initialBoard = ib;
            }
            return state;
        };
        if (typeof self.getState === 'function') {
            const orig = self.getState.bind(self);
            self.getState = function () { return enrich(orig()); };
        }
        if (typeof self.getInitialState === 'function') {
            const orig = self.getInitialState.bind(self);
            self.getInitialState = function () { return enrich(orig()); };
        } else if (typeof self.getState === 'function') {
            self.getInitialState = function () { return this.getState(); };
        }
        if (typeof self.handleMessage === 'function') {
            const origHM = self.handleMessage.bind(self);
            self.handleMessage = function (ws, msg) {
                if (msg && msg.type === 'editBoard') {
                    if (qiProtocol.isBoardEditLocked(this)) {
                        ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
                        return;
                    }
                    if (this.useCustomEditBoard || typeof this.applyEditBoard === 'function') {
                        if (typeof this.applyEditBoard === 'function') {
                            this.applyEditBoard(ws, msg);
                            return;
                        }
                        return origHM(ws, msg);
                    }
                    qiProtocol.editSquareBoard(this, ws, msg);
                    return;
                }
                return origHM(ws, msg);
            };
        }
        // 新局 / 清空房间：openingBoard 必须与清空后的 board 一致，否则 initialBoard 会带回编辑残局
        const wrapResetSyncOpening = (name) => {
            if (typeof self[name] !== 'function') return;
            const orig = self[name].bind(self);
            self[name] = function (...args) {
                const room = this.room;
                if (!room || typeof room.broadcast !== 'function') {
                    const r = orig(...args);
                    copyOpeningFromBoard(this);
                    return r;
                }
                const origBroadcast = room.broadcast.bind(room);
                room.broadcast = (data, exclude) => {
                    if (data && typeof data === 'object'
                        && (data.type === 'newGameStarted' || data.type === 'roomReset')) {
                        copyOpeningFromBoard(this);
                        if (typeof this.getState === 'function') {
                            const fresh = this.getState();
                            data = Object.assign({}, fresh, {
                                type: data.type,
                                slots: data.slots !== undefined ? data.slots : fresh.slots
                            });
                        }
                    }
                    return origBroadcast(data, exclude);
                };
                try {
                    return orig(...args);
                } finally {
                    room.broadcast = origBroadcast;
                    copyOpeningFromBoard(this);
                }
            };
        };
        wrapResetSyncOpening('resetGame');
        wrapResetSyncOpening('resetToEmpty');
        return self;
    },

    /**
     * 方格围棋系共用：落子（禁全同）、虚着、悔棋申请/应答。
     * self 需有 board/boardSize/currentPlayer、historyBoards/historyBoardSet/historyMarkers、
     * lastMoveMarkers/moveHistory/moveCoords/passCounter、pendingUndo、tryPlaceStone、
     * copyBoard/boardToString/copyMarkers、broadcast/getState、performUndo、startScoreCounting。
     */
    weiqiMove(self, ws, msg, slot, opts = {}) {
        if (self.gameOver) return;
        if (!slot || slot !== (self.currentPlayer === 1 ? 'player1' : 'player2')) return;
        const { row, col } = msg;
        // 异形棋盘（掩码网格/锯齿盘）可定义 isValidMoveCoord(r,c) 覆盖方形校验
        const inBoard = typeof self.isValidMoveCoord === 'function'
            ? self.isValidMoveCoord(row, col)
            : (row >= 0 && row < self.boardSize && col >= 0 && col < self.boardSize);
        if (!inBoard) return;
        if (self.board[row][col] !== 0) return;
        const playerVal = self.currentPlayer === 1 ? 1 : 2;
        const newBoard = self.tryPlaceStone(self.board, row, col, playerVal);
        if (!newBoard) return;
        const newBoardStr = self.boardToString(newBoard);
        if (self.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }
        if (typeof opts.beforeCommit === 'function' && opts.beforeCommit() === false) return;
        self.historyBoards.push(self.copyBoard(newBoard));
        self.historyBoardSet.add(newBoardStr);
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'move', player: slot, row, col });
        self.board = newBoard;
        self.lastMoveMarkers = [{ row, col, color: playerVal }];
        self.passCounter = 0;
        let endedByAfterPlace = false;
        if (typeof opts.afterPlace === 'function') {
            endedByAfterPlace = opts.afterPlace({ row, col, playerVal, slot }) === true;
        }
        if (!endedByAfterPlace) {
            self.currentPlayer = 3 - self.currentPlayer;
        }
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
        if (typeof opts.afterCommit === 'function') {
            opts.afterCommit({ row, col, playerVal, slot, endedByAfterPlace });
        }
    },

    weiqiPass(self, ws, slot, opts = {}) {
        const room = self.room;
        if (self.gameOver) return;
        if (!slot || slot !== (self.currentPlayer === 1 ? 'player1' : 'player2')) return;
        if (typeof opts.beforeCommit === 'function' && opts.beforeCommit() === false) return;
        self.historyBoards.push(self.copyBoard(self.board));
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'pass', player: slot });
        self.currentPlayer = self.currentPlayer === 1 ? 2 : 1;
        self.passCounter++;
        self.lastMoveMarkers = [];
        self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
        if (typeof opts.afterBroadcast === 'function') opts.afterBroadcast();
        if (self.passCounter >= 2) {
            self.passCounter = 0;
            const blackPlayer = room.getPlayerBySlot('player1');
            const whitePlayer = room.getPlayerBySlot('player2');
            if (blackPlayer && whitePlayer) {
                self.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                self.gameOver = true;
                self.broadcast({ type: 'broadcast', action: 'endAgreed', ...self.getState() });
            }
        }
    },

    weiqiRequestUndo(self, ws, slot, opts = {}) {
        const cannotMsg = opts.cannotUndoMsg ?? '无法悔棋。';
        const room = self.room;
        if (!slot || self.gameOver) return;
        let steps = 0;
        for (let i = self.moveHistory.length - 1; i >= 0; i--) {
            steps++;
            if (self.moveHistory[i] === slot) break;
        }
        if (steps === 0 || steps > self.historyBoards.length) {
            ws.send(JSON.stringify({ type: 'error', message: cannotMsg }));
            return;
        }
        const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) self.performUndo(steps, ws);
        else {
            self.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    },

    weiqiUndoResponse(self, ws, msg, opts = {}) {
        const denyMsg = opts.undoDeniedMsg ?? '对方拒绝悔棋。';
        if (self.pendingUndo) {
            if (msg.accept) self.performUndo(self.pendingUndo.steps, self.pendingUndo.requester);
            else self.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: denyMsg }));
        }
        self.pendingUndo = null;
    },
};


/**
 * 方格棋盘、四邻（上下左右）的围棋共用算法。
 * board[r][c]：0 空，1 黑，2 白。
 * 变种若规则不同（如二气/三气），通过 minLib 参数区分；不围棋、零气等特殊逻辑请在各 Room 内单独实现。
 */
const qiMessageBoxOptions = {
    defaults: {
        alertTitle: '提示',
        confirmTitle: '确认',
        okText: '确认',
        cancelText: '取消',
        yesText: '是',
        noText: '否'
    },

    normalize(type, message, options = {}) {
        const isConfirm = type === 'confirm';
        const useYesNo = options.buttons === 'yesNo' || options.choice === 'yesNo';
        return {
            type: isConfirm ? 'confirm' : 'alert',
            title: options.title || (isConfirm ? this.defaults.confirmTitle : this.defaults.alertTitle),
            message: message == null ? '' : String(message),
            okText: options.okText || options.confirmText || (useYesNo ? this.defaults.yesText : this.defaults.okText),
            cancelText: options.cancelText || options.noText || (useYesNo ? this.defaults.noText : this.defaults.cancelText)
        };
    }
};

/**
 * Benson 无条件活（通用 2D 网格版，供方格 / 带洞 / 网格图 / 桥 等复用）。
 * opts: { width, height, getNeighbors(r,c)->[[r,c],..], isValid(r,c), get(r,c)->0/1/2 }
 * @returns {{ alive: boolean[][], territory: number[][] }}
 */
function bensonCoreGrid(opts) {
    const width = opts.width, height = opts.height;
    const getNeighbors = opts.getNeighbors, isValid = opts.isValid, get = opts.get;
    const nb = Array(height).fill().map(() => Array(width).fill(null));
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!isValid(r, c)) continue;
            nb[r][c] = getNeighbors(r, c).filter((p) =>
                p[0] >= 0 && p[0] < height && p[1] >= 0 && p[1] < width && isValid(p[0], p[1]));
        }
    }
    const chainOf = Array(height).fill().map(() => Array(width).fill(-1));
    const chains = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!nb[r][c]) continue;
            const v = get(r, c);
            if ((v !== 1 && v !== 2) || chainOf[r][c] >= 0) continue;
            const id = chains.length;
            const stones = [[r, c]];
            chainOf[r][c] = id;
            const queue = [[r, c]];
            for (let qi = 0; qi < queue.length; qi++) {
                const rr = queue[qi][0], cc = queue[qi][1];
                for (const p of nb[rr][cc]) {
                    const nr = p[0], nc = p[1];
                    if (get(nr, nc) === v && chainOf[nr][nc] < 0) {
                        chainOf[nr][nc] = id;
                        stones.push([nr, nc]);
                        queue.push([nr, nc]);
                    }
                }
            }
            chains.push({ color: v, stones });
        }
    }
    const regionOf = Array(height).fill().map(() => Array(width).fill(-1));
    const regions = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!nb[r][c] || get(r, c) !== 0 || regionOf[r][c] >= 0) continue;
            const id = regions.length;
            const points = [[r, c]];
            const adj = new Set();
            regionOf[r][c] = id;
            const queue = [[r, c]];
            for (let qi = 0; qi < queue.length; qi++) {
                const rr = queue[qi][0], cc = queue[qi][1];
                for (const p of nb[rr][cc]) {
                    const nr = p[0], nc = p[1];
                    const nv = get(nr, nc);
                    if (nv === 0) {
                        if (regionOf[nr][nc] < 0) {
                            regionOf[nr][nc] = id;
                            points.push([nr, nc]);
                            queue.push([nr, nc]);
                        }
                    } else if (chainOf[nr][nc] >= 0) {
                        adj.add(chainOf[nr][nc]);
                    }
                }
            }
            regions.push({ points, adj });
        }
    }
    const chainRegions = chains.map(() => new Set());
    regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
    // 最大不动点：先全部存活，反复剔除不足两个要害区域（邻接链均存活且同色）的链
    const alive = new Array(chains.length).fill(true);
    let changed = true;
    while (changed) {
        changed = false;
        for (let ci = 0; ci < chains.length; ci++) {
            if (!alive[ci]) continue;
            const color = chains[ci].color;
            let vital = 0;
            for (const ri of chainRegions[ci]) {
                let ok = true;
                for (const aj of regions[ri].adj) {
                    if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                }
                if (ok && ++vital >= 2) break;
            }
            if (vital < 2) { alive[ci] = false; changed = true; }
        }
    }
    const aliveGrid = Array(height).fill().map(() => Array(width).fill(false));
    chains.forEach((ch, ci) => {
        if (!alive[ci]) return;
        for (const p of ch.stones) aliveGrid[p[0]][p[1]] = true;
    });
    const territory = Array(height).fill().map(() => Array(width).fill(0));
    for (const reg of regions) {
        if (!reg.adj.size) continue;
        let owner = 0;
        let ok = true;
        for (const aj of reg.adj) {
            if (!alive[aj]) { ok = false; break; }
            const cc2 = chains[aj].color;
            if (owner === 0) owner = cc2;
            else if (owner !== cc2) { ok = false; break; }
        }
        if (ok && owner) {
            for (const p of reg.points) territory[p[0]][p[1]] = owner;
        }
    }
    return { alive: aliveGrid, territory };
}

/**
 * Benson 无条件活（通用扁平图版）。
 * opts: { n, neighbors(id)->number[], get(id)->0/1/2 }
 * @returns {{ alive: boolean[], territory: number[] }}
 */
function bensonCoreGraph(opts) {
    const n = opts.n, neighbors = opts.neighbors, get = opts.get;
    const nb = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        nb[i] = (neighbors(i) || []).filter((j) => Number.isInteger(j) && j >= 0 && j < n);
    }
    const chainOf = new Array(n).fill(-1);
    const chains = [];
    for (let i = 0; i < n; i++) {
        const v = get(i);
        if ((v !== 1 && v !== 2) || chainOf[i] >= 0) continue;
        const id = chains.length;
        const stones = [i];
        chainOf[i] = id;
        const queue = [i];
        for (let qi = 0; qi < queue.length; qi++) {
            for (const j of nb[queue[qi]]) {
                if (get(j) === v && chainOf[j] < 0) {
                    chainOf[j] = id;
                    stones.push(j);
                    queue.push(j);
                }
            }
        }
        chains.push({ color: v, stones });
    }
    const regionOf = new Array(n).fill(-1);
    const regions = [];
    for (let i = 0; i < n; i++) {
        if (get(i) !== 0 || regionOf[i] >= 0) continue;
        const id = regions.length;
        const points = [i];
        const adj = new Set();
        regionOf[i] = id;
        const queue = [i];
        for (let qi = 0; qi < queue.length; qi++) {
            for (const j of nb[queue[qi]]) {
                const nv = get(j);
                if (nv === 0) {
                    if (regionOf[j] < 0) {
                        regionOf[j] = id;
                        points.push(j);
                        queue.push(j);
                    }
                } else if (chainOf[j] >= 0) {
                    adj.add(chainOf[j]);
                }
            }
        }
        regions.push({ points, adj });
    }
    const chainRegions = chains.map(() => new Set());
    regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
    const alive = new Array(chains.length).fill(true);
    let changed = true;
    while (changed) {
        changed = false;
        for (let ci = 0; ci < chains.length; ci++) {
            if (!alive[ci]) continue;
            const color = chains[ci].color;
            let vital = 0;
            for (const ri of chainRegions[ci]) {
                let ok = true;
                for (const aj of regions[ri].adj) {
                    if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                }
                if (ok && ++vital >= 2) break;
            }
            if (vital < 2) { alive[ci] = false; changed = true; }
        }
    }
    const aliveArr = new Array(n).fill(false);
    chains.forEach((ch, ci) => { if (alive[ci]) for (const i of ch.stones) aliveArr[i] = true; });
    const territory = new Array(n).fill(0);
    for (const reg of regions) {
        if (!reg.adj.size) continue;
        let owner = 0;
        let ok = true;
        for (const aj of reg.adj) {
            if (!alive[aj]) { ok = false; break; }
            const cc2 = chains[aj].color;
            if (owner === 0) owner = cc2;
            else if (owner !== cc2) { ok = false; break; }
        }
        if (ok && owner) for (const i of reg.points) territory[i] = owner;
    }
    return { alive: aliveArr, territory };
}

const squareWeiqiRules = {
    countGroupLiberties(board, row, col, boardSize) {
        const color = board[row][col];
        if (color === 0) return 0;
        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (board[nr][nc] === 0) {
                    liberties.add(nr + ',' + nc);
                } else if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    },
    
    hasLiberty(board, row, col, boardSize) 
    {
        const color = board[row][col];
        if (color === 0)
            return false;

        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        const queue = [[row, col]];
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        visited[row][col] = true;
        while (queue.length) 
        {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) 
            {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize)
                    continue;
                if (board[nr][nc] === 0)
                    return true;
                if (board[nr][nc] === color && !visited[nr][nc])
                {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]); 
                }
            }
        }
        return false;
    },

    removeGroup(board, row, col, color, boardSize) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    },

    /**
     * 标准提子规则：敌方块气数 &lt; minLib 则提掉；落子后己方块气数 &lt; minLib 则提掉（含自杀手筋）。
     * minLib=1 为标准围棋；2 为二气围棋；3 为三气围棋。
     */
    tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, boardSize, copyBoardFn, minLib = 1) {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = copyBoardFn(boardBefore);
        newBoard[row][col] = playerVal;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && newBoard[nr][nc] === 3 - playerVal) 
            {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) {
                    checkedEnemy.add(key);
                    if (this.countGroupLiberties(newBoard, nr, nc, boardSize) < minLib) 
                        this.removeGroup(newBoard, nr, nc, 3 - playerVal, boardSize);
                }
            }
        }

        if (this.countGroupLiberties(newBoard, row, col, boardSize) < minLib) {
            this.removeGroup(newBoard, row, col, playerVal, boardSize);
        }

        return newBoard;
    },

    /**
     * Benson 无条件活（pass-alive）判定：四邻方格。
     * @returns {{ alive: boolean[][], territory: number[][] }}
     *   alive[r][c]=true 表示该子属于无条件活棋链；
     *   territory[r][c]∈{0,1,2} 表示该空点所在的"确定领地"归属（0=不定）。
     */
    bensonAlive(board, boardSize) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        // 1) 棋链
        const chainOf = Array(boardSize).fill().map(() => Array(boardSize).fill(-1));
        const chains = [];
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                const v = board[r][c];
                if ((v !== 1 && v !== 2) || chainOf[r][c] >= 0) continue;
                const id = chains.length;
                const stones = [[r, c]];
                chainOf[r][c] = id;
                const queue = [[r, c]];
                for (let qi = 0; qi < queue.length; qi++) {
                    const [rr, cc] = queue[qi];
                    for (const [dr, dc] of dirs) {
                        const nr = rr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (board[nr][nc] === v && chainOf[nr][nc] < 0) {
                            chainOf[nr][nc] = id;
                            stones.push([nr, nc]);
                            queue.push([nr, nc]);
                        }
                    }
                }
                chains.push({ color: v, stones });
            }
        }
        // 2) 空点区域与其邻接棋链
        const regionOf = Array(boardSize).fill().map(() => Array(boardSize).fill(-1));
        const regions = [];
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (board[r][c] !== 0 || regionOf[r][c] >= 0) continue;
                const id = regions.length;
                const points = [[r, c]];
                const adj = new Set();
                regionOf[r][c] = id;
                const queue = [[r, c]];
                for (let qi = 0; qi < queue.length; qi++) {
                    const [rr, cc] = queue[qi];
                    for (const [dr, dc] of dirs) {
                        const nr = rr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        const nv = board[nr][nc];
                        if (nv === 0) {
                            if (regionOf[nr][nc] < 0) {
                                regionOf[nr][nc] = id;
                                points.push([nr, nc]);
                                queue.push([nr, nc]);
                            }
                        } else if (chainOf[nr][nc] >= 0) {
                            adj.add(chainOf[nr][nc]);
                        }
                    }
                }
                regions.push({ points, adj });
            }
        }
        const chainRegions = chains.map(() => new Set());
        regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
        // 3) 最大不动点：先假设全部链存活，反复剔除"不足两个要害区域"的链
        //    （要害区域 = 其邻接的所有链当前均存活且同色）
        const alive = new Array(chains.length).fill(true);
        let changed = true;
        while (changed) {
            changed = false;
            for (let ci = 0; ci < chains.length; ci++) {
                if (!alive[ci]) continue;
                const color = chains[ci].color;
                let vital = 0;
                for (const ri of chainRegions[ci]) {
                    let ok = true;
                    for (const aj of regions[ri].adj) {
                        if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                    }
                    if (ok && ++vital >= 2) break;
                }
                if (vital < 2) { alive[ci] = false; changed = true; }
            }
        }
        // 4) 输出：活棋格与确定领地
        const aliveGrid = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        chains.forEach((ch, ci) => {
            if (!alive[ci]) return;
            for (const [r, c] of ch.stones) aliveGrid[r][c] = true;
        });
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (const reg of regions) {
            if (!reg.adj.size) continue;
            let owner = 0;
            let ok = true;
            for (const aj of reg.adj) {
                if (!alive[aj]) { ok = false; break; }
                const c = chains[aj].color;
                if (owner === 0) owner = c;
                else if (owner !== c) { ok = false; break; }
            }
            if (ok && owner) {
                for (const [r, c] of reg.points) territory[r][c] = owner;
            }
        }
        return { alive: aliveGrid, territory };
    },

    /** Benson 无条件活（带洞方格版）：洞不参与分析（不可落子/无气/不连通） */
    bensonAliveWithHoles(board, boardSize, isHole) {
        return bensonCoreGrid({
            width: boardSize,
            height: boardSize,
            getNeighbors: function (r, c) { return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]; },
            isValid: function (r, c) { return !isHole(r, c); },
            get: function (r, c) { return board[r][c]; }
        });
    },

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, boardSize) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = libertyRow + dr;
            const nc = libertyCol + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === opponentColor) return true;
        }
        return false;
    },

    /**
     * @param maxWeakLiberties 有气但可能被「包围」判死的阈值：标准/二气为 2，三气围棋为 3
     */
    removeDeadAndDying(srcBoard, boardSize, copyBoardFn, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    /**
     * @param {object} [options]
     * @param {(cell:number)=>boolean} [options.isPassable] 距离扩张时是否可走入该格；默认与洞一致：-1 洞不可穿。
     * 中立子围棋可传入 (v) => v !== 3 等。
     */
    assignTerritoryWithRange(liveBoard, boardSize, options = {}) {
        const isPassable = options.isPassable ?? ((v) => v !== -1);
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && isPassable(liveBoard[nr][nc]) && dist[nr][nc] === Infinity) {
                            dist[nr][nc] = d + 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScore(liveBoard, territory, boardSize) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    },

    /**
     * 同一平面方格，但部分点不可作气（洞）。isHole(r,c)=true 时该点既不能放子也不能作气穿行。
     */
    removeDeadAndDyingWithHoles(srcBoard, boardSize, copyBoardFn, isHole, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        const isLibertyCell = (r, c) =>
            r >= 0 && r < boardSize && c >= 0 && c < boardSize &&
            boardCopy[r][c] === 0 && !isHole(r, c);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (isLibertyCell(nr, nc)) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    assignTerritoryWithRangeWithHoles(liveBoard, boardSize, isHole) {
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0 || isHole(r, c)) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (isHole(nr, nc)) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScoreWithHoles(liveBoard, territory, boardSize, isHole) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0 && !isHole(r, c)) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }
};

/**
 * 二维数组棋盘 + 每点邻接由 getNeighbors(r,c) 给出（扭棱四角、三角围棋等）。
 * board[r][c]：0 空，1 黑，2 白；-1 可表示无效格（仅不参与落子，形势 BFS 不可穿）。
 */
const gridGraphWeiqiRules = {
    /** Benson 无条件活（通用网格图版）：按各棋类自身的邻接与有效点 */
    bensonAlive(board, gridW, gridH, getNeighbors, isIntersection) {
        return bensonCoreGrid({
            width: gridH,
            height: gridW,
            getNeighbors: function (r, c) { return getNeighbors(r, c); },
            isValid: function (r, c) { return r >= 0 && r < gridW && c >= 0 && c < gridH && isIntersection(r, c); },
            get: function (r, c) { return board[r] ? board[r][c] : undefined; }
        });
    },

    countGroupLiberties(board, row, col, getNeighbors) {
        const color = board[row][col];
        if (color === 0) 
            return 0;

        const visited = new Set();
        const key = (r, c) => r + ',' + c;
        const queue = [[row, col]];
        visited.add(key(row, col));
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [nr, nc] of getNeighbors(r, c)) {
                if (board[nr][nc] === 0) liberties.add(key(nr, nc));
                else if (board[nr][nc] === color && !visited.has(key(nr, nc))) {
                    visited.add(key(nr, nc));
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    },

    removeGroup(board, row, col, color, getNeighbors) {
        const queue = [[row, col]];
        board[row][col] = 0;
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [nr, nc] of getNeighbors(r, c)) {
                if (board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    },

    tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, copyBoardFn, getNeighbors, minLib = 1) {
        if (boardBefore[row][col] !== 0) 
            return null;
        const newBoard = copyBoardFn(boardBefore);
        newBoard[row][col] = playerVal;
        const enemyColor = 3 - playerVal;
        const checkedEnemy = new Set();
        for (const [nr, nc] of getNeighbors(row, col)) {
            if (newBoard[nr][nc] === enemyColor) {
                const k = `${nr},${nc}`;
                if (!checkedEnemy.has(k)) {
                    checkedEnemy.add(k);
                    if (this.countGroupLiberties(newBoard, nr, nc, getNeighbors) < minLib) {
                        this.removeGroup(newBoard, nr, nc, enemyColor, getNeighbors);
                    }
                }
            }
        }
        if (this.countGroupLiberties(newBoard, row, col, getNeighbors) < minLib) {
            this.removeGroup(newBoard, row, col, playerVal, getNeighbors);
        }
        return newBoard;
    },

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, getNeighbors) {
        for (const [nr, nc] of getNeighbors(libertyRow, libertyCol)) {
            if (board[nr][nc] === opponentColor) return true;
        }
        return false;
    },

    removeDeadAndDying(srcBoard, gridW, gridH, copyBoardFn, getNeighbors, isIntersection, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(gridW).fill().map(() => Array(gridH).fill(false));
            for (let r = 0; r < gridW; r++) {
                for (let c = 0; c < gridH; c++) {
                    if (!isIntersection(r, c)) continue;
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [nr, nc] of getNeighbors(rr, cc)) {
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, getNeighbors)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    assignTerritoryWithRange(liveBoard, gridW, gridH, getNeighbors, isIntersection, options = {}) {
        const passCell = options.passCell ?? ((v) => v !== -1);
        const territory = Array(gridW).fill().map(() => Array(gridH).fill(0));
        for (let r = 0; r < gridW; r++) {
            for (let c = 0; c < gridH; c++) {
                if (!isIntersection(r, c) || liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= gridW - 2 || c <= 1 || c >= gridH - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(gridW).fill().map(() => Array(gridH).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [nr, nc] of getNeighbors(cr, cc)) {
                        if (!passCell(liveBoard[nr][nc])) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScore(liveBoard, territory, gridW, gridH, isIntersection) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < gridW; r++) {
            for (let c = 0; c < gridH; c++) {
                if (!isIntersection(r, c)) continue;
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }
};

/**
 * 一维顶点棋盘 + 邻接表 neighbors[v]（六角、五角围棋等）。
 */
const vertexGraphWeiqiRules = {
    /** Benson 无条件活（扁平顶点图版）：neighbors 为按顶点 id 的邻接数组 */
    bensonAlive(boardState, neighbors) {
        return bensonCoreGraph({
            n: boardState.length,
            neighbors: function (i) { return neighbors[i] || []; },
            get: function (i) { return boardState[i]; }
        });
    },

    hasLiberty(boardState, start, neighbors) {
        const color = boardState[start];
        if (color === 0) return false;
        const queue = [start];
        const visited = new Array(boardState.length).fill(false);
        visited[start] = true;
        let idx = 0;
        while (idx < queue.length) {
            const v = queue[idx++];
            for (const nb of neighbors[v]) {
                if (boardState[nb] === 0) return true;
                if (boardState[nb] === color && !visited[nb]) {
                    visited[nb] = true;
                    queue.push(nb);
                }
            }
        }
        return false;
    },

    removeGroup(boardState, start, neighbors) {
        const color = boardState[start];
        if (color === 0) return;
        const queue = [start];
        boardState[start] = 0;
        let idx = 0;
        while (idx < queue.length) {
            const v = queue[idx++];
            for (const nb of neighbors[v]) {
                if (boardState[nb] === color) {
                    boardState[nb] = 0;
                    queue.push(nb);
                }
            }
        }
    },

    tryPlaceStone(boardBefore, vertex, playerVal, neighbors) {
        if (boardBefore[vertex] !== 0) return null;
        const newBoard = boardBefore.slice();
        newBoard[vertex] = playerVal;
        const pv = playerVal;
        for (const nb of neighbors[vertex]) {
            if (newBoard[nb] === 3 - pv && !this.hasLiberty(newBoard, nb, neighbors)) {
                this.removeGroup(newBoard, nb, neighbors);
            }
        }
        if (!this.hasLiberty(newBoard, vertex, neighbors)) {
            this.removeGroup(newBoard, vertex, neighbors);
        }
        return newBoard;
    },

    isLibertySurroundedByOpponent(boardState, libertyVertex, opponentColor, neighbors) {
        for (const nb of neighbors[libertyVertex]) {
            if (boardState[nb] === opponentColor) return true;
        }
        return false;
    },

    removeDeadAndDying(srcBoard, neighbors, vertexCount, copyBoardFn, maxWeakLiberties = 2) {
        let newBoard = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = new Array(vertexCount).fill(false);
            for (let v = 0; v < vertexCount; v++) {
                if (newBoard[v] !== 0 && !visited[v]) {
                    const color = newBoard[v];
                    const queue = [v];
                    visited[v] = true;
                    const stones = [v];
                    const liberties = new Set();
                    let idx = 0;
                    while (idx < queue.length) {
                        const cur = queue[idx++];
                        for (const nb of neighbors[cur]) {
                            if (newBoard[nb] === 0) liberties.add(nb);
                            else if (newBoard[nb] === color && !visited[nb]) {
                                visited[nb] = true;
                                queue.push(nb);
                                stones.push(nb);
                            }
                        }
                    }
                    if (liberties.size === 0) {
                        for (const s of stones) newBoard[s] = 0;
                        changed = true;
                        continue;
                    }
                    if (liberties.size <= maxWeakLiberties) {
                        let allControlled = true;
                        for (const lib of liberties) {
                            if (!this.isLibertySurroundedByOpponent(newBoard, lib, 3 - color, neighbors)) {
                                allControlled = false;
                                break;
                            }
                        }
                        if (allControlled) {
                            for (const s of stones) newBoard[s] = 0;
                            changed = true;
                        }
                    }
                }
            }
        }
        return newBoard;
    }
};

/**
 * 围棋「形势判断 / 数点」的两档公共口径（棋种用开关选，默认用 Benson）。
 *
 * ops 里的四个原语由调用方绑定好几何与尺寸（方格盘用 squareWeiqiScoringOps，
 * 异形盘用 gridGraphWeiqiScoringOps），去死子 / Benson / 最近归属 / 计分一律沿用既有公共实现，
 * 这里只做流程编排：
 *   用 Benson 档：弱气去死子 ↔ Benson 保活迭代 → 最近归属 → Benson 确定领地覆盖 → 计分
 *   只用最近归属：盘面直接拷贝（不判死子、不做 Benson）→ 最近归属 → 计分
 * 两者返回值都带 liveBoard / territory，供形势判断的死子覆盖层使用；lead 已扣 2×komi。
 */

/** 「用 Benson」档（开关默认档）：弱气去死子 ↔ Benson 保活 → 最近归属 → 确定领地覆盖 → 计分 */
function computeBensonWeiqiLead(board, komi, ops) {
    const benson = ops.bensonAlive(board);
    let liveBoard = ops.copyBoard(board);
    let changed = true;
    while (changed) {
        changed = false;
        const cleaned = ops.removeDeadAndDying(liveBoard);
        for (let r = 0; r < board.length; r++) {
            const row = board[r];
            for (let c = 0; c < row.length; c++) {
                if (benson.alive[r][c] && (row[c] === 1 || row[c] === 2) && cleaned[r][c] !== row[c]) {
                    cleaned[r][c] = row[c];
                    changed = true;
                }
            }
        }
        liveBoard = cleaned;
    }
    const territory = ops.assignTerritoryWithRange(liveBoard);
    // Benson 确定领地优先于「距离扩张」归属
    const secure = ops.bensonAlive(liveBoard);
    for (let r = 0; r < liveBoard.length; r++) {
        const row = liveBoard[r];
        for (let c = 0; c < row.length; c++) {
            if (row[c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
        }
    }
    const { blackTotal, whiteTotal } = ops.computeScore(liveBoard, territory);
    return { lead: blackTotal - whiteTotal - 2 * komi, blackTotal, whiteTotal, liveBoard, territory };
}

/** 「只用最近归属」档：不判死子、不做 Benson，盘面直接最近归属 + 计分 */
function computeNearestWeiqiLead(board, komi, ops) {
    const liveBoard = ops.copyBoard(board);
    const territory = ops.assignTerritoryWithRange(liveBoard);
    const { blackTotal, whiteTotal } = ops.computeScore(liveBoard, territory);
    return { lead: blackTotal - whiteTotal - 2 * komi, blackTotal, whiteTotal, liveBoard, territory };
}

/**
 * 方格盘的两档原语（boardSize 已绑定），直接传给上面两个函数。
 * @param {object} [options]
 * @param {number} [options.maxWeakLiberties] 弱气去死子阈值，默认 2（短气围棋传该档位的气数）
 * @param {(cell:number)=>boolean} [options.isPassable] 距离扩张可穿越判据（中立子围棋传 v => v !== NEUTRAL）
 * @param {(board:number[][])=>number[][]} [options.copyBoard] 自定义拷贝
 */
function squareWeiqiScoringOps(boardSize, options = {}) {
    const maxWeakLiberties = options.maxWeakLiberties != null ? options.maxWeakLiberties : 2;
    const copyBoardFn = options.copyBoard || ((b) => b.map((row) => row.slice()));
    return {
        copyBoard: copyBoardFn,
        bensonAlive: (bd) => squareWeiqiRules.bensonAlive(bd, boardSize),
        removeDeadAndDying: (bd) => squareWeiqiRules.removeDeadAndDying(bd, boardSize, copyBoardFn, maxWeakLiberties),
        assignTerritoryWithRange: (bd) => squareWeiqiRules.assignTerritoryWithRange(
            bd, boardSize, options.isPassable ? { isPassable: options.isPassable } : {}
        ),
        computeScore: (b, t) => squareWeiqiRules.computeScore(b, t, boardSize)
    };
}

/**
 * 网格图（异形棋盘）的两档原语：getNeighbors / isIntersection 由棋种提供（掩码盘）。
 * @param {object} [options] 同 squareWeiqiScoringOps，外加 passCell（距离扩张可走入判据，默认 v !== -1）
 */
function gridGraphWeiqiScoringOps(gridW, gridH, getNeighbors, isIntersection, options = {}) {
    const maxWeakLiberties = options.maxWeakLiberties != null ? options.maxWeakLiberties : 2;
    const copyBoardFn = options.copyBoard || ((b) => b.map((row) => row.slice()));
    return {
        copyBoard: copyBoardFn,
        bensonAlive: (bd) => gridGraphWeiqiRules.bensonAlive(bd, gridW, gridH, getNeighbors, isIntersection),
        removeDeadAndDying: (bd) => gridGraphWeiqiRules.removeDeadAndDying(
            bd, gridW, gridH, copyBoardFn, getNeighbors, isIntersection, maxWeakLiberties
        ),
        assignTerritoryWithRange: (bd) => gridGraphWeiqiRules.assignTerritoryWithRange(
            bd, gridW, gridH, getNeighbors, isIntersection,
            options.passCell ? { passCell: options.passCell } : {}
        ),
        computeScore: (b, t) => gridGraphWeiqiRules.computeScore(b, t, gridW, gridH, isIntersection)
    };
}

/**
 * 棋盘落座蒙版：在已有限时协商的 Room 实例上安装房主/执子/takeSeat 等能力。
 * 各变体 initRoom 里对 gameLogic 调用一次即可。
 */
const qiBoardSeatOverlay = {
    install(self) {
        if (!self || self._qiBoardSeatOverlayInstalled) return self;
        self._qiBoardSeatOverlayInstalled = true;
        self.boardSeatOverlay = true;
        if (self.hostWs === undefined) self.hostWs = null;
        if (!self.slotJoinedAt) self.slotJoinedAt = { player1: null, player2: null };

        self._qiApplyChooserColorChoice = function (colorChoice, chooserSlot) {
            if (!chooserSlot) return null;
            const room = this.room;
            if (!room.getPlayerBySlot(chooserSlot)) return null;
            let raw = colorChoice;
            if (raw === 'hostWhite') raw = 'player2';
            if (raw === 'hostBlack') raw = 'player1';
            let target = 'player1';
            if (raw === 'player2') target = 'player2';
            else if (raw === 'random') target = Math.random() < 0.5 ? 'player1' : 'player2';
            if (chooserSlot === target) return target;
            if (typeof room.swapSlots === 'function') {
                room.swapSlots('player1', 'player2');
            } else {
                const a = room.slotOccupancy.get('player1') || null;
                const b = room.slotOccupancy.get('player2') || null;
                room.slotOccupancy.delete('player1');
                room.slotOccupancy.delete('player2');
                if (a) {
                    room.players.set(a, 'player2');
                    room.slotOccupancy.set('player2', a);
                }
                if (b) {
                    room.players.set(b, 'player1');
                    room.slotOccupancy.set('player1', b);
                }
            }
            if (this.slotJoinedAt) {
                const tb = this.slotJoinedAt.player1;
                const tw = this.slotJoinedAt.player2;
                this.slotJoinedAt.player1 = tw;
                this.slotJoinedAt.player2 = tb;
            }
            return target;
        };

        self._qiNotifyColorsFinalized = function () {
            const room = this.room;
            const b = room.getPlayerBySlot('player1');
            const w = room.getPlayerBySlot('player2');
            const hostSlot = this.hostWs ? room.getSlotByWs(this.hostWs) : null;
            if (b) b.send(JSON.stringify({ type: 'colorAssigned', color: 'player1', finalized: true, isHost: b === this.hostWs }));
            if (w) w.send(JSON.stringify({ type: 'colorAssigned', color: 'player2', finalized: true, isHost: w === this.hostWs }));
            this.broadcast({
                type: 'colorsFinalized',
                slots: { player1: !!b, player2: !!w },
                hostSlot
            });
        };

        self._qiResendNegotiationUi = function (ws) {
            if (!this.tcNego || !ws) return;
            const slot = this.room.getSlotByWs(ws);
            if (!slot) return;
            if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'propose') {
                ws.send(JSON.stringify({
                    type: 'timeControlNegotiation',
                    mode: 'propose',
                    boardSeatOverlay: true
                }));
                return;
            }
            if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'respond' && this.tcNego.proposal) {
                this._qiSendRespondDialog(slot, this.tcNego.proposal);
                return;
            }
            ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
        };

        self._qiSendRespondDialog = function (toSlot, proposal) {
            const ws = this.room.getPlayerBySlot(toSlot);
            if (!ws) return;
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                boardSeatOverlay: true,
                proposal: {
                    ok: true,
                    timed: proposal.timed,
                    mainMinutes: proposal.mainMinutes,
                    byoyomiSeconds: proposal.byoyomiSeconds,
                    maxTimeouts: proposal.maxTimeouts,
                    colorChoice: proposal.colorChoice || null,
                    colorChooserSlot: proposal.colorChooserSlot || null,
                    handicap: proposal.handicap || 0
                }
            }));
        };

        self._qiParseColorChoice = function (msg, slot) {
            const raw = msg && msg.colorChoice;
            let colorChoice = 'player1';
            // 新客户端（落座蒙版那套限时对话框）发的是座位名 player1/player2（player1 = 先手），
            // 老客户端发的是颜色名 black/white；两种都要认 —— 只认颜色名会把「执白」悄悄吃成默认的 player1。
            if (raw === 'player1' || raw === 'black' || raw === 'hostBlack') colorChoice = 'player1';
            else if (raw === 'player2' || raw === 'white' || raw === 'hostWhite') colorChoice = 'player2';
            else if (raw === 'random') colorChoice = 'random';
            return { colorChoice, colorChooserSlot: slot };
        };

        // —— wrap existing methods ——
        const origFirst = typeof self._firstPickerSlot === 'function' ? self._firstPickerSlot.bind(self) : null;
        self._firstPickerSlot = function () {
            if (this.hostWs) {
                const hs = this.room.getSlotByWs(this.hostWs);
                // 房主连接已断/僵死时不再把协商提案发给它（否则另一方永远收不到协商，matchStarted 恒 false 无法落子）
                if (hs && (!this.hostWs.readyState || this.hostWs.readyState === 1)) return hs;
            }
            return origFirst ? origFirst() : 'player1';
        };

        const origMaybe = typeof self._maybeBeginTimeNegotiation === 'function'
            ? self._maybeBeginTimeNegotiation.bind(self) : null;
        self._maybeBeginTimeNegotiation = function () {
            // 未接入限时协商的玩法（无 tcNego 字段）跳过
            if (this.tcNego === undefined) return;
            if (this.moveHistory && this.moveHistory.length > 0) return;
            if (this.gameOver) return;
            const room = this.room;
            if (!room.getPlayerBySlot('player1') || !room.getPlayerBySlot('player2')) return;
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
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'timeControlNegotiation',
                    mode: 'propose',
                    boardSeatOverlay: true
                }));
            }
            const other = first === 'player1' ? 'player2' : 'player1';
            const ws2 = room.getPlayerBySlot(other);
            if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
            void origMaybe;
        };

        const origAfter = typeof self.afterColorAssigned === 'function'
            ? self.afterColorAssigned.bind(self) : null;
        self.afterColorAssigned = function (ws, slot) {
            // 兼容雷达旧签名 afterColorAssigned(slot)
            let seatWs = ws;
            let seatSlot = slot;
            if (seatSlot == null && (ws === 'black' || ws === 'white')) {
                seatSlot = ws;
                seatWs = this.room.getPlayerBySlot(seatSlot);
            }
            if (!this.hostWs && seatWs) this.hostWs = seatWs;
            if (seatSlot && this.slotJoinedAt) this.slotJoinedAt[seatSlot] = Date.now();
            this._maybeBeginTimeNegotiation();
            // 无限时协商玩法：双方入座即开始，便于客户端收起蒙版
            if (this.tcNego === undefined) {
                const b = this.room.getPlayerBySlot('player1');
                const w = this.room.getPlayerBySlot('player2');
                if (b && w) {
                    this.matchStarted = true;
                    // 开局即判定：编辑盘面某方无将/帅/王则直接判负，行棋方无子可动则判和（象棋/国际象棋等实现 onMatchStarted）
                    if (typeof this.onMatchStarted === 'function') {
                        try { this.onMatchStarted(); } catch (e) { /* ignore */ }
                    }
                    if (this.gameOver) {
                        try {
                            if (typeof this.getState === 'function') {
                                this.broadcast({ type: 'broadcast', action: 'matchStartOver', ...this.getState() });
                            }
                        } catch (e) { /* ignore */ }
                    }
                    this._qiNotifyColorsFinalized();
                }
            }
            if (!origAfter) return;
            try {
                origAfter(seatWs, seatSlot);
            } catch (e) {
                try { origAfter(seatSlot); } catch (e2) { /* ignore */ }
            }
        };

        self._sendRespondDialog = function (toSlot, proposal) {
            this._qiSendRespondDialog(toSlot, proposal);
        };

        self._handleTimeControlSubmit = function (ws, msg) {
            const slot = this.room.getSlotByWs(ws);
            if (!slot || !this.tcNego) return;
            const v = qiMatchTimeControl.validateProposal(msg);
            if (!v.ok) {
                ws.send(JSON.stringify({ type: 'error', message: v.error }));
                this._qiResendNegotiationUi(ws);
                return;
            }
            const parsed = this._qiParseColorChoice(msg, slot);
            v.colorChoice = parsed.colorChoice;
            v.colorChooserSlot = parsed.colorChooserSlot;
            // 让子数按本棋种当前路数的星位夹一次（摆不下的直接当不让子）
            {
                const maxH = qiMaxHandicap(qiBoardSizeOf(this));
                const want = Number.isFinite(v.handicap) ? v.handicap : 0;
                v.handicap = maxH > 0 ? Math.max(0, Math.min(want, maxH)) : 0;
            }
            const room = this.room;
            if (slot !== this.tcNego.waitingSlot) {
                this._qiResendNegotiationUi(ws);
                return;
            }
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'player1' ? 'player2' : 'player1';
            this.tcNego.waitingSlot = other;
            const me = room.getPlayerBySlot(slot);
            if (me) me.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            // 对方已离开/座位空缺：单人直接完成协商，否则提案发不出去永远卡住（matchStarted 恒 false 无法落子）
            if (!room.getPlayerBySlot(other)) {
                if (typeof this._finalizeTimeControl === 'function') {
                    try { this._finalizeTimeControl(v); } catch (_) { /* ignore */ }
                }
                return;
            }
            this._qiSendRespondDialog(other, v);
        };

        const origFinalize = typeof self._finalizeTimeControl === 'function'
            ? self._finalizeTimeControl.bind(self) : null;
        self._finalizeTimeControl = function (valid) {
            const chooserSlot = (valid && valid.colorChooserSlot)
                || (this.tcNego && this.tcNego.lastProposerSlot)
                || this._firstPickerSlot();
            this._qiApplyChooserColorChoice((valid && valid.colorChoice) || 'black', chooserSlot);
            this._qiNotifyColorsFinalized();

            // 让子：设置记在棋种上（新局沿用），开局前把白子摆到星位（被让子的一方执白、黑先）。
            // 必须放在棋种自带 finalize 的转调**之前**——自带 finalize 的棋种（选点/一色/易位围棋等）会直接 return。
            this.handicap = valid && valid.handicap ? valid.handicap : 0;
            if (this.handicap > 0) qiApplyHandicap(this);

            // 有棋种自带 finalize（如选点围棋/五子：generateCandidates + gameState）时必须转调，
            // 否则选点/局面永远不会生成与下发。
            if (origFinalize) return origFinalize(valid);

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
            // 开局即判定：编辑盘面某方无将/帅/王则直接判负，行棋方无子可动则判和（象棋/国际象棋等实现 onMatchStarted）
            if (typeof this.onMatchStarted === 'function') {
                try { this.onMatchStarted(); } catch (e) { /* ignore */ }
            }
            if (this.gameOver) {
                try {
                    if (typeof this.getState === 'function') {
                        this.broadcast({ type: 'broadcast', action: 'matchStartOver', ...this.getState() });
                    }
                } catch (e) { /* ignore */ }
            }
            const now = Date.now();
            this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
            if (this.tcClock.timed) {
                // 起始扣时方 = 先手方所在座位：棋种导出 slotFromSide 时按执方换算，
                // 否则退回 sideToMove='red' / currentPlayer 记法（player1 座先手）。
                // 注意：本仓库所有 sideToMove 用 'white' 的棋种（国际象棋系/跳棋系）都是**白先、player1 执白**，
                // 所以 'white' 要落到 player1；反过来 'black' 才是 player2。
                let activeSlot = 'player1';
                const sideToMove = this.sideToMove != null ? this.sideToMove : null;
                if (typeof this.slotFromSide === 'function' && sideToMove != null) {
                    const mapped = this.slotFromSide(sideToMove);
                    if (mapped === 'player1' || mapped === 'player2') activeSlot = mapped;
                } else if (sideToMove === 'black') {
                    activeSlot = 'player2';
                } else if (this.currentPlayer === 2) {
                    activeSlot = 'player2';
                }
                qiMatchTimeControl.setActiveSlot(this.tcClock, activeSlot, now);
                if (typeof this._startClockTicker === 'function') this._startClockTicker();
                if (typeof this._broadcastClock === 'function') this._broadcastClock();
            } else {
                this.tcClock = null;
            }
            this.broadcast({
                type: 'timeControlAgreed',
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : null,
                slots: {
                    player1: !!this.room.getPlayerBySlot('player1'),
                    player2: !!this.room.getPlayerBySlot('player2')
                },
                hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null
            });
        };

        self._handleTimeControlAccept = function (ws) {
            const slot = this.room.getSlotByWs(ws);
            if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') {
                if (this.tcNego) this._qiResendNegotiationUi(ws);
                return;
            }
            if (slot !== this.tcNego.waitingSlot) {
                this._qiResendNegotiationUi(ws);
                return;
            }
            const prop = this.tcNego.proposal;
            if (!prop || prop.ok !== true) return;
            this._finalizeTimeControl(prop);
        };

        const enrichState = (state) => {
            if (!state || typeof state !== 'object') return state;
            state.hostSlot = self.hostWs ? self.room.getSlotByWs(self.hostWs) : null;
            state.boardSeatOverlay = true;
            if (self.matchStarted !== undefined) state.matchStarted = !!self.matchStarted;
            // 让子：当前设置 + 这个路数能选的上限（客户端据此显示下拉框与选项）
            state.handicap = Number(self.handicap) || 0;
            state.maxHandicap = qiMaxHandicap(qiBoardSizeOf(self));
            // 开局盘也随状态下发（没装 installStandardEditBoard 的棋种——如易位围棋——就靠这里带上让子）
            if (state.initialBoard == null && self.openingBoard && Array.isArray(self.openingBoard) && Array.isArray(self.openingBoard[0])) {
                const ob = typeof self.copyBoard === 'function' ? self.copyBoard(self.openingBoard) : copyBoard(self.openingBoard);
                if (ob != null) state.initialBoard = ob;
            }
            if (!state.sideLabels) {
                state.sideLabels = {
                    player1: qiSideLabelOfSlot(self, 'player1'),
                    player2: qiSideLabelOfSlot(self, 'player2')
                };
            }
            return state;
        };
        if (typeof self.getState === 'function') {
            const origGetState = self.getState.bind(self);
            self.getState = function () {
                return enrichState(origGetState());
            };
        }
        if (typeof self.getStateForClient === 'function') {
            const origGSC = self.getStateForClient.bind(self);
            self.getStateForClient = function (ws) {
                return enrichState(origGSC(ws));
            };
        }
        if (typeof self.getInitialState === 'function') {
            const origGIS = self.getInitialState.bind(self);
            self.getInitialState = function () {
                return enrichState(origGIS());
            };
        }

        const wrapReset = (name) => {
            if (typeof self[name] !== 'function') return;
            const orig = self[name].bind(self);
            self[name] = function (...args) {
                this.hostWs = null;
                return orig(...args);
            };
        };
        wrapReset('resetGame');
        wrapReset('resetToEmpty');

        if (typeof self.onPlayerLeave === 'function') {
            const origLeave = self.onPlayerLeave.bind(self);
            self.onPlayerLeave = function (ws) {
                const slot = this.room.getSlotByWs(ws);
                if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });
                if (this.hostWs === ws) {
                    const other = slot === 'player1'
                        ? this.room.getPlayerBySlot('player2')
                        : this.room.getPlayerBySlot('player1');
                    this.hostWs = other || null;
                }
                // 原 onPlayerLeave 可能再次 broadcast playerLeft；先清 slotJoinedAt / nego
                if (this.tcNego) {
                    this.tcNego = null;
                    this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
                }
                if (slot && this.slotJoinedAt) this.slotJoinedAt[slot] = null;
                // 调用原逻辑但不重复 playerLeft：临时 stub broadcast 中的 playerLeft
                const room = this.room;
                const origBroadcast = room.broadcast.bind(room);
                room.broadcast = function (data, exclude) {
                    if (data && data.type === 'playerLeft') return;
                    if (data && data.type === 'timeControlReset') return;
                    return origBroadcast(data, exclude);
                };
                try {
                    origLeave(ws);
                } finally {
                    room.broadcast = origBroadcast;
                }
                // 修复：协商提案已发给离开方时，剩下一方永远收不到提案（matchStarted 恒 false 无法落子）。
                // 离座清理 tcNego 后若双方仍在座，重新发起协商（对局已开始/已定限时则内部自行跳过）
                if (typeof this._maybeBeginTimeNegotiation === 'function') {
                    try { this._maybeBeginTimeNegotiation(); } catch (_) { /* ignore */ }
                }
            };
        } else {
            self.onPlayerLeave = function (ws) {
                const slot = this.room.getSlotByWs(ws);
                if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });
                if (this.hostWs === ws) {
                    const other = slot === 'player1'
                        ? this.room.getPlayerBySlot('player2')
                        : this.room.getPlayerBySlot('player1');
                    this.hostWs = other || null;
                }
                if (this.tcNego) {
                    this.tcNego = null;
                    this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
                }
                if (slot && this.slotJoinedAt) this.slotJoinedAt[slot] = null;
                if (typeof this._maybeBeginTimeNegotiation === 'function') {
                    try { this._maybeBeginTimeNegotiation(); } catch (_) { /* ignore */ }
                }
            };
        }

        const origHM = self.handleMessage.bind(self);
        self.handleMessage = function (ws, msg) {
            if (msg.type === 'selectColor' || msg.type === 'takeSeat') {
                if (typeof qiProtocol.takeSeat === 'function')
                    qiProtocol.takeSeat(this, ws, msg);
                else
                    qiProtocol.selectColor(this, ws, msg);
                return;
            }
            if (msg.type === 'leaveSeat') {
                qiProtocol.leaveSeat(this, ws);
                return;
            }
            if (msg.type === 'timeControlSubmit') {
                this._handleTimeControlSubmit(ws, msg);
                return;
            }
            if (msg.type === 'timeControlAccept') {
                this._handleTimeControlAccept(ws, msg);
                return;
            }
            return origHM(ws, msg);
        };

        // 标准空/黑/白编辑（自定义编辑的棋种设 useCustomEditBoard / applyEditBoard）
        qiProtocol.installStandardEditBoard(self);

        return self;
    }
};

module.exports = {
    normalizeQiRecordForImport,
    qiApplyRecordKomi,
    qiEffectiveKomi,
    copyBoard,
    boardToString,
    encodeInitialPositionCompact,
    encodeOpeningPositionCompact,
    applyInitialPositionCompact,
    assignBlackWhiteSlot,
    resolveHostTargetColor,
    applyHostColorChoice,
    qiBoardSeatOverlay,
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiMessageBoxOptions,
    squareWeiqiRules,
    gridGraphWeiqiRules,
    vertexGraphWeiqiRules,
    squareWuziqiRules,
    computeBensonWeiqiLead,
    computeNearestWeiqiLead,
    squareWeiqiScoringOps,
    gridGraphWeiqiScoringOps,
    qiSideLabelOfSlot,
    qiWinnerResultText,
    qiResultTextOfSeat,
    qiSeatOfResultText,
    qiStarPoints,
    qiHandicapStones,
    qiMaxHandicap,
    qiHandicapBoard,
    qiApplyHandicap,
    qiApplyHandicapFromRequest,
    qiBoardSizeOf
};
