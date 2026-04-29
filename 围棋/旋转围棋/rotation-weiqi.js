'use strict';

const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact } = require('../common');

const MAX_ROTATIONS = 8;

function computeRotationInterval(n) {
    let x = Math.ceil(0.07 * n * n);
    if (x % 2 === 0) x += 1;
    return x;
}

function rotateCell(r, c, half) {
    if (r < half && c < half) return [r, c + half];
    if (r < half) return [r + half, c];
    if (c < half) return [r - half, c];
    return [r, c - half];
}

function initZero2D(n) {
    return Array(n).fill(0).map(() => Array(n).fill(0));
}

function rotateBoardLike(board, n, mapCell) {
    const nb = initZero2D(n);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const [nr, nc] = mapCell(r, c);
            nb[nr][nc] = board[r][c];
        }
    }
    return nb;
}

function rotateQuadrantsClockwise(board, handNumAt, n) {
    const half = n / 2;
    const mapCell = (r, c) => rotateCell(r, c, half);
    return {
        board: rotateBoardLike(board, n, mapCell),
        handNumAt: rotateBoardLike(handNumAt, n, mapCell)
    };
}

function rotateLastMoveMarkers(markers, n) {
    if (!markers || !markers.length) return [];
    const half = n / 2;
    return markers.map(m => {
        const [nr, nc] = rotateCell(m.row, m.col, half);
        return { row: nr, col: nc, color: m.color };
    });
}

function syncHandNumWithBoard(board, handNumAt) {
    const n = board.length;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === 0) handNumAt[r][c] = 0;
        }
    }
}

function willRotateThisPly(completedPlyCount, rotationInterval, rotationCount) {
    if (rotationCount >= MAX_ROTATIONS) return false;
    if (completedPlyCount <= 0 || completedPlyCount % rotationInterval !== 0) return false;
    return true;
}

function collectSeedsOnFirstLine(board, n, color) {
    const seeds = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (r !== 0 && r !== n - 1 && c !== 0 && c !== n - 1) continue;
            if (board[r][c] === color) seeds.push([r, c]);
        }
    }
    return seeds;
}

function findGroupRepresentative(board, row, col, color, boardSize) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let bestR = row;
    let bestC = col;
    const queue = [[row, col]];
    const visited = new Set([`${row},${col}`]);
    while (queue.length) {
        const [r, c] = queue.shift();
        if (r < bestR || (r === bestR && c < bestC)) {
            bestR = r;
            bestC = c;
        }
        for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
            const k = `${nr},${nc}`;
            if (visited.has(k)) continue;
            if (board[nr][nc] === color) {
                visited.add(k);
                queue.push([nr, nc]);
            }
        }
    }
    return [bestR, bestC];
}

function uniqueGroupRootsFromSeeds(board, seeds, color, boardSize) {
    const roots = [];
    const seenGroups = new Set();
    for (const [sr, sc] of seeds) {
        if (board[sr][sc] !== color) continue;
        const rep = findGroupRepresentative(board, sr, sc, color, boardSize);
        const key = `${rep[0]},${rep[1]}`;
        if (!seenGroups.has(key)) {
            seenGroups.add(key);
            roots.push(rep);
        }
    }
    return roots;
}

/**
 * 旋转手：旋转后的提子顺序为先对方（落子邻接 + 一路线）再己方（落子点 + 一路线）。
 * hasPlacement 为 false 时（虚着触发旋转）仅检查一路线。
 */
