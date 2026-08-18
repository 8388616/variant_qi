// 编辑后开局判定（优先级）：1 无王/将/帅判负；2 单王被将军且无法应将判负；3 其余无子可动按棋种判和/判负
// 覆盖：国际象棋四变种、象棋、二象棋、六角象棋、古印度象棋、泰国象棋、朝鲜将棋（只判无将）
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
function clearBoard(g) {
    if (Array.isArray(g.board[0])) {
        for (let r = 0; r < g.board.length; r++) for (let c = 0; c < g.board[r].length; c++) g.board[r][c] = '';
    } else {
        for (const k in g.board) delete g.board[k];
    }
}

// ============ 国际象棋 ============
{
    const g = makeRoom(require('./games/chess.js'));
    clearBoard(g);
    g.board[7][4] = 'wk'; g.board[0][4] = 'bk';
    g.board[6][2] = 'br'; g.board[7][2] = 'br'; g.board[7][5] = 'br';
    g.onMatchStarted();
    check('国际象棋：单王将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '白方被将死黑胜');
}
{
    const g = makeRoom(require('./games/chess.js'));
    clearBoard(g);
    g.board[0][0] = 'wk'; g.board[0][3] = 'bk';
    g.board[0][1] = 'bn'; g.board[1][0] = 'bn';
    g.board[2][0] = 'br'; g.board[2][1] = 'br';
    g.onMatchStarted();
    check('国际象棋：逼和判和', g.gameOver && g.winner === 'draw' && g.recordResultText === '白方无子可动，和棋');
}
{
    const g = makeRoom(require('./games/chess.js'));
    clearBoard(g);
    g.board[7][4] = 'wk'; g.board[5][4] = 'wk'; g.board[0][4] = 'bk';
    g.onMatchStarted();
    check('国际象棋：多王不判', !g.gameOver);
}
{
    const g = makeRoom(require('./games/chess.js'));
    clearBoard(g);
    g.board[0][4] = 'bk';
    g.onMatchStarted();
    check('国际象棋：无王判负', g.gameOver && g.winner === 'white' && g.recordResultText === '白方无王黑胜');
}

// ============ 六角国际象棋 ============
{
    const g = makeRoom(require('./games/hexagon-chess.js'));
    clearBoard(g);
    g.board[10][3] = 'wk'; g.board[0][3] = 'bk';
    g.board[9][1] = 'br'; g.board[10][1] = 'br';
    g.onMatchStarted();
    check('六角国际象棋：单王将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '白方被将死黑胜');
}
{
    const g = makeRoom(require('./games/hexagon-chess.js'));
    clearBoard(g);
    g.board[0][3] = 'wk'; g.board[0][1] = 'bk';
    g.board[0][4] = 'bp'; g.board[1][4] = 'bp'; g.board[1][3] = 'bb'; g.board[2][3] = 'bb';
    g.onMatchStarted();
    check('六角国际象棋：逼和判和', g.gameOver && g.winner === 'draw' && g.recordResultText === '白方无子可动，和棋');
}

// ============ 菱国际象棋（王在竖带上，行直线车必然将军 → 将死判负） ============
{
    const g = makeRoom(require('./games/rhombic-chess.js'));
    clearBoard(g);
    g.board['10,3'] = 'wk'; g.board['0,3'] = 'bk';
    g.board['7,2'] = 'br'; g.board['10,0'] = 'br';
    g.onMatchStarted();
    check('菱国际象棋：单王将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '白方被将死黑胜');
}

// ============ 环国际象棋 ============
{
    const { R, initRoom } = require('./games/circular-chess.js');
    const room = { gameLogic: null, maxPlayers: 0, getPlayerBySlot: () => null, getSlotByWs: () => null };
    initRoom(room);
    const g = room.gameLogic;
    g.resetToEmpty();
    clearBoard(g);
    g.board[R.key(0, 0)] = 'bk';
    g.board[R.key(0, 4)] = 'wk';
    g.board[R.key(0, 3)] = 'wp'; g.board[R.key(0, 5)] = 'wp';
    g.board[R.key(1, 3)] = 'wp'; g.board[R.key(1, 4)] = 'wp'; g.board[R.key(1, 5)] = 'wp';
    g.sideToMove = 'white';
    g.onMatchStarted();
    check('环国际象棋：逼和判和', g.gameOver && g.winner === 'draw' && g.recordResultText === '白方无子可动，和棋');
}

// ============ 象棋 ============
{
    const g = makeRoom(require('./games/xiangqi.js'));
    clearBoard(g);
    g.board[0][3] = 'rk'; g.board[9][3] = 'bk';
    g.board[0][4] = 're'; g.board[1][3] = 're'; g.board[1][4] = 're';
    g.board[2][4] = 're'; g.board[1][5] = 're';
    g.onMatchStarted();
    check('象棋：困毙判负', g.gameOver && g.winner === 'white' && g.recordResultText === '黑困毙红胜');
}
{
    const g = makeRoom(require('./games/xiangqi.js'));
    clearBoard(g);
    g.board[9][3] = 'bk';
    g.onMatchStarted();
    check('象棋：无帅判负', g.gameOver && g.winner === 'white' && g.recordResultText === '红方无帅黑胜');
}
{
    const g = makeRoom(require('./games/xiangqi.js'));
    clearBoard(g);
    g.board[0][3] = 'rk'; g.board[9][3] = 'bk';
    g.board[1][3] = 'br'; g.board[0][4] = 'br'; g.board[1][2] = 'br'; g.board[1][4] = 'br';
    g.onMatchStarted();
    check('象棋：将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '黑将死红胜');
}

// ============ 二象棋（单帅） ============
{
    const g = makeRoom(require('./games/double-xiangqi.js'));
    clearBoard(g);
    g.board[8][4] = 'rk'; g.board[0][4] = 'bk';
    g.board[8][2] = 'br'; g.board[7][2] = 'br'; g.board[9][2] = 'br';
    g.board[8][5] = 'br'; g.board[7][5] = 'br';
    g.onMatchStarted();
    check('二象棋：单帅将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '黑将死红胜');
}

// ============ 六角象棋 ============
{
    const g = makeRoom(require('./games/hexagon-xiangqi.js'));
    clearBoard(g);
    g.board[8] = 'bk';   // 黑将 idx 8（初始位置）
    g.onMatchStarted();
    check('六角象棋：无帅判负', g.gameOver && g.winner === 'white' && g.recordResultText === '红方无帅黑胜');
}

// ============ 古印度象棋 ============
{
    const g = makeRoom(require('./games/caturanga.js'));
    clearBoard(g);
    g.board[7][4] = 'wk'; g.board[0][4] = 'bk';
    g.board[6][2] = 'br'; g.board[7][2] = 'br'; g.board[7][5] = 'br';
    g.onMatchStarted();
    check('古印度象棋：单王将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '黑将死白胜');
}
{
    const g = makeRoom(require('./games/caturanga.js'));
    clearBoard(g);
    g.board[0][4] = 'bk';
    g.onMatchStarted();
    check('古印度象棋：无王判负', g.gameOver && g.winner === 'white' && g.recordResultText === '白方无王黑胜');
}

// ============ 泰国象棋（王码 rk/bk） ============
{
    const g = makeRoom(require('./games/simulated-makruk.js'));
    clearBoard(g);
    g.board[0][0] = 'rk'; g.board[0][3] = 'bk';
    g.board[0][1] = 'bn'; g.board[1][0] = 'bn';
    g.board[2][0] = 'br'; g.board[2][1] = 'br';
    g.onMatchStarted();
    check('泰国象棋：逼和判和', g.gameOver && g.winner === 'draw' && g.recordResultText === '逼和');
}
{
    const g = makeRoom(require('./games/simulated-makruk.js'));
    clearBoard(g);
    g.board[7][4] = 'rk'; g.board[0][4] = 'bk';
    g.board[6][2] = 'br'; g.board[7][2] = 'br'; g.board[7][5] = 'br';
    g.onMatchStarted();
    check('泰国象棋：单王将死判负', g.gameOver && g.winner === 'white' && g.recordResultText === '黑将死红胜');
}

// ============ 对照 ============
{
    const g = makeRoom(require('./games/chess.js'));
    g.resetToEmpty();
    g.onMatchStarted();
    check('国际象棋：正常开局不判', !g.gameOver);
}

console.log('\n通过', pass, '失败', fail);
process.exit(fail ? 1 : 0);
