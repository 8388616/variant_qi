// Keep these rules in sync with mirror-weiqi-room.js.
const mirrorRules = (() => {
    'use strict';
    const MIRROR = -4;
    const DIRECTIONS = ['UL', 'DL', 'UR', 'DR'];
    const vectors = { U: [1, 0], D: [-1, 0], L: [0, -1], R: [0, 1] };
    const opposite = { U: 'D', D: 'U', L: 'R', R: 'L' };
    const isStone = (v) => v === 1 || v === 2;
    const canPlace = (v) => v === 0 || v === MIRROR;
    const copy = (board) => board.map(row => row.slice());

    function reflect(direction, travel) {
        if (!DIRECTIONS.includes(direction)) return null;
        const incoming = opposite[travel];
        if (!direction.includes(incoming)) return null;
        return direction[0] === incoming ? direction[1] : direction[0];
    }

    // Each ray searches for its first usable mirror, then travels that same
    // distance again. Later reflections turn the ray without resetting its budget.
    function destinations(board, directions, row, col) {
        const size = board.length;
        const inside = (r, c) => r >= 0 && r < size && c >= 0 && c < size;
        const points = new Map([[`${row},${col}`, { row, col }]]);
        for (const initial of Object.keys(vectors)) {
            let r = row, c = col, travel = initial, distance = 0, remaining = null;
            while (true) {
                const [dr, dc] = vectors[travel];
                r += dr;
                c += dc;
                if (!inside(r, c) || isStone(board[r][c])) break;
                if (remaining !== null) {
                    remaining--;
                    // A mirror at the endpoint is covered, rather than turning
                    // a ray that has no distance left to travel.
                    if (remaining === 0) {
                        if (canPlace(board[r][c])) points.set(`${r},${c}`, { row: r, col: c });
                        break;
                    }
                } else distance++;
                if (board[r][c] !== MIRROR) continue;
                const next = reflect(directions[r] && directions[r][c], travel);
                if (!next) continue;
                if (remaining === null) remaining = distance;
                travel = next;
            }
        }
        return [...points.values()];
    }

    function removeDead(board, color) {
        const size = board.length, visited = new Set(), dead = [];
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
            if (board[r][c] !== color || visited.has(`${r},${c}`)) continue;
            const group = [[r, c]];
            visited.add(`${r},${c}`);
            let liberty = false;
            for (let i = 0; i < group.length; i++) {
                const [gr, gc] = group[i];
                for (const [dr, dc] of Object.values(vectors)) {
                    const nr = gr + dr, nc = gc + dc;
                    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                    const v = board[nr][nc], key = `${nr},${nc}`;
                    if (canPlace(v)) liberty = true;
                    else if (v === color && !visited.has(key)) {
                        visited.add(key);
                        group.push([nr, nc]);
                    }
                }
            }
            if (!liberty) dead.push(...group);
        }
        for (const [r, c] of dead) board[r][c] = 0;
    }

    function tryPlaceStone(board, directions, row, col, color) {
        if (!Number.isInteger(row) || !Number.isInteger(col) || !board[row]
            || !canPlace(board[row][col]) || !isStone(color)) return null;
        const points = destinations(board, directions, row, col);
        const next = copy(board);
        for (const p of points) next[p.row][p.col] = color;
        removeDead(next, 3 - color);
        removeDead(next, color);
        Object.defineProperty(next, 'moveMarkers', {
            value: points.map(p => ({ ...p, color }))
        });
        return next;
    }

    function parseInitial(initialPosition, size) {
        const directions = Array.from({ length: size }, () => Array(size).fill(null));
        for (const entry of initialPosition || []) {
            if (typeof entry !== 'string' || entry[0] !== 'J') continue;
            const match = /^J(\d+),(\d+),(UL|DL|UR|DR)$/.exec(entry);
            if (!match || +match[1] >= size || +match[2] >= size)
                throw new Error('镜子初始位置须为 J行,列,方向（UL/DL/UR/DR）');
            directions[+match[1]][+match[2]] = match[3];
        }
        return directions;
    }

    function encodeInitial(board, directions) {
        const out = [];
        for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
            const v = board[r][c];
            if (v === 1 || v === 2) out.push(`${v === 1 ? 'B' : 'W'}${r},${c}`);
            else if (v === MIRROR) out.push(`J${r},${c},${directions[r][c]}`);
        }
        return out;
    }

    return { MIRROR, DIRECTIONS, canPlace, reflect, destinations, tryPlaceStone, parseInitial, encodeInitial };
})();
const { qiApplyRecordKomi, qiEffectiveKomi, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, computeBensonWeiqiLead, squareWeiqiScoringOps, applyInitialPositionCompact, qiBoardSeatOverlay } = require('../common');

