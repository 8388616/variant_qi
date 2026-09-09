'use strict';

/**
 * 对战舒尔特方格（versus-schulte-grid）房间逻辑。
 * 最多 4 人、房主制（最先入座者为房主）：房主开局/重开，全员同时倒计时 3 秒后同时开始。
 * 共享进度：全员同一张 N×N 乱序序号棋盘；谁先点到「当前序号」谁得 1 分（服务端裁决），
 * 点其它格无效；所有状态（倒计时/开局布局/进度/积分/结束）由服务端持续广播同步。
 * 房间 UI 与玩法均要求不断与服务器同步（与单机舒尔特方格不同）。
 */
const MAX_PLAYERS = 4;
const DEFAULT_BOARD_SIZE = 9;          // 默认 9 路：1..81
const BOARD_SIZE_MIN = 2;
const BOARD_SIZE_MAX = 21;
const COUNTDOWN_MS = 3000;

const PLANT_NAMES = [
    '银杏', '水杉', '雪松', '云杉', '冷杉', '红杉', '落羽', '池杉', '圆柏', '侧柏',
    '香樟', '楠木', '泡桐', '梧桐', '梓树', '槐木', '榆树', '朴树', '榉树', '桑树',
    '垂柳', '旱柳', '胡杨', '白杨', '青杨', '山杨', '毛白', '黑桦', '白桦', '红桦',
    '刺槐', '国槐', '木槿', '琼花', '海棠', '山楂', '桃木', '碧桃', '蔷薇', '月季',
    '水仙', '石竹', '桂花', '丁香', '紫荆', '合欢', '杜鹃', '映山', '琼花', '忍冬'
];

