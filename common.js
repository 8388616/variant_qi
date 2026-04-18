'use strict';

/**
 * 双人对弈房间公共逻辑（仅 Node 使用；勿作为静态文件暴露给浏览器）。
 * 从各变种目录引用：require('../common')
 */

function copyBoard(src) {
    return src.map(row => row.slice());
}

function boardToString(board) {
    return board.map(row => row.join(',')).join(';');
}

/**
 * 紧凑棋谱初始局面：字符串数组，如 ["B3,3","W15,15","N0,6","H2,2"]
 * 前缀 B/W/N/H，后为 row,col（与着手坐标串格式一致，无空格）
 */
function encodeInitialPositionCompact(board, boardSize) {
    const out = [];
    for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
            const v = board[r][c];
            if (v === 1) out.push(`B${r},${c}`);
            else if (v === 2) out.push(`W${r},${c}`);
            else if (v === 3) out.push(`N${r},${c}`);
            else if (v === -1) out.push(`H${r},${c}`);
        }
    }
    return out;
}

function applyInitialPositionCompact(board, boardSize, initialPosition) {
    if (!initialPosition || !Array.isArray(initialPosition)) return;
    for (const s of initialPosition) {
        if (typeof s !== 'string' || s.length < 3) continue;
        const prefix = s[0];
        if (prefix !== 'B' && prefix !== 'W' && prefix !== 'N' && prefix !== 'H') continue;
        const comma = s.indexOf(',');
        if (comma <= 1) continue;
        const r = parseInt(s.slice(1, comma), 10);
        const c = parseInt(s.slice(comma + 1), 10);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
        if (prefix === 'B') board[r][c] = 1;
        else if (prefix === 'W') board[r][c] = 2;
        else if (prefix === 'N') board[r][c] = 3;
        else if (prefix === 'H') board[r][c] = -1;
    }
}

function assignBlackWhiteSlot(room, requestedSlot) {
    if (requestedSlot === 'black' && !room.getPlayerBySlot('black')) return 'black';
    if (requestedSlot === 'white' && !room.getPlayerBySlot('white')) return 'white';
    return null;
}

class QiTwoPlayerRoomBase {
    constructor(room) {
        this.room = room;
    }

    copyBoard(src) {
        return copyBoard(src);
    }

    boardToString(board) {
        return boardToString(board);
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    assignSlot(ws, requestedSlot) {
        return assignBlackWhiteSlot(this.room, requestedSlot);
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getState() }));
    }
}

/**
 * 共享 WebSocket 协议片段：选色、导入导出、新局/认输/和棋、
 * 方格围棋 move/pass/requestUndo/undoResponse（weiqiMove 等）、
 * 五子棋式悔棋（historyBoards + moveHistory 同步回退）等。
 * 各 Room 在 handleMessage 里按需调用，减少 switch 重复。
 */
