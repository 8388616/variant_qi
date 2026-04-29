/**
 * 五角围棋：开罗式五边形密铺（单元由 4 个基本五边形组成），路数 n 对应
 * (n−1)²+(n−2)² 个单元；主格点 (i,j) 与嵌入格 (i+½,j+½)。
 */

const SQRT3 = Math.sqrt(3);
const T = SQRT3 - 1;
/** 倒置五边形顶边 y − 正放五边形底边 y，使 |A1−A4| = |CD| = T */
const PENT_STACK_H = 2;

const PENT_TEMPLATE = {
    A: [0, 1.3660254037844388],
    B: [0.8660254037844386, 0.8660254037844386],
    C: [0.3660254037844386, 0],
    D: [-0.3660254037844386, 0],
    E: [-0.8660254037844386, 0.8660254037844386]
};

function alignPentagon(pent, mapC, mapD, flipY) {
    const pts = {};
    for (const k of Object.keys(pent)) {
        let p = [...pent[k]];
        if (flipY) p[1] = -p[1];
        pts[k] = p;
    }
    const Cs = pts.C;
    const Ds = pts.D;
    const a1 = Math.atan2(Ds[1] - Cs[1], Ds[0] - Cs[0]);
    const a2 = Math.atan2(mapD[1] - mapC[1], mapD[0] - mapC[0]);
    const ang = a2 - a1;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    function rot(p) {
        return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
    }
    const Cs2 = rot(Cs);
    const tx = mapC[0] - Cs2[0];
    const ty = mapC[1] - Cs2[1];
    const out = {};
    for (const k of Object.keys(pts)) {
        const p = rot(pts[k]);
        out[k] = [p[0] + tx, p[1] + ty];
    }
    return out;
}

function oneCompound(ox, oy) {
    const P4 = alignPentagon(PENT_TEMPLATE, [T / 2 + ox, oy], [-T / 2 + ox, oy], false);
    const P1 = alignPentagon(PENT_TEMPLATE, [T / 2 + ox, PENT_STACK_H + oy], [-T / 2 + ox, PENT_STACK_H + oy], true);
    const P2 = alignPentagon(PENT_TEMPLATE, P4.A, P1.A, false);
    const P3 = alignPentagon(PENT_TEMPLATE, P1.A, P4.A, false);
    return [P1, P2, P3, P4];
}

