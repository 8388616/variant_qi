'use strict';

/**
 * 公共 KataGo 人机对战：挂到任意方格围棋 Room 上。
 * 不改各棋种 games/*.js；由 qi-server 在 initRoom 后按 katagos/{gameId} 是否齐全自动安装。
 */

const {
    isKatagoAvailable,
    canAcquireKatagoNow,
    acquireKatagoSession,
    releaseKatagoSession,
    isKatagoBusyError,
    KATAGO_BUSY_MESSAGE
} = require('./katago-gtp');

/** 人机对局超过此时长无落子则把引擎归还空闲池（对局本身不结束） */
const KATAGO_HIBERNATE_MS = 10 * 60 * 1000;

function getMatchTimeControl() {
    try {
        return require('./common').qiMatchTimeControl;
    } catch (_) {
        return null;
    }
}

function supportsSquareWeiqiGtp(self) {
    return !!(self
        && typeof self.tryPlaceStone === 'function'
        && typeof self.boardSize === 'number'
        && Array.isArray(self.board)
        && typeof self.getState === 'function'
        && typeof self.broadcast === 'function');
}

function readKomi(self) {
    try {
        const st = self.getState && self.getState();
        if (st && st.komi != null && Number.isFinite(Number(st.komi))) return Number(st.komi);
    } catch (_) { /* ignore */ }
    if (self.komi != null && Number.isFinite(Number(self.komi))) return Number(self.komi);
    if (typeof self.getKomi === 'function') {
        const k = Number(self.getKomi());
        if (Number.isFinite(k)) return k;
    }
    return 7.5;
}

/** 易位围棋：网页剩余可易位手数（set_position 后引擎着法史为空，故传剩余值） */
function readRemainingTranslocationMoves(self) {
    const maxT = self.maxTranspositionMoves != null
        ? Number(self.maxTranspositionMoves)
        : (self.maxTranslocationMoves != null ? Number(self.maxTranslocationMoves) : NaN);
    if (!Number.isFinite(maxT)) return null;
    const played = Number.isFinite(Number(self.moveCount)) ? (Number(self.moveCount) | 0) : 0;
    return Math.max(0, (maxT | 0) - played);
}

function buildKatagoSetupOpts(self, board) {
    const opts = {
        boardSize: self.boardSize,
        komi: readKomi(self),
        board,
        gameId: self.room && self.room.gameType
    };
    const remain = readRemainingTranslocationMoves(self);
    if (remain != null) opts.maxTranslocationMoves = remain;
    return opts;
}

function bumpMoveCount(self) {
    if ('moveCount' in self && Number.isFinite(Number(self.moveCount))) {
        self.moveCount = (Number(self.moveCount) | 0) + 1;
    }
}

function enrichState(self, state) {
    if (!state || typeof state !== 'object') return state;
    state.katagoAvailable = !!self.katagoAvailable;
    state.computerSlot = self.computerSlot || null;
    if (!state.slots) state.slots = { black: false, white: false };
    if (self.computerSlot === 'black') state.slots.black = true;
    if (self.computerSlot === 'white') state.slots.white = true;
    return state;
}

function wrapStateGetter(self, name) {
    if (typeof self[name] !== 'function') return;
    const orig = self[name].bind(self);
    self[name] = function (...args) {
        return enrichState(self, orig(...args));
    };
}

function releaseSessionToPool(session) {
    if (!session) return;
    releaseKatagoSession(session).catch((err) => {
        console.warn('KataGo 归还失败，销毁进程', err && err.message ? err.message : err);
        try { session.destroy(); } catch (_) { /* ignore */ }
    });
}

function clearKatagoHibernateTimer(self) {
    if (self && self._qiKatagoHibernateTimer) {
        clearTimeout(self._qiKatagoHibernateTimer);
        self._qiKatagoHibernateTimer = null;
    }
}

/** 有引擎绑定时，刷新「10 分钟无落子则休眠」计时 */
function touchKatagoActivity(self) {
    clearKatagoHibernateTimer(self);
    if (!self || !self.computerSlot || self.gameOver || !self.matchStarted) return;
    if (!self._qiKatago || self._qiKatago.dead) return;
    self._qiKatagoHibernateTimer = setTimeout(() => {
        self._qiKatagoHibernateTimer = null;
        hibernateKatago(self);
    }, KATAGO_HIBERNATE_MS);
    if (typeof self._qiKatagoHibernateTimer.unref === 'function') {
        self._qiKatagoHibernateTimer.unref();
    }
}

/**
 * 长时间无落子：引擎归还空闲池，对局保留；用户再落子时按 acquire 逻辑唤醒。
 */
