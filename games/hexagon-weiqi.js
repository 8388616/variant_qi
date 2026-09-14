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

    /**
     * 坐标表（棋谱里写作 颜色字母 + 行,列，如 B5,5）
     *   行 0 = 屏幕最上面一行：棋盘显示时 y 做了上下翻折（y 越大越靠上），故按 y 从大到小排行
     *   列 = 该行内自左往右，0 起
     */
    const rows = [];
    for (let v = 0; v < V; v++) {
        const y = vertices[v].y;
        let row = rows.find((r) => Math.abs(r.y - y) < 1e-6);
        if (!row) {
            row = { y, pts: [] };
            rows.push(row);
        }
        row.pts.push(v);
    }
    rows.sort((a, b) => b.y - a.y);
    const koordOf = new Array(V);
    const vertexByKoord = new Map();
    rows.forEach((row, ri) => {
        row.pts.sort((a, b) => vertices[a].x - vertices[b].x);
        row.pts.forEach((v, ci) => {
            koordOf[v] = [ri, ci];
            vertexByKoord.set(`${ri},${ci}`, v);
        });
    });

    return { vertexCount: V, neighbors: neighborList, koordOf, vertexByKoord };
}

const { QiTwoPlayerRoomBase, qiMatchTimeControl, vertexGraphWeiqiRules, qiBoardSeatOverlay, qiProtocol } = require('../common');
class HexagonWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 9) {
        super(room);
        this.editBoardMode = 'flat';
        this.boardSize = initialSize;
        const { vertexCount, neighbors, koordOf, vertexByKoord } = generateHexBoardData(initialSize);
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.koordOf = koordOf;
        this.vertexByKoord = vertexByKoord;
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
        this.slotJoinedAt = { player1: null, player2: null };
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
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
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
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
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
    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
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
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
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
        // Benson 加成：顶点图版，保活无条件活棋链 + 确定领地覆盖
        const vCount = this.vertexCount;
        const benson = vertexGraphWeiqiRules.bensonAlive(this.board, this.neighbors);
        let liveBoard = this.board.slice();
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = this.removeDeadAndDying(liveBoard);
            for (let v = 0; v < vCount; v++) {
                const val = this.board[v];
                if (benson.alive[v] && (val === 1 || val === 2) && cleaned[v] !== val) {
                    cleaned[v] = val;
                    changed = true;
                }
            }
            liveBoard = cleaned;
        }
        const territory = this.assignTerritory(liveBoard);
        const secure = vertexGraphWeiqiRules.bensonAlive(liveBoard, this.neighbors);
        for (let v = 0; v < vCount; v++) {
            if (liveBoard[v] === 0 && secure.territory[v]) territory[v] = secure.territory[v];
        }
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和棋';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和棋' || resultText === 'draw') return 'draw';
        if (resultText.includes('白胜')) return 'player2';
        if (resultText.includes('黑胜')) return 'player1';
        if (resultText === 'player1' || resultText === 'player2' || resultText === 'draw') return resultText;
        return null;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.wireBoard(),
            komi: 3.25,
            initialBoard: this.wireInitialBoard(),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.wireMarkers(this.lastMoveMarkers),
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.wireMoveCoords(),
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
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
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        const { vertexCount, neighbors, koordOf, vertexByKoord } = generateHexBoardData(newSize);
        this.boardSize = newSize;
        this.openingBoard = undefined;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.koordOf = koordOf;
        this.vertexByKoord = vertexByKoord;
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
        this.slotJoinedAt = { player1: null, player2: null };
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
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '六角围棋',
            gameId: 'hexagon-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { player1: null, player2: null },
            initialPosition: this.encodeInitialPositionCoords(),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                const rc = this.koordOf[m.vertex] || [];
                return p + rc[0] + ',' + rc[1];
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
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
    }

    /** 棋谱着法 → 顶点：颜色字母 + 行,列（如 B5,5）；虚着写作 Bp / Wp */
    parseMoveEntry(entry) {
        if (typeof entry !== 'string') return entry;
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        const body = entry.slice(1);
        if (body === 'p') return { type: 'pass', player };
        const m = /^(\d+),(\d+)$/.exec(body);
        if (!m) return { type: 'move', player, vertex: -1 };
        const vertex = this.vertexByKoord.get(`${Number(m[1])},${Number(m[2])}`);
        return { type: 'move', player, vertex: vertex === undefined ? -1 : vertex };
    }