function vertexKey(x, y) {
    return `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
}

/**
 * @param {number} n 路数 3～9
 * @returns {{ vertexCount: number, neighbors: number[][] }}
 */
function generatePentBoardData(n) {
    const ux = 1 + SQRT3;
    const uy = 0;
    const vx = 0;
    const vy = 2;

    const positions = [];
    for (let i = 0; i <= n - 2; i++) {
        for (let j = 0; j <= n - 2; j++)
            positions.push([i, j]);
    }
    for (let i = 0; i <= n - 3; i++) {
        for (let j = 0; j <= n - 3; j++)
            positions.push([i + 0.5, j + 0.5]);
    }

    const vertexMap = new Map();
    const vertices = [];
    const edgeSet = new Set();

    function addVertex(x, y) {
        const k = vertexKey(x, y);
        if (!vertexMap.has(k)) {
            vertexMap.set(k, vertices.length);
            vertices.push({ x, y });
        }
        return vertexMap.get(k);
    }

    function addEdge(a, b) {
        if (a === b) return;
        const e = a < b ? `${a},${b}` : `${b},${a}`;
        edgeSet.add(e);
    }

    for (const [px, py] of positions) {
        const ox = px * ux + py * vx;
        const oy = px * uy + py * vy;
        const comps = oneCompound(ox, oy);
        for (const P of comps) {
            const order = ['A', 'B', 'C', 'D', 'E'];
            const ids = order.map(k => addVertex(P[k][0], P[k][1]));
            for (let i = 0; i < 5; i++)
                addEdge(ids[i], ids[(i + 1) % 5]);
        }
    }

    for (let i = 0; i < vertices.length; i++) {
        const { x, y } = vertices[i];
        vertices[i] = { x: -y, y: x };
    }

    const V = vertices.length;
    const neighborSets = Array.from({ length: V }, () => new Set());
    for (const e of edgeSet) {
        const [a, b] = e.split(',').map(Number);
        neighborSets[a].add(b);
        neighborSets[b].add(a);
    }
    const neighbors = neighborSets.map(s => Array.from(s));
    return { vertexCount: V, neighbors };
}

const { QiTwoPlayerRoomBase, vertexGraphWeiqiRules } = require('../common');
class PentagonWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialLanes = 5) {
        super(room);
        this.boardLanes = initialLanes;
        const { vertexCount, neighbors } = generatePentBoardData(initialLanes);
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.board = Array(this.vertexCount).fill(0);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
    }

    copyBoard(src) { return src.slice(); }

    boardToString(board) { return board.join(','); }

    hasLiberty(boardState, start) {
        return vertexGraphWeiqiRules.hasLiberty(boardState, start, this.neighbors);
    }

    removeGroup(boardState, start) {
        vertexGraphWeiqiRules.removeGroup(boardState, start, this.neighbors);
    }

    tryPlaceStone(boardBefore, vertex, playerVal) {
        return vertexGraphWeiqiRules.tryPlaceStone(boardBefore, vertex, playerVal, this.neighbors);
    }

    removeDeadAndDying(srcBoard) {
        return vertexGraphWeiqiRules.removeDeadAndDying(
            srcBoard, this.neighbors, this.vertexCount, (b) => this.copyBoard(b)
        );
    }

    multiSourceBFS(liveBoard, color) {
        const dist = new Array(this.vertexCount).fill(Infinity);
        const queue = [];
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === color) {
                dist[v] = 0;
                queue.push(v);
            }
        }
        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            for (const nb of this.neighbors[cur]) {
                if (dist[nb] > dist[cur] + 1) {
                    dist[nb] = dist[cur] + 1;
                    queue.push(nb);
                }
            }
        }
        return dist;
    }

    assignTerritory(liveBoard) {
        const territory = new Array(this.vertexCount).fill(0);
        let blackCount = 0, whiteCount = 0;
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === 1) blackCount++;
            else if (liveBoard[v] === 2) whiteCount++;
        }
        if (blackCount === 0 && whiteCount === 0) return territory;
        if (blackCount === 0) {
            for (let v = 0; v < this.vertexCount; v++) if (liveBoard[v] === 0) territory[v] = 2;
            return territory;
        }
        if (whiteCount === 0) {
            for (let v = 0; v < this.vertexCount; v++) if (liveBoard[v] === 0) territory[v] = 1;
            return territory;
        }
        const distBlack = this.multiSourceBFS(liveBoard, 1);
        const distWhite = this.multiSourceBFS(liveBoard, 2);
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] !== 0) continue;
            if (distBlack[v] < distWhite[v]) territory[v] = 1;
            else if (distWhite[v] < distBlack[v]) territory[v] = 2;
            else territory[v] = 3;
        }
        return territory;
    }

    computeScore(liveBoard, territory) {
        let blackStones = 0, whiteStones = 0;
        let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
        for (let v = 0; v < this.vertexCount; v++) {
            if (liveBoard[v] === 1) blackStones++;
            else if (liveBoard[v] === 2) whiteStones++;
            else {
                if (territory[v] === 1) blackTerritory++;
                else if (territory[v] === 2) whiteTerritory++;
                else if (territory[v] === 3) publicTerritory++;
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritory(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardLanes: this.boardLanes,
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            }
        };
    }

    startScoreCounting(requester, opponent) {
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    setBoardSize(newLanes, requesterWs) {
        if (!Number.isInteger(newLanes) || newLanes < 3 || newLanes > 9) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘路数无效（3-9）' }));
            return false;
        }
        const hasAnyStone = this.board.some(v => v !== 0);
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子或玩家，不能改变路数' }));
            return false;
        }
        const { vertexCount, neighbors } = generatePentBoardData(newLanes);
        this.boardLanes = newLanes;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.board = Array(this.vertexCount).fill(0);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.broadcast({ type: 'boardSizeChanged', boardLanes: this.boardLanes });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 1,
            gameType: '五角围棋',
            gameId: 'pentagon-weiqi',
            boardLanes: this.boardLanes,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: { black: [], white: [] },
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.vertex;
            }),
            result: this.gameOver ? this.winner : null
        };
    }

    resetToEmpty() {
        this.board = Array(this.vertexCount).fill(0);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'black' : 'white';
            if (entry[1] === 'p') return { type: 'pass', player };
            const vertex = parseInt(entry.substring(1), 10);
            return { type: 'move', player, vertex };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'pentagon-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要五角围棋棋谱）' }));
            return;
        }
        const newLanes = data.boardLanes || 5;
        if (!Number.isInteger(newLanes) || newLanes < 3 || newLanes > 9) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘路数无效（3-9）' }));
            return;
        }

        const { vertexCount, neighbors } = generatePentBoardData(newLanes);
        this.boardLanes = newLanes;
        this.vertexCount = vertexCount;
        this.neighbors = neighbors;
        this.resetToEmpty();

        if (data.initialPosition) {
            if (Array.isArray(data.initialPosition.black)) {
                for (const pos of data.initialPosition.black) {
                    const v = typeof pos === 'number' ? pos : pos[0];
                    if (Number.isInteger(v) && v >= 0 && v < this.vertexCount)
                        this.board[v] = 1;
                }
            }
            if (Array.isArray(data.initialPosition.white)) {
                for (const pos of data.initialPosition.white) {
                    const v = typeof pos === 'number' ? pos : pos[0];
                    if (Number.isInteger(v) && v >= 0 && v < this.vertexCount)
                        this.board[v] = 2;
                }
            }
        }

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(PentagonWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { vertex } = move;
                if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (this.board[vertex] !== 0) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手位置已有子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, vertex, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, vertex });
                this.board = newBoard;
                this.lastMoveMarkers = [{ vertex, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || { black: [], white: [] },
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size)
                    this.setBoardSize(msg.size, ws);
                break;

            case 'move':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { vertex } = msg;
                if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) return;
                if (this.board[vertex] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, vertex, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) return;
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, vertex });
                this.board = newBoard;
                this.lastMoveMarkers = [{ vertex, color: playerVal }];
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                break;

            case 'pass':
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                if (this.passCounter >= 2) {
                    const blackPlayer = room.getPlayerBySlot('black');
                    const whitePlayer = room.getPlayerBySlot('white');
                    if (blackPlayer && whitePlayer) {
                        this.startScoreCounting(blackPlayer, whitePlayer);
                    } else {
                        this.gameOver = true;
                        this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
                    }
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyBoards.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent)
                    this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept)
                        this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else
                        this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'black' ? 'white' : 'black';
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                if (!slot) return;
                const newGameOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!newGameOpponent) {
                    this.resetGame();
                } else {
                    this.pendingNewGame = ws;
                    newGameOpponent.send(JSON.stringify({ type: 'newGameRequest' }));
                }
                break;

            case 'newGameResponse':
                if (this.pendingNewGame && msg.accept) {
                    this.resetGame();
                } else if (this.pendingNewGame && !msg.accept) {
                    this.pendingNewGame.send(JSON.stringify({ type: 'error', message: '对方拒绝开始新局' }));
                }
                this.pendingNewGame = null;
                break;

            case 'requestDraw':
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!endOpponent) {
                    this.startScoreCounting(ws, ws);
                } else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept) {
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                } else if (this.pendingEnd && !msg.accept) {
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数子。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                        }
                    } else {
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0)
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = Array(this.vertexCount).fill(0);
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ vertex: m.vertex, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.vertexCount).fill(0);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
        const toRelease = [...this.room.players.entries()];
        for (const [client, s] of toRelease) {
            this.room.players.delete(client);
            this.room.slotOccupancy.delete(s);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
    }

    onPlayerLeave(ws) {
        const s = this.room.getSlotByWs(ws);
        if (s) this.room.broadcast({ type: 'playerLeft', slot: s });

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            this.pendingScore = null;
            this.scoreProposalData = null;
        }
    }
}

module.exports = {
    generatePentBoardData,
    initRoom(room) {
        room.gameLogic = new PentagonWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
