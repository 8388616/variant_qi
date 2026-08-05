'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, encodeInitialPositionCompact, applyInitialPositionCompact, qiBoardSeatOverlay } = require('../common');

class SyncWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 19) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.numberOfHands = 1;
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingBlack = null;
        this.pendingWhite = null;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyBoards.push(this.copyBoard(this.board));
        /** @type {{ black: number|null, white: number|null }} */
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        this.recordResultText = null;
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
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drainSyncClock(this.tcClock, now);
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
        if (this.moveCoords.length > 0 || this.gameOver) return;
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
        this.tcClock = valid.timed ? qiMatchTimeControl.createSyncClock(this.tcSettings, now) : null;
        if (this.tcClock && this.tcClock.timed) {
            qiMatchTimeControl.openSyncMoveWindow(this.tcClock, now);
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

    _syncTimeGateAllowsPlay(slot, ws) {
        if (this.gameOver) return false;
        if (!this.matchStarted) {
            if (ws) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
            return false;
        }
        if (this.tcNego || this.tcSettings === null) {
            if (ws) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
            return false;
        }
        return true;
    }

    _commitSyncSideIfTimed(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return { ok: true };
        const r = qiMatchTimeControl.commitSyncSide(this.tcClock, slot, Date.now());
        if (r.lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = r.winnerSlot;
            this.setTimeLossResultText(r.lostSlot);
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: r.lostSlot,
                winner: r.winnerSlot,
                ...this.getState()
            });
            return { ok: false };
        }
        this._broadcastClock();
        return { ok: true };
    }

    _openNextSyncWindowIfTimed() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.openSyncMoveWindow(this.tcClock, Date.now());
        this._broadcastClock();
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'black' ? '白中盘胜' : '黑中盘胜';
        this._stopClockTicker();
    }

    onDrawResolved() {
        this.recordResultText = '和胜';
        this._stopClockTicker();
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

    getKomi() {
        return this.boardSize <= 8 ? 4.25 : 3.25;
    }

    holesArrayFromBoard() {
        const out = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === -1) out.push({ r, c });
            }
        }
        return out;
    }

    _inBoard(r, c) {
        return r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize;
    }

    _collectGroup(board, row, col) {
        const color = board[row][col];
        if (color !== 1 && color !== 2) return null;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const seen = new Set([`${row},${col}`]);
        const queue = [[row, col]];
        const stones = [[row, col]];
        let idx = 0;
        let hasLib = false;
        while (idx < queue.length) {
            const [rr, cc] = queue[idx++];
            for (const [dr, dc] of dirs) {
                const nr = rr + dr;
                const nc = cc + dc;
                if (!this._inBoard(nr, nc)) continue;
                const v = board[nr][nc];
                if (v === 0) {
                    hasLib = true;
                    continue;
                }
                if (v !== color) continue;
                const k = `${nr},${nc}`;
                if (seen.has(k)) continue;
                seen.add(k);
                queue.push([nr, nc]);
                stones.push([nr, nc]);
            }
        }
        return { stones, hasLib };
    }

    /**
     * 仅检查受影响范围（双方落点及其邻点）的连通块；
     * 先完成所有无气判定，再统一提子，避免边判断边提子造成干扰。
     */
    removeZeroLibertyGroups(board, anchorPoints) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const seedSet = new Set();
        for (const p of anchorPoints || []) {
            if (!p || !this._inBoard(p.row, p.col)) continue;
            seedSet.add(`${p.row},${p.col}`);
            for (const [dr, dc] of dirs) {
                const nr = p.row + dr;
                const nc = p.col + dc;
                if (this._inBoard(nr, nc)) seedSet.add(`${nr},${nc}`);
            }
        }

        const groupSeen = new Set();
        const toRemove = [];
        for (const seed of seedSet) {
            const [r, c] = seed.split(',').map(Number);
            const v = board[r][c];
            if (v !== 1 && v !== 2) continue;
            const g = this._collectGroup(board, r, c);
            if (!g) continue;
            const gKey = g.stones
                .map(([rr, cc]) => `${rr},${cc}`)
                .sort()
                .join(';');
            if (groupSeen.has(gKey)) continue;
            groupSeen.add(gKey);
            if (!g.hasLib) toRemove.push(g.stones);
        }

        for (const stones of toRemove) {
            for (const [r, c] of stones) board[r][c] = 0;
        }
    }

    applySimultaneous(blackMove, whiteMove, srcBoard) {
        const anchors = [];
        const nb = this.copyBoard(srcBoard);
        if (blackMove && whiteMove && blackMove.row === whiteMove.row && blackMove.col === whiteMove.col) {
            nb[blackMove.row][blackMove.col] = -1;
            anchors.push({ row: blackMove.row, col: blackMove.col });
        } else {
            if (blackMove) {
                nb[blackMove.row][blackMove.col] = 1;
                anchors.push({ row: blackMove.row, col: blackMove.col });
            }
            if (whiteMove) {
                nb[whiteMove.row][whiteMove.col] = 2;
                anchors.push({ row: whiteMove.row, col: whiteMove.col });
            }
        }
        this.removeZeroLibertyGroups(nb, anchors);
        return nb;
    }

    applyFailedTurnHoles(curBoard, blackMove, whiteMove) {
        const out = this.copyBoard(curBoard);
        const anchors = [];
        if (blackMove) {
            if (out[blackMove.row][blackMove.col] === 0) out[blackMove.row][blackMove.col] = -1;
            anchors.push({ row: blackMove.row, col: blackMove.col });
        }
        if (whiteMove) {
            if (out[whiteMove.row][whiteMove.col] === 0) out[whiteMove.row][whiteMove.col] = -1;
            anchors.push({ row: whiteMove.row, col: whiteMove.col });
        }
        this.removeZeroLibertyGroups(out, anchors);
        return out;
    }

    isStateDuplicate(board) {
        return this.historyBoardSet.has(this.boardToString(board));
    }

    pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, applied) {
        this.moveCoords.push({
            black: blackMove ? { row: blackMove.row, col: blackMove.col } : null,
            white: whiteMove ? { row: whiteMove.row, col: whiteMove.col } : null,
            blackPass: !!blackPass,
            whitePass: !!whitePass,
            applied: !!applied
        });
    }

    resolveTurn() {
        const blackMove = this.pendingBlack?.move || null;
        const whiteMove = this.pendingWhite?.move || null;
        const blackPass = this.pendingBlack?.pass || false;
        const whitePass = this.pendingWhite?.pass || false;

        if (blackPass && whitePass) {
            this.pushMoveCoord(null, null, true, true, true);
            this.broadcastTurnResolved();
            this.clearPending();
            const blackPlayer = this.room.getPlayerBySlot('black');
            const whitePlayer = this.room.getPlayerBySlot('white');
            if (blackPlayer && whitePlayer) {
                this.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                const p = blackPlayer || whitePlayer;
                if (p) this.startScoreCounting(p, p);
            }
            return;
        }

        const cur = this.copyBoard(this.board);
        const newBoard = this.applySimultaneous(blackMove, whiteMove, cur);
        const dup = this.isStateDuplicate(newBoard);

        let finalBoard;
        let lastMarkers = [];
        let success = false;

        if (dup) {
            finalBoard = this.applyFailedTurnHoles(cur, blackMove, whiteMove);
            success = false;
        } else {
            finalBoard = newBoard;
            if (blackMove && !blackPass) lastMarkers.push({ row: blackMove.row, col: blackMove.col, color: 1 });
            if (whiteMove && !whitePass) lastMarkers.push({ row: whiteMove.row, col: whiteMove.col, color: 2 });
            success = true;
        }

        this.board = finalBoard;
        this.lastMoveMarkers = lastMarkers;
        this.pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, success);

        if (success) {
            this.numberOfHands++;
            const s = this.boardToString(this.board);
            this.historyBoardSet.add(s);
            this.historyBoards.push(this.copyBoard(this.board));
            this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        }

        this.clearPending();
        this.broadcastTurnResolved();
        this._openNextSyncWindowIfTimed();
    }

    clearPending() {
        this.pendingBlack = null;
        this.pendingWhite = null;
    }

    broadcastTurnResolved() {
        this.broadcast({ type: 'broadcast', action: 'turnResolved', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    computeLead() {
        const liveBoard = squareWeiqiRules.removeDeadAndDying(this.board, this.boardSize, (b) => this.copyBoard(b));
        const territory = squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
        const { blackTotal, whiteTotal } = squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
        const k = this.getKomi();
        return blackTotal - whiteTotal - 2 * k;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            komi: this.getKomi(),
            board: this.board,
            holes: this.holesArrayFromBoard(),
            numberOfHands: this.numberOfHands,
            currentPlayer: 1,
            lastMoveMarkers: this.lastMoveMarkers,
            moveCoords: this.moveCoords,
            gameOver: this.gameOver,
            winner: this.winner,
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

    getStateForClient(ws) {
        const base = this.getState();
        const slot = this.room.getSlotByWs(ws);
        let mySyncPending = null;
        if (slot === 'black' && this.pendingBlack) {
            if (this.pendingBlack.pass) mySyncPending = { pass: true };
            else if (this.pendingBlack.move) mySyncPending = { row: this.pendingBlack.move.row, col: this.pendingBlack.move.col };
        } else if (slot === 'white' && this.pendingWhite) {
            if (this.pendingWhite.pass) mySyncPending = { pass: true };
            else if (this.pendingWhite.move) mySyncPending = { row: this.pendingWhite.move.row, col: this.pendingWhite.move.col };
        }
        return { ...base, mySyncPending };
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'gameState', ...this.getStateForClient(ws) }));
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const liveBoard = squareWeiqiRules.removeDeadAndDying(this.board, this.boardSize, (b) => this.copyBoard(b));
        const territory = squareWeiqiRules.assignTerritoryWithRange(liveBoard, this.boardSize);
        const { blackTotal, whiteTotal } = squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
        const lead = blackTotal - whiteTotal - 2 * this.getKomi();
        this.scoreProposalData = { lead, blackTotal, whiteTotal, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead, blackTotal, whiteTotal };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.numberOfHands = 1;
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.clearPending();
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyBoards.push(this.copyBoard(this.board));
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小无效' }));
            return false;
        }
        const hasStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasHole = this.board.some(row => row.some(v => v === -1));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasStone || hasHole || hasPlayer) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有棋子、洞或玩家，不能改变棋盘大小' }));
            return false;
        }
        this.boardSize = newSize;
        this.resetToEmpty();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        this.broadcast({ type: 'gameState', ...this.getState() });
        return true;
    }

    exportRecord() {
        const compressTurn = (t) => {
            let s = '';
            if (t.blackPass) s += 'Bp';
            else if (t.black) s += `B${t.black.row},${t.black.col}`;
            else s += 'B-';
            if (t.whitePass) s += 'Wp';
            else if (t.white) s += `W${t.white.row},${t.white.col}`;
            else s += 'W-';
            s += t.applied ? '1' : '0';
            return s;
        };
        return {
            format: 'muzei',
            version: 1,
            gameType: '同步围棋',
            gameId: 'sync-weiqi',
            boardSize: this.boardSize,
            komi: this.getKomi(),
            players: { black: null, white: null },
            initialPosition: encodeInitialPositionCompact(
                this.board.map(row => row.map(v => (v === -1 ? -1 : 0))),
                this.boardSize
            ),
            moves: this.moveCoords.map(compressTurn),
            result: this.gameOver ? this.winner : null
        };
    }

    static parseTurnEntry(str) {
        if (typeof str === 'object' && str !== null) {
            const t = { ...str };
            if (typeof t.applied !== 'boolean') t.applied = true;
            return t;
        }
        let applied = true;
        let body = str;
        if (str.endsWith('1') || str.endsWith('0')) {
            applied = str.endsWith('1');
            body = str.slice(0, -1);
        }
        let i = 0;
        const readSide = (prefix) => {
            if (body[i] !== prefix) return { err: true };
            i++;
            if (body[i] === 'p') {
                i++;
                return { pass: true };
            }
            if (body[i] === '-') {
                i++;
                return { empty: true };
            }
            const m = body.substring(i).match(/^(\d+),(\d+)/);
            if (!m) return { err: true };
            i += m[0].length;
            return { row: +m[1], col: +m[2] };
        };
        const b = readSide('B');
        const w = readSide('W');
        if (b.err || w.err || i !== body.length) return { err: true };
        const blackPass = !!b.pass;
        const whitePass = !!w.pass;
        return {
            black: blackPass ? null : (b.empty ? null : { row: b.row, col: b.col }),
            white: whitePass ? null : (w.empty ? null : { row: w.row, col: w.col }),
            blackPass,
            whitePass,
            applied
        };
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'sync-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要同步围棋棋谱）' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize < 7 || newSize > 27) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();
        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);
        this.historyBoards[0] = this.copyBoard(this.board);
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        const raw = data.moves || [];
        const turns = raw.map(SyncWeiqiRoom.parseTurnEntry);

        for (let ti = 0; ti < turns.length; ti++) {
            const t = turns[ti];
            if (t.err) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手格式无效` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
            this.pendingBlack = t.blackPass ? { pass: true } : (t.black ? { move: { row: t.black.row, col: t.black.col } } : null);
            this.pendingWhite = t.whitePass ? { pass: true } : (t.white ? { move: { row: t.white.row, col: t.white.col } } : null);

            if (!this.pendingBlack || !this.pendingWhite) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手数据不完整` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }

            const blackMove = this.pendingBlack?.move || null;
            const whiteMove = this.pendingWhite?.move || null;
            const blackPass = this.pendingBlack?.pass || false;
            const whitePass = this.pendingWhite?.pass || false;

            if (blackPass && whitePass) {
                this.pushMoveCoord(null, null, true, true, true);
                this.clearPending();
                break;
            }

            const cur = this.copyBoard(this.board);
            const newBoard = this.applySimultaneous(blackMove, whiteMove, cur);
            const dup = this.isStateDuplicate(newBoard);

            let finalBoard;
            let lastMarkers = [];
            let success = false;

            if (dup) {
                finalBoard = this.applyFailedTurnHoles(cur, blackMove, whiteMove);
                success = false;
            } else {
                finalBoard = newBoard;
                if (blackMove && !blackPass) lastMarkers.push({ row: blackMove.row, col: blackMove.col, color: 1 });
                if (whiteMove && !whitePass) lastMarkers.push({ row: whiteMove.row, col: whiteMove.col, color: 2 });
                success = true;
            }

            this.board = finalBoard;
            this.lastMoveMarkers = lastMarkers;
            this.pushMoveCoord(blackMove, whiteMove, blackPass, whitePass, success);

            if (success) {
                this.numberOfHands++;
                const s = this.boardToString(this.board);
                this.historyBoardSet.add(s);
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
            }

            this.clearPending();

            if (typeof t.applied === 'boolean' && t.applied !== success) {
                this.resetToEmpty();
                requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱第${ti + 1}手结果与记录不一致` }));
                this.broadcast({ type: 'roomReset', ...this.getState() });
                return;
            }
        }

        if (data.result) {
            this.gameOver = true;
            this.winner = data.result;
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

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    undoOneStep() {
        while (this.moveCoords.length > 0 && !this.moveCoords[this.moveCoords.length - 1].applied) {
            this.moveCoords.pop();
        }
        if (this.historyBoards.length <= 1) return;
        const popped = this.historyBoards.pop();
        this.historyBoardSet.delete(this.boardToString(popped));
        if (this.moveCoords.length > 0) this.moveCoords.pop();
        if (this.historyMarkers.length > 0) this.historyMarkers.pop();

        this.board = this.copyBoard(this.historyBoards[this.historyBoards.length - 1]);
        this.numberOfHands = this.historyBoards.length;
        this.lastMoveMarkers = this.historyMarkers.length
            ? this.copyMarkers(this.historyMarkers[this.historyMarkers.length - 1])
            : [];
        this.gameOver = false;
        this.winner = null;
        this.clearPending();
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._openNextSyncWindowIfTimed();
    }

    resetGame() {
        this._stopClockTicker();
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.resetToEmpty();
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
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
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'move':
                if (this.gameOver || !slot) return;
                if (!this._syncTimeGateAllowsPlay(slot, ws)) return;
                if (slot === 'black' && this.pendingBlack) return;
                if (slot === 'white' && this.pendingWhite) return;
                { const { row, col } = msg;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
                if (this.board[row][col] !== 0) return;
                if (!this._commitSyncSideIfTimed(slot).ok) return;
                const moveData = { move: { row, col } };
                if (slot === 'black') this.pendingBlack = moveData;
                else this.pendingWhite = moveData;
                const opponent = slot === 'black' ? room.getPlayerBySlot('white') : room.getPlayerBySlot('black');
                if (opponent) {
                    opponent.send(JSON.stringify({ type: 'pendingUpdate', player: slot, move: true, pass: false }));
                }
                if (this.pendingBlack && this.pendingWhite) this.resolveTurn();
                }
                break;

            case 'pass':
                if (this.gameOver || !slot) return;
                if (!this._syncTimeGateAllowsPlay(slot, ws)) return;
                if (slot === 'black' && this.pendingBlack) return;
                if (slot === 'white' && this.pendingWhite) return;
                if (!this._commitSyncSideIfTimed(slot).ok) return;
                if (slot === 'black') this.pendingBlack = { pass: true };
                else this.pendingWhite = { pass: true };
                { const passOpponent = slot === 'black' ? room.getPlayerBySlot('white') : room.getPlayerBySlot('black');
                if (passOpponent) {
                    passOpponent.send(JSON.stringify({ type: 'pendingUpdate', player: slot, move: false, pass: true }));
                }
                if (this.pendingBlack && this.pendingWhite) this.resolveTurn();
                }
                break;

            case 'requestUndo':
                if (!slot || this.gameOver) return;
                { const undoOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!undoOpponent) {
                    if (this.historyBoards.length > 1) this.undoOneStep();
                } else {
                    this.pendingUndo = { requester: ws, opponent: undoOpponent };
                    undoOpponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                }
                break;

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.undoOneStep();
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
                { const endOpponent = room.getPlayerBySlot(slot === 'black' ? 'white' : 'black');
                if (!endOpponent) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept) this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept) this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (!this.pendingScore || (ws !== this.pendingScore.requester && ws !== this.pendingScore.opponent)) break;
                if (!msg.accept) {
                    if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                    this.broadcast({ type: 'scoreRejected' });
                    this.pendingScore = null;
                    this.scoreProposalData = null;
                    break;
                }
                this.pendingScore.agreed.add(ws);
                if (this.pendingScore.agreed.size === 2) {
                    const { lead } = this.scoreProposalData;
                    this.gameOver = true;
                    this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                    this.setScoreResultTextByLead(lead);
                    this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                    this.pendingScore = null;
                    this.scoreProposalData = null;
                    this._stopClockTicker();
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
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new SyncWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
