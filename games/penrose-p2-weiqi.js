const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;

function penroseAdd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function penroseSub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function penroseScale(a, s) { return [a[0] * s, a[1] * s]; }
function penroseGoldenPt(A, B) {
    return penroseAdd(B, penroseScale(penroseSub(A, B), INV_PHI));
}

function penroseVertexKey(x, y) {
    return `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
}

function penroseEdgeKey(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

const PENROSE_DEG = v => (v * Math.PI) / 180;

function penroseCircleIntersect(A, B, r) {
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return [];
    const a = d / 2, mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const h = Math.sqrt(Math.max(0, r * r - a * a));
    const px = -dy / d, py = dx / d;
    return [
        [mx + h * px, my + h * py],
        [mx - h * px, my - h * py]
    ];
}

function penrosePickOuter(pts) {
    return pts.reduce((a, b) =>
        (Math.hypot(a[0], a[1]) > Math.hypot(b[0], b[1]) ? a : b));
}

/**
 * 2 路中心飞镖 [C,B,E,D]：C 为凹点（在中心），B/D 为两肘，E 为外侧尖；无 C–E 边。
 */
function penroseMakeStarDart(k) {
    const C = [0, 0];
    const mid = PENROSE_DEG(90 - k * 72);
    const wing = PENROSE_DEG(36);
    const B = [Math.cos(mid - wing), Math.sin(mid - wing)];
    const D = [Math.cos(mid + wing), Math.sin(mid + wing)];
    const E = [PHI * Math.cos(mid), PHI * Math.sin(mid)];
    return [C, B, E, D];
}

/** 沿飞镖腰边 B–E 拼一片风筝（边长 1 的彭罗斯 P2） */
function penroseKiteOnDartEdge(B, E) {
    const pts = penroseCircleIntersect(B, E, 1);
    if (pts.length < 2) return null;
    const W = penrosePickOuter(pts);
    return [B, E, W, penroseGoldenPt(B, W)];
}

function penrosePhiEdgesForHalfTile(type, a, b, c) {
    switch (type) {
        case 'RK':
        case 'LK':
            return [[a, b], [c, a]];
        case 'RD':
            return [[a, b]];
        case 'LD':
            return [[a, c]];
        default:
            return [];
    }
}

function penrosePhiVMap(faces, coords, nextIdFn) {
    const m = new Map();
    for (const { type, a, b, c } of faces) {
        for (const [u, v] of penrosePhiEdgesForHalfTile(type, a, b, c)) {
            const k = penroseEdgeKey(u, v);
            if (!m.has(k)) {
                const pu = coords.get(u), pv = coords.get(v);
                const nid = nextIdFn();
                coords.set(nid, penroseAdd(pu, penroseScale(penroseSub(pv, pu), INV_PHI)));
                m.set(k, nid);
            }
        }
    }
    return m;
}

/** PenroseKiteDart Decompose.hs — P2 半块分解（不可对单块四边形直接 inflate） */
function penroseDecompFace({ type, a, b, c }, newVFor) {
    const xKey = type === 'LD' ? penroseEdgeKey(a, c) : penroseEdgeKey(a, b);
    const x = newVFor.get(xKey);
    switch (type) {
        case 'RK': {
            const y = newVFor.get(penroseEdgeKey(c, a));
            return [
                { type: 'RK', a: c, b: x, c: b },
                { type: 'LK', a: c, b: y, c: x },
                { type: 'RD', a, b: x, c: y }
            ];
        }
        case 'LK': {
            const y = newVFor.get(penroseEdgeKey(c, a));
            return [
                { type: 'LK', a: b, b: c, c: y },
                { type: 'RK', a: b, b: y, c: x },
                { type: 'LD', a, b: x, c: y }
            ];
        }
        case 'RD':
            return [
                { type: 'LK', a, b: x, c },
                { type: 'RD', a: b, b: c, c: x }
            ];
        case 'LD':
            return [
                { type: 'RK', a, b, c: x },
                { type: 'LD', a: c, b: x, c: b }
            ];
        default:
            return [];
    }
}

/** 2 路：5 飞镖 + 10 风筝，转为半块（RK/LK/RD/LD） */
function penroseBuildRoad2HalfFaces() {
    const keyToId = new Map();
    const coords = new Map();
    let next = 0;
    function idFor(p) {
        const k = penroseVertexKey(p[0], p[1]);
        if (!keyToId.has(k)) {
            keyToId.set(k, next);
            coords.set(next, p);
            next++;
        }
        return keyToId.get(k);
    }
    const faces = [];
    const darts = Array.from({ length: 5 }, (_, k) => penroseMakeStarDart(k));
    for (const [A, B, C, D] of darts) {
        const ai = idFor(A), bi = idFor(B), ci = idFor(C), di = idFor(D);
        faces.push({ type: 'RD', a: ai, b: bi, c: ci });
        faces.push({ type: 'LD', a: ai, b: ci, c: di });
    }
    for (let k = 0; k < 5; k++) {
        const [, Bk, Ek, Dk] = darts[k];
        for (const quad of [penroseKiteOnDartEdge(Bk, Ek), penroseKiteOnDartEdge(Ek, Dk)]) {
            if (!quad) continue;
            const [A, B, C, D] = quad;
            const ai = idFor(A), bi = idFor(B), ci = idFor(C), di = idFor(D);
            faces.push({ type: 'RK', a: ai, b: bi, c: ci });
            faces.push({ type: 'LK', a: ai, b: ci, c: di });
        }
    }
    return { faces, coords, nextId: next };
}

/** RD+LD / RK+LK 的拼接边（飞镖/风筝内部对角线），不得画在棋盘上 */
function penroseCollectJoinEdges(faces) {
    const join = new Set();
    const ldByOrigin = new Map();
    const lkByOrigin = new Map();
    for (const f of faces) {
        if (f.type === 'LD') {
            if (!ldByOrigin.has(f.a)) ldByOrigin.set(f.a, []);
            ldByOrigin.get(f.a).push(f);
        } else if (f.type === 'LK') {
            if (!lkByOrigin.has(f.a)) lkByOrigin.set(f.a, []);
            lkByOrigin.get(f.a).push(f);
        }
    }
    for (const f of faces) {
        if (f.type === 'RD') {
            for (const ld of ldByOrigin.get(f.a) || []) {
                if (ld.b === f.c) join.add(penroseEdgeKey(f.a, f.c));
            }
        } else if (f.type === 'RK') {
            for (const lk of lkByOrigin.get(f.a) || []) {
                if (lk.b === f.c) join.add(penroseEdgeKey(f.a, f.c));
            }
        }
    }
    return join;
}

/**
 * 路数 n：2 路=5 凹点飞镖+10 风筝；每加一路对全盘做一次 P2 半块分解（≈外圈飞镖+风筝）。
 * 格线只取四边形外边（排除半块拼接边）；中心度恒为 5。
 * @param {number} n 路数 2～13
 * @returns {{ vertexCount: number, neighbors: number[][] }}
 */
function generatePenroseP2BoardData(n) {
    const decompCount = Math.max(0, n - 2);
    let { faces, coords, nextId } = penroseBuildRoad2HalfFaces();
    for (let i = 0; i < decompCount; i++) {
        const newVFor = penrosePhiVMap(faces, coords, () => nextId++);
        faces = faces.flatMap(f => penroseDecompFace(f, newVFor));
    }

    const joinEdges = penroseCollectJoinEdges(faces);
    const edgeSet = new Set();
    for (const { a, b, c } of faces) {
        const e1 = penroseEdgeKey(a, b);
        const e2 = penroseEdgeKey(b, c);
        if (!joinEdges.has(e1)) edgeSet.add(e1);
        if (!joinEdges.has(e2)) edgeSet.add(e2);
    }

    let maxId = 0;
    for (const id of coords.keys()) if (id > maxId) maxId = id;

    const vertices = [];
    for (let i = 0; i <= maxId; i++) {
        const p = coords.get(i);
        vertices.push({ x: p[0], y: p[1] });
    }

    for (let i = 0; i < vertices.length; i++) {
        const { x, y } = vertices[i];
        vertices[i] = { x: -y, y: x };
    }

    const V = vertices.length;
    const neighborSets = Array.from({ length: V }, () => new Set());
    for (const e of edgeSet) {
        const [a, b] = e.split(',').map(Number);
        neighborSets[a].add(b);
        neighborSets[b].add(a);
    }
    const neighbors = neighborSets.map(set => Array.from(set));
    return { vertexCount: V, neighbors };
}

const { QiTwoPlayerRoomBase, qiMatchTimeControl, vertexGraphWeiqiRules, qiBoardSeatOverlay, qiProtocol } = require('../common');
class PenroseP2WeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 5) {
        super(room);
        this.editBoardMode = 'flat';
        this.boardSize = initialSize;
        const { vertexCount, neighbors } = generatePenroseP2BoardData(initialSize);
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.board = Array(this.vertexCount).fill(0);
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
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
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
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

    _clearTimeNegotiation(reason) {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset', reason: reason || 'cleared' });
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
        const firstWs = this.room.getPlayerBySlot(first);
        if (firstWs) firstWs.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const otherWs = this.room.getPlayerBySlot(other);
        if (otherWs) otherWs.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
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
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
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
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) return;
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
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws, msg) {
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

    copyBoard(src) { return src.slice(); }

    boardToString(board) { return board.join(','); }

    hasLiberty(boardState, start) {
        return vertexGraphWeiqiRules.hasLiberty(boardState, start, this.neighbors);
    }

    removeGroup(boardState, start) {
        vertexGraphWeiqiRules.removeGroup(boardState, start, this.neighbors);
    }

    tryPlaceStone(boardBefore, vertex, playerVal) {
        return vertexGraphWeiqiRules.tryPlaceStone(boardBefore, vertex, playerVal, this.neighbors);
    }

    removeDeadAndDying(srcBoard) {
        return vertexGraphWeiqiRules.removeDeadAndDying(
            srcBoard, this.neighbors, this.vertexCount, (b) => this.copyBoard(b)
        );
    }

    multiSourceBFS(liveBoard, color) {
        const dist = new Array(this.vertexCount).fill(Infinity);
        const queue = [];
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === color) {
                dist[v] = 0;
                queue.push(v);
            }
        }
        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            for (const nb of this.neighbors[cur]) {
                if (dist[nb] > dist[cur] + 1) {
                    dist[nb] = dist[cur] + 1;
                    queue.push(nb);
                }
            }
        }
        return dist;
    }

    assignTerritory(liveBoard) {
        const territory = new Array(this.vertexCount).fill(0);
        let blackCount = 0, whiteCount = 0;
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === 1) blackCount++;
            else if (liveBoard[v] === 2) whiteCount++;
        }
        if (blackCount === 0 && whiteCount === 0) return territory;
        if (blackCount === 0) {
            for (let v = 0; v < this.vertexCount; v++) if (liveBoard[v] === 0) territory[v] = 2;
            return territory;
        }
        if (whiteCount === 0) {
            for (let v = 0; v < this.vertexCount; v++) if (liveBoard[v] === 0) territory[v] = 1;
            return territory;
        }
        const distBlack = this.multiSourceBFS(liveBoard, 1);
        const distWhite = this.multiSourceBFS(liveBoard, 2);
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] !== 0) continue;
            if (distBlack[v] < distWhite[v]) territory[v] = 1;
            else if (distWhite[v] < distBlack[v]) territory[v] = 2;
            else territory[v] = 3;
        }
        return territory;
    }

    computeScore(liveBoard, territory) {
        let blackStones = 0, whiteStones = 0;
        let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === 1) blackStones++;
            else if (liveBoard[v] === 2) whiteStones++;
            else {
                if (territory[v] === 1) blackTerritory++;
                else if (territory[v] === 2) whiteTerritory++;
                else if (territory[v] === 3) publicTerritory++;
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritory(liveBoard);
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

    static normalizeResultText(resultLike) {
        if (resultLike == null) return null;
        const text = String(resultLike);
        if (text === 'black') return '黑胜';
        if (text === 'white') return '白胜';
        if (text === 'draw') return '和胜';
        return text;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            vertexCount: this.vertexCount,
            board: this.board,
            komi: 3.25,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
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

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 2 || newSize > 13) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效（2-13）' }));
            return false;
        }
        const hasAnyStone = this.board.some(v => v !== 0);
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        const { vertexCount, neighbors } = generatePenroseP2BoardData(newSize);
        this.boardSize = newSize;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.board = Array(this.vertexCount).fill(0);
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this._stopClockTicker();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        const mainMinutes = this.tcSettings && this.tcSettings.timed ? this.tcSettings.mainMinutes : 0;
        const byoyomiSeconds = this.tcSettings && this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0;
        const maxTimeouts = this.tcSettings && this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0;
        const exportedTimeControl = (this.tcSettings && this.tcSettings.timed) ? `S${mainMinutes},${byoyomiSeconds},${maxTimeouts}` : null;
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
            gameType: '彭罗斯P2围棋',
            gameId: 'penrose-p2-weiqi',
            boardSize: this.boardSize,
            vertexCount: this.vertexCount,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.vertex;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText,
            resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.board = Array(this.vertexCount).fill(0);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const vertex = parseInt(entry.substring(1), 10);
            return { type: 'move', player, vertex };
        }
        return entry;
    }

    parseInitialPositionCompact(initialPosition) {
        if (!Array.isArray(initialPosition)) return [];
        const out = [];
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 2) continue;
            const p = s[0];
            if (p !== 'B' && p !== 'W') continue;
            const vertex = parseInt(s.slice(1), 10);
            if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) continue;
            out.push(`${p}${vertex}`);
        }
        return out;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'penrose-p2-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要彭罗斯P2围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 5;
        if (!Number.isInteger(newSize) || newSize < 2 || newSize > 13) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效（2-13）' }));
            return;
        }

        const { vertexCount, neighbors } = generatePenroseP2BoardData(newSize);
        if (data.vertexCount != null && Number.isInteger(data.vertexCount) && data.vertexCount !== vertexCount) {
            requesterWs.send(JSON.stringify({
                type: 'error',
                message: `棋谱总交点数(${data.vertexCount})与当前路数棋盘(${vertexCount})不一致，可能为旧版棋谱或路数错误`
            }));
            return;
        }
        this.boardSize = newSize;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.resetToEmpty();

        let compactInitialPosition = this.parseInitialPositionCompact(data.initialPosition);
        for (const s of compactInitialPosition) {
            const p = s[0];
            const v = parseInt(s.slice(1), 10);
            this.board[v] = p === 'B' ? 1 : 2;
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(PenroseP2WeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { vertex } = move;
                if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const occ = this.board[vertex];
                if (occ !== 0 && occ !== playerVal) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手位置已有子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                // 兼容旧版导出：initialPosition 含全盘快照且 moves 仍含相同落子——盘面不变但仍记入手顺，供客户端从空盘复原。
                if (occ === playerVal) {
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'move', player: slot, vertex });
                    this.lastMoveMarkers = [{ vertex, color: playerVal }];
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    continue;
                }
                const newBoard = this.tryPlaceStone(this.board, vertex, playerVal);
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
                this.moveCoords.push({ type: 'move', player: slot, vertex });
                this.board = newBoard;
                this.lastMoveMarkers = [{ vertex, color: playerVal }];
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

        if (data.timeControl === null) {
            this.tcSettings = { timed: false };
            this.matchStarted = true;
        } else if (data.timeControl && typeof data.timeControl === 'object') {
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
        } else if (typeof data.timeControl === 'string') {
            const m = data.timeControl.match(/^S(\d+),(\d+),(\d+)$/);
            if (m) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(m[1], 10) || 0,
                    byoyomiSeconds: parseInt(m[2], 10) || 0,
                    maxTimeouts: parseInt(m[3], 10) || 0
                };
                this.matchStarted = true;
            }
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = PenroseP2WeiqiRoom.normalizeResultText(
                data.resultText != null ? data.resultText : data.result
            );
            this.recordResultText = importedResultText;
            this.winner = PenroseP2WeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                boardSize: this.boardSize,
                // 打谱从空盘 + 全手顺即可；避免 initialPosition 与 moves 重复导致客户端回放失败
                initialPosition: [],
                moves: moves.map(m => (m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, vertex: m.vertex }))
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                    this.slotJoinedAt[newSlot] = Date.now();
                    this._maybeBeginTimeNegotiation();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize': {
                if (slot) break;
                const n = parseInt(String(msg.size ?? ''), 10);
                this.setBoardSize(n, ws);
                break;
            }

            case 'move':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { vertex } = msg;
                if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) return;
                if (this.board[vertex] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, vertex, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) 
                {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                } 
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, vertex });
                this.board = newBoard;
                this.lastMoveMarkers = [{ vertex, color: playerVal }];
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                qiProtocol.weiqiPass(this, ws, slot, {
                    afterBroadcast: () => this._syncClockAfterTurnChange(),
                });
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyBoards.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept)
                        this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else
                        this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.onResignResolved(slot);
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                } else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
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
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
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
        if (this.historyBoards.length === 0)
            this.board = Array(this.vertexCount).fill(0);
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ vertex: m.vertex, color: m.color }));
    }

    resetGame() {
        this._stopClockTicker();
        this.board = Array(this.vertexCount).fill(0);
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
        this.recordResultText = null;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        // 必须先广播 newGameStarted：broadcast 只遍历 players 与 observers。
        // 若先清空 players，原对局连接不在任何集合里，会收不到消息，客户端局面/路数 UI 不会更新。
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
        const toRelease = [...this.room.players.entries()];
        for (const [client, slot] of toRelease) {
            this.room.players.delete(client);
            this.room.slotOccupancy.delete(slot);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
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
    generatePenroseP2BoardData,
    initRoom(room) {
        room.gameLogic = new PenroseP2WeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
