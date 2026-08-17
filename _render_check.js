// 渲染验证：加载客户端插件（fake 环境）→ canvas 绘制 → 像素统计 → 输出 JSON
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const pluginSrc = fs.readFileSync(path.join(__dirname, 'public/room-plugins/rhombic-chess-room.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, 'games/rhombic-chess.js'), 'utf8');
const rEmbed = serverSrc.match(/const R = \(function \(\) \{[\s\S]*?\}\)\(\);/)[0];

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}canvas{width:600px;height:600px}</style></head>
<body>
<pre id="result">running</pre>
<script>
window.onerror = function (msg, src, line) {
    document.getElementById('result').textContent = 'SYNC ERROR: ' + msg + ' @' + line;
};
</script>
<script>
// ---------- fake 环境 ----------
const canvas = document.createElement('canvas');
canvas.id = 'goBoard';
canvas.width = 600; canvas.height = 600;
document.body.appendChild(canvas);
window.__blackView = false; // 黑方视角开关（mySlot='white'）
const canvasListeners = {};
canvas.addEventListener = (evt, fn) => { canvasListeners[evt] = fn; };
const fakeEl = (text) => ({ innerText: text || '', textContent: '', style: {}, appendChild() {}, addEventListener() {}, onclick: null, querySelector: () => null, parentElement: null });
const els = {};
els.goBoard = canvas;
['turnDisplay', 'colorStatus', 'scoreTitle', 'boardWrap', 'result'].forEach(id => els[id] = fakeEl());
els.result = document.getElementById('result'); // 保留真实 result 元素
document.getElementById = (id) => els[id] || null;
document.createElement = (tag) => {
    const el = fakeEl();
    el.style = { cssText: '', setProperty() {}, display: 'none', left: '0', top: '0' };
    el.appendChild = () => {};
    el.innerText = ''; el.textContent = '';
    return el;
};
window.QiWeiqiSquarePageRuntime = { setupHiDpiCanvas(c, size) { c.width = size; c.height = size; } };
window.QiBoardRoomClient = { createWeiqiMessageBindings: (b) => ({
    handleMessage: (msg) => {
        try {
            const m = typeof msg === 'string' ? JSON.parse(msg) : msg;
            if (m.type === 'fakeJoin') {
                window.__fakeJoinRan = true;
                window.__hasSetMySlot = typeof b.setMySlot === 'function';
                window.__hasSyncState = typeof b.syncState === 'function';
                b.setMySlot(window.__blackView ? 'white' : 'black');
                window.__mySlotAfter = b.getMySlot ? b.getMySlot() : 'no-getter';
                b.setSlots({ black: true, white: true });
                if (b.syncState) b.syncState({ board: b.getBoard(), sideToMove: window.__blackView ? 'black' : 'white', matchStarted: true, slots: { black: true, white: true } });
                if (b.updateTurn) b.updateTurn();
            }
        } catch (e) { window.__fakeJoinErr = e.message; }
    }
}) };
window.__sentMsgs = [];
window.QiSquareWeiqiCanvas = { connectWeiqiRoomWebSocket: (o) => {
    setTimeout(() => { if (o.onMessage) o.onMessage(JSON.stringify({ type: 'fakeJoin' })); }, 120);
    return { readyState: 1, send: (d) => window.__sentMsgs.push(d) };
} };
window.matchMedia = () => ({ matches: false });
window.addEventListener = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 50);

// ---------- 插件 ----------
${pluginSrc}

// ---------- 执行 mount（绘制棋盘） ----------
try {
    window.RoomPlugins["rhombic-chess"].mount({
        gameType: 'rhombic-chess', roomId: 'test', roomPassword: null, config: {}
    });
    document.getElementById('result').textContent = 'step2';
} catch (e) {
    document.getElementById('result').textContent = 'MOUNT ERR: ' + e.message + ' | ' + (e.stack || '').split('\\n')[1];
}

// ---------- 服务端 R（几何验证用） ----------
${rEmbed}

