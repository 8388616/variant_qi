const crypto = require('crypto');
const express = require('express');
const express_rate_limit = require("express-rate-limit");
const fs = require('fs');
const http = require('http');
const path = require('path');
const ws = require('ws');

const Express = express();
Express.set("trust proxy", "127.0.0.1");
const PORT = 3100;

Express.use(express.json());
const ExpressRateLimit = express_rate_limit({
    windowMs: 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false
});
Express.use(ExpressRateLimit);

const rooms = {};

const CHAT_MESSAGES_PATH = path.join(__dirname, 'chat-messages.csv');
const CHAT_LOG_LIMIT = 80;

function parseChatMessagesCsv(text) {
    const map = new Map();
    const lines = String(text || '').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const comma = line.indexOf(',');
        if (comma <= 0) continue;
        const id = line.slice(0, comma).trim();
        const content = line.slice(comma + 1).trim();
        if (!id || !content) continue;
        map.set(id, content);
    }
    return map;
}

function loadChatMessages() {
    try {
        if (!fs.existsSync(CHAT_MESSAGES_PATH)) return new Map();
        return parseChatMessagesCsv(fs.readFileSync(CHAT_MESSAGES_PATH, 'utf8'));
    } catch (e) {
        console.error('加载 chat-messages.csv 失败', e);
        return new Map();
    }
}

let chatMessages = loadChatMessages();

/** 有 room-plugins/{id}-room.js 则走统一房间页（按文件探测，无需改白名单/重启） */
function usesRoomShell(gameId) {
    return fs.existsSync(path.join(__dirname, 'public', 'room-plugins', `${gameId}-room.js`));
}

function findGameAiScriptPath(gameId) {
    const fileName = `${gameId}-ai.js`;
    const flat = path.join(__dirname, 'games', fileName);
    if (fs.existsSync(flat)) return flat;
    const publicAi = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(publicAi)) return publicAi;
    return null;
}

/** 房间逻辑：games/{id}.js（部署约定） */
function findGameModulePath(gameId) {
    const flat = path.join(__dirname, 'games', `${gameId}.js`);
    return fs.existsSync(flat) ? flat : null;
}

/** 正式开局后聊天显示的执方名（与各 room-plugin 的 slotUi.statusText 对齐） */
const CHAT_SIDE_LABELS_BY_GAME = {
    xiangqi: { black: '红方', white: '黑方' },
    'fog-xiangqi': { black: '红方', white: '黑方' },
    'double-xiangqi': { black: '红方', white: '黑方' },
    'hexagon-xiangqi': { black: '红方', white: '黑方' },
    'dyeing-xiangqi': { black: '红方', white: '绿方' },
    'simulated-makruk': { black: '红方', white: '黑方' },
    'simulated-shogi': { black: '红方', white: '黑方' },
    janggi: { black: '蓝方', white: '红方' },
    chess: { black: '白方', white: '黑方' }
};

function getChatSideLabel(room, slot) {
    if (!slot) return null;
    const gl = room && room.gameLogic;
    if (gl && typeof gl.getChatSideLabel === 'function') {
        try {
            const custom = gl.getChatSideLabel(slot);
            if (custom) return String(custom);
        } catch (_) { /* ignore */ }
    }
    const map = CHAT_SIDE_LABELS_BY_GAME[room && room.gameType] || null;
    if (map && map[slot]) return map[slot];
    if (slot === 'black') return '黑方';
    if (slot === 'white') return '白方';
    return String(slot);
}

function resolveChatSenderLabel(room, ws) {
    const gl = room && room.gameLogic;
    const matchStarted = !!(gl && (
        gl.matchStarted
        || (Array.isArray(gl.moveHistory) && gl.moveHistory.length > 0)
    ));
    const slot = room.getSlotByWs(ws) || null;
    if (matchStarted && slot) return getChatSideLabel(room, slot);
    if (slot) {
        const n = ws && ws._chatSeatNo ? ws._chatSeatNo : 1;
        return '入座者' + n;
    }
    const n = ws && ws._chatJoinNo ? ws._chatJoinNo : 1;
    return '观战者' + n;
}

