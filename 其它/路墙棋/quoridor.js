'use strict';

const GRID = 9;
const WALLS_EACH = 10;

function qKey(r, c) {
    return r + ',' + c;
}

function parseKey(k) {
    const i = k.indexOf(',');
    return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
}

function buildBlockedEdges(h, v) {
    const ns = new Set();
    const ew = new Set();
    const hList = h instanceof Set ? Array.from(h) : h;
    const vList = v instanceof Set ? Array.from(v) : v;
    for (const k of hList) {
        const [r, c] = parseKey(k);
        ns.add(qKey(r, c));
        ns.add(qKey(r, c + 1));
    }
    for (const k of vList) {
        const [r, c] = parseKey(k);
        ew.add(qKey(r, c));
        ew.add(qKey(r + 1, c));
    }
    return { ns, ew };
}

function canCross(pr, pc, nr, nc, ns, ew) {
    if (nr === pr + 1 && nc === pc) return !ns.has(qKey(pr, pc));
    if (nr === pr - 1 && nc === pc) return !ns.has(qKey(nr, nc));
    if (nc === pc + 1 && nr === pr) return !ew.has(qKey(pr, pc));
    if (nc === pc - 1 && nr === pr) return !ew.has(qKey(pr, nc));
    return false;
}

function canPlaceHorizontalWall(ns, ew, r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    if (ns.has(qKey(r, c)) || ns.has(qKey(r, c + 1))) return false;
    return true;
}

function canPlaceVerticalWall(ns, ew, r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    if (ew.has(qKey(r, c)) || ew.has(qKey(r + 1, c))) return false;
    return true;
}

function wallsHSet(state) {
    if (state.wallsH instanceof Set) return state.wallsH;
    return new Set(state.wallsH || []);
}

function wallsVSet(state) {
    if (state.wallsV instanceof Set) return state.wallsV;
    return new Set(state.wallsV || []);
}

function hasPathToGoal(br, bc, goalRow, wallsH, wallsV) {
    const { ns, ew } = buildBlockedEdges(wallsH, wallsV);
    const vis = new Set();
    const q = [[br, bc]];
    vis.add(qKey(br, bc));
    while (q.length) {
        const [r, c] = q.shift();
        if (r === goalRow) return true;
        const neigh = [
            [r - 1, c],
            [r + 1, c],
            [r, c - 1],
            [r, c + 1]
        ];
        for (const [nr, nc] of neigh) {
            if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
            if (vis.has(qKey(nr, nc))) continue;
            if (!canCross(r, c, nr, nc, ns, ew)) continue;
            vis.add(qKey(nr, nc));
            q.push([nr, nc]);
        }
    }
    return false;
}

function wallPlacementLegal(state, orient, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 7 || c < 0 || c > 7) return false;
    const wh = wallsHSet(state);
    const wv = wallsVSet(state);
    const { ns, ew } = buildBlockedEdges(wh, wv);
    if (orient === 'h') {
        if (!canPlaceHorizontalWall(ns, ew, r, c)) return false;
    } else {
        if (!canPlaceVerticalWall(ns, ew, r, c)) return false;
    }
    const nextH = new Set(wh);
    const nextV = new Set(wv);
    if (orient === 'h') nextH.add(qKey(r, c));
    else nextV.add(qKey(r, c));
    if (!hasPathToGoal(state.blackRow, state.blackCol, GRID - 1, nextH, nextV)) return false;
    if (!hasPathToGoal(state.whiteRow, state.whiteCol, 0, nextH, nextV)) return false;
    return true;
}

function pawnPos(state, slot) {
    return slot === 'black'
        ? [state.blackRow, state.blackCol]
        : [state.whiteRow, state.whiteCol];
}

function otherSlot(slot) {
    return slot === 'black' ? 'white' : 'black';
}

