// 菱国际象棋规则测试（行列坐标：row 0-10、col 0 起从左到右）
const { R } = require('./games/rhombic-chess.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
const name = (id) => {
    const c = R.CELLS[id];
    return c.type + '(' + c.row + ',' + c.col + ')';
};

// 1. 棋盘 72 格 + 行格数
check('棋盘 72 格', R.CELLS.length === 72);
check('行格数 [6,4,8,5,10,6,10,5,8,4,6]', (() => {
    const lens = [];
    for (let r = 0; r < 11; r++) lens.push(R.CELLS.filter(c => c.row === r).length);
    return lens.join(',') === '6,4,8,5,10,6,10,5,8,4,6';
})());

// 2. 斜走邻接：横格水平、竖左左上-右下、竖右左下-右上
const d = (row, col) => R.DIAG_NB[R.cellIdOf(row, col)].map(name).join(', ');
check('h(5,0) 斜走 = h(5,1)', d(5, 0) === 'h(5,1)');
check('l(4,0) 斜走 = l(6,1)', d(4, 0) === 'l(6,1)');
check('r(4,1) 斜走 = r(6,0), r(2,1)', d(4, 1) === 'r(6,0), r(2,1)');

// 3. 初始局面
const board = R.setup();
check('白 16 子黑 16 子', (() => {
    let w = 0, b = 0;
    for (const k in board) { if (board[k][0] === 'w') w++; else b++; }
    return w === 16 && b === 16;
})());
check('白方有合法走法且不将军', R.allLegalMoves(board, 'white').length > 0 && !R.isInCheck(board, 'white'));

// 4. 横格象斜走：白象 (9,1)（原 h(4,6)）同行水平线
const wb = R.legalMovesFor(board, R.cellIdOf(9, 1), 'white');
console.log('  白象 (9,1) 目标:', wb.map(m => name(m.to)).join(', '));
check('横格象可斜走到 (9,0)', wb.some(m => m.to === R.cellIdOf(9, 0)));
check('横格象被 (9,2) 己方象挡（不可到 (9,3)）', !wb.some(m => m.to === R.cellIdOf(9, 3)));

// 5. 竖格象斜走：竖左象 (4,2)（原 l(3,0)）沿左上-右下斜线
const b5 = {};
b5['4,2'] = 'wb';
b5['0,4'] = 'bk';
b5['0,2'] = 'wk';
const wb5 = R.legalMovesFor(b5, R.cellIdOf(4, 2), 'white');
console.log('  竖左象 (4,2) 目标:', wb5.map(m => name(m.to)).join(', '));
check('竖左象斜走到 (6,3)', wb5.some(m => m.to === R.cellIdOf(6, 3)));
check('竖左象斜走到 (8,3)', wb5.some(m => m.to === R.cellIdOf(8, 3)));
check('竖左象斜走到 (10,3)', wb5.some(m => m.to === R.cellIdOf(10, 3)));
check('竖左象斜走到左上 (2,0)', wb5.some(m => m.to === R.cellIdOf(2, 0)));

// 6. 象斜走被阻隔
const b6 = {};
b6['4,2'] = 'wb';
b6['6,3'] = 'bp';
b6['0,4'] = 'bk';
b6['0,2'] = 'wk';
const wb6 = R.legalMovesFor(b6, R.cellIdOf(4, 2), 'white');
check('斜线上有黑兵不可越过（不可到 (8,3)）', !wb6.some(m => m.to === R.cellIdOf(8, 3)));
check('斜线上有黑兵可吃 (6,3)', wb6.some(m => m.to === R.cellIdOf(6, 3)));

// 7. 竖右象斜走：左下-右上（(4,3) = 原 r(3,0)）
const b7 = {};
b7['4,3'] = 'wb';
b7['0,4'] = 'bk';
b7['0,2'] = 'wk';
const wb7 = R.legalMovesFor(b7, R.cellIdOf(4, 3), 'white');
console.log('  竖右象 (4,3) 目标:', wb7.map(m => name(m.to)).join(', '));
check('竖右象斜走到 (6,2)（右上）', wb7.some(m => m.to === R.cellIdOf(6, 2)));
check('竖右象斜走到 (2,3)（左下）', wb7.some(m => m.to === R.cellIdOf(2, 3)));

// 8. 后 = 车 + 象
const b8 = {};
b8['4,3'] = 'wq';
b8['0,4'] = 'bk';
b8['0,2'] = 'wk';
const wq8 = R.legalMovesFor(b8, R.cellIdOf(4, 3), 'white');
check('后斜走（到 (6,2)）', wq8.some(m => m.to === R.cellIdOf(6, 2)));
check('后车行（到 (4,4)）', wq8.some(m => m.to === R.cellIdOf(4, 4)));

// 9. 马：先邻格再斜格（单向）
const b9 = {};
b9['10,1'] = 'wn';   // 原 l(4,9)
b9['0,4'] = 'bk';
b9['0,2'] = 'wk';
const wn9 = R.legalMovesFor(b9, R.cellIdOf(10, 1), 'white');
console.log('  白马 (10,1) 目标:', wn9.map(m => name(m.to)).join(', '));
check('白马有走法', wn9.length > 0);
check('马先邻后斜（h(9,1)→h(9,0)）', wn9.some(m => m.to === R.cellIdOf(9, 0)));
check('马先邻后斜（r(10,2)→r(8,2)）', wn9.some(m => m.to === R.cellIdOf(8, 2)));

// 10. 兵：向前 + 首步双步
const wp = R.legalMovesFor(board, R.cellIdOf(8, 0), 'white');
console.log('  白兵 (8,0) 目标:', wp.map(m => name(m.to) + (m.doubleStep ? '(双步过' + name(m.doubleStep.passed) + ')' : '')).join(', '));
check('白兵 (8,0) 向前 (7,0)', wp.some(m => m.to === R.cellIdOf(7, 0)));
check('白兵 (8,0) 首步双步 (6,0)', wp.some(m => m.to === R.cellIdOf(6, 0)));

// 11. 兵斜吃：竖格兵斜前方有敌子（白兵 (6,1) 竖左，斜前方左上 = (4,0)）
const b11 = {};
b11['6,1'] = 'wp';
b11['4,0'] = 'bp';
b11['0,4'] = 'bk';
b11['0,2'] = 'wk';
const wp11 = R.legalMovesFor(b11, R.cellIdOf(6, 1), 'white');
console.log('  白兵 (6,1) 目标:', wp11.map(m => name(m.to)).join(', '));
check('白兵可斜吃 (4,0)', wp11.some(m => m.to === R.cellIdOf(4, 0)));

// 12. 横格兵不能吃子
const b12 = {};
b12['7,0'] = 'wp';
b12['7,1'] = 'bp';   // 水平斜格有敌子
b12['0,4'] = 'bk';
b12['0,2'] = 'wk';
const wp12 = R.legalMovesFor(b12, R.cellIdOf(7, 0), 'white');
check('横格兵不能斜吃水平敌子 (7,1)', !wp12.some(m => m.to === R.cellIdOf(7, 1)));

// 13. 吃过路兵逻辑
const b13 = {};
b13['6,1'] = 'wp';   // 白兵行 7 竖左
b13['4,0'] = '';     // 经过格（空）
b13['2,0'] = 'bp';   // 跳越的黑兵
b13['0,4'] = 'bk';
b13['0,2'] = 'wk';
const ep13 = { passedId: R.cellIdOf(4, 0), pawnKey: '2,0' };
const wp13 = R.legalMovesFor(b13, R.cellIdOf(6, 1), 'white', ep13);
console.log('  白兵 (6,0)（ep 场景）目标:', wp13.map(m => name(m.to) + (m.enPassant ? '(吃过路兵)' : '')).join(', '));
check('吃过路兵目标出现', wp13.some(m => m.to === R.cellIdOf(4, 0) && m.enPassant));
const wp13c = R.legalMovesFor(b13, R.cellIdOf(6, 1), 'white');
check('无 ep 状态时不可走到 (4,0)', !wp13c.some(m => m.to === R.cellIdOf(4, 0)));

// 14. 王：edgewise 一步 + 斜走一步
const b14 = {};
b14['10,3'] = 'wk';
b14['0,4'] = 'bk';
const wk14 = R.legalMovesFor(b14, R.cellIdOf(10, 3), 'white');
console.log('  白王 (10,3) 目标:', wk14.map(m => name(m.to)).join(', '));
check('白王 edgewise 一步（(9,2)）', wk14.some(m => m.to === R.cellIdOf(9, 2)));
check('白王斜走一步（(8,3)）', wk14.some(m => m.to === R.cellIdOf(8, 3)));

// 15. 升变：白兵到 row 1、黑兵到 row 9
const b15 = {};
b15['3,0'] = 'wp';
b15['0,4'] = 'bk';
b15['0,2'] = 'wk';
const wpm = R.legalMovesFor(b15, R.cellIdOf(3, 0), 'white');
console.log('  白兵 (3,0) 目标:', wpm.map(m => name(m.to) + ' 升变=' + m.promote).join(', '));
check('白兵到 row 2 不升变', !wpm.some(m => m.promote === true && m.to === R.cellIdOf(2, 0)));
check('白兵到 row 1 触发升变', wpm.some(m => m.promote === true && m.to === R.cellIdOf(1, 0)));
// 黑兵到 row 9
const b15b = {};
b15b['7,0'] = 'bp';
b15b['0,4'] = 'bk';
b15b['0,2'] = 'wk';
const bpm = R.legalMovesFor(b15b, R.cellIdOf(7, 0), 'black');
check('黑兵到 row 9 触发升变', bpm.some(m => m.promote === true && m.to === R.cellIdOf(9, 0)));

// 16. 将军检测
const b16 = {};
b16['0,4'] = 'bk';
b16['4,0'] = 'wk';
b16['4,1'] = 'br';
check('黑车 edgewise 攻击白王', R.isAttacked(b16, R.cellIdOf(4, 0), 'black'));

console.log('\n通过', pass, '失败', fail);
