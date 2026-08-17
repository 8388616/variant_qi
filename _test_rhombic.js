// 菱国际象棋规则测试（斜走 = 沿长边方向：横格水平、竖左左上-右下、竖右左下-右上）
const { R } = require('./games/rhombic-chess.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
const findId = (type, I, J) => R.CELL_INDEX[type + ',' + I + ',' + J];
const name = (id) => R.CELLS[id].type + '(' + R.CELLS[id].I + ',' + R.CELLS[id].J + ')';

// 1. 棋盘 72 格
check('棋盘 72 格', R.CELLS.length === 72);

// 2. 斜走邻接结构：横格水平、竖左左上-右下、竖右左下-右上
const d = (type, I, J) => R.DIAG_NB[findId(type, I, J)].map(name).join(', ');
check('h(4,0) 斜走 = h(6,0), h(2,0)', d('h', 4, 0) === 'h(6,0), h(2,0)');
check('l(3,0) 斜走 = l(4,3), l(2,-3)', d('l', 3, 0) === 'l(4,3), l(2,-3)');
check('r(3,0) 斜走 = r(4,-3), r(2,3)', d('r', 3, 0) === 'r(4,-3), r(2,3)');

// 3. 初始局面
const board = R.setup();
check('白 16 子黑 16 子', (() => {
    let w = 0, b = 0;
    for (const k in board) { if (board[k][0] === 'w') w++; else b++; }
    return w === 16 && b === 16;
})());
check('白方有合法走法且不将军', R.allLegalMoves(board, 'white').length > 0 && !R.isInCheck(board, 'white'));

// 4. 横格象斜走：白象 h(4,6) 沿水平线（同行横格）——右侧 h(6,6) 被己方象挡
const wb = R.legalMovesFor(board, findId('h', 4, 6), 'white');
console.log('  白象 h(4,6) 目标:', wb.map(m => name(m.to)).join(', '));
check('横格象可斜走到同行 h(2,6)', wb.some(m => m.to === findId('h', 2, 6)));
check('横格象斜走到 h(6,6) 被己方象挡（不可越过到 h(8,6)）', !wb.some(m => m.to === findId('h', 8, 6)));
// 空盘：横格象水平线全通
const b4 = {};
b4['h,4,0'] = 'wb';
b4['l,5,-6'] = 'bk';
b4['l,7,-6'] = 'wk';
const wb4 = R.legalMovesFor(b4, findId('h', 4, 0), 'white');
check('空盘横格象可走 h(0,0) 到 h(10,0) 全线', wb4.some(m => m.to === findId('h', 0, 0)) && wb4.some(m => m.to === findId('h', 10, 0)));

// 5. 竖格象斜走：竖左象沿左上-右下线（构造）
const b5 = {};
b5['l,3,0'] = 'wb';
b5['l,5,-6'] = 'bk';
b5['l,7,-6'] = 'wk';
const wb5 = R.legalMovesFor(b5, findId('l', 3, 0), 'white');
console.log('  竖左象 l(3,0) 目标:', wb5.map(m => name(m.to)).join(', '));
check('竖左象可斜走到 l(4,3)', wb5.some(m => m.to === findId('l', 4, 3)));
check('竖左象可斜走到 l(5,6)', wb5.some(m => m.to === findId('l', 5, 6)));
check('竖左象可斜走到 l(6,9)', wb5.some(m => m.to === findId('l', 6, 9)));
check('竖左象可斜走到左上 l(2,-3)', wb5.some(m => m.to === findId('l', 2, -3)));

// 6. 象斜走被阻隔：黑兵挡在斜线上
const b6 = {};
b6['l,3,0'] = 'wb';
b6['l,4,3'] = 'bp';
b6['l,5,-6'] = 'bk';
b6['l,7,-6'] = 'wk';
const wb6 = R.legalMovesFor(b6, findId('l', 3, 0), 'white');
check('斜线上有黑兵时不可越过（不可到 l(5,6)）', !wb6.some(m => m.to === findId('l', 5, 6)));
check('斜线上有黑兵时可吃 l(4,3)', wb6.some(m => m.to === findId('l', 4, 3)));

// 7. 竖右象斜走：左下-右上
const b7 = {};
b7['r,3,0'] = 'wb';
b7['l,5,-6'] = 'bk';
b7['l,7,-6'] = 'wk';
const wb7 = R.legalMovesFor(b7, findId('r', 3, 0), 'white');
console.log('  竖右象 r(3,0) 目标:', wb7.map(m => name(m.to)).join(', '));
check('竖右象可斜走到 r(4,-3)', wb7.some(m => m.to === findId('r', 4, -3)));
check('竖右象可斜走到 r(5,-6)', wb7.some(m => m.to === findId('r', 5, -6)));
check('竖右象可斜走到右上 r(2,3)', wb7.some(m => m.to === findId('r', 2, 3)));

// 8. 后 = 车 + 象（edgewise 直线 + 斜走直线）
const b8 = {};
b8['r,3,0'] = 'wq';
b8['l,5,-6'] = 'bk';
b8['l,7,-6'] = 'wk';
const wq8 = R.legalMovesFor(b8, findId('r', 3, 0), 'white');
check('后斜走（到 r(4,-3)）', wq8.some(m => m.to === findId('r', 4, -3)));
check('后车行（到 l(3,0)）', wq8.some(m => m.to === findId('l', 3, 0)));

// 9. 马：先邻格再斜格（单向）
const b9 = {};
b9['l,4,9'] = 'wn';
b9['l,5,-6'] = 'bk';
b9['l,7,-6'] = 'wk';
const wn9 = R.legalMovesFor(b9, findId('l', 4, 9), 'white');
console.log('  白马 l(4,9) 目标:', wn9.map(m => name(m.to)).join(', '));
check('白马有走法', wn9.length > 0);
// 白马 l(4,9) 邻格 = h(4,6) r(4,9) h(6,6) l(6,9)
// 马先邻后斜：h(4,6) 的斜走 = h(2,6) h(6,6)——h(6,6) 空 ✓
check('马先邻后斜（h(4,6)→h(6,6) 邻格起）', wn9.some(m => m.to === findId('h', 6, 6)));
// r(4,9) 的斜走 = r(5,6)（左下）
check('马先邻后斜（r(4,9)→r(5,6)）', wn9.some(m => m.to === findId('r', 5, 6)));
// 单向：不可"先斜后邻"（l(4,9) 斜走 l(3,6) 的邻格 h(3,3)/r(1,6) 不可达）
check('马不可先斜后邻（h(3,3) 不可达）', !wn9.some(m => m.to === findId('h', 3, 3)));
check('马不可先斜后邻（r(1,6) 不可达）', !wn9.some(m => m.to === findId('r', 1, 6)));

// 10. 兵：向前一步 + 首步两步
const wp = R.legalMovesFor(board, findId('r', 1, 6), 'white');
console.log('  白兵 r(1,6) 目标:', wp.map(m => name(m.to)).join(', '));
check('白兵 r(1,6) 向前 h(1,3)', wp.some(m => m.to === findId('h', 1, 3)));
check('白兵 r(1,6) 首步双步 r(0,3)', wp.some(m => m.to === findId('r', 0, 3)));
check('白兵双步标记 passed=h(1,3)', wp.some(m => m.to === findId('r', 0, 3) && m.doubleStep && m.doubleStep.passed === findId('h', 1, 3)));

// 11. 兵斜吃：竖格兵斜前方有敌子
const b11 = {};
b11['r,3,0'] = 'wp';
b11['r,4,-3'] = 'bp';   // 斜前方（左下）
b11['h,3,-3'] = 'bp';   // 前方直格被占
b11['l,5,-6'] = 'bk';
b11['l,7,-6'] = 'wk';
const wp11 = R.legalMovesFor(b11, findId('r', 3, 0), 'white');
console.log('  白兵 r(3,0) 目标:', wp11.map(m => name(m.to)).join(', '));
check('白兵可斜吃 r(4,-3)', wp11.some(m => m.to === findId('r', 4, -3)));
check('白兵不可直走到被占的 h(3,-3)', !wp11.some(m => m.to === findId('h', 3, -3)));
check('白兵不可斜吃 h(3,-3)（直前方不是斜吃）', !wp11.some(m => m.to === findId('h', 3, -3)));

// 12. 横格兵不能吃子（斜走为水平方向，前方无斜格）
const b12 = {};
b12['h,3,3'] = 'wp';
b12['h,1,3'] = 'bp';   // 水平斜格有敌子
b12['l,5,-6'] = 'bk';
b12['l,7,-6'] = 'wk';
const wp12 = R.legalMovesFor(b12, findId('h', 3, 3), 'white');
console.log('  横格白兵 h(3,3) 目标:', wp12.map(m => name(m.to)).join(', '));
check('横格兵不能斜吃水平敌子 h(1,3)', !wp12.some(m => m.to === findId('h', 1, 3)));
check('横格兵目标只有直走（r(2,3) l(4,3) 及其 2 步）', wp12.every(m => m.to === findId('r', 2, 3) || m.to === findId('l', 4, 3) || m.to === findId('h', 2, 0) || m.to === findId('h', 4, 0)));

// 13. 吃过路兵：兵双步后（记录经过格），对方兵可斜吃经过格
// 注：本棋盘布局下实际对局中竖格兵双步的经过格必为横格，而横格兵无前方斜格，
// 故 en passant 在实战中不会出现；此处直接构造 ep 状态验证规则逻辑本身。
const b13 = {};
b13['l,2,3'] = 'wp';        // 白兵行 7 竖左
b13['l,1,0'] = '';          // 经过格（空）
b13['l,2,-3'] = 'bp';       // 跳越的黑兵（原位置，行 3）
b13['l,5,-6'] = 'bk';
b13['l,7,-6'] = 'wk';
const ep13 = { passedId: findId('l', 1, 0), pawnKey: 'l,2,-3' };
const wp13 = R.legalMovesFor(b13, findId('l', 2, 3), 'white', ep13);
console.log('  白兵 l(2,3)（ep 场景）目标:', wp13.map(m => name(m.to) + (m.enPassant ? '(吃过路兵)' : '')).join(', '));
check('吃过路兵目标出现（斜吃经过格）', wp13.some(m => m.to === findId('l', 1, 0) && m.enPassant));
// 执行验证：applyMove 后跳越兵被吃掉
const b13b = JSON.parse(JSON.stringify(b13));
R.applyMove(b13b, { from: findId('l', 2, 3), to: findId('l', 1, 0) }, ep13);
check('吃过路兵执行后跳越兵被移除', !b13b['l,2,-3'] && b13b['l,1,0'] !== undefined);
// 无 ep 时不可走到空经过格
const wp13c = R.legalMovesFor(b13, findId('l', 2, 3), 'white');
check('无 ep 状态时不可走到 l(1,0)', !wp13c.some(m => m.to === findId('l', 1, 0)));
// 黑兵双步的真实标记（服务端记录用）
const bp13 = R.legalMovesFor(board, findId('r', 4, -3), 'black');
console.log('  黑兵 r(4,-3) 目标:', bp13.map(m => name(m.to) + (m.doubleStep ? '(双步过' + name(m.doubleStep.passed) + ')' : '')).join(', '));
check('黑兵 r(4,-3) 可双步并带经过格标记', bp13.some(m => m.doubleStep && m.doubleStep.passed === findId('h', 5, -3)));

// 14. 王：edgewise 一步 + 斜走一步
const b14 = {};
b14['l,6,9'] = 'wk';
b14['l,5,-6'] = 'bk';
const wk14 = R.legalMovesFor(b14, findId('l', 6, 9), 'white');
console.log('  白王 l(6,9) 目标:', wk14.map(m => name(m.to)).join(', '));
check('白王 edgewise 一步（h(6,6)）', wk14.some(m => m.to === findId('h', 6, 6)));
check('白王斜走一步（l(5,6)）', wk14.some(m => m.to === findId('l', 5, 6)));

// 15. 升变：白兵到行 2、黑兵到行 10
const b15 = {};
b15['h,3,-3'] = 'wp';
b15['l,5,-6'] = 'bk';
b15['l,7,-6'] = 'wk';
const wpm = R.legalMovesFor(b15, findId('h', 3, -3), 'white');
check('白兵到行 3 不升变', !wpm.some(m => m.promote === true && (m.to === findId('l', 4, -3) || m.to === findId('r', 2, -3))));
check('白兵到行 2 触发升变', wpm.some(m => m.promote === true && m.to === findId('h', 4, -6)));
// 黑兵到行 10（白象行）升变：黑兵放行 9 竖左 (3,6) → 走到行 10 横格
const b15b = {};
b15b['l,3,6'] = 'bp';
b15b['l,5,-6'] = 'bk';
b15b['l,7,-6'] = 'wk';
const bpm = R.legalMovesFor(b15b, findId('l', 3, 6), 'black');
console.log('  行9黑兵 l(3,6) 目标:', bpm.map(m => name(m.to) + ' 升变=' + m.promote).join(', '));
check('黑兵到行 10 触发升变', bpm.some(m => m.promote === true && m.to === findId('h', 2, 6)));

// 16. 将军检测
const b16 = {};
b16['l,5,-6'] = 'bk';
b16['l,3,0'] = 'wk';
b16['r,3,0'] = 'br';
check('黑车 edgewise 攻击白王', R.isAttacked(b16, findId('l', 3, 0), 'black'));

console.log('\n通过', pass, '失败', fail);
