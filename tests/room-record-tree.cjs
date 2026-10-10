// node tests/room-record-tree.cjs [--browser]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const WS = require('ws');
const Tree = require('../public/record-tree');
const root = path.resolve(__dirname, '..');
const record = { format: 'muzei', version: 1, gameId: 'weiqi', boardSize: 13, initialPosition: [], result: '黑胜',
    moves: ['B2,2', { main: ['W3,3', 'B4,4'], v1: ['W6,6', { main: ['B7,7'], v1: ['B5,5'] }] }] };
const parsed = Tree.parse(record.moves);
assert.deepEqual(Tree.path(parsed).moves, ['B2,2', 'W3,3', 'B4,4']);
assert.deepEqual(JSON.parse(JSON.stringify(Tree.serialize(parsed))), record.moves);
assert.deepEqual(Tree.path(Tree.parse(['B1,1', 'W2,2'])).moves, ['B1,1', 'W2,2']);
assert.throws(() => Tree.parse([{ main: [], v1: ['B1,1'] }]));
assert.throws(() => Tree.parse(['B1,1', ['W2,2', 'W3,3']]));
assert.throws(() => Tree.parse([{ main: ['B1,1'], v1: ['B2,2'] }, 'W3,3']));
assert.deepEqual(Tree.movePoint('R3,0-4,0'), { row: 4, col: 0 });
const promotedTree = Tree.parse(record.moves);
const promotedId = promotedTree.nodes.find((n) => n.move === 'W6,6').id;
const originalIds = promotedTree.nodes.map((n) => n.id);
assert.equal(Tree.setMain(promotedTree, promotedId), true);
assert.deepEqual(Tree.path(promotedTree).moves, ['B2,2', 'W6,6', 'B7,7']);
assert.deepEqual(Tree.serialize(promotedTree)[1].v1, ['W3,3', 'B4,4']);
assert.deepEqual(promotedTree.nodes.map((n) => n.id), originalIds, 'promotion keeps node IDs stable');
assert.equal(Tree.setMain(promotedTree, promotedId), false);
assert.throws(() => Tree.setMain(promotedTree, 0));
assert.equal(Tree.setSide(promotedTree, promotedId), true);
assert.equal(promotedTree.nodes[1].children.some((id) => promotedTree.nodes[id].key === 'main'), false);
const allSides = JSON.parse(JSON.stringify(Tree.serialize(promotedTree)));
assert.equal(Object.hasOwn(allSides[1], 'main'), false);
assert.deepEqual(JSON.parse(JSON.stringify(Tree.serialize(Tree.parse(allSides)))), allSides);
assert.deepEqual(Tree.path(promotedTree, 0, true, { random: () => 0 }).moves, ['B2,2', 'W6,6', 'B7,7']);
assert.deepEqual(Tree.path(promotedTree, 0, true, { random: () => .99 }).moves, ['B2,2', 'W3,3', 'B4,4']);
assert.equal(Tree.setMain(promotedTree, promotedId), true, 'first sibling can be promoted after demotion');
const singleSide = Tree.parse(['B1,1']);
Tree.setSide(singleSide, 1);
assert.deepEqual(JSON.parse(JSON.stringify(Tree.serialize(singleSide))), [{ v1: ['B1,1'] }]);
assert.equal(Tree.parse(Tree.serialize(singleSide)).nodes[1].key, 'v1');
const weighted = Tree.parse([{ main: ['B1,1'], v1: ['B2,2'], v2: ['B3,3'] }]);
const weightedCount = [0, 0, 0];
for (let i = 0; i < 400; i++) {
    const selected = Tree.choose(weighted, weighted.root.children, { preferMain: false, mainWeight: 2, random: () => (i + .5) / 400 });
    weightedCount[weighted.root.children.indexOf(selected)]++;
    assert.equal(Tree.choose(weighted, weighted.root.children, { random: () => (i + .5) / 400 }), weighted.root.children[0]);
}
assert.deepEqual(weightedCount, [200, 100, 100], 'tsumego main reply has twice each side reply weight');
Tree.setSide(weighted, weighted.root.children[0]);
const equalCount = [0, 0, 0];
for (let i = 0; i < 300; i++) {
    const selected = Tree.choose(weighted, weighted.root.children, { preferMain: false, mainWeight: 2, random: () => (i + .5) / 300 });
    equalCount[weighted.root.children.indexOf(selected)]++;
}
assert.deepEqual(equalCount, [100, 100, 100], 'no main means equal weights');

