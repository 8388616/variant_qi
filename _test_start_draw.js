// 编辑后开局：初始行棋方（白方）无子可动（含只能送将）→ 直接判和（国际象棋/六角/菱/环）
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('✓', name); }
    else { fail++; console.log('✗', name); }
}
function makeRoom(mod) {
    const room = { gameLogic: null, maxPlayers: 0, getPlayerBySlot: () => null, getSlotByWs: () => null };
    mod.initRoom(room);
    return room.gameLogic;
}

// ============ 国际象棋：白王 e1 被三车封死并被将军 ============
{
    const g = makeRoom(require('./games/chess.js'));
    g.resetToEmpty();
    const b = g.board;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) b[r][c] = '';
    b[7][4] = 'wk'; b[0][4] = 'bk';
    b[6][2] = 'br'; b[7][2] = 'br'; b[7][5] = 'br';
    g.sideToMove = 'white';
    g.onMatchStarted();
    check('国际象棋：判和', g.gameOver && g.winner === 'draw');
    check('国际象棋：白方无子可动，和棋', g.recordResultText === '白方无子可动，和棋');
}

// ============ 六角国际象棋：白王 (10,3) 被两车封死并被将军 ============
{
    const g = makeRoom(require('./games/hexagon-chess.js'));
    g.resetToEmpty();
    const b = g.board;
    for (let r = 0; r < b.length; r++) for (let c = 0; c < b[r].length; c++) b[r][c] = '';
    b[10][3] = 'wk'; b[0][3] = 'bk';
    b[9][1] = 'br'; b[10][1] = 'br';
    g.sideToMove = 'white';
    g.onMatchStarted();
    check('六角国际象棋：判和', g.gameOver && g.winner === 'draw');
    check('六角国际象棋：白方无子可动，和棋', g.recordResultText === '白方无子可动，和棋');
}

// ============ 菱国际象棋：白王 (10,3) 被两车封死（菱形几何直线：车(7,2) 封 9,2/10,4/8,3，车(10,0) 封 10,2） ============
{
    const g = makeRoom(require('./games/rhombic-chess.js'));
    g.resetToEmpty();
    const b = g.board;
    for (const k in b) delete b[k];
    b['10,3'] = 'wk'; b['0,3'] = 'bk';
    b['7,2'] = 'br';
    b['10,0'] = 'br';
    g.sideToMove = 'white';
    g.onMatchStarted();
    check('菱国际象棋：判和', g.gameOver && g.winner === 'draw');
    check('菱国际象棋：白方无子可动，和棋', g.recordResultText === '白方无子可动，和棋');
}

// ============ 环国际象棋：白王 (0,4) 被 5 个死兵围住 ============
{
    const { R, initRoom } = require('./games/circular-chess.js');
    const room = { gameLogic: null, maxPlayers: 0, getPlayerBySlot: () => null, getSlotByWs: () => null };
    initRoom(room);
    const g = room.gameLogic;
    g.resetToEmpty();
    const b = g.board;
    for (const k in b) delete b[k];
    b[R.key(0, 0)] = 'bk';
    b[R.key(0, 4)] = 'wk';
    b[R.key(0, 3)] = 'wp'; b[R.key(0, 5)] = 'wp';
    b[R.key(1, 3)] = 'wp'; b[R.key(1, 4)] = 'wp'; b[R.key(1, 5)] = 'wp';
    g.sideToMove = 'white';
    g.onMatchStarted();
    check('环国际象棋：判和', g.gameOver && g.winner === 'draw');
    check('环国际象棋：白方无子可动，和棋', g.recordResultText === '白方无子可动，和棋');
}

// ============ 对照：正常初始局面不应判和 ============
{
    const g = makeRoom(require('./games/chess.js'));
    g.resetToEmpty();
    g.onMatchStarted();
    check('国际象棋：正常开局不判和', !g.gameOver);
}

console.log('\n通过', pass, '失败', fail);
process.exit(fail ? 1 : 0);
