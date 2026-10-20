// 在加载账号模块前读取项目目录的配置；不依赖 PM2 的当前工作目录。
const envConfig = require('dotenv').config({
    path: require('path').join(__dirname, '.env'),
    quiet: true
});
if (envConfig.error && envConfig.error.code !== 'ENOENT') throw envConfig.error;

const crypto = require('crypto');
const express = require('express');
const express_rate_limit = require("express-rate-limit");
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const ws = require('ws');
const { isKatagoAvailable } = require('./katago-gtp');
const { attachToRoom: attachKatagoOpponent } = require('./qi-katago-opponent');
const { disposeRoom: disposeKatagoOpponent } = require('./qi-katago-opponent');
const gameCatalog = require('./public/game-catalog');
const localPlay = require('./qi-local-play');
const recordTree = require('./qi-record-tree');
const accounts = require('./qi-accounts');
const matchRecords = require('./qi-match-records');

const Express = express();
Express.set("trust proxy", "127.0.0.1");
const PORT = 3100;
const PUBLIC_ROOT = path.resolve(__dirname, 'public');

Express.use('/qi/auth', express.json({ limit: '8kb' }));
Express.use(express.json());
const ExpressRateLimit = express_rate_limit({
    windowMs: 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false
});
Express.use(ExpressRateLimit);
accounts.mount(Express);

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

/** 房间逻辑：games/{id}.js（部署约定） */
function findGameModulePath(gameId) {
    const flat = path.join(__dirname, 'games', `${gameId}.js`);
    return fs.existsSync(flat) ? flat : null;
}

/**
 * 正式开局后聊天里显示的执方名。
 * 约定：black 座位 = 黑方、white 座位 = 白方（谁先走由各棋种自己决定，与座位名无关），
 * 所以默认直接按座位名给出中文，新增棋种无需在这里登记。
 * 执方名不是黑/白的棋种（如象棋的红/黑、将棋的红/黑、韩国将棋的蓝/红），
 * 在自己的 games/{id}.js 里实现 getChatSideLabel(slot) 即可，同样不用改本文件。
 */
function getChatSideLabel(room, slot) {
    if (!slot) return null;
    const gl = room && room.gameLogic;
    if (gl && typeof gl.getChatSideLabel === 'function') {
        try {
            const custom = gl.getChatSideLabel(slot);
            if (custom) return String(custom);
        } catch (_) { /* ignore */ }
    }
    if (slot === 'player1') return '黑方';
    if (slot === 'player2') return '白方';
    return String(slot);
}

