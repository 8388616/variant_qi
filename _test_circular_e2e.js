// 环国际象棋 e2e：
// 房间1：正常开局走子（马、兵、非法拒绝）
// 房间2：开局前编辑 → 编辑后走子 → 交替走子满 6 步升变 → 棋谱导出
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
            this.ws = new WebSocket(`ws://127.0.0.1:3100/qi/ws?game=circular-chess&room=${roomId}`);
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
    /** 等待满足条件的消息（先回看已收队列，再等新消息） */
    waitFor(pred, timeout = 6000) {
        for (let i = 0; i < this.msgs.length; i++) {
            if (pred(this.msgs[i])) return Promise.resolve(this.msgs.splice(i, 1)[0]);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(this.name + ' 等待超时: ' + pred.toString().slice(0, 80))), timeout);
            this.waiters.push({ pred, resolve, timer });
        });
    }
    has(pred) { return this.msgs.some(pred); }
    close() { try { this.ws.close(); } catch (e) { } }
}

async function createRoom() {
    const r = await fetch(BASE + '/qi/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'circular-chess' })
    });
    return r.json();
}

/** 双人入座（可先编辑再走时控；时控同意后编辑被锁）。返回 { a(白), b(黑), finishTC } */
async function setupRoom() {
    const room = await createRoom();
    const a = new Client('A');
    const b = new Client('B');
    await a.connect(room.roomId);
    await b.connect(room.roomId);
    a.send({ type: 'join', password: '' });
    b.send({ type: 'join', password: '' });
    await a.waitFor(m => m.type === 'joined');
    await b.waitFor(m => m.type === 'joined');
    a.send({ type: 'selectColor', color: 'black' });   // 白方（先手）
    b.send({ type: 'selectColor', color: 'white' });   // 黑方
    await a.waitFor(m => m.type === 'timeControlNegotiation');
    await b.waitFor(m => m.type === 'timeControlWaitPeer');
    const finishTC = async () => {
        a.send({ type: 'timeControlSubmit', timed: true, mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 });
        await b.waitFor(m => m.type === 'timeControlNegotiation' && m.mode === 'respond');
        b.send({ type: 'timeControlAccept' });
        await a.waitFor(m => m.type === 'timeControlAgreed');
        await b.waitFor(m => m.type === 'timeControlAgreed');
    };
    return { a, b, finishTC };
}

