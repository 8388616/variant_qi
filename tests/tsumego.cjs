// node tests/tsumego.cjs [--all-pages]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const compiled = new Module(path.join(root, 'tsumego-check.js'), module);
compiled.filename = path.join(root, 'tsumego-check.js'); compiled.paths = Module._nodeModulePaths(root);
compiled._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8').replace('const PORT = 3100;', 'const PORT = 0;') +
    '\nmodule.exports = { Server_, wss, rooms };', compiled.filename);
const { Server_, wss, rooms } = compiled.exports;
let browser;
const fixture = path.join(root, 'public', 'tsumego', 'zz-test-' + process.pid + '.json');
const base = { format: 'muzei-tsumego', version: 2, gameId: 'weiqi', gameType: '围棋', boardSize: 9, komi: null,
    initialPosition: [], moves: ['B1,1', { main: ['W2,2', 'B3,3', 'success'], v1: ['W2,3', 'B3,4', 'success'] }] };
async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    fs.writeFileSync(fixture, JSON.stringify(base));
    const Tree = require('../public/record-tree');
    const tree = Tree.parse(base.moves, { terminals: true });
    assert.deepEqual(JSON.parse(JSON.stringify(Tree.serialize(tree))), base.moves);
    assert.deepEqual(Tree.path(tree).moves, ['B1,1', 'W2,2', 'B3,3']);
    assert.throws(() => Tree.parse(['success', 'B1,1'], { terminals: true }));
    const catalog = require('../public/game-catalog').games.filter((g) => g.enabled);
    for (const g of catalog) assert.ok(require('../qi-tsumego-bundle').bundle(g.id).includes('QiTsumegoRules'), g.id);
    browser = await require('puppeteer-core').launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
        args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage(); const errors = [], requests = [];
    await page.evaluateOnNewDocument(() => {
        let client;
        Object.defineProperty(window, 'QiBoardRoomClient', { configurable: true, get: () => client, set(value) {
            client = value;
            const create = value.createWeiqiMessageBindings;
            value.createWeiqiMessageBindings = function (context) {
                window.testBoardContext = context;
                return create.apply(this, arguments);
            };
        } });
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', async (message) => {
        if (message.type() === 'error') for (const argument of message.args()) {
            const stack = await argument.evaluate((value) => value?.stack).catch(() => null);
            if (stack) console.error(stack);
        }
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => { requests.push(r.url()); r.url().startsWith(origin) ? r.continue() : r.abort(); });
    await page.setViewport({ width: 1280, height: 900 });
    async function loaded() { await page.waitForFunction(() => window.QiTsumego?.getRoom()?.gameLogic
        && typeof window.__qiCanChangeRoomSettings === 'boolean', { timeout: 15000 }); }
    async function answered(message = '答对了。') {
        await page.waitForFunction((message) => document.querySelector('.qi-room-msg-modal')?.getAttribute('aria-hidden') === 'false'
            && document.querySelector('#qiRoomMsgText')?.textContent === message, {}, message);
        assert.equal(await page.$eval('#tsumegoStatus', (e) => e.textContent), '', '结果改由消息框显示');
        await page.click('#qiRoomMsgOk');
        await page.waitForFunction(() => document.querySelector('.qi-room-msg-modal').getAttribute('aria-hidden') === 'true');
    }
    async function point(row, col) {
        const p = await page.evaluate(({ row, col }) => {
            const rect = document.querySelector('#goBoard').getBoundingClientRect();
            const size = QiTsumego.getRoom().gameLogic.boardSize || QiTsumego.getRoom().gameLogic.BOARD_SIZE;
            const geometry = QiSquareWeiqiCanvas.computePaddingAndCell(size);
            return { x: rect.left + (geometry.padding + col * geometry.cellSize) / 600 * rect.width,
                y: rect.top + (geometry.padding + (size - 1 - row) * geometry.cellSize) / 600 * rect.height };
        }, { row, col });
        await page.mouse.click(p.x, p.y);
    }
    async function upload(data) {
        await page.$eval('#importFileInput', (el, data) => {
            const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(data)], 'test.json', { type: 'application/json' }));
            el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true }));
        }, data);
    }
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    assert.equal(await page.$('#tsumegoQuestionInfo'), null);
    assert.equal(await page.$('.button-panel #tsumegoPreviousBtn'), null);
    assert.equal(await page.$('.button-panel #tsumegoNextBtn'), null);
    assert.equal(await page.$eval('#turnDisplay', (e) => e.textContent), '第1题');
    const navLayout = await page.evaluate(() => {
        const turn = document.querySelector('#turnDisplay').getBoundingClientRect();
        const prev = document.querySelector('#tsumegoPreviousBtn').getBoundingClientRect();
        const next = document.querySelector('#tsumegoNextBtn').getBoundingClientRect();
        return prev.top >= turn.bottom && Math.abs(prev.top - next.top) < 1 && prev.right <= next.left;
    });
    assert.equal(navLayout, true, '题号下面的上一题和下一题应在同一行，分别位于左侧和右侧');
    assert.equal(await page.$eval('#tsumegoStatus', (e) => e.textContent), '', '作答时不显示请落子');
    assert.notEqual(await page.$eval('#importBtn', (e) => getComputedStyle(e).display), 'none');
    assert.equal(await page.$eval('#boardSizeSelect', (e) => e.disabled), true);
    assert.equal(await page.$eval('#komiInfo', (e) => getComputedStyle(e).display), 'none');
    await point(1, 2);
    await answered();
    assert.equal(await page.$eval('#turnDisplay', (e) => e.textContent), '第1题', '落子后保留题号');
    await page.click('#undoBtn');
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 0);
    await point(3, 4);
    await answered('答错了。');
    await page.click('#newGameBtn');
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 0 && document.querySelector('#tsumegoStatus').textContent === '');
    const filenames = await fetch(origin + '/qi/tsumego-files').then((r) => r.json());
    assert.deepEqual(filenames, [...filenames].sort((a, b) => a.localeCompare(b, 'zh-Hans', { numeric: true })));
    assert.equal(filenames[0], '001-example.json');
    await page.evaluate(() => { window.testQuestionDocument = document; window.testQuestionCanvas = document.querySelector('#goBoard'); });
    async function switchQuestion(button, expectedIndex) {
        await page.click(button);
        await page.waitForFunction((i) => Number(new URLSearchParams(location.search).get('index')) === i
            && !document.querySelector('#tsumegoNextBtn').disabled, {}, expectedIndex);
        assert.equal(await page.evaluate(() => document === window.testQuestionDocument
            && document.querySelector('#goBoard') === window.testQuestionCanvas), true, '同棋类切题保留文档和棋盘');
    }
    await switchQuestion('#tsumegoPreviousBtn', filenames.length - 1); await loaded();
    const count = filenames.length;
    assert.equal(await page.$eval('#turnDisplay', (e) => e.textContent), '第' + count + '题');
    await switchQuestion('#tsumegoNextBtn', 0); await loaded();
    assert.equal(await page.$eval('#turnDisplay', (e) => e.textContent), '第1题');
    await switchQuestion('#tsumegoPreviousBtn', filenames.length - 1); await loaded();
    await point(1, 1);
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
    const reply = await page.evaluate(() => QiTsumego.getRoom().gameLogic.moveCoords[1]);
    await point(3, reply.col === 2 ? 3 : 4);
    await answered();
    await page.click('#undoBtn'); await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
    await page.click('#undoBtn'); await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 0);
    await upload({ ...base, firstPlayer: 'white', komi: 2, moves: ['W1,1', 'B2,2', 'W3,3', 'success'] });
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.currentPlayer === 2);
    assert.equal(await page.evaluate(() => QiTsumego.getFirstPlayer()), 'white');
    assert.equal(await page.evaluate(() => QiTsumego.getPlayerSlot()), 'player2');
    assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.exportRecord().firstPlayer), 'white');
    for (const firstPlayer of ['player1', 'player2']) {
        await upload({ ...base, firstPlayer });
        await page.waitForFunction(() => document.querySelector('#tsumegoStatus').textContent.startsWith('导入失败'));
        assert.equal(await page.evaluate(() => QiTsumego.getFirstPlayer()), 'white', '不接受旧的 firstPlayer 值');
    }
    await point(1, 1); await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
    assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.board[1][1]), 2);
    await point(3, 3); await answered();
    assert.equal(await page.$eval('#tsumegoCreateBtn', (e) => e.textContent), '创作题目');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    assert.equal(await page.$eval('#boardSizeSelect', (e) => e.disabled), false);
    assert.equal(await page.$eval('#tsumegoCreateBtn', (e) => e.textContent), '退出创作');
    assert.equal(await page.evaluate(() => document.querySelector('.button-panel').lastElementChild.id), 'tsumegoCreateBtn');
    assert.equal(await page.$eval('#tsumegoWrongBtn', (e) => e.nextElementSibling.id), 'tsumegoCreateBtn');
    for (const id of ['tsumegoPreviousBtn', 'tsumegoNextBtn']) assert.equal(await page.$eval('#' + id, (e) => e.disabled), true);
    const inputStyles = await page.evaluate(() => ['boardSizeSelect', 'tsumegoFirstPlayer', 'tsumegoTitle'].map((id) => {
        const style = getComputedStyle(document.getElementById(id));
        return { color: style.color, background: style.backgroundColor, radius: style.borderRadius, font: style.fontFamily };
    }));
    assert.deepEqual(inputStyles[1], inputStyles[0], '先手选项沿用房间下拉样式');
    assert.deepEqual(inputStyles[2], inputStyles[0], '标题输入框沿用页面颜色、圆角和字体');
    // 创建模式可直接编辑答案，不需要先进入普通房间的回放分支模式。
    await point(4, 4);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree?.tree.nodes.length === 2, { timeout: 3000 });
    await point(4, 5);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 3);
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), [{ v1: ['W4,4', 'B4,5', 'success'] }]);
    // 白先题的黑方应手使用普通棋谱配色，即使这条路径有正确答案也不显示绿圈。
    await page.$eval('#replaySlider', (e) => { e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForSelector('.record-variation-point[data-row="4"][data-col="5"]');
    assert.equal(await page.$eval('.record-variation-point[data-col="5"]', (e) => getComputedStyle(e).borderColor), 'rgb(34, 34, 34)');
    await point(4, 6);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 4);
    await page.click('#tsumegoCorrectBtn');
    await page.$eval('#replaySlider', (e) => { e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForSelector('.record-variation-point[data-col="6"]');
    assert.equal(await page.$eval('.record-variation-point[data-col="5"]', (e) => getComputedStyle(e).borderColor), 'rgb(34, 34, 34)');
    assert.equal(await page.$eval('.record-variation-point[data-col="6"]', (e) => getComputedStyle(e).borderColor), 'rgb(186, 101, 22)');
    await page.click('.record-variation-point[data-col="6"]', { button: 'right' });
    await page.click('#deleteRecordVariationBtn');
    await page.waitForFunction(() => QiTsumego.getRecord().moves[0].v1[1] === 'B4,5'
        && !document.querySelector('#addRecordVariationBtn').disabled);
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), [{ v1: ['W4,4', 'B4,5', 'success'] }]);
    await page.$eval('#replaySlider', (e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await point(5, 5);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.root.children.length === 2);
    await page.click('#tsumegoWrongBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('failure'));
    await page.$eval('#replaySlider', (e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForSelector('.record-variation-point[data-row="5"]');
    assert.equal(await page.$('.record-variation-point.is-main'), null, '玩家方的初始答案均默认是支线');
    assert.equal(await page.$eval('.record-variation-point[data-row="4"]', (e) => getComputedStyle(e).borderColor), 'rgb(40, 122, 61)');
    assert.equal(await page.$eval('.record-variation-point[data-row="5"]', (e) => getComputedStyle(e).borderColor), 'rgb(198, 40, 40)');
    const versionBeforePromotion = await page.evaluate(() => QiTsumego.getRoom().recordTree.version);
    await page.click('.record-variation-point[data-row="5"]', { button: 'right' });
    await page.click('#setMainRecordVariationBtn');
    await page.waitForFunction(() => QiTsumego.getRecord().moves[0].main[0] === 'W5,5'
        && !document.querySelector('#addRecordVariationBtn').disabled);
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves[0].main), ['W5,5', 'failure']);
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves[0].v1), ['W4,4', 'B4,5', 'success']);
    assert.ok(await page.evaluate(() => QiTsumego.getRoom().recordTree.version) > versionBeforePromotion,
        '设置答案结果后再设置主线仍须递增版本');
    await page.reload(); await loaded();
    await page.waitForSelector('.record-variation-point.is-main[data-row="5"]');
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves[0].main), ['W5,5', 'failure']);
    await page.click('.record-variation-point.is-main[data-row="5"]', { button: 'right' });
    await page.click('#setSideRecordVariationBtn');
    await page.waitForFunction(() => !Object.hasOwn(QiTsumego.getRecord().moves[0], 'main')
        && document.querySelectorAll('.record-variation-point.is-main').length === 0
        && !document.querySelector('#addRecordVariationBtn').disabled);
    const noMainAnswers = await page.evaluate(() => QiTsumego.getRecord().moves);
    assert.deepEqual(Object.keys(noMainAnswers[0]).sort(), ['v1', 'v2']);
    await page.reload(); await loaded();
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), noMainAnswers);
    assert.equal(await page.$('.record-variation-point.is-main'), null);
    await page.select('#boardSizeSelect', '13');
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.boardSize === 13);
    await page.click('#editModeCheckbox');
    await page.waitForFunction(() => !document.querySelector('#confirmEditBtn').classList.contains('hidden'));
    await page.$eval('#editToolSelect', (e) => { e.value = 'black'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await point(0, 0); await page.click('#confirmEditBtn');
    await page.waitForFunction(() => QiTsumego.getRecord().initialPosition.includes('B0,0'));
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.querySelector('#addRecordVariationBtn').textContent === '结束添加');
    await point(4, 4);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree?.tree.nodes.length === 2);
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    await page.$eval('#replaySlider', (e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#addRecordVariationBtn');
    await page.waitForFunction(() => document.querySelector('#addRecordVariationBtn').textContent === '结束添加');
    await point(5, 5);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.root.children.length === 2);
    await page.click('#tsumegoWrongBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('failure'));
    await page.$eval('#replaySlider', (e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 2);
    await page.click('.record-variation-point[data-row="5"]', { button: 'right' });
    await page.click('#recordVariationContextMenu button');
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.root.children.length === 1);
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), [{ v1: ['W4,4', 'success'] }]);
    await page.reload(); await loaded();
    assert.ok(JSON.stringify(await page.evaluate(() => QiTsumego.getRecord().moves)).includes('success'));
    await page.click('#editModeCheckbox');
    await page.waitForFunction(() => !document.querySelector('#confirmEditBtn').classList.contains('hidden'));
    await page.$eval('#editToolSelect', (e) => { e.value = 'black'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await point(0, 1); await page.click('#confirmEditBtn');
    await page.waitForFunction(() => QiTsumego.getRecord().initialPosition.includes('B0,1'));
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), [{ v1: ['W4,4', 'success'] }]);
    await page.$eval('#replaySlider', (e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelectorAll('.record-variation-point').length === 1);
    assert.equal(await page.$eval('.record-variation-point', (e) => e.classList.contains('is-main')), false);
    assert.equal(Object.keys(rooms).length, 0, 'puzzles must never create server rooms');
    assert.ok(!requests.some((url) => /chat-messages|katago-available|\/qi\/rooms/.test(url)), 'no room/engine/chat requests');
    assert.deepEqual(errors, []);
    for (const gameId of ['ukrainian-weiqi', 'various-liberty-weiqi']) {
        await page.evaluate((gameId) => sessionStorage.setItem('qiTsumegoDraft', JSON.stringify({ format: 'muzei-tsumego', gameId,
            gameType: gameId, boardSize: 9, firstPlayer: 'black', komi: null, moves: [] })), gameId);
        await page.goto(origin + '/qi/tsumego-view?game=' + gameId + '&mode=author'); await loaded();
        await page.click('#addRecordVariationBtn');
        await page.waitForFunction(() => document.querySelector('#addRecordVariationBtn').textContent === '结束添加');
        await point(4, 4); await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 2);
        await page.click('#tsumegoCorrectBtn'); await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
        await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
        await point(4, 4);
        await answered();
        assert.deepEqual(errors, [], gameId + ' authoring forwards its shape/level selection');
    }
    await page.evaluate(() => sessionStorage.setItem('qiTsumegoDraft', JSON.stringify({ format: 'muzei-tsumego', gameId: 'caturanga', gameType: '国际象棋', moves: [], komi: null })));
    await page.goto(origin + '/qi/tsumego-view?game=caturanga&mode=author'); await loaded();
    assert.equal(await page.evaluate(() => QiTsumego.getRecord().gameId), 'caturanga', 'gameId takes precedence over legacy shared gameType');
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    const xiangqi = { format: 'muzei-tsumego', gameId: 'xiangqi', gameType: '象棋', firstPlayer: 'black', komi: null,
        initialPosition: ['rk0,4', 'bk9,4', 'rp3,4', 'rr0,0', 'bp6,0'], moves: ['B6,0-5,0', 'success'] };
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload(xiangqi)]); await loaded();
    async function xpoint(row, col, flipped) {
        const p = await page.$eval('#goBoard', (e, args) => {
            const [row, col, flipped] = args, r = e.getBoundingClientRect();
            const cell = Math.min(e.width / 9.24, e.height / 10.72), ox = (e.width - 8 * cell) / 2, oy = (e.height - 9 * cell) / 2;
            return { x: r.left + (ox + (flipped ? 8 - col : col) * cell) / e.width * r.width,
                y: r.top + (oy + (flipped ? row : 9 - row) * cell) / e.height * r.height };
        }, [row, col, flipped]);
        await page.mouse.click(p.x, p.y);
    }
    assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.getState().sideToMove), 'black');
    await xpoint(6, 0, true); await xpoint(5, 0, true);
    await answered();
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    await xpoint(6, 0, false); await xpoint(5, 0, false);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 2);
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().initialPosition), ['rr0,0', 'rk0,4', 'rp3,4', 'bp6,0', 'bk9,4']);
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'qi-tsumego-preview.png') });
    assert.deepEqual(errors, []);
    // 红黑双方与内部的 player1/player2 分开：红先应由红车落子。
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    await upload({ ...xiangqi, firstPlayer: 'red', moves: ['R0,0-1,0', 'success'] });
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.getState().sideToMove === 'red');
    assert.equal(await page.evaluate(() => QiTsumego.getPlayerSlot()), 'player1');
    await xpoint(0, 0, false); await xpoint(1, 0, false); await answered();
    async function travelPoint(row, col) {
        const p = await page.evaluate(({ row, col }) => {
            const rect = document.querySelector('#goBoard').getBoundingClientRect();
            const point = testBoardContext.recordPointToCanvas(row, col);
            return { x: rect.left + point.x / point.size * rect.width, y: rect.top + point.y / point.size * rect.height };
        }, { row, col });
        await page.mouse.click(p.x, p.y);
    }
    // 朝鲜将棋内部红/黑棋子的命名与界面蓝/红不同，也应按界面的颜色值落子。
    const janggi = { format: 'muzei-tsumego', gameId: 'janggi', gameType: '朝鲜将棋', komi: null };
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload({ ...janggi,
        firstPlayer: 'blue', moves: ['L3,0-4,0', 'success'] })]); await loaded();
    assert.equal(await page.evaluate(() => QiTsumego.getFirstPlayer()), 'blue');
    assert.equal(await page.evaluate(() => QiTsumego.getPlayerSlot()), 'player1');
    await travelPoint(3, 0); await travelPoint(4, 0); await answered();
    await upload({ ...janggi, firstPlayer: 'red', moves: ['R6,0-5,0', 'success'] });
    await page.waitForFunction(() => QiTsumego.getFirstPlayer() === 'red' && QiTsumego.getPlayerSlot() === 'player2');
    await travelPoint(6, 0); await travelPoint(5, 0); await answered();
    // 四色围棋：firstPlayer 不仅选座位，也必须选择实际的首手棋子颜色。
    for (const [firstPlayer, prefix, slot, color] of [['blue', 'L', 'player1', 4], ['red', 'R', 'player2', 3]]) {
        const data = { ...base, gameId: 'duo-quadricolour-weiqi', gameType: '双人四色围棋', firstPlayer,
            moves: [prefix + '1,1', 'success'] };
        if (await page.evaluate(() => QiTsumego.getRecord().gameId) !== data.gameId) {
            await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload(data)]); await loaded();
        } else {
            await upload(data);
            await page.waitForFunction((color) => QiTsumego.getRoom().gameLogic.turnColor === color, {}, color);
        }
        assert.equal(await page.evaluate(() => QiTsumego.getPlayerSlot()), slot);
        assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.turnColor), color);
        await point(1, 1); await answered();
        assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.board[1][1]), color);
    }
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload({ ...base, gameId: 'sync-weiqi', gameType: '同步围棋',
        firstPlayer: 'white', moves: ['B2,2W1,11', 'success'] })]); await loaded();
    await point(1, 1); await answered();
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    await point(3, 3); await point(4, 4);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 2);
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    assert.equal(await page.evaluate(() => QiTsumego.getRecord().moves[0].v1[0]), 'B4,4W3,31');
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload({ ...base, gameId: 'guess-wuziqi', gameType: '猜点五子棋',
        firstPlayer: 'white', moves: ['W1,1;2,2;3,3|1,1|2,2', 'success'] })]); await loaded();
    await point(1, 1); await answered();
    assert.deepEqual(errors, []);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    await point(1, 1); await point(1, 1);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 2);
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    assert.match(await page.evaluate(() => QiTsumego.getRecord().moves[0].v1[0]), /^W.*\|1,1\|1,1$/);
    const greedyKo = { ...base, gameId: 'greedy-weiqi', gameType: '贪吃围棋', firstPlayer: 'black',
        initialPosition: ['B1,2', 'B2,1', 'B3,2', 'W2,2', 'W1,3', 'W3,3', 'W2,4'], moves: [] };
    await page.evaluate((data) => sessionStorage.setItem('qiTsumegoDraft', JSON.stringify(data)), greedyKo);
    await page.goto(origin + '/qi/tsumego-view?game=greedy-weiqi&mode=author'); await loaded();
    await point(2, 3);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree?.tree.nodes.length === 2);
    assert.deepEqual(await page.evaluate(() => testBoardContext.pageState.candidates), [], '禁全同的回提点不能成为强制提子候选点');
    await point(2, 2); // 立即回提无效，但编辑仍可以继续。
    await page.waitForFunction(() => !document.querySelector('#addRecordVariationBtn').disabled);
    assert.equal(await page.evaluate(() => QiTsumego.getRoom().recordTree.tree.nodes.length), 2);
    await point(0, 0);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 3);
    assert.equal(await page.evaluate(() => testBoardContext.getBoard()[0][0]), 2, '禁全同后应能在别处落子并正常显示');
    await point(8, 8);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes.length === 4);
    assert.deepEqual(await page.evaluate(() => testBoardContext.pageState.candidates), [{ row: 2, col: 2 }], '盘面变化后合法回提仍是候选点');
    await page.click('#tsumegoCorrectBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    assert.deepEqual(await page.evaluate(() => QiTsumego.getRecord().moves), [{ v1: ['B2,3', 'W0,0', { v1: ['B8,8', 'success'] }] }]);
    await page.$eval('#replaySlider', (e) => { e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.deepEqual(await page.evaluate(() => testBoardContext.pageState.candidates), []);
    await point(0, 1);
    await page.waitForFunction(() => QiTsumego.getRoom().recordTree.tree.nodes[1].children.length === 2);
    await page.click('#tsumegoWrongBtn');
    await page.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('failure'));
    assert.equal(await page.evaluate(() => testBoardContext.getBoard()[0][1]), 2);
    await page.reload(); await loaded();
    assert.deepEqual(await page.evaluate(() => testBoardContext.pageState.candidates), [{ row: 2, col: 3 }], '初始候选不受后续分支影响');
    await page.$eval('#replaySlider', (e) => { e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.deepEqual(await page.evaluate(() => testBoardContext.pageState.candidates), []);
    await upload({ ...greedyKo, moves: ['B2,3', 'W0,0', 'B8,8', 'success'] });
    await page.waitForFunction(() => QiTsumego.getRecord().moves.length === 4 && document.querySelector('#replaySlider').value === '0');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#tsumegoCreateBtn')]); await loaded();
    await point(2, 3);
    await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
    assert.equal(await page.evaluate(() => testBoardContext.getBoard()[0][0]), 2);
    await point(8, 8);
    await answered();
    assert.deepEqual(errors, []);
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), upload({ ...base, gameId: 'real-time-weiqi', gameType: 'RealTime围棋',
        firstPlayer: 'white', moves: ['W1,1', 'B2,2', 'W3,3', 'success'] })]); await loaded();
    await point(1, 1); await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
    await point(3, 3); await answered();
    assert.deepEqual(errors, []);
    // 用固定随机数检查真实解题流程使用 2:1 权重，未指定主线时均等选择。
    await page.goto(origin + '/qi/tsumego-view'); await loaded();
    const replyPuzzle = { ...base, moves: ['B1,1', { main: ['W2,2', 'B3,3', 'success'],
        v1: ['W2,3', 'B3,4', 'success'], v2: ['W2,4', 'B3,5', 'success'] }] };
    await upload(replyPuzzle);
    await page.waitForFunction(() => QiTsumego.getRecord().moves[1]?.v2);
    for (const [value, col] of [[.49, 2], [.51, 3], [.76, 4]]) {
        await page.evaluate((value) => { window.testRandomBefore = Math.random; Math.random = () => value; }, value);
        await point(1, 1);
        await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
        assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.moveCoords[1].col), col);
        await page.evaluate(() => { Math.random = window.testRandomBefore; });
        await page.click('#newGameBtn');
        await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 0);
    }
    await upload({ ...replyPuzzle, moves: ['B1,1', { v1: replyPuzzle.moves[1].main,
        v2: replyPuzzle.moves[1].v1, v3: replyPuzzle.moves[1].v2 }] });
    await page.waitForFunction(() => QiTsumego.getRecord().moves[1]?.v3);
    for (const [value, col] of [[.32, 2], [.34, 3], [.67, 4]]) {
        await page.evaluate((value) => { window.testRandomBefore = Math.random; Math.random = () => value; }, value);
        await point(1, 1);
        await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 2);
        assert.equal(await page.evaluate(() => QiTsumego.getRoom().gameLogic.moveCoords[1].col), col);
        await page.evaluate(() => { Math.random = window.testRandomBefore; });
        await page.click('#newGameBtn');
        await page.waitForFunction(() => QiTsumego.getRoom().gameLogic.moveCoords.length === 0);
    }
    assert.deepEqual(errors, []);
    if (process.argv.includes('--all-pages')) {
        for (const g of catalog) {
            if (g.category === '其它') continue;
            // Start from each native game's defaults.
            await page.evaluate((g) => sessionStorage.setItem('qiTsumegoDraft', JSON.stringify({ format: 'muzei-tsumego', gameId: g.id, gameType: g.name, moves: [], komi: null })), g);
            await page.goto(origin + '/qi/tsumego-view?game=' + g.id + '&mode=author'); await loaded();
            assert.equal(await page.$eval('#tsumegoStatus', (e) => e.dataset.result), '', g.id + ': ' + await page.$eval('#tsumegoStatus', (e) => e.textContent));
            console.log('Initialized', g.id);
            assert.deepEqual(errors, [], g.id);
        }
    }
    console.log('Passed offline puzzles, ordering, loop, initial position, correct/wrong, replies, white first, undo, authoring and refresh.');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
    wss.close(); Server_.close();
    process.exit(process.exitCode || 0);
});