function resolveChatSenderLabel(room, ws) {
    if (ws.auth && ws.auth.user) return ws.auth.user.username;
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

/** 从房间卸下连接（leave 消息与 close 共用，可幂等） */
function detachClientFromRoom(ws) {
    if (!ws || ws._qiDetached) return;
    ws._qiDetached = true;
    const room = ws.room;
    if (!room) return;
    if (ws._qiLocalPlay) {
        ws._qiLocalPlay.disconnect(ws);
        return;
    }
    try {
        if (room.gameLogic && typeof room.gameLogic.onPlayerLeave === 'function') {
            room.gameLogic.onPlayerLeave(ws);
        }
    } catch (error) {
        console.error(error);
    }
    try {
        room.removeClient(ws);
        room.syncSoloSeatState();
    } catch (error) {
        console.error(error);
    }
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

    /**
     * 清理已断开但仍挂在 players/observers/slotOccupancy 上的僵死连接。
     * 移动端息屏/切页时 close 可能滞后，导致大厅人数与座位不准。
     */
    purgeDeadClients() {
        const WS_OPEN = 1;
        const dead = new Set();
        if (this.localPlay && this.localPlay.client && this.localPlay.client.readyState !== WS_OPEN)
            dead.add(this.localPlay.client);
        for (const client of this.players.keys()) {
            if (!client || client.readyState !== WS_OPEN) dead.add(client);
        }
        for (const client of this.observers) {
            if (!client || client.readyState !== WS_OPEN) dead.add(client);
        }
        for (const [slot, client] of this.slotOccupancy.entries()) {
            if (!client || client.readyState !== WS_OPEN) dead.add(client);
        }
        for (const client of dead) {
            detachClientFromRoom(client);
        }
    }

    getPlayerBySlot(slot) {
        return this.slotOccupancy.get(slot);
    }

    getSlotByWs(ws) {
        if (ws && this.localPlay && this.localPlay.client === ws) return this.localPlay.turnSlot();
        return this.players.get(ws);
    }

    getPlayerCount() {
        this.purgeDeadClients();
        return this.getHumanCount();
    }

    getHumanCount() {
        if (this.localPlay) return this.localPlay.client && this.localPlay.client.readyState === 1 ? 1 : 0;
        return [...this.players.keys()].filter((client) => client && client.readyState === 1 && !client.localPlay).length;
    }

    getSoloMode() {
        return this.localPlay ? 'local' : this.gameLogic && this.gameLogic.computerSlot ? 'computer' : null;
    }

    getSeatCapacity() {
        return this.getSoloMode() ? 1 : this.maxPlayers;
    }

    soloSeatState() {
        return { soloMode: this.getSoloMode(), soloOccupied: this.getHumanCount() > 0, seatCapacity: this.getSeatCapacity() };
    }

    syncSoloSeatState() {
        const state = this.soloSeatState();
        const signature = JSON.stringify(state);
        if (signature === this._lastSoloSeatState) return;
        this._lastSoloSeatState = signature;
        this.broadcast({ type: 'soloSeatState', ...state });
    }

    broadcast(data, exclude = null) {
        if (this.retired) return;
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

    getSeatedCount() {
        if (this.getSoloMode()) return this.getHumanCount();
        const logic = this.gameLogic;
        // DFW 的座位由棋种自己管理，其连接都登记为 observer。
        if (logic && Array.isArray(logic.seats)) return logic.seats.filter(Boolean).length;
        return this.getHumanCount();
    }

    switchState() {
        return { type: 'roomSwitchState', canSwitch: this.getSeatedCount() < 2 };
    }

    syncSwitchState() {
        const state = this.switchState();
        if (state.canSwitch === this._lastCanSwitch) return;
        this._lastCanSwitch = state.canSwitch;
        this.broadcast(state);
        this.syncSoloSeatState();
    }

    scheduleDestruction() {
        this.clearDestroyTimer();
        const empty = () => this.observers.size === 0 && this.getHumanCount() === 0;
        if (empty()) {
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
                if (empty()) {
                    disposeRoom(this);
                    delete rooms[this.gameType][this.roomId];
                    console.log(`房间 ${this.roomId} (${this.gameType}) 已销毁`);
                }
            }, delay);
        }
    }
}

/** 房间号是否已被占用（跨棋种唯一：房间短链 /rooms/<房间号> 要能反查出棋种，见下方 findGameIdByRoomId） */
function isRoomIdTaken(roomId) {
    for (const game of Object.keys(rooms)) {
        if (rooms[game] && rooms[game][roomId]) return true;
    }
    return false;
}

/** 由房间号反查棋种（房间号全局唯一） */
function findGameIdByRoomId(roomId) {
    for (const game of Object.keys(rooms)) {
        if (rooms[game] && rooms[game][roomId]) return game;
    }
    return null;
}

function initGameLogic(room) {
    const gameModulePath = findGameModulePath(room.gameType);
    if (!gameModulePath) throw new Error('游戏模块不存在');
    const gamesDir = path.dirname(gameModulePath) + path.sep;
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(gamesDir)) delete require.cache[key];
    }
    require(gameModulePath).initRoom(room);
    try { attachKatagoOpponent(room); } catch (e) { console.error('挂载 KataGo 人机失败', e); }
    localPlay.install(room);
    installRecordTree(room);
    matchRecords.install(room);
}

function installRecordTree(room) {
    recordTree.install(room, (source) => {
        const scratch = new BaseGameRoom('', source.gameType, false, null);
        require(findGameModulePath(source.gameType)).initRoom(scratch);
        return scratch;
    }, disposeRoom);
}

function disposeRoom(room) {
    matchRecords.close(room);
    if (room.localPlay) room.localPlay.stop();
    room.clearDestroyTimer();
    try { disposeKatagoOpponent(room); } catch (e) { console.error(e); }
    const logic = room.gameLogic;
    if (!logic) return;
    for (const method of ['dispose', '_releaseAiEngine']) {
        if (typeof logic[method] === 'function') {
            try { logic[method](); } catch (e) { console.error(e); }
        }
    }
    for (const name of ['_clockInterval', '_timer', 'countdownTimer', 'aiTimer']) {
        if (logic[name]) {
            clearTimeout(logic[name]);
            clearInterval(logic[name]);
            logic[name] = null;
        }
    }
}

