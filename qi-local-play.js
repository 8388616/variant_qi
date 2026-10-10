const crypto = require('crypto');

const STATE_MESSAGES = new Set(['broadcast', 'gameState', 'timeControlAgreed', 'roomReset', 'newGameStarted']);
const PEER_MESSAGES = new Set(['undoRequest', 'drawRequest', 'requestEnd', 'newGameRequest', 'scoreProposal', 'timeControlNegotiation', 'error', 'undoRejected']);

/** 两个正常棋手共用一个页面；棋种仍按原来的双人协议校验和保存着法。 */
class LocalPlay {
    constructor(room, client) {
        this.room = room;
        this.client = client;
        this.token = crypto.randomBytes(32).toString('hex');
        this.active = true;
        this.queue = [];
        this.dispatching = false;
        this.lastSlot = null;
        this.seats = {};
        for (const slot of ['player1', 'player2']) {
            const seat = {
                localPlay: this,
                get readyState() { return seat.localPlay.active ? 1 : 3; },
                send: (raw) => this.receive(room.getSlotByWs(seat) || slot, JSON.parse(raw))
            };
            this.seats[slot] = seat;
        }
    }

    turnSlot() {
        const logic = this.room.gameLogic;
        if (!logic.matchStarted && logic.tcNego && logic.tcNego.waitingSlot) return logic.tcNego.waitingSlot;
        if (logic.currentPlayer === 1 || logic.currentPlayer === 'player1') return 'player1';
        if (logic.currentPlayer === 2 || logic.currentPlayer === 'player2') return 'player2';
        const state = logic.getState();
        return state.currentPlayer === 2 || state.currentPlayer === 'player2' ? 'player2' : 'player1';
    }

    state() {
        const logic = this.room.gameLogic;
        const seat = this.room.getPlayerBySlot(this.turnSlot());
        const state = logic.getStateForClient ? logic.getStateForClient(seat) : logic.getState();
        return { ...state, hostSlot: this.turnSlot(), localPlay: true };
    }

    send(message) {
        if (this.client && this.client.readyState === 1) this.client.send(JSON.stringify(message));
    }

    syncColor() {
        const slot = this.turnSlot();
        const changed = slot !== this.lastSlot;
        if (changed) {
            this.lastSlot = slot;
            this.send({ type: 'colorAssigned', color: slot, isHost: true, finalized: true, localPlay: true });
        }
        return changed;
    }

    receive(slot, message) {
        if (!this.active) return;
        if (this.dispatching) this.queue.push({ slot, message });
        else this.deliver(slot, message, this.syncColor());
    }

    deliver(slot, message, changed) {
        // 双方的完整/遮罩局面各生成一份，只向页面发送当前行棋方的那一份。
        if (message.type === 'colorAssigned') return false;
        // 本地双方由同一页面操作，申请悔棋和开始数点无需对方确认。
        if (message.type === 'undoRequest' || message.type === 'requestEnd') return false;
        if (this.room.gameLogic.matchStarted && (message.type === 'timeControlNegotiation' || message.type === 'timeControlWaitPeer')) return false;
        if (slot !== this.turnSlot() && !PEER_MESSAGES.has(message.type)) return false;
        if (STATE_MESSAGES.has(message.type)) {
            message = { ...message, ...(changed ? this.state() : {}), localPlay: true };
        }
        this.send(message);
        return STATE_MESSAGES.has(message.type);
    }

    flush() {
        if (!this.active) { this.queue = []; return; }
        const changed = this.syncColor();
        const seen = new Set();
        let stateSent = false;
        for (const { slot, message } of this.queue.splice(0)) {
            // 数点提案等会分别发给两位棋手，同一个页面只打开一次对话框。
            const key = JSON.stringify(message);
            if (PEER_MESSAGES.has(message.type) && seen.has(key)) continue;
            if (this.deliver(slot, message, changed)) stateSent = true;
            seen.add(key);
        }
        if (!stateSent) this.send({ type: 'gameState', ...this.state() });
    }