/** 编辑盘面：提交的是坐标二维盘 board[行][列]（锯齿，行长随行变化），内部转成顶点盘 */
    applyEditBoard(ws, msg) {
        const edited = msg && msg.board;
        const fail = (text) => {
            ws.send(JSON.stringify({ type: 'error', message: text }));
            return true;
        };
        if (!Array.isArray(edited)) return fail('无效的棋盘数据');
        const next = new Array(this.vertexCount).fill(0);
        for (let r = 0; r < edited.length; r++) {
            const line = edited[r];
            if (!Array.isArray(line)) return fail('无效的棋盘数据');
            for (let c = 0; c < line.length; c++) {
                const v = this.vertexOfKoord(r, c);
                if (v < 0) return fail('无效的棋盘数据');
                const val = Number(line[c]);
                if (val !== 0 && val !== 1 && val !== 2) return fail('棋盘数据包含非法值');
                next[v] = val;
            }
        }
        this.board = next;
        this.openingBoard = this.copyBoard(next);
        this.historyBoards = [];
        if (this.historyBoardSet && typeof this.historyBoardSet.clear === 'function') {
            this.historyBoardSet.clear();
            this.historyBoardSet.add(this.boardToString(next));
        }
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.currentPlayer = 1;
        this.lastMoveMarkers = [];
        this.passCounter = 0;
        this.gameOver = false;
        this.winner = null;
        this.broadcast({ type: 'editBoardAccepted', ...this.getState() });
        return true;
    }

    /** 行,列 → 顶点；非法坐标返回 -1 */
    vertexOfKoord(row, col) {
        const v = this.vertexByKoord.get(`${row},${col}`);
        return v === undefined ? -1 : v;
    }

    /* 下面四个 wire*：对外（协议/棋谱）只用坐标 行,列，内部一律顶点号 */

    /** 棋盘：board[行][列]（每行点数不同，是锯齿数组） */
    wireBoard() {
        const rows = [];
        for (let v = 0; v < this.vertexCount; v++) {
            const rc = this.koordOf[v];
            if (!rows[rc[0]]) rows[rc[0]] = [];
            rows[rc[0]][rc[1]] = this.board[v];
        }
        return rows;
    }

    /** 最近一手标记：[{row, col, color}] */
    wireMarkers(markers) {
        return (markers || []).map((m) => {
            if (m == null || m.vertex == null) return Object.assign({}, m);
            const rc = this.koordOf[m.vertex];
            if (!rc) return Object.assign({}, m);
            return { row: rc[0], col: rc[1], color: m.color };
        });
    }

    /** 初始（编辑后）盘面按坐标下发 */
    wireInitialBoard() {
        const opening = this.openingBoard || this.board;
        const rows = [];
        for (let v = 0; v < this.vertexCount; v++) {
            const rc = this.koordOf[v];
            if (!rows[rc[0]]) rows[rc[0]] = [];
            rows[rc[0]][rc[1]] = opening[v] || 0;
        }
        return rows;
    }

    /** 着手列表：[{type:'move', player, row, col}] */
    wireMoveCoords() {
        return this.moveCoords.map((m) => {
            if (m == null || m.type !== 'move' || m.vertex == null) return Object.assign({}, m);
            const rc = this.koordOf[m.vertex];
            if (!rc) return Object.assign({}, m);
            return { type: 'move', player: m.player, row: rc[0], col: rc[1] };
        });
    }

    /** 初始局面（编辑盘面）写成坐标串：B5,5 */
    encodeInitialPositionCoords() {
        const out = [];
        for (let v = 0; v < this.vertexCount; v++) {
            const val = this.openingBoard ? this.openingBoard[v] : 0;
            if (val !== 1 && val !== 2) continue;
            const rc = this.koordOf[v];
            out.push(`${val === 1 ? 'B' : 'W'}${rc[0]},${rc[1]}`);
        }
        return out;
    }

    /** 坐标串 → [[顶点, 颜色]] */
    parseInitialPositionCoords(initialPosition) {
        if (!Array.isArray(initialPosition)) return [];
        const stones = [];
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 2) continue;
            const p = s[0];
            if (p !== 'B' && p !== 'W') continue;
            const m = /^(\d+),(\d+)$/.exec(s.slice(1));
            if (!m) continue;
            const v = this.vertexByKoord.get(`${Number(m[1])},${Number(m[2])}`);
            if (v === undefined) continue;
            stones.push([v, p === 'B' ? 1 : 2]);
        }
        return stones;
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

        const { vertexCount, neighbors, koordOf, vertexByKoord } = generateHexBoardData(newSize);
        this.boardSize = newSize;
        this.koordOf = koordOf;
        this.vertexByKoord = vertexByKoord;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.resetToEmpty();

        for (const [v, val] of this.parseInitialPositionCoords(data.initialPosition)) this.board[v] = val;

        const rawMoves = data.moves || [];
        const moves = rawMoves.map((e) => this.parseMoveEntry(e));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
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
            if (!this.winner && (data.result === 'player1' || data.result === 'player2' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                boardSize: this.boardSize,
                // 打谱从空盘 + 全手顺即可；避免 initialPosition 与 moves 重复导致客户端回放失败
                initialPosition: this.encodeInitialPositionCoords(),
                moves: moves.map(m => (m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, row: this.koordOf[m.vertex] ? this.koordOf[m.vertex][0] : -1, col: this.koordOf[m.vertex] ? this.koordOf[m.vertex][1] : -1 }))
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
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                const row = Number(msg.row), col = Number(msg.col);
                if (!Number.isInteger(row) || !Number.isInteger(col)) return;
                const vertex = this.vertexOfKoord(row, col);
                if (vertex < 0 || vertex >= this.vertexCount) return;
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
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
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
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
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
                this.winner = slot === 'player1' ? 'player2' : 'player1';
                this.onResignResolved(slot);
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                const drawOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
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
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2')) return;
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
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        // 必须先广播 newGameStarted：broadcast 只遍历 players 与 observers。
        // 若先清空 players，原对局连接不在任何集合里，会收不到消息，客户端局面/路数 UI 不会更新。
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
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
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
