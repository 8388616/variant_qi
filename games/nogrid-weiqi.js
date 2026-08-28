const COORD_SCALE = 1000000;
const BOARD_SIZE_PX = 600;
const PADDING = 25;
const INNER_SIZE = BOARD_SIZE_PX - 2 * PADDING;
const KOMI = 3.25;
const LIBERTY_ANGLE_STEP = Math.PI / 36;

function ixToX(ix) {
    return PADDING + (ix / COORD_SCALE) * INNER_SIZE;
}
function iyToY(iy) {
    return PADDING + (iy / COORD_SCALE) * INNER_SIZE;
}
function toIx(x) {
    return Math.round(((x - PADDING) / INNER_SIZE) * COORD_SCALE);
}
function toIy(y) {
    return Math.round(((y - PADDING) / INNER_SIZE) * COORD_SCALE);
}

function stoneXY(s) {
    return { x: ixToX(s.ix), y: iyToY(s.iy) };
}

function copyStones(src) {
    return src.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
}

function stonesEqual(a, b) {
    return a.ix === b.ix && a.iy === b.iy && a.color === b.color;
}

function isPointInBoardXY(x, y) {
    return x >= PADDING && x <= BOARD_SIZE_PX - PADDING && y >= PADDING && y <= BOARD_SIZE_PX - PADDING;
}

function distanceSq(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
}

function distance(p1, p2) {
    return Math.sqrt(distanceSq(p1, p2));
}

function segmentsIntersect(p1, p2, p3, p4) {
    function orientation(a, b, c) {
        const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
        if (Math.abs(val) < 1e-9) return 0;
        return val > 0 ? 1 : 2;
    }
    function onSegment(a, b, c) {
        return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) &&
            b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y);
    }
    const o1 = orientation(p1, p2, p3);
    const o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1);
    const o4 = orientation(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p3, p2)) return true;
    if (o2 === 0 && onSegment(p1, p4, p2)) return true;
    if (o3 === 0 && onSegment(p3, p1, p4)) return true;
    if (o4 === 0 && onSegment(p3, p2, p4)) return true;
    return false;
}

function areAdjacent(a, b, allStones, diameter) {
    if (a.color !== b.color) return false;
    const pa = stoneXY(a);
    const pb = stoneXY(b);
    const d = distance(pa, pb);
    if (d >= 2 * diameter) return false;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const halfAB = d / 2;
    for (let f of allStones) {
        if (stonesEqual(f, a) || stonesEqual(f, b)) continue;
        const pf = stoneXY(f);
        if (distance(pf, mid) < halfAB - 1e-7) return false;
    }
    for (let i = 0; i < allStones.length; i++) {
        for (let j = i + 1; j < allStones.length; j++) {
            const dStone = allStones[i];
            const eStone = allStones[j];
            if (stonesEqual(dStone, a) || stonesEqual(dStone, b) || stonesEqual(eStone, a) || stonesEqual(eStone, b)) continue;
            const pd = stoneXY(dStone);
            const pe = stoneXY(eStone);
            const deLen = distance(pd, pe);
            // 规则：DE < AB（严格小于）
            if (deLen < d - 1e-7 && segmentsIntersect(pa, pb, pd, pe)) return false;
        }
    }
    return true;
}