class BaseGameRoom
{
    constructor(roomId, gameType, hasPassword, passwordHash, maxPlayers = 2) {
        this.roomId = roomId;
        this.gameType = gameType;
        this.hasPassword = hasPassword;
        this.passwordHash = passwordHash;
        this.chatLog = [];
        this.chatJoinCounter = 0;
        this.chatSeatCounter = 0;
        this.maxPlayers = maxPlayers;
        this.players = new Map();
        this.slotOccupancy = new Map();
        this.observers = new Set();
        this.gameLogic = null;
        this.destroyTimer = null;
    }

    /** 进房顺序编号，用于「观战者N」 */
    registerChatJoin(ws) {
        if (!ws || ws._chatJoinNo) return;
        this.chatJoinCounter += 1;
        ws._chatJoinNo = this.chatJoinCounter;
    }

    addObserver(ws) {
        this.observers.add(ws);
        this.players.delete(ws);
    }

    /** 入座（含从观战转为棋手时从 observers 中移除，避免重复登记） */
    setPlayerSlot(ws, slot) {
        this.observers.delete(ws);
        this.players.set(ws, slot);
        this.slotOccupancy.set(slot, ws);
        if (ws && !ws._chatSeatNo) {
            this.chatSeatCounter += 1;
            ws._chatSeatNo = this.chatSeatCounter;
        }
    }

    /** 将已入座玩家改到另一座位（先清旧位再占新位） */
    reassignPlayerSlot(ws, newSlot) {
        const old = this.players.get(ws);
        if (old) this.slotOccupancy.delete(old);
        this.setPlayerSlot(ws, newSlot);
    }

    /** 交换两个座位上的玩家（允许一侧为空） */
    swapSlots(slotA, slotB) {
        const a = this.slotOccupancy.get(slotA) || null;
        const b = this.slotOccupancy.get(slotB) || null;
        this.slotOccupancy.delete(slotA);
        this.slotOccupancy.delete(slotB);
        if (a) {
            this.players.set(a, slotB);
            this.slotOccupancy.set(slotB, a);
        }
        if (b) {
            this.players.set(b, slotA);
            this.slotOccupancy.set(slotA, b);
        }
    }

    removeClient(ws) {
        let releasedSlot = null;
        const slot = this.players.get(ws);
        if (slot) {
            this.slotOccupancy.delete(slot);
            this.players.delete(ws);
            releasedSlot = slot;
        } else {
            // 防御：连接异常断开时 players 与 slotOccupancy 不一致仍释放座位
            for (const [s, client] of this.slotOccupancy.entries()) {
                if (client === ws) {
                    this.slotOccupancy.delete(s);
                    this.players.delete(ws);
                    releasedSlot = s;
                    break;
                }
            }
        }
        if (releasedSlot !== null)
            this.broadcast({ type: 'slotReleased', slot: releasedSlot });

        if (this.observers.has(ws))
            this.observers.delete(ws);

        this.scheduleDestruction();
    }

    getPlayerBySlot(slot) {
        return this.slotOccupancy.get(slot);
    }

    getSlotByWs(ws) {
        return this.players.get(ws);
    }

    getPlayerCount() {
        return this.players.size;
    }

    broadcast(data, exclude = null) {
        const allClients = [...this.players.keys(), ...this.observers];
        for (const client of allClients) {
            if (client !== exclude && client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            }
        }
    }

    clearDestroyTimer() {
        if (this.destroyTimer) {
            clearTimeout(this.destroyTimer);
            this.destroyTimer = null;
        }
    }

    scheduleDestruction() {
        this.clearDestroyTimer();

        if (this.players.size === 0 && this.observers.size === 0) {
            let delay = 86400000; // 默认24小时
            try {
                let moveCount = 999;
                if (this.gameLogic && typeof this.gameLogic.getMoveCount === 'function')
                    moveCount = this.gameLogic.getMoveCount();
                if (moveCount < 10)
                    delay = 7200000; // 2小时
            }
            catch (error) { }

            this.destroyTimer = setTimeout(() => {
                if (this.players.size === 0 && this.observers.size === 0) {
                    delete rooms[this.gameType][this.roomId];
                    console.log(`房间 ${this.roomId} (${this.gameType}) 已销毁`);
                }
            }, delay);
        }
    }
}