// ---------- 验证 ----------
setTimeout(() => {
try {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h).data;
    const at = (x, y) => {
        const i = ((y | 0) * w + (x | 0)) * 4;
        return [img[i], img[i + 1], img[i + 2], img[i + 3]];
    };
    const near = (rgb, hex, tol) => {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return Math.abs(rgb[0] - r) < tol && Math.abs(rgb[1] - g) < tol && Math.abs(rgb[2] - b) < tol;
    };
    const COLS = { frame: '#fdcc90', dark: '#b58863', mid: '#d6b58c', light: '#f0d9b5' };
    // 1. 外框边界（垂直中线）——旋转 90° 后：上下是平边、左右是尖角
    let ft = -1, fb = -1;
    for (let y = 0; y < h; y++) { if (near(at(w / 2, y), COLS.frame, 10)) { if (ft < 0) ft = y; fb = y; } }
    // 2. 平边宽度（顶部/底部应宽 ≈ R_px）、尖角行（中部）
    const frameW = (y) => { let c = 0; for (let x = w / 2 - 200; x < w / 2 + 200; x++) { if (near(at(x, y), COLS.frame, 10)) c++; } return c; };
    const frameTopWidth = frameW(ft + 8), frameBotWidth = frameW(fb - 8), midWidth = frameW((ft + fb) / 2 | 0);
    // 3. 左右尖角：扫多行取外沿最值
    let fl = w, fr = -1;
    for (let y = (ft + fb) / 2 - 60; y <= (ft + fb) / 2 + 60; y += 6) {
        for (let x = 0; x < w; x++) {
            if (near(at(x, y), COLS.frame, 10)) { fl = Math.min(fl, x); fr = Math.max(fr, x); }
        }
    }
    // 3. 格子颜色：每格中心（黑方视角按显示位置采样）
    const A = Math.sqrt(3) / 2, B = 0.5;
    let cellOk = 0, cellBad = 0;
    const badCells = [];
    const centers = R.CELLS.map(c => R.centerOf(c));
    const minX = Math.min(...centers.map(p => p[0])) - 0.6, maxX = Math.max(...centers.map(p => p[0])) + 0.6;
    const minY = Math.min(...centers.map(p => p[1])) - 0.6, maxY = Math.max(...centers.map(p => p[1])) + 0.6;
    const BCX = (minX + maxX) / 2, BCY = (minY + maxY) / 2;
    const FR = Math.max(maxX - BCX, (maxY - BCY) / 0.866) * 1.04;
    const S = 600 / 2 / FR * 0.98;
    // 格线缩小 0.95（外框不变）
    const gx = (x) => 300 - BCX * S + BCX * S + (x - BCX) * S * 0.95;
    const gy = (y) => 300 - BCY * S + BCY * S + (y - BCY) * S * 0.95;
    const OX = 300 - BCX * S, OY = 300 - BCY * S;
    const expect = { h: COLS.mid, l: COLS.dark, r: COLS.light };
    // 黑方视角显示映射（与客户端一致：绕棋盘中心 180° 旋转）
    const rotId = (id) => {
        const p = R.centerOf(R.CELLS[id]);
        const tx = 2 * BCX - p[0], ty = 2 * BCY - p[1];
        for (let j = 0; j < R.CELLS.length; j++) {
            const q = R.centerOf(R.CELLS[j]);
            if (Math.abs(q[0] - tx) < 1e-6 && Math.abs(q[1] - ty) < 1e-6) return j;
        }
        return id;
    };
    const grid = {};
    R.CELLS.forEach((c, i) => {
        const did = window.__blackView ? rotId(i) : i;
        const dc = R.CELLS[did];
        const p = R.centerOf(dc);
        const px = gx(p[0]), py = gy(p[1]);
        // 采样点避开棋子：横格沿长对角（水平）偏移、竖格沿长对角（竖直）偏移
        const col = dc.type === 'h' ? at(px + S * 0.4, py) : at(px, py + S * 0.4);
        const ok = near(col, expect[dc.type], 20);
        if (ok) cellOk++; else { cellBad++; badCells.push(c.type + '(' + c.I + ',' + c.J + '):' + [col[0], col[1], col[2]].join(',')); }
        if (c.type === 'l' && c.I === 2 && c.J === -3) grid.row3first = { x: Math.round(px), y: Math.round(py) };
        if (c.type === 'r' && c.I === 8 && c.J === -3) grid.row3last = { x: Math.round(px), y: Math.round(py) };
    });
    // 4. 棋子（黑像素计数）
    let blackPx = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        const p = at(x, y);
        if (p[3] > 128 && p[0] < 60 && p[1] < 60 && p[2] < 60) blackPx++;
    }
    // 5. 画布内检查：所有格中心在画布内
    const inCanvas = centers.every(p => {
        const px = gx(p[0]), py = gy(p[1]);
        return px > 10 && px < w - 10 && py > 10 && py < h - 10;
    });
    // 6. 模拟点击（选中棋子 → 绘制合法目标 → 不应崩溃）
    let clickErr = null, targetPts = 0, dbg = null;
    const turnText = els.turnDisplay ? els.turnDisplay.innerText : '?';
    const mvCount = R.allLegalMoves(R.setup(), 'white').length;
    const crect = canvas.getBoundingClientRect();
    dbg = { listeners: Object.keys(canvasListeners), mvCount, fakeJoinRan: window.__fakeJoinRan, hasSetMySlot: window.__hasSetMySlot, mySlotAfter: window.__mySlotAfter, hasSyncState: window.__hasSyncState, fjErr: window.__fakeJoinErr || null, rect: crect.width + 'x' + crect.height + '@' + crect.left + ',' + crect.top };
    try {
        if (canvasListeners.click) {
            // 点白兵 r(1,6)（行 9 左端）
            // 黑方视角按显示位置点击黑兵 l(2,-3)，白方视角点击白兵 r(1,6)
            const clickKey = window.__blackView ? '2,0' : '8,0';
            const w9 = window.__blackView ? rotId(R.CELL_INDEX[clickKey]) : R.CELL_INDEX[clickKey];
            const p9 = R.centerOf(R.CELLS[w9]);
            const px9 = gx(p9[0]), py9 = gy(p9[1]);
            const before = ctx.getImageData(0, 0, w, h).data;
            canvasListeners.click({ clientX: px9 + crect.left, clientY: py9 + crect.top });
            const afterD = ctx.getImageData(0, 0, w, h).data;
            let diff = 0;
            for (let i = 0; i < before.length; i += 4) {
                if (Math.abs(before[i] - afterD[i]) > 10 || Math.abs(before[i + 1] - afterD[i + 1]) > 10 || Math.abs(before[i + 2] - afterD[i + 2]) > 10) diff++;
            }
            dbg = Object.assign(dbg, { diff });
            // 检查合法目标圆点（#a35c27 系）出现
            const img2 = ctx.getImageData(0, 0, w, h).data;
            const at2 = (x, y) => { const i = ((y | 0) * w + (x | 0)) * 4; return [img2[i], img2[i + 1], img2[i + 2]]; };
            for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
                const p = at2(x, y);
                if (Math.abs(p[0] - 163) < 25 && Math.abs(p[1] - 92) < 30 && Math.abs(p[2] - 39) < 30) targetPts++;
            }
            // 调试：目标格 h(1,3) 中心 + 白兵中心颜色
            const p13 = R.centerOf(R.CELLS[R.cellIdOf(7, 0)]);
            dbg = Object.assign(dbg, { h13: at2(gx(p13[0]), gy(p13[1])), p9: at2(px9, py9) });
            // 走子：点击目标格 h(1,3)（圆点中心）
            canvasListeners.click({ clientX: OX + p13[0] * S + crect.left, clientY: OY + p13[1] * S + crect.top });
            dbg = Object.assign(dbg, { sent: window.__sentMsgs.slice() });
        }
    } catch (e) { clickErr = e.message + ' @' + (e.stack || '').split('\\n')[1]; }
    document.getElementById('result').textContent = JSON.stringify({
        canvas: w + 'x' + h,
        frame: { top: ft, bottom: fb, left: fl, right: fr, spanV: fb - ft, spanH: fr - fl, topWidth: frameTopWidth, botWidth: frameBotWidth, midWidth },
        frameInCanvas: fl > 0 && fr < w && ft > 0 && fb < h,
        cellOk, cellBad, badCells: badCells.slice(0, 8),
        row3: grid,
        blackPx, inCanvas,
        clickErr, targetPts, turnText, dbg: JSON.stringify(dbg),
        SCALE: Math.round(S * 10) / 10, FRAME_R_px: Math.round(FR * S)
    });
} catch (err) {
    document.getElementById('result').textContent = 'ERROR: ' + err.message + '\\n' + err.stack;
}
}, 300);
</script>
</body></html>`;

const htmlPath = path.join(__dirname, '_render_check.html');
fs.writeFileSync(htmlPath, html);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = execSync(`"${chrome}" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=3000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}"`, {
    timeout: 30000, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
});
const m = out.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (m) console.log(m[1]);
else { console.log('RESULT NOT FOUND'); console.log(out.slice(-2000)); }