function getGroups(allStones, targetColor, diameter) {
    const visited = new Set();
    const groups = [];
    for (let i = 0; i < allStones.length; i++) {
        const s = allStones[i];
        if (s.color !== targetColor) continue;
        const key = `${s.ix},${s.iy}`;
        if (visited.has(key)) continue;
        const queue = [s];
        visited.add(key);
        const group = [s];
        while (queue.length) {
            const cur = queue.shift();
            for (let j = 0; j < allStones.length; j++) {
                const ns = allStones[j];
                if (ns.color !== targetColor) continue;
                const nKey = `${ns.ix},${ns.iy}`;
                if (visited.has(nKey)) continue;
                if (areAdjacent(cur, ns, allStones, diameter)) {
                    visited.add(nKey);
                    queue.push(ns);
                    group.push(ns);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function hasGroupLiberty(group, allStones, diameter) {
    const d2 = diameter * diameter;
    for (let stone of group) {
        const sxy = stoneXY(stone);
        for (let ang = 0; ang < 2 * Math.PI; ang += LIBERTY_ANGLE_STEP) {
            const px = sxy.x + diameter * Math.cos(ang);
            const py = sxy.y + diameter * Math.sin(ang);
            if (px < PADDING - 1e-5 || px > BOARD_SIZE_PX - PADDING + 1e-5 ||
                py < PADDING - 1e-5 || py > BOARD_SIZE_PX - PADDING + 1e-5) continue;
            let occupied = false;
            for (let s of allStones) {
                const t = stoneXY(s);
                const dx = px - t.x;
                const dy = py - t.y;
                if (dx * dx + dy * dy < d2 - 1e-7) {
                    occupied = true;
                    break;
                }
            }
            if (!occupied) return true;
        }
    }
    return false;
}

function isOverlapWithStonesXY(x, y, stones, diameter, excludeStone = null) {
    const d2 = diameter * diameter;
    for (let s of stones) {
        if (excludeStone && stonesEqual(s, excludeStone)) continue;
        const t = stoneXY(s);
        const dx = x - t.x;
        const dy = y - t.y;
        if (dx * dx + dy * dy < d2) return true;
    }
    return false;
}

/**
 * 执行落子与提子，返回新棋子列表，以及本手吃掉的对方棋子（用于劫）
 */
function applyMove(stones, moveStone, diameter) {
    let newStones = copyStones(stones);
    newStones.push(moveStone);
    const opponentColor = moveStone.color === 1 ? 2 : 1;
    let opponentRemoved = [];
    let changed = true;
    while (changed) {
        changed = false;
        const opponentGroups = getGroups(newStones, opponentColor, diameter);
        for (let group of opponentGroups) {
            if (!hasGroupLiberty(group, newStones, diameter)) {
                for (let g of group) opponentRemoved.push(g);
                newStones = newStones.filter(s => !group.some(g => stonesEqual(g, s)));
                changed = true;
            }
        }
        const selfGroups = getGroups(newStones, moveStone.color, diameter);
        for (let group of selfGroups) {
            if (!hasGroupLiberty(group, newStones, diameter)) {
                newStones = newStones.filter(s => !group.includes(s));
                changed = true;
            }
        }
    }
    return { newStones, opponentRemoved };
}

function opponentStonesRemoved(before, after, moverColor) {
    const opp = moverColor === 1 ? 2 : 1;
    const beforeOpp = before.filter(s => s.color === opp);
    const afterSet = new Set(after.filter(s => s.color === opp).map(s => `${s.ix},${s.iy}`));
    return beforeOpp.filter(s => !afterSet.has(`${s.ix},${s.iy}`));
}

function computeTerritoryLead(stones, roadCount) {
    const diameter = INNER_SIZE / roadCount;
    const totalArea = roadCount * roadCount;
    const stonesList = stones.map(s => ({ ...stoneXY(s), color: s.color }));
    let blackPixels = 0;
    let whitePixels = 0;
    let totalInsidePixels = 0;
    const width = BOARD_SIZE_PX;
    for (let y = 0; y < BOARD_SIZE_PX; y++) {
        for (let x = 0; x < width; x++) {
            if (x < PADDING || x > BOARD_SIZE_PX - PADDING || y < PADDING || y > BOARD_SIZE_PX - PADDING) continue;
            totalInsidePixels++;
            let minDistSq = Infinity;
            let bestColor = 0;
            let tie = false;
            for (let stone of stonesList) {
                const dx = x - stone.x;
                const dy = y - stone.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < minDistSq - 1e-7) {
                    minDistSq = distSq;
                    bestColor = stone.color;
                    tie = false;
                } else if (Math.abs(distSq - minDistSq) < 1e-7) {
                    tie = true;
                }
            }
            if (tie) {
                blackPixels += 0.5;
                whitePixels += 0.5;
            } else if (bestColor === 1) blackPixels += 1;
            else if (bestColor === 2) whitePixels += 1;
        }
    }
    const blackPoints = totalArea * (blackPixels / totalInsidePixels);
    const whitePoints = totalArea * (whitePixels / totalInsidePixels);
    const lead = blackPoints - whitePoints - 2 * KOMI;
    return { lead, blackPoints, whitePoints };
}

const { QiTwoPlayerRoomBase, qiMatchTimeControl, qiBoardSeatOverlay, encodeOpeningPositionCompact, qiProtocol } = require('../common');
class NogridWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.roadCount = 18;
        this.stones = [];
        this.currentPlayer = 1;
        this.historyStones = [];
        this.historyMeta = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        /** 劫：对方上一手落子棋子及其提子数（用于禁提回劫） */
        this.koLastPlaced = null;
        this.koPrevCaptureCount = 0;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        /** historyStones / historyMeta 与 move 同步：每手结束后棋盘与劫状态快照（与标准围棋 historyBoards 一致） */
    }

    get diameter() {
        return INNER_SIZE / this.roadCount;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        if (!this.room.getPlayerBySlot('black') || !this.room.getPlayerBySlot('white')) return;
        if (this.tcNego !== null || this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(slot) {
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
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
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
        return slot === (this.currentPlayer === 1 ? 'black' : 'white');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
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

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
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

    getState() {
        return {
            roadCount: this.roadCount,
            stones: copyStones(this.stones),
            numberOfHands: 1 + this.historyStones.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers.map(m => ({ ...m })),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords.map(m => ({ ...m })),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    computeLead() {
        return computeTerritoryLead(this.stones, this.roadCount).lead;
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

    tryMove(playerVal, ix, iy) {
        if (ix < 0 || ix > COORD_SCALE || iy < 0 || iy > COORD_SCALE) return { error: '坐标越界' };
        const x = ixToX(ix);
        const y = iyToY(iy);
        if (!isPointInBoardXY(x, y)) return { error: '落点在盘外' };
        const d = this.diameter;
        if (isOverlapWithStonesXY(x, y, this.stones, d, null)) return { error: '与已有棋子重叠' };

        const moveStone = { ix, iy, color: playerVal };
        const before = copyStones(this.stones);
        const { newStones } = applyMove(before, moveStone, d);

        const removedOpp = opponentStonesRemoved(before, newStones, playerVal);
        // 劫：对方上一手恰好提一子，本手若仅提回对方上一手所下那一子，则禁止
        if (this.koPrevCaptureCount === 1 && this.koLastPlaced &&
            removedOpp.length === 1 &&
            stonesEqual(removedOpp[0], this.koLastPlaced)) {
            return { error: '禁提回劫（对方上一手单提后不可立即提回该子）。' };
        }

        return { newStones, moveStone, removedOpp };
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyStones.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyStones.length > 0) this.historyStones.pop();
            if (this.historyMeta.length > 0) this.historyMeta.pop();
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyStones.length === 0) {
            this.stones = [];
            this.koLastPlaced = null;
            this.koPrevCaptureCount = 0;
        } else {
            this.stones = copyStones(this.historyStones[this.historyStones.length - 1]);
            const meta = this.historyMeta[this.historyMeta.length - 1];
            this.koLastPlaced = meta.koLastPlaced ? { ...meta.koLastPlaced } : null;
            this.koPrevCaptureCount = meta.koPrevCaptureCount;
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers) {
        return markers.map(m => {
            if (m.ix !== undefined) return { ix: m.ix, iy: m.iy, color: m.color };
            return { ...m };
        });
    }

    resetGame() {
        this._stopClockTicker();
        this.stones = [];
        this.currentPlayer = 1;
        this.historyStones = [];
        this.historyMeta = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.koLastPlaced = null;
        this.koPrevCaptureCount = 0;
        for (let [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.stones = [];
        this.currentPlayer = 1;
        this.historyStones = [];
        this.historyMeta = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.passCounter = 0;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.koLastPlaced = null;
        this.koPrevCaptureCount = 0;
    }

    exportRecord() {
        const mainMinutes = this.tcSettings && this.tcSettings.timed ? this.tcSettings.mainMinutes : 0;
        const byoyomiSeconds = this.tcSettings && this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0;
        const maxTimeouts = this.tcSettings && this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0;
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
        return {
            format: 'muzei',
            version: 1,
            gameType: '无格线围棋',
            gameId: 'nogrid-weiqi',
            roadCount: this.roadCount,
            komi: KOMI,
            coordScale: COORD_SCALE,
            players: { black: null, white: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                return p + m.ix + ',' + m.iy;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const rest = entry.substring(1);
            const parts = rest.split(',');
            return { type: 'move', player, ix: parseInt(parts[0], 10), iy: parseInt(parts[1], 10) };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'nogrid-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要无格线围棋棋谱）。' }));
            return;
        }
        const rc = data.roadCount || 18;
        if (!Number.isInteger(rc) || rc < 6 || rc > 20) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中路数无效' }));
            return;
        }

        this.roadCount = rc;
        this.resetToEmpty();

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(NogridWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { ix, iy } = move;
                if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标无效` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const beforeBoard = copyStones(this.stones);
                const r = this.tryMove(playerVal, ix, iy);
                if (r.error) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手 ${r.error}` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const removedOpp = opponentStonesRemoved(beforeBoard, r.newStones, playerVal);
                const captureCount = removedOpp.length;
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, ix, iy });
                this.stones = r.newStones;
                this.lastMoveMarkers = [{ ix, iy, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.koLastPlaced = { ix: r.moveStone.ix, iy: r.moveStone.iy, color: playerVal };
                this.koPrevCaptureCount = captureCount;
                this.historyStones.push(copyStones(this.stones));
                this.historyMeta.push({
                    koLastPlaced: this.koLastPlaced ? { ...this.koLastPlaced } : null,
                    koPrevCaptureCount: this.koPrevCaptureCount
                });
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.koLastPlaced = null;
                this.koPrevCaptureCount = 0;
                this.historyStones.push(copyStones(this.stones));
                this.historyMeta.push({
                    koLastPlaced: null,
                    koPrevCaptureCount: 0
                });
            }
        }

        if (typeof data.timeControl === 'string') {
            const m = data.timeControl.match(/^S(\d+),(\d+),(\d+)$/);
            if (m) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(m[1], 10),
                    byoyomiSeconds: parseInt(m[2], 10),
                    maxTimeouts: parseInt(m[3], 10)
                };
                this.matchStarted = true;
            }
        } else if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
                this.matchStarted = true;
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
                this.matchStarted = true;
            }
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = NogridWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);

        switch (msg.type) {
            case 'selectColor': {
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    this.room.setPlayerSlot(ws, newSlot);
                    this.afterColorAssigned(newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    this.room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                }
                break;
            }

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setRoadCount': {
                if (!slot && !this.room.players.size) {
                    const n = parseInt(msg.size, 10);
                    if (!Number.isInteger(n) || n < 6 || n > 20) {
                        ws.send(JSON.stringify({ type: 'error', message: '路数须在 6～20 之间' }));
                        return;
                    }
                    const hasStone = this.stones.length > 0;
                    const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
                    if (hasStone || hasPlayer) return;
                    this.roadCount = n;
                    this.broadcast({ type: 'roadCountChanged', roadCount: this.roadCount });
                }
                break;
            }

            case 'move': {
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const ix = msg.ix !== undefined ? msg.ix : toIx(msg.x);
                const iy = msg.iy !== undefined ? msg.iy : toIy(msg.y);
                const r = this.tryMove(playerVal, ix, iy);
                if (r.error) {
                    ws.send(JSON.stringify({ type: 'error', message: r.error }));
                    return;
                }
                const beforeBoard = copyStones(this.stones);
                const removedOpp = opponentStonesRemoved(beforeBoard, r.newStones, playerVal);
                const captureCount = removedOpp.length;

                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, ix, iy });
                this.stones = r.newStones;
                this.lastMoveMarkers = [{ ix, iy, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;

                this.koLastPlaced = { ix: r.moveStone.ix, iy: r.moveStone.iy, color: playerVal };
                this.koPrevCaptureCount = captureCount;

                this.historyStones.push(copyStones(this.stones));
                this.historyMeta.push({
                    koLastPlaced: this.koLastPlaced ? { ...this.koLastPlaced } : null,
                    koPrevCaptureCount: this.koPrevCaptureCount
                });

                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.koLastPlaced = null;
                this.koPrevCaptureCount = 0;

                this.historyStones.push(copyStones(this.stones));
                this.historyMeta.push({
                    koLastPlaced: null,
                    koPrevCaptureCount: 0
                });

                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    this.passCounter = 0;
                    const blackPlayer = this.room.getPlayerBySlot('black');
                    const whitePlayer = this.room.getPlayerBySlot('white');
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
                if (steps === 0 || steps > this.historyStones.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = this.room.getPlayerBySlot(opponentSlot);
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse': {
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;
            }

            case 'resign': {
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.onResignResolved(slot);
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;
            }

            case 'requestNewGame': {
                if (!slot) return;
                const opp = this.room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!opp) this.resetGame();
                else {
                    this.pendingNewGame = ws;
                    opp.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;
            }

            case 'newGameResponse': {
                if (this.pendingNewGame && msg.accept) this.resetGame();
                else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                }
                this.pendingNewGame = null;
                break;
            }

            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                const opp = this.room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!opp) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    opp.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;
            }

            case 'drawResponse': {
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;
            }

            case 'requestEnd': {
                if (!slot) return;
                const opp = this.room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!opp) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: opp };
                    opp.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;
            }

            case 'endResponse': {
                if (this.pendingEnd && msg.accept) {
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                } else if (this.pendingEnd && !msg.accept) {
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                }
                this.pendingEnd = null;
                break;
            }

            case 'scoreResponse': {
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
            }

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord': {
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;
            }

            case 'resetRoom': {
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;
            }

            default:
                break;
        }
    }

    onPlayerLeave(ws) {
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
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new NogridWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    },
    COORD_SCALE,
    BOARD_SIZE_PX,
    PADDING,
    INNER_SIZE
};
