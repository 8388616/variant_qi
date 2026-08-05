'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact } = require('../common');

/* ========== 数独求解器（精确、完备） ==========
 * 支持 N=9（宫 3×3）与 N=16（宫 4×4）。
 * 使用 bitmask + MRV + 裸单候选传播；判定「是否有解」完备且不会误判。
 */

function popcount32(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function bitIndex32(bit) {
    let i = 0;
    let b = bit >>> 1;
    while (b) {
        b >>>= 1;
        i++;
    }
    return i;
}

/**
 * 判断 N×N 数独盘面是否有解。
 * @param {number[][]} grid 0 表示空，其它为 1..N
 * @returns {boolean}
 */
function isSudokuSolvable(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return false;
    const n = grid.length;
    const box = Math.round(Math.sqrt(n));
    if (box * box !== n || (n !== 9 && n !== 16)) return false;
    for (let r = 0; r < n; r++) {
        if (!Array.isArray(grid[r]) || grid[r].length !== n) return false;
    }

    const g = new Int8Array(n * n);
    const rowMask = new Uint32Array(n);
    const colMask = new Uint32Array(n);
    const boxMask = new Uint32Array(n);
    const ALL = n === 16 ? 0xffff : 0x1ff;

    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const v = grid[r][c] | 0;
            const idx = r * n + c;
            if (v === 0) {
                g[idx] = 0;
                continue;
            }
            if (v < 1 || v > n) return false;
            const bit = 1 << (v - 1);
            const b = ((r / box) | 0) * box + ((c / box) | 0);
            if ((rowMask[r] & bit) || (colMask[c] & bit) || (boxMask[b] & bit)) return false;
            rowMask[r] |= bit;
            colMask[c] |= bit;
            boxMask[b] |= bit;
            g[idx] = v;
        }
    }

    function candMask(r, c) {
        const b = ((r / box) | 0) * box + ((c / box) | 0);
        return ALL & ~(rowMask[r] | colMask[c] | boxMask[b]);
    }

    function place(r, c, bit) {
        const v = bitIndex32(bit) + 1;
        g[r * n + c] = v;
        const b = ((r / box) | 0) * box + ((c / box) | 0);
        rowMask[r] |= bit;
        colMask[c] |= bit;
        boxMask[b] |= bit;
    }

    function unplace(r, c, bit) {
        g[r * n + c] = 0;
        const b = ((r / box) | 0) * box + ((c / box) | 0);
        rowMask[r] ^= bit;
        colMask[c] ^= bit;
        boxMask[b] ^= bit;
    }

    /** 反复填入唯一候选；若出现空格无候选则失败。返回是否仍一致。 */
    function propagate() {
        let changed = true;
        while (changed) {
            changed = false;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (g[r * n + c] !== 0) continue;
                    const m = candMask(r, c);
                    if (m === 0) return false;
                    if ((m & (m - 1)) === 0) {
                        place(r, c, m);
                        changed = true;
                    }
                }
            }
            // 隐式唯一：某数字在行/列/宫内只剩一格可填
            for (let d = 0; d < n; d++) {
                const bit = 1 << d;
                for (let r = 0; r < n; r++) {
                    if (rowMask[r] & bit) continue;
                    let onlyC = -1;
                    for (let c = 0; c < n; c++) {
                        if (g[r * n + c] !== 0) continue;
                        if (candMask(r, c) & bit) {
                            if (onlyC >= 0) {
                                onlyC = -2;
                                break;
                            }
                            onlyC = c;
                        }
                    }
                    if (onlyC === -1) return false;
                    if (onlyC >= 0) {
                        place(r, onlyC, bit);
                        changed = true;
                    }
                }
                for (let c = 0; c < n; c++) {
                    if (colMask[c] & bit) continue;
                    let onlyR = -1;
                    for (let r = 0; r < n; r++) {
                        if (g[r * n + c] !== 0) continue;
                        if (candMask(r, c) & bit) {
                            if (onlyR >= 0) {
                                onlyR = -2;
                                break;
                            }
                            onlyR = r;
                        }
                    }
                    if (onlyR === -1) return false;
                    if (onlyR >= 0) {
                        place(onlyR, c, bit);
                        changed = true;
                    }
                }
                for (let br = 0; br < box; br++) {
                    for (let bc = 0; bc < box; bc++) {
                        const b = br * box + bc;
                        if (boxMask[b] & bit) continue;
                        let onlyR = -1;
                        let onlyC = -1;
                        const r0 = br * box;
                        const c0 = bc * box;
                        outer: for (let dr = 0; dr < box; dr++) {
                            for (let dc = 0; dc < box; dc++) {
                                const r = r0 + dr;
                                const c = c0 + dc;
                                if (g[r * n + c] !== 0) continue;
                                if (candMask(r, c) & bit) {
                                    if (onlyR >= 0) {
                                        onlyR = -2;
                                        break outer;
                                    }
                                    onlyR = r;
                                    onlyC = c;
                                }
                            }
                        }
                        if (onlyR === -1) return false;
                        if (onlyR >= 0) {
                            place(onlyR, onlyC, bit);
                            changed = true;
                        }
                    }
                }
            }
        }
        return true;
    }

    function snapshot() {
        return {
            g: Int8Array.from(g),
            row: Uint32Array.from(rowMask),
            col: Uint32Array.from(colMask),
            box: Uint32Array.from(boxMask)
        };
    }

    function restore(s) {
        g.set(s.g);
        rowMask.set(s.row);
        colMask.set(s.col);
        boxMask.set(s.box);
    }

    function solve() {
        if (!propagate()) return false;

        let bestIdx = -1;
        let bestMask = 0;
        let bestCount = 99;
        for (let i = 0; i < n * n; i++) {
            if (g[i] !== 0) continue;
            const r = (i / n) | 0;
            const c = i - r * n;
            const m = candMask(r, c);
            const cnt = popcount32(m);
            if (cnt === 0) return false;
            if (cnt < bestCount) {
                bestCount = cnt;
                bestMask = m;
                bestIdx = i;
                if (cnt === 1) break;
            }
        }
        if (bestIdx < 0) return true;

        const r = (bestIdx / n) | 0;
        const c = bestIdx - r * n;
        let m = bestMask;
        const snap = snapshot();
        while (m) {
            const bit = m & -m;
            m ^= bit;
            restore(snap);
            place(r, c, bit);
            if (solve()) return true;
        }
        restore(snap);
        return false;
    }

    return solve();
}