const qiProtocol = {
    selectColor(self, ws, msg, opts = {}) {
        const occupiedMsg = opts.colorOccupiedMsg ?? '该颜色已被占用。';
        const slot = self.room.getSlotByWs(ws);
        const room = self.room;
        if (slot) return;
        const newSlot = self.assignSlot(ws, msg.color);
        if (newSlot) {
            room.setPlayerSlot(ws, newSlot);
            ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
            self.sendState(ws);
            room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
        } else {
            ws.send(JSON.stringify({ type: 'error', message: occupiedMsg }));
        }
    },

    exportRecord(self, ws) {
        ws.send(JSON.stringify({ type: 'gameRecord', data: self.exportRecord() }));
    },

    importRecord(self, ws, msg, opts = {}) {
        const blockedMsg = opts.importBlockedMsg ?? '已有玩家入座，无法导入棋谱。';
        if (self.room.getPlayerBySlot('black') || self.room.getPlayerBySlot('white')) {
            ws.send(JSON.stringify({ type: 'error', message: blockedMsg }));
            return;
        }
        self.importRecord(msg.data, ws);
    },

    /** 观战且无人入座时清空房间（需实现 resetToEmpty） */
    resetRoomToEmpty(self, ws) {
        if (self.room.getPlayerBySlot('black') || self.room.getPlayerBySlot('white')) return;
        self.resetToEmpty();
        self.broadcast({ type: 'roomReset', ...self.getState() });
    },

    resign(self, ws, slot) {
        if (!slot || self.gameOver) return;
        self.gameOver = true;
        self.winner = slot === 'black' ? 'white' : 'black';
        self.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: self.winner, ...self.getState() });
    },

    requestNewGame(self, ws, slot) {
        if (!slot) return;
        const room = self.room;
        const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
        if (!newGameOpponent) {
            self.resetGame();
        } else {
            self.pendingNewGame = ws;
            newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
        }
    },

    newGameResponse(self, ws, msg, opts = {}) {
        const denyMsg = opts.newGameDeniedMsg ?? '对方拒绝开始新局。';
        if (self.pendingNewGame && msg.accept) {
            self.resetGame();
        } else if (self.pendingNewGame && !msg.accept) {
            self.pendingNewGame.send(JSON.stringify({ type: 'error', message: denyMsg }));
        }
        self.pendingNewGame = null;
    },

    requestDraw(self, ws, slot) {
        if (!slot || self.gameOver) return;
        const room = self.room;
        const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
        if (!drawOpponent) {
            self.gameOver = true;
            self.winner = 'draw';
            self.broadcast({ type: 'broadcast', action: 'drawAgreed', ...self.getState() });
        } else {
            self.pendingDraw = ws;
            drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
        }
    },

    drawResponse(self, ws, msg) {
        if (self.pendingDraw && msg.accept) {
            self.gameOver = true;
            self.winner = 'draw';
            self.broadcast({ type: 'broadcast', action: 'drawAgreed', ...self.getState() });
        } else if (self.pendingDraw && !msg.accept) {
            self.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
        }
        self.pendingDraw = null;
    },

    /**
     * 五子棋类：historyBoards 存落子前棋盘，悔棋时 pop 恢复。
     * currentPlayer 为 1/2。
     */
    undoGomokuHistory(self, ws, msg, slot) {
        if (!slot || self.gameOver) return;
        const room = self.room;
        const isMyTurn = (slot === 'black' && self.currentPlayer === 1) || (slot === 'white' && self.currentPlayer === 2);
        const steps = isMyTurn ? 2 : 1;
        if (self.historyBoards.length < steps) {
            ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
            return;
        }
        const opponentSlot = slot === 'black' ? 'white' : 'black';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) {
            for (let i = 0; i < steps; i++) {
                self.board = self.copyBoard(self.historyBoards.pop());
                self.moveHistory.pop();
            }
            let newPlayer = self.currentPlayer;
            for (let i = 0; i < steps; i++) newPlayer = newPlayer === 1 ? 2 : 1;
            self.currentPlayer = newPlayer;
            self.lastMoveMarkers = [];
            self.broadcast({ type: 'broadcast', action: 'undoAccept', ...self.getState() });
        } else {
            self.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    },

    undoResponseGomokuHistory(self, ws, msg) {
        if (self.pendingUndo && msg.accept) {
            const steps = self.pendingUndo.steps;
            if (self.historyBoards.length >= steps) {
                for (let i = 0; i < steps; i++) {
                    self.board = self.copyBoard(self.historyBoards.pop());
                    self.moveHistory.pop();
                }
                let newPlayer = self.currentPlayer;
                for (let i = 0; i < steps; i++) newPlayer = newPlayer === 1 ? 2 : 1;
                self.currentPlayer = newPlayer;
                self.lastMoveMarkers = [];
                self.broadcast({ type: 'broadcast', action: 'undoAccept', ...self.getState() });
            }
        } else if (self.pendingUndo && !msg.accept) {
            self.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
        }
        self.pendingUndo = null;
    },

    /** 仅观战者可改路数：parseInt size，调用 setBoardSize(n, ws) */
    setBoardSizeObserverOnly(self, ws, msg, slot) {
        if (slot) return;
        const n = parseInt(String(msg.size ?? ''), 10);
        self.setBoardSize(n, ws);
    },

    /**
     * 围棋等：需同时满足 !slot 且房内无棋手（players.size===0）才可改路数。
     */
    setBoardSizeWeiqiObserver(self, ws, msg, slot) {
        if (!slot && !self.room.players.size) {
            const n = parseInt(String(msg.size ?? ''), 10);
            self.setBoardSize(n, ws);
        }
    },

    /**
     * 方格围棋系共用：落子（禁全同）、虚着、悔棋申请/应答。
     * self 需有 board/boardSize/currentPlayer、historyBoards/historyBoardSet/historyMarkers、
     * lastMoveMarkers/moveHistory/moveCoords/passCounter、pendingUndo、tryPlaceStone、
     * copyBoard/boardToString/copyMarkers、broadcast/getState、performUndo、startScoreCounting。
     */
    weiqiMove(self, ws, msg, slot) {
        if (self.gameOver) return;
        if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
        const { row, col } = msg;
        if (row < 0 || row >= self.boardSize || col < 0 || col >= self.boardSize) return;
        if (self.board[row][col] !== 0) return;
        const playerVal = self.currentPlayer === 1 ? 1 : 2;
        const newBoard = self.tryPlaceStone(self.board, row, col, playerVal);
        if (!newBoard) return;
        const newBoardStr = self.boardToString(newBoard);
        if (self.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }
        self.historyBoards.push(self.copyBoard(newBoard));
        self.historyBoardSet.add(newBoardStr);
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'move', player: slot, row, col });
        self.board = newBoard;
        self.lastMoveMarkers = [{ row, col, color: playerVal }];
        self.currentPlayer = 3 - self.currentPlayer;
        self.passCounter = 0;
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
    },

    weiqiPass(self, ws, slot) {
        const room = self.room;
        if (self.gameOver) return;
        if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
        self.historyBoards.push(self.copyBoard(self.board));
        self.historyMarkers.push(self.copyMarkers(self.lastMoveMarkers));
        self.moveHistory.push(slot);
        self.moveCoords.push({ type: 'pass', player: slot });
        self.currentPlayer = self.currentPlayer === 1 ? 2 : 1;
        self.passCounter++;
        self.lastMoveMarkers = [];
        self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
        if (self.passCounter >= 2) {
            const blackPlayer = room.getPlayerBySlot('black');
            const whitePlayer = room.getPlayerBySlot('white');
            if (blackPlayer && whitePlayer) {
                self.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                self.gameOver = true;
                self.broadcast({ type: 'broadcast', action: 'endAgreed', ...self.getState() });
            }
        }
    },

    weiqiRequestUndo(self, ws, slot, opts = {}) {
        const cannotMsg = opts.cannotUndoMsg ?? '无法悔棋。';
        const room = self.room;
        if (!slot || self.gameOver) return;
        let steps = 0;
        for (let i = self.moveHistory.length - 1; i >= 0; i--) {
            steps++;
            if (self.moveHistory[i] === slot) break;
        }
        if (steps === 0 || steps > self.historyBoards.length) {
            ws.send(JSON.stringify({ type: 'error', message: cannotMsg }));
            return;
        }
        const opponentSlot = slot === 'black' ? 'white' : 'black';
        const opponent = room.getPlayerBySlot(opponentSlot);
        if (!opponent) self.performUndo(steps, ws);
        else {
            self.pendingUndo = { requester: ws, steps };
            opponent.send(JSON.stringify({ type: 'undoRequest' }));
        }
    },

    weiqiUndoResponse(self, ws, msg, opts = {}) {
        const denyMsg = opts.undoDeniedMsg ?? '对方拒绝悔棋。';
        if (self.pendingUndo) {
            if (msg.accept) self.performUndo(self.pendingUndo.steps, self.pendingUndo.requester);
            else self.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: denyMsg }));
        }
        self.pendingUndo = null;
    },
};