function hibernateKatago(self) {
    if (!self || !self.computerSlot || self.gameOver) return;
    const session = self._qiKatago;
    if (!session) return;
    console.log(`[katago:${self.room && self.room.gameType}] 对局超过 ${KATAGO_HIBERNATE_MS / 60000} 分钟无落子，引擎转入空闲`);
    self._qiKatagoGen = (self._qiKatagoGen || 0) + 1;
    self._qiKatagoBusy = false;
    self._qiKatago = null;
    clearKatagoHibernateTimer(self);
    releaseSessionToPool(session);
}

function notifyKatagoBusy(ws, err) {
    const message = (err && isKatagoBusyError(err) && err.message)
        ? err.message
        : KATAGO_BUSY_MESSAGE;
    if (ws) {
        try { ws.send(JSON.stringify({ type: 'error', message })); } catch (_) { /* ignore */ }
    }
}

/**
 * 取消/回收「点击与电脑对战后」预取的引擎。
 * 注意：不可把 _qiKatagoPreparePromise 置空——否则关窗再开会立刻第二次 acquire，
 * 与尚未进池的第一次进程叠加，小机器会被两个已加载模型打满。
 */
function releasePreparedKatago(self) {
    self._qiKatagoPrepareGen = (self._qiKatagoPrepareGen || 0) + 1;
    const prepared = self._qiKatagoPrepared;
    self._qiKatagoPrepared = null;
    if (prepared) releaseSessionToPool(prepared);
}

function stopKatago(self) {
    self._qiKatagoGen = (self._qiKatagoGen || 0) + 1;
    self._qiKatagoBusy = false;
    clearKatagoHibernateTimer(self);
    const session = self._qiKatago;
    self._qiKatago = null;
    if (session) releaseSessionToPool(session);
    releasePreparedKatago(self);
}

/**
 * 用户打开「与电脑对战」设置时预取引擎（创建或复用热池），与设置窗并行。
 * @param {object} self
 * @param {import('ws').WebSocket|null} [ws] 繁忙时用于提示
 */
function prepareKatagoEngine(self, ws) {
    if (!self || !self.katagoAvailable || !isKatagoAvailable(self.room.gameType)) return;
    if (self.matchStarted || self.computerSlot || self.gameOver) return;
    if (self._qiKatagoPrepared && !self._qiKatagoPrepared.dead) return;
    // 进行中的预热（含已取消、正等待归还进池）：勿再开第二条 acquire；
    // 关窗再开时在旧 promise 结束后补一次，才能吃到刚进池的进程。
    if (self._qiKatagoPreparePromise) {
        const pending = self._qiKatagoPreparePromise;
        pending.finally(() => {
            if (self._qiKatagoPreparePromise) return;
            prepareKatagoEngine(self, ws);
        });
        return;
    }

    const gen = (self._qiKatagoPrepareGen = (self._qiKatagoPrepareGen || 0) + 1);
    const prepPromise = acquireKatagoSession(self.room.gameType, {
        boardSize: self.boardSize
    }).then((session) => {
        if (gen !== self._qiKatagoPrepareGen) {
            releaseSessionToPool(session);
            return null;
        }
        self._qiKatagoPrepared = session;
        return session;
    }).catch((err) => {
        if (gen === self._qiKatagoPrepareGen) {
            if (isKatagoBusyError(err)) {
                notifyKatagoBusy(ws, err);
            } else {
                console.error('KataGo 预热失败', err);
                if (ws) {
                    try {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: (err && err.message) || '电脑引擎启动失败。'
                        }));
                    } catch (_) { /* ignore */ }
                }
            }
        }
        return null;
    }).finally(() => {
        if (self._qiKatagoPreparePromise === prepPromise) {
            self._qiKatagoPreparePromise = null;
        }
    });
    self._qiKatagoPreparePromise = prepPromise;
}

/** 人机引擎失败：结束对局并停止继续拉起，避免反复 spawn 打满机器 */
function abortVsComputerOnEngineFailure(self, ws, err) {
    const msgText = isKatagoBusyError(err)
        ? (err.message || KATAGO_BUSY_MESSAGE)
        : '电脑引擎启动失败，已结束与电脑对战。';
    stopKatago(self);
    if (self.computerSlot || self.matchStarted) {
        self.computerSlot = null;
        self.matchStarted = false;
        self.tcSettings = null;
        self.broadcast({ type: 'timeControlReset', reason: 'katagoFailed', ...self.getState() });
    }
    const target = ws || humanWs(self);
    if (target) {
        try { target.send(JSON.stringify({ type: 'error', message: msgText })); } catch (_) { /* ignore */ }
    }
}

