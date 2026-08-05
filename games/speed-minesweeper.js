'use strict';

const DIRS8 = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
];

const DEFAULT_BOARD_SIZE = 19;
const DEFAULT_MINE_COUNT = 72;
const MAX_PLAYERS = 16;

const PLAYER_NAMES = [
    '木贼', '银杏', '水杉', '雪松', '云杉', '冷杉', '红杉', '落羽', '池杉', '圆柏',
    '侧柏', '龙柏', '垂柏', '桧柏', '刺柏', '杜松', '香樟', '楠木', '泡桐', '梧桐',
    '梓树', '楸树', '槐木', '榆树', '朴树', '榉树', '桑树', '构树', '青冈', '麻栎',
    '垂柳', '旱柳', '胡杨', '白杨', '青杨', '山杨', '毛白', '黑桦', '白桦', '红桦',
    '刺槐', '国槐', '龙爪', '木槿', '锦带', '忍冬', '金银', '琼花', '卫矛', '扶芳',
    '杜鹃', '映山', '石楠', '火棘', '花楸', '山楂', '海棠', '苹果', '白梨', '沙梨',
    '桃木', '碧桃', '蔷薇', '月季', '玫瑰', '木香', '棣棠', '草莓', '凌霄', '石榴',
    '夹竹', '牡丹', '芍药', '黄连', '五加', '人参', '三七', '薄荷', '罗勒', '紫苏',
    '荆芥', '益母', '夏枯', '藿香', '佩兰', '水仙', '石竹', '大黄', '芦竹', '淡竹',
    '毛竹', '紫竹', '桂花', '丁香', '紫荆', '合欢', '皂荚', '凤凰', '羊蹄', '酢浆'
];

function cellKey(r, c) {
    return `${r},${c}`;
}

function parseKey(k) {
    const i = k.indexOf(',');
    return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

function clampInt(v, lo, hi, fallback) {
    const n = parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
}

function countNeighborMines(mines, r, c, n) {
    let cnt = 0;
    for (const [dr, dc] of DIRS8) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && mines.has(cellKey(rr, cc))) cnt++;
    }
    return cnt;
}

function floodOpen(mines, opened, flags, r, c, n) {
    const stack = [[r, c]];
    while (stack.length) {
        const [cr, cc] = stack.pop();
        const k = cellKey(cr, cc);
        if (opened.has(k) || mines.has(k)) continue;
        if (flags.get(k) === 'flag') continue;
        if (flags.get(k) === 'question') flags.delete(k);
        opened.add(k);
        if (countNeighborMines(mines, cr, cc, n) !== 0) continue;
        for (const [dr, dc] of DIRS8) {
            const rr = cr + dr;
            const cc2 = cc + dc;
            if (rr < 0 || rr >= n || cc2 < 0 || cc2 >= n) continue;
            const nk = cellKey(rr, cc2);
            if (!opened.has(nk) && !mines.has(nk)) stack.push([rr, cc2]);
        }
    }
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}

function generateMines(n, mineCount, safeR, safeC) {
    const cells = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (r === safeR && c === safeC) continue;
            cells.push(cellKey(r, c));
        }
    }
    shuffleInPlace(cells);
    const count = Math.min(mineCount, cells.length);
    return new Set(cells.slice(0, count));
}

