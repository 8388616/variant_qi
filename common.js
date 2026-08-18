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
function encodeInitialPositionCompact(board, boardSize) {
    const out = [];
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
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

function applyInitialPositionCompact(board, boardSize, initialPosition) {
    if (!initialPosition || !Array.isArray(initialPosition)) return;
    for (const s of initialPosition) {
        if (typeof s !== 'string' || s.length < 3) continue;
        const prefix = s[0];
        if (prefix !== 'B' && prefix !== 'W' && prefix !== 'N' && prefix !== 'H' && prefix !== 'I' && prefix !== 'M') continue;
        const comma = s.indexOf(',');
        if (comma <= 1) continue;
        const r = parseInt(s.slice(1, comma), 10);
        const c = parseInt(s.slice(comma + 1), 10);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
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
            const cc = String(msg.colorChoice);
            if (cc !== 'hostBlack' && cc !== 'hostWhite' && cc !== 'random'
                && cc !== 'black' && cc !== 'white')
                return { ok: false, error: '执子选项无效。' };
            result.colorChoice = cc === 'hostBlack' ? 'black' : (cc === 'hostWhite' ? 'white' : cc);
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
                activeSlot: 'black',
                lastUpdateMs: t,
                black: { mainMs: 0, inByo: false, byoMs: 0, timeoutsUsed: 0 },
                white: { mainMs: 0, inByo: false, byoMs: 0, timeoutsUsed: 0 },
                mainMinutes: 0,
                byoyomiSeconds: 0,
                maxTimeouts: 0
            };
        }
        const mainMs = settings.mainMinutes * 60 * 1000;
        return {
            timed: true,
            activeSlot: 'black',
            lastUpdateMs: t,
            mainMinutes: settings.mainMinutes,
            byoyomiSeconds: settings.byoyomiSeconds,
            maxTimeouts: settings.maxTimeouts,
            black: { mainMs, inByo: false, byoMs: 0, timeoutsUsed: 0 },
            white: { mainMs, inByo: false, byoMs: 0, timeoutsUsed: 0 }
        };
    },

    /**
     * 将 elapsed 毫秒扣在 clock[slot]（黑/白）上；可能触发判负。
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
                    elapsedLeft -= take;
                    continue;
                }
                p.inByo = true;
                p.mainMs = 0;
                if (clock.byoyomiSeconds <= 0) {
                    return { lostSlot: slot, winnerSlot: slot === 'black' ? 'white' : 'black' };
                }
                p.byoMs = byoMsFull;
                continue;
            }
            if (p.byoMs > 0) {
                const take = Math.min(elapsedLeft, p.byoMs);
                p.byoMs -= take;
                elapsedLeft -= take;
            }
            if (p.byoMs <= 0) {
                if (p.timeoutsUsed < clock.maxTimeouts) {
                    p.timeoutsUsed++;
                    p.byoMs = byoMsFull;
                    continue;
                }
                return { lostSlot: slot, winnerSlot: slot === 'black' ? 'white' : 'black' };
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
        if (clock.blackRunning) {
            const r = this.applyElapsedToSlot(clock, 'black', elapsed);
            if (r.lostSlot) {
                clock.lastUpdateMs = nowMs;
                return r;
            }
        }
        if (clock.whiteRunning) {
            const r = this.applyElapsedToSlot(clock, 'white', elapsed);
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
        if (slot === 'black') clock.blackRunning = false;
        else if (slot === 'white') clock.whiteRunning = false;
        clock.lastUpdateMs = t;
        return { lostSlot: null, winnerSlot: null };
    },

    /** 同步围棋：双方均提交并结算后，下一手窗口开始（读秒方重置到满读秒）。 */
    openSyncMoveWindow(clock, nowMs) {
        if (!clock || !clock.syncMode || !clock.timed) return;
        const t = nowMs != null ? nowMs : Date.now();
        if (clock.byoyomiSeconds > 0) {
            const full = clock.byoyomiSeconds * 1000;
            if (clock.black && clock.black.inByo) clock.black.byoMs = full;
            if (clock.white && clock.white.inByo) clock.white.byoMs = full;
        }
        clock.blackRunning = true;
        clock.whiteRunning = true;
        clock.lastUpdateMs = t;
    },

    createSyncClock(settings, nowMs) {
        const c = this.createClock(settings, nowMs);
        if (!c.timed) return c;
        c.syncMode = true;
        c.blackRunning = true;
        c.whiteRunning = true;
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
            if (clock.black && clock.black.inByo) clock.black.byoMs = full;
            if (clock.white && clock.white.inByo) clock.white.byoMs = full;
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
     * 客户端展示用快照（当前思考方剩余显示）
     * @returns {{ serverNow: number, timed: boolean, activeSlot: string, black: object, white: object, ruleLine: string }}
     */
    snapshotForClient(clock) {
        if (!clock) {
            return { serverNow: Date.now(), timed: false, activeSlot: 'black', black: null, white: null, ruleLine: '' };
        }
        const now = Date.now();
        const c = {
            timed: clock.timed,
            activeSlot: clock.activeSlot,
            mainMinutes: clock.mainMinutes,
            byoyomiSeconds: clock.byoyomiSeconds,
            maxTimeouts: clock.maxTimeouts,
            serverNow: now,
            black: clock.black ? { ...clock.black } : null,
            white: clock.white ? { ...clock.white } : null,
            ruleLine: this.formatRuleLine(clock)
        };
        if (!clock.timed) return c;
        if (clock.syncMode) {
            c.syncMode = true;
            c.blackRunning = !!clock.blackRunning;
            c.whiteRunning = !!clock.whiteRunning;
            const b = clock.black;
            const w = clock.white;
            c.display = {
                syncMode: true,
                blackLive: c.blackRunning,
                whiteLive: c.whiteRunning,
                blackCountdownMs: b.inByo ? b.byoMs : b.mainMs,
                whiteCountdownMs: w.inByo ? w.byoMs : w.mainMs
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
    if (requestedSlot === 'black' && !room.getPlayerBySlot('black')) return 'black';
    if (requestedSlot === 'white' && !room.getPlayerBySlot('white')) return 'white';
    return null;
}

/** 房主执子选项 → 房主最终执黑/白 */
function resolveHostTargetColor(colorChoice) {
    if (colorChoice === 'hostWhite') return 'white';
    if (colorChoice === 'random') return Math.random() < 0.5 ? 'black' : 'white';
    return 'black';
}

/**
 * 按房主执子选项交换黑白座位（双方均已入座时）。
 * @returns {'black'|'white'|null} 房主最终颜色
 */
function applyHostColorChoice(room, hostWs, colorChoice) {
    if (!hostWs || !room) return null;
    const hostSlot = room.getSlotByWs(hostWs);
    if (!hostSlot) return null;
    const target = resolveHostTargetColor(colorChoice);
    if (hostSlot === target) return target;
    if (typeof room.swapSlots === 'function')
        room.swapSlots('black', 'white');
    else {
        const a = room.slotOccupancy.get('black') || null;
        const b = room.slotOccupancy.get('white') || null;
        room.slotOccupancy.delete('black');
        room.slotOccupancy.delete('white');
        if (a) {
            room.players.set(a, 'white');
            room.slotOccupancy.set('white', a);
        }
        if (b) {
            room.players.set(b, 'black');
            room.slotOccupancy.set('black', b);
        }
    }
    return target;
}

function parseQiRecordResultWinner(resultText) {
    if (typeof resultText !== 'string') return null;
    if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
    if (resultText === '和胜' || resultText === '平局') return 'draw';
    if (resultText.includes('白胜')) return 'white';
    if (resultText.includes('黑胜')) return 'black';
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
    const rawResult = out.result;
    if (self && self.gameOver) {
        if (typeof self.recordResultText === 'string' && self.recordResultText.length > 0) {
            out.result = self.recordResultText;
            return out;
        }
        const winner = self.winner;
        if (winner === 'draw') out.result = '和胜';
        else if (winner === 'black') out.result = '黑胜';
        else if (winner === 'white') out.result = '白胜';
        else if (typeof rawResult === 'string') {
            const parsed = parseQiRecordResultWinner(rawResult);
            if (parsed === 'draw') out.result = '和胜';
            else if (parsed === 'black') out.result = '黑胜';
            else if (parsed === 'white') out.result = '白胜';
        }
        return out;
    }
    if (typeof rawResult === 'string') {
        const parsed = parseQiRecordResultWinner(rawResult);
        if (parsed === 'draw') out.result = '和胜';
        else if (parsed === 'black') out.result = '黑胜';
        else if (parsed === 'white') out.result = '白胜';
    }
    return out;
}

function normalizeQiRecordForImport(data) {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    if (Object.prototype.hasOwnProperty.call(out, 'timeControl')) {
        out.timeControl = decodeCompactTimeControl(out.timeControl);
    } else {
        out.timeControl = null;
    }
    if (typeof out.result === 'string') {
        out.resultText = out.result;
        const parsed = parseQiRecordResultWinner(out.result);
        if (parsed) out.result = parsed;
    }
    return out;
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
            color = msg && (msg.color === 'black' || msg.color === 'white') ? msg.color : null;
            if (!color) {
                ws.send(JSON.stringify({ type: 'error', message: '请选择继续执黑或执白。' }));
                return;
            }
            if (!seatFree(color)) {
                ws.send(JSON.stringify({ type: 'error', message: occupiedMsg }));
                return;
            }
        } else {
            // 开局前不采纳客户端 color，按空位依次分配，避免两人同时点落座都抢黑
            if (seatFree('black')) color = 'black';
            else if (seatFree('white')) color = 'white';
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
        const raw = self.exportRecord();
        ws.send(JSON.stringify({ type: 'gameRecord', data: normalizeQiRecordForExport(self, raw) }));
    },

    importRecord(self, ws, msg, opts = {}) {
        const blockedMsg = opts.importBlockedMsg ?? '已有玩家入座，无法导入棋谱。';
        if (self.room.getPlayerBySlot('black') || self.room.getPlayerBySlot('white')) {
            ws.send(JSON.stringify({ type: 'error', message: blockedMsg }));
            return;
        }
        self.importRecord(normalizeQiRecordForImport(msg.data), ws);
    },

    /** 观战且无人入座时清空房间（需实现 resetToEmpty） */
    resetRoomToEmpty(self, ws) {
        if (self.room.getPlayerBySlot('black') || self.room.getPlayerBySlot('white')) return;
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
            const other = slot === 'black'
                ? room.getPlayerBySlot('white')
                : room.getPlayerBySlot('black');
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
        self.winner = slot === 'black' ? 'white' : 'black';
        if (typeof self.onResignResolved === 'function') self.onResignResolved(slot, self.winner);
        if (typeof opts.broadcastPerClient === 'function') {
            opts.broadcastPerClient('resign', { player: slot, winner: self.winner });
        } else {
            self.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: self.winner, ...self.getState() });
        }
    },

    requestNewGame(self, ws, slot) {
        const room = self.room;
        if (!room.getPlayerBySlot('black') && !room.getPlayerBySlot('white')) {
            self.resetGame();
            return;
        }
        if (!slot) return;
        const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
        const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
        const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
     * 五子棋类：historyBoards 存落子前棋盘，悔棋时 pop 恢复。
     * currentPlayer 为 1/2。
     */
    undoWuziqiHistory(self, ws, msg, slot) {
        if (!slot || self.gameOver) return;
        const room = self.room;
        const isMyTurn = (slot === 'black' && self.currentPlayer === 1) || (slot === 'white' && self.currentPlayer === 2);
        const steps = isMyTurn ? 2 : 1;
        if (self.historyBoards.length < steps) {
            ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
            return;
        }
        const opponentSlot = slot === 'black' ? 'white' : 'black';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) {
            for (let i = 0; i < steps; i++) {
                self.board = self.copyBoard(self.historyBoards.pop());
                self.moveHistory.pop();
            }
            let newPlayer = self.currentPlayer;
            for (let i = 0; i < steps; i++) newPlayer = newPlayer === 1 ? 2 : 1;
            self.currentPlayer = newPlayer;
            self.lastMoveMarkers = [];
            self.broadcast({ type: 'broadcast', action: 'undoAccept', ...self.getState() });
        } else {
            self.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    },

    undoResponseWuziqiHistory(self, ws, msg) {
        if (self.pendingUndo && msg.accept) {
            const steps = self.pendingUndo.steps;
            if (self.historyBoards.length >= steps) {
                for (let i = 0; i < steps; i++) {
                    self.board = self.copyBoard(self.historyBoards.pop());
                    self.moveHistory.pop();
                }
                let newPlayer = self.currentPlayer;
                for (let i = 0; i < steps; i++) newPlayer = newPlayer === 1 ? 2 : 1;
                self.currentPlayer = newPlayer;
                self.lastMoveMarkers = [];
                self.broadcast({ type: 'broadcast', action: 'undoAccept', ...self.getState() });
            }
        } else if (self.pendingUndo && !msg.accept) {
            self.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
        }
        self.pendingUndo = null;
    },

    /** 仅观战者可改路数：parseInt size，调用 setBoardSize(n, ws) */
    setBoardSizeObserverOnly(self, ws, msg, slot) {
        if (slot) return;
        const n = parseInt(String(msg.size ?? ''), 10);
        self.setBoardSize(n, ws);
    },

    /**
     * 围棋等：需同时满足 !slot 且房内无棋手（players.size===0）才可改路数。
     */
    setBoardSizeWeiqiObserver(self, ws, msg, slot) {
        if (!slot && !self.room.players.size) {
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

        if (typeof self.afterEditBoard === 'function') self.afterEditBoard();

        self.openingBoard = typeof self.copyBoard === 'function'
            ? self.copyBoard(self.board)
            : (mode === 'flat' ? self.board.slice() : (
                Array.isArray(self.board[0]) ? self.board.map((row) => row.slice()) : self.board.slice()
            ));
        if (Array.isArray(self.historyBoards)) self.historyBoards = [];
        if (self.historyBoardSet && typeof self.historyBoardSet.clear === 'function') {
            self.historyBoardSet.clear();
            if (typeof self.boardToString === 'function') {
                self.historyBoardSet.add(self.boardToString(self.board));
            }
        }
        if (Array.isArray(self.moveHistory)) self.moveHistory = [];
        if (Array.isArray(self.moveCoords)) self.moveCoords = [];
        if (Array.isArray(self.historyMarkers)) self.historyMarkers = [];
        self.currentPlayer = 1;
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
        if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
        const { row, col } = msg;
        if (row < 0 || row >= self.boardSize || col < 0 || col >= self.boardSize) return;
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
        if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
        if (typeof opts.beforeCommit === 'function' && opts.beforeCommit() === false) return;
        self.historyBoards.push(self.copyBoard(self.board));
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'pass', player: slot });
        self.currentPlayer = self.currentPlayer === 1 ? 2 : 1;
        self.passCounter++;
        self.lastMoveMarkers = [];
        self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
        if (self.passCounter >= 2) {
            const blackPlayer = room.getPlayerBySlot('black');
            const whitePlayer = room.getPlayerBySlot('white');
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
        const opponentSlot = slot === 'black' ? 'white' : 'black';
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
 * 棋盘落座蒙版：在已有限时协商的 Room 实例上安装房主/执子/takeSeat 等能力。
 * 各变体 initRoom 里对 gameLogic 调用一次即可。
 */
const qiBoardSeatOverlay = {
    install(self) {
        if (!self || self._qiBoardSeatOverlayInstalled) return self;
        self._qiBoardSeatOverlayInstalled = true;
        self.boardSeatOverlay = true;
        if (self.hostWs === undefined) self.hostWs = null;
        if (!self.slotJoinedAt) self.slotJoinedAt = { black: null, white: null };

        self._qiApplyChooserColorChoice = function (colorChoice, chooserSlot) {
            if (!chooserSlot) return null;
            const room = this.room;
            if (!room.getPlayerBySlot(chooserSlot)) return null;
            let raw = colorChoice;
            if (raw === 'hostWhite') raw = 'white';
            if (raw === 'hostBlack') raw = 'black';
            let target = 'black';
            if (raw === 'white') target = 'white';
            else if (raw === 'random') target = Math.random() < 0.5 ? 'black' : 'white';
            if (chooserSlot === target) return target;
            if (typeof room.swapSlots === 'function') {
                room.swapSlots('black', 'white');
            } else {
                const a = room.slotOccupancy.get('black') || null;
                const b = room.slotOccupancy.get('white') || null;
                room.slotOccupancy.delete('black');
                room.slotOccupancy.delete('white');
                if (a) {
                    room.players.set(a, 'white');
                    room.slotOccupancy.set('white', a);
                }
                if (b) {
                    room.players.set(b, 'black');
                    room.slotOccupancy.set('black', b);
                }
            }
            if (this.slotJoinedAt) {
                const tb = this.slotJoinedAt.black;
                const tw = this.slotJoinedAt.white;
                this.slotJoinedAt.black = tw;
                this.slotJoinedAt.white = tb;
            }
            return target;
        };

        self._qiNotifyColorsFinalized = function () {
            const room = this.room;
            const b = room.getPlayerBySlot('black');
            const w = room.getPlayerBySlot('white');
            const hostSlot = this.hostWs ? room.getSlotByWs(this.hostWs) : null;
            if (b) b.send(JSON.stringify({ type: 'colorAssigned', color: 'black', finalized: true, isHost: b === this.hostWs }));
            if (w) w.send(JSON.stringify({ type: 'colorAssigned', color: 'white', finalized: true, isHost: w === this.hostWs }));
            this.broadcast({
                type: 'colorsFinalized',
                slots: { black: !!b, white: !!w },
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
                    colorChooserSlot: proposal.colorChooserSlot || null
                }
            }));
        };

        self._qiParseColorChoice = function (msg, slot) {
            const raw = msg && msg.colorChoice;
            let colorChoice = 'black';
            if (raw === 'black' || raw === 'hostBlack') colorChoice = 'black';
            else if (raw === 'white' || raw === 'hostWhite') colorChoice = 'white';
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
            return origFirst ? origFirst() : 'black';
        };

        const origMaybe = typeof self._maybeBeginTimeNegotiation === 'function'
            ? self._maybeBeginTimeNegotiation.bind(self) : null;
        self._maybeBeginTimeNegotiation = function () {
            // 未接入限时协商的玩法（无 tcNego 字段）跳过
            if (this.tcNego === undefined) return;
            if (this.moveHistory && this.moveHistory.length > 0) return;
            if (this.gameOver) return;
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
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'timeControlNegotiation',
                    mode: 'propose',
                    boardSeatOverlay: true
                }));
            }
            const other = first === 'black' ? 'white' : 'black';
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
                const b = this.room.getPlayerBySlot('black');
                const w = this.room.getPlayerBySlot('white');
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
            const room = this.room;
            if (slot !== this.tcNego.waitingSlot) {
                this._qiResendNegotiationUi(ws);
                return;
            }
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'black' ? 'white' : 'black';
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
                // 象棋等：sideToMove 为 red/black；围棋等：currentPlayer 1/2 → 座位 black/white
                let activeSlot = 'black';
                if (this.sideToMove === 'red') activeSlot = 'black';
                else if (this.sideToMove === 'black') activeSlot = 'white';
                else if (this.currentPlayer === 2) activeSlot = 'white';
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
                    black: !!this.room.getPlayerBySlot('black'),
                    white: !!this.room.getPlayerBySlot('white')
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
                    const other = slot === 'black'
                        ? this.room.getPlayerBySlot('white')
                        : this.room.getPlayerBySlot('black');
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
                    const other = slot === 'black'
                        ? this.room.getPlayerBySlot('white')
                        : this.room.getPlayerBySlot('black');
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
    copyBoard,
    boardToString,
    encodeInitialPositionCompact,
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
    squareWuziqiRules
};