function canRequestVsComputer(self, ws) {
    if (!self.katagoAvailable || !isKatagoAvailable(self.room.gameType)) return '该棋类暂不支持与电脑对战。';
    if (self.matchStarted || self.computerSlot || self.gameOver) return '对局已开始。';
    if (Array.isArray(self.moveHistory) && self.moveHistory.length > 0) return '对局已开始。';
    if (self.tcNego) return '请先完成限时协商。';
    const room = self.room;
    const black = room.getPlayerBySlot('black');
    const white = room.getPlayerBySlot('white');
    const seatedCount = (black ? 1 : 0) + (white ? 1 : 0);
    if (seatedCount >= 2) return '房间已满，无法与电脑对战。';
    const mySlot = room.getSlotByWs(ws);
    if (seatedCount === 1 && !mySlot) return '仅入座者可与电脑对战。';
    return null;
}

function humanWs(self) {
    return self.room.getPlayerBySlot('black') || self.room.getPlayerBySlot('white') || null;
}

function slotOccupied(self, slot) {
    return !!(self.room.getPlayerBySlot(slot) || self.computerSlot === slot);
}

function copyMarkers(self, markers) {
    if (typeof self.copyMarkers === 'function') return self.copyMarkers(markers);
    return (markers || []).map((m) => ({ row: m.row, col: m.col, color: m.color }));
}

function copyBoard(self, board) {
    if (typeof self.copyBoard === 'function') return self.copyBoard(board);
    return board.map((row) => row.slice());
}

function boardToString(self, board) {
    if (typeof self.boardToString === 'function') return self.boardToString(board);
    return board.map((row) => row.join(',')).join(';');
}

function applyComputerMove(self, row, col) {
    if (!self.computerSlot || self.gameOver) return false;
    const moveSlot = self.computerSlot;
    if (moveSlot !== (self.currentPlayer === 1 ? 'black' : 'white')) return false;
    const playerVal = self.currentPlayer === 1 ? 1 : 2;
    const newBoard = self.tryPlaceStone(self.board, row, col, playerVal);
    if (!newBoard) return false;
    const newBoardStr = boardToString(self, newBoard);
    if (self.historyBoardSet && self.historyBoardSet.has(newBoardStr)) return false;

    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, newBoard));
    if (self.historyBoardSet) self.historyBoardSet.add(newBoardStr);
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({ type: 'move', player: moveSlot, row, col });
    self.board = newBoard;
    self.lastMoveMarkers = [{ row, col, color: playerVal }];
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = playerVal;
    if ('passCounter' in self) self.passCounter = 0;
    bumpMoveCount(self);
    self.currentPlayer = 3 - self.currentPlayer;
    self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    return true;
}

/**
 * 电脑易位：GTP `ts A B` 两端无序，按当前盘面定向为己方→对方。
 */
function applyComputerSwap(self, aRow, aCol, bRow, bCol) {
    if (!self.computerSlot || self.gameOver) return false;
    if (typeof self.trySwapPiece !== 'function') return false;
    const moveSlot = self.computerSlot;
    if (moveSlot !== (self.currentPlayer === 1 ? 'black' : 'white')) return false;
    if ('maxTranspositionMoves' in self && Number.isFinite(Number(self.moveCount))
        && Number(self.moveCount) >= Number(self.maxTranspositionMoves)) {
        return false;
    }
    const playerVal = self.currentPlayer === 1 ? 1 : 2;
    const board = self.board;
    let fromRow;
    let fromCol;
    let toRow;
    let toCol;
    if (board[aRow] && board[aRow][aCol] === playerVal
        && board[bRow] && board[bRow][bCol] === 3 - playerVal) {
        fromRow = aRow; fromCol = aCol; toRow = bRow; toCol = bCol;
    } else if (board[bRow] && board[bRow][bCol] === playerVal
        && board[aRow] && board[aRow][aCol] === 3 - playerVal) {
        fromRow = bRow; fromCol = bCol; toRow = aRow; toCol = aCol;
    } else {
        return false;
    }
    const newBoard = self.trySwapPiece(board, fromRow, fromCol, toRow, toCol, playerVal);
    if (!newBoard) return false;
    const newBoardStr = boardToString(self, newBoard);
    if (self.historyBoardSet && self.historyBoardSet.has(newBoardStr)) return false;

    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, newBoard));
    if (self.historyBoardSet) self.historyBoardSet.add(newBoardStr);
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) {
        self.moveCoords.push({
            type: 'swap', player: moveSlot,
            fromRow, fromCol, row: toRow, col: toCol
        });
    }
    self.board = newBoard;
    if (newBoard[toRow][toCol] === playerVal) {
        self.lastMoveMarkers = [{ row: toRow, col: toCol, color: playerVal }];
    } else {
        self.lastMoveMarkers = [];
    }
    if ('moveHighlightMarkers' in self) {
        self.moveHighlightMarkers = [
            { row: fromRow, col: fromCol, frameOnly: newBoard[fromRow][fromCol] === 0 },
            { row: toRow, col: toCol, frameOnly: newBoard[toRow][toCol] === 0 }
        ];
    }
    if ('movePlayerColor' in self) self.movePlayerColor = playerVal;
    if ('passCounter' in self) self.passCounter = 0;
    bumpMoveCount(self);
    self.currentPlayer = 3 - self.currentPlayer;
    self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    return true;
}