Express.post('/qi/create', (request, response) => {
    try {
        const { game, password } = request.body;
        if (!game) return response.json({ success: false, error: '缺少游戏类型' });
        if (!/^[a-zA-Z0-9_-]+$/.test(game)) return response.json({ success: false, error: '无效的游戏类型' });

        if (!rooms[game]) rooms[game] = {};
        let roomId;
        let attempts = 0;
        do {
            roomId = Math.floor(1000 + Math.random() * 9000).toString();
            attempts++;
            if (attempts > 50) return response.json({ success: false, error: '房间创建失败，请稍后再试' });
        } while (rooms[game][roomId]);

        const hasPassword = !!password;
        const passwordHash = hasPassword ? crypto.createHash('sha256').update(password).digest('hex') : null;

        const room = new BaseGameRoom(roomId, game, hasPassword, passwordHash, 2);
        rooms[game][roomId] = room;

        const gameModulePath = findGameModulePath(game);
        if (!gameModulePath) {
            delete rooms[game][roomId];
            return response.json({ success: false, error: '游戏模块不存在' });
        }
        try {
            delete require.cache[require.resolve(gameModulePath)];
        }
        catch (error) {
        }

        try {
            const gameModule = require(gameModulePath);
            gameModule.initRoom(room);
        }
        catch (error) {
            console.error(`加载游戏模块 ${game} 失败:`, error);
            delete rooms[game][roomId];
            return response.json({ success: false, error: '游戏模块加载失败' });
        }

        response.json({ success: true, roomId });
    }
    catch (error) {
        console.error(error);
        response.status(400).json({ error: "Internal error." });
    }
});

Express.post('/qi/join', (request, response) => {
    try {
        const { game, roomId, password } = request.body;
        const room = rooms[game]?.[roomId];
        if (!room) return response.json({ success: false, error: '房间不存在' });
        if (room.hasPassword) {
            if (!password) return response.json({ success: false, error: '需要密码' });
            const hash = crypto.createHash('sha256').update(password).digest('hex');
            if (hash !== room.passwordHash) {
                return response.json({ success: false, error: '密码错误' });
            }
        }
        response.json({ success: true });
    }
    catch (error) {
        console.error(error);
        response.status(400).json({ error: "Internal error." });
    }
});

Express.get('/qi/rooms', (request, response) => {
    try {
        const { game } = request.query;
        if (!game || !rooms[game]) return response.json([]);
        const list = Object.values(rooms[game]).map(room => ({
            roomId: room.roomId,
            hasPassword: room.hasPassword,
            playerCount: room.getPlayerCount(),
            maxPlayers: room.maxPlayers
        }));
        response.json(list);
    }
    catch (error) {
        console.error(error);
        response.status(400).json({ error: "Internal error." });
    }
});

function sendPublicOrRoot(response, fileName) {
    const inPublic = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(inPublic)) return response.sendFile(inPublic);
    const inRoot = path.join(__dirname, fileName);
    if (fs.existsSync(inRoot)) return response.sendFile(inRoot);
    return response.status(404).send('Not found');
}

Express.get("/qi", (request, response) => sendPublicOrRoot(response, "qi.html"));
Express.get("/qi/qi.css", (request, response) => sendPublicOrRoot(response, "qi.css"));
Express.get("/qi/qi.js", (request, response) => sendPublicOrRoot(response, "qi.js"));
function sendCachedPublic(response, absPath, maxAgeSec) {
    response.setHeader('Cache-Control', 'public, max-age=' + maxAgeSec);
    return response.sendFile(absPath);
}

Express.get("/qi/room.css", (request, response) =>
    sendCachedPublic(response, path.join(__dirname, "public", "room.css"), 3600));
Express.get("/qi/room.js", (request, response) =>
    sendCachedPublic(response, path.join(__dirname, "public", "room.js"), 3600));