function getLegalPawnMoves(state, playerSlot) {
    const { ns, ew } = buildBlockedEdges(wallsHSet(state), wallsVSet(state));
    const [pr, pc] = pawnPos(state, playerSlot);
    const [or, oc] = pawnPos(state, otherSlot(playerSlot));
    const out = [];
    const seen = new Set();
    const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
    ];
    for (const [dr, dc] of dirs) {
        const nr = pr + dr;
        const nc = pc + dc;
        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
        if (!canCross(pr, pc, nr, nc, ns, ew)) continue;
        if (nr !== or || nc !== oc) {
            const k = qKey(nr, nc);
            if (!seen.has(k)) {
                seen.add(k);
                out.push([nr, nc]);
            }
            continue;
        }
        const jr = pr + 2 * dr;
        const jc = pc + 2 * dc;
        const inB = jr >= 0 && jr < GRID && jc >= 0 && jc < GRID;
        const straightJump =
            inB &&
            !(jr === or && jc === oc) &&
            !(jr === pr && jc === pc) &&
            canCross(or, oc, jr, jc, ns, ew);
        if (straightJump) {
            const k = qKey(jr, jc);
            if (!seen.has(k)) {
                seen.add(k);
                out.push([jr, jc]);
            }
        } else {
            const perps = [
                [-dc, dr],
                [dc, -dr]
            ];
            for (const [pdr, pdc] of perps) {
                const sr = or + pdr;
                const sc = oc + pdc;
                if (sr < 0 || sr >= GRID || sc < 0 || sc >= GRID) continue;
                if (!canCross(or, oc, sr, sc, ns, ew)) continue;
                if (sr === pr && sc === pc) continue;
                if (sr === or && sc === oc) continue;
                const k = qKey(sr, sc);
                if (!seen.has(k)) {
                    seen.add(k);
                    out.push([sr, sc]);
                }
            }
        }
    }
    return out;
}

function isLegalPawnMove(state, playerSlot, tr, tc) {
    const leg = getLegalPawnMoves(state, playerSlot);
    return leg.some(([r, c]) => r === tr && c === tc);
}

function initialState() {
    return {
        blackRow: 0,
        blackCol: 4,
        whiteRow: 8,
        whiteCol: 4,
        wallsH: new Set(),
        wallsV: new Set(),
        wallsBlackLeft: WALLS_EACH,
        wallsWhiteLeft: WALLS_EACH,
        currentPlayer: 2,
        gameOver: false,
        winner: null,
        lastMoveMarkers: []
    };
}

function cloneState(s) {
    return {
        blackRow: s.blackRow,
        blackCol: s.blackCol,
        whiteRow: s.whiteRow,
        whiteCol: s.whiteCol,
        wallsH: new Set(wallsHSet(s)),
        wallsV: new Set(wallsVSet(s)),
        wallsBlackLeft: s.wallsBlackLeft,
        wallsWhiteLeft: s.wallsWhiteLeft,
        currentPlayer: s.currentPlayer,
        gameOver: s.gameOver,
        winner: s.winner,
        lastMoveMarkers: (s.lastMoveMarkers || []).map((m) => ({ ...m }))
    };
}

function applyPawnMove(state, slot, tr, tc) {
    if (slot === 'black') {
        state.blackRow = tr;
        state.blackCol = tc;
    } else {
        state.whiteRow = tr;
        state.whiteCol = tc;
    }
    state.lastMoveMarkers = [{ row: tr, col: tc, color: slot === 'black' ? 1 : 2 }];
    if (slot === 'black' && tr === GRID - 1) {
        state.gameOver = true;
        state.winner = 'black';
    } else if (slot === 'white' && tr === 0) {
        state.gameOver = true;
        state.winner = 'white';
    }
    if (!state.gameOver) state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
}

function applyWall(state, slot, orient, r, c) {
    if (!state.wallsH || !(state.wallsH instanceof Set)) state.wallsH = new Set(state.wallsH || []);
    if (!state.wallsV || !(state.wallsV instanceof Set)) state.wallsV = new Set(state.wallsV || []);
    if (orient === 'h') state.wallsH.add(qKey(r, c));
    else state.wallsV.add(qKey(r, c));
    if (slot === 'black') state.wallsBlackLeft--;
    else state.wallsWhiteLeft--;
    state.lastMoveMarkers = [{ row: r, col: c, color: orient === 'h' ? 3 : 4, orient }];
    state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
}

