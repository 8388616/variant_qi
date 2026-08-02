'use strict';

const COORD_SCALE = 1000000;
const BOARD_SIZE_PX = 600;
const DEFAULT_BOARD_LENGTH = 18;
const DEFAULT_KOMI = 7.5;
const PIECE_RADIUS = 0.5;
const PIECE_DIAMETER = 1.0;
const MIN_DISTANCE = 0.5;
const TOUCH_DISTANCE = 1.0;
const EPS = 1e-9;
const SCORE_GRID = 80;

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, qiBoardSeatOverlay } = require('../common');

function ixToX(ix, boardLength) {
    return (ix / COORD_SCALE) * boardLength;
}
function iyToY(iy, boardLength) {
    return (iy / COORD_SCALE) * boardLength;
}
function toIx(x, boardLength) {
    return Math.round((x / boardLength) * COORD_SCALE);
}
function toIy(y, boardLength) {
    return Math.round((y / boardLength) * COORD_SCALE);
}

function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

function boundaryContacts(x, y, boardLength) {
    let n = 0;
    if (x - PIECE_RADIUS <= EPS) n++;
    if (x + PIECE_RADIUS >= boardLength - EPS) n++;
    if (y - PIECE_RADIUS <= EPS) n++;
    if (y + PIECE_RADIUS >= boardLength - EPS) n++;
    return n;
}

function copyStones(src) {
    return src.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
}

function stoneXY(s, boardLength) {
    return { x: ixToX(s.ix, boardLength), y: iyToY(s.iy, boardLength) };
}

function graphsIsomorphic(g1, g2) {
    const n = g1.colors.length;
    if (n !== g2.colors.length) return false;
    if (n === 0) return true;
    let e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) { e1 += g1.adj[i].length; e2 += g2.adj[i].length; }
    if (e1 !== e2) return false;
    let b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) { if (g1.colors[i] === 1) b1++; if (g2.colors[i] === 1) b2++; }
    if (b1 !== b2) return false;
    const degByColor = (g) => {
        const dB = [], dW = [];
        for (let i = 0; i < n; i++) {
            (g.colors[i] === 1 ? dB : dW).push(g.adj[i].length);
        }
        dB.sort((a, b) => a - b);
        dW.sort((a, b) => a - b);
        return [dB, dW];
    };
    const [dB1, dW1] = degByColor(g1);
    const [dB2, dW2] = degByColor(g2);
    for (let i = 0; i < dB1.length; i++) if (dB1[i] !== dB2[i]) return false;
    for (let i = 0; i < dW1.length; i++) if (dW1[i] !== dW2[i]) return false;
    const adjSet1 = g1.adj.map(a => new Set(a));
    const adjSet2 = g2.adj.map(a => new Set(a));
    const order = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => g1.adj[b].length - g1.adj[a].length);
    const mapping = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    function backtrack(k) {
        if (k === n) return true;
        const u = order[k];
        const cu = g1.colors[u];
        const du = g1.adj[u].length;
        for (let v = 0; v < n; v++) {
            if (used[v]) continue;
            if (g2.colors[v] !== cu) continue;
            if (g2.adj[v].length !== du) continue;
            let ok = true;
            for (const u2 of g1.adj[u]) {
                const v2 = mapping[u2];
                if (v2 !== -1 && !adjSet2[v].has(v2)) { ok = false; break; }
            }
            if (!ok) continue;
            mapping[u] = v;
            used[v] = true;
            if (backtrack(k + 1)) return true;
            mapping[u] = -1;
            used[v] = false;
        }
        return false;
    }
    return backtrack(0);
}

let _pieceUid = 0;

class ContinuousBoard {
    constructor(boardLength) {
        this.boardLength = boardLength;
        this.pieces = [];
        this.stateHistory = [];
        this.graphHistory = [];
        this.stateHistory.push(this._makeSignature());
        this.graphHistory.push(this._makeGraph());
        this._neighborCache = null;
        this._scoreCache = null;
    }

    static fromOpeningStones(openingStones, boardLength) {
        const b = new ContinuousBoard(boardLength);
        for (const s of openingStones || []) {
            b.pieces.push({ color: s.color, ix: s.ix, iy: s.iy, _uid: ++_pieceUid });
        }
        b._invalidate();
        b.stateHistory = [b._makeSignature()];
        b.graphHistory = [b._makeGraph()];
        return b;
    }