function startScoreVsComputer(self) {
    const human = humanWs(self);
    if (!human) {
        self.gameOver = true;
        self.broadcast({ type: 'broadcast', action: 'endAgreed', ...self.getState() });
        return;
    }
    if (typeof self.startScoreCounting === 'function') {
        self.startScoreCounting(human, human);
        if (self.pendingScore) self.pendingScore.singlePlayerConfirm = true;
    } else {
        self.gameOver = true;
        self.broadcast({ type: 'broadcast', action: 'endAgreed', ...self.getState() });
    }
}

function applyComputerPass(self) {
    if (!self.computerSlot || self.gameOver) return;
    const moveSlot = self.computerSlot;
    if (moveSlot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;
    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, self.board));
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({ type: 'pass', player: moveSlot });
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = self.currentPlayer;
    bumpMoveCount(self);
    self.currentPlayer = 3 - self.currentPlayer;
    if ('passCounter' in self) self.passCounter = (self.passCounter || 0) + 1;
    self.lastMoveMarkers = [];
    self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
    if ((self.passCounter || 0) >= 2) {
        startScoreVsComputer(self);
        return;
    }
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
}

function maybeScheduleKatago(self) {
    if (!self.computerSlot || self.gameOver || self._qiKatagoBusy || !self.matchStarted) return;
    if (self.pendingScore) return;
    const turnSlot = self.currentPlayer === 1 ? 'black' : 'white';
    if (turnSlot !== self.computerSlot) return;

    const run = async () => {
        try {
            if (!self._qiKatago || self._qiKatago.dead) {
                await ensureKatagoEngine(self);
            }
        } catch (err) {
            console.error('KataGo 唤醒失败', err);
            abortVsComputerOnEngineFailure(self, null, err);
            return;
        }
        if (!self.computerSlot || self.gameOver || self._qiKatagoBusy || !self.matchStarted) return;
        if (self.pendingScore) return;
        if ((self.currentPlayer === 1 ? 'black' : 'white') !== self.computerSlot) return;
        if (!self._qiKatago) return;

        const gen = self._qiKatagoGen;
        self._qiKatagoBusy = true;
        touchKatagoActivity(self);
        self._qiKatago.genMove(self.computerSlot).then((mv) => {
            if (gen !== self._qiKatagoGen || self.gameOver || !self.computerSlot) return;
            if (mv && mv.pass) applyComputerPass(self);
            else if (mv && mv.swap) {
                if (!applyComputerSwap(self, mv.aRow, mv.aCol, mv.bRow, mv.bCol)) {
                    applyComputerPass(self);
                }
            } else if (mv && Number.isInteger(mv.row) && Number.isInteger(mv.col)) {
                if (!applyComputerMove(self, mv.row, mv.col)) applyComputerPass(self);
            } else applyComputerPass(self);
            touchKatagoActivity(self);
        }).catch((err) => {
            console.error('KataGo genmove 失败', err);
            if (gen !== self._qiKatagoGen || self.gameOver) return;
            // 超时杀进程 / 引擎崩溃：结束人机，禁止落子后再拉起
            if (!self._qiKatago || self._qiKatago.dead) {
                abortVsComputerOnEngineFailure(self, null, err);
                return;
            }
            const h = humanWs(self);
            if (h) {
                try { h.send(JSON.stringify({ type: 'error', message: '电脑思考失败，已虚着。' })); } catch (_) { /* ignore */ }
            }
            applyComputerPass(self);
        }).finally(() => {
            if (gen === self._qiKatagoGen) self._qiKatagoBusy = false;
        });
    };
    run();
}

