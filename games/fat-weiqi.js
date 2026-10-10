const crypto = require('crypto');

const { qiBoardSeatOverlay, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, encodeOpeningPositionCompact, computeNearestWeiqiLead, squareWeiqiScoringOps } = require('../common');

// ======================== 胖围棋规则 ========================
// 胖围棋在围棋基础上修改三条规则：
//  1) 落子不能与任何棋盘上已有的棋子相邻（上下左右四邻）。
//  2) 同色棋子按「胖连接」成组：坐标差 (±1,±1)（小尖）、(±1,±2)/(±2,±1)（小飞）
//     或 (±2,0)/(0,±2)（跳）的点相连（普通四邻不相连）；提子整组提。
//     跳要跨过中间那个空点；若双方的跳在同一中间点交叉（十字形，四个端点两种颜色），
//     则这两个跳都不算相连。
//  3) 一组若能「落一个子与它相连」的点（胖邻且可落子的空点）全部不存在，
//     则整组被提 —— 可落子点被自己或对方占掉、或因四邻有子而不可落，都会让它失气。
// 落子后只判定受影响组：落点 p 及其四邻空点的可落性变化，
// 会影响的组 = p 与其四邻点的胖邻棋子所在组；先判对方提子再判己方。
const ORTH_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const FAT_DIRS = [
    [-1, -1], [-1, 1], [1, -1], [1, 1],       // 小尖：横纵各差 1
    [-1, -2], [-1, 2], [1, -2], [1, 2],       // 小飞：横差 1 纵差 2
    [-2, -1], [-2, 1], [2, -1], [2, 1],       // 小飞：横差 2 纵差 1
    [-2, 0], [2, 0], [0, -2], [0, 2]          // 跳：同一条轴上隔一点
];
const inB = (r, c, n) => r >= 0 && r < n && c >= 0 && c < n;

/**
 * (r,c) 一步走到 (tr,tc) 是否算「胖相连」。这里的 (tr,tc) 既可以是同色棋子（连组用），
 * 也可以是用来判「可落子相连点」的空点（连组用不到颜色对，判定与落子后一致）。
 *  - 小尖/小飞：跃过去，中间有没有子都一样算相连；
 *  - 跳：中间那个空点必须还是空的；若与对方的跳在同一中间点交叉则不算相连 ——
 *    交叉即另一条轴的上下（或左右）两格都是对方棋子（对方那两格相距 2、中间点同为该点，
 *    所以那也正是对方的一个跳，一并失效）。
 */
function fatLinkOk(board, r, c, tr, tc, n) {
    const dr = tr - r;
    const dc = tc - c;
    if (dr !== 0 && dc !== 0) return true;
    const mr = (r + tr) / 2;
    const mc = (c + tc) / 2;
    if (!inB(mr, mc, n) || board[mr][mc] !== 0) return false;
    const opp = 3 - board[r][c];
    const a = dr === 0 ? [mr - 1, mc] : [mr, mc - 1];
    const b = dr === 0 ? [mr + 1, mc] : [mr, mc + 1];
    if (!inB(a[0], a[1], n) || !inB(b[0], b[1], n)) return true;
    return !(board[a[0]][a[1]] === opp && board[b[0]][b[1]] === opp);
}

/** 收集 (r,c) 同色棋子所在的胖组（胖相连递归闭包），返回 [[r,c],...]（不含 (r,c) 为空的情况） */
function fatGroupStones(board, r, c, n) {
    const color = board[r][c];
    if (color === 0) return [];
    const stones = [];
    const visited = Array.from({ length: n }, () => new Uint8Array(n));
    visited[r][c] = 1;
    const queue = [[r, c]];
    for (let i = 0; i < queue.length; i++) {
        const [cr, cc] = queue[i];
        stones.push([cr, cc]);
        for (const [dr, dc] of FAT_DIRS) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (!inB(nr, nc, n) || board[nr][nc] !== color || visited[nr][nc]) continue;
            if (!fatLinkOk(board, cr, cc, nr, nc, n)) continue;
            visited[nr][nc] = 1;
            queue.push([nr, nc]);
        }
    }
    return stones;
}

/**
 * 组是否有「可落子相连点」：存在空点 q，q 胖相连于组内某子，
 * 且 q 的上下左右四邻没有任何棋子（规则 1，可合法落子）。
 */
