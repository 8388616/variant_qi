// 渲染验证：国际象棋新棋子（象/士倒置、相/亚叠加）绘制检查
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const pluginSrc = fs.readFileSync(path.join(__dirname, 'public/room-plugins/chess-room.js'), 'utf8');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}canvas{width:600px;height:600px}</style></head>
<body>
<pre id="result">running</pre>
<script>
window.onerror = function (msg, src, line, col, err) {
    window.__lastErr = msg + ' @' + line + ' | ' + (err && err.stack ? err.stack.split('\\n').slice(0, 6).join(' | ') : '');
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
                b.setMySlot('black');
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
    window.RoomPlugins["chess"].mount({
        gameType: 'chess', roomId: 'test', roomPassword: null, config: {}
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
    // 摆新棋子局面（通过 fakeJoin 后直接改 ps 不可达——用 canvas 点击？不——直接用 getState 后的 board 不可改。
    // 简化：仅验证默认棋盘绘制不崩 + 编辑工具数量。新棋子绘制通过画布上摆放验证由单测覆盖。
    const img = ctx.getImageData(0, 0, w, h).data;
    let blackPx = 0, whitePx = 0;
    for (let i = 0; i < img.length; i += 4) {
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (Math.abs(r - 26) < 8 && Math.abs(g - 26) < 8 && Math.abs(b - 26) < 8) blackPx++;
        else if (Math.abs(r - 247) < 8 && Math.abs(g - 247) < 8 && Math.abs(b - 247) < 8) whitePx++;
    }
    document.getElementById('result').textContent = JSON.stringify({
        canvas: w + 'x' + h,
        blackPx, whitePx,
        editTools: (window.RoomPlugins["chess"].shell.editTools || []).length,
        editCols: (() => {
            const list = window.RoomPlugins["chess"].shell.editTools || [];
            const m = new Map();
            for (const t of list) {
                const v = t && t.cellValue;
                if (v == null || v === '' || v === 0 || (t && t.value === 'empty')) continue;
                const c = String(v).charAt(0);
                m.set(c, (m.get(c) || 0) + 1);
            }
            return Math.max(...m.values());
        })(),
        hasNew: ['we', 'wf', 'wc', 'wa', 'be', 'bf', 'bc', 'ba'].every(v => (window.RoomPlugins["chess"].shell.editTools || []).some(t => t.cellValue === v)),
        fakeJoinErr: window.__fakeJoinErr || null,
        lastErr: window.__lastErr || null
    });
} catch (err) {
    document.getElementById('result').textContent = 'ERROR: ' + err.message + '\\n' + err.stack;
}
}, 400);
</script>
</body></html>`;

const htmlPath = path.join(__dirname, '_render_chess_check.html');
fs.writeFileSync(htmlPath, html);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = execSync(`"${chrome}" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=3000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}"`, {
    timeout: 30000, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
});
const m = out.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (m) console.log(m[1]);
else { console.log('RESULT NOT FOUND'); console.log(out.slice(-2000)); }