function emptyDigitBoard(size) {
    return Array(size).fill(null).map(() => Array(size).fill(0));
}

/** 双方背包：下标 1..N 为 true 表示该数字可用 */
function initialBagAvail(size) {
    const bag = new Array(size + 1).fill(false);
    for (let d = 1; d <= size; d++) bag[d] = true;
    return bag;
}

function copyBagAvail(bag) {
    return bag.slice();
}

function bagRefreshPeriod(boardSize) {
    return boardSize === 16 ? 31 : 17;
}

function copyBoard2d(src) {
    return src.map(row => row.slice());
}

/**
 * 落子并按标准围棋规则提子（先对方、再己方，允许自提）。
 * 同步维护数字盘；被提子的数字列入 returnedDigits。
 */
function tryPlaceSudokuStone(board, digitBoard, boardSize, row, col, playerVal, digit) {
    if (board[row][col] !== 0) return null;
    const newBoard = copyBoard2d(board);
    const newDigits = copyBoard2d(digitBoard);
    newBoard[row][col] = playerVal;
    newDigits[row][col] = digit;

    const returnedDigits = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    function removeGroup(r0, c0, color) {
        const queue = [[r0, c0]];
        newBoard[r0][c0] = 0;
        if (newDigits[r0][c0]) {
            returnedDigits.push(newDigits[r0][c0]);
            newDigits[r0][c0] = 0;
        }
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (newBoard[nr][nc] === color) {
                    newBoard[nr][nc] = 0;
                    if (newDigits[nr][nc]) {
                        returnedDigits.push(newDigits[nr][nc]);
                        newDigits[nr][nc] = 0;
                    }
                    queue.push([nr, nc]);
                }
            }
        }
    }

    const enemy = 3 - playerVal;
    const checked = new Set();
    for (const [dr, dc] of dirs) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
        if (newBoard[nr][nc] !== enemy) continue;
        const key = nr + ',' + nc;
        if (checked.has(key)) continue;
        checked.add(key);
        if (squareWeiqiRules.countGroupLiberties(newBoard, nr, nc, boardSize) < 1) {
            removeGroup(nr, nc, enemy);
        }
    }

    if (squareWeiqiRules.countGroupLiberties(newBoard, row, col, boardSize) < 1) {
        // 自提：整块己方含新子被提掉
        if (newBoard[row][col] === playerVal) {
            removeGroup(row, col, playerVal);
        }
    }

    return { board: newBoard, digitBoard: newDigits, returnedDigits };
}