const QuoridorEngine = {
    N: GRID,
    WALLS_EACH,
    key: qKey,
    buildBlockedEdges,
    canCross,
    hasPathToGoal,
    wallPlacementLegal,
    getLegalPawnMoves,
    isLegalPawnMove,
    initialState,
    cloneState,
    applyPawnMove,
    applyWall,
    wallsHSet,
    wallsVSet,
    pawnPos,
    otherSlot
};

let QiTwoPlayerRoomBase;
let qiProtocol;
let qiMatchTimeControl;
try {
    const common = require('../../common');
    QiTwoPlayerRoomBase = common.QiTwoPlayerRoomBase;
    qiProtocol = common.qiProtocol;
    qiMatchTimeControl = common.qiMatchTimeControl;
} catch (e1) {
    try {
        const common = require('../common');
        QiTwoPlayerRoomBase = common.QiTwoPlayerRoomBase;
        qiProtocol = common.qiProtocol;
        qiMatchTimeControl = common.qiMatchTimeControl;
    } catch (e2) {
        QiTwoPlayerRoomBase = null;
    }
}

if (QiTwoPlayerRoomBase) {
    class QuoridorRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.resetToEmpty();
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.moveHistory = [];
        this.historySnapshots = [];
        this.matchStarted = false;
        this.slotJoinedAt = { black: null, white: null };
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
        const ws1 = this.room.getPlayerBySlot(first);
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws1) ws1.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    _clearTimeNegotiation() {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset' });
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? { timed: true, mainMinutes: valid.mainMinutes, byoyomiSeconds: valid.byoyomiSeconds, maxTimeouts: valid.maxTimeouts }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock && this.tcClock.timed) {
            const active = this.currentPlayer === 2 ? 'white' : 'black';
            qiMatchTimeControl.setActiveSlot(this.tcClock, active, Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
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
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        const selfWs = this.room.getPlayerBySlot(slot);
        const peerWs = this.room.getPlayerBySlot(other);
        if (selfWs) selfWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
        if (peerWs) {
            peerWs.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: v.timed,
                    mainMinutes: v.mainMinutes,
                    byoyomiSeconds: v.byoyomiSeconds,
                    maxTimeouts: v.maxTimeouts
                }
            }));
        }
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
        if (!slot || this.gameOver) return false;
        if (!this.matchStarted) return false;
        const expected = this.currentPlayer === 2 ? 'white' : 'black';
        if (slot !== expected) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        if (this.tcClock.paused) return false;
        return this.tcClock.activeSlot === slot;
    }

    _drainClockBeforeAction(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const now = Date.now();
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, now);
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        this._broadcastClock();
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const next = this.currentPlayer === 2 ? 'white' : 'black';
        qiMatchTimeControl.setActiveSlot(this.tcClock, next, Date.now());
        this._broadcastClock();
    }

    afterColorAssigned(_ws, slot) {
        if (slot === 'black' || slot === 'white') this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    resetToEmpty() {
        const s = QuoridorEngine.initialState();
        this.blackRow = s.blackRow;
        this.blackCol = s.blackCol;
        this.whiteRow = s.whiteRow;
        this.whiteCol = s.whiteCol;
        this.wallsH = new Set();
        this.wallsV = new Set();
        this.wallsBlackLeft = QuoridorEngine.WALLS_EACH;
        this.wallsWhiteLeft = QuoridorEngine.WALLS_EACH;
        this.currentPlayer = 2;
        this.gameOver = false;
        this.winner = null;
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.historySnapshots = [];
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.matchStarted = false;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._stopClockTicker();
    }

    snapshot() {
        return {
            blackRow: this.blackRow,
            blackCol: this.blackCol,
            whiteRow: this.whiteRow,
            whiteCol: this.whiteCol,
            wallsH: Array.from(this.wallsH),
            wallsV: Array.from(this.wallsV),
            wallsBlackLeft: this.wallsBlackLeft,
            wallsWhiteLeft: this.wallsWhiteLeft,
            currentPlayer: this.currentPlayer,
            gameOver: this.gameOver,
            winner: this.winner,
            lastMoveMarkers: JSON.parse(JSON.stringify(this.lastMoveMarkers || []))
        };
    }

    restoreSnapshot(sn) {
        this.blackRow = sn.blackRow;
        this.blackCol = sn.blackCol;
        this.whiteRow = sn.whiteRow;
        this.whiteCol = sn.whiteCol;
        this.wallsH = new Set(sn.wallsH || []);
        this.wallsV = new Set(sn.wallsV || []);
        this.wallsBlackLeft = sn.wallsBlackLeft;
        this.wallsWhiteLeft = sn.wallsWhiteLeft;
        this.currentPlayer = sn.currentPlayer;
        this.gameOver = sn.gameOver;
        this.winner = sn.winner;
        this.lastMoveMarkers = sn.lastMoveMarkers || [];
    }

    asEngineState() {
        return {
            blackRow: this.blackRow,
            blackCol: this.blackCol,
            whiteRow: this.whiteRow,
            whiteCol: this.whiteCol,
            wallsH: this.wallsH,
            wallsV: this.wallsV,
            wallsBlackLeft: this.wallsBlackLeft,
            wallsWhiteLeft: this.wallsWhiteLeft,
            currentPlayer: this.currentPlayer,
            gameOver: this.gameOver,
            winner: this.winner,
            lastMoveMarkers: this.lastMoveMarkers
        };
    }

    getState() {
        return {
            quoridor: true,
            boardSize: GRID,
            blackRow: this.blackRow,
            blackCol: this.blackCol,
            whiteRow: this.whiteRow,
            whiteCol: this.whiteCol,
            wallsH: Array.from(this.wallsH),
            wallsV: Array.from(this.wallsV),
            wallsBlackLeft: this.wallsBlackLeft,
            wallsWhiteLeft: this.wallsWhiteLeft,
            currentPlayer: this.currentPlayer,
            numberOfHands: this.moveHistory.length + 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            matchStarted: this.matchStarted,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            moveHistory: this.moveHistory.slice(),
            moveCoords: this.moveHistory.map((m) =>
                m.kind === 'pawn'
                    ? { type: 'move', player: m.player, row: m.row, col: m.col }
                    : { type: 'wall', player: m.player, orient: m.orient, r: m.r, c: m.c }
            ),
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '路墙棋',
            gameId: 'quoridor',
            boardSize: GRID,
            moves: this.moveHistory.map((m) =>
                m.kind === 'pawn'
                    ? `${m.player === 'black' ? 'B' : 'W'}M${m.row},${m.col}`
                    : `${m.player === 'black' ? 'B' : 'W'}${m.orient === 'h' ? 'H' : 'V'}${m.r},${m.c}`
            ),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings
                ? {
                    timed: !!this.tcSettings.timed,
                    mainMinutes: this.tcSettings.mainMinutes || 0,
                    byoyomiSeconds: this.tcSettings.byoyomiSeconds || 0,
                    maxTimeouts: this.tcSettings.maxTimeouts || 0
                }
                : null
        };
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== 'quoridor' && data.gameType !== '路墙棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要路墙棋棋谱）。' }));
            return;
        }
        this.resetToEmpty();
        if (data.timeControl && typeof data.timeControl === 'object') {
            const v = qiMatchTimeControl.validateProposal(data.timeControl);
            if (v.ok) {
                this.tcSettings = v.timed
                    ? { timed: true, mainMinutes: v.mainMinutes, byoyomiSeconds: v.byoyomiSeconds, maxTimeouts: v.maxTimeouts }
                    : { timed: false };
            }
        }
        const raw = data.moves || [];
        for (let i = 0; i < raw.length; i++) {
            let s = raw[i];
            if (typeof s !== 'string') continue;
            const slot = s[0] === 'B' ? 'black' : 'white';
            const expect = this.currentPlayer === 2 ? 'white' : 'black';
            if (slot !== expect) {
                this.resetToEmpty();
                requesterWs.send(
                    JSON.stringify({
                        type: 'error',
                        message: `棋谱回放失败：第${i + 1}手行棋方与局面不符。`
                    })
                );
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            if (s[1] === 'M') {
                const rest = s.slice(2).split(',');
                const row = parseInt(rest[0], 10);
                const col = parseInt(rest[1], 10);
                const st = this.asEngineState();
                if (!QuoridorEngine.isLegalPawnMove(st, slot, row, col)) {
                    this.resetToEmpty();
                    requesterWs.send(
                        JSON.stringify({
                            type: 'error',
                            message: `棋谱回放失败：第${i + 1}手移动非法。`
                        })
                    );
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historySnapshots.push(this.snapshot());
                QuoridorEngine.applyPawnMove(st, slot, row, col);
                this.restoreFromEngine(st);
                this.moveHistory.push({ kind: 'pawn', player: slot, row, col });
            } else if (s[1] === 'H' || s[1] === 'V') {
                const orient = s[1] === 'H' ? 'h' : 'v';
                const rest = s.slice(2).split(',');
                const r = parseInt(rest[0], 10);
                const c = parseInt(rest[1], 10);
                const st = this.asEngineState();
                if (
                    (slot === 'black' && st.wallsBlackLeft <= 0) ||
                    (slot === 'white' && st.wallsWhiteLeft <= 0)
                ) {
                    this.resetToEmpty();
                    requesterWs.send(
                        JSON.stringify({
                            type: 'error',
                            message: `棋谱回放失败：第${i + 1}手无墙可放。`
                        })
                    );
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (!QuoridorEngine.wallPlacementLegal(st, orient, r, c)) {
                    this.resetToEmpty();
                    requesterWs.send(
                        JSON.stringify({
                            type: 'error',
                            message: `棋谱回放失败：第${i + 1}手墙非法。`
                        })
                    );
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historySnapshots.push(this.snapshot());
                QuoridorEngine.applyWall(st, slot, orient, r, c);
                this.restoreFromEngine(st);
                this.moveHistory.push({ kind: 'wall', player: slot, orient, r, c });
            }
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.winner = data.result;
        }
        if (this.tcSettings) this.matchStarted = true;
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { moves: this.exportRecord().moves }
        });
    }

    restoreFromEngine(st) {
        this.blackRow = st.blackRow;
        this.blackCol = st.blackCol;
        this.whiteRow = st.whiteRow;
        this.whiteCol = st.whiteCol;
        this.wallsH = new Set(st.wallsH);
        this.wallsV = new Set(st.wallsV);
        this.wallsBlackLeft = st.wallsBlackLeft;
        this.wallsWhiteLeft = st.wallsWhiteLeft;
        this.currentPlayer = st.currentPlayer;
        this.gameOver = st.gameOver;
        this.winner = st.winner;
        this.lastMoveMarkers = st.lastMoveMarkers || [];
    }

    resetGame() {
        this.resetToEmpty();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({
            type: 'newGameStarted',
            ...this.getState(),
            slots: { black: false, white: false }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;
            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;
            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;
            case 'quoridorPawn': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeAction(slot)) return;
                const row = msg.row;
                const col = msg.col;
                const st = this.asEngineState();
                if (!QuoridorEngine.isLegalPawnMove(st, slot, row, col)) return;
                this.historySnapshots.push(this.snapshot());
                QuoridorEngine.applyPawnMove(st, slot, row, col);
                this.restoreFromEngine(st);
                this.moveHistory.push({ kind: 'pawn', player: slot, row, col });
                if (this.gameOver) this._stopClockTicker();
                else this._syncClockAfterTurnChange();
                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    ...this.getState()
                });
                break;
            }
            case 'quoridorWall': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) return;
                if (!this._drainClockBeforeAction(slot)) return;
                const orient = msg.orient === 'v' ? 'v' : 'h';
                const r = msg.r;
                const c = msg.c;
                if (
                    (slot === 'black' && this.wallsBlackLeft <= 0) ||
                    (slot === 'white' && this.wallsWhiteLeft <= 0)
                )
                    return;
                const st = this.asEngineState();
                if (!QuoridorEngine.wallPlacementLegal(st, orient, r, c)) return;
                this.historySnapshots.push(this.snapshot());
                QuoridorEngine.applyWall(st, slot, orient, r, c);
                this.restoreFromEngine(st);
                this.moveHistory.push({ kind: 'wall', player: slot, orient, r, c });
                this._syncClockAfterTurnChange();
                this.broadcast({
                    type: 'broadcast',
                    action: 'move',
                    ...this.getState()
                });
                break;
            }
            case 'requestUndo':
                this.handleRequestUndo(ws, slot);
                break;
            case 'undoResponse':
                this.handleUndoResponse(ws, msg);
                break;
            case 'resign':
                qiProtocol.resign(this, ws, slot);
                if (this.gameOver) this._stopClockTicker();
                break;
            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;
            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg);
                break;
            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;
            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                if (this.gameOver) this._stopClockTicker();
                break;
            default:
                break;
        }
    }

    handleRequestUndo(ws, slot) {
        if (!slot || this.gameOver) return;
        const isMyTurn =
            (slot === 'white' && this.currentPlayer === 2) ||
            (slot === 'black' && this.currentPlayer === 1);
        const steps = isMyTurn ? 2 : 1;
        if (this.historySnapshots.length < steps) {
            ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
            return;
        }
        const opponentSlot = slot === 'black' ? 'white' : 'black';
        const opponent = this.room.getPlayerBySlot(opponentSlot);
        if (!opponent) {
            for (let i = 0; i < steps; i++) {
                this.historySnapshots.pop();
                this.moveHistory.pop();
            }
            const sn =
                this.historySnapshots.length > 0
                    ? this.historySnapshots[this.historySnapshots.length - 1]
                    : this.emptySnapshot();
            this.restoreSnapshot(sn);
            if (this.tcClock && this.tcClock.timed && !this.gameOver) {
                const active = this.currentPlayer === 2 ? 'white' : 'black';
                qiMatchTimeControl.setActiveSlot(this.tcClock, active, Date.now());
                this._broadcastClock();
            }
            this.broadcast({
                type: 'broadcast',
                action: 'undoAccept',
                ...this.getState()
            });
        } else {
            this.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    }

    handleUndoResponse(ws, msg) {
        if (this.pendingUndo && msg.accept) {
            const steps = this.pendingUndo.steps;
            if (this.historySnapshots.length >= steps) {
                for (let i = 0; i < steps; i++) {
                    this.historySnapshots.pop();
                    this.moveHistory.pop();
                }
                const sn =
                    this.historySnapshots.length > 0
                        ? this.historySnapshots[this.historySnapshots.length - 1]
                        : this.emptySnapshot();
                this.restoreSnapshot(sn);
                if (this.tcClock && this.tcClock.timed && !this.gameOver) {
                    const active = this.currentPlayer === 2 ? 'white' : 'black';
                    qiMatchTimeControl.setActiveSlot(this.tcClock, active, Date.now());
                    this._broadcastClock();
                }
                this.broadcast({
                    type: 'broadcast',
                    action: 'undoAccept',
                    ...this.getState()
                });
            }
        } else if (this.pendingUndo && !msg.accept) {
            this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
        }
        this.pendingUndo = null;
    }

    emptySnapshot() {
        const s = QuoridorEngine.initialState();
        return {
            blackRow: s.blackRow,
            blackCol: s.blackCol,
            whiteRow: s.whiteRow,
            whiteCol: s.whiteCol,
            wallsH: [],
            wallsV: [],
            wallsBlackLeft: QuoridorEngine.WALLS_EACH,
            wallsWhiteLeft: QuoridorEngine.WALLS_EACH,
            currentPlayer: 2,
            gameOver: false,
            winner: null,
            lastMoveMarkers: []
        };
    }

    onPlayerLeave(ws) {
        const s = this.room.getSlotByWs(ws);
        if (s) {
            this.room.broadcast({ type: 'playerLeft', slot: s });
            this.slotJoinedAt[s] = null;
            if (!this.matchStarted) this._clearTimeNegotiation();
        }
    }
    }

    module.exports = {
        QuoridorEngine,
        initRoom(room) {
            room.gameLogic = new QuoridorRoom(room);
            room.maxPlayers = 2;
        }
    };
} else {
    module.exports = { QuoridorEngine, initRoom: null };
}
