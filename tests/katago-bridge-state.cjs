// node tests/katago-bridge-state.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const { KatagoGtpSession } = require('../katago-gtp');
// 直接测试服务端自检入口，不为测试扩大生产模块的导出接口。
const compiled = new Module(path.join(root, 'katago-bridge-check.js'), module);
compiled.filename = path.join(root, 'katago-bridge-check.js');
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(fs.readFileSync(path.join(root, 'qi-katago-opponent.js'), 'utf8')
    + '\nmodule.exports.verifyEngineState = verifyEngineState;', compiled.filename);
const { verifyEngineState } = compiled.exports;
const room = { gameType: 'bridge-weiqi' };
require('../games/bridge-weiqi').initRoom(room);
const game = room.gameLogic;
game.boardSize = 7;
game.board = Array.from({ length: 7 }, () => Array(7).fill(0));
for (const [r, c] of [[0, 6], [3, 2], [6, 6]]) game.board[r][c] = -2;
game.openingBoard = game.copyBoard(game.board);
game._qiKatagoGen = 1;
const session = game._qiKatago = Object.create(KatagoGtpSession.prototype);
session.gameId = 'bridge-weiqi'; session.dead = false;
session.boardWidth = 7; session.boardHeight = 7;
const setupCalls = [], warnings = [], commands = [];
session.setupGame = async (opts) => { setupCalls.push(opts); };
session.command = async (command) => {
    if (command === 'showboard') return output;
    commands.push(command); return '';
};
let output = `MoveNum: 0 HASH: 0123456789abcdef
   A B C D E F G
 7 . . . . . . #
 6 . . . . . . .
 5 . . . . . . .
 4 . . # . . . .
 3 . . . . . . .
 2 . . . . . . .
 1 . . . . . . #

Next player: BLACK
`;
// 按引擎 board.cpp 的两字符格宽和最近三手标记构造回读，不经过服务端自检的转换。
function showBoard(board = game.board, nextPlayer = game.currentPlayer, count = game.moveCoords.length) {
    const lines = [`MoveNum: ${count} HASH: 0123456789abcdef`, '   A B C D E F G'];
    board.forEach((row, r) => {
        let text = String(board.length - r).padStart(2) + ' ';
        row.forEach((value, c) => {
            const ch = value === -2 ? '#' : value === 1 ? 'X' : value === 2 ? 'O' : '.';
            const marker = game.moveCoords.slice(-3).findIndex((m) => m.row === r && m.col === c);
            text += ch + (marker >= 0 ? String(marker + 1) : c < row.length - 1 ? ' ' : '');
        });
        lines.push(text);
    });
    lines.push('', 'Next player: ' + (nextPlayer === 1 ? 'BLACK' : 'WHITE'));
    return lines.join('\r\n');
}
const originalWarn = console.warn;
async function check(reason) { await verifyEngineState(game, session, 1, reason); }
async function mismatch(text, reason) {
    output = text;
    const before = setupCalls.length;
    await check(reason);
    assert.equal(setupCalls.length, before + 1, reason + '仍应触发一次重同步');
    assert.match(warnings.at(-1), /引擎状态与服务端不一致/);
}
async function main() {
    console.warn = (...args) => warnings.push(args.join(' '));
    const expected = game.board.map((row) => row.map((value) => value === -2 ? -9 : value));
    const initial = await session.probeBoard(7, 7);
    assert.deepEqual(initial, { stones: expected, nextPlayer: 'black', moveNum: 0 });
    await check('开局/唤醒同步');
    assert.equal(setupCalls.length, 0, '桥格一致的空棋盘不应被全量重同步');
    // 用户报告的 21 手：覆盖两个执方、桥连接、不同位置和紧贴最近三手编号的格。
    const moves = [[3,3], [2,3], [3,1], [2,4], [2,2], [3,4], [4,3], [4,4], [5,3], [1,1],
        [5,4], [2,1], [3,0], [5,2], [4,1], [5,5], [6,4], [5,1], [6,2], [6,1], [4,5]];
    for (const [r, c] of moves) {
        const color = game.currentPlayer;
        const board = game.tryPlaceStone(game.board, r, c, color);
        assert.ok(board);
        game.board = board;
        game.moveCoords.push({ type: 'move', player: color === 1 ? 'player1' : 'player2', row: r, col: c });
        game.currentPlayer = 3 - color;
        output = showBoard();
        await check(color === 1 ? '人类着法' : '电脑落子');
        assert.equal(setupCalls.length, 0, '第 ' + game.moveCoords.length + ' 手不应误报');
    }
    assert.deepEqual(warnings, []);
    const sameBoard = game.copyBoard(game.board);
    // 桥被遗漏、桥外多出墙、黑白错色、漏子仍需报告，不能简单跳过所有桥格。
    const missingBridge = game.copyBoard(sameBoard); missingBridge[3][2] = 0;
    await mismatch(showBoard(missingBridge), '桥位置缺失');
    const extraBridge = game.copyBoard(sameBoard); extraBridge[0][0] = -2;
    await mismatch(showBoard(extraBridge), '多出桥格');
    const wrongColor = game.copyBoard(sameBoard); wrongColor[4][5] = 2;
    await mismatch(showBoard(wrongColor), '棋子错色');
    const missingStone = game.copyBoard(sameBoard); missingStone[4][5] = 0;
    await mismatch(showBoard(missingStone), '棋子缺失');
    await mismatch(showBoard(sameBoard, 3 - game.currentPlayer), '行棋方错误');
    session.lastSyncReplayed = true; session.lastSyncMoveNum = moves.length; session.lastSyncSiteMoveCount = moves.length;
    await mismatch(showBoard(sameBoard, game.currentPlayer, moves.length - 1), '着法历史缺失');
    output = showBoard(); await check('恢复正确局面');
    assert.equal(setupCalls.length, 6);
    // 同步仍发送 -2，而非显示层的墙哨兵 -9；保持桥拓扑可用。
    await session.syncPositionAndBudget(game.openingBoard, {});
    assert.ok(commands.includes('set_position -2 G7 -2 C4 -2 G1'));
    assert.equal(commands.some((command) => /\b-9\b/.test(command)), false);
    // 普通围棋与六角墙误映射仍保留原有校验语义。
    game.room.gameType = 'weiqi'; game.board = sameBoard.map((row) => row.map((v) => v === -2 ? 0 : v));
    output = showBoard(); const beforePlain = setupCalls.length; await check('普通围棋');
    assert.equal(setupCalls.length, beforePlain);
    const wall = game.copyBoard(game.board); wall[0][0] = -2;
    await mismatch(showBoard(wall), '普通棋盘映到墙');
    // 改回 bridge 并核对从桥另一端收气、提子后的盘面也可正常回读。
    game.room.gameType = 'bridge-weiqi';
    game.board = game.copyBoard(game.openingBoard);
    game.board[3][3] = 2;
    for (const [r, c] of [[2,3], [4,3], [3,4]]) game.board[r][c] = 1;
    game.board = game.tryPlaceStone(game.board, 3, 1, 1);
    assert.equal(game.board[3][3], 0, '桥另一端落子应提掉无气白子');
    output = showBoard(); const beforeCapture = setupCalls.length; await check('桥连接吃子');
    assert.equal(setupCalls.length, beforeCapture);
    console.log('Passed bridge showboard parsing, initial state, 21 moves, captures, and genuine mismatch recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
    console.warn = originalWarn; game._stopClockTicker();
});