function switchRoomGame(room, client, game) {
    const reject = (message) => client.send(JSON.stringify({ type: 'switchGameError', message }));
    if (!room.players.has(client) && !room.observers.has(client)
        && !(room.localPlay && client._qiLocalPlay === room.localPlay)) return reject('请先加入房间。');
    room.purgeDeadClients();
    if (room.getSeatedCount() >= 2) return reject('已有多人落座，不能切换棋类。');
    if (typeof game !== 'string' || !gameCatalog.games.some((g) => g.id === game && g.enabled)) {
        return reject('该棋类未开放。');
    }
    if (game === room.gameType) return reject('已经是该棋类。');
    // 先初始化新逻辑，失败时保留原房间及棋盘。
    const next = new BaseGameRoom(room.roomId, game, room.hasPassword, room.passwordHash);
    try { initGameLogic(next); }
    catch (e) {
        disposeRoom(next);
        console.error('切换棋类失败', e);
        return reject('棋类加载失败，请稍后重试。');
    }
    next.chatLog = room.chatLog;
    next.chatJoinCounter = room.chatJoinCounter;
    next.chatSeatCounter = room.chatSeatCounter;
    if (!rooms[game]) rooms[game] = {};
    rooms[game][room.roomId] = next;
    delete rooms[room.gameType][room.roomId];
    room.retired = true;
    disposeRoom(room);
    // 包括已建立连接但 join 尚未到达的页面，防止其继续使用旧棋类。
    for (const wsClient of wss.clients) {
        if (wsClient.room !== room) continue;
        wsClient._qiDetached = true;
        if (wsClient.readyState === ws.OPEN) {
            wsClient.send(JSON.stringify({ type: 'roomGameChanged', gameType: game }));
            wsClient.close(1000, '棋类已切换');
        }
    }
    room.players.clear();
    room.observers.clear();
    room.slotOccupancy.clear();
    next.scheduleDestruction();
    console.log('[rooms] ' + JSON.stringify({ event: 'switched', at: new Date().toISOString(),
        roomId: room.roomId, from: room.gameType, game }));
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
        } while (isRoomIdTaken(roomId));

        const hasPassword = !!password;
        const passwordHash = hasPassword ? crypto.createHash('sha256').update(password).digest('hex') : null;

        const room = new BaseGameRoom(roomId, game, hasPassword, passwordHash, 2);
        rooms[game][roomId] = room;

        const gameModulePath = findGameModulePath(game);
        if (!gameModulePath) {
            delete rooms[game][roomId];
            return response.json({ success: false, error: '游戏模块不存在' });
        }
        // 每次创建房间都重新 require：文件更新立即生效（不做 mtime 缓存）。
        // 连 games/ 下的依赖一起失效：棋种模块会在顶层 require 兄弟模块（如 './xiangqi-rules'、
        // './weiqi'），只删棋种自己那一份会拿到 require 缓存里的旧模块 —— 典型症状是上传了新文件
        // 但没重启服务端时，游戏中途报 `R.applyMagnetism is not a function`。
        // （common.js 在仓库根目录，仍按老规矩：改了它必须重启。）
        try {
            const gamesDir = path.dirname(gameModulePath) + path.sep;
            for (const key of Object.keys(require.cache)) {
                if (key.startsWith(gamesDir)) delete require.cache[key];
            }
        }
        catch (error) { /* ignore */ }

        try {
            const gameModule = require(gameModulePath);
            gameModule.initRoom(room);
            // 公共人机：有 katagos/{gameId}/{katago,model.bin.gz,gtp.cfg} 则挂载
            try { attachKatagoOpponent(room); } catch (e) { console.error('挂载 KataGo 人机失败', e); }
            localPlay.install(room);
            installRecordTree(room);
            matchRecords.install(room);
        }
        catch (error) {
            console.error(`加载游戏模块 ${game} 失败:`, error);
            delete rooms[game][roomId];
            return response.json({ success: false, error: '游戏模块加载失败' });
        }

        // 创建后页面可能关闭、跳转失败，甚至根本未建立 WebSocket，也必须回收空房。
        room.scheduleDestruction();
        console.log('[rooms] ' + JSON.stringify({ event: 'created', at: new Date().toISOString(), roomId, game,
            source: ['lobby', 'record-import', 'qr-code'].includes(request.body.source) ? request.body.source : 'api',
            ip: request.ip, userAgent: String(request.get('user-agent') || '').slice(0, 256) }));
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
        response.setHeader('Cache-Control', 'no-store');
        const describeRoom = room => ({
            roomId: room.roomId,
            hasPassword: room.hasPassword,
            playerCount: room.getPlayerCount(),
            maxPlayers: room.getSeatCapacity()
        });
        // 大厅一次获取全部房间；保留按棋类查询的接口供其它客户端使用。
        if (game === undefined) {
            const list = Object.entries(rooms).flatMap(([gameId, gameRooms]) =>
                Object.values(gameRooms).map(room => ({ ...describeRoom(room), gameId })));
            return response.json(list);
        }
        if (typeof game !== 'string' || !Object.hasOwn(rooms, game)) return response.json([]);
        const list = Object.values(rooms[game]).map(describeRoom);
        response.json(list);
    }
    catch (error) {
        console.error(error);
        response.status(400).json({ error: "Internal error." });
    }
});

