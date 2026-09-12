const crypto = require('crypto');

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, encodeOpeningPositionCompact } = require('../common');

// ======================== 胖围棋规则 ========================
// 胖围棋在围棋基础上修改三条规则：
//  1) 落子不能与任何棋盘上已有的棋子相邻（上下左右四邻）。
//  2) 同色棋子按「胖连接」成组：坐标差 (±1,±1) 或 (±1,±2)/(±2,±1) 的点相连
//     （普通四邻不相连）；提子整组提。
//  3) 一组若能「落一个子与它相连」的点（胖邻且可落子的空点）全部不存在，
//     则整组被提 —— 可落子点被自己或对方占掉、或因四邻有子而不可落，都会让它失气。
// 落子后只判定受影响组：落点 p 及其四邻空点的可落性变化，
// 会影响的组 = p 与其四邻点的胖邻棋子所在组；先判对方提子再判己方。
const ORTH_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const FAT_DIRS = [
    [-1, -1], [-1, 1], [1, -1], [1, 1],       // 横纵各差 1
    [-1, -2], [-1, 2], [1, -2], [1, 2],       // 横差 1 纵差 2
    [-2, -1], [-2, 1], [2, -1], [2, 1]        // 横差 2 纵差 1
];
const inB = (r, c, n) => r >= 0 && r < n && c >= 0 && c < n;

/** 收集 (r,c) 同色棋子所在的胖组（12 向递归闭包），返回 [[r,c],...]（不含 (r,c) 为空的情况） */
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
            if (inB(nr, nc, n) && board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = 1;
                queue.push([nr, nc]);
            }
        }
    }
    return stones;
}

/**
 * 组是否有「可落子相连点」：存在空点 q，q 胖邻于组内某子，
 * 且 q 的上下左右四邻没有任何棋子（规则 1，可合法落子）。
 */