function applyRotationPlyCaptures(board, placeR, placeC, playerVal, boardSize, hasPlacement, rules) {
    const enemyColor = 3 - playerVal;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const enemySeeds = [];
    if (hasPlacement) {
        for (const [dr, dc] of dirs) {
            const nr = placeR + dr;
            const nc = placeC + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === enemyColor) {
                enemySeeds.push([nr, nc]);
            }
        }
    }
    enemySeeds.push(...collectSeedsOnFirstLine(board, boardSize, enemyColor));
    const enemyRoots = uniqueGroupRootsFromSeeds(board, enemySeeds, enemyColor, boardSize);
    for (const [gr, gc] of enemyRoots) {
        if (rules.countGroupLiberties(board, gr, gc, boardSize) < 1) {
            rules.removeGroup(board, gr, gc, enemyColor, boardSize);
        }
    }

    const ownSeeds = [];
    if (hasPlacement && board[placeR][placeC] === playerVal) {
        ownSeeds.push([placeR, placeC]);
    }
    ownSeeds.push(...collectSeedsOnFirstLine(board, boardSize, playerVal));
    const ownRoots = uniqueGroupRootsFromSeeds(board, ownSeeds, playerVal, boardSize);
    for (const [gr, gc] of ownRoots) {
        if (rules.countGroupLiberties(board, gr, gc, boardSize) < 1) {
            rules.removeGroup(board, gr, gc, playerVal, boardSize);
        }
    }
}

function maybeRotateAfterPly(opts) {
    const {
        board,
        handNumAt,
        rotationCount,
        n,
        rotationInterval,
        completedPlyCount,
        lastMoveMarkers
    } = opts;
    if (rotationCount >= MAX_ROTATIONS) {
        return { board, handNumAt, rotationCount, lastMoveMarkers };
    }
    if (completedPlyCount <= 0 || completedPlyCount % rotationInterval !== 0) {
        return { board, handNumAt, rotationCount, lastMoveMarkers };
    }
    const r = rotateQuadrantsClockwise(board, handNumAt, n);
    return {
        board: r.board,
        handNumAt: r.handNumAt,
        rotationCount: rotationCount + 1,
        lastMoveMarkers: rotateLastMoveMarkers(lastMoveMarkers, n)
    };
}

function komiForSize(boardSize) {
    return boardSize <= 8 ? 4.25 : 3.25;
}

class RotationWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 18) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.handNumAt = initZero2D(this.boardSize);
        this.rotationCount = 0;
        this.rotationInterval = computeRotationInterval(this.boardSize);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
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
        this.slotJoinedAt = { black: null, white: null };
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
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            if (this.pendingScore) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'black' ? '黑超时白胜' : '白超时黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
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
        this.tcNego = { phase: 'propose', proposal: null, waitingSlot: first, lastProposerSlot: null };
        const ws = room.getPlayerBySlot(first);
        if (ws) ws.send(JSON.stringify({ type: 'timeControlNegotiation', mode: 'propose' }));
        const other = first === 'black' ? 'white' : 'black';
        const ws2 = room.getPlayerBySlot(other);
        if (ws2) ws2.send(JSON.stringify({ type: 'timeControlWaitPeer', text: '对方正在选择限时规则…' }));
    }

    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }

    _sendRespondDialog(toSlot, proposal) {
        const ws = this.room.getPlayerBySlot(toSlot);
        if (!ws) return;
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
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
            this._sendRespondDialog(other, v);
            return;
        }
        if (this.tcNego.phase === 'respond') {
            if (slot !== this.tcNego.waitingSlot) return;
            this.tcNego.proposal = v;
            this.tcNego.lastProposerSlot = slot;
            const other = slot === 'black' ? 'white' : 'black';
            this.tcNego.waitingSlot = other;
            room.getPlayerBySlot(slot).send(JSON.stringify({ type: 'timeControlWaitPeer', text: '正在等对方确认' }));
            this._sendRespondDialog(other, v);
        }
    }

    _handleTimeControlAccept(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot || !this.tcNego || this.tcNego.phase !== 'respond') return;
        if (slot !== this.tcNego.waitingSlot) return;
        const prop = this.tcNego.proposal;
        if (!prop || prop.ok !== true) return;
        this.tcSettings = prop.timed ? {
            timed: true,
            mainMinutes: prop.mainMinutes,
            byoyomiSeconds: prop.byoyomiSeconds,
            maxTimeouts: prop.maxTimeouts
        } : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, Date.now());
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
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
            this.recordResultText = lostSlot === 'black' ? '黑超时白胜' : '白超时黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'black' : 'white', Date.now());
        this._broadcastClock();
    }

    countGroupLiberties(board, row, col) {
        return squareWeiqiRules.countGroupLiberties(board, row, col, this.boardSize);
    }

    removeGroup(board, row, col, color) {
        squareWeiqiRules.removeGroup(board, row, col, color, this.boardSize);
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        return squareWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, this.boardSize, (b) => this.copyBoard(b), 1
        );
    }

    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        return squareWeiqiRules.isLibertySurroundedByOpponent(
            board, libertyRow, libertyCol, opponentColor, this.boardSize
        );
    }

    removeDeadAndDying(srcBoard) {
        return squareWeiqiRules.removeDeadAndDying(srcBoard, this.boardSize, (b) => this.copyBoard(b));
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
        const K = komiForSize(this.boardSize);
        return blackTotal - whiteTotal - 2 * K;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            komi: komiForSize(this.boardSize),
            board: this.board,
            handNumAt: this.handNumAt,
            rotationCount: this.rotationCount,
            rotationInterval: this.rotationInterval,
            numberOfHands: 1 + this.historyBoards.length,
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
                    : (this.tcSettings && this.tcSettings.timed === false ? { timed: false, ruleLine: '本局不限时' } : null)
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

    rotationWeiqiMove(ws, msg, slot) {
        if (!this._timeAllowsPlay(slot)) return;
        if (!this._drainClockBeforeMove(slot)) return;
        const beforeLen = this.moveCoords.length;
        if (this.gameOver) return;
        if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;
        const { row, col } = msg;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
        if (this.board[row][col] !== 0) return;
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        const completedPlyCount = this.moveCoords.length + 1;
        const rotateNow = willRotateThisPly(completedPlyCount, this.rotationInterval, this.rotationCount);

        let finalBoard;
        let finalHand;
        let finalRotationCount;
        let finalMarkers;

        let preBoardAnim = null;
        let preHandAnim = null;
        const preMarkersAnim = rotateNow ? [{ row, col, color: playerVal }] : null;

        if (rotateNow) {
            const placedOnly = this.copyBoard(this.board);
            placedOnly[row][col] = playerVal;
            finalHand = this.copyBoard(this.handNumAt);
            syncHandNumWithBoard(placedOnly, finalHand);
            finalHand[row][col] = completedPlyCount;

            preBoardAnim = this.copyBoard(placedOnly);
            preHandAnim = this.copyBoard(finalHand);

            const half = this.boardSize / 2;
            const mapCell = (r, c) => rotateCell(r, c, half);
            finalBoard = rotateBoardLike(placedOnly, this.boardSize, mapCell);
            finalHand = rotateBoardLike(finalHand, this.boardSize, mapCell);
            const [pr, pc] = rotateCell(row, col, half);
            applyRotationPlyCaptures(
                finalBoard, pr, pc, playerVal, this.boardSize, true, squareWeiqiRules
            );
            syncHandNumWithBoard(finalBoard, finalHand);
            finalRotationCount = this.rotationCount + 1;
            finalMarkers = rotateLastMoveMarkers([{ row, col, color: playerVal }], this.boardSize);
        } else {
            const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
            if (!newBoard) return;

            const handNumAt = this.copyBoard(this.handNumAt);
            syncHandNumWithBoard(newBoard, handNumAt);
            handNumAt[row][col] = completedPlyCount;

            const rot = maybeRotateAfterPly({
                board: newBoard,
                handNumAt,
                rotationCount: this.rotationCount,
                n: this.boardSize,
                rotationInterval: this.rotationInterval,
                completedPlyCount,
                lastMoveMarkers: [{ row, col, color: playerVal }]
            });

            finalBoard = rot.board;
            finalHand = rot.handNumAt;
            finalRotationCount = rot.rotationCount;
            finalMarkers = rot.lastMoveMarkers;
        }

        const newBoardStr = this.boardToString(finalBoard);
        if (this.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }

        const rotatedThisPly = finalRotationCount > this.rotationCount;

        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyBoards.push(this.copyBoard(finalBoard));
        this.historyBoardSet.add(newBoardStr);
        this.historyHandNumAts.push(this.copyBoard(finalHand));
        this.historyRotationCounts.push(finalRotationCount);

        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col });
        this.board = finalBoard;
        this.handNumAt = finalHand;
        this.rotationCount = finalRotationCount;
        this.lastMoveMarkers = finalMarkers;
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;

        const payload = { type: 'broadcast', action: 'move', ...this.getState() };
        if (rotatedThisPly) {
            payload.rotationAnimation = {
                preBoard: preBoardAnim,
                postBoard: this.copyBoard(finalBoard),
                preHandNumAt: preHandAnim,
                postHandNumAt: this.copyBoard(finalHand),
                preMarkers: preMarkersAnim,
                postMarkers: finalMarkers.map(m => ({ ...m }))
            };
        }
        this.broadcast(payload);
        if (this.moveCoords.length !== beforeLen) this._syncClockAfterTurnChange();
        if (
            (this.moveCoords.length + 1) % this.rotationInterval === 0
            && this.rotationCount < MAX_ROTATIONS
        ) {
            this.broadcast({ type: 'rotatePrepare' });
        }
    }

    rotationWeiqiPass(ws, slot) {
        if (!this._timeAllowsPlay(slot)) return;
        if (!this._drainClockBeforeMove(slot)) return;
        const beforeLen = this.moveCoords.length;
        const room = this.room;
        if (this.gameOver) return;
        if (!slot || slot !== (this.currentPlayer === 1 ? 'black' : 'white')) return;

        const completedPlyCount = this.moveCoords.length + 1;
        const workingBoard = this.copyBoard(this.board);
        const workingHand = this.copyBoard(this.handNumAt);
        const passerVal = this.currentPlayer === 1 ? 1 : 2;
        const rotateNow = willRotateThisPly(completedPlyCount, this.rotationInterval, this.rotationCount);

        let finalBoard;
        let finalHand;
        let finalRotationCount;
        let finalMarkers;

        if (rotateNow) {
            const r = rotateQuadrantsClockwise(workingBoard, workingHand, this.boardSize);
            applyRotationPlyCaptures(
                r.board, 0, 0, passerVal, this.boardSize, false, squareWeiqiRules
            );
            syncHandNumWithBoard(r.board, r.handNumAt);
            finalBoard = r.board;
            finalHand = r.handNumAt;
            finalRotationCount = this.rotationCount + 1;
            finalMarkers = rotateLastMoveMarkers([], this.boardSize);
        } else {
            const rot = maybeRotateAfterPly({
                board: workingBoard,
                handNumAt: workingHand,
                rotationCount: this.rotationCount,
                n: this.boardSize,
                rotationInterval: this.rotationInterval,
                completedPlyCount,
                lastMoveMarkers: []
            });
            finalBoard = rot.board;
            finalHand = rot.handNumAt;
            finalRotationCount = rot.rotationCount;
            finalMarkers = rot.lastMoveMarkers;
        }

        const rotatedThisPly = finalRotationCount > this.rotationCount;
        const preBoardAnim = rotatedThisPly ? this.copyBoard(workingBoard) : null;
        const preHandAnim = rotatedThisPly ? this.copyBoard(workingHand) : null;

        this.historyBoards.push(this.copyBoard(finalBoard));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyHandNumAts.push(this.copyBoard(finalHand));
        this.historyRotationCounts.push(finalRotationCount);

        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'pass', player: slot });
        this.board = finalBoard;
        this.handNumAt = finalHand;
        this.rotationCount = finalRotationCount;
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.passCounter++;
        this.lastMoveMarkers = finalMarkers;

        const passPayload = { type: 'broadcast', action: 'pass', ...this.getState() };
        if (rotatedThisPly) {
            passPayload.rotationAnimation = {
                preBoard: preBoardAnim,
                postBoard: this.copyBoard(finalBoard),
                preHandNumAt: preHandAnim,
                postHandNumAt: this.copyBoard(finalHand),
                preMarkers: [],
                postMarkers: finalMarkers.map(m => ({ ...m }))
            };
        }
        this.broadcast(passPayload);
        if (this.moveCoords.length !== beforeLen) this._syncClockAfterTurnChange();
        if (
            (this.moveCoords.length + 1) % this.rotationInterval === 0
            && this.rotationCount < MAX_ROTATIONS
        ) {
            this.broadcast({ type: 'rotatePrepare' });
        }

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
                this.rotationWeiqiMove(ws, msg, slot);
                break;

            case 'pass':
                this.rotationWeiqiPass(ws, slot);
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot, {
                    onResignResolved: (winnerSlot) => {
                        this.recordResultText = winnerSlot === 'black' ? '黑中盘胜' : '白中盘胜';
                        this._stopClockTicker();
                    }
                });
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
                qiProtocol.drawResponse(this, ws, msg, {
                    onDrawResolved: () => {
                        this.recordResultText = '和胜';
                        this._stopClockTicker();
                    }
                });
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
                            this.recordResultText = lead === 0 ? '和胜' : `${lead > 0 ? '黑' : '白'}胜${Math.abs(lead).toFixed(2)}点`;
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

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                this.historyBoardSet.delete(this.boardToString(this.historyBoards.pop()));
            }
            if (this.historyHandNumAts.length > 0) this.historyHandNumAts.pop();
            if (this.historyRotationCounts.length > 0) this.historyRotationCounts.pop();
            if (this.historyMarkers.length > 0) {
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            } else {
                this.lastMoveMarkers = [];
            }
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }

        if (this.historyBoards.length === 0) {
            this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
            this.handNumAt = initZero2D(this.boardSize);
            this.rotationCount = 0;
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.handNumAt = this.copyBoard(this.historyHandNumAts.at(-1));
            this.rotationCount = this.historyRotationCounts.at(-1);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.handNumAt = initZero2D(this.boardSize);
        this.rotationCount = 0;
        this.rotationInterval = computeRotationInterval(this.boardSize);
        this.currentPlayer = 1;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this._stopClockTicker();
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        for (const [client, slot] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(slot);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { black: false, white: false } });
    }

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小须为 8～20 之间的偶数路' }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v !== 0));
        const hasPlayer = this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white');
        if (hasAnyStone || hasPlayer) return false;
        this.boardSize = newSize;
        this.rotationInterval = computeRotationInterval(this.boardSize);
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardSize });
        return true;
    }

    exportRecord() {
        const exportedTimeControl = this.tcSettings ? {
            enabled: this.tcSettings.timed === true,
            mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
            byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
            maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
        } : null;
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
            gameType: '旋转围棋',
            gameId: 'rotation-weiqi',
            boardSize: this.boardSize,
            komi: komiForSize(this.boardSize),
            players: { black: null, white: null },
            initialPosition: [],
            moves: this.moveCoords.map(m => {
                const p = m.player === 'black' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : p + m.row + ',' + m.col;
            }),
            timeControl: exportedTimeControl,
            result: resultText
        };
    }

    resetToEmpty() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.handNumAt = initZero2D(this.boardSize);
        this.rotationCount = 0;
        this.slotJoinedAt = { black: null, white: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this._stopClockTicker();
        this.rotationInterval = computeRotationInterval(this.boardSize);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyHandNumAts = [];
        this.historyRotationCounts = [];
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
            const coords = entry.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        return entry;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'rotation-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要旋转围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 18;
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.rotationInterval = computeRotationInterval(this.boardSize);
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(RotationWeiqiRoom.parseMove);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                const completedPlyCount = this.moveCoords.length + 1;
                const rotateNow = willRotateThisPly(
                    completedPlyCount, this.rotationInterval, this.rotationCount
                );

                let finalBoard;
                let finalHand;
                let finalRotationCount;
                let finalMarkers;

                if (rotateNow) {
                    if (this.board[row][col] !== 0) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                    const placedOnly = this.copyBoard(this.board);
                    placedOnly[row][col] = playerVal;
                    finalHand = this.copyBoard(this.handNumAt);
                    syncHandNumWithBoard(placedOnly, finalHand);
                    finalHand[row][col] = completedPlyCount;

                    const half = this.boardSize / 2;
                    const mapCell = (r, c) => rotateCell(r, c, half);
                    finalBoard = rotateBoardLike(placedOnly, this.boardSize, mapCell);
                    finalHand = rotateBoardLike(finalHand, this.boardSize, mapCell);
                    const [pr, pc] = rotateCell(row, col, half);
                    applyRotationPlyCaptures(
                        finalBoard, pr, pc, playerVal, this.boardSize, true, squareWeiqiRules
                    );
                    syncHandNumWithBoard(finalBoard, finalHand);
                    finalRotationCount = this.rotationCount + 1;
                    finalMarkers = rotateLastMoveMarkers([{ row, col, color: playerVal }], this.boardSize);
                } else {
                    const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                    if (!newBoard) {
                        this.resetToEmpty();
                        requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                        this.broadcast({ type: 'roomReset', ...this.getState() });
                        return;
                    }
                    syncHandNumWithBoard(newBoard, this.handNumAt);
                    this.handNumAt[row][col] = completedPlyCount;

                    const rot = maybeRotateAfterPly({
                        board: newBoard,
                        handNumAt: this.handNumAt,
                        rotationCount: this.rotationCount,
                        n: this.boardSize,
                        rotationInterval: this.rotationInterval,
                        completedPlyCount,
                        lastMoveMarkers: [{ row, col, color: playerVal }]
                    });

                    finalBoard = rot.board;
                    finalHand = rot.handNumAt;
                    finalRotationCount = rot.rotationCount;
                    finalMarkers = rot.lastMoveMarkers;
                }

                const newBoardStr = this.boardToString(finalBoard);
                this.historyBoards.push(this.copyBoard(finalBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyHandNumAts.push(this.copyBoard(finalHand));
                this.historyRotationCounts.push(finalRotationCount);

                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = finalBoard;
                this.handNumAt = finalHand;
                this.rotationCount = finalRotationCount;
                this.lastMoveMarkers = finalMarkers;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                const completedPlyCount = this.moveCoords.length + 1;
                const workingBoard = this.copyBoard(this.board);
                const workingHand = this.copyBoard(this.handNumAt);
                const passerVal = slot === 'black' ? 1 : 2;
                const rotateNow = willRotateThisPly(
                    completedPlyCount, this.rotationInterval, this.rotationCount
                );

                let finalBoard;
                let finalHand;
                let finalRotationCount;
                let finalMarkers;

                if (rotateNow) {
                    const r = rotateQuadrantsClockwise(workingBoard, workingHand, this.boardSize);
                    applyRotationPlyCaptures(
                        r.board, 0, 0, passerVal, this.boardSize, false, squareWeiqiRules
                    );
                    syncHandNumWithBoard(r.board, r.handNumAt);
                    finalBoard = r.board;
                    finalHand = r.handNumAt;
                    finalRotationCount = this.rotationCount + 1;
                    finalMarkers = rotateLastMoveMarkers([], this.boardSize);
                } else {
                    const rot = maybeRotateAfterPly({
                        board: workingBoard,
                        handNumAt: workingHand,
                        rotationCount: this.rotationCount,
                        n: this.boardSize,
                        rotationInterval: this.rotationInterval,
                        completedPlyCount,
                        lastMoveMarkers: []
                    });
                    finalBoard = rot.board;
                    finalHand = rot.handNumAt;
                    finalRotationCount = rot.rotationCount;
                    finalMarkers = rot.lastMoveMarkers;
                }

                this.historyBoards.push(this.copyBoard(finalBoard));
                this.historyHandNumAts.push(this.copyBoard(finalHand));
                this.historyRotationCounts.push(finalRotationCount);

                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.board = finalBoard;
                this.handNumAt = finalHand;
                this.rotationCount = finalRotationCount;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = finalMarkers;
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
            if (importedResultText === '和胜' || importedResultText === 'draw') this.winner = 'draw';
            else if (importedResultText.includes('白胜') || importedResultText === 'white') this.winner = 'white';
            else if (importedResultText.includes('黑胜') || importedResultText === 'black') this.winner = 'black';
        }
        if (!this.matchStarted && this.moveCoords.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
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
        room.gameLogic = new RotationWeiqiRoom(room);
        room.maxPlayers = 2;
    }
};