/** 仅允许发送 public/ 内文件（realpath 校验，禁止穿越到 katagos 等目录） */
function resolveUnderPublic(relPath) {
    if (typeof relPath !== 'string' || !relPath) return null;
    if (path.isAbsolute(relPath)) return null;
    if (relPath.includes('\0')) return null;
    const abs = path.resolve(PUBLIC_ROOT, relPath);
    if (abs !== PUBLIC_ROOT && !abs.startsWith(PUBLIC_ROOT + path.sep)) return null;
    try {
        if (!fs.existsSync(abs)) return null;
        const real = fs.realpathSync(abs);
        if (real !== PUBLIC_ROOT && !real.startsWith(PUBLIC_ROOT + path.sep)) return null;
        return real;
    } catch (_) {
        return null;
    }
}

/** 已压缩格式（woff2/woff/ttf/图片等）不再二次 gzip */
const GZIP_SKIP_EXT = new Set(['.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg']);

const GZIP_MIME = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

/** 压缩结果不缓存：每次请求现读现压，保证文件更新后立即生效（gzipSync 仅几十毫秒，可接受） */
function getGzipped(realPath) {
    return zlib.gzipSync(fs.readFileSync(realPath));
}

/** public/ 下文件 gzip 发送（relPath 仍走 resolveUnderPublic 白名单校验；HTML 也压缩，不影响"每次拿最新"） */
function sendPublicFile(response, relPath) {
    const abs = resolveUnderPublic(relPath);
    if (!abs) return response.status(404).send('Not found');
    const ext = path.extname(abs).toLowerCase();
    // 必须显式禁缓存：不写 Cache-Control 时浏览器会「启发式缓存」（按 Last-Modified 估一个新鲜期），
    // 改了 room.js/规则脚本后老页面会继续用旧文件 → 出现「点了没反应」这类怪象。no-cache = 仍可存但每次要回源校验。
    response.setHeader('Cache-Control', 'no-cache');
    if (GZIP_SKIP_EXT.has(ext)) return response.sendFile(abs);
    let buf;
    try {
        buf = getGzipped(abs);
    } catch (_) {
        return response.status(404).send('Not found');
    }
    response.setHeader('Content-Type', GZIP_MIME[ext] || 'application/octet-stream');
    response.setHeader('Content-Encoding', 'gzip');
    return response.send(buf);
}

/** 发 HTML 并在 <head> 后注入一小段 <script>（房间短链 /rooms/<房间号> 用它告诉页面自己属于哪个棋种）。
 *  注入了内容就没法复用「按路径压缩」，这里每次现压 —— 只有进房那一次请求，几十 KB 可接受。 */
function sendPublicHtmlInjected(response, relPath, injectHtml) {
    const abs = resolveUnderPublic(relPath);
    if (!abs) return response.status(404).send('Not found');
    let html;
    try {
        html = fs.readFileSync(abs, 'utf8');
    } catch (_) {
        return response.status(404).send('Not found');
    }
    const headOpen = html.search(/<head[^>]*>/i);
    if (headOpen >= 0) {
        const close = html.indexOf('>', headOpen) + 1;   // 注入点在所有 <script> 之前，页面脚本能直接读到
        html = html.slice(0, close) + injectHtml + html.slice(close);
    } else {
        html = injectHtml + html;
    }
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Encoding', 'gzip');
    return response.send(zlib.gzipSync(Buffer.from(html, 'utf8')));
}