function fatGroupHasPlayableSpot(board, stones, n) {
    const seenSpots = new Set();
    for (const [r, c] of stones) {
        for (const [dr, dc] of FAT_DIRS) {
            const nr = r + dr;
            const nc = c + dc;
            if (!inB(nr, nc, n) || board[nr][nc] !== 0) continue;
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

/** 在盘面上把 (r,c) 所在的整组（12 向同色）清空 */
function fatRemoveGroupAt(board, r, c, n) {
    const color = board[r][c];
    if (color === 0) return;
    const queue = [[r, c]];
    board[r][c] = 0;
    for (let i = 0; i < queue.length; i++) {
        const [cr, cc] = queue[i];
        for (const [dr, dc] of FAT_DIRS) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (inB(nr, nc, n) && board[nr][nc] === color) {
                board[nr][nc] = 0;
                queue.push([nr, nc]);
            }
        }
    }
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

    _clearTimeNegotiation(reason) {
        this.tcNego = null;
        this.broadcast({ type: 'timeControlReset', reason: reason || 'cleared' });
    }

    _firstPickerSlot() {
        if (this.hostWs) {
            const hs = this.room.getSlotByWs(this.hostWs);
            if (hs) return hs;
        }
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        const room = this.room;
        if (!room.getPlayerBySlot('player1') || !room.getPlayerBySlot('player2')) return;
        if (this.tcNego !== null) return;
        if (this.tcSettings !== null) return;
        const first = this._firstPickerSlot();
        this.tcNego = {
            phase: 'propose',
            proposal: null,
            waitingSlot: first,
            lastProposerSlot: null
        };
        const ws = room.getPlayerBySlot(first);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'propose',
                boardSeatOverlay: !!this.boardSeatOverlay
            }));
        }
        const other = first === 'player1' ? 'player2' : 'player1';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        if (!this.hostWs) this.hostWs = ws;
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    /** 按「选择者己方执子」交换座位：colorChoice 为 black|white|random */
    _applyChooserColorChoice(colorChoice, chooserSlot) {
        if (!chooserSlot) return null;
        const room = this.room;
        if (!room.getPlayerBySlot(chooserSlot)) return null;
        let raw = colorChoice;
        if (raw === 'hostWhite') raw = 'player2';
        if (raw === 'hostBlack') raw = 'player1';
        let target = 'player1';
        if (raw === 'player2') target = 'player2';
        else if (raw === 'random') target = Math.random() < 0.5 ? 'player1' : 'player2';
        if (chooserSlot === target) return target;

        if (typeof room.swapSlots === 'function') {
            room.swapSlots('player1', 'player2');
        } else {
            const a = room.slotOccupancy.get('player1') || null;
            const b = room.slotOccupancy.get('player2') || null;
            room.slotOccupancy.delete('player1');
            room.slotOccupancy.delete('player2');
            if (a) {
                room.players.set(a, 'player2');
                room.slotOccupancy.set('player2', a);
            }
            if (b) {
                room.players.set(b, 'player1');
                room.slotOccupancy.set('player1', b);
            }
        }
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        this.slotJoinedAt.player1 = tw;
        this.slotJoinedAt.player2 = tb;
        return target;
    }

    _notifyColorsAfterHostChoice() {
        const room = this.room;
        const b = room.getPlayerBySlot('player1');
        const w = room.getPlayerBySlot('player2');
        const hostSlot = this.hostWs ? room.getSlotByWs(this.hostWs) : null;
        if (b) b.send(JSON.stringify({ type: 'colorAssigned', color: 'black', finalized: true, isHost: b === this.hostWs }));
        if (w) w.send(JSON.stringify({ type: 'colorAssigned', color: 'white', finalized: true, isHost: w === this.hostWs }));
        this.broadcast({
            type: 'colorsFinalized',
            slots: { player1: !!b, player2: !!w },
            hostSlot
        });
    }

    _finalizeTimeControl(valid) {
        if (this.boardSeatOverlay) {
            const chooserSlot = (valid && valid.colorChooserSlot)
                || (this.tcNego && this.tcNego.lastProposerSlot)
                || this._firstPickerSlot();
            this._applyChooserColorChoice((valid && valid.colorChoice) || 'black', chooserSlot);
            this._notifyColorsAfterHostChoice();
        }
        this.tcSettings = valid.timed
            ? {
                timed: true,
                mainMinutes: valid.mainMinutes,
                byoyomiSeconds: valid.byoyomiSeconds,
                maxTimeouts: valid.maxTimeouts
            }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', now);
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null
        });
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                boardSeatOverlay: !!this.boardSeatOverlay,
                proposal: {
                    ok: true,
                    timed: proposal.timed,
                    mainMinutes: proposal.mainMinutes,
                    byoyomiSeconds: proposal.byoyomiSeconds,
                    maxTimeouts: proposal.maxTimeouts,
                    colorChoice: proposal.colorChoice || null,
                    colorChooserSlot: proposal.colorChooserSlot || null
                }
            }));
        }
    }

    /** 把当前协商界面重新推给某客户端，避免提交被忽略后卡死 */
    _resendNegotiationUi(ws) {
        if (!this.tcNego || !ws) return;
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;
        if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'propose') {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'propose',
                boardSeatOverlay: !!this.boardSeatOverlay
            }));
            return;
        }
        if (this.tcNego.waitingSlot === slot && this.tcNego.phase === 'respond' && this.tcNego.proposal) {
            this._sendRespondDialog(slot, this.tcNego.proposal);
            return;
        }
        ws.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            this._resendNegotiationUi(ws);
            return;
        }
        if (this.boardSeatOverlay) {
            // colorChoice 相对提交者己方：black|white|random（兼容旧 hostBlack/hostWhite）
            const raw = msg && msg.colorChoice;
            if (raw === 'black' || raw === 'hostBlack')
                v.colorChoice = 'player1';
            else if (raw === 'white' || raw === 'hostWhite')
                v.colorChoice = 'player2';
            else if (raw === 'random')
                v.colorChoice = 'random';
            else
                v.colorChoice = 'player1';
            // 选择者永远是本次提交的人
            v.colorChooserSlot = slot;
        }
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) {
                this._resendNegotiationUi(ws);
                return;
            }
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'player1' ? 'player2' : 'player1';
            this.tcNego.waitingSlot = other;
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) {
                this._resendNegotiationUi(ws);
                return;
            }
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'player1' ? 'player2' : 'player1';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') {
            if (this.tcNego) this._resendNegotiationUi(ws);
            return;
        }
        if (slot !== this.tcNego.waitingSlot) {
            this._resendNegotiationUi(ws);
            return;
        }
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

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
        // 胖语义：该胖组「可落子的相连点」个数（空点胖邻于组且其四邻无子）
        const n = this.boardSize;
        const stones = fatGroupStones(board, row, col, n);
        const seenSpots = new Set();
        let count = 0;
        for (const [r, c] of stones) {
            for (const [dr, dc] of FAT_DIRS) {
                const nr = r + dr;
                const nc = c + dc;
                if (!inB(nr, nc, n) || board[nr][nc] !== 0) continue;
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
                        if (inB(ar, ac, n) && newBoard[ar][ac] === color && !visitedCells[ar][ac]) {
                            visitedCells[ar][ac] = 1;
                            queue.push([ar, ac]);
                        }
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

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    computeLead()
    {
        // 胖围棋：数点不做自动判死（无气提子只发生在落子时），直接按当前盘算地
        const territory = this.assignTerritoryWithRange(this.board);
        const { blackTotal, whiteTotal } = this.computeScore(this.board, territory);
        const KOMI = this.boardSize <= 8 ? 4.25 : 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
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

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和棋' || resultText === 'draw') return 'draw';
        if (resultText.includes('白胜')) return 'player2';
        if (resultText.includes('黑胜')) return 'player1';
        if (resultText === 'player1' || resultText === 'player2' || resultText === 'draw') return resultText;
        return null;
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
            case 'selectColor':
            case 'takeSeat': {
                if (typeof qiProtocol.takeSeat === 'function') {
                    qiProtocol.takeSeat(this, ws, msg);
                    break;
                }
                // 旧 common 无 takeSeat：开局前自动分配空位，避免无 color 或抢座失败
                if (this.gameOver) break;
                let color = (msg.color === 'black' || msg.color === 'white') ? msg.color : null;
                if (!this.matchStarted) {
                    if (!this.room.getPlayerBySlot('player1')) color = 'player1';
                    else if (!this.room.getPlayerBySlot('player2')) color = 'player2';
                    else {
                        // 座位已满：静默忽略
                        break;
                    }
                } else if (!color) {
                    ws.send(JSON.stringify({ type: 'error', message: '请选择继续执黑或执白。' }));
                    break;
                }
                qiProtocol.selectColor(this, ws, { color }, {
                    colorOccupiedMsg: this.matchStarted ? '该座位已被占用。' : '双方均已落座。'
                });
                break;
            }

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws, msg);
                break;

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
        for (let [client, slot] of this.room.players.entries())
        {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
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
        if (!Number.isInteger(newSize) || newSize > 27) {
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
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = WeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'player1' || data.result === 'player2' || data.result === 'draw'))
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
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};