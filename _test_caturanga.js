// 古印度象棋（Chaturanga）规则测试
const { R } = require('./games/caturanga.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
function setup(cells) {
    const b = R.emptyBoard();
    for (const [k, v] of Object.entries(cells)) {
        const [r, c] = k.split(',').map(Number);
        b[r][c] = v;
    }
    return b;
}
const M = () => R.createInitialMeta();
const board = R.createInitialBoard();

// 1. 初始布局：黑王 d8、黑士 e8；白士 d1、白王 e1
check('黑王 d8、黑士 e8', board[0][3] === 'bk' && board[0][4] === 'bf');
check('白士 d1、白王 e1', board[7][3] === 'wf' && board[7][4] === 'wk');

// 2. 无易位
const wm = R.generateLegalMoves(board, 'white', M());
check('白王无易位走法', !wm.some(m => m.fromRow === 7 && m.fromCol === 4 && Math.abs(m.toCol - 4) === 2));

// 3. 兵无首步两步
check('白兵无首步两步', !wm.some(m => m.fromRow === 6 && Math.abs(m.toRow - 6) === 2));

// 4. 象斜走两步不卡眼
check('白象 c1 可到 a3（跳过 b2 兵）', wm.some(m => m.fromRow === 7 && m.fromCol === 2 && m.toRow === 5 && m.toCol === 0));
check('白象 c1 不可走三步（d4）', !wm.some(m => m.fromRow === 7 && m.fromCol === 2 && m.toRow === 4 && m.toCol === 3));
// 象可吃两步外敌子（不卡眼）
let b = setup({ '7,2': 'wb', '5,0': 'bn', '6,1': 'wp', '0,4': 'bk', '7,4': 'wk' });
check('象跳过中间兵吃两步外黑马', R.generateLegalMoves(b, 'white', M()).some(m => m.fromRow === 7 && m.fromCol === 2 && m.toRow === 5 && m.toCol === 0));

// 5. 士斜走一步
b = setup({ '7,3': 'wf', '0,4': 'bk', '7,4': 'wk' });
const fz = R.generateLegalMoves(b, 'white', M()).filter(m => m.fromRow === 7 && m.fromCol === 3);
console.log('  白士 d1 目标:', fz.map(m => m.toRow + ',' + m.toCol).join(' '));
check('士斜走一步（e2、c2）', fz.some(m => m.toRow === 6 && m.toCol === 4) && fz.some(m => m.toRow === 6 && m.toCol === 2));
check('士不可走两步', !fz.some(m => Math.abs(m.toRow - 7) > 1));

// 6. 后（升变得来）标准走法
b = setup({ '7,4': 'wq', '0,4': 'bk', '5,0': 'wk' });
const qm = R.generateLegalMoves(b, 'white', M()).filter(m => m.fromRow === 7 && m.fromCol === 4);
check('后车行（e2/e3/e4）', qm.some(m => m.toRow === 6 && m.toCol === 4) && qm.some(m => m.toRow === 4 && m.toCol === 4));
check('后斜行（d2）', qm.some(m => m.toRow === 6 && m.toCol === 3));

// 7. 自动升变：列对应 + 缺少棋子条件
b = setup({ '1,0': 'wp', '0,4': 'bk', '7,4': 'wk' });
check('a8 升变为车（己方无车）', R.applyMoveOnBoard(b, 1, 0, 0, 0, M(), null).board[0][0] === 'wr');
b = setup({ '1,0': 'wp', '2,0': 'wr', '7,0': 'wr', '0,4': 'bk', '7,4': 'wk' });
check('a8 升变为士（己方 2 车）', R.applyMoveOnBoard(b, 1, 0, 0, 0, M(), null).board[0][0] === 'wf');
b = setup({ '1,1': 'wp', '0,1': 'bn', '7,1': 'wn', '0,4': 'bk', '7,4': 'wk' });
check('b8 升变为马（己方 1 马）', R.applyMoveOnBoard(b, 1, 1, 0, 1, M(), null).board[0][1] === 'wn');
b = setup({ '1,3': 'wp', '0,4': 'bk', '7,4': 'wk' });
check('d8 升变为士（无条件）', R.applyMoveOnBoard(b, 1, 3, 0, 3, M(), null).board[0][3] === 'wf');
b = setup({ '1,4': 'wp', '0,4': 'bk', '7,4': 'wk' });
check('e8 升变为后（己方无后）', R.applyMoveOnBoard(b, 1, 4, 0, 4, M(), null).board[0][4] === 'wq');
b = setup({ '1,4': 'wp', '3,3': 'wq', '0,4': 'bk', '7,4': 'wk' });
check('e8 升变为士（己方有后）', R.applyMoveOnBoard(b, 1, 4, 0, 4, M(), null).board[0][4] === 'wf');
b = setup({ '6,0': 'bp', '0,4': 'bk', '7,4': 'wk' });
check('黑兵 a1 升变为车', R.applyMoveOnBoard(b, 6, 0, 7, 0, M(), null).board[7][0] === 'br');

// 8. 升变走法单一（无需选择）
b = setup({ '1,0': 'wp', '0,4': 'bk', '7,4': 'wk' });
const pm = R.generateLegalMoves(b, 'white', M()).filter(m => m.fromRow === 1 && m.fromCol === 0 && m.toRow === 0);
check('升变走法单一（promote null）', pm.length === 1 && pm[0].promote === null);

// 9. 黑方王后调换后白方视角黑王在左
check('黑王在 d8（白方视角左侧）', board[0][3] === 'bk' && board[0][4] === 'bf');

// 10. 困毙：无合法走法且不被将军 → 判负（类似中国象棋）
b = setup({ '0,7': 'bk', '2,5': 'wk', '1,6': 'wr' });
check('困毙局面：黑方无合法走法', R.generateLegalMoves(b, 'black', M()).length === 0);
check('困毙局面：黑方不被将军', !R.isInCheck(b, 'black'));
check('困毙局面：白王 f6→f7 后黑方仍无合法走法', R.generateLegalMoves(R.applyMoveOnBoard(b, 2, 5, 1, 5, M(), null).board, 'black', M()).length === 0);

console.log('\n通过', pass, '失败', fail);
