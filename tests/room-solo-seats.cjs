// node tests/room-solo-seats.cjs [--browser]
// 使用确定性的引擎替身测试真实人机协议，不启动本机 KataGo 进程。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const WS = require('ws');
const root = path.resolve(__dirname, '..');
let delayedMove = null, delayComputer = false;
module.fakeGtp = {
    isKatagoAvailable: () => true, readConfigMaxVisits: () => 1, canAcquireKatagoNow: () => true,
    isKatagoBusyError: () => false, KATAGO_BUSY_MESSAGE: 'busy',
    acquireKatagoSession: async () => ({
        dead: false, setMaxVisits: async () => {}, setupGame: async () => {}, primeNn: async () => {},
        play: async () => {},
        genMove: async () => delayComputer ? new Promise((resolve) => { delayedMove = resolve; }) : { pass: true }
    }),
    releaseKatagoSession: async () => {}
};
function compile(name, source) {
    const compiled = new Module(path.join(root, name), module);
    compiled.filename = path.join(root, name);
    compiled.paths = Module._nodeModulePaths(root);
    compiled._compile(source, compiled.filename);
    return compiled.exports;
}
module.testOpponent = compile('qi-solo-test-opponent.js', fs.readFileSync(path.join(root, 'qi-katago-opponent.js'), 'utf8')
    .replace("require('./katago-gtp')", 'module.parent.fakeGtp'));
const { rooms, disposeRoom, Server_, wss } = compile('qi-solo-test-server.js', fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8')
    .replace('const PORT = 3100;', 'const PORT = 0;')
    .replaceAll("require('./qi-katago-opponent')", 'module.parent.testOpponent')
    + '\nmodule.exports = { rooms, disposeRoom, Server_, wss };');