    toStones() {
        return this.pieces.map(p => ({ ix: p.ix, iy: p.iy, color: p.color }));
    }

    _invalidate() {
        this._neighborCache = null;
        this._scoreCache = null;
    }

    _xy(p) {
        return { x: ixToX(p.ix, this.boardLength), y: iyToY(p.iy, this.boardLength) };
    }

    _buildNeighborCache() {
        if (this._neighborCache) return this._neighborCache;
        const cache = new Map();
        for (const p of this.pieces) cache.set(p._uid, []);
        const n = this.pieces.length;
        for (let i = 0; i < n; i++) {
            const pi = this.pieces[i];
            const pxy = this._xy(pi);
            for (let j = i + 1; j < n; j++) {
                const pj = this.pieces[j];
                const pjy = this._xy(pj);
                if (dist(pxy.x, pxy.y, pjy.x, pjy.y) <= TOUCH_DISTANCE + EPS) {
                    cache.get(pi._uid).push(pj);
                    cache.get(pj._uid).push(pi);
                }
            }
        }
        this._neighborCache = cache;
        return cache;
    }

    neighbors(p) { return this._buildNeighborCache().get(p._uid); }

    groupOf(p) {
        const seen = new Set([p._uid]);
        const out = [p];
        const stack = [p];
        const cache = this._buildNeighborCache();
        while (stack.length) {
            const cur = stack.pop();
            for (const nb of cache.get(cur._uid)) {
                if (nb.color === p.color && !seen.has(nb._uid)) {
                    seen.add(nb._uid);
                    out.push(nb);
                    stack.push(nb);
                }
            }
        }
        return out;
    }

    pieceLiberty(p) {
        const { x, y } = this._xy(p);
        return 4 - boundaryContacts(x, y, this.boardLength) - this.neighbors(p).length;
    }

    groupLiberty(group) {
        let s = 0;
        for (const p of group) s += this.pieceLiberty(p);
        return s;
    }

    _legalDistanceOwnOnly(color, x, y) {
        if (!(0 <= x && x <= this.boardLength && 0 <= y && y <= this.boardLength)) return false;
        for (const p of this.pieces) {
            if (p.color === color) {
                const { x: px, y: py } = this._xy(p);
                if (dist(x, y, px, py) < MIN_DISTANCE - EPS) return false;
            }
        }
        return true;
    }

    tryPlace(color, x, y) {
        if (!this._legalDistanceOwnOnly(color, x, y)) return { ok: false, why: 'distance' };
        const newPiece = { color, ix: toIx(x, this.boardLength), iy: toIy(y, this.boardLength), _uid: ++_pieceUid };
        this.pieces.push(newPiece);
        this._invalidate();

        const opp = color === 1 ? 2 : 1;
        const captured = [];
        const visited = new Set();
        for (const p of [...this.pieces]) {
            if (p.color !== opp || visited.has(p._uid)) continue;
            const grp = this.groupOf(p);
            for (const q of grp) visited.add(q._uid);
            if (this.groupLiberty(grp) <= 0) captured.push(...grp);
        }
        if (captured.length) {
            const capIds = new Set(captured.map(p => p._uid));
            this.pieces = this.pieces.filter(p => !capIds.has(p._uid));
            this._invalidate();
        }

        for (const p of this.pieces) {
            if (p._uid === newPiece._uid) continue;
            if (p.color === opp) {
                const { x: px, y: py } = this._xy(p);
                if (dist(x, y, px, py) < MIN_DISTANCE - EPS) {
                    this.pieces = this.pieces.filter(pp => pp._uid !== newPiece._uid);
                    for (const cap of captured) this.pieces.push(cap);
                    this._invalidate();
                    return { ok: false, why: 'distance' };
                }
            }
        }

        const ownGrp = this.groupOf(newPiece);
        if (this.groupLiberty(ownGrp) <= 0) {
            this.pieces = this.pieces.filter(p => p._uid !== newPiece._uid);
            for (const p of captured) this.pieces.push(p);
            this._invalidate();
            return { ok: false, why: 'suicide' };
        }

        const sig = this._makeSignature();
        const graph = this._makeGraph();
        if (this._isKoRepeat(sig, graph)) {
            this.pieces = this.pieces.filter(p => p._uid !== newPiece._uid);
            for (const p of captured) this.pieces.push(p);
            this._invalidate();
            return { ok: false, why: 'ko' };
        }

        this.stateHistory.push(sig);
        this.graphHistory.push(graph);
        return {
            ok: true,
            newPiece,
            captured: captured.map(p => ({ ix: p.ix, iy: p.iy, color: p.color }))
        };
    }