/** 静态文件发送：显式 Cache-Control: no-cache（可缓存但每次回源校验），保证更新立即生效。
 *  不写这个头时浏览器会启发式缓存，插件/规则改了老页面仍用旧的。
 * 仅保留 gzip 压缩减少 1Mbps 带宽下的传输量；每次请求现读现压。 */
function sendCachedPublic(response, absPath) {
    let real;
    try {
        real = fs.realpathSync(absPath);
    } catch (_) {
        return response.status(404).send('Not found');
    }
    if (real !== PUBLIC_ROOT && !real.startsWith(PUBLIC_ROOT + path.sep)) {
        return response.status(404).send('Not found');
    }
    const ext = path.extname(real).toLowerCase();
    response.setHeader('Cache-Control', 'no-cache');
    if (GZIP_SKIP_EXT.has(ext)) {
        return response.sendFile(real);
    }
    let buf;
    try {
        buf = getGzipped(real);
    } catch (_) {
        return response.status(404).send('Not found');
    }
    response.setHeader('Content-Type', GZIP_MIME[ext] || 'application/octet-stream');
    response.setHeader('Content-Encoding', 'gzip');
    return response.send(buf);
}

/** 仅返回是否可用，不暴露 katagos 路径或文件内容 */
Express.get('/qi/katago-available', (request, response) => {
    try {
        const game = request.query.game;
        if (!game || !/^[a-zA-Z0-9_-]+$/.test(String(game))) {
            return response.json({ available: false });
        }
        return response.json({ available: isKatagoAvailable(String(game)) });
    } catch (error) {
        console.error(error);
        return response.json({ available: false });
    }
});

Express.get("/qi", (request, response) => sendPublicFile(response, "qi.html"));
// public/assets/ 中的正式图片通过 /qi/assets/ 访问；替换后每次回源校验。
Express.use('/qi/assets', express.static(path.join(PUBLIC_ROOT, 'assets'), {
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders(response) { response.setHeader('Cache-Control', 'no-cache'); }
}));
Express.get("/qi/qi.css", (request, response) => sendPublicFile(response, "qi.css"));
Express.get("/qi/qi.js", (request, response) => sendPublicFile(response, "qi.js"));
Express.get('/qi/game-catalog.js', (request, response) => sendPublicFile(response, 'game-catalog.js'));
Express.get('/qi/login', (request, response) => {
    response.set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://cdn.jsdmirror.com; font-src 'self' https://cdn.jsdmirror.com data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin'
    });
    sendPublicFile(response, 'login.html');
});
Express.get('/qi/auth-client.js', (request, response) => sendPublicFile(response, 'auth-client.js'));
Express.get('/qi/auth-client.css', (request, response) => sendPublicFile(response, 'auth-client.css'));
Express.get('/qi/room-share.js', (request, response) => sendPublicFile(response, 'room-share.js'));
Express.get('/qi/login.js', (request, response) => sendPublicFile(response, 'login.js'));
Express.get('/qi/login.css', (request, response) => sendPublicFile(response, 'login.css'));
Express.get('/qi/tsumego', (request, response) => sendPublicFile(response, 'tsumego-host.html'));
Express.get('/qi/tsumego-host.js', (request, response) => sendPublicFile(response, 'tsumego-host.js'));
Express.get('/qi/tsumego-host.css', (request, response) => sendPublicFile(response, 'tsumego-host.css'));
Express.get('/qi/tsumego-view', (request, response) => {
    const games = gameCatalog.games.filter((g) => g.enabled && g.category !== '其它').map((g) => g.id);
    const game = games.includes(request.query.game) ? request.query.game : 'weiqi';
    const injection = '<script>window.__qiTsumego=true;window.__qiTsumegoGameIds=' + JSON.stringify(games) + ';window.__qiRoomRoute=' + JSON.stringify({ gameType: game, roomId: '' }) +
        ';</script><link rel="stylesheet" href="/qi/tsumego.css"><script src="/qi/tsumego-rules/' + game +
        '.js"></script><script src="/qi/tsumego.js"></script>';
    return sendPublicHtmlInjected(response, 'room.html', injection);
});
Express.get('/qi/tsumego-files', (request, response) => {
    const dir = resolveUnderPublic('tsumego');
    const files = dir ? fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && /\.json$/i.test(f.name))
        .map((f) => f.name).sort((a, b) => a.localeCompare(b, 'zh-Hans', { numeric: true })) : [];
    response.setHeader('Cache-Control', 'no-cache');
    response.json(files);
});
Express.get('/qi/tsumego/:file', (request, response) => {
    const name = request.params.file;
    if (!/^[^/\\]+\.json$/i.test(name)) return response.status(404).send('Not found');
    return sendPublicFile(response, 'tsumego/' + name);
});
Express.get('/qi/tsumego-rules/:file', (request, response) => {
    const game = request.params.file.replace(/\.js$/, '');
    try {
        const script = require('./qi-tsumego-bundle').bundle(game);
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        response.setHeader('Content-Encoding', 'gzip');
        response.send(zlib.gzipSync(script));
    } catch (_) { response.status(404).send('Not found'); }
});
Express.get('/qi/tsumego.js', (request, response) => sendPublicFile(response, 'tsumego.js'));
Express.get('/qi/tsumego.css', (request, response) => sendPublicFile(response, 'tsumego.css'));
Express.get('/qi/room-game-switcher.js', (request, response) => sendPublicFile(response, 'room-game-switcher.js'));
Express.get('/qi/record-tree.js', (request, response) => sendPublicFile(response, 'record-tree.js'));
Express.get('/qi/room-record-tree.js', (request, response) => sendPublicFile(response, 'room-record-tree.js'));