/**
 * 绑定引擎并同步当前局面（开局 / 休眠后唤醒共用）。
 * setup 期间若人类已落子，会按最新盘面再同步一次，避免引擎落后。
 * @param {object} self
 * @param {{ preferPrepared?: boolean }} [opts]
 */
async function ensureKatagoEngine(self, opts) {
    if (self._qiKatago && !self._qiKatago.dead) {
        touchKatagoActivity(self);
        return self._qiKatago;
    }
    if (self._qiKatagoWakePromise) return self._qiKatagoWakePromise;

    const preferPrepared = !opts || opts.preferPrepared !== false;
    const wakePromise = (async () => {
        if (self._qiKatago && !self._qiKatago.dead) {
            touchKatagoActivity(self);
            return self._qiKatago;
        }

        let session = null;
        if (preferPrepared) {
            session = self._qiKatagoPrepared;
            self._qiKatagoPrepared = null;
            const prepPromise = self._qiKatagoPreparePromise;
            // 等预热结束前不要清空 promise，否则并行 prepareVsComputer 会再 spawn 一套
            if (!session && prepPromise) {
                try { session = await prepPromise; } catch (err) {
                    if (isKatagoBusyError(err)) throw err;
                    session = null;
                }
            }
            if (!session) {
                session = self._qiKatagoPrepared;
            } else if (self._qiKatagoPrepared && self._qiKatagoPrepared !== session) {
                releaseSessionToPool(self._qiKatagoPrepared);
            }
            self._qiKatagoPrepared = null;
            self._qiKatagoPrepareGen = (self._qiKatagoPrepareGen || 0) + 1;
            if (self._qiKatagoPreparePromise === prepPromise) {
                self._qiKatagoPreparePromise = null;
            }
        }

        self._qiKatagoGen = (self._qiKatagoGen || 0) + 1;
        self._qiKatagoBusy = false;
        const gen = self._qiKatagoGen;

        if (!session) {
            session = await acquireKatagoSession(self.room.gameType, {
                boardSize: self.boardSize
            });
        }
        if (gen !== self._qiKatagoGen) {
            releaseSessionToPool(session);
            return null;
        }

        // 可能与人类落子并行：setup 后若盘面已变则重同步
        for (let attempt = 0; attempt < 4; attempt++) {
            const snap = typeof self.copyBoard === 'function'
                ? self.copyBoard(self.board)
                : self.board.map((row) => row.slice());
            const snapKey = boardToString(self, snap);
            await session.setupGame(buildKatagoSetupOpts(self, snap));
            if (gen !== self._qiKatagoGen) {
                releaseSessionToPool(session);
                return null;
            }
            if (boardToString(self, self.board) === snapKey) break;
        }

        // 开局同步后再前向一次：把该路数首次推理从「电脑第一手」挪到这里
        // （若预热已是同路数则 primeNn 内部会跳过）
        try {
            await session.primeNn();
        } catch (_) { /* ignore */ }
        if (gen !== self._qiKatagoGen) {
            releaseSessionToPool(session);
            return null;
        }

        self._qiKatago = session;
        touchKatagoActivity(self);
        return session;
    })();

    self._qiKatagoWakePromise = wakePromise;
    try {
        return await wakePromise;
    } finally {
        if (self._qiKatagoWakePromise === wakePromise) self._qiKatagoWakePromise = null;
    }
}

/**
 * 后台拉起引擎（不阻塞人类落子）；就绪后若轮到电脑则 genmove。
 * @param {object} self
 * @param {import('ws').WebSocket|null} [ws]
 * @param {{ preferPrepared?: boolean, abortMatchOnFail?: boolean }} [opts]
 */
function startKatagoEngineInBackground(self, ws, opts) {
    const preferPrepared = !opts || opts.preferPrepared !== false;
    const abortMatchOnFail = !opts || opts.abortMatchOnFail !== false;
    ensureKatagoEngine(self, { preferPrepared }).then(() => {
        maybeScheduleKatago(self);
    }).catch((err) => {
        console.error('启动 KataGo 失败', err);
        if (abortMatchOnFail && self.computerSlot) {
            abortVsComputerOnEngineFailure(self, ws, err);
            return;
        }
        if (isKatagoBusyError(err)) notifyKatagoBusy(ws || humanWs(self), err);
        else if (ws) {
            try { ws.send(JSON.stringify({ type: 'error', message: '电脑引擎启动失败。' })); } catch (_) { /* ignore */ }
        }
    });
}

