// node tests/room-local-play.cjs [--browser]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const WS = require('ws');
const root = path.resolve(__dirname, '..');
const compiled = new Module(path.join(root, 'qi-local-play-check.js'), module);
compiled.filename = path.join(root, 'qi-local-play-check.js');
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8')
    .replace('const PORT = 3100;', 'const PORT = 0;')
    + '\nmodule.exports = { BaseGameRoom, rooms, initGameLogic, disposeRoom, Server_, wss };', compiled.filename);
const { BaseGameRoom, rooms, initGameLogic, disposeRoom, Server_, wss } = compiled.exports;
const localPlay = require('../qi-local-play');
let browser;

async function wait(check, label = 'state') {
    const end = Date.now() + 12000;
    while (!check()) {
        if (Date.now() > end) throw new Error('Timed out waiting for ' + label);
        await new Promise((r) => setTimeout(r, 20));
    }
}

async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    let count = 0;
    for (const game of require('../public/game-catalog').games.filter((g) => g.enabled)) {
        const room = new BaseGameRoom('local-test', game.id, false, null);
        initGameLogic(room);
        if (room.gameLogic.boardSeatOverlay && room.maxPlayers === 2) {
            const client = { readyState: 1, send() {} };
            room.addObserver(client);
            localPlay.start(room, client);
            assert.ok(room.localPlay, game.id + ' starts local play');
            if (room.gameLogic.tcNego) room.localPlay.handleMessage({ type: 'timeControlSubmit', timed: false, colorChoice: 'player1' });
            assert.equal(room.localPlay.state().matchStarted, true, game.id + ' starts a match');
            assert.equal(room.players.size, 2);
            assert.equal(room.getSeatedCount(), 1);
            assert.equal(room.getPlayerCount(), 1);
            assert.equal(room.getSeatCapacity(), 1);
            const reset = room.gameLogic.resetGame || room.gameLogic.resetToEmpty;
            assert.ok(reset, game.id + ' supplies a reset operation');
            reset.call(room.gameLogic);
            assert.equal(room.localPlay, null, game.id + ' clears local seats on reset');
            assert.equal(room.slotOccupancy.size, 0);
            assert.equal(room.getSeatCapacity(), 2);
            count++;
        }
        disposeRoom(room);
    }
    console.log('Passed local startup/reset for ' + count + ' chess types.');

    const normalRoom = new BaseGameRoom('normal-confirmation-test', 'weiqi', false, null);
    initGameLogic(normalRoom);
    const normalA = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
    const normalB = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
    normalRoom.setPlayerSlot(normalA, 'player1'); normalRoom.setPlayerSlot(normalB, 'player2');
    normalRoom.gameLogic.matchStarted = true; normalRoom.gameLogic.tcSettings = { timed: false };
    normalRoom.gameLogic.handleMessage(normalA, { type: 'move', row: 3, col: 3 });
    normalRoom.gameLogic.handleMessage(normalB, { type: 'move', row: 3, col: 4 });
    normalRoom.gameLogic.handleMessage(normalA, { type: 'requestUndo' });
    assert.equal(normalRoom.gameLogic.moveHistory.length, 2);
    assert.ok(normalB.messages.some((m) => m.type === 'undoRequest'));
    normalRoom.gameLogic.handleMessage(normalA, { type: 'requestEnd' });
    assert.equal(normalRoom.gameLogic.pendingScore, null);
    assert.ok(normalB.messages.some((m) => m.type === 'requestEnd'));
    disposeRoom(normalRoom);

    async function create(game) {
        const data = await fetch(origin + '/qi/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game }) }).then((r) => r.json());
        assert.equal(data.success, true);
        return data.roomId;
    }
    async function connect(game, id, token) {
        const socket = new WS(origin.replace('http', 'ws') + '/qi/ws?game=' + game + '&room=' + id);
        socket.messages = [];
        socket.on('message', (data) => socket.messages.push(JSON.parse(data)));
        await new Promise((r) => socket.once('open', r));
        socket.send(JSON.stringify({ type: 'join', localPlayToken: token }));
        await wait(() => socket.messages.some((m) => m.type === 'joined'));
        return socket;
    }
    const id = await create('weiqi');
    let player = await connect('weiqi', id);
    player.send(JSON.stringify({ type: 'startLocalGame' }));
    await wait(() => player.messages.some((m) => m.type === 'localGameStarted'));
    const token = player.messages.find((m) => m.type === 'localGameStarted').token;
    const room = rooms.weiqi[id];
    async function listing(game, roomId) {
        return (await fetch(origin + '/qi/rooms?game=' + game).then((r) => r.json())).find((r) => r.roomId === roomId);
    }
    assert.equal((await listing('weiqi', id)).playerCount, 1);
    assert.equal((await listing('weiqi', id)).maxPlayers, 1);
    player.send(JSON.stringify({ type: 'timeControlSubmit', timed: false, colorChoice: 'player2' }));
    await wait(() => room.gameLogic.matchStarted);
    assert.equal(room.getPlayerBySlot('player1'), room.localPlay.seats.player1);
    const observer = await connect('weiqi', id);
    assert.equal(observer.messages.find((m) => m.type === 'joined').role, 'observer');
    observer.send(JSON.stringify({ type: 'startLocalGame' }));
    await wait(() => observer.messages.some((m) => m.type === 'error'));
    observer.send(JSON.stringify({ type: 'move', row: 4, col: 4 }));
    player.send(JSON.stringify({ type: 'move', row: 3, col: 3 }));
    await wait(() => room.gameLogic.moveHistory.length === 1);
    player.send(JSON.stringify({ type: 'move', row: 3, col: 4 }));
    await wait(() => room.gameLogic.moveHistory.length === 2);
    assert.equal(room.gameLogic.board[3][3], 1);
    assert.equal(room.gameLogic.board[3][4], 2);
    assert.equal(room.gameLogic.board[4][4], 0);
    assert.ok(player.messages.some((m) => m.type === 'colorAssigned' && m.color === 'player2'));
    player.close();
    await wait(() => room.localPlay.client === null);
    assert.equal((await listing('weiqi', id)).playerCount, 0);
    assert.equal((await listing('weiqi', id)).maxPlayers, 1);
    assert.equal(room.getSlotByWs(null), undefined);
    player = await connect('weiqi', id, token);
    const rejoined = player.messages.find((m) => m.type === 'joined');
    assert.equal(rejoined.role, 'observer');
    assert.equal(rejoined.state.soloOccupied, false);
    assert.equal(rejoined.state.board[3][4], 2);
    player.send(JSON.stringify({ type: 'continueSoloGame' }));
    await wait(() => room.localPlay.client === player || room.localPlay.client && room.localPlay.client.readyState === 1 && room.getPlayerCount() === 1);
    await wait(() => player.messages.some((m) => m.type === 'colorAssigned'));
    const previousConnection = player;
    const otherPage = await connect('weiqi', id, token);
    assert.equal(otherPage.messages.find((m) => m.type === 'joined').role, 'observer');
    otherPage.send(JSON.stringify({ type: 'continueSoloGame' }));
    await wait(() => otherPage.messages.some((m) => m.type === 'soloSeatState'));
    assert.ok(!otherPage.messages.some((m) => m.type === 'colorAssigned'), 'a second page cannot take over an occupied solo seat');
    assert.equal(previousConnection.readyState, 1);
    player.send(JSON.stringify({ type: 'move', row: 3, col: 5 }));
    await wait(() => room.gameLogic.moveHistory.length === 3);
    player.send(JSON.stringify({ type: 'requestUndo' }));
    await wait(() => room.gameLogic.moveHistory.length < 3);
    assert.equal(room.gameLogic.pendingUndo, null);
    assert.ok(!player.messages.some((m) => m.type === 'undoRequest'));
    player.send(JSON.stringify({ type: 'requestEnd' }));
    await wait(() => !!room.gameLogic.pendingScore);
    assert.equal(room.gameLogic.pendingEnd, null);
    assert.ok(!player.messages.some((m) => m.type === 'requestEnd'));
    player.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
    await wait(() => room.gameLogic.gameOver);
    assert.equal(room.gameLogic.pendingScore, null);
    player.send(JSON.stringify({ type: 'requestNewGame' }));
    await wait(() => room.localPlay === null);
    assert.equal(room.players.size, 0);
    assert.equal((await listing('weiqi', id)).maxPlayers, 2);
    observer.send(JSON.stringify({ type: 'takeSeat' }));
    otherPage.send(JSON.stringify({ type: 'takeSeat' }));
    await wait(() => room.getPlayerCount() === 2);
    console.log('Passed alternating moves, observer isolation, reconnect, undo, score and new-game cleanup.');

    const fogId = await create('fog-weiqi');
    const fog = await connect('fog-weiqi', fogId);
    fog.send(JSON.stringify({ type: 'startLocalGame' }));
    await wait(() => !!rooms['fog-weiqi'][fogId].localPlay);
    fog.send(JSON.stringify({ type: 'timeControlSubmit', timed: false, colorChoice: 'player1' }));
    await wait(() => rooms['fog-weiqi'][fogId].gameLogic.matchStarted);
    fog.send(JSON.stringify({ type: 'move', row: 3, col: 3 }));
    await wait(() => rooms['fog-weiqi'][fogId].gameLogic.moveHistory.length === 1);
    await wait(() => fog.messages.some((m) => m.type === 'broadcast' && m.action === 'move'));
    const fogMove = fog.messages.findLast((m) => m.type === 'broadcast' && m.action === 'move');
    assert.deepEqual(fogMove.board, rooms['fog-weiqi'][fogId].gameLogic.getStateForSlot('player2').board);
    assert.deepEqual(fogMove.fogMask, rooms['fog-weiqi'][fogId].gameLogic.getStateForSlot('player2').fogMask);
    assert.equal(fogMove.stateFull, true);
    console.log('Passed server perspective switch for fog Go.');

    for (const game of ['invisible-stone-weiqi', 'radar-weiqi', 'sonar-weiqi', 'xiangqi', 'fog-xiangqi', 'chess']) {
        const gameId = await create(game);
        const client = await connect(game, gameId);
        client.send(JSON.stringify({ type: 'startLocalGame' }));
        const currentRoom = rooms[game][gameId];
        await wait(() => !!currentRoom.localPlay);
        if (currentRoom.gameLogic.tcNego) client.send(JSON.stringify({ type: 'timeControlSubmit', timed: false, colorChoice: 'player1' }));
        await wait(() => currentRoom.gameLogic.matchStarted);
        const isChess = game === 'chess';
        const movingPiece = game.includes('xiangqi') || isChess;
        const firstMove = movingPiece ? { type: 'move', fromRow: isChess ? 1 : 3, fromCol: 0, toRow: isChess ? 2 : 4, toCol: 0 } : { type: 'move', row: 3, col: 3 };
        const secondMove = movingPiece ? { type: 'move', fromRow: 6, fromCol: 0, toRow: 5, toCol: 0 } : { type: 'move', row: 6, col: 6 };
        client.send(JSON.stringify(firstMove));
        await wait(() => currentRoom.localPlay.turnSlot() === 'player2', game + ' first move');
        await wait(() => client.messages.some((m) => m.type === 'colorAssigned' && m.color === 'player2'));
        if (currentRoom.gameLogic.getStateForClient) {
            const state = client.messages.findLast((m) => m.type === 'broadcast' || m.type === 'gameState');
            const expected = currentRoom.gameLogic.getStateForClient(currentRoom.getPlayerBySlot('player2'));
            if (expected.board) assert.deepEqual(state.board, expected.board, game + ' switches to the opponent view');
            if (expected.fogMask) assert.deepEqual(state.fogMask, expected.fogMask, game + ' switches fog');
        }
        client.send(JSON.stringify(secondMove));
        await wait(() => currentRoom.localPlay.turnSlot() === 'player1', game + ' second move');
    }
    console.log('Passed alternating turns and perspectives for chess, Xiangqi and hidden-information variants.');

    if (!process.argv.includes('--browser')) return;
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: process.env.QI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, protocolTimeout: 15000, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
        window.__testMessages = [];
        const Native = window.WebSocket;
        window.WebSocket = class extends Native {
            constructor(...args) {
                super(...args);
                this.addEventListener('message', (e) => {
                    try { window.__testMessages.push(JSON.parse(e.data)); } catch (_) {}
                });
            }
        };
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(origin) ? r.continue() : r.abort());
    const browserId = await create('weiqi');
    await page.goto(origin + '/qi/rooms/' + browserId);
    await page.waitForFunction(() => document.querySelector('[data-seat-action="local"]') && !document.querySelector('[data-seat-action="local"]').hidden);
    assert.equal(await page.$eval('[data-seat-action="computer"]', (e) => !e.hidden),
        await page.$eval('#vsComputerBtn', (e) => getComputedStyle(e).display !== 'none'));
    // 用可用性状态验证新入口复用既有按钮，不启动测试环境中的外部棋力引擎。
    const browserRoom = rooms.weiqi[browserId];
    await wait(() => browserRoom.observers.size === 1);
    const originalState = browserRoom.gameLogic.getState;
    browserRoom.gameLogic.getState = () => ({ ...originalState.call(browserRoom.gameLogic), katagoAvailable: true });
    browserRoom.broadcast({ type: 'gameState', ...browserRoom.gameLogic.getState() });
    await page.waitForFunction(() => !document.querySelector('[data-seat-action="computer"]').hidden, { polling: 100 });
    await page.$eval('#vsComputerBtn', (e) => {
        window.__originalComputerAction = e.onclick;
        e.onclick = () => { window.__computerClicked = true; };
    });
    await page.$eval('[data-seat-action="computer"]', (e) => e.click());
    assert.equal(await page.evaluate(() => window.__computerClicked), true);
    await page.$eval('#vsComputerBtn', (e) => { e.onclick = window.__originalComputerAction; });
    if (process.argv.includes('--screenshots')) await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'qi-local-play-overlay.png') });
    await page.setViewport({ width: 375, height: 812 });
    const buttonBounds = await page.$$eval('.qi-seat-overlay-btn:not([hidden])', (buttons) => buttons.map((b) => ({ top: b.getBoundingClientRect().top, bottom: b.getBoundingClientRect().bottom })));
    assert.ok(buttonBounds.every((b) => b.top >= 0 && b.bottom <= 812));
    if (process.argv.includes('--screenshots')) await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'qi-local-play-mobile.png') });
    await page.setViewport({ width: 1280, height: 900 });
    browserRoom.gameLogic.getState = originalState;
    await page.select('#boardSizeSelect', '13');
    await wait(() => browserRoom.gameLogic.boardSize === 13, 'Go board resize before seating');
    await page.select('#boardSizeSelect', '19');
    await wait(() => browserRoom.gameLogic.boardSize === 19, 'Go board resize back before seating');
    await page.$eval('[data-seat-action="local"]', (e) => e.click());
    await page.waitForFunction(() => document.getElementById('colorStatus').textContent.includes('本地对战'));
    await page.waitForSelector('#qiTcBtnProposeOk', { visible: true });
    assert.equal(await page.$$eval('input[name="qiColorChoice"]', (inputs) => inputs.length === 3 && inputs.every((input) => input.disabled)), true);
    assert.equal(await page.$eval('input[name="qiTimedMode"][value="limited"]', (input) => input.disabled), false);
    await page.reload();
    await page.waitForSelector('[data-seat-action="continue-solo"]', { visible: true });
    assert.equal(await page.$$eval('.qi-seat-overlay-btn:not([hidden])', (els) => els.length), 1);
    await page.click('[data-seat-action="continue-solo"]');
    await page.waitForSelector('#qiTcBtnProposeOk', { visible: true });
    assert.equal(await page.$$eval('input[name="qiColorChoice"]', (inputs) => inputs.every((input) => input.disabled)), true);
    await page.$eval('input[name="qiTimedMode"][value="unlimited"]', (e) => e.click());
    await page.$eval('#qiTcBtnProposeOk', (e) => e.click());
    await wait(() => rooms.weiqi[browserId].gameLogic.matchStarted);
    async function clickGo(row, col) {
        await page.$eval('#goBoard', (canvas, row, col) => {
            const rect = canvas.getBoundingClientRect();
            const geometry = window.QiSquareWeiqiCanvas.computePaddingAndCell(19);
            const x = geometry.padding + col * geometry.cellSize;
            const y = geometry.padding + (18 - row) * geometry.cellSize;
            canvas.dispatchEvent(new MouseEvent('click', { bubbles: true,
                clientX: rect.left + x / 600 * rect.width, clientY: rect.top + y / 600 * rect.height }));
        }, row, col);
    }
    await clickGo(3, 3);
    await page.waitForFunction(() => window.__testMessages.some((m) => m.type === 'colorAssigned' && m.color === 'player2'));
    await clickGo(3, 4);
    await wait(() => rooms.weiqi[browserId].gameLogic.moveHistory.length === 2);
    assert.ok(await page.evaluate((id) => sessionStorage.getItem('qiLocalPlay_' + id), browserId));
    await page.reload();
    await page.waitForSelector('[data-seat-action="continue-solo"]', { visible: true });
    await page.click('[data-seat-action="continue-solo"]');
    await page.waitForFunction(() => document.getElementById('colorStatus').textContent.includes('本地对战'));
    assert.equal(rooms.weiqi[browserId].players.size, 2);
    await clickGo(3, 5);
    await wait(() => rooms.weiqi[browserId].gameLogic.moveHistory.length === 3);
    await page.evaluate(() => { window.__confirmationCount = 0; window.qiConfirm = () => {
        window.__confirmationCount++; return Promise.resolve(false);
    }; });
    await page.click('#undoBtn');
    await wait(() => browserRoom.gameLogic.moveHistory.length < 3);
    assert.equal(await page.evaluate(() => window.__confirmationCount), 0);
    await page.click('#endReqBtn');
    await wait(() => !!browserRoom.gameLogic.pendingScore);
    assert.equal(browserRoom.gameLogic.pendingEnd, null);
    assert.equal(await page.evaluate(() => window.__confirmationCount), 0);
    assert.ok(!(await page.evaluate(() => window.__testMessages.some((m) => m.type === 'undoRequest' || m.type === 'requestEnd'))));
    // 数点结果仍由原界面展示；拒绝结果后可以继续对局。
    const localScoreClient = browserRoom.localPlay.client;
    browserRoom.localPlay.handleMessage({ type: 'scoreResponse', accept: false });
    await wait(() => !browserRoom.gameLogic.pendingScore);
    assert.equal(browserRoom.localPlay.client, localScoreClient);
    await page.select('#boardSizeSelect', '13');
    await wait(() => browserRoom.gameLogic.boardSize === 13, 'Go board resize during local play');
    await page.waitForFunction(() => document.getElementById('boardSizeSelect').value === '13');
    assert.equal(browserRoom.localPlay, null);
    assert.equal(browserRoom.gameLogic.board.length, 13);
    const browserFogId = await create('fog-weiqi');
    await page.goto(origin + '/qi/rooms/' + browserFogId);
    await page.waitForFunction(() => document.querySelector('[data-seat-action="local"]') && !document.querySelector('[data-seat-action="local"]').hidden);
    await page.$eval('[data-seat-action="local"]', (e) => e.click());
    await page.waitForSelector('#qiTcBtnProposeOk', { visible: true });
    await page.$eval('input[name="qiTimedMode"][value="unlimited"]', (e) => e.click());
    await page.$eval('#qiTcBtnProposeOk', (e) => e.click());
    await wait(() => rooms['fog-weiqi'][browserFogId].gameLogic.matchStarted);
    await clickGo(3, 3);
    await page.waitForFunction(() => window.__testMessages.some((m) => m.type === 'broadcast' && m.action === 'move'));
    const clientView = await page.evaluate(() => window.__testMessages.findLast((m) => m.type === 'broadcast' && m.action === 'move'));
    assert.deepEqual(clientView.fogMask, rooms['fog-weiqi'][browserFogId].gameLogic.getStateForSlot('player2').fogMask);
    await clickGo(10, 10);
    await wait(() => rooms['fog-weiqi'][browserFogId].gameLogic.moveHistory.length === 2);
    assert.deepEqual(errors, []);
    const reversiId = await create('reversi');
    await page.goto(origin + '/qi/rooms/' + reversiId);
    await page.waitForSelector('[data-seat-action="local"]', { visible: true });
    await page.click('[data-seat-action="local"]');
    await page.waitForSelector('#qiTcBtnProposeOk', { visible: true });
    await page.$eval('input[name="qiTimedMode"][value="unlimited"]', (e) => e.click());
    await page.click('#qiTcBtnProposeOk');
    const reversiRoom = rooms.reversi[reversiId];
    await wait(() => reversiRoom.gameLogic.matchStarted);
    reversiRoom.localPlay.handleMessage({ type: 'move', row: 2, col: 4 });
    reversiRoom.localPlay.handleMessage({ type: 'move', row: 2, col: 5 });
    await wait(() => reversiRoom.gameLogic.moveHistory.length === 2);
    await page.evaluate(() => { window.__confirmationCount = 0; window.qiConfirm = () => {
        window.__confirmationCount++; return Promise.resolve(false);
    }; });
    await page.click('#undoBtn');
    await wait(() => reversiRoom.gameLogic.moveHistory.length < 2);
    assert.equal(await page.evaluate(() => window.__confirmationCount), 0);
    assert.deepEqual(errors, []);
    console.log('Passed overlay, alternating board clicks, explicit refresh continuation and fog perspective in browser.');
    console.log('Passed immediate local undo/scoring without dialogs, independent Reversi panel and ordinary-game peer confirmations.');
}

main().then(() => finish(0)).catch((e) => { console.error(e); finish(1); });
async function finish(code) {
    if (browser) await browser.close();
    for (const group of Object.values(rooms)) for (const room of Object.values(group)) disposeRoom(room);
    for (const client of wss.clients) client.terminate();
    Server_.close();
    process.exit(code);
}