/** 镜子围棋贴目（按路数）：7 路 4.75，其余（含默认 19 路）4.25 */
function komiForSizeMirror(boardSize) {
    if (boardSize === 7) return 4.75;
    return 4.25;
}

class MirrorWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19) {
        super(room);
        // -40..-43 are edit-tool commands only; stored board cells are always -4.
        this.editBoardAllowedValues = [0, 1, 2, -4, -40, -41, -42, -43];
        this.afterEditBoard = function () {
            const old = this.mirrorDirections || [];
            this.mirrorDirections = this.board.map((row, r) => row.map((v, c) => {
                if (v <= -40 && v >= -43) {
                    this.board[r][c] = -4;
                    return mirrorRules.DIRECTIONS[-40 - v];
                }
                return v === -4 ? ((old[r] && old[r][c]) || 'UL') : null;
            }));
        };
        this.boardSize = initialSize;
        this.MIRROR_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board } = this.generateMirrorsAndBoard();
        this.board = board;
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.moveCoords = [];
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
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
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return this._stopClockTicker();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        return slot === (this.currentPlayer === 1 ? 'player1' : 'player2');
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (!lostSlot) return true;
        this._stopClockTicker();
        this.gameOver = true;
        this.winner = winnerSlot;
        this.setTimeLossResultText(lostSlot);
        this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
        return false;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (lead > 0) this.recordResultText = `黑胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else if (lead < 0) this.recordResultText = `白胜${Math.abs(lead).toFixed(2).replace(/\.00$/, '')}点`;
        else this.recordResultText = '和棋';
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    getDistanceWeight(row, col) {
        const center = Math.floor(this.boardSize / 2);
        const d = Math.max(Math.abs(row - center), Math.abs(col - center));
        return 1 + d * 0.5;
    }

    generateMirrorsAndBoard() {
        const points = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                points.push({ r, c, weight: this.getDistanceWeight(r, c) });
            }
        }
        const board = Array.from({ length: this.boardSize }, () => Array(this.boardSize).fill(0));
        this.mirrorDirections = board.map(row => row.map(() => null));
        for (let i = 0; i < this.MIRROR_COUNT; i++) {
            let rand = Math.random() * points.reduce((sum, p) => sum + p.weight, 0);
            let index = points.length - 1;
            for (let j = 0; j < points.length; j++) {
                rand -= points[j].weight;
                if (rand <= 0) { index = j; break; }
            }
            const { r, c } = points.splice(index, 1)[0];
            board[r][c] = -4;
            this.mirrorDirections[r][c] = mirrorRules.DIRECTIONS[Math.floor(Math.random() * 4)];
        }
        return { board };
    }

    canPlaceAt(row, col) {
        return Number.isInteger(row) && Number.isInteger(col) && !!this.board[row]
            && mirrorRules.canPlace(this.board[row][col]);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return mirrorRules.tryPlaceStone(boardBefore, this.mirrorDirections, row, col, playerVal);
    }

    placeMirrorMove(ws, msg, slot) {
        if (this.gameOver || !slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
        const { row, col } = msg;
        if (!this.canPlaceAt(row, col)) return;
        // Keep the mirror until every ray has been evaluated on the original board.
        // The shared ordinary-Go move entry may still have an empty-only guard cached.
        const newBoard = this.tryPlaceStone(this.board, row, col, this.currentPlayer);
        if (!newBoard) return;
        const key = this.boardToString(newBoard);
        if (this.historyBoardSet.has(key)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }
        if (!this._drainClockBeforeMove(slot)) return;
        this.historyBoards.push(this.copyBoard(newBoard));
        this.historyBoardSet.add(key);
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col });
        this.board = newBoard;
        this.lastMoveMarkers = newBoard.moveMarkers;
        this.passCounter = 0;
        this.currentPlayer = 3 - this.currentPlayer;
        this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
    }

    computeLead() {
        const board = this.board.map(row => row.map(v => v === -4 ? 0 : v));
        return computeBensonWeiqiLead(board, qiEffectiveKomi(this, komiForSizeMirror(this.boardSize)),
            squareWeiqiScoringOps(this.boardSize, { copyBoard: b => this.copyBoard(b) })).lead;
    }

    getState() {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: qiEffectiveKomi(this, komiForSizeMirror(this.boardSize)),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            mirrorDirections: this.mirrorDirections,
            moveCoords: this.moveCoords,
            boardSize: this.boardSize,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getInitialState() {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        return {
            board: this.board,
            initialBoard,
            komi: qiEffectiveKomi(this, komiForSizeMirror(this.boardSize)),
            currentPlayer: this.currentPlayer,
            numberOfHands: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            mirrorDirections: this.mirrorDirections,
            moveCoords: [],
            boardSize: this.boardSize,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            }
        };
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true, Date.now());
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) });
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'move':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                this.placeMirrorMove(ws, msg, slot);
                this._syncClockAfterTurnChange();
                break;

            case 'pass':
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                qiProtocol.weiqiPass(this, ws, slot, { beforeCommit: () => this._drainClockBeforeMove(slot) });
                this._syncClockAfterTurnChange();
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot, { onResignResolved: (logic, s) => logic.onResignResolved(s) });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局。' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg, { onDrawResolved: (logic) => logic.onDrawResolved() });
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
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
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
                            this._stopClockTicker();
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false, Date.now());
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

            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
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
            if (this.moveCoords.length > 0) this.moveCoords.pop();

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = this.copyBoard(this.openingBoard);
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));

        this.broadcast({ type: 'broadcast', action: 'undoAccept', undoSteps: steps, ...this.getState() });
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
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        const { board } = this.generateMirrorsAndBoard();
        this.board = board;
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.moveCoords = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.importedKomi = undefined;
        this.passCounter = 0;
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getInitialState(), slots: { player1: false, player2: false } });
    }

    exportRecord() {
        const initialBoard = this.openingBoard || this.board;

        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            game: '镜子围棋',
            gameId: 'mirror-weiqi',
            boardSize: this.boardSize,
            komi: qiEffectiveKomi(this, komiForSizeMirror(this.boardSize)),
            players: { player1: '', player2: '' },
            initialPosition: mirrorRules.encodeInitial(initialBoard, this.mirrorDirections),
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
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.mirrorDirections = this.board.map(row => row.map(() => null));
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.importedKomi = undefined;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
    }

    static parseMove(entry) {
        if (typeof entry === 'object') return entry;
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        if (entry[1] === 'p') return { type: 'pass', player };
        const coords = entry.substring(1).split(',').map(Number);
        return { type: 'move', player, row: coords[0], col: coords[1] };
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId && data.gameId !== 'mirror-weiqi' && data.game !== '镜子围棋')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要镜子围棋棋谱）。' }));
            return;
        }
        const size = Number.isInteger(data.boardSize) && data.boardSize >= 7 && data.boardSize <= 31
            ? data.boardSize : this.boardSize;
        try { mirrorRules.parseInitial(data.initialPosition, size); }
        catch (error) {
            requesterWs.send(JSON.stringify({ type: 'error', message: error.message }));
            return;
        }
        if (Number.isInteger(data.boardSize) && data.boardSize >= 7 && data.boardSize <= 31) {
            this.boardSize = data.boardSize;
            this.MIRROR_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        }
        this.resetToEmpty();

        this.mirrorDirections = mirrorRules.parseInitial(data.initialPosition, this.boardSize);
        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const moves = (data.moves || []).map(m => MirrorWeiqiRoom.parseMove(m));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const playerVal = move.player === 'player1' ? 1 : 2;
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
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'move', player: move.player, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = newBoard.moveMarkers || [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(move.player);
                this.moveCoords.push({ type: 'pass', player: move.player });
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

        if ((data.result || data.resultText) && !this.gameOver) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        qiApplyRecordKomi(this, data);   // 导入棋谱采纳记录贴目（新局/重置时清掉）
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

    setBoardSize(newSize, requesterWs)
    {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 31) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {
            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.MIRROR_COUNT = Math.floor(0.083 * this.boardSize * this.boardSize);
        const { board } = this.generateMirrorsAndBoard();
        this.board = board;
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.currentPlayer = 1;
        this.passCounter = 0;
        this.gameOver = false;
        this.winner = null;
        this.broadcast({ type: 'boardSizeChanged', ...this.getInitialState() });
        return true;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
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
    initRoom(room) {
        room.gameLogic = new MirrorWeiqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