function handleStartVsComputer(self, ws, msg) {
    const deny = canRequestVsComputer(self, ws);
    if (deny) {
        ws.send(JSON.stringify({ type: 'error', message: deny }));
        return;
    }
    // 引擎进程已满且无空闲可回收：开局前直接拒绝，避免先开局（弹设置/广播开局）再回滚。
    // 本房间已预取成功（_qiKatagoPrepared 不在空闲池中）或预取进行中（_qiKatagoPreparePromise 存在，
    // spawn 名额已占、进程将可用）则视为可取得，不拦截。
    const hasPreparedEngine = !!(self._qiKatagoPrepared && !self._qiKatagoPrepared.dead);
    const preparePending = !!self._qiKatagoPreparePromise;
    if (!hasPreparedEngine && !preparePending && !canAcquireKatagoNow(self.room.gameType)) {
        ws.send(JSON.stringify({ type: 'error', message: KATAGO_BUSY_MESSAGE }));
        return;
    }

    const room = self.room;
    const mySlot = room.getSlotByWs(ws);

    let choice = msg && msg.colorChoice;
    if (choice === 'hostBlack') choice = 'black';
    if (choice === 'hostWhite') choice = 'white';
    if (choice !== 'black' && choice !== 'white' && choice !== 'random') choice = 'black';
    const humanColor = choice === 'random'
        ? (Math.random() < 0.5 ? 'black' : 'white')
        : choice;
    const computerColor = humanColor === 'black' ? 'white' : 'black';

    if (!mySlot) {
        room.setPlayerSlot(ws, humanColor);
        if (typeof self.afterColorAssigned === 'function') self.afterColorAssigned(ws, humanColor);
        ws.send(JSON.stringify({ type: 'colorAssigned', color: humanColor, finalized: true }));
        room.broadcast({ type: 'slotOccupied', slot: humanColor }, ws);
    } else if (mySlot !== humanColor) {
        const other = mySlot === 'black' ? 'white' : 'black';
        if (room.getPlayerBySlot(other)) {
            ws.send(JSON.stringify({ type: 'error', message: '无法调整座位。' }));
            return;
        }
        if (typeof room.reassignPlayerSlot === 'function') {
            room.reassignPlayerSlot(ws, humanColor);
        } else {
            room.slotOccupancy.delete(mySlot);
            room.setPlayerSlot(ws, humanColor);
        }
        if (self.slotJoinedAt) {
            self.slotJoinedAt[mySlot] = null;
            self.slotJoinedAt[humanColor] = Date.now();
        }
        room.broadcast({ type: 'slotReleased', slot: mySlot });
        room.broadcast({ type: 'slotOccupied', slot: humanColor });
        ws.send(JSON.stringify({ type: 'colorAssigned', color: humanColor, finalized: true }));
    }

    // 释放上一局正式引擎；预热进程由 ensure 接手
    const old = self._qiKatago;
    self._qiKatago = null;
    clearKatagoHibernateTimer(self);
    if (old) releaseSessionToPool(old);

    self.computerSlot = computerColor;
    self.tcNego = null;
    self.tcSettings = { timed: false };
    self.tcClock = null;
    self.matchStarted = true;
    room.broadcast({ type: 'slotOccupied', slot: computerColor });

    // 先开局，立刻可落子；KataGo 在后台启动/同步
    self.broadcast({
        type: 'timeControlAgreed',
        settings: self.tcSettings,
        clock: null,
        slots: {
            black: slotOccupied(self, 'black'),
            white: slotOccupied(self, 'white')
        },
        computerSlot: self.computerSlot,
        hostSlot: self.hostWs ? room.getSlotByWs(self.hostWs) : null,
        ...self.getState()
    });

    startKatagoEngineInBackground(self, ws, { preferPrepared: true, abortMatchOnFail: true });
}

function handleHumanPassVsComputer(self, ws, slot) {
    if (!self._timeAllowsPlay || !self._timeAllowsPlay(slot)) {
        if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
        return;
    }
    if (typeof self._drainClockBeforeMove === 'function' && self._drainClockBeforeMove(slot) === false) return;
    if (self.gameOver) return;
    if (!slot || slot !== (self.currentPlayer === 1 ? 'black' : 'white')) return;

    // 先立刻虚着，不因引擎启动阻塞
    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, self.board));
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(slot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({ type: 'pass', player: slot });
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = self.currentPlayer;
    bumpMoveCount(self);
    self.currentPlayer = 3 - self.currentPlayer;
    if ('passCounter' in self) self.passCounter = (self.passCounter || 0) + 1;
    self.lastMoveMarkers = [];
    self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
    if ((self.passCounter || 0) >= 2) {
        startScoreVsComputer(self);
        return;
    }
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    touchKatagoActivity(self);

    if (self._qiKatago && !self._qiKatago.dead) {
        const gen = self._qiKatagoGen;
        self._qiKatago.play(slot, null, null).then(() => {
            if (gen === self._qiKatagoGen) maybeScheduleKatago(self);
        }).catch((err) => console.error('KataGo play pass 失败', err));
        return;
    }
    // 引擎未就绪：后台拉起；失败则结束人机
    startKatagoEngineInBackground(self, ws, { preferPrepared: true, abortMatchOnFail: true });
}