function randInt(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

class VersusSchulteGridRoom {
    constructor(room) {
        this.room = room;
        /** @type {Map<string, {id: string, score: number}>} */
        this.players = new Map();
        this.joinOrder = [];
        this.hostId = null;
        this.phase = 'lobby';          // lobby | countdown | playing | finished
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.layout = null;            // layout[r][c] = 序号（棋盘共享，服务端生成）
        this.nextVal = 1;              // 当前应点序号（共享进度）
        this.countdownTimer = null;
        this.roundNo = 0;
    }

    // ---------------- 基础 ----------------
    broadcast(data, exclude) {
        if (typeof this.room.broadcast === 'function') this.room.broadcast(data, exclude);
    }

    assignSlot() { return null; }      // 人人先为 observer，入座由 enterRoom/joinGame 决定

    getMoveCount() { return this.phase === 'playing' ? this.nextVal - 1 : 0; }

    _genPlayerId() {
        const used = new Set(this.players.keys());
        const avail = PLANT_NAMES.filter((n) => !used.has(n));
        if (avail.length > 0) return avail[randInt(0, avail.length - 1)];
        for (let t = 0; t < 500; t++) {
            const base = PLANT_NAMES[randInt(0, PLANT_NAMES.length - 1)];
            if (!used.has(base + t)) return base + t;
        }
        return '选手' + String(Date.now() % 100000);
    }

    _playerList() {
        return this.joinOrder.map((id) => ({ id, score: (this.players.get(id) || {}).score || 0 }));
    }

    getState() {
        return {
            players: this._playerList(),
            hostId: this.hostId,
            phase: this.phase,
            maxPlayers: this.room.maxPlayers || MAX_PLAYERS,
            boardSize: this.boardSize,
            nextVal: this.nextVal,
            layout: this.layout
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        const base = this.getState();
        return slot ? { ...base, myPlayerId: slot } : { ...base, myPlayerId: null };
    }

    _broadcastRoster(exclude) {
        const state = this.getState();
        this.broadcast({ type: 'stateUpdate', state }, exclude);
    }

    _fullStatePush(exclude) {
        const state = this.getState();
        this.broadcast({ type: 'stateUpdate', state }, exclude);
        return state;
    }

    _clearCountdownTimer() {
        if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = null; }
    }

    _fullResetRoom() {
        this._clearCountdownTimer();
        this.players.clear();
        this.joinOrder = [];
        this.hostId = null;
        this.phase = 'lobby';
        this.boardSize = DEFAULT_BOARD_SIZE;
        this.layout = null;
        this.nextVal = 1;
    }

    // ---------------- 入座 ----------------
    _addPlayer(ws) {
        const id = this._genPlayerId();
        this.players.set(id, { id, score: 0 });
        this.joinOrder.push(id);
        if (!this.hostId) this.hostId = id;      // 最先入座 = 房主
        this.room.setPlayerSlot(ws, id);
        return id;
    }

    _removePlayer(slot) {
        this.players.delete(slot);
        this.joinOrder = this.joinOrder.filter((id) => id !== slot);
        if (this.hostId === slot && this.joinOrder.length > 0) this.hostId = this.joinOrder[0];
        if (this.joinOrder.length === 0) this._fullResetRoom();
    }

    _purgeDeadSeats() {
        const WS_OPEN = 1;
        const dead = [];
        for (const id of this.joinOrder) {
            const ws = this.room.getPlayerBySlot(id);
            if (!ws || ws.readyState !== WS_OPEN) dead.push(id);
        }
        for (const id of dead) this._removePlayer(id);
    }

    _seatable() {
        return this.players.size < (this.room.maxPlayers || MAX_PLAYERS);
    }

    // ---------------- 开局（房主） ----------------
    _generateLayout() {
        const n = this.boardSize;
        const seq = [];
        for (let i = 1; i <= n * n; i++) seq.push(i);
        shuffleInPlace(seq);
        const layout = Array(n).fill().map(() => Array(n).fill(0));
        for (let i = 0; i < seq.length; i++) {
            layout[Math.floor(i / n)][i % n] = seq[i];
        }
        return layout;
    }

    _startRound() {
        // 房主开局/重开：重置积分与布局，进入 3 秒同步倒计时
        for (const p of this.players.values()) p.score = 0;
        this.layout = this._generateLayout();
        this.nextVal = 1;
        this.roundNo += 1;
        this.phase = 'countdown';
        this._clearCountdownTimer();
        const serverNow = Date.now();
        const deadline = serverNow + COUNTDOWN_MS;
        this.broadcast({
            type: 'roundCountdown',
            state: this.getState(),
            serverNow,
            deadline
        });
        this.countdownTimer = setTimeout(() => this._beginPlay(), COUNTDOWN_MS);
    }

    _beginPlay() {
        this.countdownTimer = null;
        if (this.phase !== 'countdown') return;
        this.phase = 'playing';
        this.nextVal = 1;
        this.broadcast({
            type: 'roundStart',
            state: this.getState(),
            serverNow: Date.now()
        });
    }

    _finishRound() {
        this.phase = 'finished';
        const scores = this._playerList();
        this.broadcast({
            type: 'roundFinished',
            state: this.getState(),
            scores
        });
        // 对局结束：除房主外的参与者自动回到观战（想参加下一局需重新点「入座」）。
        // 房主保留在座：点「新局」即直接开始新一局（无需询问任何人）。
        if (this.hostId) {
            const others = this.joinOrder.filter((id) => id !== this.hostId);
            for (const id of others) {
                const ws = this.room.getPlayerBySlot(id);
                if (!ws || ws.readyState !== 1) continue;
                this.players.delete(id);
                this.room.addObserver(ws);
                ws.send(JSON.stringify({ type: 'stateUpdate', state: this.getStateForClient(ws) }));
            }
            this.joinOrder = this.joinOrder.filter((id) => id === this.hostId);
        }
        this._fullStatePush();
    }

    // ---------------- 行棋判分（服务端裁决共享进度） ----------------
    _handleMove(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        if (this.phase !== 'playing') return;
        const n = this.boardSize;
        const row = Math.floor(Number(msg.row));
        const col = Math.floor(Number(msg.col));
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        if (row < 0 || row >= n || col < 0 || col >= n) return;
        if (!this.layout) return;
        if (this.layout[row][col] !== this.nextVal) return;   // 点错：无效（点已过的/未来的都不算）
        // 先点中当前序号者得 1 分并推进共享进度
        const p = this.players.get(slot);
        if (!p) return;
        p.score += 1;
        this.nextVal += 1;
        const scores = this._playerList();
        const claimed = this.layout[row][col];
        if (this.nextVal > n * n) {
            this.broadcast({
                type: 'progress',
                scorer: slot,
                row, col, claimed,
                nextVal: this.nextVal,
                scores,
                finished: true
            });
            this._finishRound();
            return;
        }
        this.broadcast({
            type: 'progress',
            scorer: slot,
            row, col, claimed,
            nextVal: this.nextVal,
            scores
        });
    }

    // ---------------- 消息 ----------------
    handleMessage(ws, msg) {
        switch (msg && msg.type) {
            case 'enterRoom': {
                if (this.room.getSlotByWs(ws)) {
                    // 已在座（重连等）：直接回到房间态
                    ws.send(JSON.stringify({ type: 'roomEntered', state: this.getStateForClient(ws) }));
                    return;
                }
                // 与棋类一致：进入不自动入座，先为观战者；点「入座」后 joinGame 才入座
                ws.send(JSON.stringify({ type: 'roomEntered', state: this.getStateForClient(ws) }));
                break;
            }
            case 'joinGame': {
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'error', message: '您已在游戏中。' }));
                    return;
                }
                this._purgeDeadSeats();
                if (!this._seatable()) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                if (this.phase === 'playing') {
                    ws.send(JSON.stringify({ type: 'error', message: '对局进行中，请等待本局结束。' }));
                    return;
                }
                const id = this._addPlayer(ws);
                ws.send(JSON.stringify({ type: 'playerJoined', playerId: id, state: this.getStateForClient(ws) }));
                this._fullStatePush(ws);
                break;
            }
            case 'startGame': {
                const slot = this.room.getSlotByWs(ws);
                if (slot !== this.hostId) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏。' }));
                    return;
                }
                if (this.phase === 'playing' || this.phase === 'countdown') {
                    ws.send(JSON.stringify({ type: 'error', message: '对局进行中。' }));
                    return;
                }
                if (this.players.size < 2) {
                    ws.send(JSON.stringify({ type: 'error', message: '至少需要两名玩家才能开始。' }));
                    return;
                }
                this._startRound();
                break;
            }
            case 'setBoardSize': {
                // 规则：开局前/对局结束后可改路数；无人入座时任何人都可改，
                // 有人入座时仅房主可改（对局中不可改）
                const slot = this.room.getSlotByWs(ws);
                if (this.phase !== 'lobby' && this.phase !== 'finished') return;
                if (slot) {
                    if (slot !== this.hostId) return;      // 有人入座时仅房主可改
                } else if (this.players.size > 0) {
                    return;                                // 有人入座时观战者不可改
                }
                const n = parseInt(String(msg.size ?? ''), 10);
                if (!Number.isFinite(n)) return;
                this.boardSize = Math.min(BOARD_SIZE_MAX, Math.max(BOARD_SIZE_MIN, n));
                this._fullStatePush();
                break;
            }
            case 'move':
                this._handleMove(ws, msg);
                break;
            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        this._removePlayer(slot);
        if (this.joinOrder.length === 0) {
            this._fullResetRoom();
            return;
        }
        this._fullStatePush();
    }
}

module.exports = {
    initRoom(room) {
        room.maxPlayers = MAX_PLAYERS;
        room.gameLogic = new VersusSchulteGridRoom(room);
    }
};
