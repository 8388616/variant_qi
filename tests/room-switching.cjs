// node tests/room-switching.cjs [--browser]
// Browser checks use Edge by default; QI_TEST_BROWSER can select another Chromium executable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const WS = require('ws');
const puppeteer = process.argv.includes('--browser') ? require('puppeteer-core') : null;
const root = path.resolve(__dirname, '..');
const compiled = new Module(path.join(root, 'qi-server-check.js'), module);
compiled.filename = path.join(root, 'qi-server-check.js');
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8')
    .replace('const PORT = 3100;', 'const PORT = 0;')
    + '\nmodule.exports = { BaseGameRoom, rooms, initGameLogic, disposeRoom, Server_, wss };', compiled.filename);
const { BaseGameRoom, rooms, initGameLogic, disposeRoom, Server_, wss } = compiled.exports;
const catalog = require('../public/game-catalog');
const fakeClient = () => ({ readyState: 1, send() {} });
let browser;

async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    let setters = 0;
    for (const game of catalog.games.filter((g) => g.enabled)) {
        const room = new BaseGameRoom('test', game.id, false, null);
        initGameLogic(room);
        const logic = room.gameLogic;
        const client = fakeClient(), other = fakeClient();
        const methods = [];
        if (typeof logic.setBoardSize === 'function') methods.push(['setBoardSize', logic.boardLanes || logic.boardSize || logic.BOARD_SIZE]);
        if (typeof logic.setBoardLength === 'function') methods.push(['setBoardLength', logic.boardLength]);
        if (typeof logic.setLiberty === 'function') methods.push(['setLiberty', 'tri']);
        if (typeof logic.setMagnetism === 'function') methods.push(['setMagnetism', 'strong']);
        if (typeof logic.setShape === 'function') methods.push(['setShape', logic.shape === 'rhombus' ? 'triangle' : 'rhombus']);
        if (typeof logic.setSubGame === 'function') {
            const source = fs.readFileSync(path.join(root, 'games', game.id + '.js'), 'utf8');
            const array = source.match(/const (?:WEIGHT_)?SUB_GAMES = (\[[\s\S]*?\]);/);
            if (array) {
                const ids = Function('return ' + array[1])();
                methods.push(['setSubGame', ids.find((id) => id !== logic.subGameId)]);
            }
        }
        for (const [method, initialValue] of methods) {
            let value = initialValue;
            room.players.clear(); room.slotOccupancy.clear();
            room.setPlayerSlot(client, 'player1');
            const hadMoveHistory = Array.isArray(logic.moveHistory);
            if (hadMoveHistory) logic.moveHistory = ['player1'];
            logic.matchStarted = true;
            logic.gameOver = true;
            if (Array.isArray(logic.board) && Array.isArray(logic.board[0])) logic.board[0][0] = 1;
            let changed = false;
            const values = method === 'setBoardSize' || method === 'setBoardLength'
                ? [value + 2, value - 2, value + 1, value - 1, value] : [value];
            for (const candidate of values) {
                if (logic[method](candidate, client) === true) { changed = true; value = candidate; break; }
            }
            assert.equal(changed, true, game.id + '.' + method + ' accepts one seated player after moves');
            assert.equal(logic.matchStarted, false, game.id + '.' + method + ' clears active match');
            if (hadMoveHistory) assert.equal(logic.moveHistory.length, 0, game.id + '.' + method + ' clears previous moves');
            const state = logic.getState ? logic.getState() : null;
            if (state && state.initialBoard && Array.isArray(logic.board)) {
                assert.deepEqual(state.initialBoard, logic.board, game.id + '.' + method + ' updates the opening board');
            }
            room.players.clear(); room.slotOccupancy.clear();
            room.setPlayerSlot(client, 'player1'); room.setPlayerSlot(other, 'player2');
            const blockedValue = method === 'setShape' ? (value === 'triangle' ? 'rhombus' : 'triangle') : value;
            assert.equal(logic[method](blockedValue, client), false, game.id + '.' + method + ' refuses two seated players');
            setters++;
        }
        if (game.id === 'nogrid-weiqi') {
            room.players.clear(); room.slotOccupancy.clear();
            room.setPlayerSlot(client, 'player1');
            logic.matchStarted = true;
            logic.handleMessage(client, { type: 'setRoadCount', size: 13 });
            assert.equal(logic.roadCount, 13);
            assert.equal(logic.matchStarted, false);
            room.setPlayerSlot(other, 'player2');
            logic.handleMessage(client, { type: 'setRoadCount', size: 15 });
            assert.equal(logic.roadCount, 13);
            setters++;
        }
        if (game.id === 'dfw') {
            assert.equal(room.getSeatedCount(), 0);
            logic.seats[0] = client;
            assert.equal(room.switchState().canSwitch, true);
            logic.seats[1] = other;
            assert.equal(room.switchState().canSwitch, false);
        }
        disposeRoom(room);
        room.clearDestroyTimer();
    }
    console.log('Passed ' + setters + ' server setting checks with one/two seated players and existing moves.');

    async function create(game, password = null) {
        const res = await fetch(origin + '/qi/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, password }) });
        const data = await res.json(); assert.equal(data.success, true); return data.roomId;
    }
    async function connect(game, id, password = null) {
        const sock = new WS(origin.replace('http', 'ws') + '/qi/ws?game=' + game + '&room=' + id);
        sock.messages = [];
        sock.on('message', (data) => sock.messages.push(JSON.parse(data)));
        await new Promise((r) => sock.once('open', r));
        sock.send(JSON.stringify({ type: 'join', password }));
        await wait(() => sock.messages.some((m) => m.type === 'joined'));
        return sock;
    }
    const id = await create('weiqi', 'test-pass');
    const a = await connect('weiqi', id, 'test-pass'), b = await connect('weiqi', id, 'test-pass');
    a.send(JSON.stringify({ type: 'selectColor', color: 'player1' }));
    b.send(JSON.stringify({ type: 'selectColor', color: 'player2' }));
    await wait(() => rooms.weiqi[id].players.size === 2);
    a.send(JSON.stringify({ type: 'switchGame', game: 'xiangqi' }));
    await wait(() => a.messages.some((m) => m.type === 'switchGameError'));
    assert.ok(rooms.weiqi[id]);
    a.send(JSON.stringify({ type: 'setBoardSize', size: 13 }));
    await wait(() => a.messages.some((m) => m.type === 'error'));
    assert.equal(rooms.weiqi[id].gameLogic.boardSize, 19);
    b.close(); await wait(() => rooms.weiqi[id].players.size === 1);
    const observer = await connect('weiqi', id, 'test-pass');
    a.send(JSON.stringify({ type: 'switchGame', game: '../not-valid' }));
    await wait(() => a.messages.filter((m) => m.type === 'switchGameError').length === 2);
    a.send(JSON.stringify({ type: 'switchGame', game: 'xiangqi' }));
    await wait(() => a.messages.some((m) => m.type === 'roomGameChanged') && observer.messages.some((m) => m.type === 'roomGameChanged'));
    assert.ok(rooms.xiangqi[id]); assert.equal(rooms.weiqi[id], undefined);
    const denied = await fetch(origin + '/qi/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'xiangqi', roomId: id, password: 'wrong' }) }).then((r) => r.json());
    assert.equal(denied.success, false);
    const allowed = await fetch(origin + '/qi/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'xiangqi', roomId: id, password: 'test-pass' }) }).then((r) => r.json());
    assert.equal(allowed.success, true);
    console.log('Passed WebSocket multiplayer locking, whole-room switching and password preservation.');

    if (!puppeteer) return;
    browser = await puppeteer.launch({ executablePath: process.env.QI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, protocolTimeout: 15000, args: ['--no-sandbox', '--disable-gpu'] });
    const context = await browser.createBrowserContext();
    const p = await context.newPage(), p2 = await context.newPage();
    const errors = [];
    for (const page of [p, p2]) {
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', (r) => r.url().startsWith(origin) ? r.continue() : r.abort());
    }
    const bid = await create('xiangqi');
    await p.setViewport({ width: 1280, height: 900 });
    await Promise.all([p.goto(origin + '/qi/rooms/' + bid), p2.goto(origin + '/qi/rooms/' + bid)]);
    console.log('Browser room pages loaded.');
    await p.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings());
    await p.$eval('#gameTitleInfo', (e) => e.click());
    assert.equal(await p.$eval('#roomGameMenu', (e) => e.hidden), false);
    const cols = await p.$eval('.room-game-menu-buttons', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 5);
    assert.equal(await p.$$eval('#roomGameMenu h3', (els) => els.length), 8);
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#roomGameMenu', (e) => e.hidden), true);
    await p.$eval('#gameTitleInfo', (e) => e.click());
    await p.$eval('[data-game="short-liberty-weiqi"]', (e) => e.click());
    await Promise.all([p.waitForFunction(() => window.__qiRoomRoute.gameType === 'short-liberty-weiqi'), p2.waitForFunction(() => window.__qiRoomRoute.gameType === 'short-liberty-weiqi')]);
    assert.equal(p.url(), origin + '/qi/rooms/' + bid);
    await p.bringToFront();
    await p.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings());
    const seatedA = await connect('short-liberty-weiqi', bid);
    const seatedB = await connect('short-liberty-weiqi', bid);
    seatedA.send(JSON.stringify({ type: 'selectColor', color: 'player1' }));
    seatedB.send(JSON.stringify({ type: 'selectColor', color: 'player2' }));
    await wait(() => rooms['short-liberty-weiqi'][bid].players.size === 2);
    await p.waitForFunction(() => !window.QiRoomGameSwitcher.canChangeSettings());
    assert.equal(await p.$eval('#boardSizeSelect', (e) => e.disabled), true);
    assert.equal(await p.$eval('#subGameSelect', (e) => e.disabled), true);
    assert.equal(await p.$eval('[data-game="weiqi"]', (e) => e.disabled), true);
    seatedB.close();
    await wait(() => rooms['short-liberty-weiqi'][bid].players.size === 1);
    console.log('Server released second seat.');
    // Headless browsers suspend requestAnimationFrame in background tabs.
    await p.bringToFront();
    await p.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
    console.log('Page enabled settings again.');
    await p.select('#boardSizeSelect', '13');
    await wait(() => rooms['short-liberty-weiqi'][bid].gameLogic.boardSize === 13);
    await p.select('#subGameSelect', 'tri');
    await wait(() => rooms['short-liberty-weiqi'][bid].gameLogic.liberty === 'tri');
    await Promise.all([p.waitForFunction(() => document.getElementById('subGameSelect').value === 'tri'), p2.waitForFunction(() => document.getElementById('subGameSelect').value === 'tri')]);
    seatedA.close();
    await p.setViewport({ width: 375, height: 812 });
    await p.$eval('#gameTitleInfo', (e) => e.click());
    const mobile = await p.$eval('#roomGameMenu', (e) => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right, height: e.getBoundingClientRect().height, bottom: e.getBoundingClientRect().bottom }));
    assert.ok(mobile.left >= 0 && mobile.right <= 375 && mobile.bottom <= 812);
    assert.equal(await p.$eval('.room-game-menu-buttons', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length), 2);
    await p2.close();
    await p.$eval('[data-game="speed-minesweeper"]', (e) => e.click());
    await p.waitForFunction(() => window.__qiRoomRoute.gameType === 'speed-minesweeper' && window.QiRoomGameSwitcher.canChangeSettings());
    await p.$eval('#gameTitleInfo', (e) => e.click());
    await p.$eval('[data-game="weiqi"]', (e) => e.click());
    await p.waitForFunction(() => window.__qiRoomRoute.gameType === 'weiqi' && window.QiRoomGameSwitcher.canChangeSettings());
    assert.deepEqual(errors, []);
    console.log('Passed desktop/mobile menu, keyboard close, multi-page sync, subgame/size selection and standalone page switching.');
}

async function wait(check) {
    const end = Date.now() + 12000;
    while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for state'); await new Promise((r) => setTimeout(r, 20)); }
}

main().then(() => finish(0)).catch((e) => { console.error(e); finish(1); });
async function finish(code) {
    if (browser) await browser.close();
    for (const group of Object.values(rooms)) for (const room of Object.values(group)) disposeRoom(room);
    for (const client of wss.clients) client.terminate();
    Server_.close();
    process.exit(code);
}