    _makeGraph() {
        const n = this.pieces.length;
        if (n === 0) return { colors: [], adj: [] };
        const cache = this._buildNeighborCache();
        const idx = new Map();
        this.pieces.forEach((p, i) => idx.set(p._uid, i));
        const colors = this.pieces.map(p => p.color);
        const adj = this.pieces.map(p =>
            cache.get(p._uid).map(q => idx.get(q._uid)).sort((a, b) => a - b)
        );
        return { colors, adj };
    }

    _isKoRepeat(sig, graph) {
        for (let i = 0; i < this.stateHistory.length; i++) {
            if (this.stateHistory[i] !== sig) continue;
            if (graphsIsomorphic(graph, this.graphHistory[i])) return true;
        }
        return false;
    }

    _makeSignature() {
        if (!this.pieces.length) return 'empty';
        const cache = this._buildNeighborCache();
        let labels = new Map();
        for (const p of this.pieces) labels.set(p._uid, String(p.color));
        const iters = Math.min(this.pieces.length + 1, 12);
        for (let it = 0; it < iters; it++) {
            const newSig = new Map();
            for (const p of this.pieces) {
                const neighLbls = cache.get(p._uid).map(q => labels.get(q._uid)).sort();
                newSig.set(p._uid, labels.get(p._uid) + '|' + neighLbls.join(','));
            }
            const uniq = [...new Set(newSig.values())].sort();
            const mp = new Map();
            uniq.forEach((s, i) => mp.set(s, 'L' + i));
            labels = new Map();
            for (const [k, v] of newSig) labels.set(k, mp.get(v));
        }
        return [...labels.values()].sort().join(';');
    }

    computeScore(komi = DEFAULT_KOMI, grid = SCORE_GRID) {
        if (this._scoreCache && grid === SCORE_GRID) {
            const [b, w] = this._scoreCache;
            return { black: b, white: w, lead: b - w - komi };
        }
        const L = this.boardLength;
        const cell = L / grid;
        const cellArea = cell * cell;
        let blackCells = 0, whiteCells = 0, blackTerr = 0, whiteTerr = 0;
        for (let i = 0; i < grid; i++) {
            const cx = (i + 0.5) * cell;
            for (let j = 0; j < grid; j++) {
                const cy = (j + 0.5) * cell;
                let covB = false, covW = false;
                let bestB = Infinity, bestW = Infinity;
                for (const p of this.pieces) {
                    const { x, y } = this._xy(p);
                    const d = dist(cx, cy, x, y);
                    if (d <= PIECE_RADIUS + EPS) {
                        if (p.color === 1) covB = true;
                        else covW = true;
                    }
                    if (p.color === 1) { if (d < bestB) bestB = d; }
                    else { if (d < bestW) bestW = d; }
                }
                if (covB) blackCells += cellArea;
                if (covW) whiteCells += cellArea;
                if (!covB && !covW && (bestB < Infinity || bestW < Infinity)) {
                    if (Math.abs(bestB - bestW) >= 1e-6) {
                        if (bestB < bestW) blackTerr += cellArea;
                        else whiteTerr += cellArea;
                    }
                }
            }
        }
        const bs = blackCells + blackTerr;
        const ws = whiteCells + whiteTerr;
        if (grid === SCORE_GRID) this._scoreCache = [bs, ws];
        return { black: bs, white: ws, lead: bs - ws - komi };
    }
}