function encodeMoveToRecordString(m) {
    const prefix = m.player === 'black' ? 'B' : 'W';
    if (m.type === 'pass') return `${prefix}p`;
    if (m.type === 'invalid') return `${prefix}!${m.row},${m.col},${m.digit}`;
    return `${prefix}${m.row},${m.col},${m.digit}`;
}

function parseSudokuMoveString(entry) {
    if (typeof entry !== 'string' || entry.length < 2) return null;
    const player = entry[0] === 'B' ? 'black' : 'white';
    if (entry[1] === 'p') return { type: 'pass', player };
    if (entry[1] === '!') {
        const parts = entry.slice(2).split(',');
        if (parts.length < 3) return null;
        const row = parseInt(parts[0], 10);
        const col = parseInt(parts[1], 10);
        const digit = parseInt(parts[2], 10);
        if (![row, col, digit].every(Number.isInteger)) return null;
        return { type: 'invalid', player, row, col, digit };
    }
    const parts = entry.slice(1).split(',');
    if (parts.length < 3) return null;
    const row = parseInt(parts[0], 10);
    const col = parseInt(parts[1], 10);
    const digit = parseInt(parts[2], 10);
    if (![row, col, digit].every(Number.isInteger)) return null;
    return { type: 'move', player, row, col, digit };
}

class SudokuWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 9) {
        super(room);
        const size = initialSize === 16 ? 16 : 9;
        this.boardSize = size;
        this.board = Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(0));
        this.digitBoard = emptyDigitBoard(this.boardSize);
        this.blackBagAvail = initialBagAvail(this.boardSize);
        this.whiteBagAvail = initialBagAvail(this.boardSize);
        this.openingBoard = this.copyBoard(this.board);
        this.openingDigitBoard = emptyDigitBoard(this.boardSize);
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet = new Set();
        this.koStack = [];
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        this.hostWs = null;
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

    _clearTimeNegotiation(reason) {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset', reason: reason || 'cleared' });
    }

    _firstPickerSlot() {
        if (this.hostWs) {
            const hs = this.room.getSlotByWs(this.hostWs);
            if (hs) return hs;
        }
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
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'propose',
                boardSeatOverlay: !!this.boardSeatOverlay
            }));
        }
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        if (!this.hostWs) this.hostWs = ws;
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _applyChooserColorChoice(colorChoice, chooserSlot) {
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
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        this.slotJoinedAt.black = tw;
        this.slotJoinedAt.white = tb;
        return target;
    }

    _notifyColorsAfterHostChoice() {
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
    }

    _finalizeTimeControl(valid) {
        if (this.boardSeatOverlay) {
            const chooserSlot = (valid && valid.colorChooserSlot)
                || (this.tcNego && this.tcNego.lastProposerSlot)
                || this._firstPickerSlot();
            this._applyChooserColorChoice((valid && valid.colorChoice) || 'black', chooserSlot);
            this._notifyColorsAfterHostChoice();
        }
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
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null
        });
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                boardSeatOverlay: !!this.boardSeatOverlay,
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
        }
    }

    _resendNegotiationUi(ws) {
        if (!this.tcNego || !ws) return;
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'propose') {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'propose',
                boardSeatOverlay: !!this.boardSeatOverlay
            }));
            return;
        }
        if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'respond' && this.tcNego.proposal) {
            this._sendRespondDialog(slot, this.tcNego.proposal);
            return;
        }
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            this._resendNegotiationUi(ws);
            return;
        }
        if (this.boardSeatOverlay) {
            const raw = msg && msg.colorChoice;
            if (raw === 'black' || raw === 'hostBlack') v.colorChoice = 'black';
            else if (raw === 'white' || raw === 'hostWhite') v.colorChoice = 'white';
            else if (raw === 'random') v.colorChoice = 'random';
            else v.colorChoice = 'black';
            v.colorChooserSlot = slot;
        }
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) {
                this._resendNegotiationUi(ws);
                return;
            }
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
            if (slot !== this.tcNego.waitingSlot) {
                this._resendNegotiationUi(ws);
                return;
            }
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') {
            if (this.tcNego) this._resendNegotiationUi(ws);
            return;
        }
        if (slot !== this.tcNego.waitingSlot) {
            this._resendNegotiationUi(ws);
            return;
        }
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

    boardToString(board, digitBoard) {
        const db = digitBoard || this.digitBoard;
        const rows = [];
        for (let r = 0; r < this.boardSize; r++) {
            const cells = [];
            for (let c = 0; c < this.boardSize; c++) {
                cells.push(`${board[r][c]}:${db[r][c] || 0}`);
            }
            rows.push(cells.join(','));
        }
        return rows.join(';');
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
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
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

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color, digit: m.digit }));
    }

    getState() {
        return {
            boardSize: this.boardSize,
            komi: 3.25,
            board: this.board,
            digitBoard: this.digitBoard,
            blackBagAvail: copyBagAvail(this.blackBagAvail),
            whiteBagAvail: copyBagAvail(this.whiteBagAvail),
            initialBoard: this.openingBoard ? this.copyBoard(this.openingBoard) : this.copyBoard(this.board),
            numberOfHands: 1 + this.historyStacks.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
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
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    pushSnapshot() {
        this.historyStacks.push({
            board: copyBoard2d(this.board),
            digitBoard: copyBoard2d(this.digitBoard),
            blackBagAvail: copyBagAvail(this.blackBagAvail),
            whiteBagAvail: copyBagAvail(this.whiteBagAvail)
        });
    }

    _bagOf(slot) {
        return slot === 'black' ? this.blackBagAvail : this.whiteBagAvail;
    }

    /** 第 17n（16 路为 31n）手下完后，双方背包全部刷新为可用 */
    _maybeRefreshBags() {
        const period = bagRefreshPeriod(this.boardSize);
        if (this.moveCoords.length > 0 && this.moveCoords.length % period === 0) {
            this.blackBagAvail = initialBagAvail(this.boardSize);
            this.whiteBagAvail = initialBagAvail(this.boardSize);
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyStacks.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyStacks.length > 0) {
                this.historyStacks.pop();
                const ko = this.koStack.pop();
                if (ko) this.historyBoardSet.delete(ko);
            }
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historyStacks.length === 0) {
            this.board = this.openingBoard
                ? copyBoard2d(this.openingBoard)
                : Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(0));
            this.digitBoard = this.openingDigitBoard
                ? copyBoard2d(this.openingDigitBoard)
                : emptyDigitBoard(this.boardSize);
            this.blackBagAvail = initialBagAvail(this.boardSize);
            this.whiteBagAvail = initialBagAvail(this.boardSize);
        } else {
            const s = this.historyStacks[this.historyStacks.length - 1];
            this.board = copyBoard2d(s.board);
            this.digitBoard = copyBoard2d(s.digitBoard);
            this.blackBagAvail = copyBagAvail(s.blackBagAvail);
            this.whiteBagAvail = copyBagAvail(s.whiteBagAvail);
        }
        this.passCounter = 0;
        for (let i = this.moveCoords.length - 1; i >= 0; i--) {
            if (this.moveCoords[i].type === 'pass') this.passCounter++;
            else break;
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    resetGame() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(0));
        this.digitBoard = emptyDigitBoard(this.boardSize);
        this.blackBagAvail = initialBagAvail(this.boardSize);
        this.whiteBagAvail = initialBagAvail(this.boardSize);
        this.openingBoard = this.copyBoard(this.board);
        this.openingDigitBoard = emptyDigitBoard(this.boardSize);
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (newSize !== 9 && newSize !== 16) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '数独围棋仅支持 9 路或 16 路' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(0));
        this.digitBoard = emptyDigitBoard(this.boardSize);
        this.blackBagAvail = initialBagAvail(this.boardSize);
        this.whiteBagAvail = initialBagAvail(this.boardSize);
        this.openingBoard = this.copyBoard(this.board);
        this.openingDigitBoard = emptyDigitBoard(this.boardSize);
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
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

    exportRecord() {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '数独围棋',
            gameId: 'sudoku-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(this.openingBoard || this.board, this.boardSize),
            initialDigits: this._encodeDigitsCompact(this.openingDigitBoard || this.digitBoard),
            moves: this.moveCoords.map(m => encodeMoveToRecordString(m)),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: resultText
        };
    }

    _encodeDigitsCompact(digitBoard) {
        const out = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const d = digitBoard[r][c];
                if (d) out.push(`${d}@${r},${c}`);
            }
        }
        return out;
    }

    _applyDigitsCompact(digitBoard, list) {
        if (!Array.isArray(list)) return;
        for (const s of list) {
            if (typeof s !== 'string') continue;
            const at = s.indexOf('@');
            if (at <= 0) continue;
            const digit = parseInt(s.slice(0, at), 10);
            const comma = s.indexOf(',', at);
            if (comma < 0) continue;
            const row = parseInt(s.slice(at + 1, comma), 10);
            const col = parseInt(s.slice(comma + 1), 10);
            if (!Number.isInteger(digit) || !Number.isInteger(row) || !Number.isInteger(col)) continue;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) continue;
            if (digit < 1 || digit > this.boardSize) continue;
            digitBoard[row][col] = digit;
        }
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'sudoku-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要数独围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (newSize !== 9 && newSize !== 16) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this._applyDigitsCompact(this.digitBoard, data.initialDigits);
        this.openingBoard = this.copyBoard(this.board);
        this.openingDigitBoard = copyBoard2d(this.digitBoard);
        this.blackBagAvail = initialBagAvail(this.boardSize);
        this.whiteBagAvail = initialBagAvail(this.boardSize);

        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const move = parseSudokuMoveString(rawMoves[i]);
            if (!move) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱解析失败：第${i + 1}手格式无效` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            const myBag = this._bagOf(slot);

            if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.koStack.push(null);
                this._maybeRefreshBags();
                this.pushSnapshot();
                continue;
            }

            if (move.type === 'invalid') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'invalid',
                    player: slot,
                    row: move.row,
                    col: move.col,
                    digit: move.digit
                });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.lastMoveMarkers = [];
                this.koStack.push(null);
                this._maybeRefreshBags();
                this.pushSnapshot();
                continue;
            }

            const { row, col, digit } = move;
            if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (digit < 1 || digit > this.boardSize || !myBag[digit]) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手棋子不可用` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            myBag[digit] = false;
            const placed = tryPlaceSudokuStone(
                this.board, this.digitBoard, this.boardSize, row, col, playerVal, digit
            );
            if (!placed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            for (const d of placed.returnedDigits) myBag[d] = true;

            if (!isSudokuSolvable(placed.digitBoard)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手数独无解（应为 invalid）` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const newBoardStr = this.boardToString(placed.board, placed.digitBoard);
            if (this.historyBoardSet.has(newBoardStr)) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            this.board = placed.board;
            this.digitBoard = placed.digitBoard;
            this.historyBoardSet.add(newBoardStr);
            this.koStack.push(newBoardStr);
            this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
            this.moveHistory.push(slot);
            this.moveCoords.push({ type: 'move', player: slot, row, col, digit });
            this.lastMoveMarkers = [{ row, col, color: playerVal, digit }];
            this.currentPlayer = 3 - this.currentPlayer;
            this.passCounter = 0;
            this._maybeRefreshBags();
            this.pushSnapshot();
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = SudokuWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw')) {
                this.winner = data.result;
            }
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                initialDigits: data.initialDigits || [],
                moves: this.moveCoords.map(m => encodeMoveToRecordString(m))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });

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

    _commitInvalidMove(slot, row, col, digit) {
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'invalid', player: slot, row, col, digit });
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this.lastMoveMarkers = [];
        this.koStack.push(null);
        this._maybeRefreshBags();
        this.pushSnapshot();
        this.broadcast({
            type: 'broadcast',
            action: 'invalidSudoku',
            message: '此手会导致数独无解。',
            attempted: { row, col, digit, player: slot },
            ...this.getState()
        });
        this._syncClockAfterTurnChange();
    }

    _commitValidMove(slot, playerVal, row, col, digit, placed, newBoardStr) {
        this.board = placed.board;
        this.digitBoard = placed.digitBoard;
        this.historyBoardSet.add(newBoardStr);
        this.koStack.push(newBoardStr);
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col, digit });
        this.lastMoveMarkers = [{ row, col, color: playerVal, digit }];
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this._maybeRefreshBags();
        this.pushSnapshot();
        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
            case 'takeSeat': {
                if (typeof qiProtocol.takeSeat === 'function') {
                    qiProtocol.takeSeat(this, ws, msg);
                    break;
                }
                if (this.gameOver) break;
                let color = (msg.color === 'black' || msg.color === 'white') ? msg.color : null;
                if (!this.matchStarted) {
                    if (!this.room.getPlayerBySlot('black')) color = 'black';
                    else if (!this.room.getPlayerBySlot('white')) color = 'white';
                    else break;
                } else if (!color) {
                    ws.send(JSON.stringify({ type: 'error', message: '请选择继续执黑或执白。' }));
                    break;
                }
                qiProtocol.selectColor(this, ws, { color }, {
                    colorOccupiedMsg: this.matchStarted ? '该座位已被占用。' : '双方均已落座。'
                });
                break;
            }

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;

                const { row, col } = msg;
                const digit = parseInt(String(msg.digit ?? msg.level ?? ''), 10);
                if (!Number.isInteger(row) || !Number.isInteger(col)) return;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                if (!Number.isInteger(digit) || digit < 1 || digit > this.boardSize) return;
                const myBag = this._bagOf(slot);
                if (!myBag[digit]) {
                    ws.send(JSON.stringify({ type: 'error', message: '该数字棋子当前不可用' }));
                    return;
                }

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const bagSnapB = copyBagAvail(this.blackBagAvail);
                const bagSnapW = copyBagAvail(this.whiteBagAvail);

                myBag[digit] = false;
                const placed = tryPlaceSudokuStone(
                    this.board, this.digitBoard, this.boardSize, row, col, playerVal, digit
                );
                if (!placed) {
                    this.blackBagAvail = bagSnapB;
                    this.whiteBagAvail = bagSnapW;
                    return;
                }
                for (const d of placed.returnedDigits) myBag[d] = true;

                const newBoardStr = this.boardToString(placed.board, placed.digitBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.blackBagAvail = bagSnapB;
                    this.whiteBagAvail = bagSnapW;
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }

                if (!this._drainClockBeforeMove(moveSlot)) {
                    this.blackBagAvail = bagSnapB;
                    this.whiteBagAvail = bagSnapW;
                    return;
                }

                if (!isSudokuSolvable(placed.digitBoard)) {
                    this.blackBagAvail = bagSnapB;
                    this.whiteBagAvail = bagSnapW;
                    this._commitInvalidMove(slot, row, col, digit);
                    return;
                }

                this._commitValidMove(slot, playerVal, row, col, digit, placed, newBoardStr);
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(passSlot)) return;
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;

                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.koStack.push(null);
                this._maybeRefreshBags();
                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;
            }

            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyStacks.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
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
                {
                    const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                    if (!endOpponent) {
                        this.startScoreCounting(ws, ws);
                    } else {
                        this.pendingEnd = { requester: ws, opponent: endOpponent };
                        endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                    }
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
}

module.exports = {
    SudokuWeiqiRoom,
    isSudokuSolvable,
    tryPlaceSudokuStone,
    initRoom(room) {
        room.gameLogic = new SudokuWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
