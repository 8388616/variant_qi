function generateHexBoardData(n) {
    const S = n - 1;
    const R = 2;
    const sqrt3 = Math.sqrt(3);
    const vertexMap = new Map();
    const vertices = [];
    const hexagons = [];
    const dx = [R, R / 2, -R / 2, -R, -R / 2, R / 2];
    const dy = [0, R * sqrt3 / 2, R * sqrt3 / 2, 0, -R * sqrt3 / 2, -R * sqrt3 / 2];

    for (let q = -(S - 1); q <= S - 1; q++) {
        for (let r = -(S - 1); r <= S - 1; r++) {
            const s = -q - r;
            if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > S - 1) continue;
            const cx = R * (3 / 2) * q;
            const cy = R * sqrt3 * (r + q / 2);
            const hexIds = [];
            for (let j = 0; j < 6; j++) {
                const x = cx + dx[j];
                const y = cy + dy[j];
                const key = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
                if (!vertexMap.has(key)) {
                    vertexMap.set(key, vertices.length);
                    vertices.push({ x, y });
                }
                hexIds.push(vertexMap.get(key));
            }
            hexagons.push(hexIds);
        }
    }

    for (let i = 0; i < vertices.length; i++) {
        const { x, y } = vertices[i];
        vertices[i] = { x: -y, y: x };
    }

    const V = vertices.length;
    const neighborSets = Array.from({ length: V }, () => new Set());
    for (const hex of hexagons) {
        for (let i = 0; i < 6; i++) {
            const a = hex[i];
            const b = hex[(i + 1) % 6];
            if (a !== b) {
                neighborSets[a].add(b);
                neighborSets[b].add(a);
            }
        }
    }
    const neighborList = neighborSets.map(set => Array.from(set));
    return { vertexCount: V, neighbors: neighborList };
}

const { QiTwoPlayerRoomBase, qiMatchTimeControl, vertexGraphWeiqiRules } = require('../common');
class HexagonWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 9) {
        super(room);
        this.boardSize = initialSize;
        const { vertexCount, neighbors } = generateHexBoardData(initialSize);
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.board = Array(this.vertexCount).fill(0);
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

    getState() {
        return {
            boardSize: this.boardSize,
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
        if (!Number.isInteger(newSize) || newSize < 4 || newSize > 11) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效（4-11）' }));
            return false;
        }
        const hasAnyStone = this.board.some(v => v !== 0);
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        const { vertexCount, neighbors } = generateHexBoardData(newSize);
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
            gameType: '六角围棋',
            gameId: 'hexagon-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.vertex;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
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
        if (!data || data.gameId !== 'hexagon-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要六角围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 9;
        if (!Number.isInteger(newSize) || newSize < 4 || newSize > 11) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效（4-11）' }));
            return;
        }

        const { vertexCount, neighbors } = generateHexBoardData(newSize);
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
        const moves = rawMoves.map(HexagonWeiqiRoom.parseMove);
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

        if (data.timeControl && typeof data.timeControl === 'object') {
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
        }

        if (data.result || data.resultText) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = HexagonWeiqiRoom.parseResultTextToWinner(importedResultText);
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
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
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
    generateHexBoardData,
    initRoom(room) {
        room.gameLogic = new HexagonWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
