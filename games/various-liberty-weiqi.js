'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay } = require('../common');

const BACKPACK_CAP = 8;

function initialBag() {
    return [1, 1, 2, 2, 3, 3, 4, 4];
}

function copyBoard(src) {
    return src.map(row => row.slice());
}

function copyLevelBoard(boardSize) {
    return Array(boardSize).fill().map(() => Array(boardSize).fill(0));
}

function collectGroup(board, levelBoard, boardSize, startR, startC) {
    const color = board[startR][startC];
    if (color === 0) return null;
    const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const queue = [[startR, startC]];
    visited[startR][startC] = true;
    const stones = [];
    const libSet = new Set();
    while (queue.length) {
        const [r, c] = queue.shift();
        stones.push([r, c]);
        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
            if (board[nr][nc] === 0) {
                libSet.add(nr + ',' + nc);
            } else if (board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push([nr, nc]);
            }
        }
    }
    const libertyCount = libSet.size;
    let sumLevel = 0;
    for (const [r, c] of stones) sumLevel += levelBoard[r][c];
    return { stones, libertyCount, sumLevel, color };
}

function removeGroupWithLevels(board, levelBoard, row, col, color, boardSize) {
    const queue = [[row, col]];
    board[row][col] = 0;
    levelBoard[row][col] = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
        const [r, c] = queue.shift();
        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                board[nr][nc] = 0;
                levelBoard[nr][nc] = 0;
                queue.push([nr, nc]);
            }
        }
    }
}

function removeFailingGroupsOfColor(board, levelBoard, boardSize, targetColor) {
    let changed = true;
    while (changed) {
        changed = false;
        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (board[r][c] !== targetColor || visited[r][c]) continue;
                const g = collectGroup(board, levelBoard, boardSize, r, c);
                if (!g) continue;
                for (const [rr, cc] of g.stones) visited[rr][cc] = true;
                const { libertyCount, stones, sumLevel } = g;
                if (libertyCount * stones.length < sumLevel) {
                    removeGroupWithLevels(board, levelBoard, r, c, targetColor, boardSize);
                    changed = true;
                }
            }
        }
    }
}

/**
 * 落子并依异气规则提子：先对方、再己方。
 */
function tryPlaceStoneVariousLiberty(board, levelBoard, boardSize, row, col, playerVal, level) {
    if (board[row][col] !== 0) return null;
    const newBoard = copyBoard(board);
    const newLevel = copyBoard(levelBoard);
    newBoard[row][col] = playerVal;
    newLevel[row][col] = level;

    const enemyColor = 3 - playerVal;
    removeFailingGroupsOfColor(newBoard, newLevel, boardSize, enemyColor);
    removeFailingGroupsOfColor(newBoard, newLevel, boardSize, playerVal);
    // 允许自杀（落子后己方子被提光）；禁全同另判
    return { board: newBoard, levelBoard: newLevel };
}

function replenishAfterPly(bag, moveNumber) {
    if (bag.length >= BACKPACK_CAP) return;
    const r = moveNumber % 8;
    let level;
    if (r === 0 || r === 1) level = 1;
    else if (r === 2 || r === 3) level = 2;
    else if (r === 4 || r === 5) level = 3;
    else level = 4;
    bag.push(level);
    bag.sort((a, b) => a - b);
}

/** 从已排序背包中移除该等级的第一枚（同等级棋子等价） */
function removeFirstOfLevel(bag, level) {
    const i = bag.indexOf(level);
    if (i === -1) return false;
    bag.splice(i, 1);
    return true;
}

function encodeMoveToRecordString(m) {
    const prefix = m.player === 'black' ? 'B' : 'W';
    if (m.type === 'pass') return `${prefix}p`;
    return `${prefix}${m.row},${m.col},${m.level}`;
}

class VariousLibertyWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet = new Set();
        /** 与 historyStacks 对齐：仅落子步对应禁全同哈希，虚着为 null */
        this.koStack = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.recordResultText = null;
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.black;
        const tw = this.slotJoinedAt.white;
        if (tb == null || tw == null) return 'black';
        return tb <= tw ? 'black' : 'white';
    }

    _maybeBeginTimeNegotiation() {
        if (this.moveHistory.length > 0 || this.gameOver) return;
        const room = this.room;
        if (!room.getPlayerBySlot('black') || !room.getPlayerBySlot('white')) return;
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
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方设置限时规则...' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _finalizeTimeControl(valid) {
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
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', now);
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
        });
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'timeControlNegotiation',
                mode: 'respond',
                proposal: {
                    ok: true,
                    timed: proposal.timed,
                    mainMinutes: proposal.mainMinutes,
                    byoyomiSeconds: proposal.byoyomiSeconds,
                    maxTimeouts: proposal.maxTimeouts
                }
            }));
        }
    }

    _handleTimeControlSubmit(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego) return;
        const v = qiMatchTimeControl.validateProposal(msg);
        if (!v.ok) {
            ws.send(JSON.stringify({ type: 'error', message: v.error }));
            return;
        }
        const room = this.room;
        if (this.tcNego.phase === 'propose') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            this.tcNego.phase = 'respond';
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            this.tcNego.phase = 'respond';
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '等待对方确认...' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this._finalizeTimeControl(prop);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'black' : 'white';
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
        const activeSlot = this.currentPlayer === 1 ? 'black' : 'white';
        qiMatchTimeControl.setActiveSlot(this.tcClock, activeSlot, Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和胜';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'black') this.recordResultText = '黑超时白胜';
        else if (lostSlot === 'white') this.recordResultText = '白超时黑胜';
    }

    static parseResultTextToWinner(resultText) {
        if (!resultText || typeof resultText !== 'string') return null;
        if (resultText === '和胜' || resultText === 'draw' || resultText === '平局') return 'draw';
        if (resultText.includes('白胜')) return 'white';
        if (resultText.includes('黑胜')) return 'black';
        if (resultText === 'black' || resultText === 'white' || resultText === 'draw') return resultText;
        return null;
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color, level: m.level }));
    }

    boardToString(board, levelBoard) {
        const rows = [];
        for (let r = 0; r < this.boardSize; r++) {
            const cells = [];
            for (let c = 0; c < this.boardSize; c++) {
                cells.push(`${board[r][c]}:${levelBoard[r][c]}`);
            }
            rows.push(cells.join(','));
        }
        return rows.join(';');
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b), 2);
    }

    assignTerritoryWithRange(liveBoard) {
        return squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
    }

    computeScore(liveBoard, territory) {
        return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
    }

    computeLead() {
        const liveBoard = this.removeDeadAndDying(this.board);
        const territory = this.assignTerritoryWithRange(liveBoard);
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        const KOMI = 3.25;
        return blackTotal - whiteTotal - 2 * KOMI;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            board: this.board,
            levelBoard: this.levelBoard,
            blackBag: [...this.blackBag],
            whiteBag: [...this.whiteBag],
            komi: 3.25,
            numberOfHands: 1 + this.historyStacks.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            slots: {
                black: !!this.room.getPlayerBySlot('black'),
                white: !!this.room.getPlayerBySlot('white')
            },
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

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    pushSnapshot() {
        this.historyStacks.push({
            board: copyBoard(this.board),
            levelBoard: copyBoard(this.levelBoard),
            blackBag: [...this.blackBag],
            whiteBag: [...this.whiteBag]
        });
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyStacks.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyStacks.length > 0) {
                this.historyStacks.pop();
                const ko = this.koStack.pop();
                if (ko) this.historyBoardSet.delete(ko);
            }
            if (this.historyMarkers.length > 0) this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historyStacks.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.levelBoard = copyLevelBoard(this.boardSize);
            this.blackBag = initialBag();
            this.whiteBag = initialBag();
        } else {
            const s = this.historyStacks[this.historyStacks.length - 1];
            this.board = copyBoard(s.board);
            this.levelBoard = copyBoard(s.levelBoard);
            this.blackBag = [...s.blackBag];
            this.whiteBag = [...s.whiteBag];
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    resetGame() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.currentPlayer = 1;
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.levelBoard = copyLevelBoard(this.boardSize);
        this.blackBag = initialBag();
        this.whiteBag = initialBag();
        this.currentPlayer = 1;
        this.historyStacks = [];
        this.historyBoardSet.clear();
        this.koStack = [];
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
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
    }

    exportRecord() {

        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和胜';
            else if (this.winner === 'black') resultText = '黑胜';
            else if (this.winner === 'white') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '异气围棋',
            gameId: 'various-liberty-weiqi',
            boardSize: this.boardSize,
            komi: 3.25,
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(this.board, this.boardSize),
            moves: this.moveCoords.map(m => encodeMoveToRecordString(m)),
            timeControl: (this.tcSettings && this.tcSettings.timed) ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}` : null,
            result: resultText
        };
    }

    /**
     * 每步为字符串：Bp / Wp 表示虚着；B3,5,3 表示黑在 (3,5) 用 3 级子。
     */
    static parseMoveString(entry) {
        if (typeof entry !== 'string' || entry.length < 2) return null;
        const player = entry[0] === 'B' ? 'black' : 'white';
        if (entry[1] === 'p') return { type: 'pass', player };
        const rest = entry.slice(1);
        const parts = rest.split(',');
        if (parts.length < 3) return null;
        const row = parseInt(parts[0], 10);
        const col = parseInt(parts[1], 10);
        const level = parseInt(parts[2], 10);
        if (!Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(level)) return null;
        return { type: 'move', player, row, col, level };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'various-liberty-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要异气围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 21) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = [];
        for (let j = 0; j < rawMoves.length; j++) {
            const parsed = VariousLibertyWeiqiRoom.parseMoveString(rawMoves[j]);
            if (!parsed) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱解析失败：第${j + 1}手格式无效` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            moves.push(parsed);
        }

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            const bag = slot === 'black' ? this.blackBag : this.whiteBag;

            if (move.type === 'move') {
                const { row, col, level } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                if (level < 1 || level > 4 || !removeFirstOfLevel(bag, level)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手背包中无该等级棋子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                const placed = tryPlaceStoneVariousLiberty(
                    this.board, this.levelBoard, this.boardSize, row, col, playerVal, level
                );
                if (!placed) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.board = placed.board;
                this.levelBoard = placed.levelBoard;

                const newBoardStr = this.boardToString(this.board, this.levelBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手禁全同` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }

                this.historyBoardSet.add(newBoardStr);
                this.koStack.push(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    level
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal, level }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.pushSnapshot();
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.koStack.push(null);
                this.pushSnapshot();
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
            this.winner = VariousLibertyWeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => encodeMoveToRecordString(m))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

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

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg);
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                if (!slot && !this.room.players.size) this.setBoardSize(msg.size, ws);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
                const { row, col, level } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                if (!Number.isInteger(level) || level < 1 || level > 4) return;

                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const bag = playerVal === 1 ? this.blackBag : this.whiteBag;
                if (bag.length === 0) return;
                if (!removeFirstOfLevel(bag, level)) return;

                const placed = tryPlaceStoneVariousLiberty(
                    this.board, this.levelBoard, this.boardSize, row, col, playerVal, level
                );
                if (!placed) {
                    bag.push(level);
                    bag.sort((a, b) => a - b);
                    return;
                }

                const newBoardStr = this.boardToString(placed.board, placed.levelBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    bag.push(level);
                    bag.sort((a, b) => a - b);
                    return;
                }

                if (!this._drainClockBeforeMove(moveSlot)) return;

                this.board = placed.board;
                this.levelBoard = placed.levelBoard;

                this.historyBoardSet.add(newBoardStr);
                this.koStack.push(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({
                    type: 'move',
                    player: slot,
                    row,
                    col,
                    level
                });
                this.lastMoveMarkers = [{ row, col, color: playerVal, level }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;

                const n = this.moveCoords.length;
                replenishAfterPly(bag, n);

                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(passSlot)) return;
                if (this.gameOver) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;

                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                this.passCounter++;
                this.lastMoveMarkers = [];

                const nPass = this.moveCoords.length;
                const bagPass = slot === 'black' ? this.blackBag : this.whiteBag;
                replenishAfterPly(bagPass, nPass);

                this.koStack.push(null);
                this.pushSnapshot();
                this.broadcast({ type: 'broadcast', action: 'pass', ...this.getState() });
                this._syncClockAfterTurnChange();
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
            }

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyStacks.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'black' ? 'white' : 'black';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
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
                if (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new VariousLibertyWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