async function move(receiver, sender, fr, fc, tr, tc, promote) {
    // 竞态防护：等接收方追平发送方已收到的广播（避免 expLen 用过期值）
    while ((receiver.lastMoveLen || 0) < (sender.lastMoveLen || 0)) await wait(20);
    const expLen = (receiver.lastMoveLen || 0) + 1;
    // 先注册 waiter 再 send
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
    // ============ 房间1：正常开局 ============
    console.log('== 房间1：正常开局 ==');
    const r1 = await setupRoom();
    await r1.finishTC();
    check('房间1 创建+入座+时控', true);

    // 初始局面（稀疏对象：32 个棋子格）
    const st0 = await r1.a.waitFor(m => m.type === 'gameState');
    check('初始 32 个棋子格', Object.keys(st0.board).length === 32);
    check('白后 0,7 存在', st0.board['0,7'] && st0.board['0,7'][1] === 'q' && st0.board['0,7'][0] === 'w');
    check('黑王 0,0 存在', st0.board['0,0'] && st0.board['0,0'][1] === 'k' && st0.board['0,0'][0] === 'b');

    // 白马 (2,7) → (1,5)
    const m1 = await move(r1.b, r1.a, 2, 7, 1, 5);
    check('白马径向2+环向1 到 1,5', m1.board['1,5'] && m1.board['1,5'][1] === 'n' && m1.board['1,5'][0] === 'w' && !m1.board['2,7']);
    check('轮到黑方', m1.sideToMove === 'black');
    const before = m1.moveHistory.length;

    // 非法走子被拒：黑王 (0,0) → (0,1) 吃自己黑兵
    r1.b.send({ type: 'move', fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 });
    await wait(400);
    check('非法走子被忽略（黑王吃自己兵无效）', !r1.b.has(m => m.type === 'broadcast' && m.action === 'move' && m.moveHistory.length > before));

    // 黑左侧兵 (3,14) → (3,13)
    const m2 = await move(r1.a, r1.b, 3, 14, 3, 13);
    check('黑左侧兵直走 3,14→3,13', m2.board['3,13'] && m2.board['3,13'][1] === 'p' && m2.board['3,13'][0] === 'b');
    check('兵对象保留 dir/steps', m2.board['3,13'].dir === -1 && m2.board['3,13'].steps === 1);

    // 白兵首步 2 步：(3,6) → (3,4)
    const m3 = await move(r1.b, r1.a, 3, 6, 3, 4);
    check('白左侧兵首步 2 步到 3,4', m3.board['3,4'] && m3.board['3,4'][1] === 'p' && m3.board['3,4'][0] === 'w');
    check('两步算 2 步（steps=2）', m3.board['3,4'].steps === 2);
    r1.a.close(); r1.b.close();

    // ============ 房间2：开局前编辑 + 升变 ============
    console.log('== 房间2：编辑 + 升变 ==');
    const r2 = await setupRoom();
    check('房间2 创建+入座', true);

    // 编辑1：flat 64 数组（ring-major）——必须在时控同意前（之后编辑被锁）
    const edit1 = Array(64).fill('');
    edit1[3 * 16 + 7] = 'wq';  // (3,7)
    edit1[0 * 16 + 0] = 'bk';  // (0,0)
    edit1[0 * 16 + 8] = 'wk';  // (0,8)
    edit1[3 * 16 + 1] = 'bp';  // (3,1) 黑兵（sector 1，dir=+1）
    r2.a.send({ type: 'editBoard', board: edit1 });
    const eb = await r2.b.waitFor(m => m.type === 'editBoardAccepted');
    check('编辑生效：白后 3,7', eb.board['3,7'] === 'wq');
    check('编辑黑兵转为对象（dir=+1）', eb.board['3,1'] && eb.board['3,1'][1] === 'p' && eb.board['3,1'].dir === 1);
    check('编辑重置走子记录', eb.moveHistory.length === 0);

    // 编辑2：白兵斜吃 + 黑兵（升变序列用），时控同意后编辑被锁 → 先编辑再时控
    const edit2 = Array(64).fill('');
    edit2[3 * 16 + 6] = 'wp';   // (3,6) 白兵 dir=-1
    edit2[2 * 16 + 5] = 'bp';   // (2,5) 黑兵（斜吃目标）
    edit2[1 * 16 + 14] = 'bp';  // (1,14) 黑兵 dir=-1 → 走 (1,13)...(1,9)
    edit2[0 * 16 + 0] = 'bk';
    edit2[0 * 16 + 8] = 'wk';
    r2.a.send({ type: 'editBoard', board: edit2 });
    await r2.b.waitFor(m => m.type === 'editBoardAccepted');
    await r2.finishTC();
    check('房间2 时控生效', true);
    const m4 = await move(r2.b, r2.a, 3, 6, 2, 5);
    check('编辑后白兵斜吃 3,6→2,5', m4.board['2,5'] && m4.board['2,5'][0] === 'w' && m4.board['2,5'][1] === 'p' && !m4.board['3,6']);
    check('斜吃后白兵 steps=1', m4.board['2,5'].steps === 1);

    // 交替走子（斜吃后轮到黑方 → 黑先白后）→ 白兵（从 2,5 出发）走满 6 步升变。
    // 黑兵只走 4 步：第 5 步到 (1,9) 会斜攻白王 (0,8) 将军
    const seq = [
        ['black', 1, 14, 1, 13], ['white', 2, 5, 2, 4],
        ['black', 1, 13, 1, 12], ['white', 2, 4, 2, 3],
        ['black', 1, 12, 1, 11], ['white', 2, 3, 2, 2],
        ['black', 1, 11, 1, 10], ['white', 2, 2, 2, 1],
        ['black', 0, 0, 0, 1],   // 黑王动一步（黑兵第 5 步会将军白王，不能走）
    ];
    let last = m4;
    for (const [side, fr, fc, tr, tc] of seq) {
        const sender = side === 'white' ? r2.a : r2.b;
        const receiver = side === 'white' ? r2.b : r2.a;
        last = await move(receiver, sender, fr, fc, tr, tc);
    }
    check('白兵走满 5 步（steps=5）', last.board['2,1'] && last.board['2,1'].steps === 5);
    // 第 6 步带 promote 升变
    const m5 = await move(r2.b, r2.a, 2, 1, 2, 0, 'q');
    check('走满 6 步升变为后', m5.board['2,0'] && m5.board['2,0'][1] === 'q' && m5.board['2,0'][0] === 'w' && m5.board['2,0'].steps === 6);
    check('棋谱记录升变 =q', m5.moveHistory.some(m => m.promote === 'q'));

    // 棋谱导出
    r2.a.send({ type: 'exportRecord' });
    const rec = await r2.a.waitFor(m => m.type === 'gameRecord');
    check('棋谱 gameId=circular-chess', rec.data && rec.data.gameId === 'circular-chess');
    check('棋谱含升变手 =Q', JSON.stringify(rec.data.moves).includes('=Q'));

    r2.a.close(); r2.b.close();

    // ============ 房间3：编辑后开局无子可动 → 判和 ============
    console.log('== 房间3：编辑后开局判和 ==');
    const r3 = await setupRoom();
    // 白王 (0,4) 被 5 个死兵（sector 3/5 等 dir=0）围住 → 白方无合法走法
    const edit4 = Array(64).fill('');
    edit4[0] = 'bk';          // (0,0)
    edit4[4] = 'wk';          // (0,4)
    edit4[3] = 'wp';          // (0,3)
    edit4[5] = 'wp';          // (0,5)
    edit4[19] = 'wp';         // (1,3)
    edit4[20] = 'wp';         // (1,4)
    edit4[21] = 'wp';         // (1,5)
    r3.a.send({ type: 'editBoard', board: edit4 });
    await r3.b.waitFor(m => m.type === 'editBoardAccepted');
    await r3.finishTC();
    const over = await r3.a.waitFor(m => m.type === 'broadcast' && m.action === 'matchStartOver');
    check('开局判和：gameOver=true', over.gameOver === true);
    check('开局判和：winner=draw', over.winner === 'draw');
    check('开局判和：白方无子可动，和棋', over.recordResultText === '白方无子可动，和棋');
    // 判和后再走子被拒
    const before3 = over.moveHistory.length;
    r3.a.send({ type: 'move', fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 });
    await wait(300);
    check('判和后走子被忽略', !r3.b.has(m => m.type === 'broadcast' && m.action === 'move' && m.moveHistory.length > before3));
    r3.a.close(); r3.b.close();

    console.log('\n通过', pass, '失败', fail);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 错误:', e.message); process.exit(1); });