/**
 * 方格棋盘、四邻（上下左右）的围棋共用算法。
 * board[r][c]：0 空，1 黑，2 白。
 * 变种若规则不同（如二气/三气），通过 minLib 参数区分；不围棋、零气等特殊逻辑请在各 Room 内单独实现。
 */
const squareWeiqiRules = {
    countGroupLiberties(board, row, col, boardSize) {
        const color = board[row][col];
        if (color === 0) return 0;
        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (board[nr][nc] === 0) {
                    liberties.add(nr + ',' + nc);
                } else if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    },

    hasLiberty(board, row, col, boardSize) {
        return this.countGroupLiberties(board, row, col, boardSize) > 0;
    },

    removeGroup(board, row, col, color, boardSize) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    },

    /**
     * 标准提子规则：敌方块气数 &lt; minLib 则提掉；落子后己方块气数 &lt; minLib 则提掉（含自杀手筋）。
     * minLib=1 为标准围棋；2 为二气围棋；3 为三气围棋。
     */
    tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, boardSize, copyBoardFn, minLib = 1) {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = copyBoardFn(boardBefore);
        newBoard[row][col] = playerVal;

        const enemyColor = 3 - playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && newBoard[nr][nc] === enemyColor) {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) {
                    checkedEnemy.add(key);
                    if (this.countGroupLiberties(newBoard, nr, nc, boardSize) < minLib) {
                        this.removeGroup(newBoard, nr, nc, enemyColor, boardSize);
                    }
                }
            }
        }

        if (this.countGroupLiberties(newBoard, row, col, boardSize) < minLib) {
            this.removeGroup(newBoard, row, col, playerVal, boardSize);
        }

        return newBoard;
    },

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, boardSize) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = libertyRow + dr;
            const nc = libertyCol + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === opponentColor) return true;
        }
        return false;
    },

    /**
     * @param maxWeakLiberties 有气但可能被「包围」判死的阈值：标准/二气为 2，三气围棋为 3
     */
    removeDeadAndDying(srcBoard, boardSize, copyBoardFn, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    /**
     * @param {object} [options]
     * @param {(cell:number)=>boolean} [options.isPassable] 距离扩张时是否可走入该格；默认与洞一致：-1 洞不可穿。
     * 中立子围棋可传入 (v) => v !== 3 等。
     */
    assignTerritoryWithRange(liveBoard, boardSize, options = {}) {
        const isPassable = options.isPassable ?? ((v) => v !== -1);
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && isPassable(liveBoard[nr][nc]) && dist[nr][nc] === Infinity) {
                            dist[nr][nc] = d + 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScore(liveBoard, territory, boardSize) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    },

    /**
     * 同一平面方格，但部分点不可作气（洞）。isHole(r,c)=true 时该点既不能放子也不能作气穿行。
     */
    removeDeadAndDyingWithHoles(srcBoard, boardSize, copyBoardFn, isHole, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        const isLibertyCell = (r, c) =>
            r >= 0 && r < boardSize && c >= 0 && c < boardSize &&
            boardCopy[r][c] === 0 && !isHole(r, c);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (isLibertyCell(nr, nc)) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    assignTerritoryWithRangeWithHoles(liveBoard, boardSize, isHole) {
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0 || isHole(r, c)) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (isHole(nr, nc)) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScoreWithHoles(liveBoard, territory, boardSize, isHole) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0 && !isHole(r, c)) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }
};

