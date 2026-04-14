const WebSocket = require('ws');

module.exports = function (server) {
    const wss = new WebSocket.Server({ server });

    let blackSocket = null;
    let whiteSocket = null;
    let redSocket = null;
    let blackTaken = false;
    let whiteTaken = false;
    let redTaken = false;
    let blackActive = true;
    let whiteActive = true;
    let redActive = true;

    const ROWS = 27;
    function createEmptyBoard() {
        return Array(ROWS).fill().map((_, r) => Array(r + 1).fill(0));
    }

    let board = createEmptyBoard();
    let currentPlayer = 1;        // 1:黑, 2:白, 3:红
    let historyBoards = [];       // 历史棋盘深拷贝数组
    let historyMarkers = [];      // 历史落子标记数组
    let historyPlayers = [];      // 历史行棋方 (每个历史状态对应的 currentPlayer)
    let gameOver = false;
    let passCounter = 0;          // 连续虚着计数器
    const PASS_LIMIT = 6;         // 三人连续pass 6次 自动终局

    let lastMoveMarkers = [];

    // 终局与悔棋的pending请求
    let pendingEnd = null;        // { requester: 'black'|'white'|'red', acceptors: Set }
    let pendingUndo = null;       // { requester: 'black'|'white'|'red', acceptors: Set, boardBefore, currentPlayerBefore, historyBefore, markersBefore }

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    // 获取存活玩家列表
    function getActivePlayers() {
        const active = [];
        if (blackActive) active.push('black');
        if (whiteActive) active.push('white');
        if (redActive) active.push('red');
        return active;
    }

    // 根据颜色获取玩家数值
    function colorToVal(color) {
        if (color === 'black') return 1;
        if (color === 'white') return 2;
        if (color === 'red') return 3;
        return 0;
    }

    // 根据数值获取颜色字符串
    function valToColor(val) {
        if (val === 1) return 'black';
        if (val === 2) return 'white';
        if (val === 3) return 'red';
        return null;
    }

    // 广播给所有客户端
    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // 获取下一个活跃玩家 (循环)
    function getNextActivePlayer(start) {
        let next = start % 3 + 1;
        while (true) {
            if ((next === 1 && blackActive) || (next === 2 && whiteActive) || (next === 3 && redActive)) {
                return next;
            }
            next = next % 3 + 1;
            if (next === start) break; // 全部不活跃
        }
        return -1; // 无活跃玩家
    }

    // 移除无气块 (复用前端逻辑)
    function isValidCoord(r, c) {
        return r >= 0 && r < ROWS && c >= 0 && c <= r;
    }

    const DIRS = [
        [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]
    ];

    function removeAllDeadGroups(board) {
        let newBoard = copyBoard(board);
        let changed = true;
        while (changed) {
            changed = false;
            let visited = Array(ROWS).fill().map(() => []);
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c <= r; c++) {
                    if (newBoard[r][c] !== 0 && !visited[r][c]) {
                        let color = newBoard[r][c];
                        let queue = [[r, c]];
                        visited[r][c] = true;
                        let stones = [[r, c]];
                        let hasLib = false;
                        let idx = 0;
                        while (idx < queue.length) {
                            let [rr, cc] = queue[idx++];
                            for (let [dr, dc] of DIRS) {
                                let nr = rr + dr, nc = cc + dc;
                                if (!isValidCoord(nr, nc)) continue;
                                if (newBoard[nr][nc] === 0) {
                                    hasLib = true;
                                } else if (newBoard[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (!hasLib) {
                            for (let [rr, cc] of stones) {
                                newBoard[rr][cc] = 0;
                            }
                            changed = true;
                        }
                    }
                }
            }
        }
        return newBoard;
    }

    function tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!isValidCoord(row, col) || boardBefore[row][col] !== 0) return null;
        let newBoard = copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        newBoard = removeAllDeadGroups(newBoard);
        if (newBoard[row][col] !== playerVal) return null;
        return newBoard;
    }

    wss.on('connection', (ws) => {
        // 发送初始占用状态
        ws.send(JSON.stringify({
            type: 'init',
            blackTaken,
            whiteTaken,
            redTaken
        }));

        // 同步当前完整状态
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
                    blackActive = true;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                } else if (color === 'white' && !whiteTaken) {
                    whiteTaken = true;
                    whiteSocket = ws;
                    whiteActive = true;
                    ws.playerColor = 'white';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'white' }));
                } else if (color === 'red' && !redTaken) {
                    redTaken = true;
                    redSocket = ws;
                    redActive = true;
                    ws.playerColor = 'red';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'red' }));
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                    return;
                }
                broadcast({ type: 'init', blackTaken, whiteTaken, redTaken }, ws);
                passCounter = 0;
                return;
            }

            if (type === 'move') {
                if (gameOver) return;
                const playerVal = colorToVal(ws.playerColor);
                if (playerVal !== currentPlayer) return;
                if (!msg.board || !msg.nextPlayer) return;

                // 保存历史 (落子前的状态)
                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));
                historyPlayers.push(currentPlayer);   // 记录落子前的行棋方

                board = msg.board;
                currentPlayer = msg.nextPlayer;
                // 跳过非活跃玩家
                while (!((currentPlayer === 1 && blackActive) || (currentPlayer === 2 && whiteActive) || (currentPlayer === 3 && redActive))) {
                    currentPlayer = currentPlayer % 3 + 1;
                }
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
                const playerVal = colorToVal(ws.playerColor);
                if (playerVal !== currentPlayer) return;

                // 保存历史 (虚着前的状态)
                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));
                historyPlayers.push(currentPlayer);

                currentPlayer = currentPlayer % 3 + 1;
                // 跳过非活跃玩家
                while (!((currentPlayer === 1 && blackActive) || (currentPlayer === 2 && whiteActive) || (currentPlayer === 3 && redActive))) {
                    currentPlayer = currentPlayer % 3 + 1;
                }
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

                if (passCounter >= PASS_LIMIT) {
                    gameOver = true;
                    broadcast({ type: 'broadcast', action: 'endAgreed', board: board, currentPlayer: currentPlayer });
                }
                return;
            }

            if (type === 'resign') {
                if (gameOver) return;
                const color = ws.playerColor;
                if (color === 'black') blackActive = false;
                else if (color === 'white') whiteActive = false;
                else if (color === 'red') redActive = false;

                broadcast({ type: 'broadcast', action: 'resign', player: color }, ws);

                // 检查游戏是否结束 (活跃玩家 <= 1)
                const active = getActivePlayers();
                if (active.length <= 1) {
                    gameOver = true;
                    // 可以宣布胜者
                } else {
                    // 如果当前玩家是认输方，切换到下一个活跃玩家
                    if (colorToVal(color) === currentPlayer) {
                        currentPlayer = getNextActivePlayer(currentPlayer);
                    }
                }
                passCounter = 0;
                return;
            }

            if (type === 'undoRequest') {
                if (gameOver || pendingUndo) return;
                const requester = ws.playerColor;
                const others = [];
                if (blackActive && blackSocket && blackSocket !== ws) others.push(blackSocket);
                if (whiteActive && whiteSocket && whiteSocket !== ws) others.push(whiteSocket);
                if (redActive && redSocket && redSocket !== ws) others.push(redSocket);

                if (others.length === 0) return;

                pendingUndo = {
                    requester,
                    acceptors: new Set([requester]), // 自己默认同意
                    boardBefore: copyBoard(board),
                    currentPlayerBefore: currentPlayer,
                    historyBefore: historyBoards.map(copyBoard),
                    markersBefore: copyMarkers(lastMoveMarkers)
                };

                others.forEach(sock => {
                    sock.send(JSON.stringify({ type: 'undoRequest' }));
                });
                return;
            }

            if (type === 'undoResponse') {
                if (!pendingUndo) return;
                const responder = ws.playerColor;
                if (pendingUndo.acceptors.has(responder)) return;

                if (msg.accept) {
                    pendingUndo.acceptors.add(responder);
                    const activePlayers = getActivePlayers();
                    const allAccepted = activePlayers.every(p => pendingUndo.acceptors.has(p));
                    if (allAccepted) {
                        // 执行悔棋：从历史中恢复上一步的状态
                        if (historyBoards.length > 0) {
                            board = copyBoard(historyBoards.pop());
                            lastMoveMarkers = historyMarkers.length > 0 ? copyMarkers(historyMarkers.pop()) : [];
                            currentPlayer = historyPlayers.pop();   // 恢复上一步的行棋方
                        }
                        broadcast({
                            type: 'broadcast',
                            action: 'undoAccept',
                            board: board,
                            currentPlayer: currentPlayer,
                            historyBoards: historyBoards,
                            lastMoveMarkers: lastMoveMarkers
                        }, null);
                        pendingUndo = null;
                    }
                } else {
                    // 拒绝，取消悔棋
                    broadcast({ type: 'broadcast', action: 'undoRejected' }, null);
                    pendingUndo = null;
                }
                return;
            }

            if (type === 'endRequest') {
                if (gameOver || pendingEnd) return;
                const requester = ws.playerColor;
                const others = [];
                if (blackActive && blackSocket && blackSocket !== ws) others.push(blackSocket);
                if (whiteActive && whiteSocket && whiteSocket !== ws) others.push(whiteSocket);
                if (redActive && redSocket && redSocket !== ws) others.push(redSocket);

                if (others.length === 0) return;

                pendingEnd = {
                    requester,
                    acceptors: new Set([requester])
                };

                others.forEach(sock => {
                    sock.send(JSON.stringify({ type: 'endRequest' }));
                });
                return;
            }

            if (type === 'endResponse') {
                if (!pendingEnd) return;
                const responder = ws.playerColor;
                if (pendingEnd.acceptors.has(responder)) return;

                if (msg.accept) {
                    pendingEnd.acceptors.add(responder);
                    const activePlayers = getActivePlayers();
                    const allAccepted = activePlayers.every(p => pendingEnd.acceptors.has(p));
                    if (allAccepted) {
                        gameOver = true;
                        broadcast({ type: 'broadcast', action: 'endAgreed', board: board, currentPlayer: currentPlayer });
                        pendingEnd = null;
                    }
                } else {
                    broadcast({ type: 'broadcast', action: 'endRejected' }, null);
                    pendingEnd = null;
                }
                return;
            }

            if (type === 'newGame') {
                board = createEmptyBoard();
                currentPlayer = 1;
                historyBoards = [];
                historyMarkers = [];
                historyPlayers = [];
                lastMoveMarkers = [];
                gameOver = false;
                passCounter = 0;
                blackTaken = false;
                whiteTaken = false;
                redTaken = false;
                blackActive = true;
                whiteActive = true;
                redActive = true;
                blackSocket = null;
                whiteSocket = null;
                redSocket = null;
                pendingEnd = null;
                pendingUndo = null;

                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                broadcast({
                    type: 'newGame',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    blackTaken: blackTaken,
                    whiteTaken: whiteTaken,
                    redTaken: redTaken
                }, null);
                return;
            }
        });

        ws.on('close', () => {
            if (ws.playerColor === 'black') {
                blackTaken = false;
                blackSocket = null;
                blackActive = false;
            } else if (ws.playerColor === 'white') {
                whiteTaken = false;
                whiteSocket = null;
                whiteActive = false;
            } else if (ws.playerColor === 'red') {
                redTaken = false;
                redSocket = null;
                redActive = false;
            }
            broadcast({ type: 'init', blackTaken, whiteTaken, redTaken });

            // 如果当前玩家是断线者，且游戏未结束，切换到下一个活跃玩家
            if (!gameOver && ws.playerColor && colorToVal(ws.playerColor) === currentPlayer) {
                currentPlayer = getNextActivePlayer(currentPlayer);
            }
        });
    });

    console.log('三人三角围棋服务已启动');
};