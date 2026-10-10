// node tests/tsumego-switching.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const server = new Module(path.join(root, 'tsumego-switch-check.js'), module);
server.filename = path.join(root, 'tsumego-switch-check.js');
server.paths = Module._nodeModulePaths(root);
server._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8').replace('const PORT = 3100;', 'const PORT = 0;')
    + '\nmodule.exports = { Server_, wss, rooms };', server.filename);
const { Server_, wss, rooms } = server.exports;
const prefix = 'zz-switch-' + process.pid + '-';
const fixtures = [
    { gameId: 'weiqi', boardSize: 9, firstPlayer: 'black', title: '切换测试一', initialPosition: [], moves: ['B1,1', 'success'] },
    { gameId: 'weiqi', boardSize: 13, firstPlayer: 'white', komi: 4, title: '切换测试二', initialPosition: ['B3,3'], moves: ['W1,1', 'success'] },
    { gameId: 'wuziqi', boardSize: 11, firstPlayer: 'black', title: '切换测试三', initialPosition: ['W4,4'], moves: ['B1,1', 'success'] }
];
const paths = fixtures.map((_, i) => path.join(root, 'public/tsumego', prefix + i + '.json'));
let browser, heldRequest;
async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    fixtures.forEach((data, i) => fs.writeFileSync(paths[i], JSON.stringify({ format: 'muzei-tsumego', komi: null, ...data })));
    const names = await fetch(origin + '/qi/tsumego-files').then((r) => r.json());
    const firstIndex = names.indexOf(path.basename(paths[0]));
    assert.deepEqual(names.slice(firstIndex, firstIndex + 3), paths.map((p) => path.basename(p)));
    browser = await require('puppeteer-core').launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [], topDocuments = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    let holdPlugin = false;
    page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) topDocuments.push(request.url());
        if (holdPlugin && request.url().endsWith('/room-plugins/wuziqi-room.js')) { heldRequest = request; return; }
        request.url().startsWith(origin) ? request.continue() : request.abort();
    });
    async function activeFrame() {
        await page.waitForSelector('iframe.tsumego-view:not(.tsumego-view-pending)');
        const element = await page.$('iframe.tsumego-view:not(.tsumego-view-pending)');
        return element.contentFrame();
    }
    async function question(frame, title) {
        await frame.waitForFunction((title) => window.QiTsumego?.getRecord()?.title === title
            && !document.querySelector('#tsumegoNextBtn').disabled, {}, title);
    }
    async function point(frame, row, col) {
        const p = await frame.evaluate(({ row, col }) => {
            const rect = document.querySelector('#goBoard').getBoundingClientRect();
            const size = QiTsumego.getRoom().gameLogic.boardSize;
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(size);
            return { x: rect.left + (g.padding + col * g.cellSize) / 600 * rect.width,
                y: rect.top + (g.padding + (size - 1 - row) * g.cellSize) / 600 * rect.height };
        }, { row, col });
        await page.mouse.click(p.x, p.y);
    }
    await page.goto(origin + '/qi/tsumego?game=weiqi&index=' + firstIndex);
    let frame = await activeFrame(); await question(frame, fixtures[0].title);
    assert.equal(await frame.$eval('#turnDisplay', (e) => e.textContent), '第' + (firstIndex + 1) + '题');
    await page.evaluate(() => { window.testTopDocument = document; });
    await frame.evaluate(() => {
        window.testViewDocument = document;
        window.testCanvas = document.querySelector('#goBoard');
        window.testRoom = QiTsumego.getRoom();
    });
    const documentCount = topDocuments.length;
    await point(frame, 1, 1);
    await frame.waitForFunction(() => document.querySelector('#qiRoomMsgText')?.textContent === '答对了。');
    await frame.click('#qiRoomMsgOk');
    await frame.click('#tsumegoNextBtn'); await question(frame, fixtures[1].title);
    assert.equal(await frame.evaluate(() => window.testViewDocument === document && window.testCanvas === document.querySelector('#goBoard')
        && window.testRoom !== QiTsumego.getRoom()), true);
    assert.equal(await frame.$eval('#boardSizeSelect', (e) => e.value), '13');
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.currentPlayer), 2);
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.board[3][3]), 1);
    assert.ok((await frame.$eval('#komiInfo', (e) => e.textContent)).includes('4'));
    assert.equal(new URL(page.url()).searchParams.get('index'), String(firstIndex + 1));
    await point(frame, 1, 1);
    await frame.waitForFunction(() => document.querySelector('#qiRoomMsgText')?.textContent === '答对了。');
    await frame.click('#qiRoomMsgOk');
    await frame.evaluate(() => { window.testRoomBeforeBadImport = QiTsumego.getRoom(); });
    await frame.$eval('#importFileInput', (el, data) => {
        const files = new DataTransfer(); files.items.add(new File([JSON.stringify(data)], 'invalid.json'));
        el.files = files.files; el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { format: 'muzei-tsumego', ...fixtures[1], boardSize: 99 });
    await frame.waitForFunction(() => document.querySelector('#tsumegoStatus').textContent.startsWith('导入失败'));
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom() === window.testRoomBeforeBadImport), true);
    assert.equal(await frame.evaluate(() => QiTsumego.getRecord().title), fixtures[1].title);
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.moveCoords.length), 1);
    // 阻塞新插件以验证加载过程中旧棋盘仍可见，且顶层页面不跳转。
    holdPlugin = true;
    await frame.click('#tsumegoNextBtn');
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2);
    const deadline = Date.now() + 10000;
    while (!heldRequest && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(heldRequest);
    assert.equal(await frame.$eval('#goBoard', (e) => e.getBoundingClientRect().width > 0), true);
    assert.equal(await page.$eval('.tsumego-view-pending', (e) => getComputedStyle(e).opacity), '0');
    assert.equal(await page.$eval('.tsumego-view:not(.tsumego-view-pending)', (e) => getComputedStyle(e).opacity), '1');
    assert.equal(topDocuments.length, documentCount);
    holdPlugin = false; await heldRequest.continue(); heldRequest = null;
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1
        && new URLSearchParams(location.search).get('game') === 'wuziqi');
    const nextFrame = await activeFrame(); await question(nextFrame, fixtures[2].title);
    assert.equal(await nextFrame.$eval('#turnDisplay', (e) => e.textContent), '第' + (firstIndex + 3) + '题');
    assert.notEqual(nextFrame, frame);
    assert.ok(frame.detached);
    frame = nextFrame;
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.board[4][4]), 2);
    assert.equal(topDocuments.length, documentCount);
    assert.equal(await page.evaluate(() => window.testTopDocument === document), true);
    assert.equal(new URL(page.url()).pathname, '/qi/tsumego');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'qi-tsumego-switching.png') });
    await page.reload(); frame = await activeFrame(); await question(frame, fixtures[2].title);
    assert.equal(await frame.$eval('#boardSizeSelect', (e) => e.value), '11');
    // 返回跨棋类题目，随后同棋类返回，均恢复正确初始棋盘。
    await frame.click('#tsumegoPreviousBtn');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('game') === 'weiqi');
    frame = await activeFrame(); await question(frame, fixtures[1].title);
    await frame.click('#tsumegoPreviousBtn'); await question(frame, fixtures[0].title);
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.boardSize), 9);
    assert.equal(await frame.evaluate(() => QiTsumego.getRoom().gameLogic.moveCoords.length), 0);
    // 导入同棋类的本地题目后刷新应保留该题，URL 不再指向服务器列表。
    await frame.$eval('#importFileInput', (el, data) => {
        const files = new DataTransfer(); files.items.add(new File([JSON.stringify(data)], 'local.json'));
        el.files = files.files; el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { format: 'muzei-tsumego', ...fixtures[1], title: '导入的本地题目' });
    await question(frame, '导入的本地题目');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('mode') === 'local');
    await page.reload(); frame = await activeFrame(); await question(frame, '导入的本地题目');
    // 创建模式同样通过后台视图切换，上一题回到解题后设置应被禁用。
    const beforeAuthor = topDocuments.length;
    await frame.click('#tsumegoCreateBtn');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('mode') === 'author');
    frame = await activeFrame();
    assert.equal(await frame.evaluate(() => QiTsumego.authoring), true);
    assert.equal(topDocuments.length, beforeAuthor);
    assert.equal(await frame.$eval('#tsumegoPreviousBtn', (e) => e.disabled), true);
    assert.equal(await frame.$eval('#tsumegoNextBtn', (e) => e.disabled), true);
    const authorUrl = page.url();
    await frame.$eval('#tsumegoPreviousBtn', (e) => e.dispatchEvent(new Event('click')));
    assert.equal(page.url(), authorUrl, 'Even a dispatched navigation click cannot leave authoring');
    await point(frame, 1, 1);
    await frame.waitForFunction(() => QiTsumego.getRoom().recordTree?.tree.nodes.length === 2);
    await frame.click('#tsumegoCorrectBtn');
    await frame.waitForFunction(() => JSON.stringify(QiTsumego.getRecord().moves).includes('success'));
    await frame.click('#tsumegoCreateBtn');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('mode') === 'local'
        && document.querySelectorAll('iframe').length === 1);
    frame = await activeFrame();
    assert.equal(await frame.evaluate(() => QiTsumego.authoring), false);
    assert.equal(await frame.$eval('#tsumegoCreateBtn', (e) => e.textContent), '创作题目');
    assert.equal(await frame.$eval('#tsumegoPreviousBtn', (e) => e.disabled), false);
    await frame.click('#tsumegoPreviousBtn');
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('mode'));
    frame = await activeFrame(); await question(frame, fixtures[2].title);
    assert.equal(await frame.$eval('#boardSizeSelect', (e) => e.disabled), true);
    assert.equal(await frame.evaluate(() => QiTsumego.authoring), false);
    assert.equal(Object.keys(rooms).length, 0);
    assert.deepEqual(errors, []);
    await frame.click('#backToLobbyBtn');
    await page.waitForFunction(() => location.pathname === '/qi');
    console.log('Passed inline puzzle switching, buffered cross-game views, refresh, author/import transitions and lobby navigation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (heldRequest) await heldRequest.abort().catch(() => {});
    if (browser) await browser.close();
    for (const file of paths) if (fs.existsSync(file)) fs.unlinkSync(file);
    wss.close(); Server_.close(); process.exit(process.exitCode || 0);
});