/**
 * 二维数组棋盘 + 每点邻接由 getNeighbors(r,c) 给出（扭棱四角、三角围棋等）。
 * board[r][c]：0 空，1 黑，2 白；-1 可表示无效格（仅不参与落子，形势 BFS 不可穿）。
 */
const gridGraphGoRules = {
    countGroupLiberties(board, row, col, getNeighbors) {
        const color = board[row][col];
        if (color === 0) 
            return 0;

        const visited = new Set();
        const key = (r, c) => r + ',' + c;
        const queue = [[row, col]];
        visited.add(key(row, col));
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [nr, nc] of getNeighbors(r, c)) {
                if (board[nr][nc] === 0) liberties.add(key(nr, nc));
                else if (board[nr][nc] === color && !visited.has(key(nr, nc))) {
                    visited.add(key(nr, nc));
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    },

    removeGroup(board, row, col, color, getNeighbors) {
        const queue = [[row, col]];
        board[row][col] = 0;
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [nr, nc] of getNeighbors(r, c)) {
                if (board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    },

    tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, copyBoardFn, getNeighbors, minLib = 1) {
        if (boardBefore[row][col] !== 0) 
            return null;
        const newBoard = copyBoardFn(boardBefore);
        newBoard[row][col] = playerVal;
        const enemyColor = 3 - playerVal;
        const checkedEnemy = new Set();
        for (const [nr, nc] of getNeighbors(row, col)) {
            if (newBoard[nr][nc] === enemyColor) {
                const k = `${nr},${nc}`;
                if (!checkedEnemy.has(k)) {
                    checkedEnemy.add(k);
                    if (this.countGroupLiberties(newBoard, nr, nc, getNeighbors) < minLib) {
                        this.removeGroup(newBoard, nr, nc, enemyColor, getNeighbors);
                    }
                }
            }
        }
        if (this.countGroupLiberties(newBoard, row, col, getNeighbors) < minLib) {
            this.removeGroup(newBoard, row, col, playerVal, getNeighbors);
        }
        return newBoard;
    },

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, getNeighbors) {
        for (const [nr, nc] of getNeighbors(libertyRow, libertyCol)) {
            if (board[nr][nc] === opponentColor) return true;
        }
        return false;
    },

    removeDeadAndDying(srcBoard, gridW, gridH, copyBoardFn, getNeighbors, isIntersection, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(gridW).fill().map(() => Array(gridH).fill(false));
            for (let r = 0; r < gridW; r++) {
                for (let c = 0; c < gridH; c++) {
                    if (!isIntersection(r, c)) continue;
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [nr, nc] of getNeighbors(rr, cc)) {
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!this.isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, getNeighbors)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    },

    assignTerritoryWithRange(liveBoard, gridW, gridH, getNeighbors, isIntersection, options = {}) {
        const passCell = options.passCell ?? ((v) => v !== -1);
        const territory = Array(gridW).fill().map(() => Array(gridH).fill(0));
        for (let r = 0; r < gridW; r++) {
            for (let c = 0; c < gridH; c++) {
                if (!isIntersection(r, c) || liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= gridW - 2 || c <= 1 || c >= gridH - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(gridW).fill().map(() => Array(gridH).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [nr, nc] of getNeighbors(cr, cc)) {
                        if (!passCell(liveBoard[nr][nc])) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    },

    computeScore(liveBoard, territory, gridW, gridH, isIntersection) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < gridW; r++) {
            for (let c = 0; c < gridH; c++) {
                if (!isIntersection(r, c)) continue;
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }
};

/**
 * 一维顶点棋盘 + 邻接表 neighbors[v]（六角、五角围棋等）。
 */
const vertexGraphGoRules = {
    hasLiberty(boardState, start, neighbors) {
        const color = boardState[start];
        if (color === 0) return false;
        const queue = [start];
        const visited = new Array(boardState.length).fill(false);
        visited[start] = true;
        let idx = 0;
        while (idx < queue.length) {
            const v = queue[idx++];
            for (const nb of neighbors[v]) {
                if (boardState[nb] === 0) return true;
                if (boardState[nb] === color && !visited[nb]) {
                    visited[nb] = true;
                    queue.push(nb);
                }
            }
        }
        return false;
    },

    removeGroup(boardState, start, neighbors) {
        const color = boardState[start];
        if (color === 0) return;
        const queue = [start];
        boardState[start] = 0;
        let idx = 0;
        while (idx < queue.length) {
            const v = queue[idx++];
            for (const nb of neighbors[v]) {
                if (boardState[nb] === color) {
                    boardState[nb] = 0;
                    queue.push(nb);
                }
            }
        }
    },

    tryPlaceStone(boardBefore, vertex, playerVal, neighbors) {
        if (boardBefore[vertex] !== 0) return null;
        const newBoard = boardBefore.slice();
        newBoard[vertex] = playerVal;
        const pv = playerVal;
        for (const nb of neighbors[vertex]) {
            if (newBoard[nb] === 3 - pv && !this.hasLiberty(newBoard, nb, neighbors)) {
                this.removeGroup(newBoard, nb, neighbors);
            }
        }
        if (!this.hasLiberty(newBoard, vertex, neighbors)) {
            this.removeGroup(newBoard, vertex, neighbors);
        }
        return newBoard;
    },

    isLibertySurroundedByOpponent(boardState, libertyVertex, opponentColor, neighbors) {
        for (const nb of neighbors[libertyVertex]) {
            if (boardState[nb] === opponentColor) return true;
        }
        return false;
    },

    removeDeadAndDying(srcBoard, neighbors, vertexCount, copyBoardFn, maxWeakLiberties = 2) {
        let newBoard = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = new Array(vertexCount).fill(false);
            for (let v = 0; v < vertexCount; v++) {
                if (newBoard[v] !== 0 && !visited[v]) {
                    const color = newBoard[v];
                    const queue = [v];
                    visited[v] = true;
                    const stones = [v];
                    const liberties = new Set();
                    let idx = 0;
                    while (idx < queue.length) {
                        const cur = queue[idx++];
                        for (const nb of neighbors[cur]) {
                            if (newBoard[nb] === 0) liberties.add(nb);
                            else if (newBoard[nb] === color && !visited[nb]) {
                                visited[nb] = true;
                                queue.push(nb);
                                stones.push(nb);
                            }
                        }
                    }
                    if (liberties.size === 0) {
                        for (const s of stones) newBoard[s] = 0;
                        changed = true;
                        continue;
                    }
                    if (liberties.size <= maxWeakLiberties) {
                        let allControlled = true;
                        for (const lib of liberties) {
                            if (!this.isLibertySurroundedByOpponent(newBoard, lib, 3 - color, neighbors)) {
                                allControlled = false;
                                break;
                            }
                        }
                        if (allControlled) {
                            for (const s of stones) newBoard[s] = 0;
                            changed = true;
                        }
                    }
                }
            }
        }
        return newBoard;
    }
};

module.exports = {
    copyBoard,
    boardToString,
    encodeInitialPositionCompact,
    applyInitialPositionCompact,
    assignBlackWhiteSlot,
    QiTwoPlayerRoomBase,
    qiProtocol,
    squareWeiqiRules,
    gridGraphGoRules,
    vertexGraphGoRules
};
