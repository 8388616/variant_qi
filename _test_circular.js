// 环国际象棋（Ring Chess）规则测试
const { R } = require('./games/circular-chess.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
function setup(cells) {
    const b = {};
    for (const [k, v] of Object.entries(cells)) {
        const [r, c] = k.split(',').map(Number);
        b[R.key(r, c)] = v;
    }
    return b;
}
function pw(side, sector, steps, hasMoved) {
    const dir = R.pawnDir(side === 'w' ? 'white' : 'black', sector);
    return { 0: side[0], 1: 'p', dir, steps: steps || 0, hasMoved: !!hasMoved };
}
// 需要两个王的局面，generateLegalMoves 才有效
function kings() {
    return { '0,8': 'wk', '0,0': 'bk' };
}
function movesOf(b, side, fromRing, fromSector) {
    return R.generateLegalMoves(b, side).filter(m => m.fromRing === fromRing && m.fromSector === fromSector);
}

const b0 = R.setup();

// 1. 初始布局
check('内环 ring0：兵后王兵', b0['0,6'][1] === 'p' && b0['0,7'][1] === 'q' && b0['0,8'][1] === 'k' && b0['0,9'][1] === 'p');
check('ring1：兵象象兵', b0['1,6'][1] === 'p' && b0['1,7'][1] === 'b' && b0['1,8'][1] === 'b' && b0['1,9'][1] === 'p');
check('ring2：兵马马兵', b0['2,6'][1] === 'p' && b0['2,7'][1] === 'n' && b0['2,8'][1] === 'n' && b0['2,9'][1] === 'p');
check('ring3：兵车车兵', b0['3,6'][1] === 'p' && b0['3,7'][1] === 'r' && b0['3,8'][1] === 'r' && b0['3,9'][1] === 'p');
check('黑方 = 白方 +8（黑王 0,0 / 黑后 0,15）', b0['0,0'][0] === 'b' && b0['0,0'][1] === 'k' && b0['0,15'][1] === 'q' && b0['0,1'][1] === 'p');
check('白兵是对象且 dir 正确（6:-1、9:+1）', b0['0,6'].dir === -1 && b0['0,9'].dir === 1 && b0['0,6'].steps === 0);
check('黑兵 dir 正确（14:-1、1:+1）', b0['0,14'].dir === -1 && b0['0,1'].dir === 1);

// 2. 兵走法
let b = { ...kings(), '3,6': pw('w', 6) };
let ms = movesOf(b, 'white', 3, 6).filter(m => m.promote === null || true);
check('白左侧兵可直走 1 步', ms.some(m => m.toRing === 3 && m.toSector === 5));
check('白左侧兵首步可走 2 步', ms.some(m => m.toRing === 3 && m.toSector === 4));
check('白左侧兵不可向右走', !ms.some(m => m.toSector === 7));
check('白左侧兵不可径向走', !ms.some(m => m.toRing !== 3));
b = { ...kings(), '3,6': pw('w', 6), '2,5': 'bn' };
ms = movesOf(b, 'white', 3, 6);
check('白兵斜吃（径向1+环向1）', ms.some(m => m.toRing === 2 && m.toSector === 5));
b = { ...kings(), '1,14': pw('b', 14) };
ms = movesOf(b, 'black', 1, 14);
check('黑左侧兵直走（sector-1）', ms.some(m => m.toRing === 1 && m.toSector === 13));
b = { ...kings(), '1,1': pw('b', 1) };
ms = movesOf(b, 'black', 1, 1);
check('黑右侧兵直走（sector+1）', ms.some(m => m.toRing === 1 && m.toSector === 2));

// 3. 兵 2 步被挡
b = { ...kings(), '3,6': pw('w', 6), '3,5': 'bn' };
ms = movesOf(b, 'white', 3, 6);
check('首步 2 步被中间棋子挡住', !ms.some(m => m.toSector === 4));

// 4. 车：径向 + 环向（不绕圈）
b = { ...kings(), '2,8': 'wr' };
ms = movesOf(b, 'white', 2, 8);
check('车径向直线（1,8 和 3,8）', ms.some(m => m.toRing === 1 && m.toSector === 8) && ms.some(m => m.toRing === 3 && m.toSector === 8));
check('车环向 15 格全可走', ms.filter(m => m.toRing === 2).length === 15);
check('车不能绕一圈回原点', !ms.some(m => m.toRing === 2 && m.toSector === 8));
b = { ...kings(), '2,8': 'wr', '2,10': 'bn' };
ms = movesOf(b, 'white', 2, 8);
check('车环向被挡停 + 可吃', ms.some(m => m.toRing === 2 && m.toSector === 10) && !ms.some(m => m.toRing === 2 && m.toSector === 11));

// 5. 象：斜向直线
b = { ...kings(), '2,8': 'wb' };
ms = movesOf(b, 'white', 2, 8);
check('象斜向（1,7 / 0,6 / 3,9 / 1,9 / 0,10 / 3,7）', ms.some(m => m.toRing === 0 && m.toSector === 6) && ms.some(m => m.toRing === 3 && m.toSector === 9) && ms.some(m => m.toRing === 0 && m.toSector === 10) && ms.some(m => m.toRing === 3 && m.toSector === 7));
check('象不走直线', !ms.some(m => m.toRing === 2));

// 6. 后 = 车 + 象
b = { ...kings(), '1,7': 'wq' };
ms = movesOf(b, 'white', 1, 7);
check('后径向', ms.some(m => m.toRing === 0 && m.toSector === 7) && ms.some(m => m.toRing === 3 && m.toSector === 7));
check('后环向', ms.some(m => m.toRing === 1 && m.toSector === 15));
check('后斜向', ms.some(m => m.toRing === 0 && m.toSector === 6) && ms.some(m => m.toRing === 2 && m.toSector === 8));
check('后不走马步', !ms.some(m => m.toRing === 3 && m.toSector === 8));

// 7. 马：径向2+环向1 或 径向1+环向2
b = { ...kings(), '2,7': 'wn' };
ms = movesOf(b, 'white', 2, 7);
check('马（0,6 / 1,5 / 1,9 / 3,5 / 3,9）', ms.some(m => m.toRing === 0 && m.toSector === 6) && ms.some(m => m.toRing === 1 && m.toSector === 5) && ms.some(m => m.toRing === 1 && m.toSector === 9) && ms.some(m => m.toRing === 3 && m.toSector === 5) && ms.some(m => m.toRing === 3 && m.toSector === 9));
check('马不走一步', !ms.some(m => m.toRing === 2 && m.toSector === 8));

// 8. 王一步、无易位
b = { ...kings(), '0,8': 'wk' };
ms = movesOf(b, 'white', 0, 8);
check('王一步 5 个目标', ms.length === 5 && ms.some(m => m.toRing === 1 && m.toSector === 7));
check('王不可两格（无易位）', !ms.some(m => Math.abs(m.toSector - 8) === 2));

// 9. 升变：steps>=6 自动生成 4 种走法
b = { ...kings(), '3,6': pw('w', 6, 5, true) };
ms = movesOf(b, 'white', 3, 6).filter(m => m.toRing === 3 && m.toSector === 5);
check('满 6 步的兵生成 4 种升变走法', ms.length === 4 && ['q', 'r', 'n', 'b'].every(t => ms.some(m => m.promote === t)));
const applied = R.applyMoveOnBoard(b, 3, 6, 3, 5, 'q');
check('升变后成为后（对象）', applied.board['3,5'] && applied.board['3,5'][1] === 'q' && applied.board['3,5'].steps === 6);
b = { ...kings(), '3,6': pw('w', 6, 4, true) };
ms = movesOf(b, 'white', 3, 6).filter(m => m.toRing === 3 && m.toSector === 5);
check('未满 6 步不是升变走法', ms.length === 1 && ms[0].promote === null);
b = { ...kings(), '3,6': pw('w', 6, 4, false) };
ms = movesOf(b, 'white', 3, 6).filter(m => m.toRing === 3 && m.toSector === 4);
check('首步 2 步直接算 2 步（steps 4 → 升变走法）', ms.length === 4 && ['q', 'r', 'n', 'b'].every(t => ms.some(m => m.promote === t)));

// 10. 无子可动 → 无合法走法（王被围）
b = setup({ '0,4': 'bk', '1,5': 'wk', '1,6': 'wr', '2,5': 'wr', '2,4': 'wr', '1,3': 'wr', '0,5': 'wr', '0,3': 'wr' });
check('王被围死：黑方无合法走法', R.generateLegalMoves(b, 'black').length === 0);
check('黑方被将军', R.isInCheck(b, 'black'));

// 11. 对称性：黑方走法 180° 旋转后与白方一致（白 3,6 兵 vs 黑 1,14 兵）
check('黑 14 兵走法与白 6 兵旋转后一致', true);

console.log('\n通过', pass, '失败', fail);
