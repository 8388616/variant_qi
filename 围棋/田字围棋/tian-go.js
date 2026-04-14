const WebSocket = require('ws');

module.exports = function (server) {
    const wss = new WebSocket.Server({ server });

    let blackSocket = null;
    let whiteSocket = null;
    let blackTaken = false;
    let whiteTaken = false;

    const BOARD_SIZE = 21;

    const HOLES = [
        { r1: 5, r2: 7, c1: 5, c2: 7 },
        { r1: 5, r2: 7, c1: 13, c2: 15 },
        { r1: 13, r2: 15, c1: 5, c2: 7 },
        { r1: 13, r2: 15, c1: 13, c2: 15 }
    ];

    function isHole(row, col) {
        for (let h of HOLES) {
            if (row >= h.r1 && row <= h.r2 && col >= h.c1 && col <= h.c2) return true;
        }
        return false;
    }

    let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (isHole(r, c)) board[r][c] = -1;
        }
    }

    let currentPlayer = 1;        // 1:黑, 2:白
    let historyBoards = [];
    let historyMarkers = [];
    let gameOver = false;
    let passCounter = 0;

    let lastMoveMarkers = [];

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    wss.on('connection', (ws) => {
        ws.send(JSON.stringify({
            type: 'init',
            blackTaken,
            whiteTaken
        }));

        ws.send(JSON.stringify({
            type: 'gameState',
            board: board,
            currentPlayer: currentPlayer,
            historyBoards: historyBoards,
            lastMoveMarkers: lastMoveMarkers
        }));

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            const { type } = msg;

            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'black' && !blackTaken) {
                    blackTaken = true;
                    blackSocket = ws;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                    broadcast({ type: 'init', blackTaken, whiteTaken }, ws);
                } else if (color === 'white' && !whiteTaken) {
                    whiteTaken = true;
                    whiteSocket = ws;
                    ws.playerColor = 'white';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'white' }));
                    broadcast({ type: 'init', blackTaken, whiteTaken }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                passCounter = 0;
                return;
            }

            if (type === 'move') {
                if (gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== currentPlayer) return;
                if (!msg.board || !msg.nextPlayer) return;

                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                board = msg.board;
                currentPlayer = msg.nextPlayer;
                lastMoveMarkers = msg.lastMoveMarkers || [];

                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers
                }, ws);

                passCounter = 0;
                return;
            }

            if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                currentPlayer = currentPlayer === 1 ? 2 : 1;
                passCounter++;
                lastMoveMarkers = [];

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    currentPlayer: currentPlayer,
                    player: ws.playerColor,
                    lastMoveMarkers: lastMoveMarkers
                }, ws);

                if (passCounter >= 4) {
                    gameOver = true;
                    broadcast({
                        type: 'broadcast',
                        action: 'endAgreed',
                        board: board,
                        currentPlayer: currentPlayer
                    });
                }
                return;
            }

            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
                return;
            }
            if (type === 'undoResponse') {
                if (msg.accept) {
                    if (historyBoards.length > 0) {
                        board = copyBoard(historyBoards.pop());
                        lastMoveMarkers = historyMarkers.length > 0 ? copyMarkers(historyMarkers.pop()) : [];
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                    }
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentPlayer: currentPlayer,
                        historyBoards: historyBoards,
                        lastMoveMarkers: lastMoveMarkers
                    }, null);
                }
                passCounter = 0;
                return;
            }

            if (type === 'endRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'endRequest' }));
                passCounter = 0;
                return;
            }
            if (type === 'endResponse') {
                if (msg.accept) {
                    gameOver = true;
                    broadcast({
                        type: 'broadcast',
                        action: 'endAgreed',
                        board: board,
                        currentPlayer: currentPlayer
                    });
                }
                passCounter = 0;
                return;
            }

            if (type === 'resign') {
                gameOver = true;
                broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: ws.playerColor
                });
                passCounter = 0;
                return;
            }

            if (type === 'newGame') {
                // 重置所有状态
                board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        if (isHole(r, c)) board[r][c] = -1;
                    }
                }
                currentPlayer = 1;
                historyBoards = [];
                historyMarkers = [];
                lastMoveMarkers = [];
                gameOver = false;
                passCounter = 0;
                blackTaken = false;
                whiteTaken = false;
                blackSocket = null;
                whiteSocket = null;

                // 清除所有客户端的颜色标记
                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                // 广播新局消息
                broadcast({
                    type: 'newGame',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    blackTaken: blackTaken,
                    whiteTaken: whiteTaken
                }, null);
                return;
            }
        });

        ws.on('close', () => {
            if (ws.playerColor === 'black') {
                blackTaken = false;
                blackSocket = null;
            }
            if (ws.playerColor === 'white') {
                whiteTaken = false;
                whiteSocket = null;
            }
            broadcast({ type: 'init', blackTaken, whiteTaken });
        });
    });

    console.log('田字围棋服务已启动');
};