const compiled = new Module(path.join(root, 'qi-record-tree-check.js'), module);
compiled.filename = path.join(root, 'qi-record-tree-check.js');
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8').replace('const PORT = 3100;', 'const PORT = 0;')
    + '\nmodule.exports = { rooms, disposeRoom, Server_, wss };', compiled.filename);
const { rooms, disposeRoom, Server_, wss } = compiled.exports;
let browser;
async function wait(check, label = 'state') {
    const end = Date.now() + 12000;
    while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise((r) => setTimeout(r, 20)); }
}
async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    async function create(game) {
        const data = await fetch(origin + '/qi/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game }) }).then((r) => r.json());
        assert.equal(data.success, true); return data.roomId;
    }
    async function connect(game, id) {
        const client = new WS(origin.replace('http', 'ws') + '/qi/ws?game=' + game + '&room=' + id);
        client.messages = [];
        client.on('message', (data) => client.messages.push(JSON.parse(data)));
        await new Promise((r) => client.once('open', r));
        client.send(JSON.stringify({ type: 'join' }));
        await wait(() => client.messages.some((m) => m.type === 'joined'));
        return client;
    }
    async function request(client, data, response) {
        const start = client.messages.length;
        client.send(JSON.stringify(data));
        await wait(() => client.messages.slice(start).some((m) => m.type === response), data.type);
        return client.messages.slice(start).find((m) => m.type === response);
    }
    const id = await create('weiqi'), a = await connect('weiqi', id);
    const imported = await request(a, { type: 'importRecord', data: record }, 'importSuccess');
    const room = rooms.weiqi[id];
    const board = JSON.stringify(room.gameLogic.board);
    assert.equal(imported.recordNodes.length, 7);
    const fork = room.recordTree.tree.nodes.find((n) => n.move === 'W6,6').id;
    const variation = await request(a, { type: 'selectRecordVariation', nodeId: fork, recordTreeVersion: room.recordTree.version }, 'recordVariation');
    assert.deepEqual(variation.replayData.moves.map((m) => [m.row, m.col]), [[2, 2], [6, 6], [7, 7]]);
    assert.equal(variation.recordStep, 2);
    assert.equal(JSON.stringify(room.gameLogic.board), board, 'browsing preserves actual match');
    const begun = await request(a, { type: 'beginRecordVariations', step: 1 }, 'recordTree');
    assert.equal(begun.recordEditing, true);
    const added = await request(a, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 8, col: 8 } }, 'recordVariation');
    assert.equal(added.recordStep, 2);
    assert.equal(JSON.stringify(room.gameLogic.board), board, 'adding preserves actual match');
    assert.deepEqual(Tree.path(room.recordTree.tree).moves, ['B2,2', 'W3,3', 'B4,4']);
    const exported = await request(a, { type: 'exportRecord' }, 'gameRecord');
    assert.deepEqual(exported.data.moves[1].v2, ['W8,8']);
    const count = room.recordTree.tree.nodes.length;
    await request(a, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 8, col: 8 } }, 'recordVariation');
    assert.equal(room.recordTree.tree.nodes.length, count, 'existing variation is reused');
    const bad = await request(a, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 2, col: 2 } }, 'recordVariationIgnored');
    assert.equal(bad.message, undefined, 'illegal analysis moves are silently ignored');
    assert.equal(room.recordTree.tree.nodes.length, count);
    room.gameLogic.gameOver = false;
    await request(a, { type: 'beginRecordVariations', step: 1 }, 'error');
    await request(a, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 9, col: 9 } }, 'error');
    await request(a, { type: 'deleteRecordVariation', nodeId: fork, recordTreeVersion: room.recordTree.version }, 'error');
    room.gameLogic.gameOver = true;
    const resumed = await connect('weiqi', id);
    await wait(() => resumed.messages.some((m) => m.type === 'recordTree'));
    assert.deepEqual(resumed.messages.find((m) => m.type === 'recordTree').recordNodes, room.recordTree.tree.nodes);
    const extra = room.recordTree.tree.nodes.find((n) => n.move === 'W8,8').id;
    const deleted = await request(a, { type: 'deleteRecordVariation', nodeId: extra, recordTreeVersion: room.recordTree.version }, 'recordTreeUpdated');
    assert.deepEqual(deleted.recordDeleted, [extra]);
    await wait(() => resumed.messages.some((m) => m.type === 'recordTreeUpdated' && m.recordDeleted));
    assert.equal(room.recordTree.tree.nodes[extra], null);
    assert.equal(room.recordTree.tree.nodes[fork].move, 'W6,6', 'unrelated node ids stay stable');
    await request(a, { type: 'deleteRecordVariation', nodeId: extra, recordTreeVersion: imported.recordTreeVersion }, 'error');
    const oldMain = room.recordTree.tree.nodes[1].children[0];
    await request(a, { type: 'deleteRecordVariation', nodeId: oldMain, recordTreeVersion: room.recordTree.version }, 'recordTreeUpdated');
    assert.deepEqual(Tree.path(room.recordTree.tree).moves, ['B2,2', 'W6,6', 'B7,7']);
    assert.equal(room.recordTree.tree.nodes[fork].key, 'main', 'deleting main promotes the next remaining line');
    assert.equal(JSON.stringify(room.gameLogic.board), board);
    const afterDelete = await request(a, { type: 'exportRecord' }, 'gameRecord');
    assert.deepEqual(afterDelete.data.moves, ['B2,2', 'W6,6', { main: ['B7,7'], v1: ['B5,5'] }]);
    await request(a, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 9, col: 9 } }, 'recordVariation');
    assert.ok(room.recordTree.tree.nodes.some((n) => n && n.move === 'W9,9'), 'authoring continues after deletion');
    await request(a, { type: 'deleteRecordVariation', nodeId: 1, recordTreeVersion: room.recordTree.version }, 'recordTreeUpdated');
    assert.deepEqual(room.recordTree.record.moves, []);
    await request(a, { type: 'addRecordVariation', parentId: 0, recordTreeVersion: room.recordTree.version,
        move: { type: 'move', row: 3, col: 3 } }, 'recordVariation');
    assert.deepEqual(room.recordTree.record.moves, ['B3,3'], 'empty analysis tree can be continued after deleting all moves');

    // Travel moves also use the chess variant's original importer and move rules.
    const xid = await create('xiangqi'), x = await connect('xiangqi', xid);
    const xr = { gameId: 'xiangqi', moves: ['R3,0-4,0', { main: ['B6,0-5,0'], v1: ['B6,2-5,2'] }], result: '红胜' };
    await request(x, { type: 'importRecord', data: xr }, 'importSuccess');
    await request(x, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: rooms.xiangqi[xid].recordTree.version,
        move: { type: 'move', fromRow: 6, fromCol: 4, toRow: 5, toCol: 4 } }, 'recordVariation');
    assert.deepEqual(rooms.xiangqi[xid].recordTree.record.moves[1].v2, ['B6,4-5,4']);
    const localId = await create('weiqi'), local = await connect('weiqi', localId);
    const localStarted = await request(local, { type: 'startLocalGame' }, 'localGameStarted');
    await request(local, { type: 'timeControlSubmit', timed: false, colorChoice: 'player1' }, 'timeControlAgreed');
    await request(local, { type: 'move', row: 1, col: 1 }, 'broadcast');
    await request(local, { type: 'move', row: 2, col: 2 }, 'broadcast');
    await request(local, { type: 'resign' }, 'broadcast');
    const localRoom = rooms.weiqi[localId];
    assert.equal(localRoom.recordTree, undefined);
    await request(local, { type: 'beginRecordVariations', step: 0 }, 'recordTree');
    await request(local, { type: 'addRecordVariation', parentId: 0, recordTreeVersion: localRoom.recordTree.version,
        move: { type: 'move', row: 6, col: 6 } }, 'recordVariation');
    assert.deepEqual(localRoom.recordTree.record.moves[0].main, ['B1,1', 'W2,2']);
    local.close();
    await wait(() => !localRoom.localPlay.client);
    const owner = new WS(origin.replace('http', 'ws') + '/qi/ws?game=weiqi&room=' + localId);
    owner.messages = [];
    owner.on('message', (data) => owner.messages.push(JSON.parse(data)));
    await new Promise((r) => owner.once('open', r));
    owner.send(JSON.stringify({ type: 'join', localPlayToken: localStarted.token }));
    await wait(() => owner.messages.some((m) => m.type === 'recordTree'));
    assert.equal(owner.messages.find((m) => m.type === 'recordTree').recordEnded, true);
    await request(owner, { type: 'continueSoloGame' }, 'colorAssigned');
    const koId = await create('greedy-weiqi'), koClient = await connect('greedy-weiqi', koId);
    const koRecord = { format: 'muzei', gameId: 'greedy-weiqi', boardSize: 9,
        initialPosition: ['B1,2', 'B2,1', 'B3,2', 'W2,2', 'W1,3', 'W3,3', 'W2,4'],
        moves: ['B2,3'], result: '黑胜' };
    await request(koClient, { type: 'importRecord', data: koRecord }, 'importSuccess');
    const koRoom = rooms['greedy-weiqi'][koId];
    const koStudy = await request(koClient, { type: 'beginRecordVariations', step: 1 }, 'recordTree');
    assert.deepEqual(koStudy.replayData.recordState.candidates, [], '导入的初始局面参与禁全同');
    await request(koClient, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: koRoom.recordTree.version,
        move: { type: 'move', row: 2, col: 2 } }, 'recordVariationIgnored');
    assert.equal(koRoom.recordTree.tree.nodes.length, 2);
    await request(koClient, { type: 'addRecordVariation', parentId: 1, recordTreeVersion: koRoom.recordTree.version,
        move: { type: 'move', row: 0, col: 0 } }, 'recordVariation');
    assert.deepEqual(koRoom.recordTree.record.moves, ['B2,3', 'W0,0']);
    const invalidKo = await request(koClient, { type: 'importRecord', data: { ...koRecord, moves: ['B2,3', 'W2,2'] } }, 'error');
    assert.match(invalidKo.message, /禁全同/);
    console.log('Passed greedy Go ko filtering, silent illegal recapture, legal continuation and record validation.');
    const promoteRoomId = await create('weiqi'), promoting = await connect('weiqi', promoteRoomId);
    await request(promoting, { type: 'importRecord', data: record }, 'importSuccess');
    const promoteRoom = rooms.weiqi[promoteRoomId], promoteViewer = await connect('weiqi', promoteRoomId);
    const promoteBoard = JSON.stringify(promoteRoom.gameLogic.board);
    const promoteNode = promoteRoom.recordTree.tree.nodes.find((n) => n.move === 'W6,6').id;
    const beforePromotion = promoteRoom.recordTree.version;
    await request(promoting, { type: 'setMainRecordVariation', nodeId: promoteNode,
        recordTreeVersion: beforePromotion }, 'recordTreeUpdated');
    await wait(() => promoteViewer.messages.some((m) => m.recordMainChanged === promoteNode));
    assert.equal(JSON.stringify(promoteRoom.gameLogic.board), promoteBoard);
    assert.deepEqual(Tree.path(promoteRoom.recordTree.tree).moves, ['B2,2', 'W6,6', 'B7,7']);
    const promotedExport = await request(promoting, { type: 'exportRecord' }, 'gameRecord');
    assert.deepEqual(promotedExport.data.moves[1].main, ['W6,6', { main: ['B7,7'], v1: ['B5,5'] }]);
    assert.deepEqual(promotedExport.data.moves[1].v1, ['W3,3', 'B4,4']);
    await request(promoting, { type: 'setMainRecordVariation', nodeId: promoteNode,
        recordTreeVersion: beforePromotion }, 'error');
    const promotionVersion = promoteRoom.recordTree.version;
    await request(promoting, { type: 'setMainRecordVariation', nodeId: promoteNode,
        recordTreeVersion: promotionVersion }, 'recordTreeUpdated');
    assert.equal(promoteRoom.recordTree.version, promotionVersion, 'setting the current main again is a no-op');
    promoteRoom.gameLogic.gameOver = false;
    await request(promoting, { type: 'setMainRecordVariation', nodeId: promoteNode,
        recordTreeVersion: promotionVersion }, 'error');
    promoteRoom.gameLogic.gameOver = true;
    const nestedMain = promoteRoom.recordTree.tree.nodes.find((n) => n.move === 'B5,5').id;
    await request(promoting, { type: 'setMainRecordVariation', nodeId: nestedMain,
        recordTreeVersion: promoteRoom.recordTree.version }, 'recordTreeUpdated');
    assert.deepEqual(Tree.path(promoteRoom.recordTree.tree).moves, ['B2,2', 'W6,6', 'B5,5']);
    const promoteRejoined = await connect('weiqi', promoteRoomId);
    await wait(() => promoteRejoined.messages.some((m) => m.type === 'recordTree'));
    assert.deepEqual(promoteRejoined.messages.find((m) => m.type === 'recordTree').recordTree,
        JSON.parse(JSON.stringify(promoteRoom.recordTree.record.moves)));
    await request(promoting, { type: 'setSideRecordVariation', nodeId: promoteNode,
        recordTreeVersion: promoteRoom.recordTree.version }, 'recordTreeUpdated');
    assert.equal(Object.hasOwn(promoteRoom.recordTree.record.moves[1], 'main'), false);
    const randomBefore = Math.random;
    try {
        for (const [value, whiteRow] of [[0, 6], [.99, 3]]) {
            Math.random = () => value;
            const randomView = await request(promoting, { type: 'selectRecordVariation', nodeId: 0,
                recordTreeVersion: promoteRoom.recordTree.version }, 'recordVariation');
            assert.equal(randomView.replayData.moves[1].row, whiteRow, 'random path and cached replay must agree');
        }
    } finally { Math.random = randomBefore; }
    const remainingSide = promoteRoom.recordTree.tree.nodes.find((n) => n.move === 'W3,3').id;
    await request(promoting, { type: 'deleteRecordVariation', nodeId: remainingSide,
        recordTreeVersion: promoteRoom.recordTree.version }, 'recordTreeUpdated');
    assert.equal(Object.hasOwn(promoteRoom.recordTree.record.moves[1], 'main'), false, 'deleting a side cannot create a main');
    await request(promoting, { type: 'setMainRecordVariation', nodeId: promoteNode,
        recordTreeVersion: promoteRoom.recordTree.version }, 'recordTreeUpdated');
    assert.deepEqual(Tree.path(promoteRoom.recordTree.tree).moves, ['B2,2', 'W6,6', 'B5,5']);
    console.log('Passed main promotion, nested branches, export, multi-viewer sync, stale/ongoing locks and reconnect.');
    console.log('Passed object tree parsing, nested variation replay, main preservation, authoring, reuse, legality, ongoing-game lock, refresh and Xiangqi rules.');

    if (!process.argv.includes('--browser')) return;
    browser = await require('puppeteer-core').launch({ executablePath: process.env.QI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
        protocolTimeout: 30000, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.evaluateOnNewDocument(() => {
        const Native = window.WebSocket;
        window.WebSocket = class extends Native {
            constructor(...args) { super(...args); window.testSocket = this; window.testMessages = [];
                this.addEventListener('message', (e) => window.testMessages.push(JSON.parse(e.data))); }
        };
    });
    const bid = await create('weiqi');
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(origin + '/qi/rooms/' + bid);
    await page.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
    const file = path.join(os.tmpdir(), 'qi-branch-test-' + process.pid + '.json');
    fs.writeFileSync(file, JSON.stringify(record));
    await (await page.$('#importFileInput')).uploadFile(file);
    await page.waitForFunction(() => document.getElementById('replaySlider').max === '3');
    async function step(value) {
        await page.$eval('#replaySlider', (e, value) => { e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    }
    await step(0);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 1);
    assert.equal(await page.$eval('.record-variation-point', (e) => e.classList.contains('is-main')), true);
    await step(1);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    assert.equal(await page.$('#recordVariationBar'), null);
    const ringStyles = await page.$$eval('.record-variation-point', (els) => els.map((e) => ({
        main: e.classList.contains('is-main'), border: getComputedStyle(e).borderColor, shadow: getComputedStyle(e).boxShadow
    })));
    assert.equal(ringStyles.find((e) => e.main).border, 'rgb(255, 255, 255)');
    assert.equal(ringStyles.find((e) => !e.main).border, 'rgb(186, 101, 22)');
    assert.ok(ringStyles.every((e) => e.shadow === 'none'));
    await page.hover('.record-variation-point.is-main');
    const ringHover = await page.$eval('.record-variation-point.is-main', (e) => ({
        color: getComputedStyle(e, '::before').backgroundColor, outline: getComputedStyle(e).outlineStyle,
        previewWidth: parseFloat(getComputedStyle(e, '::before').width), ringWidth: e.getBoundingClientRect().width
    }));
    assert.equal(ringHover.color, 'rgb(255, 255, 255)');
    assert.equal(ringHover.outline, 'none');
    assert.ok(ringHover.previewWidth > ringHover.ringWidth, 'hover uses the normal stone diameter');
    await page.click('.record-variation-point[data-row="6"][data-col="6"]');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '2' && document.querySelector('.record-variation-point[data-row="5"]'));
    await page.click('.record-variation-point[data-row="5"][data-col="5"]');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '3');
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.getElementById('addRecordVariationBtn').textContent === '结束添加');
    const canvasRect = await page.$eval('#goBoard', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    // Same coordinate geometry as the existing square Go board.
    const geometry = await page.evaluate(() => QiSquareWeiqiCanvas.computePaddingAndCell(13));
    await page.mouse.move(canvasRect.x + (geometry.padding + 8 * geometry.cellSize) / 600 * canvasRect.width,
        canvasRect.y + (geometry.padding + 4 * geometry.cellSize) / 600 * canvasRect.height);
    await page.waitForFunction(() => !document.querySelector('.record-variation-hover').hidden);
    assert.equal(await page.$eval('.record-variation-hover', (e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
    await page.mouse.click(canvasRect.x + (geometry.padding + 8 * geometry.cellSize) / 600 * canvasRect.width,
        canvasRect.y + (geometry.padding + 4 * geometry.cellSize) / 600 * canvasRect.height);
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '4');
    assert.deepEqual(rooms.weiqi[bid].recordTree.record.moves[1].v1[1].v1, ['B5,5', 'W8,8'], 'canvas continuation stays on chosen nested branch');
    assert.equal(JSON.stringify(rooms.weiqi[bid].gameLogic.board), board);
    await page.evaluate(() => { window.testAlerts = 0; const alert = window.qiAlert;
        window.qiAlert = (...args) => { window.testAlerts++; return alert(...args); }; });
    const ignoreCount = await page.evaluate(() => window.testMessages.filter((m) => m.type === 'recordVariationIgnored').length);
    const versionBeforeInvalid = rooms.weiqi[bid].recordTree.version;
    await page.mouse.click(canvasRect.x + (geometry.padding + 2 * geometry.cellSize) / 600 * canvasRect.width,
        canvasRect.y + (geometry.padding + 10 * geometry.cellSize) / 600 * canvasRect.height);
    await page.waitForFunction((n) => window.testMessages.filter((m) => m.type === 'recordVariationIgnored').length > n, {}, ignoreCount);
    assert.equal(await page.evaluate(() => window.testAlerts), 0);
    assert.equal(rooms.weiqi[bid].recordTree.version, versionBeforeInvalid);
    assert.equal(await page.$eval('#replaySlider', (e) => e.value), '4');
    await page.click('#addRecordVariationBtn');
    await page.reload();
    await page.waitForFunction(() => window.testMessages.some((m) => m.type === 'recordVariation') && document.getElementById('replaySlider').value === '4');
    await step(1);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    await page.screenshot({ path: path.join(os.tmpdir(), 'qi-record-branches.png') });
    await page.setViewport({ width: 375, height: 812 });
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    const rings = await page.$$eval('.record-variation-point', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }));
    assert.ok(rings.every((r) => r.x >= 0 && r.x + r.width <= 375));
    assert.deepEqual(errors, []);
    console.log('Passed actual JSON upload, circular choices, nested selection, canvas authoring, reload and mobile positioning.');

    // Another viewer stays on the branch being deleted and must return to its fork.
    const viewer = await browser.newPage();
    await viewer.bringToFront();
    await viewer.goto(origin + '/qi/rooms/' + bid);
    await viewer.waitForFunction(() => document.getElementById('replaySlider').max === '3');
    await viewer.$eval('#replaySlider', (e) => { e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await viewer.waitForSelector('.record-variation-point[data-row="6"]');
    await viewer.click('.record-variation-point[data-row="6"]');
    await viewer.waitForFunction(() => document.getElementById('replaySlider').value === '2');
    await page.bringToFront();
    await page.click('.record-variation-point[data-row="3"]', { button: 'right' });
    assert.equal(await page.$eval('#setMainRecordVariationBtn', (e) => e.hidden), true);
    await page.click('.record-variation-point[data-row="6"]', { button: 'right' });
    assert.equal(await page.$eval('#setMainRecordVariationBtn', (e) => e.hidden), false);
    await page.click('#setMainRecordVariationBtn');
    await page.waitForFunction(() => document.querySelector('.record-variation-point.is-main[data-row="6"]')
        && !document.querySelector('#addRecordVariationBtn').disabled);
    assert.equal(await page.$eval('#replaySlider', (e) => e.value), '1');
    assert.equal(rooms.weiqi[bid].recordTree.record.moves[1].main[0], 'W6,6');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.record-variation-point.is-main[data-row="6"]'));
    await page.click('.record-variation-point[data-row="3"]', { button: 'right' });
    await page.click('#setMainRecordVariationBtn');
    await page.waitForFunction(() => document.querySelector('.record-variation-point.is-main[data-row="3"]')
        && !document.querySelector('#addRecordVariationBtn').disabled);
    await page.click('.record-variation-point.is-main', { button: 'right' });
    assert.equal(await page.$eval('#setSideRecordVariationBtn', (e) => e.hidden), false);
    await page.click('#setSideRecordVariationBtn');
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2
        && document.querySelectorAll('.record-variation-point.is-main').length === 0
        && !document.querySelector('#addRecordVariationBtn').disabled);
    assert.equal(Object.hasOwn(rooms.weiqi[bid].recordTree.record.moves[1], 'main'), false);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2
        && document.querySelectorAll('.record-variation-point.is-main').length === 0);
    await page.click('.record-variation-point[data-row="3"]', { button: 'right' });
    await page.click('#setMainRecordVariationBtn');
    await page.waitForFunction(() => document.querySelector('.record-variation-point.is-main[data-row="3"]')
        && !document.querySelector('#addRecordVariationBtn').disabled);
    await page.click('.record-variation-point[data-row="6"]', { button: 'right' });
    await page.waitForFunction(() => !document.getElementById('recordVariationContextMenu').hidden);
    assert.equal(await page.$eval('#replaySlider', (e) => e.value), '1', 'right click does not select a branch');
    await page.click('#recordVariationContextMenu button');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '1'
        && document.getElementById('replaySlider').max === '3' && document.querySelectorAll('.record-variation-point').length === 1);
    await viewer.waitForFunction(() => document.getElementById('replaySlider').value === '1' && document.getElementById('replaySlider').max === '3', { polling: 100 });
    assert.deepEqual(rooms.weiqi[bid].recordTree.record.moves, ['B2,2', 'W3,3', 'B4,4']);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('replaySlider').max === '3' && document.getElementById('replaySlider').value === '1');
    await viewer.close();
    console.log('Passed ring colors, authoring hover, silent invalid moves, context deletion, other-viewer recovery and refresh.');

    const choiceId = await create('choice-weiqi');
    await page.goto(origin + '/qi/rooms/' + choiceId);
    await page.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
    const cr = { gameId: 'choice-weiqi', boardSize: 9, result: '黑胜', moves: [{ main: ['B1,1@1,1;3,3'], v1: ['B3,3@1,1;3,3'] }] };
    await page.evaluate((data) => window.testSocket.send(JSON.stringify({ type: 'importRecord', data })), cr);
    await page.waitForFunction(() => document.getElementById('replaySlider').max === '2');
    await step(0);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    assert.equal(await page.$eval('.record-variation-point.is-main', (e) => getComputedStyle(e).borderColor), 'rgb(34, 34, 34)');
    const ringSize = await page.$eval('.record-variation-point', (e) => e.getBoundingClientRect().width);
    const choiceRect = await page.$eval('#goBoard', (e) => e.getBoundingClientRect().width);
    const cell = await page.evaluate(() => QiSquareWeiqiCanvas.computePaddingAndCell(9).cellSize);
    assert.ok(ringSize > Math.SQRT2 * cell * .36 / 600 * choiceRect, 'circle encloses the candidate square');
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.getElementById('addRecordVariationBtn').textContent === '结束添加');
    const choiceRoom = rooms['choice-weiqi'][choiceId];
    const choiceCount = choiceRoom.recordTree.tree.nodes.length;
    await page.click('.record-variation-point[data-row="3"]');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '2');
    assert.equal(choiceRoom.recordTree.tree.nodes.length, choiceCount);
    const nextCandidate = await page.evaluate(() => window.testMessages.filter((m) => m.type === 'recordVariation').at(-1).replayData.recordState.candidates[0]);
    const choiceGeometry = await page.evaluate(() => QiSquareWeiqiCanvas.computePaddingAndCell(9));
    const choiceCanvas = await page.$eval('#goBoard', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    await page.mouse.click(choiceCanvas.left + (choiceGeometry.padding + nextCandidate.col * choiceGeometry.cellSize) / 600 * choiceCanvas.width,
        choiceCanvas.top + (choiceGeometry.padding + (8 - nextCandidate.row) * choiceGeometry.cellSize) / 600 * choiceCanvas.height);
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '4');
    assert.equal(choiceRoom.recordTree.record.moves[0].v1.length, 2);
    console.log('Passed choice Go candidate snapshots, circle sizing and branch selection during editing.');

    const rid = await create('reversi');
    await page.goto(origin + '/qi/rooms/' + rid);
    await page.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
    const rr = { gameId: 'reversi', boardSize: 8, result: '黑胜', moves: [{ main: ['B2,4'], v1: ['B3,5'] }] };
    await page.evaluate((data) => window.testSocket.send(JSON.stringify({ type: 'importRecord', data })), rr);
    await page.waitForFunction(() => document.getElementById('replaySlider').max === '1');
    await step(0);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    await page.click('.record-variation-point[data-row="3"]');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '1');
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.getElementById('addRecordVariationBtn').textContent === '结束添加');
    assert.deepEqual(errors, []);
    console.log('Passed Reversi independent replay adapter and ended-game authoring availability while browsing early positions.');

    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(origin + '/qi/rooms/' + xid);
    await page.waitForFunction(() => window.testMessages.some((m) => m.type === 'recordTree'));
    await step(1);
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 3);
    const travelPoint = await page.$eval('.record-variation-point[data-row="5"][data-col="4"]', (e) => {
        const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cell: r.width / .76 };
    });
    await page.click('.record-variation-point[data-row="5"][data-col="4"]');
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '2');
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.getElementById('addRecordVariationBtn').textContent === '结束添加');
    await page.mouse.click(travelPoint.x - 2 * travelPoint.cell, travelPoint.y + 2 * travelPoint.cell);
    await page.mouse.move(travelPoint.x - 2 * travelPoint.cell, travelPoint.y + travelPoint.cell);
    await page.waitForFunction(() => !document.querySelector('.record-variation-hover').hidden);
    assert.equal(await page.$eval('.record-variation-hover', (e) => getComputedStyle(e).backgroundColor), 'rgb(147, 44, 19)');
    await page.mouse.click(travelPoint.x - 2 * travelPoint.cell, travelPoint.y + travelPoint.cell);
    await page.waitForFunction(() => document.getElementById('replaySlider').value === '3');
    assert.deepEqual(rooms.xiangqi[xid].recordTree.record.moves[1].v2, ['B6,4-5,4', 'R3,2-4,2']);
    assert.deepEqual(errors, []);
    console.log('Passed actual Xiangqi source/target clicks and continuation on the selected variation.');

    const greedyId = await create('greedy-weiqi');
    await page.goto(origin + '/qi/rooms/' + greedyId);
    await page.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
    await page.evaluate((data) => window.testSocket.send(JSON.stringify({ type: 'importRecord', data })), { ...record, gameId: 'greedy-weiqi' });
    await page.waitForFunction(() => document.getElementById('replaySlider').max === '3');
    await step(0);
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.getElementById('addRecordVariationBtn').textContent === '结束添加');
    const greedyCanvas = await page.$eval('#goBoard', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width }; });
    await page.mouse.move(greedyCanvas.x + geometry.padding / 600 * greedyCanvas.width,
        greedyCanvas.y + geometry.padding / 600 * greedyCanvas.width);
    await page.waitForFunction(() => !document.querySelector('.record-variation-hover').hidden);
    assert.equal(await page.$eval('.record-variation-hover', (e) => getComputedStyle(e).backgroundColor), 'rgb(34, 34, 34)');
    assert.deepEqual(errors, []);
    console.log('Passed greedy Go authoring hover when no capture is required.');

    if (process.argv.includes('--all-pages')) {
        let pages = 0;
        for (const game of require('../public/game-catalog').games.filter((g) => g.enabled)) {
            const currentId = await create(game.id);
            await page.goto(origin + '/qi/rooms/' + currentId);
            await page.waitForFunction(() => window.QiRoomGameSwitcher.canChangeSettings(), { polling: 100 });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.deepEqual(errors, [], game.id + ' initializes with the record controller');
            pages++;
        }
        console.log('Passed browser initialization for ' + pages + ' chess types.');
    }
}
main().then(() => finish(0)).catch((error) => { console.error(error); finish(1); });
async function finish(code) {
    if (browser) await browser.close();
    for (const group of Object.values(rooms)) for (const room of Object.values(group)) disposeRoom(room);
    for (const client of wss.clients) client.terminate();
    Server_.close(); process.exit(code);
}