class SpeedMinesweeperRoom {
    constructor(room) {
        this.room = room;
        /** @type {'lobby'|'playing'|'finished'} */
        this.phase = 'lobby';
        this.gameStarted = false;
        this.finished = false;
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.mineCount = DEFAULT_MINE_COUNT;
        /** @type {Map<string, object>} */
        this.players = new Map();
        /** @type {string[]} */
        this.joinOrder = [];
        this.hostId = null;
        /** roundIndex (1-based) -> { mines: Set, start: {r,c}, openedSeed: Set, generatedAt: number } */
        this.roundMaps = new Map();
        this.matchStartAt = null;
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    assignSlot() {
        return null;
    }

    _genPlayerId() {
        const used = new Set(this.players.keys());
        const available = PLAYER_NAMES.filter(n => !used.has(n));
        if (available.length > 0) {
            return available[Math.floor(Math.random() * available.length)];
        }
        for (let t = 0; t < 500; t++) {
            const id = '选手' + (t + 1);
            if (!used.has(id)) return id;
        }
        return String(Date.now() % 100000);
    }

    _safeTotal(mines) {
        return this.boardSize * this.boardSize - mines.size;
    }

    _newPlayerBoard(round) {
        return {
            round,
            opened: new Set(),
            flags: new Map(),
            failed: false,
            finished: false,
            hitMines: new Set(),
            revealed: false,
            roundEnteredAt: Date.now(),
            personalStartAt: null,
            finishDurationMs: null,
            finishAt: null
        };
    }

    _ensureRoundSeedApplied(player) {
        const map = this.roundMaps.get(player.board.round);
        if (!map) return;
        for (const k of map.openedSeed) player.board.opened.add(k);
        if (player.board.personalStartAt == null) {
            player.board.personalStartAt = Math.max(map.generatedAt, player.board.roundEnteredAt);
        }
    }

    _getMap(round) {
        return this.roundMaps.get(round) || null;
    }

    _progressPercent(player) {
        const total = this.boardSize * this.boardSize;
        if (total <= 0) return 0;
        return Math.floor((player.board.opened.size / total) * 100 + 1e-9);
    }

    _flagCount(player) {
        let n = 0;
        for (const v of player.board.flags.values()) {
            if (v === 'flag') n++;
        }
        return n;
    }

    _clientCells(player, revealAll) {
        const n = this.boardSize;
        const map = this._getMap(player.board.round);
        const mines = map ? map.mines : new Set();
        const board = player.board;
        const cells = [];
        const showMines = revealAll || board.failed || board.finished || board.revealed;
        for (let r = 0; r < n; r++) {
            const row = [];
            for (let c = 0; c < n; c++) {
                const k = cellKey(r, c);
                const mark = board.flags.get(k) || null;
                const isMine = mines.has(k);
                const opened = board.opened.has(k);
                let kind = 'closed';
                let number = 0;
                if (mark === 'flag') kind = 'flag';
                else if (mark === 'question') kind = 'question';
                else if (opened) {
                    number = countNeighborMines(mines, r, c, n);
                    kind = number > 0 ? 'number' : 'empty';
                }
                if (showMines && isMine) {
                    kind = board.hitMines.has(k) ? 'mine-hit' : 'mine';
                }
                row.push({ kind, number });
            }
            cells.push(row);
        }
        const mineTotal = mines.size;
        const opened = board.opened.size;
        const remainingSafe = Math.max(0, this._safeTotal(mines) - opened);
        const flagged = this._flagCount(player);
        return {
            cells,
            opened,
            remainingSafe,
            flagged,
            remainingMines: Math.max(0, mineTotal - flagged),
            mineTotal,
            progressPercent: this._progressPercent(player),
            failed: board.failed,
            finished: board.finished,
            waitingFirstClick: !map,
            start: map ? map.start : null
        };
    }

    _playerPublic(p) {
        return {
            id: p.id,
            round: p.board.round,
            progressPercent: this._progressPercent(p),
            finished: p.board.finished,
            failed: p.board.failed,
            finishDurationMs: p.board.finishDurationMs,
            finishAt: p.board.finishAt
        };
    }

    _ranking() {
        const finished = [];
        const others = [];
        for (const id of this.joinOrder) {
            const p = this.players.get(id);
            if (!p) continue;
            if (p.board.finished && p.board.finishDurationMs != null) finished.push(p);
            else others.push(p);
        }
        finished.sort((a, b) => {
            if (a.board.finishDurationMs !== b.board.finishDurationMs) {
                return a.board.finishDurationMs - b.board.finishDurationMs;
            }
            if (a.board.round !== b.board.round) return a.board.round - b.board.round;
            return a.id.localeCompare(b.id);
        });
        return finished.map(p => this._playerPublic(p)).concat(others.map(p => this._playerPublic(p)));
    }

    getState() {
        return {
            phase: this.phase,
            gameStarted: this.gameStarted,
            finished: this.finished,
            hostId: this.hostId,
            boardSize: this.boardSize,
            mineCount: this.mineCount,
            players: this.joinOrder.map(id => this._playerPublic(this.players.get(id))).filter(Boolean),
            ranking: this._ranking()
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        const base = this.getState();
        if (!slot || !this.players.has(slot)) {
            return { ...base, myPlayerId: null, myBoard: null };
        }
        const p = this.players.get(slot);
        this._ensureRoundSeedApplied(p);
        return {
            ...base,
            myPlayerId: slot,
            myBoard: this._clientCells(p, false)
        };
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    broadcastState() {
        for (const [ws] of this.room.players) this.sendState(ws);
        for (const ws of this.room.observers) this.sendState(ws);
    }

    _addPlayer(ws) {
        const id = this._genPlayerId();
        const player = {
            id,
            joinedAt: Date.now(),
            ws,
            board: this._newPlayerBoard(1)
        };
        this.players.set(id, player);
        this.joinOrder.push(id);
        if (this.joinOrder.length === 1) this.hostId = id;
        this.room.setPlayerSlot(ws, id);
        if (this.gameStarted) {
            this._ensureRoundSeedApplied(player);
        }
        return id;
    }

    _removePlayer(slot) {
        this.players.delete(slot);
        this.joinOrder = this.joinOrder.filter(id => id !== slot);
    }

    _onRosterChanged() {
        if (this.joinOrder.length === 0) {
            this._fullResetRoom();
        } else {
            this.hostId = this.joinOrder[0];
        }
        this.broadcastState();
    }

    _fullResetRoom() {
        this.phase = 'lobby';
        this.gameStarted = false;
        this.finished = false;
        this.hostId = null;
        this.players.clear();
        this.joinOrder = [];
        this.roundMaps.clear();
        this.matchStartAt = null;
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.mineCount = DEFAULT_MINE_COUNT;
    }

    _resetToLobby() {
        this.phase = 'lobby';
        this.gameStarted = false;
        this.finished = false;
        this.roundMaps.clear();
        this.matchStartAt = null;
        for (const p of this.players.values()) {
            p.board = this._newPlayerBoard(1);
        }
    }

    _syncRosterWithConnections() {
        const liveIds = this.joinOrder.filter(id => this.room.getPlayerBySlot(id));
        for (const id of this.joinOrder) {
            if (!liveIds.includes(id)) this.players.delete(id);
        }
        this.joinOrder = liveIds;
        if (this.joinOrder.length === 0) {
            this._fullResetRoom();
        } else {
            this.hostId = this.joinOrder[0];
        }
    }

    _isActiveMatch() {
        return this.gameStarted && !this.finished;
    }

    _beginMatch(settings) {
        this.boardSize = settings.boardSize;
        this.mineCount = settings.mineCount;
        this.roundMaps.clear();
        this.matchStartAt = Date.now();
        this.gameStarted = true;
        this.finished = false;
        this.phase = 'playing';
        for (const p of this.players.values()) {
            p.board = this._newPlayerBoard(1);
        }
        this.broadcastState();
    }

    _parseStartSettings(msg) {
        const boardSize = clampInt(msg.boardSize, 7, 27, DEFAULT_BOARD_SIZE);
        const maxMines = boardSize * boardSize - 1;
        const mineCount = clampInt(msg.mineCount, 1, maxMines, DEFAULT_MINE_COUNT);
        return { boardSize, mineCount };
    }

    _generateRound(round, r, c) {
        const n = this.boardSize;
        if (r < 0 || r >= n || c < 0 || c >= n) return null;
        const mines = generateMines(n, this.mineCount, r, c);
        const openedSeed = new Set();
        const dummyFlags = new Map();
        floodOpen(mines, openedSeed, dummyFlags, r, c, n);
        const map = {
            mines,
            start: { r, c },
            openedSeed,
            generatedAt: Date.now()
        };
        this.roundMaps.set(round, map);
        return map;
    }

    _applyMapToPlayersOnRound(round) {
        const map = this.roundMaps.get(round);
        if (!map) return;
        for (const p of this.players.values()) {
            if (p.board.round !== round) continue;
            if (p.board.finished || p.board.failed) continue;
            for (const k of map.openedSeed) p.board.opened.add(k);
            if (p.board.personalStartAt == null) {
                p.board.personalStartAt = Math.max(map.generatedAt, p.board.roundEnteredAt);
            }
        }
    }

    _enterNextRound(player) {
        const next = player.board.round + 1;
        player.board = this._newPlayerBoard(next);
        this._ensureRoundSeedApplied(player);
    }

    _failPlayer(player, hitKeys) {
        const board = player.board;
        if (board.failed || board.finished) return;
        board.failed = true;
        board.revealed = true;
        for (const k of hitKeys) board.hitMines.add(k);
        const playerId = player.id;
        const failRound = board.round;
        setTimeout(() => {
            const p = this.players.get(playerId);
            if (!p || !p.board.failed || p.board.round !== failRound || p.board.finished) return;
            this._enterNextRound(p);
            this.broadcastState();
        }, 1600);
    }

    _finishPlayer(player) {
        const board = player.board;
        if (board.finished || board.failed) return;
        board.finished = true;
        board.revealed = true;
        const start = board.personalStartAt != null ? board.personalStartAt : board.roundEnteredAt;
        board.finishAt = Date.now();
        board.finishDurationMs = Math.max(0, board.finishAt - start);
        this._checkAllFinished();
    }

    _checkAllFinished() {
        if (!this.gameStarted || this.finished) return;
        if (this.players.size === 0) return;
        let allDone = true;
        for (const p of this.players.values()) {
            if (!p.board.finished) {
                allDone = false;
                break;
            }
        }
        if (allDone) {
            this.finished = true;
            this.phase = 'finished';
        }
    }

    _openCell(player, r, c) {
        const n = this.boardSize;
        const board = player.board;
        if (board.finished || board.failed) return;
        if (r < 0 || r >= n || c < 0 || c >= n) return;
        const k = cellKey(r, c);
        const mark = board.flags.get(k);
        if (mark === 'flag' || mark === 'question') return;
        if (board.opened.has(k)) return;

        let map = this._getMap(board.round);
        if (!map) {
            map = this._generateRound(board.round, r, c);
            if (!map) return;
            this._applyMapToPlayersOnRound(board.round);
            // 生成者自己也已在 apply 中打开
            if (board.opened.size >= this._safeTotal(map.mines)) {
                this._finishPlayer(player);
            }
            this.broadcastState();
            return;
        }

        if (map.mines.has(k)) {
            this._failPlayer(player, new Set([k]));
            this.broadcastState();
            return;
        }
        floodOpen(map.mines, board.opened, board.flags, r, c, n);
        if (board.personalStartAt == null) {
            board.personalStartAt = Date.now();
        }
        if (board.opened.size >= this._safeTotal(map.mines)) {
            this._finishPlayer(player);
        }
        this.broadcastState();
    }

    _chord(player, r, c) {
        const n = this.boardSize;
        const board = player.board;
        const map = this._getMap(board.round);
        if (!map || board.finished || board.failed) return;
        const k = cellKey(r, c);
        if (!board.opened.has(k)) return;
        const num = countNeighborMines(map.mines, r, c, n);
        if (num <= 0) return;
        let flagCnt = 0;
        const neighbors = [];
        for (const [dr, dc] of DIRS8) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            const nk = cellKey(rr, cc);
            neighbors.push([rr, cc, nk]);
            if (board.flags.get(nk) === 'flag') flagCnt++;
        }
        if (flagCnt !== num) return;
        const hitMines = new Set();
        const toOpen = [];
        for (const [rr, cc, nk] of neighbors) {
            if (board.flags.get(nk) === 'flag') continue;
            if (board.opened.has(nk)) continue;
            if (map.mines.has(nk)) hitMines.add(nk);
            else toOpen.push([rr, cc]);
        }
        if (hitMines.size > 0) {
            this._failPlayer(player, hitMines);
            this.broadcastState();
            return;
        }
        for (const [rr, cc] of toOpen) {
            floodOpen(map.mines, board.opened, board.flags, rr, cc, n);
        }
        if (board.opened.size >= this._safeTotal(map.mines)) {
            this._finishPlayer(player);
        }
        this.broadcastState();
    }

    _cycleMark(player, r, c) {
        const n = this.boardSize;
        const board = player.board;
        if (board.finished || board.failed) return;
        if (r < 0 || r >= n || c < 0 || c >= n) return;
        const k = cellKey(r, c);
        if (board.opened.has(k)) return;
        const cur = board.flags.get(k) || null;
        if (cur == null) board.flags.set(k, 'flag');
        else if (cur === 'flag') board.flags.set(k, 'question');
        else board.flags.delete(k);
        this.broadcastState();
    }

    handleMessage(ws, msg) {
        switch (msg.type) {
            case 'enterRoom': {
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'roomEntered', hostId: this.hostId, state: this.getStateForClient(ws) }));
                    return;
                }
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'roomEntered', hostId: this.hostId, state: this.getStateForClient(ws) }));
                    return;
                }
                if (this.players.size >= this.room.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                this._syncRosterWithConnections();
                if (this.joinOrder.length === 0) {
                    const id = this._addPlayer(ws);
                    ws.send(JSON.stringify({
                        type: 'playerJoined',
                        playerId: id,
                        hostId: this.hostId,
                        state: this.getStateForClient(ws)
                    }));
                    this.broadcast({
                        type: 'playerListUpdate',
                        hostId: this.hostId,
                        players: this.getState().players
                    }, ws);
                } else {
                    ws.send(JSON.stringify({
                        type: 'roomEntered',
                        hostId: this.hostId,
                        state: this.getStateForClient(ws)
                    }));
                }
                break;
            }
            case 'joinGame': {
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，无法加入。' }));
                    return;
                }
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'error', message: '您已在游戏中。' }));
                    return;
                }
                if (this.players.size >= this.room.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                this._syncRosterWithConnections();
                const id = this._addPlayer(ws);
                ws.send(JSON.stringify({
                    type: 'playerJoined',
                    playerId: id,
                    hostId: this.hostId,
                    state: this.getStateForClient(ws)
                }));
                this.broadcast({
                    type: 'playerListUpdate',
                    hostId: this.hostId,
                    players: this.getState().players
                }, ws);
                break;
            }
            case 'startGame': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || slot !== this.hostId) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏。' }));
                    return;
                }
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'error', message: '游戏已开始。' }));
                    return;
                }
                if (this.players.size < 1) {
                    ws.send(JSON.stringify({ type: 'error', message: '至少需要一名玩家。' }));
                    return;
                }
                this._beginMatch(this._parseStartSettings(msg));
                break;
            }
            case 'restartGame': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || slot !== this.hostId) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以重新开始。' }));
                    return;
                }
                if (!this.finished) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局尚未结束。' }));
                    return;
                }
                this._resetToLobby();
                this.broadcastState();
                break;
            }
            case 'openCell': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || !this.gameStarted || this.finished) return;
                const p = this.players.get(slot);
                if (!p || p.board.finished) return;
                this._openCell(p, msg.row | 0, msg.col | 0);
                break;
            }
            case 'chordCell': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || !this.gameStarted || this.finished) return;
                const p = this.players.get(slot);
                if (!p || p.board.finished) return;
                this._chord(p, msg.row | 0, msg.col | 0);
                break;
            }
            case 'markCell': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || !this.gameStarted || this.finished) return;
                const p = this.players.get(slot);
                if (!p || p.board.finished) return;
                this._cycleMark(p, msg.row | 0, msg.col | 0);
                break;
            }
            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        if (this._isActiveMatch()) {
            const p = this.players.get(slot);
            if (p) p.ws = null;
            return;
        }
        this._removePlayer(slot);
        this._onRosterChanged();
    }
}

module.exports = {
    initRoom(room) {
        room.maxPlayers = MAX_PLAYERS;
        room.gameLogic = new SpeedMinesweeperRoom(room);
    }
};