Express.get("/qi/room.css", (request, response) =>
    sendCachedPublic(response, path.join(PUBLIC_ROOT, "room.css")));
Express.get("/qi/room.js", (request, response) =>
    sendCachedPublic(response, path.join(PUBLIC_ROOT, "room.js")));

Express.get("/qi/sgf.js", (request, response) =>
    sendCachedPublic(response, path.join(PUBLIC_ROOT, "sgf.js")));
Express.get("/qi/chat-messages.csv", (request, response) => {
    chatMessages = loadChatMessages();
    response.type('text/csv; charset=utf-8');
    if (!fs.existsSync(CHAT_MESSAGES_PATH)) {
        return response.send('# id,content\n');
    }
    // 聊天文案白名单：只回内存解析结果，不把任意路径文件交给客户端
    let body = '# id,content\n';
    try {
        body = fs.readFileSync(CHAT_MESSAGES_PATH, 'utf8');
    } catch (_) { /* keep header */ }
    return response.send(body);
});
Express.get("/qi/room-plugins/:plugin", (request, response) => {
    const plugin = request.params.plugin;
    if (!/^[a-zA-Z0-9_-]+-room\.js$/.test(plugin)) return response.status(400).send('Invalid plugin');
    return sendCachedPublic(response, path.join(PUBLIC_ROOT, "room-plugins", plugin));
});
// 第三方库（three.js 等）——必须在 /qi/:game/:roomId 之前注册
Express.get("/qi/vendor/:file", (request, response) => {
    const f = request.params.file;
    if (!/^[a-zA-Z0-9._-]+$/.test(f)) return response.status(400).send('Invalid');
    return sendCachedPublic(response, path.join(PUBLIC_ROOT, "vendor", f));
});
Express.get("/qi/xiangqi-rules.js", (request, response) =>
    sendCachedPublic(response, path.join(PUBLIC_ROOT, 'xiangqi-rules.js')));
// 字体必须在 /qi/:game/:roomId 之前注册，否则 /qi/fonts/... 会被当成房间页返回 HTML
Express.use("/qi/fonts", express.static(path.join(PUBLIC_ROOT, "fonts"), {
    fallthrough: false,
    setHeaders(res, filePath) {
        if (filePath.endsWith(".css")) res.type("text/css; charset=utf-8");
        else if (filePath.endsWith(".woff2")) res.type("font/woff2");
        else if (filePath.endsWith(".woff")) res.type("font/woff");
        else if (filePath.endsWith(".ttf")) res.type("font/ttf");
    }
}));
Express.get("/qi/qrcode.min.js", (request, response) => sendPublicFile(response, "qrcode.min.js"));

