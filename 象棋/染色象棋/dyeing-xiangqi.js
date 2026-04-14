const WebSocket = require('ws');

module.exports = function (wss) {
    // 单房间状态
    let redSocket = null;
    let greenSocket = null;
    let redTaken = false;
    let greenTaken = false;

    // 棋盘数据结构：每个格子 { type: "rr", owner: "red"/"green"/"neutral" }
    let board = Array(10).fill().map(() => Array(9).fill().map(() => ({ type: "", owner: null })));
    let currentTurn = "red";
    let historyStack = [];
    let lastMoveFrom = null;
    let lastMoveTo = null;
    let gameActive = true;

    // 占领计数
    let capturedCount = {
        red: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 },
        green: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 }
    };

    // ---------- 辅助函数 ----------
    function deepCopyBoard(src) {
        return src.map(row => row.map(cell => ({ type: cell.type, owner: cell.owner })));
    }

    function pushHistory() {
        historyStack.push({
            boardState: deepCopyBoard(board),
            turnState: currentTurn,
            lastFrom: lastMoveFrom ? { row: lastMoveFrom.row, col: lastMoveFrom.col } : null,
            lastTo: lastMoveTo ? { row: lastMoveTo.row, col: lastMoveTo.col } : null,
            capturedCount: JSON.parse(JSON.stringify(capturedCount))
        });
    }

    function popHistory() {
        if (historyStack.length === 0) return false;
        const last = historyStack.pop();
        board = deepCopyBoard(last.boardState);
        currentTurn = last.turnState;
        lastMoveFrom = last.lastFrom;
        lastMoveTo = last.lastTo;
        capturedCount = JSON.parse(JSON.stringify(last.capturedCount));
        return true;
    }

    // 初始化棋盘（全部中立）
    function initBoard() {
        for (let i = 0; i < 10; i++)
            for (let j = 0; j < 9; j++)
                board[i][j] = { type: "", owner: null };
        // 黑方棋子
        board[0][0] = { type: "br", owner: "neutral" }; board[0][8] = { type: "br", owner: "neutral" };
        board[0][1] = { type: "bn", owner: "neutral" }; board[0][7] = { type: "bn", owner: "neutral" };
        board[0][2] = { type: "be", owner: "neutral" }; board[0][6] = { type: "be", owner: "neutral" };
        board[0][3] = { type: "ba", owner: "neutral" }; board[0][5] = { type: "ba", owner: "neutral" };
        board[0][4] = { type: "bk", owner: "neutral" };
        board[2][1] = { type: "bc", owner: "neutral" }; board[2][7] = { type: "bc", owner: "neutral" };
        for (let i = 0; i < 5; i++) board[3][2 * i] = { type: "bp", owner: "neutral" };
        // 红方棋子
        board[9][0] = { type: "rr", owner: "neutral" }; board[9][8] = { type: "rr", owner: "neutral" };
        board[9][1] = { type: "rn", owner: "neutral" }; board[9][7] = { type: "rn", owner: "neutral" };
        board[9][2] = { type: "re", owner: "neutral" }; board[9][6] = { type: "re", owner: "neutral" };
        board[9][3] = { type: "ra", owner: "neutral" }; board[9][5] = { type: "ra", owner: "neutral" };
        board[9][4] = { type: "rk", owner: "neutral" };
        board[7][1] = { type: "rc", owner: "neutral" }; board[7][7] = { type: "rc", owner: "neutral" };
        for (let i = 0; i < 5; i++) board[6][2 * i] = { type: "rp", owner: "neutral" };
    }

    function resetCaptured() {
        capturedCount = {
            red: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 },
            green: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 }
        };
    }

    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    function sendFullState(ws) {
        ws.send(JSON.stringify({
            type: 'gameState',
            board: board,
            currentTurn: currentTurn,
            lastFrom: lastMoveFrom,
            lastTo: lastMoveTo,
            capturedCount: capturedCount,
            historyStack: historyStack
        }));
    }

    // ---------- WebSocket 处理 ----------
    wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'init', redTaken, greenTaken }));
        sendFullState(ws);

        ws.on('message', (raw) => {
            if (!gameActive) return;
            const msg = JSON.parse(raw);
            const { type } = msg;

            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'red' && !redTaken) {
                    redTaken = true;
                    redSocket = ws;
                    ws.playerColor = 'red';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'red' }));
                    broadcast({ type: 'init', redTaken, greenTaken }, ws);
                } else if (color === 'green' && !greenTaken) {
                    greenTaken = true;
                    greenSocket = ws;
                    ws.playerColor = 'green';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'green' }));
                    broadcast({ type: 'init', redTaken, greenTaken }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                return;
            }

            if (type === 'move') {
                if (ws.playerColor !== currentTurn) return;
                if (!msg.board || !msg.currentTurn) return;

                pushHistory();
                board = msg.board;
                currentTurn = msg.currentTurn;
                lastMoveFrom = msg.lastFrom;
                lastMoveTo = msg.lastTo;
                capturedCount = msg.capturedCount;
                historyStack = msg.historyStack;

                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentTurn: currentTurn,
                    lastFrom: lastMoveFrom,
                    lastTo: lastMoveTo,
                    capturedCount: capturedCount,
                    historyStack: historyStack
                }, ws);
                return;
            }

            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'red') ? greenSocket : redSocket;
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
                return;
            }
            if (type === 'undoResponse') {
                if (msg.accept && popHistory()) {
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentTurn: currentTurn,
                        lastFrom: lastMoveFrom,
                        lastTo: lastMoveTo,
                        capturedCount: capturedCount,
                        historyStack: historyStack
                    }, null);
                }
                return;
            }

            if (type === 'resign') {
                gameActive = false;
                broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: ws.playerColor
                }, null);
                return;
            }

            if (type === 'newGame') {
                initBoard();
                resetCaptured();
                currentTurn = "red";
                historyStack = [];
                lastMoveFrom = null;
                lastMoveTo = null;
                gameActive = true;
                redTaken = false;
                greenTaken = false;
                redSocket = null;
                greenSocket = null;
                wss.clients.forEach(client => { client.playerColor = undefined; });
                broadcast({
                    type: 'newGame',
                    board: board,
                    currentTurn: currentTurn,
                    lastFrom: lastMoveFrom,
                    lastTo: lastMoveTo,
                    capturedCount: capturedCount,
                    historyStack: historyStack,
                    redTaken: redTaken,
                    greenTaken: greenTaken
                }, null);
                return;
            }
        });

        ws.on('close', () => {
            if (ws.playerColor === 'red') {
                redTaken = false;
                redSocket = null;
            } else if (ws.playerColor === 'green') {
                greenTaken = false;
                greenSocket = null;
            }
            broadcast({ type: 'init', redTaken, greenTaken });
        });
    });

    initBoard();
    resetCaptured();
    console.log('染色象棋服务已启动');
};