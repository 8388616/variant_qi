// 菱国际象棋规则测试（棋盘：行 3 竖对在 I=2,4,6,8）
const { R } = require('./games/rhombic-chess.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
const findId = (type, I, J) => R.CELL_INDEX[type + ',' + I + ',' + J];

// 1. 棋盘 72 格
check('棋盘 72 格', R.CELLS.length === 72);

// 2. 邻接合理性：边缘格 2-3 邻、内部格 4 邻；pointwise 0-2 个
let n4 = 0, pt2 = 0;
let bad = 0;
for (let i = 0; i < 72; i++) {
    const e = R.EDGE_NB[i].length, p = R.PT_NB[i].length;
    if (e === 4) n4++;
    if (p === 2) pt2++;
    if (e < 2 || e > 4 || p > 2) { bad++; console.log('  异常格', i, R.CELLS[i].type, R.CELLS[i].I, R.CELLS[i].J, 'edgewise', e, 'pointwise', p); }
}
check('邻接数量都在合理范围', bad === 0);
console.log('  内部格(4邻):', n4, '/72，有 pointwise 邻居的格:', R.PT_NB.filter(l => l.length).length);
check('存在 pointwise 连接（象线可用）', pt2 > 0);

// 3. 初始局面
const board = R.setup();
let wCount = 0, bCount = 0;
for (const k in board) { if (board[k][0] === 'w') wCount++; else bCount++; }
check('白 16 子', wCount === 16);
check('黑 16 子', bCount === 16);

// 4. 白先行，白方王有合法走法（无将杀）
const wmoves = R.allLegalMoves(board, 'white');
check('白方有合法走法', wmoves.length > 0);
check('白方不处于将军', !R.isInCheck(board, 'white'));

// 5. 白兵走法：行 9 白兵 r(1,6) → 前邻 h(1,3)，首步可 2 步到 r(0,3)
const wpId = findId('r', 1, 6);
const wpMoves = R.legalMovesFor(board, wpId, 'white');
console.log('  白兵 r(1,6) 合法目标:', wpMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('白兵 r(1,6) 可走到横(1,3)', wpMoves.some(m => m.to === findId('h', 1, 3)));
check('白兵 r(1,6) 首步可 2 步到竖右(0,3)', wpMoves.some(m => m.to === findId('r', 0, 3)));

// 6. 黑兵走法（行 3 黑兵 l(2,-3)，向下 2 步到 l(1,0)）
const bpId = findId('l', 2, -3);
const bpMoves = R.legalMovesFor(board, bpId, 'black');
console.log('  黑兵 l(2,-3) 合法目标:', bpMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('黑兵 l(2,-3) 可走到行 2 横(1,-3)', bpMoves.some(m => m.to === findId('h', 1, -3)));
check('黑兵 l(2,-3) 首步可 2 步到竖左(1,0)', bpMoves.some(m => m.to === findId('l', 1, 0)));

// 7. 车走法（白车 r(2,9)，edgewise 直线）
const wrId = findId('r', 2, 9);
const wrMoves = R.legalMovesFor(board, wrId, 'white');
console.log('  白车 r(2,9) 合法目标数:', wrMoves.length);
check('白车 r(2,9) 可走到横(2,6)', wrMoves.some(m => m.to === findId('h', 2, 6)));

// 8. 象走法：竖格上的象走 pointwise 直线 + edgewise 一步
const b8 = {};
b8['r,3,0'] = 'wb';   // 行 5 竖右
b8['l,5,-6'] = 'bk';
b8['l,7,-6'] = 'wk';
const wbId = findId('r', 3, 0);
const wbMoves = R.legalMovesFor(b8, wbId, 'white');
console.log('  竖格象 r(3,0) 目标:', wbMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('竖格象有走法', wbMoves.length > 0);
check('竖格象可 pointwise 斜行（到行 7 竖右(2,3)）', wbMoves.some(m => m.to === findId('r', 2, 3)));
check('竖格象可 edgewise 一步（到行 4 横(3,-3)）', wbMoves.some(m => m.to === findId('h', 3, -3)));

// 9. 马走法（白马 l(4,9)：edge+pt 组合跳跃）
const wnId = findId('l', 4, 9);
const wnMoves = R.legalMovesFor(board, wnId, 'white');
console.log('  白马 l(4,9) 合法目标数:', wnMoves.length, '目标:', wnMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('白马有走法', wnMoves.length > 0);

// 10. 后走法（后=车+象，edgewise 直线 + pointwise 斜线）
const b10 = {};
b10['r,3,0'] = 'wq';   // 行 5 竖右
b10['l,5,-6'] = 'bk';
b10['l,7,-6'] = 'wk';
const wqMoves = R.legalMovesFor(b10, findId('r', 3, 0), 'white');
console.log('  竖格后 r(3,0) 目标:', wqMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('白后有走法', wqMoves.length > 0);
check('白后可 pointwise 斜行（到行 7 竖右(2,3)）', wqMoves.some(m => m.to === findId('r', 2, 3)));
check('白后可 edgewise 直行（到行 5 竖左(3,0)）', wqMoves.some(m => m.to === findId('l', 3, 0)));

// 11. 王走法：edgewise 一步 + pointwise 一步
const b11 = {};
b11['l,6,9'] = 'wk';
b11['l,5,-6'] = 'bk';
const wkId = findId('l', 6, 9);
const wkMoves = R.legalMovesFor(b11, wkId, 'white');
console.log('  白王 l(6,9) 目标:', wkMoves.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ')').join(' '));
check('白王可 edgewise 一步（到行 10 横(6,6)）', wkMoves.some(m => m.to === findId('h', 6, 6)));
check('白王可 pointwise 一步（到行 9 竖左(5,6)）', wkMoves.some(m => m.to === findId('l', 5, 6)));

// 12. 一步合法移动后状态
const m0 = wmoves[0];
R.applyMove(board, m0);
check('白走一步后黑方有合法走法', R.allLegalMoves(board, 'black').length > 0);

// 13. 升变：白兵在行 4 横(3,-3) → 走到行 3 竖左(4,-3) 触发升变
const b3 = {};
b3['h,3,-3'] = 'wp';
b3['l,5,-6'] = 'bk';
b3['l,7,-6'] = 'wk';
const h33 = findId('h', 3, -3);
const l43 = findId('l', 4, -3);
const wpm = R.legalMovesFor(b3, h33, 'white');
console.log('  行4白兵 h(3,-3) 目标:', wpm.map(m => m.to + ':' + R.CELLS[m.to].type + '(' + R.CELLS[m.to].I + ',' + R.CELLS[m.to].J + ') 升变=' + m.promote).join(' '));
check('白兵到行 3 触发升变', wpm.some(m => m.promote === true && m.to === l43));

// 14. 将军检测：黑车 edgewise 攻击白王（行 5 竖对共享竖边）
const b4 = {};
b4['l,5,-6'] = 'bk';
b4['l,3,0'] = 'wk';
b4['r,3,0'] = 'br';
const wk2 = findId('l', 3, 0);
check('黑车 edgewise 攻击白王（将军）', R.isAttacked(b4, wk2, 'black'));

// 15. 象 pointwise 攻击：白象 r(3,0)（行 5）沿 pt 线攻击黑王（行 7 竖右(2,3)）
const b5 = {};
b5['r,3,0'] = 'wb';
b5['r,2,3'] = 'bk';
b5['l,7,-6'] = 'wk';
const r23 = findId('r', 2, 3);
check('白象 pointwise 攻击相邻格黑王', R.isAttacked(b5, r23, 'white'));

console.log('\n通过', pass, '失败', fail);