    start() {
        const { room } = this;
        room.localPlay = this;
        room.observers.delete(this.client);
        this.client._qiLocalPlay = this;
        this.dispatching = true;
        for (const slot of ['player1', 'player2']) room.setPlayerSlot(this.seats[slot], slot);
        const logic = room.gameLogic;
        logic.hostWs = this.seats.player1;
        if (logic.slotJoinedAt) logic.slotJoinedAt = { player1: Date.now(), player2: Date.now() };
        // 保留原有对局设置窗口、让子和特殊开局逻辑，当前页面替双方确认设置。
        if (typeof logic.afterColorAssigned === 'function') {
            for (const slot of ['player1', 'player2']) logic.afterColorAssigned(this.seats[slot], slot);
        }
        if (!logic.tcNego && !logic.matchStarted && typeof logic._finalizeTimeControl === 'function') {
            logic._finalizeTimeControl({ ok: true, timed: false, colorChoice: 'player1', colorChooserSlot: 'player1', handicap: 0 });
        } else if (!logic.tcNego && !logic.matchStarted) {
            logic.matchStarted = true;
            if (typeof logic.onMatchStarted === 'function') logic.onMatchStarted();
        }
        this.dispatching = false;
        this.send({ type: 'localGameStarted', token: this.token });
        this.flush();
        room.broadcast({ type: 'playerList', players: ['player1', 'player2'] });
        room.syncSwitchState();
        room.syncSoloSeatState();
    }

    resume(client) {
        if (!this.active || this.client && this.client.readyState === 1) return false;
        this.client = client;
        this.room.observers.delete(client);
        client._qiLocalPlay = this;
        this.lastSlot = null;
        this.room.clearDestroyTimer();
        this.send({ type: 'localGameStarted', token: this.token });
        this.syncColor();
        this.send({ type: 'gameState', ...this.state() });
        const logic = this.room.gameLogic;
        if (logic.tcNego && !logic.matchStarted && typeof logic._qiResendNegotiationUi === 'function')
            logic._qiResendNegotiationUi(this.room.getPlayerBySlot(this.turnSlot()));
        this.room.syncSoloSeatState();
        return true;
    }

    disconnect(client) {
        if (this.client === client) this.client = null;
        client._qiLocalPlay = null;
        this.room.syncSoloSeatState();
        this.room.scheduleDestruction();
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        this.room.localPlay = null;
        for (const seat of Object.values(this.seats)) {
            const slot = this.room.players.get(seat);
            this.room.players.delete(seat);
            if (slot) this.room.slotOccupancy.delete(slot);
            this.room.observers.delete(seat);
        }
        if (this.client) {
            this.client._qiLocalPlay = null;
            this.room.addObserver(this.client);
            this.send({ type: 'localGameEnded' });
            this.send({ type: 'seatLeft', localPlay: false });
        }
        this.queue = [];
    }