/**
 * @param {object} self room.gameLogic
 * @param {string} gameId
 */
function install(self, gameId) {
    if (!self || self._qiKatagoInstalled) return self;
    self._qiKatagoInstalled = true;
    // 棋种若已自带 computerSlot，只暴露是否有 KataGo，不接管对局
    const hadBuiltinComputer = Object.prototype.hasOwnProperty.call(self, 'computerSlot');
    self.katagoAvailable = isKatagoAvailable(gameId);
    if (!hadBuiltinComputer) self.computerSlot = null;
    self._qiKatago = null;
    self._qiKatagoBusy = false;
    self._qiKatagoGen = 0;
    self._qiKatagoHibernateTimer = null;
    self._qiKatagoWakePromise = null;

    wrapStateGetter(self, 'getState');
    wrapStateGetter(self, 'getInitialState');
    wrapStateGetter(self, 'getStateForClient');

    // 无引擎、非方格围棋、或已有自带电脑逻辑：不接管对局
    if (hadBuiltinComputer || !self.katagoAvailable || !supportsSquareWeiqiGtp(self)) {
        return self;
    }

    const wrapReset = (name) => {
        if (typeof self[name] !== 'function') return;
        const orig = self[name].bind(self);
        self[name] = function (...args) {
            stopKatago(this);
            this.computerSlot = null;
            return orig(...args);
        };
    };
    wrapReset('resetGame');
    wrapReset('resetToEmpty');

    if (typeof self.onPlayerLeave === 'function') {
        const origLeave = self.onPlayerLeave.bind(self);
        self.onPlayerLeave = function (ws) {
            const slot = this.room.getSlotByWs(ws);
            origLeave(ws);
            if (this.computerSlot && slot) {
                stopKatago(this);
                this.computerSlot = null;
            }
            if (this.room.getPlayerCount() === 0) {
                stopKatago(this);
                this.computerSlot = null;
            }
        };
    }

    // 人机数点：同一连接确认一次即可
    if (typeof self.startScoreCounting === 'function') {
        const origScore = self.startScoreCounting.bind(self);
        self.startScoreCounting = function (requester, opponent) {
            origScore(requester, opponent);
            if (this.computerSlot && this.pendingScore && requester === opponent) {
                this.pendingScore.singlePlayerConfirm = true;
            }
        };
    }

    const origHM = typeof self.handleMessage === 'function' ? self.handleMessage.bind(self) : null;
    self.handleMessage = function (ws, msg) {
        if (!msg || !msg.type) return;

        if (msg.type === 'prepareVsComputer') {
            const deny = canRequestVsComputer(this, ws);
            if (deny) {
                try { ws.send(JSON.stringify({ type: 'error', message: deny })); } catch (_) { /* ignore */ }
                return;
            }
            prepareKatagoEngine(this, ws);
            return;
        }

        if (msg.type === 'cancelVsComputerPrepare') {
            // 打开设置后取消：预取进程按空闲归还热池（多余回收、5 分钟超时）
            releasePreparedKatago(this);
            return;
        }

        if (msg.type === 'startVsComputer') {
            handleStartVsComputer(this, ws, msg);
            return;
        }

        if (this.computerSlot) {
            const slot = this.room.getSlotByWs(ws);

            if (msg.type === 'requestNewGame') {
                if (!slot && (this.room.getPlayerBySlot('black') || this.room.getPlayerBySlot('white'))) return;
                if (typeof this.resetGame === 'function') this.resetGame();
                return;
            }

            if (msg.type === 'selectColor' || msg.type === 'takeSeat' || msg.type === 'setBoardSize') {
                return;
            }

            if (msg.type === 'pass') {
                handleHumanPassVsComputer(this, ws, slot);
                return;
            }

            if (msg.type === 'resign') {
                if (origHM) origHM(ws, msg);
                if (this.gameOver) stopKatago(this);
                return;
            }

            if (msg.type === 'requestDraw') {
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = 'draw';
                if (typeof this.onDrawResolved === 'function') this.onDrawResolved();
                stopKatago(this);
                this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                return;
            }

            if (msg.type === 'requestEnd') {
                if (!slot) return;
                startScoreVsComputer(this);
                return;
            }

            if (msg.type === 'scoreResponse') {
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        const need = this.pendingScore.singlePlayerConfirm ? 1 : 2;
                        if (this.pendingScore.agreed.size >= need) {
                            const lead = this.scoreProposalData && this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'black' : (lead < 0 ? 'white' : 'draw');
                            if (typeof this.setScoreResultTextByLead === 'function') this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            if (typeof this._stopClockTicker === 'function') this._stopClockTicker();
                            stopKatago(this);
                        }
                    } else {
                        const tc = getMatchTimeControl();
                        if (this.tcClock && this.tcClock.timed && tc) {
                            tc.setPaused(this.tcClock, false);
                        }
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                        maybeScheduleKatago(this);
                    }
                    return;
                }
            }

            if (msg.type === 'requestUndo') {
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = (this.moveHistory || []).length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > (this.historyBoards || []).length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                if (typeof this.performUndo === 'function') this.performUndo(steps, ws);
                if (this._qiKatago && !this._qiKatago.dead) {
                    touchKatagoActivity(this);
                    // 作废进行中的 play/genmove 回调，避免悔棋后旧着法再写入引擎
                    this._qiKatagoGen += 1;
                    const gen = this._qiKatagoGen;
                    this._qiKatagoBusy = false;
                    const session = this._qiKatago;
                    const boardSnap = typeof this.copyBoard === 'function'
                        ? this.copyBoard(this.board)
                        : this.board.map((row) => row.slice());
                    const syncOpts = buildKatagoSetupOpts(this, boardSnap);
                    // 优先 GTP undo（不必重设洞）；失败再全量 setupGame
                    session.undoMoves(steps).then(() => {
                        if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                    }).catch((undoErr) => {
                        console.warn('KataGo undo 失败，改用全量同步', undoErr && undoErr.message);
                        return session.setupGame(syncOpts).then(() => {
                            if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                        });
                    }).catch((err) => {
                        console.error('KataGo 悔棋同步失败', err);
                    });
                } else {
                    // 休眠中：仅改本地局面；若轮到电脑再按配额唤醒并全量同步
                    maybeScheduleKatago(this);
                }
                return;
            }

            if (msg.type === 'move') {
                if (slot === this.computerSlot) return;
                // 人类落子/易位始终立刻生效，绝不等待 KataGo 启动
                const handsBefore = (this.moveHistory && this.moveHistory.length) || 0;
                if (origHM) origHM(ws, msg);
                if (!(this.moveHistory && this.moveHistory.length > handsBefore)) return;
                touchKatagoActivity(this);

                if (this._qiKatago && !this._qiKatago.dead) {
                    const last = this.moveCoords && this.moveCoords[this.moveCoords.length - 1];
                    const gen = this._qiKatagoGen;
                    if (last && last.type === 'swap') {
                        this._qiKatago.playSwap(
                            slot, last.fromRow, last.fromCol, last.row, last.col
                        ).then(() => {
                            if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                        }).catch((err) => {
                            console.error('KataGo play swap 失败', err);
                            // 易位同步失败时整盘重设，避免引擎落后
                            const session = this._qiKatago;
                            if (!session || session.dead || gen !== this._qiKatagoGen) return;
                            const snap = typeof this.copyBoard === 'function'
                                ? this.copyBoard(this.board)
                                : this.board.map((row) => row.slice());
                            session.setupGame(buildKatagoSetupOpts(this, snap)).then(() => {
                                if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                            }).catch((e2) => console.error('KataGo 易位后重同步失败', e2));
                        });
                    } else if (last && last.type === 'move') {
                        this._qiKatago.play(slot, last.row, last.col).then(() => {
                            if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                        }).catch((err) => console.error('KataGo play 失败', err));
                    } else {
                        maybeScheduleKatago(this);
                    }
                    return;
                }
                // 引擎尚在预热/休眠：后台就绪；失败则结束人机
                startKatagoEngineInBackground(this, ws, { preferPrepared: true, abortMatchOnFail: true });
                return;
            }
        }

        if (origHM) origHM(ws, msg);
    };

    return self;
}

/** 建房后调用：始终写入 available 标记；有引擎且方格围棋则接管人机 */
function attachToRoom(room) {
    if (!room || !room.gameLogic) return;
    install(room.gameLogic, room.gameType);
}

module.exports = {
    install,
    attachToRoom,
    isKatagoAvailable
};
