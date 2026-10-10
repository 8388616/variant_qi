// node tests/tsumego-rendering.cjs [--baseline]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const server = new Module(path.join(root, 'tsumego-render-check.js'), module);
server.filename = path.join(root, 'tsumego-render-check.js');
server.paths = Module._nodeModulePaths(root);
server._compile(fs.readFileSync(path.join(root, 'qi-server.js'), 'utf8').replace('const PORT = 3100;', 'const PORT = 0;')
    + '\nmodule.exports = { Server_, wss };', server.filename);
const { Server_, wss } = server.exports;
const prefix = 'zz-render-' + process.pid + '-';
const fixtures = [
    ['weiqi', 9], ['weiqi', 9], ['wuziqi', 9], ['weiqi', 17], ['triangle-weiqi', 9], ['triangle-weiqi', 9]
].map(([gameId, boardSize], i) => ({ format: 'muzei-tsumego', gameId, boardSize, firstPlayer: 'black',
    komi: null, title: '绘制测试' + i, initialPosition: [], moves: ['B1,1', 'success'] }));
const paths = fixtures.map((_, i) => path.join(root, 'public/tsumego', prefix + i + '.json'));
let browser;
async function main() {
    if (!Server_.listening) await new Promise((r) => Server_.once('listening', r));
    const origin = 'http://127.0.0.1:' + Server_.address().port;
    fixtures.forEach((data, i) => fs.writeFileSync(paths[i], JSON.stringify(data)));
    const names = await fetch(origin + '/qi/tsumego-files').then((r) => r.json());
    const firstIndex = names.indexOf(path.basename(paths[0]));
    browser = await require('puppeteer-core').launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (r) => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.evaluateOnNewDocument(() => {
        window.paintMetrics = { woodMs: 0, grids: 0, generatedWood: 0 };
        let sharedCache;
        Object.defineProperty(window, 'QiTsumegoBoardCache', { configurable: true,
            get: () => sharedCache, set(value) {
                sharedCache = value;
                const original = value.getCanvas;
                value.getCanvas = function (key, create) {
                    return original.call(this, key, (doc) => {
                        if (key.startsWith('wood|')) paintMetrics.generatedWood++;
                        return create(doc);
                    });
                };
            }
        });
        let canvasApi;
        Object.defineProperty(window, 'QiSquareWeiqiCanvas', { configurable: true,
            get: () => canvasApi, set(value) {
                canvasApi = value;
                for (const name of ['applyBoardWoodTexture', 'getWoodFill']) {
                    const original = value[name];
                    value[name] = function (...args) {
                        const start = performance.now();
                        try { return original.apply(this, args); }
                        finally { paintMetrics.woodMs += performance.now() - start; }
                    };
                }
                const original = value.draw.grid;
                value.draw.grid = function (...args) { paintMetrics.grids++; return original.apply(this, args); };
            }
        });
    });
    async function active(i) {
        await page.waitForFunction((title) => {
            const f = document.querySelector('iframe:not(.tsumego-view-pending)');
            return f?.contentWindow.QiTsumego?.getRecord()?.title === title
                && !f.contentDocument.querySelector('#tsumegoNextBtn').disabled;
        }, {}, fixtures[i].title);
        const f = await (await page.$('iframe:not(.tsumego-view-pending)')).contentFrame();
        await f.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        return f;
    }
    await page.goto(origin + '/qi/tsumego?game=weiqi&index=' + firstIndex);
    let frame = await active(0);
    const metrics = () => frame.evaluate(() => ({ woodMs: paintMetrics.woodMs, grids: paintMetrics.grids }));
    const measurements = [{ question: 0, ...await metrics() }];
    const initialWoodCount = await page.evaluate(() => paintMetrics.generatedWood);
    if (!process.argv.includes('--baseline')) assert.equal(initialWoodCount, 1);
    const background = await frame.$eval('#goBoard', (c) => c.style.backgroundImage);
    assert.ok(background.startsWith('url('));
    const grids = await frame.evaluate(() => paintMetrics.grids);
    let specialWood;
    for (let i = 1; i < fixtures.length; i++) {
        const start = performance.now();
        await frame.click('#tsumegoNextBtn');
        frame = await active(i);
        measurements.push({ question: i, switchMs: Math.round(performance.now() - start), ...await metrics() });
        if (!process.argv.includes('--baseline')) {
            if (i === 1) assert.equal(await frame.evaluate(() => paintMetrics.grids), grids, 'Same geometry must reuse the grid');
            if (i === 2) {
                assert.equal(await frame.$eval('#goBoard', (c) => c.style.backgroundImage), background, 'Other square games share wood');
                // 五子棋挂载时先画默认的 13 路盘；题目的 9 路底层应沿用围棋的缓存。
                assert.equal(await frame.evaluate(() => paintMetrics.grids), 1, 'Cross-game grid cache survives view removal');
                assert.equal(await page.evaluate(() => paintMetrics.generatedWood), initialWoodCount, 'Cross-game wood must not regenerate');
            }
            if (i === 3) assert.ok(await frame.evaluate(() => paintMetrics.grids) > 0, 'Changing board size rebuilds the grid');
            if (i === 4) specialWood = await page.evaluate(() => paintMetrics.generatedWood);
            if (i === 5) assert.equal(await page.evaluate(() => paintMetrics.generatedWood), specialWood, 'Special boards reuse their material');
        }
    }
    if (!process.argv.includes('--baseline')) {
        const rendering = await frame.evaluate(() => {
            const C = QiSquareWeiqiCanvas;
            let maxDifference = 0;
            for (const [n, backing, z, x, y] of [[9, 600, 1, 300, 300], [13, 780, 2, 250, 280], [9, 480, 1.6, 350, 400]]) {
                const geometry = C.computePaddingAndCell(n);
                const contexts = [0, 1].map(() => {
                    const c = document.createElement('canvas'); c.width = c.height = backing;
                    const ctx = c.getContext('2d'); ctx.scale(backing / 600, backing / 600); return ctx;
                });
                const [cached, direct] = contexts;
                C.drawSquareBoardBase(cached, n, geometry.padding, geometry.cellSize, 600, z, x, y);
                if (z > 1) { direct.translate(300, 300); direct.scale(z, z); direct.translate(-x, -y); }
                C.draw.grid(direct, n, geometry.padding, geometry.cellSize, 600, z > 1 ? 1 / z : undefined);
                C.draw.starPoints(direct, n, geometry.padding, geometry.cellSize);
                C.draw.coordLabels(direct, n, geometry.padding, geometry.cellSize);
                const pixels = contexts.map((c) => c.getImageData(0, 0, backing, backing).data);
                for (let i = 0; i < pixels[0].length; i++) maxDifference = Math.max(maxDifference, Math.abs(pixels[0][i] - pixels[1][i]));
                const before = paintMetrics.grids;
                C.draw.clear(cached);
                C.drawSquareBoardBase(cached, n, geometry.padding, geometry.cellSize, 600, z, x, y);
                if (before !== paintMetrics.grids) throw new Error('Repeated view regenerates grid');
            }
            const c = document.createElement('canvas');
            C.applyBoardWoodTexture(c, { longSide: 512, seed: 123, base: [250, 200, 140] });
            const original = c.style.backgroundImage;
            C.applyBoardWoodTexture(c, { longSide: 512, seed: 123, base: [250, 200, 140] });
            const reused = c.style.backgroundImage === original;
            C.applyBoardWoodTexture(c, { longSide: 512, seed: 456, base: [250, 200, 140] });
            const seedChanged = c.style.backgroundImage !== original;
            return { maxDifference, reused, seedChanged };
        });
        assert.equal(rendering.maxDifference, 0, 'Cached pixels match direct drawing at different zoom and pixel densities');
        assert.equal(rendering.reused, true);
        assert.equal(rendering.seedChanged, true);
        // 缓存只能持有外层页面的位图，不能让已移除的插件文档滞留。
        assert.equal(await page.evaluate(() => {
            const cache = QiTsumegoBoardCache;
            const c = cache.getCanvas('ownership-check', (doc) => {
                const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 10; return canvas;
            });
            return c.ownerDocument === document && document.querySelectorAll('iframe').length === 1;
        }), true);
        assert.equal(await page.evaluate(() => {
            const cache = QiTsumegoBoardCache;
            let creations = 0;
            const create = (doc) => {
                creations++;
                const c = doc.createElement('canvas'); c.width = c.height = 400; return c;
            };
            for (let i = 0; i < 17; i++) cache.getCanvas('eviction-check-' + i, create);
            cache.getCanvas('eviction-check-0', create);
            return creations;
        }), 18, 'Least-used images must be evicted');
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(measurements));
    console.log('Passed puzzle rendering and switching checks.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    for (const file of paths) if (fs.existsSync(file)) fs.unlinkSync(file);
    wss.close(); Server_.close(); process.exit(process.exitCode || 0);
});