Express.get("/qi/chat-messages.csv", (request, response) => {
    chatMessages = loadChatMessages();
    if (!fs.existsSync(CHAT_MESSAGES_PATH)) {
        response.type('text/csv; charset=utf-8');
        return response.send('# id,content\n');
    }
    response.type('text/csv; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.sendFile(CHAT_MESSAGES_PATH);
});
Express.get("/qi/room-plugins/:plugin", (request, response) => {
    const plugin = request.params.plugin;
    if (!/^[a-zA-Z0-9_-]+-room\.js$/.test(plugin)) return response.status(400).send('Invalid plugin');
    const abs = path.join(__dirname, "public", "room-plugins", plugin);
    if (!fs.existsSync(abs)) return response.status(404).send('Plugin not found');
    return sendCachedPublic(response, abs, 3600);
});
function findXiangqiRulesPath() {
    const candidates = [
        path.join(__dirname, 'games', 'xiangqi-rules.js'),
        path.join(__dirname, '象棋', 'xiangqi-rules.js'),
        path.join(__dirname, 'public', 'xiangqi-rules.js')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

Express.get("/qi/xiangqi-rules.js", (request, response) => {
    const abs = findXiangqiRulesPath();
    if (!abs) return response.status(404).send('Not found');
    return response.sendFile(abs);
});
// 字体必须在 /qi/:game/:roomId 之前注册，否则 /qi/fonts/... 会被当成房间页返回 HTML
Express.use("/qi/fonts", express.static(path.join(__dirname, "public", "fonts"), {
    maxAge: "365d",
    immutable: true,
    fallthrough: false,
    setHeaders(res, filePath) {
        if (filePath.endsWith(".css")) res.type("text/css; charset=utf-8");
        else if (filePath.endsWith(".woff2")) res.type("font/woff2");
        else if (filePath.endsWith(".woff")) res.type("font/woff");
        else if (filePath.endsWith(".ttf")) res.type("font/ttf");
    }
}));
Express.get('/qi/:leaf', (request, response, next) => {
    const leaf = request.params.leaf;
    const m = typeof leaf === 'string' && leaf.match(/^([a-zA-Z0-9_-]+)-ai\.js$/);
    if (!m) return next();
    const gameId = m[1];
    const abs = findGameAiScriptPath(gameId);
    if (!abs) return response.status(404).type('text/plain').send('AI script not found');
    response.sendFile(abs);
});
Express.get("/qi/qrcode.min.js", (request, response) => sendPublicOrRoot(response, "qrcode.min.js"));

Express.get('/qi/:game/:roomId', (request, response) => {
    try {
        const game = request.params.game;
        if (game === 'fonts' || game === 'room-plugins') {
            return response.status(404).type('text/plain').send('Not found');
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(game)) return response.status(400).send('Invalid game');
        if (!findGameModulePath(game)) return response.status(404).send('Game not found');

        if (usesRoomShell(game)) {
            const roomHtml = path.join(__dirname, 'public', 'room.html');
            if (fs.existsSync(roomHtml)) return response.sendFile(roomHtml);
        }

        const htmlPublic = path.join(__dirname, 'public', `${game}.html`);
        if (fs.existsSync(htmlPublic)) return response.sendFile(htmlPublic);

        return response.status(404).send('Game not found');
    }
    catch (error) {
        console.error(error);
        response.status(400).json({ error: "Internal error." });
    }
});

const wss = new ws.Server({ noServer: true });
const Server_ = Express.listen(PORT, '127.0.0.1', () => { console.log(`棋类服务器运行在端口 ${PORT}`); });

Server_.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/qi/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } else
        socket.destroy();
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const game = url.searchParams.get('game');
    const roomId = url.searchParams.get('room');
    if (!game || !roomId) {
        ws.close(1008, '缺少游戏或房间参数');
        return;
    }
    const room = rooms[game]?.[roomId];
    if (!room) {
        ws.close(1008, '房间不存在');
        return;
    }
    ws.room = room;
    // 心跳：移动端息屏/断网时连接可能长期不触发 close，导致座位被僵死连接占用
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        }
        catch (e) {
            return;
        }

        if (msg.type === 'join') {
            if (room.hasPassword) {
                const hash = crypto.createHash('sha256').update(msg.password || '').digest('hex');
                if (hash !== room.passwordHash) {
                    ws.send(JSON.stringify({ type: 'error', message: '密码错误' }));
                    ws.close();
                    return;
                }
            }
            room.registerChatJoin(ws);
            let slot = null;
            if (room.gameLogic && room.gameLogic.assignSlot)
                slot = room.gameLogic.assignSlot(ws, msg.requestedSlot);
            if (slot) {
                room.setPlayerSlot(ws, slot);
                const joinState = room.gameLogic.getStateForClient
                    ? room.gameLogic.getStateForClient(ws)
                    : (room.gameLogic.getState ? room.gameLogic.getState() : {});
                ws.send(JSON.stringify({
                    type: 'joined',
                    role: 'player',
                    slot,
                    state: joinState
                }));
                room.broadcast({ type: 'slotOccupied', slot }, ws);
            } else {
                room.addObserver(ws);
                const obsState = room.gameLogic.getStateForClient
                    ? room.gameLogic.getStateForClient(ws)
                    : (room.gameLogic.getState ? room.gameLogic.getState() : {});
                ws.send(JSON.stringify({
                    type: 'joined',
                    role: 'observer',
                    state: obsState
                }));
            }
            // 房间有人了，取消销毁定时器
            room.clearDestroyTimer();

            const playerList = Array.from(room.players.entries()).map(([_, slot]) => slot);
            room.broadcast({ type: 'playerList', players: playerList }, ws);
            if (Array.isArray(room.chatLog) && room.chatLog.length) {
                ws.send(JSON.stringify({ type: 'chatHistory', messages: room.chatLog }));
            }
        }
        else if (msg.type === 'chat') {
            chatMessages = loadChatMessages();
            const messageId = msg.messageId != null ? String(msg.messageId).trim() : '';
            const content = messageId ? chatMessages.get(messageId) : null;
            if (!messageId || content == null) {
                try {
                    ws.send(JSON.stringify({ type: 'chatError', message: '无效的聊天消息' }));
                } catch (_) { /* ignore */ }
                return;
            }
            const now = Date.now();
            if (!ws._chatSendTimes) ws._chatSendTimes = [];
            ws._chatSendTimes = ws._chatSendTimes.filter((t) => now - t < 10000);
            if (ws._chatSendTimes.length >= 3) {
                try {
                    ws.send(JSON.stringify({ type: 'chatError', message: '发送过于频繁，请稍后再试' }));
                } catch (_) { /* ignore */ }
                return;
            }
            ws._chatSendTimes.push(now);
            if (!ws._chatJoinNo) room.registerChatJoin(ws);
            const slot = room.getSlotByWs(ws) || null;
            const senderLabel = resolveChatSenderLabel(room, ws);
            const entry = {
                messageId,
                content,
                slot,
                senderLabel,
                at: now
            };
            if (!Array.isArray(room.chatLog)) room.chatLog = [];
            room.chatLog.push(entry);
            if (room.chatLog.length > CHAT_LOG_LIMIT) {
                room.chatLog.splice(0, room.chatLog.length - CHAT_LOG_LIMIT);
            }
            room.broadcast({ type: 'chat', ...entry });
        }
        else {
            if (room.gameLogic && room.gameLogic.handleMessage)
                room.gameLogic.handleMessage(ws, msg);
        }
    });

    ws.on('close', () => {
        try {
            const room = ws.room;
            if (room) {
                if (room.gameLogic && room.gameLogic.onPlayerLeave)
                    room.gameLogic.onPlayerLeave(ws);
                room.removeClient(ws);
            }
        }
        catch (error) {
            console.error(error);
        }
    });
});

const HEARTBEAT_MS = 30000;
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState !== 1) return;
        if (client.isAlive === false) {
            try { client.terminate(); } catch (e) {}
            return;
        }
        client.isAlive = false;
        try {
            client.ping();
        } catch (e) {
            try { client.terminate(); } catch (e2) {}
        }
    });
}, HEARTBEAT_MS);