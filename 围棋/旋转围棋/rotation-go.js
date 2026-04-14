const WebSocket = require('ws');

module.exports = function (wss) {
    let blackSocket = null;
    let whiteSocket = null;
    let blackTaken = false;
    let whiteTaken = false;

    const BOARD_SIZE = 18;
    let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    let currentPlayer = 1;
    let historyBoards = [];
    let historyMarkers = [];
    let gameOver = false;
    let passCounter = 0;

    let lastMoveMarkers = [];

    let rotationCount = 0;
    const MAX_ROTATION = 9;

    const blockIdMap = [
        [1, 2, 3],
        [8, 9, 4],
        [7, 6, 5]
    ];
    const rotateBlockMap = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 1 };

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    function hasLiberty(board, r, c) {
        let color = board[r][c];
        if (color === 0) return false;
        let visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
        let queue = [[r, c]];
        visited[r][c] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            let [cr, cc] = queue.shift();
            for (let [dr, dc] of dirs) {
                let nr = cr + dr;
                let nc = cc + dc;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                if (board[nr][nc] === 0) return true;
                if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return false;
    }

    function removeGroup(board, r, c) {
        let color = board[r][c];
        if (color === 0) return;
        let queue = [[r, c]];
        board[r][c] = 0;
        while (queue.length) {
            let [cr, cc] = queue.shift();
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (let [dr, dc] of dirs) {
                let nr = cr + dr;
                let nc = cc + dc;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                if (board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    function removeDeadGroups(srcBoard) {
        let newBoard = copyBoard(srcBoard);
        let visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
        let groups = [];

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (newBoard[r][c] !== 0 && !visited[r][c]) {
                    let color = newBoard[r][c];
                    let queue = [[r, c]];
                    visited[r][c] = true;
                    let stones = [[r, c]];
                    let idx = 0;
                    while (idx < queue.length) {
                        let [rr, cc] = queue[idx++];
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        for (let [dr, dc] of dirs) {
                            let nr = rr + dr, nc = cc + dc;
                            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                            if (newBoard[nr][nc] === color && !visited[nr][nc]) {
                                visited[nr][nc] = true;
                                queue.push([nr, nc]);
                                stones.push([nr, nc]);
                            }
                        }
                    }
                    groups.push({ stones, color });
                }
            }
        }

        let toRemove = [];
        for (let g of groups) {
            let hasLib = false;
            for (let [r, c] of g.stones) {
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                for (let [dr, dc] of dirs) {
                    let nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                    if (newBoard[nr][nc] === 0) {
                        hasLib = true;
                        break;
                    }
                }
                if (hasLib) break;
            }
            if (!hasLib) {
                toRemove.push(g);
            }
        }

        for (let g of toRemove) {
            for (let [r, c] of g.stones) {
                newBoard[r][c] = 0;
            }
        }
        return newBoard;
    }

    function rotateBoardOnce(srcBoard) {
        let dstBoard = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (srcBoard[r][c] === 0) continue;
                let blockRow = Math.floor(r / 6);
                let blockCol = Math.floor(c / 6);
                let blockId = blockIdMap[blockRow][blockCol];
                let targetId = rotateBlockMap[blockId];
                let targetBlockRow, targetBlockCol;
                for (let br = 0; br < 3; br++) {
                    for (let bc = 0; bc < 3; bc++) {
                        if (blockIdMap[br][bc] === targetId) {
                            targetBlockRow = br;
                            targetBlockCol = bc;
                            break;
                        }
                    }
                }
                let dr = r % 6;
                let dc = c % 6;
                let nr = targetBlockRow * 6 + dr;
                let nc = targetBlockCol * 6 + dc;
                dstBoard[nr][nc] = srcBoard[r][c];
            }
        }
        return dstBoard;
    }

    function rotateMarkers(markers) {
        if (!markers) return [];
        return markers.map(m => {
            let r = m.row, c = m.col;
            let blockRow = Math.floor(r / 6);
            let blockCol = Math.floor(c / 6);
            let blockId = blockIdMap[blockRow][blockCol];
            let targetId = rotateBlockMap[blockId];
            let targetBlockRow, targetBlockCol;
            for (let br = 0; br < 3; br++) {
                for (let bc = 0; bc < 3; bc++) {
                    if (blockIdMap[br][bc] === targetId) {
                        targetBlockRow = br;
                        targetBlockCol = bc;
                        break;
                    }
                }
            }
            let dr = r % 6;
            let dc = c % 6;
            let nr = targetBlockRow * 6 + dr;
            let nc = targetBlockCol * 6 + dc;
            return { row: nr, col: nc, color: m.color };
        });
    }

    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    function checkAndRotate(ws) {
        let moveCount = historyBoards.length;
        if (moveCount % 23 === 22 && rotationCount < MAX_ROTATION) {
            broadcast({ type: 'rotatePrepare' }, null);
        } else if (moveCount % 23 === 0 && rotationCount < MAX_ROTATION) {
            // 1. 旋转前提子
            let boardAfterPreRemove = removeDeadGroups(board);
            // 2. 旋转
            let rotatedBoard = rotateBoardOnce(boardAfterPreRemove);
            // 3. 旋转后提子
            let finalBoard = removeDeadGroups(rotatedBoard);
            // 4. 旋转落子标记
            let rotatedMarkers = rotateMarkers(lastMoveMarkers);
            // 5. 检查旋转后的标记是否有效（对应的位置是否有相同颜色的棋子）
            let validMarkers = rotatedMarkers.filter(m => {
                if (m.row < 0 || m.row >= BOARD_SIZE || m.col < 0 || m.col >= BOARD_SIZE) return false;
                return finalBoard[m.row][m.col] === m.color;
            });
            // 更新全局状态
            board = finalBoard;
            lastMoveMarkers = validMarkers;
            rotationCount++;

            broadcast({
                type: 'rotateBoard',
                board: board,
                lastMoveMarkers: lastMoveMarkers
            }, null);
        }
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
            lastMoveMarkers: lastMoveMarkers,
            rotationCount: rotationCount
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
                checkAndRotate(ws);
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
                } else {
                    checkAndRotate(ws);
                }
                return;
            }

            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
                return;
            }
            if (type === 'undoResponse' && msg.accept) {
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
                    lastMoveMarkers: lastMoveMarkers
                }, null);
                passCounter = 0;
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
                board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
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
                rotationCount = 0;

                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

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

    console.log('旋转围棋服务已启动');
};