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
        if (unlimited) return { ok: true, timed: false };
        const mainMinutes = parseInt(String(msg.mainMinutes ?? msg.mainMin ?? ''), 10);
        const byoyomiSeconds = parseInt(String(msg.byoyomiSeconds ?? msg.byoSec ?? ''), 10);
        const maxTimeouts = parseInt(String(msg.maxTimeouts ?? msg.periods ?? ''), 10);
        if (!Number.isFinite(mainMinutes) || !Number.isFinite(byoyomiSeconds) || !Number.isFinite(maxTimeouts)) {
            return { ok: false, error: '限时对局请填写主时间、读秒与超时次数。' };
        }
        if (mainMinutes < 1 || mainMinutes > 120) return { ok: false, error: '主时间须在 1～120 分钟之间。' };
        if (byoyomiSeconds < 0 || byoyomiSeconds > 180) return { ok: false, error: '读秒须在 0～180 秒之间。' };
        if (maxTimeouts < 0 || maxTimeouts > 20) return { ok: false, error: '超时次数须在 0～20 之间。' };
        return {
            ok: true,
            timed: true,
            mainMinutes,
            byoyomiSeconds,
            maxTimeouts
        };
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

    /** 数子等待等：暂停扣时（仍保留 lastUpdateMs） */
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
    checkFiveInRow(board, row, col, colorVal, boardSize) {
        if (board[row][col] !== colorVal) return false;
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                const nr = row + dx * step;
                const nc = col + dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                const nr = row - dx * step;
                const nc = col - dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
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
            ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
            self.sendState(ws);
            room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
            if (typeof self.afterColorAssigned === 'function') self.afterColorAssigned(ws, newSlot);
        } else {
            ws.send(JSON.stringify({ type: 'error', message: occupiedMsg }));
        }
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
        const denyMsg = opts.endDeniedMsg ?? '对方拒绝数子。';
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
        self.currentPlayer = 3 - self.currentPlayer;
        self.passCounter = 0;
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
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

module.exports = {
    copyBoard,
    boardToString,
    encodeInitialPositionCompact,
    applyInitialPositionCompact,
    assignBlackWhiteSlot,
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    squareWeiqiRules,
    gridGraphWeiqiRules,
    vertexGraphWeiqiRules,
    squareWuziqiRules
};