function validateOpeningStones(stones, boardLength) {
    if (!Array.isArray(stones)) return '无效的棋子数据';
    const pieces = [];
    for (const s of stones) {
        const color = s.color;
        const ix = s.ix, iy = s.iy;
        if (color !== 1 && color !== 2) return '棋子颜色无效';
        if (!Number.isFinite(ix) || !Number.isFinite(iy)) return '坐标无效';
        const x = ixToX(ix, boardLength);
        const y = iyToY(iy, boardLength);
        if (x < -EPS || x > boardLength + EPS || y < -EPS || y > boardLength + EPS) return '坐标越界';
        pieces.push({ color, ix, iy, _uid: ++_pieceUid });
    }
    for (let i = 0; i < pieces.length; i++) {
        const pi = pieces[i];
        const pxy = { x: ixToX(pi.ix, boardLength), y: iyToY(pi.iy, boardLength) };
        for (let j = i + 1; j < pieces.length; j++) {
            const pj = pieces[j];
            if (pi.color !== pj.color) continue;
            const pjy = { x: ixToX(pj.ix, boardLength), y: iyToY(pj.iy, boardLength) };
            if (dist(pxy.x, pxy.y, pjy.x, pjy.y) < MIN_DISTANCE - EPS) return '同色棋子距离过近';
        }
    }
    return null;
}

class ContinuousWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardLength = DEFAULT_BOARD_LENGTH;
        this.komi = DEFAULT_KOMI;
        this.openingStones = [];
        this.board = new ContinuousBoard(this.boardLength);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyKo = [];
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    _rebuildBoard() {
        this.board = ContinuousBoard.fromOpeningStones(this.openingStones, this.boardLength);
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
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return this._stopClockTicker();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
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
        const ws = this.room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = this.room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'timeControlNegotiation',
            mode: 'respond',
            proposal: { ok: true, timed: proposal.timed, mainMinutes: proposal.mainMinutes, byoyomiSeconds: proposal.byoyomiSeconds, maxTimeouts: proposal.maxTimeouts }
        }));
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) return ws.send(JSON.stringify({ type: 'error', message: v.error }));
        if (slot !== this.tcNego.waitingSlot) return;
        this.tcNego.proposal = v;
        this.tcNego.lastProposerSlot = slot;
        const other = slot === 'black' ? 'white' : 'black';
        this.tcNego.waitingSlot = other;
        this.tcNego.phase = 'respond';
        const me = this.room.getPlayerBySlot(slot);
        if (me) me.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
        this._sendRespondDialog(other, v);
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond' || slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this.tcSettings = prop.timed ? { timed: true, mainMinutes: prop.mainMinutes, byoyomiSeconds: prop.byoyomiSeconds, maxTimeouts: prop.maxTimeouts } : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({ type: 'timeControlAgreed', settings: this.tcSettings, clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null });
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted) return false;
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
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
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
        if (lead > 0) this.recordResultText = `黑胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else if (lead < 0) this.recordResultText = `白胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else this.recordResultText = '和胜';
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

    computeLead() {
        return this.board.computeScore(this.komi).lead;
    }

    copyMarkers(markers) {
        return markers.map(m => ({ ix: m.ix, iy: m.iy, color: m.color }));
    }

    getState() {
        return {
            boardLength: this.boardLength,
            komi: this.komi,
            stones: copyStones(this.board.toStones()),
            openingStones: copyStones(this.openingStones),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.copyMarkers(this.lastMoveMarkers),
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

    getInitialState() {
        return {
            boardLength: this.boardLength,
            komi: this.komi,
            stones: copyStones(this.board.toStones()),
            openingStones: copyStones(this.openingStones),
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.copyMarkers(this.lastMoveMarkers),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: [],
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
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

    tryMove(playerVal, ix, iy) {
        const x = ixToX(ix, this.boardLength);
        const y = iyToY(iy, this.boardLength);
        if (x < -EPS || x > this.boardLength + EPS || y < -EPS || y > this.boardLength + EPS) {
            return { error: '落点在盘外' };
        }
        const r = this.board.tryPlace(playerVal, x, y);
        if (!r.ok) {
            const msgs = { distance: '圆心距过近', suicide: '禁着：自杀', ko: '禁着：同形重复' };
            return { error: msgs[r.why] || '非法着手' };
        }
        return r;
    }

    _replayMoves() {
        this.board = ContinuousBoard.fromOpeningStones(this.openingStones, this.boardLength);
        for (const m of this.moveCoords) {
            if (m.type !== 'move') continue;
            const pv = m.player === 'black' ? 1 : 2;
            const x = ixToX(m.ix, this.boardLength);
            const y = iyToY(m.iy, this.boardLength);
            this.board.tryPlace(pv, x, y);
        }
        if (this.historyKo.length > 0) {
            const ko = this.historyKo[this.historyKo.length - 1];
            this.board.stateHistory = ko.stateHistory.slice();
            this.board.graphHistory = ko.graphHistory.slice();
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) this.historyBoards.pop();
            if (this.historyKo.length > 0) this.historyKo.pop();
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        this._replayMoves();
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    resetGame() {
        this._stopClockTicker();
        this.openingStones = [];
        this.board = new ContinuousBoard(this.boardLength);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyKo = [];
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
        this.openingStones = [];
        this.board = new ContinuousBoard(this.boardLength);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyKo = [];
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
    }

    exportRecord() {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        const initialPosition = (this.openingStones || []).map(s => {
            const p = s.color === 1 ? 'B' : 'W';
            return p + s.ix + ',' + s.iy;
        });
        return {
            format: 'muzei',
            version: 1,
            game: '连续围棋',
            gameId: 'continuous-weiqi',
            boardLength: this.boardLength,
            komi: this.komi,
            coordScale: COORD_SCALE,
            players: { black: '', white: '' },
            initialPosition,
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
        if (typeof entry === 'object') return entry;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        const rest = entry.substring(1);
        const parts = rest.split(',');
        return { type: 'move', player, ix: parseInt(parts[0], 10), iy: parseInt(parts[1], 10) };
    }

    static parseInitialStone(entry) {
        if (typeof entry === 'object') {
            return { color: entry.color === 1 || entry.color === 'black' || entry[0] === 'B' ? 1 : 2, ix: entry.ix, iy: entry.iy };
        }
        const color = entry[0] === 'B' ? 1 : 2;
        const rest = entry.substring(1);
        const parts = rest.split(',');
        return { color, ix: parseInt(parts[0], 10), iy: parseInt(parts[1], 10) };
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId && data.gameId !== 'continuous-weiqi' && data.game !== '连续围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要连续围棋棋谱）。' }));
            return;
        }
        const bl = data.boardLength || data.board_length;
        if (bl && Number.isFinite(+bl)) {
            const n = +bl;
            if (n >= 4 && n <= 40) this.boardLength = n;
        }
        if (data.komi != null && Number.isFinite(+data.komi)) this.komi = +data.komi;
        this.resetToEmpty();

        const opening = [];
        for (const s of data.initialPosition || []) {
            const parsed = ContinuousWeiqiRoom.parseInitialStone(s);
            if (Number.isFinite(parsed.ix) && Number.isFinite(parsed.iy)) opening.push(parsed);
        }
        const err = validateOpeningStones(opening, this.boardLength);
        if (err) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '初始局面无效：' + err }));
            this.broadcast({ type: 'roomReset', ...this.getState() });
            return;
        }
        this.openingStones = opening.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
        this.board = ContinuousBoard.fromOpeningStones(this.openingStones, this.boardLength);

        const moves = (data.moves || []).map(m => ContinuousWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const r = this.tryMove(playerVal, move.ix, move.iy);
                if (r.error) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手 ${r.error}` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, ix: move.ix, iy: move.iy });
                this.historyBoards.push(copyStones(this.board.toStones()));
                this.historyKo.push({
                    stateHistory: this.board.stateHistory.slice(),
                    graphHistory: this.board.graphHistory.slice()
                });
                this.lastMoveMarkers = [{ ix: move.ix, iy: move.iy, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'pass', player: move.player });
                this.historyBoards.push(copyStones(this.board.toStones()));
                this.historyKo.push({
                    stateHistory: this.board.stateHistory.slice(),
                    graphHistory: this.board.graphHistory.slice()
                });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
        }

        if (typeof data.timeControl === 'string') {
            const m = data.timeControl.match(/^S(\d+),(\d+),(\d+)$/);
            if (m) {
                this.tcSettings = { timed: true, mainMinutes: parseInt(m[1], 10), byoyomiSeconds: parseInt(m[2], 10), maxTimeouts: parseInt(m[3], 10) };
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
            this.winner = ContinuousWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                openingStones: copyStones(this.openingStones),
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    setBoardLength(newLen, requesterWs) {
        if (!Number.isFinite(newLen) || newLen < 4 || newLen > 40) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘边长须在 4～40 之间' }));
            return false;
        }
        const hasStone = this.board.pieces.length > 0 || this.openingStones.length > 0;
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasStone || hasPlayer || this.moveHistory.length > 0) return false;
        this.boardLength = newLen;
        this.board = new ContinuousBoard(this.boardLength);
        this.broadcast({ type: 'boardLengthChanged', ...this.getInitialState() });
        return true;
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) });
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'move': {
                if (!slot || this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const expect = this.currentPlayer === 1 ? 'black' : 'white';
                if (slot !== expect) {
                    ws.send(JSON.stringify({ type: 'error', message: '还没轮到你。' }));
                    return;
                }
                const ix = parseInt(msg.ix, 10);
                const iy = parseInt(msg.iy, 10);
                if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
                    ws.send(JSON.stringify({ type: 'error', message: '坐标无效' }));
                    return;
                }
                const playerVal = slot === 'black' ? 1 : 2;
                const r = this.tryMove(playerVal, ix, iy);
                if (r.error) {
                    ws.send(JSON.stringify({ type: 'error', message: r.error }));
                    return;
                }
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, ix, iy });
                this.historyBoards.push(copyStones(this.board.toStones()));
                this.historyKo.push({
                    stateHistory: this.board.stateHistory.slice(),
                    graphHistory: this.board.graphHistory.slice()
                });
                this.lastMoveMarkers = [{ ix, iy, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                if (!slot || this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                const expect = this.currentPlayer === 1 ? 'black' : 'white';
                if (slot !== expect) {
                    ws.send(JSON.stringify({ type: 'error', message: '还没轮到你。' }));
                    return;
                }
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.historyBoards.push(copyStones(this.board.toStones()));
                this.historyKo.push({
                    stateHistory: this.board.stateHistory.slice(),
                    graphHistory: this.board.graphHistory.slice()
                });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
                if (this.passCounter >= 2) {
                    const blackPlayer = this.room.getPlayerBySlot('black');
                    const whitePlayer = this.room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) this.startScoreCounting(blackPlayer, whitePlayer);
                    else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot, { onResignResolved: (logic, s) => logic.onResignResolved(s) });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                qiProtocol.requestEnd(this, ws, slot);
                break;

            case 'endResponse':
                qiProtocol.endResponse(this, ws, msg);
                break;

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
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            case 'editBoard': {
                if (this.gameOver || this.historyBoards.length > 0) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，不能编辑棋盘' }));
                    return;
                }
                const raw = msg.stones;
                if (!Array.isArray(raw)) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效的棋子数据' }));
                    return;
                }
                const stones = raw.map(s => ({
                    ix: parseInt(s.ix, 10),
                    iy: parseInt(s.iy, 10),
                    color: s.color === 1 || s.color === 'black' ? 1 : 2
                }));
                const err = validateOpeningStones(stones, this.boardLength);
                if (err) {
                    ws.send(JSON.stringify({ type: 'error', message: err }));
                    return;
                }
                this.openingStones = stones.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
                this.board = ContinuousBoard.fromOpeningStones(this.openingStones, this.boardLength);
                this.currentPlayer = 1;
                this.lastMoveMarkers = [];
                this.passCounter = 0;
                this.gameOver = false;
                this.winner = null;
                this.broadcast({ type: 'editBoardAccepted', ...this.getInitialState() });
                break;
            }

            case 'setBoardLength': {
                if (slot) return;
                const n = parseFloat(msg.boardLength ?? msg.size);
                if (!this.setBoardLength(n, ws)) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法更改棋盘（已有棋子或玩家入座）' }));
                }
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
        room.gameLogic = new ContinuousWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    },
    COORD_SCALE,
    BOARD_SIZE_PX,
    DEFAULT_BOARD_LENGTH,
    DEFAULT_KOMI,
    PIECE_RADIUS,
    PIECE_DIAMETER,
    MIN_DISTANCE,
    TOUCH_DISTANCE,
    ixToX,
    iyToY,
    toIx,
    toIy,
    dist,
    boundaryContacts,
    graphsIsomorphic,
    ContinuousBoard,
    computeTerritoryLead: (stones, boardLength, komi) => {
        const b = ContinuousBoard.fromOpeningStones(stones, boardLength);
        const s = b.computeScore(komi);
        return s;
    }
};
