'use strict';

/**
 * 舒尔特方格房间逻辑（服务器只做名单，玩法全在客户端）：
 * 最多 16 人、无房主、各玩各的——棋盘在各自前端初始化，服务器不接收任何对局消息。
 * 加入：WS join 时 assignSlot() 返回 null 先入 observer，客户端发 enterRoom；
 * 无房主——有空位即自动入座（先到先得），满 16 人后进入者先观战，
 * 之后有空位时点「开始游戏」发 joinGame 补位（满员则提示「房间已满。」）。
 */
const MAX_PLAYERS = 4096;

class SchulteGridRoom {
    constructor(room) {
        this.room = room;
        /** @type {Map<string, {id: string, joinedAt: number}>} */
        this.players = new Map();          // 玩家id -> 信息（无 ws 引用：无对局状态）
        /** @type {string[]} */
        this.joinOrder = [];               // 入座顺序（大厅人数/断线让座用）
        this._idCounter = 0;               // 编号计数（玩家1、玩家2…；空房归零）
    }

    broadcast(data, exclude) {
        if (typeof this.room.broadcast === 'function') this.room.broadcast(data, exclude);
    }

    assignSlot() { return null; }          // 人人先为 observer，入座由 enterRoom/joinGame 决定

    getMoveCount() { return 0; }

    _genPlayerId() {
        this._idCounter += 1;
        return '玩家' + this._idCounter;
    }

    getState() {
        return {
            players: this.joinOrder.map((id) => ({ id })),
            maxPlayers: this.room.maxPlayers || MAX_PLAYERS
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        const base = this.getState();
        return slot ? { ...base, myPlayerId: slot } : { ...base, myPlayerId: null };
    }

    _addPlayer(ws) {
        const id = this._genPlayerId();
        this.players.set(id, { id, joinedAt: Date.now() });
        this.joinOrder.push(id);
        this.room.setPlayerSlot(ws, id);
        return id;
    }

    _removePlayer(slot) {
        this.players.delete(slot);
        this.joinOrder = this.joinOrder.filter((id) => id !== slot);
        if (this.joinOrder.length === 0) this._fullResetRoom();
    }

    /** 空房复位：清名单并把编号计数归零 */
    _fullResetRoom() {
        this.players.clear();
        this.joinOrder = [];
        this._idCounter = 0;
    }

    /** 清掉已断开的座位占位（断线重连等场景） */
    _purgeDeadSeats() {
        const WS_OPEN = 1;
        const dead = [];
        for (const id of this.joinOrder) {
            const ws = this.room.getPlayerBySlot(id);
            if (!ws || ws.readyState !== WS_OPEN) dead.push(id);
        }
        for (const id of dead) this._removePlayer(id);
    }

    _broadcastRoster(exclude) {
        this.broadcast({ type: 'playerListUpdate', players: this.getState().players }, exclude);
    }

    handleMessage(ws, msg) {
        switch (msg && msg.type) {
            case 'enterRoom': {
                if (this.room.getSlotByWs(ws)) {
                    // 已在座（重连等）：直接回到房间态
                    ws.send(JSON.stringify({ type: 'roomEntered', state: this.getStateForClient(ws) }));
                    return;
                }
                this._purgeDeadSeats();
                if (this.players.size >= (this.room.maxPlayers || MAX_PLAYERS)) {
                    // 满员：先作观战（静默），客户端点「开始游戏」时再发 joinGame 尝试补位
                    ws.send(JSON.stringify({ type: 'roomEntered', state: this.getStateForClient(ws) }));
                    return;
                }
                // 无房主：进入即自动入座（最多 MAX_PLAYERS 人各玩各的）
                const id = this._addPlayer(ws);
                ws.send(JSON.stringify({ type: 'playerJoined', playerId: id, state: this.getStateForClient(ws) }));
                this._broadcastRoster(ws);
                break;
            }
            case 'joinGame': {
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'error', message: '您已在游戏中。' }));
                    return;
                }
                this._purgeDeadSeats();
                if (this.players.size >= (this.room.maxPlayers || MAX_PLAYERS)) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                const id = this._addPlayer(ws);
                ws.send(JSON.stringify({ type: 'playerJoined', playerId: id, state: this.getStateForClient(ws) }));
                this._broadcastRoster(ws);
                break;
            }
            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        // 无对局状态：断线/离开即让座并广播（qi-server 的 leave/close 都会走到这里）
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        this._removePlayer(slot);
        this._broadcastRoster();
    }
}

module.exports = {
    initRoom(room) {
        room.maxPlayers = MAX_PLAYERS;
        room.gameLogic = new SchulteGridRoom(room);
    }
};
