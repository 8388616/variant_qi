// 渲染验证：环国际象棋客户端（fake 环境）→ canvas 绘制 → 像素统计 → 输出 JSON
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const pluginSrc = fs.readFileSync(path.join(__dirname, 'public/room-plugins/circular-chess-room.js'), 'utf8');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}canvas{width:600px;height:600px}</style></head>
<body>
<pre id="result">running</pre>
<script>
window.onerror = function (msg, src, line, col, err) {
    window.__lastErr = msg + ' @' + line + ' | ' + (err && err.stack ? err.stack.split('\n').slice(0, 6).join(' | ') : '');
    document.getElementById('result').textContent = 'SYNC ERROR: ' + window.__lastErr;
};
</script>
<script>
// ---------- fake 环境 ----------
const canvas = document.createElement('canvas');
canvas.id = 'goBoard';
canvas.width = 600; canvas.height = 600;
document.body.appendChild(canvas);
window.__blackView = false;
const canvasListeners = {};
canvas.addEventListener = (evt, fn) => { canvasListeners[evt] = fn; };
const fakeEl = (text) => ({ innerText: text || '', textContent: '', style: {}, appendChild() {}, addEventListener() {}, onclick: null, querySelector: () => null, parentElement: null });
const els = {};
els.goBoard = canvas;
['turnDisplay', 'colorStatus', 'scoreTitle', 'boardWrap', 'result'].forEach(id => els[id] = fakeEl());
els.result = document.getElementById('result');
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
                b.setMySlot(window.__blackView ? 'white' : 'black');
                b.setSlots({ black: true, white: true });
                if (b.syncState) b.syncState({ board: b.getBoard(), sideToMove: 'white', matchStarted: true, slots: { black: true, white: true } });
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

// ---------- 执行 mount ----------
try {
    window.RoomPlugins["circular-chess"].mount({
        gameType: 'circular-chess', roomId: 'test', roomPassword: null, config: {}
    });
    document.getElementById('result').textContent = 'step2';
} catch (e) {
    document.getElementById('result').textContent = 'MOUNT ERR: ' + e.message + ' | ' + (e.stack || '').split('\\n')[1];
}

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
    // 全图直方图
    let light = 0, dark = 0, line = 0, blackPx = 0, whitePx = 0, frame = 0;
    for (let i = 0; i < img.length; i += 4) {
        const rgb = [img[i], img[i + 1], img[i + 2]];
        if (near(rgb, '#f0d9b5', 4)) light++;
        else if (near(rgb, '#b58863', 4)) dark++;
        else if (near(rgb, '#8a5a3b', 4)) line++;
        else if (near(rgb, '#1a1a1a', 6)) blackPx++;
        else if (near(rgb, '#f7f7f7', 6)) whitePx++;
    }
    // 采样点（逻辑 560 坐标系；C=280, R_OUT=260, R_IN=52, ringW=52；整体旋转 11.25°）
    const C = 280, R_IN = 52, R_OUT = 260;
    const center = at(C, C);                       // 中心小圆内：木色 #fdcc90
    const a3 = (-11.25) * Math.PI / 180;           // sector 3 ring 0 中心（空格，深色：(0+3)%2=1）
    const s1 = at(C + 78 * Math.cos(a3), C + 78 * Math.sin(a3));
    const a4 = (11.25) * Math.PI / 180;            // sector 4 ring 0 中心（空格，浅色：(0+4)%2=0）
    const s0 = at(C + 78 * Math.cos(a4), C + 78 * Math.sin(a4));
    // 圆形外框：环带（R_OUT=260 与 C=280 之间）木色、外沿描边
    const band = at(C, C - 270);
    // 王/后之间的界线竖直：x=C 竖线（sector 8 左边界 90°）应有格线色
    let vertLine = 0;
    for (let y = C + R_IN + 6; y < C + R_OUT - 6; y += 3) {
        if (near(at(C, y), '#8a5a3b', 12)) vertLine++;
    }
    // 白王在底部（sector 8 ring 0）：(C, C+78) 附近应有字形像素
    let kingBottomWhite = 0;
    for (let y = C + 50; y < C + 110; y += 2) {
        for (let x = C - 30; x < C + 30; x += 2) {
            if (near(at(x, y), '#f7f7f7', 6)) kingBottomWhite++;
        }
    }
    // 黑王在顶部（sector 0 ring 0）：(C, C-78) 附近应有黑色字形像素
    let kingTopBlack = 0;
    for (let y = C - 110; y < C - 50; y += 2) {
        for (let x = C - 30; x < C + 30; x += 2) {
            if (near(at(x, y), '#1a1a1a', 8)) kingTopBlack++;
        }
    }
    // 采样点周围 21×21 块颜色种类
    const block = (cx, cy) => {
        const set = {};
        for (let y = cy - 10; y <= cy + 10; y += 2) {
            for (let x = cx - 10; x <= cx + 10; x += 2) {
                const rgb = at(x, y);
                set['#' + rgb[0].toString(16).padStart(2, '0') + rgb[1].toString(16).padStart(2, '0') + rgb[2].toString(16).padStart(2, '0')] = (set['#' + rgb[0].toString(16).padStart(2, '0') + rgb[1].toString(16).padStart(2, '0') + rgb[2].toString(16).padStart(2, '0')] || 0) + 1;
            }
        }
        const top = Object.entries(set).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => k + 'x' + v);
        return top.join(' ');
    };
    const bkBlock = block(C, C - 78);   // 黑王显示格（顶部 sector 0 ring 0）
    const wkBlock = block(C, C + 78);   // 白王显示格（底部 sector 8 ring 0）
    document.getElementById('result').textContent = JSON.stringify({
        canvas: w + 'x' + h,
        light, dark, line, blackPx, whitePx,
        center: '#' + center[0].toString(16).padStart(2, '0') + center[1].toString(16).padStart(2, '0') + center[2].toString(16).padStart(2, '0'),
        band: '#' + band[0].toString(16).padStart(2, '0') + band[1].toString(16).padStart(2, '0') + band[2].toString(16).padStart(2, '0'),
        s0: '#' + s0[0].toString(16).padStart(2, '0') + s0[1].toString(16).padStart(2, '0') + s0[2].toString(16).padStart(2, '0'),
        s1: '#' + s1[0].toString(16).padStart(2, '0') + s1[1].toString(16).padStart(2, '0') + s1[2].toString(16).padStart(2, '0'),
        block0: block(C + 78 * Math.cos(a4), C + 78 * Math.sin(a4)), block1: block(C + 78 * Math.cos(a3), C + 78 * Math.sin(a3)),
        vertLine, kingBottomWhite, kingTopBlack,
        bkBlock, wkBlock,
        fakeJoinErr: window.__fakeJoinErr || null,
        lastErr: window.__lastErr || null
    });
} catch (err) {
    document.getElementById('result').textContent = 'ERROR: ' + err.message + '\\n' + err.stack;
}
}, 400);
</script>
</body></html>`;

const htmlPath = path.join(__dirname, '_render_circular_check.html');
fs.writeFileSync(htmlPath, html);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = execSync(`"${chrome}" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=3000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}"`, {
    timeout: 30000, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
});
const m = out.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (m) console.log(m[1]);
else { console.log('RESULT NOT FOUND'); console.log(out.slice(-2000)); }
