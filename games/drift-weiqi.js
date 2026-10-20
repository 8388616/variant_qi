'use strict';

const { qiApplyRecordKomi, qiEffectiveKomi, QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact, computeBensonWeiqiLead, squareWeiqiScoringOps } = require('../common');

const MAX_DRIFTS = 8;

function computeDriftInterval(n) {
    let x = Math.ceil(0.07 * n * n);
    if (x % 2 === 0) x += 1;
    return x;
}

function driftCell(r, c, half) {
    if (r < half && c < half) return [r, c + half];
    if (r < half) return [r + half, c];
    if (c < half) return [r - half, c];
    return [r, c - half];
}

function initZero2D(n) {
    return Array(n).fill(0).map(() => Array(n).fill(0));
}

function driftBoardLike(board, n, mapCell) {
    const nb = initZero2D(n);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const [nr, nc] = mapCell(r, c);
            nb[nr][nc] = board[r][c];
        }
    }
    return nb;
}

function driftQuadrantsClockwise(board, handNumAt, n) {
    const half = n / 2;
    const mapCell = (r, c) => driftCell(r, c, half);
    return {
        board: driftBoardLike(board, n, mapCell),
        handNumAt: driftBoardLike(handNumAt, n, mapCell)
    };
}

function driftLastMoveMarkers(markers, n) {
    if (!markers || !markers.length) return [];
    const half = n / 2;
    return markers.map(m => {
        const [nr, nc] = driftCell(m.row, m.col, half);
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

function willDriftThisPly(completedPlyCount, driftInterval, driftCount) {
    if (driftCount >= MAX_DRIFTS) return false;
    if (completedPlyCount <= 0 || completedPlyCount % driftInterval !== 0) return false;
    return true;
}

/**
 * 漂移围棋的禁全同 key：局面 + 每颗子的「年龄」（handNumAt，落子/漂来的手数）+ 漂移相位
 * （已漂移次数、离下一次漂移还差几手）。
 * 这棋种的后续演化由年龄图和漂移节奏决定（漂移按象限搬运棋子、年龄跟着走），
 * 所以「同盘面、年龄或漂移相位不同」不是同一局面；只比盘面会把它误判成重复 → 错杀。
 */
function driftSuperKoKey(room, board, handNumAt, driftCount, plyCount) {
    const ages = [];
    for (let r = 0; r < room.boardSize; r++) {
        const boardRow = board[r] || [];
        const handRow = (handNumAt && handNumAt[r]) || [];
        const cells = [];
        for (let c = 0; c < room.boardSize; c++) {
            cells.push(boardRow[c] === 0 ? '-' : String(handRow[c] | 0));
        }
        ages.push(cells.join(','));
    }
    const residue = room.driftInterval > 0 ? (plyCount % room.driftInterval) : 0;
    return room.boardToString(board) + '|' + ages.join('/') + '|' + (driftCount | 0) + '|' + residue;
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
 * 漂移手：漂移后的提子顺序为先对方（落子邻接 + 一路线）再己方（落子点 + 一路线）。
 * hasPlacement 为 false 时（虚着触发漂移）仅检查一路线。
 */
function applyDriftPlyCaptures(board, placeR, placeC, playerVal, boardSize, hasPlacement, rules) {
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

function maybeDriftAfterPly(opts) {
    const {
        board,
        handNumAt,
        driftCount,
        n,
        driftInterval,
        completedPlyCount,
        lastMoveMarkers
    } = opts;
    if (driftCount >= MAX_DRIFTS) {
        return { board, handNumAt, driftCount, lastMoveMarkers };
    }
    if (completedPlyCount <= 0 || completedPlyCount % driftInterval !== 0) {
        return { board, handNumAt, driftCount, lastMoveMarkers };
    }
    const r = driftQuadrantsClockwise(board, handNumAt, n);
    return {
        board: r.board,
        handNumAt: r.handNumAt,
        driftCount: driftCount + 1,
        lastMoveMarkers: driftLastMoveMarkers(lastMoveMarkers, n)
    };
}

function komiForSize(boardSize) {
    return boardSize <= 8 ? 4.25 : 3.25;
}

class DriftWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialSize = 18) {
        super(room);
        this.boardSize = initialSize;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        if (this.openingBoard === undefined) this.openingBoard = (typeof this.copyBoard === 'function' ? this.copyBoard(this.board) : (Array.isArray(this.board[0]) ? this.board.map(r => r.slice()) : this.board.slice()));
        this.handNumAt = initZero2D(this.boardSize);
        this.driftCount = 0;
        this.driftInterval = computeDriftInterval(this.boardSize);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
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
                this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
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
            this.recordResultText = lostSlot === 'player1' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', Date.now());
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

    /** 形势判断 / 数点：用 Benson 档（公共口径：弱气去死子 ↔ Benson 保活 → 最近归属 → 确定领地覆盖） */
    computeLead() {
        const { lead } = computeBensonWeiqiLead(this.board, qiEffectiveKomi(this, komiForSize(this.boardSize)), squareWeiqiScoringOps(this.boardSize, {
            copyBoard: (b) => this.copyBoard(b)
        }));
        return lead;
    }

    getState() {
        return {
            boardSize: this.boardSize,
            komi: qiEffectiveKomi(this, komiForSize(this.boardSize)),
            board: this.board,
            handNumAt: this.handNumAt,
            driftCount: this.driftCount,
            driftInterval: this.driftInterval,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            moveCoords: this.moveCoords,
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

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    driftWeiqiMove(ws, msg, slot) {
        if (!this._timeAllowsPlay(slot)) return;
        if (!this._drainClockBeforeMove(slot)) return;
        const beforeLen = this.moveCoords.length;
        if (this.gameOver) return;
        if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
        const { row, col } = msg;
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return;
        if (this.board[row][col] !== 0) return;
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        const completedPlyCount = this.moveCoords.length + 1;
        const driftNow = willDriftThisPly(completedPlyCount, this.driftInterval, this.driftCount);

        let finalBoard;
        let finalHand;
        let finalDriftCount;
        let finalMarkers;

        let preBoardAnim = null;
        let preHandAnim = null;
        const preMarkersAnim = driftNow ? [{ row, col, color: playerVal }] : null;

        if (driftNow) {
            const placedOnly = this.copyBoard(this.board);
            placedOnly[row][col] = playerVal;
            finalHand = this.copyBoard(this.handNumAt);
            syncHandNumWithBoard(placedOnly, finalHand);
            finalHand[row][col] = completedPlyCount;

            preBoardAnim = this.copyBoard(placedOnly);
            preHandAnim = this.copyBoard(finalHand);

            const half = this.boardSize / 2;
            const mapCell = (r, c) => driftCell(r, c, half);
            finalBoard = driftBoardLike(placedOnly, this.boardSize, mapCell);
            finalHand = driftBoardLike(finalHand, this.boardSize, mapCell);
            const [pr, pc] = driftCell(row, col, half);
            applyDriftPlyCaptures(
                finalBoard, pr, pc, playerVal, this.boardSize, true, squareWeiqiRules
            );
            syncHandNumWithBoard(finalBoard, finalHand);
            finalDriftCount = this.driftCount + 1;
            finalMarkers = driftLastMoveMarkers([{ row, col, color: playerVal }], this.boardSize);
        } else {
            const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
            if (!newBoard) return;

            const handNumAt = this.copyBoard(this.handNumAt);
            syncHandNumWithBoard(newBoard, handNumAt);
            handNumAt[row][col] = completedPlyCount;

            const rot = maybeDriftAfterPly({
                board: newBoard,
                handNumAt,
                driftCount: this.driftCount,
                n: this.boardSize,
                driftInterval: this.driftInterval,
                completedPlyCount,
                lastMoveMarkers: [{ row, col, color: playerVal }]
            });

            finalBoard = rot.board;
            finalHand = rot.handNumAt;
            finalDriftCount = rot.driftCount;
            finalMarkers = rot.lastMoveMarkers;
        }

        const newBoardStr = driftSuperKoKey(this, finalBoard, finalHand, finalDriftCount, completedPlyCount);
        if (this.historyBoardSet.has(newBoardStr)) {
            ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
            return;
        }

        const driftedThisPly = finalDriftCount > this.driftCount;

        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyBoards.push(this.copyBoard(finalBoard));
        this.historyBoardSet.add(newBoardStr);
        this.historyHandNumAts.push(this.copyBoard(finalHand));
        this.historyDriftCounts.push(finalDriftCount);

        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'move', player: slot, row, col });
        this.board = finalBoard;
        this.handNumAt = finalHand;
        this.driftCount = finalDriftCount;
        this.lastMoveMarkers = finalMarkers;
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;

        const payload = { type: 'broadcast', action: 'move', ...this.getState() };
        if (driftedThisPly) {
            payload.driftAnimation = {
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
            (this.moveCoords.length + 1) % this.driftInterval === 0
            && this.driftCount < MAX_DRIFTS
        ) {
            this.broadcast({ type: 'driftPrepare' });
        }
    }

    driftWeiqiPass(ws, slot) {
        if (!this._timeAllowsPlay(slot)) return;
        if (!this._drainClockBeforeMove(slot)) return;
        const beforeLen = this.moveCoords.length;
        const room = this.room;
        if (this.gameOver) return;
        if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;

        const completedPlyCount = this.moveCoords.length + 1;
        const workingBoard = this.copyBoard(this.board);
        const workingHand = this.copyBoard(this.handNumAt);
        const passerVal = this.currentPlayer === 1 ? 1 : 2;
        const driftNow = willDriftThisPly(completedPlyCount, this.driftInterval, this.driftCount);

        let finalBoard;
        let finalHand;
        let finalDriftCount;
        let finalMarkers;

        if (driftNow) {
            const r = driftQuadrantsClockwise(workingBoard, workingHand, this.boardSize);
            applyDriftPlyCaptures(
                r.board, 0, 0, passerVal, this.boardSize, false, squareWeiqiRules
            );
            syncHandNumWithBoard(r.board, r.handNumAt);
            finalBoard = r.board;
            finalHand = r.handNumAt;
            finalDriftCount = this.driftCount + 1;
            finalMarkers = driftLastMoveMarkers([], this.boardSize);
        } else {
            const rot = maybeDriftAfterPly({
                board: workingBoard,
                handNumAt: workingHand,
                driftCount: this.driftCount,
                n: this.boardSize,
                driftInterval: this.driftInterval,
                completedPlyCount,
                lastMoveMarkers: []
            });
            finalBoard = rot.board;
            finalHand = rot.handNumAt;
            finalDriftCount = rot.driftCount;
            finalMarkers = rot.lastMoveMarkers;
        }

        const driftedThisPly = finalDriftCount > this.driftCount;
        const preBoardAnim = driftedThisPly ? this.copyBoard(workingBoard) : null;
        const preHandAnim = driftedThisPly ? this.copyBoard(workingHand) : null;

        this.historyBoards.push(this.copyBoard(finalBoard));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyHandNumAts.push(this.copyBoard(finalHand));
        this.historyDriftCounts.push(finalDriftCount);

        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'pass', player: slot });
        this.board = finalBoard;
        this.handNumAt = finalHand;
        this.driftCount = finalDriftCount;
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.passCounter++;
        this.lastMoveMarkers = finalMarkers;

        const passPayload = { type: 'broadcast', action: 'pass', ...this.getState() };
        if (driftedThisPly) {
            passPayload.driftAnimation = {
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
            (this.moveCoords.length + 1) % this.driftInterval === 0
            && this.driftCount < MAX_DRIFTS
        ) {
            this.broadcast({ type: 'driftPrepare' });
        }

        if (this.passCounter >= 2) {
            this.passCounter = 0;
            const blackPlayer = room.getPlayerBySlot('player1');
            const whitePlayer = room.getPlayerBySlot('player2');
            if (blackPlayer && whitePlayer) {
                this.startScoreCounting(blackPlayer, whitePlayer);
            } else {
                this.gameOver = true;
                this.broadcast({ type: 'broadcast', action: 'endAgreed', ...this.getState() });
            }
        }
    }

    /** 认输：resignSlot 是**认输方**（公共层契约），player1 执黑 */
    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
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
                this.driftWeiqiMove(ws, msg, slot);
                break;

            case 'pass':
                this.driftWeiqiPass(ws, slot);
                break;

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                this._stopClockTicker();
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
                        this.recordResultText = '和棋';
                        this._stopClockTicker();
                    }
                });
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
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this.recordResultText = lead === 0 ? '和棋' : `${lead > 0 ? '黑' : '白'}胜${Math.abs(lead).toFixed(2)}点`;
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

    /** 编辑棋盘后种「这一手局面」用的 key（同一套定义，别退回纯盘面串） */
    superKoSeedKey() {
        return driftSuperKoKey(this, this.board, this.handNumAt, this.driftCount, this.moveCoords.length);
    }

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;

        for (let i = 0; i < steps; i++) {
            const poppedCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
            if (this.historyBoards.length > 0) {
                const poppedBoard = this.historyBoards.pop();
                const poppedHand = this.historyHandNumAts.length > 0 ? this.historyHandNumAts.pop() : null;
                const poppedDrift = this.historyDriftCounts.length > 0 ? this.historyDriftCounts.pop() : 0;
                // 只有落子（type 'move'）进过集合：虚着只推了快照没记 key，拿它去 delete 会误删上一次落子的记录。
                // 快照对应「第 moveCoords.length 手之后」的局面（此时 moveCoords 还没 pop）→ 当时手数就是它。
                if (poppedCoord && poppedCoord.type === 'move' && poppedHand)
                    this.historyBoardSet.delete(driftSuperKoKey(this, poppedBoard, poppedHand, poppedDrift, this.moveCoords.length));
            }
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
            this.driftCount = 0;
        } else {
            this.board = this.copyBoard(this.historyBoards.at(-1));
            this.handNumAt = this.copyBoard(this.historyHandNumAts.at(-1));
            this.driftCount = this.historyDriftCounts.at(-1);
        }
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    resetGame() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.handNumAt = initZero2D(this.boardSize);
        this.driftCount = 0;
        this.driftInterval = computeDriftInterval(this.boardSize);
        this.currentPlayer = 1;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.importedKomi = undefined;
        this.matchStarted = false;
        this._stopClockTicker();
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
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

    setBoardSize(newSize, requesterWs) {
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋盘大小须为 8～20 之间的偶数路' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) return false;
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardSize = newSize;
        this.driftInterval = computeDriftInterval(this.boardSize);
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
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '漂移围棋',
            gameId: 'drift-weiqi',
            boardSize: this.boardSize,
            komi: qiEffectiveKomi(this, komiForSize(this.boardSize)),
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
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.handNumAt = initZero2D(this.boardSize);
        this.driftCount = 0;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.importedKomi = undefined;
        this.matchStarted = false;
        this._stopClockTicker();
        this.driftInterval = computeDriftInterval(this.boardSize);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyHandNumAts = [];
        this.historyDriftCounts = [];
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
        if (!data || data.gameId !== 'drift-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要漂移围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 18;
        if (!Number.isInteger(newSize) || newSize < 8 || newSize > 20 || newSize % 2 !== 0) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.driftInterval = computeDriftInterval(this.boardSize);
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(DriftWeiqiRoom.parseMove);

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
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                const completedPlyCount = this.moveCoords.length + 1;
                const driftNow = willDriftThisPly(
                    completedPlyCount, this.driftInterval, this.driftCount
                );

                let finalBoard;
                let finalHand;
                let finalDriftCount;
                let finalMarkers;

                if (driftNow) {
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
                    const mapCell = (r, c) => driftCell(r, c, half);
                    finalBoard = driftBoardLike(placedOnly, this.boardSize, mapCell);
                    finalHand = driftBoardLike(finalHand, this.boardSize, mapCell);
                    const [pr, pc] = driftCell(row, col, half);
                    applyDriftPlyCaptures(
                        finalBoard, pr, pc, playerVal, this.boardSize, true, squareWeiqiRules
                    );
                    syncHandNumWithBoard(finalBoard, finalHand);
                    finalDriftCount = this.driftCount + 1;
                    finalMarkers = driftLastMoveMarkers([{ row, col, color: playerVal }], this.boardSize);
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

                    const rot = maybeDriftAfterPly({
                        board: newBoard,
                        handNumAt: this.handNumAt,
                        driftCount: this.driftCount,
                        n: this.boardSize,
                        driftInterval: this.driftInterval,
                        completedPlyCount,
                        lastMoveMarkers: [{ row, col, color: playerVal }]
                    });

                    finalBoard = rot.board;
                    finalHand = rot.handNumAt;
                    finalDriftCount = rot.driftCount;
                    finalMarkers = rot.lastMoveMarkers;
                }

                const newBoardStr = driftSuperKoKey(this, finalBoard, finalHand, finalDriftCount, completedPlyCount);
                this.historyBoards.push(this.copyBoard(finalBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyHandNumAts.push(this.copyBoard(finalHand));
                this.historyDriftCounts.push(finalDriftCount);

                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = finalBoard;
                this.handNumAt = finalHand;
                this.driftCount = finalDriftCount;
                this.lastMoveMarkers = finalMarkers;
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                const completedPlyCount = this.moveCoords.length + 1;
                const workingBoard = this.copyBoard(this.board);
                const workingHand = this.copyBoard(this.handNumAt);
                const passerVal = slot === 'player1' ? 1 : 2;
                const driftNow = willDriftThisPly(
                    completedPlyCount, this.driftInterval, this.driftCount
                );

                let finalBoard;
                let finalHand;
                let finalDriftCount;
                let finalMarkers;

                if (driftNow) {
                    const r = driftQuadrantsClockwise(workingBoard, workingHand, this.boardSize);
                    applyDriftPlyCaptures(
                        r.board, 0, 0, passerVal, this.boardSize, false, squareWeiqiRules
                    );
                    syncHandNumWithBoard(r.board, r.handNumAt);
                    finalBoard = r.board;
                    finalHand = r.handNumAt;
                    finalDriftCount = this.driftCount + 1;
                    finalMarkers = driftLastMoveMarkers([], this.boardSize);
                } else {
                    const rot = maybeDriftAfterPly({
                        board: workingBoard,
                        handNumAt: workingHand,
                        driftCount: this.driftCount,
                        n: this.boardSize,
                        driftInterval: this.driftInterval,
                        completedPlyCount,
                        lastMoveMarkers: []
                    });
                    finalBoard = rot.board;
                    finalHand = rot.handNumAt;
                    finalDriftCount = rot.driftCount;
                    finalMarkers = rot.lastMoveMarkers;
                }

                this.historyBoards.push(this.copyBoard(finalBoard));
                this.historyHandNumAts.push(this.copyBoard(finalHand));
                this.historyDriftCounts.push(finalDriftCount);

                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.board = finalBoard;
                this.handNumAt = finalHand;
                this.driftCount = finalDriftCount;
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
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }
        if (!this.matchStarted && this.moveCoords.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
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
        room.gameLogic = new DriftWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