    handleMessage(message) {
        const logic = this.room.gameLogic;
        if (message.type === 'timeControlSubmit') message = { ...message, colorChoice: 'player1' };
        if (message.type === 'leaveSeat' && !logic.matchStarted) {
            logic.tcNego = null;
            logic.hostWs = null;
            this.stop();
            this.room.broadcast({ type: 'timeControlReset' });
            this.room.broadcast({ type: 'gameState', ...logic.getState() });
            return;
        }
        let slot = this.turnSlot();
        // 原协议的确认包仍由另一位棋手提交，避免把两方确认合并成同一个棋手。
        const requester = {
            undoResponse: logic.pendingUndo && (logic.pendingUndo.requester || logic.pendingUndo),
            drawResponse: logic.pendingDraw,
            newGameResponse: logic.pendingNewGame,
            endResponse: logic.pendingEnd && logic.pendingEnd.requester
        }[message.type];
        if (requester) slot = this.room.getSlotByWs(requester) === 'player1' ? 'player2' : 'player1';
        this.dispatching = true;
        try {
            if (message.type === 'fogWantNumbers') {
                for (const seat of Object.values(this.seats)) seat.__fogWantNumbers = !!message.enabled;
            }
            if (message.type === 'scoreResponse' && logic.pendingScore) {
                for (const seat of Object.values(this.seats)) {
                    if (logic.pendingScore) logic.handleMessage(seat, message);
                }
            } else {
                logic.handleMessage(this.room.getPlayerBySlot(slot), message);
                if (message.type === 'requestUndo' && logic.pendingUndo) {
                    const requester = logic.pendingUndo.requester || logic.pendingUndo;
                    const responder = this.room.getSlotByWs(requester) === 'player1' ? 'player2' : 'player1';
                    logic.handleMessage(this.room.getPlayerBySlot(responder), { type: 'undoResponse', accept: true });
                }
                if (message.type === 'requestEnd' && logic.pendingEnd) {
                    const pending = logic.pendingEnd;
                    const responder = this.room.getSlotByWs(pending.requester) === 'player1' ? 'player2' : 'player1';
                    logic.handleMessage(pending.opponent || this.room.getPlayerBySlot(responder), { type: 'endResponse', accept: true });
                }
                if (message.type === 'timeControlSubmit' && logic.tcNego && logic.tcNego.phase === 'respond') {
                    logic.handleMessage(this.room.getPlayerBySlot(logic.tcNego.waitingSlot), { type: 'timeControlAccept' });
                }
            }
        } finally {
            this.dispatching = false;
            this.flush();
        }
    }
}

function install(room) {
    const logic = room.gameLogic;
    // 对外只有一个真实座位；内部的两个棋手继续用于棋种原有的规则校验。
    for (const name of ['getState', 'getInitialState', 'getStateForClient']) {
        if (typeof logic[name] !== 'function') continue;
        const original = logic[name].bind(logic);
        logic[name] = (...args) => ({ ...original(...args), ...room.soloSeatState() });
    }
    for (const method of ['resetGame', 'resetToEmpty']) {
        if (typeof logic[method] !== 'function') continue;
        const original = logic[method].bind(logic);
        logic[method] = (...args) => {
            if (room.localPlay) room.localPlay.stop();
            return original(...args);
        };
    }
}

function resume(room, client) {
    if (!room.observers.has(client)) return;
    room.purgeDeadClients();
    if (!room.getSoloMode() || room.getHumanCount()) {
        client.send(JSON.stringify({ type: 'soloSeatState', ...room.soloSeatState() }));
        return;
    }
    if (room.localPlay) {
        room.localPlay.resume(client);
        return;
    }
    const logic = room.gameLogic;
    const slot = logic.computerSlot === 'player1' ? 'player2' : 'player1';
    room.setPlayerSlot(client, slot);
    logic.hostWs = client;
    if (logic.slotJoinedAt) logic.slotJoinedAt[slot] = Date.now();
    client.send(JSON.stringify({ type: 'colorAssigned', color: slot, isHost: true, finalized: true, localPlay: false }));
    client.send(JSON.stringify({ type: 'gameState', ...(logic.getStateForClient ? logic.getStateForClient(client) : logic.getState()) }));
    room.broadcast({ type: 'slotOccupied', slot }, client);
    room.clearDestroyTimer();
    room.syncSoloSeatState();
    room.syncSwitchState();
    if (typeof logic.resumeComputerGame === 'function') logic.resumeComputerGame(client);
}

function start(room, client) {
    const reject = (message) => client.send(JSON.stringify({ type: 'error', message }));
    room.purgeDeadClients();
    if (!room.observers.has(client)) return reject('请先加入房间并保持观战状态。');
    if (!room.gameLogic.boardSeatOverlay || room.maxPlayers !== 2) return reject('该棋类不支持本地对战。');
    if (room.localPlay || room.getSeatedCount() || room.gameLogic.matchStarted || room.gameLogic.gameOver) {
        return reject('只有开局前且无人落座时可以开始本地对战。');
    }
    const session = new LocalPlay(room, client);
    try { session.start(); }
    catch (error) {
        session.stop();
        room.gameLogic.tcNego = null;
        console.error('本地对战开局失败', error);
        reject('本地对战开局失败，请重新尝试。');
    }
}

module.exports = { install, start, resume };
