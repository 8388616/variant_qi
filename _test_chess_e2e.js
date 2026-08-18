// 国际象棋新棋子 e2e：编辑摆放新棋子 → 走子验证（象斜两步、士斜一步、相车/马、亚后/马）
const WebSocket = require('ws');
const BASE = 'http://127.0.0.1:3100';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}

class Client {
    constructor(name) {
        this.name = name;
        this.msgs = [];
        this.waiters = [];
    }
    connect(roomId) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`ws://127.0.0.1:3100/qi/ws?game=chess&room=${roomId}`);
            this.ws.on('message', (d) => {
                const m = JSON.parse(d.toString());
                this.msgs.push(m);
                if (m.type === 'broadcast' && m.action === 'move') this.lastMoveLen = m.moveHistory.length;
                if (m.type === 'editBoardAccepted') this.lastMoveLen = 0;
                for (let i = this.waiters.length - 1; i >= 0; i--) {
                    if (this.waiters[i].pred(m)) {
                        clearTimeout(this.waiters[i].timer);
                        this.waiters.splice(i, 1)[0].resolve(m);
                    }
                }
            });
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
        });
    }
    send(obj) { this.ws.send(JSON.stringify(obj)); }
    waitFor(pred, timeout = 6000) {
        for (let i = 0; i < this.msgs.length; i++) {
            if (pred(this.msgs[i])) return Promise.resolve(this.msgs.splice(i, 1)[0]);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(this.name + ' 等待超时: ' + pred.toString().slice(0, 80))), timeout);
            this.waiters.push({ pred, resolve, timer });
        });
    }
    close() { try { this.ws.close(); } catch (e) { } }
}

async function move(receiver, sender, fr, fc, tr, tc, promote) {
    while ((receiver.lastMoveLen || 0) < (sender.lastMoveLen || 0)) await wait(20);
    const expLen = (receiver.lastMoveLen || 0) + 1;
    const p = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(receiver.name + ' 等待走子超时 expLen=' + expLen)), 6000);
        receiver.waiters.push({
            pred: (m) => m.type === 'broadcast' && m.action === 'move' && m.moveHistory.length === expLen,
            resolve: (m) => { clearTimeout(timer); resolve(m); },
            timer
        });
    });
    sender.send({ type: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, ...(promote ? { promote } : {}) });
    const m = await p;
    receiver.lastMoveLen = m.moveHistory.length;
    return m;
}

(async () => {
    // 创建房间
    const r = await fetch(BASE + '/qi/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'chess' })
    });
    const room = await r.json();
    check('创建国际象棋房间', room && room.roomId);
    const a = new Client('A');
    const b = new Client('B');
    await a.connect(room.roomId);
    await b.connect(room.roomId);
    a.send({ type: 'join', password: '' });
    b.send({ type: 'join', password: '' });
    await a.waitFor(m => m.type === 'joined');
    await b.waitFor(m => m.type === 'joined');
    a.send({ type: 'selectColor', color: 'black' });   // 白方
    b.send({ type: 'selectColor', color: 'white' });   // 黑方
    await a.waitFor(m => m.type === 'timeControlNegotiation');
    await b.waitFor(m => m.type === 'timeControlWaitPeer');

    // 编辑棋盘：新棋子 + 双王
    const eb = Array(8).fill(null).map(() => Array(8).fill(''));
    eb[7][4] = 'we';   // 白象 e1
    eb[7][3] = 'wf';   // 白士 d1
    eb[7][2] = 'wc';   // 白相 c1
    eb[7][1] = 'wa';   // 白亚 b1
    eb[7][0] = 'wk';
    eb[0][4] = 'bk';
    a.send({ type: 'editBoard', board: eb });
    const ebOK = await b.waitFor(m => m.type === 'editBoardAccepted');
    check('编辑接受新棋子', ebOK.board[7][4] === 'we' && ebOK.board[7][3] === 'wf' && ebOK.board[7][2] === 'wc' && ebOK.board[7][1] === 'wa');

    // 时控
    a.send({ type: 'timeControlSubmit', timed: true, mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 });
    await b.waitFor(m => m.type === 'timeControlNegotiation' && m.mode === 'respond');
    b.send({ type: 'timeControlAccept' });
    await a.waitFor(m => m.type === 'timeControlAgreed');
    await b.waitFor(m => m.type === 'timeControlAgreed');

    // 白方先行
    // 象 e1→c3（斜两步，跳过 d2）
    let m1 = await move(b, a, 7, 4, 5, 2);
    check('白象斜两步 e1→c3', m1.board[5][2] === 'we' && !m1.board[7][4]);

    // 黑王动一步
    let m2 = await move(a, b, 0, 4, 0, 5);
    check('黑王走', m2.board[0][5] === 'bk');

    // 士 d1→e2（斜一步）
    m1 = await move(b, a, 7, 3, 6, 4);
    check('白士斜一步 d1→e2', m1.board[6][4] === 'wf' && !m1.board[7][3]);

    // 黑王回
    m2 = await move(a, b, 0, 5, 0, 4);

    // 相 c1→b3（马步，避开象）
    m1 = await move(b, a, 7, 2, 5, 1);
    check('白相马步 c1→b3', m1.board[5][1] === 'wc' && !m1.board[7][2]);

    // 黑王动
    m2 = await move(a, b, 0, 4, 0, 5);

    // 相 b3→b7（车行）
    m1 = await move(b, a, 5, 1, 1, 1);
    check('白相车行 b3→b7', m1.board[1][1] === 'wc');

    // 黑王回
    m2 = await move(a, b, 0, 5, 0, 4);

    // 亚 b1→b6（后行）
    m1 = await move(b, a, 7, 1, 2, 1);
    check('白亚后行 b1→b6', m1.board[2][1] === 'wa' && !m1.board[7][1]);

    // 黑王动
    m2 = await move(a, b, 0, 4, 0, 5);

    // 亚 b6→a4（马步）
    m1 = await move(b, a, 2, 1, 4, 0);
    check('白亚马步 b6→a4', m1.board[4][0] === 'wa');

    a.close(); b.close();
    console.log('\n通过', pass, '失败', fail);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 错误:', e.message); process.exit(1); });