function fatGroupHasPlayableSpot(board, stones, n) {
    const seenSpots = new Set();
    for (const [r, c] of stones) {
        for (const [dr, dc] of FAT_DIRS) {
            const nr = r + dr;
            const nc = c + dc;
            if (!inB(nr, nc, n) || board[nr][nc] !== 0) continue;
            if (!fatLinkOk(board, r, c, nr, nc, n)) continue;   // 中间被占 / 与对方的跳交叉：这一步不算相连
            const key = nr * n + nc;
            if (seenSpots.has(key)) continue;
            seenSpots.add(key);
            let playable = true;
            for (const [dr2, dc2] of ORTH_DIRS) {
                const ar = nr + dr2;
                const ac = nc + dc2;
                if (inB(ar, ac, n) && board[ar][ac] !== 0) { playable = false; break; }
            }
            if (playable) return true;
        }
    }
    return false;
}

/** 在盘面上把 (r,c) 所在的整组（胖相连）清空 */
function fatRemoveGroupAt(board, r, c, n) {
    // 跳/交叉的判定依赖盘面，所以要先把整组算出来再统一清空（边提边算会算歪）
    const stones = fatGroupStones(board, r, c, n);
    for (const [r2, c2] of stones) board[r2][c2] = 0;
}

class WeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.openingBoard = this.copyBoard(this.board);
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
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        /** 先落座者为房主（WebSocket） */
        this.hostWs = null;
        /** 是否启用棋盘落座蒙版协议（执子由房主在限时对话框选择） */
        this.boardSeatOverlay = true;
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const snap = qiMatchTimeControl.snapshotForClient(this.tcClock);
        this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            if (this.pendingScore) return;
            const now = Date.now();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: lostSlot,
                    winner: winnerSlot,
                    ...this.getState()
                });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    /** 按「选择者己方执子」交换座位：colorChoice 为 black|white|random */

    /** 把当前协商界面重新推给某客户端，避免提交被忽略后卡死 */

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.setTimeLossResultText(lostSlot);
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: lostSlot,
                winner: winnerSlot,
                ...this.getState()
            });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    countGroupLiberties(board, row, col) {
        // 胖语义：该胖组「可落子的相连点」个数（空点胖相连于组且其四邻无子）
        const n = this.boardSize;
        const stones = fatGroupStones(board, row, col, n);
        const seenSpots = new Set();
        let count = 0;
        for (const [r, c] of stones) {
            for (const [dr, dc] of FAT_DIRS) {
                const nr = r + dr;
                const nc = c + dc;
                if (!inB(nr, nc, n) || board[nr][nc] !== 0) continue;
                if (!fatLinkOk(board, r, c, nr, nc, n)) continue;   // 中间被占 / 与对方的跳交叉：这一步不算相连
                const key = nr * n + nc;
                if (seenSpots.has(key)) continue;
                seenSpots.add(key);
                let playable = true;
                for (const [dr2, dc2] of ORTH_DIRS) {
                    const ar = nr + dr2;
                    const ac = nc + dc2;
                    if (inB(ar, ac, n) && board[ar][ac] !== 0) { playable = false; break; }
                }
                if (playable) count++;
            }
        }
        return count;
    }

    removeGroup(board, row, col, color) {
        fatRemoveGroupAt(board, row, col, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        const n = this.boardSize;
        if (boardBefore[row][col] !== 0) return null;
        // 胖规则 1：落子不能与任何棋盘上已有的棋子（上下左右）相邻
        for (const [dr, dc] of ORTH_DIRS) {
            const nr = row + dr;
            const nc = col + dc;
            if (inB(nr, nc, n) && boardBefore[nr][nc] !== 0) return null;
        }
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        const enemy = 3 - playerVal;

        // 受影响点 = 落点 p 及其四邻空点（p 占位后，四邻点失去可落性）。
        // 候选组 = 这些点的胖邻棋子所在的胖组（去重收集）。
        const affectedPoints = [[row, col]];
        for (const [dr, dc] of ORTH_DIRS) {
            const nr = row + dr;
            const nc = col + dc;
            if (inB(nr, nc, n)) affectedPoints.push([nr, nc]);
        }
        const candidates = [];          // { color, stones }
        const visitedCells = Array.from({ length: n }, () => new Uint8Array(n));
        for (const [pr, pc] of affectedPoints) {
            for (const [dr, dc] of FAT_DIRS) {
                const nr = pr + dr;
                const nc = pc + dc;
                if (!inB(nr, nc, n) || newBoard[nr][nc] === 0 || visitedCells[nr][nc]) continue;
                const stones = [];
                const color = newBoard[nr][nc];
                visitedCells[nr][nc] = 1;
                const queue = [[nr, nc]];
                for (let i = 0; i < queue.length; i++) {
                    const [cr, cc] = queue[i];
                    stones.push([cr, cc]);
                    for (const [dr2, dc2] of FAT_DIRS) {
                        const ar = cr + dr2;
                        const ac = cc + dc2;
                        if (!inB(ar, ac, n) || newBoard[ar][ac] !== color || visitedCells[ar][ac]) continue;
                        if (!fatLinkOk(newBoard, cr, cc, ar, ac, n)) continue;
                        visitedCells[ar][ac] = 1;
                        queue.push([ar, ac]);
                    }
                }
                candidates.push({ color, stones });
            }
        }

        // 先判对方：所有候选对方组基于同一盘面（含 p、尚未提子）统一判定，无气的整组提
        for (const g of candidates) {
            if (g.color === enemy && !fatGroupHasPlayableSpot(newBoard, g.stones, n)) {
                for (const [r2, c2] of g.stones) newBoard[r2][c2] = 0;
            }
        }
        // 再判己方：对方提完后的盘面上，直接判落点 p 所在的整组（孤子也在此组内），
        // 无气的整组提（允许自杀）
        const ownStones = fatGroupStones(newBoard, row, col, n);
        if (!fatGroupHasPlayableSpot(newBoard, ownStones, n)) {
            for (const [r2, c2] of ownStones) newBoard[r2][c2] = 0;
        }
        return newBoard;
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return squareWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this.boardSize
        );
    }

    removeDeadAndDying(srcBoard) {
        // 胖围棋数点不做自动判死：保留此钩子供协议兼容，返回原盘
        return this.copyBoard(srcBoard);
    }

    /** 形势判断 / 数点：只用最近归属档（公共口径）；不做自动判死（无气提子只发生在落子时） */
    computeLead() {
        const { lead } = computeNearestWeiqiLead(this.board, this.boardSize <= 8 ? 4.25 : 3.25, squareWeiqiScoringOps(this.boardSize, {
            copyBoard: (b) => this.copyBoard(b)
        }));
        return lead;
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和棋';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    getState()
    {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            board: this.board,
            initialBoard,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null,
            boardSeatOverlay: !!this.boardSeatOverlay,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getInitialState() {
        return this.getState();
    }

    getStateForClient() {
        return this.getState();
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const before = () => this._drainClockBeforeMove(moveSlot);
                qiProtocol.weiqiMove(this, ws, msg, moveSlot, { beforeCommit: before });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const beforeP = () => this._drainClockBeforeMove(passSlot);
                qiProtocol.weiqiPass(this, ws, passSlot, { beforeCommit: beforeP });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._stopClockTicker();
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length)
            return;

        for (let i = 0; i < steps; i++)
        {
            if (this.historyBoards.length > 0) {
                // 只有进过集合的手才该删（虚着/踩雷等手同样推了历史快照、盘面与上一手相同，
                // 拿它的快照去 delete 会误删上一次落子的记录 → 禁全同随后失效）
                const skPopped = this.historyBoards.pop();
                const skCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
                if (skCoord && ['move'].includes(skCoord.type))
                    this.historyBoardSet.delete(this.boardToString(skPopped));
            }
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
        if (this.historyBoards.length == 0)
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
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
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {

            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord()
    {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '围棋',
            gameId: 'weiqi',
            boardSize: this.boardSize,
            komi: this.boardSize <= 8 ? 4.25 : 3.25,
            players: { player1: null, player2: null },
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
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
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            if (entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(WeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
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
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
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

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
            }
            this.matchStarted = true;
        }

        if (data.result || data.resultText) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });

        if (this.hostWs === ws) {
            const other = slot === 'player1'
                ? this.room.getPlayerBySlot('player2')
                : this.room.getPlayerBySlot('player1');
            this.hostWs = other || null;
        }

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
            this.pendingScore = null;
            this.scoreProposalData = null;
        }
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    WeiqiRoom,
    initRoom(room) {
        room.gameLogic = new WeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};