/**
 * 房间页：地址里只有房间号，棋种由服务端反查内存里的房间表后注入页面（见 findGameIdByRoomId）。
 * 两个域名各用一种前缀，同一个处理函数：
 *   https://variantqi.com/rooms/<房间号>
 *   https://maoshazhihe.com/qi/rooms/<房间号>
 * 旧格式 /qi/<棋种>/<房间号> 已不再支持（用户要求）。
 */
function serveRoomPage(request, response) {
    const roomId = String(request.params.roomId);
    if (!/^\d+$/.test(roomId)) return response.status(400).type('text/plain').send('Invalid room');
    const game = findGameIdByRoomId(roomId);
    // 房间不存在/已销毁：照样发房间页（注入 gameType:null），让页面弹自己的「无效的房间链接。」提示
    const page = (game && !usesRoomShell(game)) ? `${game}.html` : 'room.html';
    return sendPublicHtmlInjected(response, page,
        `<script>window.__qiRoomRoute=${JSON.stringify({ gameType: game || null, roomId })};</script>`);
}

Express.get('/rooms/:roomId', serveRoomPage);
Express.get('/qi/rooms/:roomId', serveRoomPage);

const wss = new ws.Server({ noServer: true, maxPayload: 1024 * 1024 });
const Server_ = Express.listen(PORT, '127.0.0.1', () => { console.log(`棋类服务器运行在端口 ${PORT}`); });

Server_.on('upgrade', async (req, socket, head) => {
    try {
        if (!accounts.originAllowed(req)) { socket.destroy(); return; }
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/qi/ws') { socket.destroy(); return; }
        req.qiAuth = await accounts.session(req);
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } catch (_) { socket.destroy(); }
});

