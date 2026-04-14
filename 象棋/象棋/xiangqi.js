const WebSocket = require('ws');

module.exports = function (wss) {
    // 单房间状态
    let redSocket = null;
    let blackSocket = null;
    let redTaken = false;
    let blackTaken = false;

    // 棋盘数据结构 10行x9列，空字符串表示无子，棋子编码：
    // 红: rk(帅), ra(士), re(相), rn(马), rr(车), rc(炮), rp(兵)
    // 黑: bk(将), ba(士), be(象), bn(马), br(车), bc(炮), bp(卒)
    let board = Array(10).fill().map(() => Array(9).fill(""));
    let currentTurn = "red";       // 红方先行
    let historyStack = [];          // 存储历史 { board, turn, lastFrom, lastTo }
    let lastMoveFrom = null;        // {row, col}
    let lastMoveTo = null;
    let gameOver = false;

    // 初始化棋盘摆子
    function initBoard() {
        // 清空
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 9; j++) {
                board[i][j] = "";
            }
        }
        // 黑方 (0-2行)
        board[0][0] = "br"; board[0][8] = "br";
        board[0][1] = "bn"; board[0][7] = "bn";
        board[0][2] = "be"; board[0][6] = "be";
        board[0][3] = "ba"; board[0][5] = "ba";
        board[0][4] = "bk";
        board[2][1] = "bc"; board[2][7] = "bc";
        for (let i = 0; i < 5; i++) board[3][2 * i] = "bp";

        // 红方 (9-6行)
        board[9][0] = "rr"; board[9][8] = "rr";
        board[9][1] = "rn"; board[9][7] = "rn";
        board[9][2] = "re"; board[9][6] = "re";
        board[9][3] = "ra"; board[9][5] = "ra";
        board[9][4] = "rk";
        board[7][1] = "rc"; board[7][7] = "rc";
        for (let i = 0; i < 5; i++) board[6][2 * i] = "rp";
    }

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMove(move) {
        if (!move) return null;
        return { row: move.row, col: move.col };
    }

    function pushHistory() {
        historyStack.push({
            boardState: copyBoard(board),
            turnState: currentTurn,
            lastFrom: copyMove(lastMoveFrom),
            lastTo: copyMove(lastMoveTo)
        });
    }

    function popHistory() {
        if (historyStack.length === 0) return false;
        const last = historyStack.pop();
        board = copyBoard(last.boardState);
        currentTurn = last.turnState;
        lastMoveFrom = copyMove(last.lastFrom);
        lastMoveTo = copyMove(last.lastTo);
        return true;
    }

    // 广播消息给所有客户端（可选排除一个）
    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // 发送当前完整状态给指定客户端
    function sendFullState(ws) {
        ws.send(JSON.stringify({
            type: 'gameState',
            board: board,
            currentTurn: currentTurn,
            lastFrom: lastMoveFrom,
            lastTo: lastMoveTo,
            historyStack: historyStack
        }));
    }

    wss.on('connection', (ws) => {
        // 发送初始占用状态
        ws.send(JSON.stringify({
            type: 'init',
            redTaken,
            blackTaken
        }));

        // 同步当前完整棋盘状态
        sendFullState(ws);

        ws.on('message', (raw) => {
            if (gameOver) return;

            const msg = JSON.parse(raw);
            const { type } = msg;

            // 选色
            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'red' && !redTaken) {
                    redTaken = true;
                    redSocket = ws;
                    ws.playerColor = 'red';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'red' }));
                    broadcast({ type: 'init', redTaken, blackTaken }, ws);
                } else if (color === 'black' && !blackTaken) {
                    blackTaken = true;
                    blackSocket = ws;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                    broadcast({ type: 'init', redTaken, blackTaken }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                return;
            }

            // 走子
            if (type === 'move') {
                // 验证是否为当前玩家
                if (ws.playerColor !== currentTurn) return;
                // 接收前端发来的完整新状态（前端已做合法性校验）
                if (!msg.board || !msg.currentTurn) return;

                // 保存历史
                pushHistory();

                // 更新服务器状态
                board = msg.board;
                currentTurn = msg.currentTurn;
                lastMoveFrom = msg.lastFrom;
                lastMoveTo = msg.lastTo;

                // 广播给另一玩家（排除发送者自己）
                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentTurn: currentTurn,
                    lastFrom: lastMoveFrom,
                    lastTo: lastMoveTo,
                    historyStack: historyStack
                }, ws);
                return;
            }

            // 悔棋请求
            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'red') ? blackSocket : redSocket;
                if (target) {
                    target.send(JSON.stringify({ type: 'undoRequest' }));
                }
                return;
            }
            if (type === 'undoResponse') {
                if (msg.accept) {
                    if (popHistory()) {
                        // 悔棋成功，广播新状态
                        broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: board,
                            currentTurn: currentTurn,
                            lastFrom: lastMoveFrom,
                            lastTo: lastMoveTo,
                            historyStack: historyStack
                        }, null);
                    }
                }
                return;
            }

            // 认输
            if (type === 'resign') {
                gameOver = true;
                broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: ws.playerColor
                }, null);
                return;
            }

            // 新局
            if (type === 'newGame') {
                // 重置所有状态
                initBoard();
                currentTurn = "red";
                historyStack = [];
                lastMoveFrom = null;
                lastMoveTo = null;
                gameOver = false;
                redTaken = false;
                blackTaken = false;
                redSocket = null;
                blackSocket = null;

                // 清除客户端颜色标记
                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                // 广播新局
                broadcast({
                    type: 'newGame',
                    board: board,
                    currentTurn: currentTurn,
                    lastFrom: lastMoveFrom,
                    lastTo: lastMoveTo,
                    historyStack: historyStack,
                    redTaken: redTaken,
                    blackTaken: blackTaken
                }, null);
                return;
            }
        });

        ws.on('close', () => {
            if (ws.playerColor === 'red') {
                redTaken = false;
                redSocket = null;
            } else if (ws.playerColor === 'black') {
                blackTaken = false;
                blackSocket = null;
            }
            broadcast({ type: 'init', redTaken, blackTaken });
        });
    });

    // 初始摆棋
    initBoard();
    console.log('象棋服务已启动');
};