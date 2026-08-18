// 国际象棋新棋子：象(e) 士(f) 相(c) 亚(a) 规则测试（服务端房间类）
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
function makeRoom() {
    const room = { gameLogic: null, maxPlayers: 0, getPlayerBySlot: () => null, getSlotByWs: () => null };
    require('./games/chess.js').initRoom(room);
    return room.gameLogic;
}
/** 独立局面：摆 piece 在 (fr,fc)，黑白王在角落，测试走 (fr,fc)→(tr,tc) 是否合法 */
function legal(piece, fr, fc, tr, tc, extra) {
    const g = makeRoom();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board[r][c] = '';
    g.board[fr][fc] = piece;
    g.board[7][0] = 'wk';
    g.board[0][4] = 'bk';
    if (extra) extra(g);
    g.sideToMove = 'white';
    return g._applyMoveCore(fr, fc, tr, tc, 'black', null).ok;
}

// ============ 象(e)：斜走两步不卡眼 ============
check('象斜一步', legal('we', 7, 4, 6, 3));
check('象斜两步（空路）', legal('we', 7, 4, 5, 2));
check('象跳过中间子斜两步（不卡眼）', legal('we', 7, 4, 5, 2, g => { g.board[6][3] = 'bp'; }));
check('象吃斜一步黑兵', legal('we', 7, 4, 6, 3, g => { g.board[6][3] = 'bp'; }));
check('象不可斜三步', !legal('we', 7, 4, 4, 1));
check('象不可直线走', !legal('we', 7, 4, 6, 4));

// ============ 士(f)：斜走一格 ============
check('士斜一步', legal('wf', 7, 3, 6, 4));
check('士不可斜两步', !legal('wf', 7, 3, 5, 5));
check('士不可直走', !legal('wf', 7, 3, 6, 3));

// ============ 相(c)：车 + 马 ============
check('相车行（e1→e6）', legal('wc', 7, 4, 2, 4));
check('相横走（e1→h1）', legal('wc', 7, 4, 7, 7));
check('相马步（e1→g2）', legal('wc', 7, 4, 5, 5));
check('相马步2（e1→c2）', legal('wc', 7, 4, 5, 3));
check('相不可斜走', !legal('wc', 7, 4, 6, 5));
check('相车行被挡', !legal('wc', 7, 4, 2, 4, g => { g.board[5][4] = 'bp'; }));

// ============ 亚(a)：后 + 马 ============
check('亚后行（e1→e6）', legal('wa', 7, 4, 2, 4));
check('亚后斜行（e1→c3）', legal('wa', 7, 4, 5, 2));
check('亚马步（e1→g2）', legal('wa', 7, 4, 5, 5));
check('亚不可走非直线非马步格', !legal('wa', 7, 4, 5, 0));

// ============ 编辑白名单 ============
{
    const g = makeRoom();
    check('编辑白名单含新棋子', ['we', 'wf', 'wc', 'wa', 'be', 'bf', 'bc', 'ba'].every(v => g.editBoardAllowedValues.includes(v)));
}

// ============ 升变仍限 q/r/n/b ============
function promoteTry(p) {
    const g = makeRoom();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board[r][c] = '';
    g.board[1][0] = 'wp';
    g.board[0][4] = 'bk';
    g.board[7][4] = 'wk';
    g.sideToMove = 'white';
    const r = g._applyMoveCore(1, 0, 0, 0, 'black', p);
    return r.ok ? g.board[0][0] : null;
}
check('升变为后成功', promoteTry('q') === 'wq');
check('升变为车成功', promoteTry('r') === 'wr');
check('升变不能为象(e)（被拒）', promoteTry('e') === null);
check('升变不能为士(f)（被拒）', promoteTry('f') === null);
check('升变不能为相(c)（被拒）', promoteTry('c') === null);
check('升变不能为亚(a)（被拒）', promoteTry('a') === null);

console.log('\n通过', pass, '失败', fail);
process.exit(fail ? 1 : 0);