wss.on('connection', (ws, req) => {
    if (req.qiAuth && !accounts.bindSocket(ws, req.qiAuth)) return;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const game = url.searchParams.get('game');
    const roomId = url.searchParams.get('room');
    if (!game || !roomId) {
        ws.close(1008, '缺少游戏或房间参数');
        return;
    }
    const room = rooms[game]?.[roomId];
    if (!room) {
        const currentGame = findGameIdByRoomId(roomId);
        if (currentGame) ws.send(JSON.stringify({ type: 'roomGameChanged', gameType: currentGame }));
        ws.close(1008, '房间不存在');
        return;
    }
    ws.room = room;
    // 心跳：移动端息屏/断网时连接可能长期不触发 close，导致座位被僵死连接占用
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});

    ws.on('message', async (data) => {
        if (ws.auth && Date.now() >= ws.auth.expiresAt) { ws.close(1008, '登入已过期'); return; }
        if (room.retired || ws._qiDetached) return;
        let msg;
        try {
            msg = JSON.parse(data);
        }
        catch (e) {
            return;
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
        if (msg.type !== 'join' && !room.players.has(ws) && !room.observers.has(ws) && !ws._qiLocalPlay) return;
        try {

        if (msg.type === 'authenticate') {
            const auth = await accounts.socketTicket(msg.ticket);
            if (!auth || ws.readyState !== 1 || ws._qiDetached || room.retired) {
                if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'accountAuthenticated', success: false }));
                return;
            }
            if (!accounts.bindSocket(ws, auth)) return;
            matchRecords.refreshIdentity(room, ws);
            room.broadcast({ type: 'playerIdentities', playerIdentities: matchRecords.identities(room) });
            ws.send(JSON.stringify({ type: 'accountAuthenticated', success: true }));
            return;
        }
        if (msg.type === 'switchGame') {
            switchRoomGame(room, ws, msg.game);
            return;
        }
        if (msg.type === 'startLocalGame') {
            localPlay.start(room, ws);
            return;
        }
        if (msg.type === 'continueSoloGame') {
            localPlay.resume(room, ws);
            return;
        }
        if (room.getSoloMode() && ['takeSeat', 'selectColor'].includes(msg.type)) return;
        if (room.getSoloMode() && msg.type === 'requestNewGame') {
            if (!room.observers.has(ws) && !room.getSlotByWs(ws)) return;
            room.purgeDeadClients();
            if (!room.getSlotByWs(ws) && room.getHumanCount()) return;
            const reset = room.gameLogic.resetGame || room.gameLogic.resetToEmpty;
            if (typeof reset !== 'function') return;
            reset.call(room.gameLogic);
            if (!room.gameLogic.resetGame) room.broadcast({ type: 'roomReset', ...room.gameLogic.getState() });
            room.syncSwitchState();
            room.syncSoloSeatState();
            return;
        }
        if (room.getSoloMode() && msg.type === 'leaveSeat' && room.getSlotByWs(ws)) {
            if (room.localPlay) room.localPlay.disconnect(ws);
            else {
                if (room.gameLogic.onPlayerLeave) room.gameLogic.onPlayerLeave(ws);
                room.removeClient(ws);
            }
            room.addObserver(ws);
            ws.send(JSON.stringify({ type: 'seatLeft', ...room.gameLogic.getState(), localPlay: false }));
            room.syncSoloSeatState();
            room.syncSwitchState();
            return;
        }
        if (['selectRecordVariation', 'beginRecordVariations', 'addRecordVariation', 'deleteRecordVariation', 'setMainRecordVariation', 'setSideRecordVariation'].includes(msg.type)) {
            const handlers = { selectRecordVariation: 'selectRecordVariation',
                beginRecordVariations: 'beginRecordVariations', addRecordVariation: 'addRecordVariation',
                deleteRecordVariation: 'deleteRecordVariation', setMainRecordVariation: 'setMainRecordVariation', setSideRecordVariation: 'setSideRecordVariation' };
            if ((room.players.has(ws) || room.observers.has(ws)
                || room.localPlay && ws._qiLocalPlay === room.localPlay) && room[handlers[msg.type]])
                await room[handlers[msg.type]](ws, msg);
            return;
        }
        if (['setBoardSize', 'setSubGame', 'setLiberty', 'setMagnetism', 'setShape', 'setBoardLength', 'setRoadCount'].includes(msg.type)) {
            if (!room.players.has(ws) && !room.observers.has(ws)
                && !(room.localPlay && ws._qiLocalPlay === room.localPlay)) return;
            room.purgeDeadClients();
            if (room.getSeatedCount() >= 2) {
                ws.send(JSON.stringify({ type: 'error', message: '已有多人落座，不能切换子棋类或棋盘大小。' }));
                ws.send(JSON.stringify(room.switchState()));
                return;
            }
        }

        if (msg.type === 'join') {
            if (room.players.has(ws) || room.observers.has(ws) || ws._qiLocalPlay) return;
            room.purgeDeadClients();
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
            if (!room.getSoloMode() && room.gameLogic && room.gameLogic.assignSlot)
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
            ws.send(JSON.stringify(room.switchState()));

            if (room.sendRecordTree) room.sendRecordTree(ws);
            const playerList = Array.from(room.players.entries()).map(([_, slot]) => slot);
            room.broadcast({ type: 'playerList', players: playerList }, ws);
            if (Array.isArray(room.chatLog) && room.chatLog.length) {
                ws.send(JSON.stringify({ type: 'chatHistory', messages: room.chatLog }));
            }
        }
        else if (msg.type === 'leave') {
            detachClientFromRoom(ws);
            try { ws.close(); } catch (_) { /* ignore */ }
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
            if (ws._qiLocalPlay && ws._qiLocalPlay === room.localPlay)
                ws._qiLocalPlay.handleMessage(msg);
            else if (room.gameLogic && room.gameLogic.handleMessage)
                room.gameLogic.handleMessage(ws, msg);
        }
        room.syncSwitchState();
        room.syncSoloSeatState();
        } catch (error) { console.error('[room message]', error.message); }
        finally {
            try {
            matchRecords.inspect(room);
            const identities = matchRecords.identities(room);
            const signature = JSON.stringify(identities);
            if (signature !== room._identitySignature) {
                room._identitySignature = signature;
                room.broadcast({ type: 'playerIdentities', playerIdentities: identities });
            }
            if (msg.type === 'join' && ws.readyState === 1) ws.send(JSON.stringify({ type: 'playerIdentities', playerIdentities: identities }));
            } catch (error) { console.error('[room identity]', error.message); }
        }
    });

    ws.on('close', () => {
        try {
            detachClientFromRoom(ws);
            room.syncSwitchState();
        }
        catch (error) {
            console.error(error);
        }
    });
});

// 心跳：尽快发现僵死连接并释放座位（原 30s 过慢，离开后大厅仍显示 1/2）
const HEARTBEAT_MS = 10000;
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState !== 1) return;
        if (client.auth && Date.now() >= client.auth.expiresAt) { client.close(1008, '登入已过期'); return; }
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