let browser;
async function wait(check, label = 'state') {
    const deadline = Date.now() + 12000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('Timed out: ' + label);
        await new Promise((r) => setTimeout(r, 20));
    }
}
async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    async function create() {
        const data = await fetch(origin + '/qi/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'weiqi' }) }).then((r) => r.json());
        assert.equal(data.success, true); return data.roomId;
    }
    async function connect(id) {
        const socket = new WS(origin.replace('http', 'ws') + '/qi/ws?game=weiqi&room=' + id);
        socket.messages = [];
        socket.on('message', (data) => socket.messages.push(JSON.parse(data)));
        await new Promise((r) => socket.once('open', r));
        socket.send(JSON.stringify({ type: 'join' }));
        await wait(() => socket.messages.some((m) => m.type === 'joined'));
        return socket;
    }
    const list = async (id) => (await fetch(origin + '/qi/rooms?game=weiqi').then((r) => r.json())).find((r) => r.roomId === id);
    const id = await create(), first = await connect(id), observer = await connect(id);
    first.send(JSON.stringify({ type: 'startVsComputer', colorChoice: 'player2' }));
    const room = rooms.weiqi[id], game = room.gameLogic;
    await wait(() => game.computerSlot === 'player1' && game.moveHistory.length === 1);
    assert.equal((await list(id)).playerCount, 1);
    assert.equal((await list(id)).maxPlayers, 1);
    assert.equal(room.getSeatedCount(), 1);
    first.send(JSON.stringify({ type: 'move', row: 3, col: 3 }));
    await wait(() => game.moveHistory.length === 3);
    assert.equal(game.board[3][3], 2);
    first.close();
    await wait(() => room.getPlayerCount() === 0);
    assert.equal(game.computerSlot, 'player1', 'leaving preserves computer mode and the human color');
    assert.equal((await list(id)).playerCount, 0);
    assert.equal((await list(id)).maxPlayers, 1);
    const returning = await connect(id);
    assert.equal(returning.messages.find((m) => m.type === 'joined').role, 'observer');
    assert.equal(returning.messages.find((m) => m.type === 'joined').state.soloOccupied, false);
    returning.send(JSON.stringify({ type: 'continueSoloGame' }));
    await wait(() => returning.messages.some((m) => m.type === 'colorAssigned'));
    assert.equal(returning.messages.find((m) => m.type === 'colorAssigned').color, 'player2');
    observer.send(JSON.stringify({ type: 'continueSoloGame' }));
    await wait(() => observer.messages.some((m) => m.type === 'soloSeatState' && m.soloOccupied));
    assert.ok(!observer.messages.some((m) => m.type === 'colorAssigned'));
    delayComputer = true;
    returning.send(JSON.stringify({ type: 'move', row: 6, col: 6 }));
    await wait(() => delayedMove);
    const ply = game.moveHistory.length;
    returning.close(); observer.close();
    await wait(() => room.getPlayerCount() === 0 && room.observers.size === 0);
    assert.equal(room.destroyTimer._idleTimeout, 7200000, 'empty solo rooms use the ordinary short-game lifetime');
    delayedMove({ pass: true }); delayedMove = null; delayComputer = false;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(game.moveHistory.length, ply, 'a disconnected player does not receive a late computer move');
    const final = await connect(id);
    final.send(JSON.stringify({ type: 'continueSoloGame' }));
    await wait(() => game.moveHistory.length === ply + 1, 'computer resumes its pending turn');
    final.send(JSON.stringify({ type: 'requestNewGame' }));
    await wait(() => !game.computerSlot && !game.matchStarted && room.players.size === 0);
    assert.equal((await list(id)).maxPlayers, 2);
    const secondHuman = await connect(id);
    final.send(JSON.stringify({ type: 'takeSeat' })); secondHuman.send(JSON.stringify({ type: 'takeSeat' }));
    await wait(() => room.getPlayerCount() === 2);
    console.log('Passed computer startup, 1/1 and 0/1 counts, explicit continuation, seat exclusivity, pending AI recovery and two-seat reset.');

    const resizeId = await create(), resize = await connect(resizeId);
    resize.send(JSON.stringify({ type: 'startVsComputer', colorChoice: 'player1' }));
    const resizeRoom = rooms.weiqi[resizeId];
    await wait(() => resizeRoom.gameLogic.computerSlot);
    resize.send(JSON.stringify({ type: 'setBoardSize', size: 13 }));
    await wait(() => resizeRoom.gameLogic.boardSize === 13);
    assert.equal(resizeRoom.getSeatCapacity(), 2, 'single-person computer rooms can still change board size');
    assert.equal(resizeRoom.gameLogic.computerSlot, null);
    resize.close();

    const cleanupId = await create(), cleanup = await connect(cleanupId);
    cleanup.send(JSON.stringify({ type: 'startLocalGame' }));
    const cleanupRoom = rooms.weiqi[cleanupId];
    await wait(() => cleanupRoom.localPlay);
    cleanup.close();
    await wait(() => cleanupRoom.destroyTimer);
    assert.equal(cleanupRoom.destroyTimer._idleTimeout, 7200000);
    cleanupRoom.gameLogic.getMoveCount = () => 10;
    cleanupRoom.scheduleDestruction();
    assert.equal(cleanupRoom.destroyTimer._idleTimeout, 86400000);
    cleanupRoom.destroyTimer._onTimeout();
    assert.equal(rooms.weiqi[cleanupId], undefined);
    console.log('Passed ordinary solo-room destruction thresholds and actual cleanup.');

    if (!process.argv.includes('--browser')) return;
    browser = await require('puppeteer-core').launch({ executablePath: process.env.QI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
        args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage(), errors = [];
    // 首页默认走生产反代的标准端口；测试服务使用随机端口。
    await page.evaluateOnNewDocument(() => {
        const fetch = window.fetch;
        window.fetch = (input, options) => {
            if (typeof input === 'string' && input.startsWith(location.protocol + '//' + location.hostname + '/'))
                input = location.origin + input.slice((location.protocol + '//' + location.hostname).length);
            return fetch(input, options);
        };
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(origin) ? r.continue() : r.abort());
    const browserId = await create(), human = await connect(browserId);
    human.send(JSON.stringify({ type: 'startVsComputer', colorChoice: 'player2' }));
    const browserRoom = rooms.weiqi[browserId];
    await wait(() => browserRoom.gameLogic.moveHistory.length === 1);
    await page.goto(origin + '/qi/rooms/' + browserId);
    await page.waitForFunction(() => document.querySelector('.qi-seat-overlay') && document.querySelector('.qi-seat-overlay').hidden);
    assert.equal(browserRoom.getPlayerCount(), 1, 'occupied solo room stays spectator-only');
    human.close();
    await page.waitForSelector('[data-seat-action="continue-solo"]', { visible: true });
    assert.equal(await page.$$eval('.qi-seat-overlay-btn:not([hidden])', (els) => els.length), 1);
    await page.click('[data-seat-action="continue-solo"]');
    await page.waitForFunction(() => document.getElementById('colorStatus').textContent.includes('白'));
    await page.waitForFunction(() => document.querySelector('.qi-seat-overlay').hidden);
    assert.equal(browserRoom.getPlayerCount(), 1);
    await page.reload();
    await page.waitForSelector('[data-seat-action="continue-solo"]', { visible: true });
    await page.click('[data-seat-action="continue-solo"]');
    await page.waitForFunction(() => document.querySelector('.qi-seat-overlay').hidden);
    await page.goto(origin + '/qi');
    await page.waitForFunction((id) => document.querySelector('.room-item[data-room-id="' + id + '"] .player-count')?.textContent === '0/1', {}, browserId);
    await page.goto(origin + '/qi/rooms/' + browserId);
    await page.waitForSelector('[data-seat-action="continue-solo"]', { visible: true });
    await page.click('[data-seat-action="continue-solo"]');
    await page.evaluate(() => { window.qiConfirm = () => Promise.resolve(true); });
    await page.click('#newGameBtn');
    await page.waitForSelector('[data-seat-action="sit"]', { visible: true });
    assert.equal(browserRoom.getSeatCapacity(), 2);
    assert.deepEqual(errors, []);
    console.log('Passed computer spectator overlay, continuation, refresh, homepage 0/1 and new-game seating in browser.');
}
main().then(() => finish(0)).catch((e) => { console.error(e); finish(1); });
async function finish(code) {
    if (browser) await browser.close();
    for (const group of Object.values(rooms)) for (const room of Object.values(group)) disposeRoom(room);
    for (const client of wss.clients) client.terminate();
    Server_.close(); process.exit(code);
}
