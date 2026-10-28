'use strict';

/**
 * 公共 KataGo 人机对战：挂到任意方格围棋 Room 上。
 * 不改各棋种 games/*.js；由 qi-server 在 initRoom 后按 katagos/{gameId} 是否齐全自动安装。
 */

const {
    isKatagoAvailable,
    readConfigMaxVisits,
    canAcquireKatagoNow,
    acquireKatagoSession,
    releaseKatagoSession,
    isKatagoBusyError,
    isFixedTopologyEngine,
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

/** 引擎棋类 id：有子棋类（install 时按 getState().subGameId 判定并记录）用子棋类 id，否则主棋类 id */
function engineGameId(self) {
    return (self && self._qiKatagoGameId) || (self && self.room && self.room.gameType) || null;
}

/** 引擎目录 id：**只有**权重围棋家族的三个子棋类（二/三权重、焦点）与主棋类
 *  共用 katagos/weight-weiqi——引擎与模型完全相同，差别只在每点权重（由 kata-set-weights 同步）。
 *  其余带子棋类的棋类（磁性围棋 weak/medium/strong-magnetism-weiqi、非四角围棋的三角族子棋类、
 *  自由围棋 biliberty/quadriliberty/triliberty-weiqi 等）一律各用 katagos/{子棋类id}/ 自己的引擎与模型。 */
function engineDirIdOf(gameId) {
    return isWeightWeiqiEngine(gameId) ? 'weight-weiqi' : gameId;
}

/** 本房间的引擎目录 id */
function engineDirId(self) { return engineDirIdOf(engineGameId(self)); }

/** 引擎棋种（围棋族）座位↔执方：player1 座执黑（先手）、player2 座执白，与棋种 slotFromSide 一致。
 *  座位 id 用于房间 / 棋谱 / 广播，执方名（'black'/'white'）只在与引擎交互时使用。 */
function colorOfSlot(slot) { return slot === 'player2' ? 'white' : 'black'; }

/** 另一座位 */
function otherSlot(slot) { return slot === 'player1' ? 'player2' : 'player1'; }

/** 当前行棋方座位 */
function seatToMove(self) { return self.currentPlayer === 1 ? 'player1' : 'player2'; }

/** 电脑落子/虚着之后的「轮到谁」：棋种自带排程（先一各二围棋：一手可能不换人，本回合走满才换）
 *  就交给它自己重算；没有排程的棋种还是老规矩——一手一换人。 */
function syncTurnAfterComputerAction(self) {
    if (typeof self._syncTurnState === 'function') { self._syncTurnState(); return; }
    self.currentPlayer = 3 - self.currentPlayer;
}

function supportsSquareWeiqiGtp(self) {
    // 普通方格围棋：tryPlaceStone；复合棋子棋种（rus-weiqi）：tryPlaceShape/tryPlaceStonesAt
    const common = !!(self
        && typeof self.boardSize === 'number'
        && Array.isArray(self.board)
        && typeof self.getState === 'function'
        && typeof self.broadcast === 'function');
    if (!common) return false;
    return !!(typeof self.tryPlaceStone === 'function'
        || (typeof self.tryPlaceShape === 'function' && typeof self.tryPlaceStonesAt === 'function'));
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

/**
 * 站点的贴目数值发给引擎时要 **×2**：
 * 站点里 1 点 = 1 子，而 1 子 = 2 目（站点计分本身就是 `黑点数 − 白点数 − 2×komi`，
 * 见 common.js 的 computeNearestWeiqiLead / computeBensonWeiqiLead），KataGo 的 komi 单位是**目**
 * —— 站点 2.75 点（= 2.75 子）= 5.5 目，不 ×2 的话引擎只按一半贴目判断形势。
 * **不 ×2 还会让引擎直接崩**：引擎（KataGo 核心 invariants，nninputs.cpp 的
 * whiteScoreMeanSqOfScoreGridded）要求终局分数是 0.5 的整数倍，站点贴目都是 0.25 的倍数，
 * 原样下发会得到 .25/.75 的分数 → 触发 `testAssert` → Global::fatalError → quick_exit(1)
 * （2026-10-01 吃子围棋 9 路 komi 2.75 的「KataGo 已退出 code=1」就是这条）。×2 后都是半整数。
 *
 * **这是唯一一处换算**：自己构造 setup opts 的棋种（选点围棋的 _buildSetupOpts）也必须用它，
 * 别在棋种里写死 ×2 后的数字。站点贴目从 getState().komi 读（选点围棋也是 2.25 点）。
 */
function engineKomi(self) {
    const k = readKomi(self);
    return Number.isFinite(k) ? Math.round(k * 2 * 1000) / 1000 : k;
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

/** 权重围棋家族子棋类 id（权重/二权重/三权重/焦点）：共用 katagos/weight-weiqi 引擎与模型，
 *  各子棋类只是每点权重不同（kata-set-weights 每局同步）。新增权重系子棋类时在此登记。 */
const WEIGHT_SUB_GAME_IDS = new Set([
    'weight-weiqi', 'biweight-weiqi', 'triweight-weiqi', 'focus-weight-weiqi'
]);
function isWeightWeiqiEngine(id) {
    return typeof id === 'string' && WEIGHT_SUB_GAME_IDS.has(id);
}

/**
 * 每点权重矩阵（[row][col]，与站点盘面同索引）；非权重围棋或无权重时返回 null。
 * 索引方向与引擎一致：站点 row r → GTP 顶点行号（路数 − r）→ 引擎内部 y = r
 * （引擎 `Location::tryOfString` 做 `y = y_size − 行号`，`Board::setWeights` 读 `rawWeights[y*x + x]`；
 *  `showboard` 也是 `y` 升序打印、行号 `y_size − y`），故权重与棋子同向、无需翻转。
 */
function readWeights(self) {
    if (!isWeightWeiqiEngine(engineGameId(self))) return null;
    const w = self && self.weights;
    const size = Number(self && self.boardSize);
    if (!Array.isArray(w) || !Number.isFinite(size) || w.length !== size) return null;
    if (!Array.isArray(w[0]) || w[0].length !== size) return null;
    return w;
}

/**
 * 权重下发：**原样下发，不做任何整形**。口径已对引擎源码逐行核实（2026-09），别再往回加：
 *  1) `weightExponent` 只在自对弈路径存在——`program/play.cpp:128` 解析（键缺失时默认 1.0），
 *     只在 `WeightWeiqi::placeRandomWeights`（`game/weightweiqi.cpp:79-82`）套用 `pow`，
 *     而该函数唯一调用点是 `play.cpp:611`（自对弈开局生成棋局）。GTP 侧根本不读它。
 *  2) `kata-set-weights` → `setWeightsOnBoard`（`command/gtp.cpp:672`）→ `Board::setWeights`
 *     （`game/board.cpp:665`）只做非负校验 + 除以均值归一化，**没有任何指数**。
 *  3) 对弈/分析时口径恒为 1：喂什么就是什么（只被均值归一化）。实测亦如此：
 *     下发 1..361 的排列 → 回读归一化最大 1.9945（= 361/181）。
 *  4) 训练用指数 1 + uniform mix 时，训练那组权重是 `2(i+1)/N`（i=0..N²-1）即 1..N² 的一个
 *     排列乘以 2/N，归一化后与站点下发的「1..N² 的排列」**逐值相同** ⇒ 原样下发就是训练口径。
 *  5) 若将来要 A/B 别的口径，用 `probe-weight-convention.js`（可分别喂原始/整形权重对比策略），
 *     不要在站点侧偷偷整形——那会让线上输入偏离训练与本站计分口径。
 * @returns {number[][]} 下发的权重矩阵（原引用，调用方不得修改）
 */
function weightsForEngine(weights) {
    return weights;
}

function buildKatagoBoardOpts(self) {
    const opts = { boardSize: self.boardSize };
    if (self.katagoBoardWidth && self.katagoBoardHeight) {
        opts.boardWidth = self.katagoBoardWidth;
        opts.boardHeight = self.katagoBoardHeight;
    }
    if (engineDirId(self) === 'twisted-space-weiqi') {
        opts.boardWidth = 2 * self.boardSize - 1;
        opts.boardHeight = self.boardSize;
    }
    return opts;
}

function buildKatagoSetupOpts(self, board) {
    const opts = {
        ...buildKatagoBoardOpts(self),
        komi: engineKomi(self),
        board,
        gameId: engineGameId(self),
        // 与 board 同一时刻的着法表长度：自检用它推算引擎着法史应有的手数（见 verifyEngineState）
        moveCount: Array.isArray(self.moveCoords) ? self.moveCoords.length : 0
    };
    if (engineDirId(self) === 'twisted-space-weiqi') {
        if (!Array.isArray(self.cellNumbers)) throw new Error('Twist-space cell numbers are missing');
        opts.cellNumbers = self.cellNumbers.map(row => row.slice());
    }
    // 坐标系不同的棋盘（六角围棋：引擎是 4n−5×4n−4 的蜂窝细格，站点是显示网格）：
    // 由棋种给出双向换算，会话在 set_position/play/genmove 时套用
    if (typeof self.katagoCoordOf === 'function' && typeof self.katagoIndexAt === 'function') {
        opts.coordOf = (r, c) => self.katagoCoordOf(r, c);
        opts.coordInverse = (row, col) => self.katagoIndexAt(row, col);
    }
    const remain = readRemainingTranslocationMoves(self);
    if (remain != null) opts.maxTranslocationMoves = remain;
    // 权重围棋：把每点权重同步给引擎（kata-set-weights），否则引擎按均权（普通围棋）判断。
    // 原样下发：口径与训练、本站计分一致（见 weightsForEngine 的注释）。
    const weights = readWeights(self);
    if (weights) {
        opts.weights = weightsForEngine(weights);
    } else if (isWeightWeiqiEngine(engineGameId(self))) {
        // 权重局却拿不到权重矩阵 = 引擎按均权下棋（棋力会明显崩塌），必须显式告警
        console.warn(`[katago:${engineGameId(self)}] 权重局未取得 self.weights（缺失或尺寸不符），本次同步不含权重`);
    }
    // 整段着法重放（棋种声明 katagoReplayHistory）：set_position 会清空引擎的对局历史——位置超级劫
    // （禁全同）、重复局面罚分、虚着计数全丢，于是引擎可能提议一步重复局面的着法（最典型：刚同步完
    // 就想把上一手易位换回来），被网站判禁全同后改成虚着。把整段着法一手手重放回去即可还原，
    // 且行棋方由重放自然得出（不再需要下面的 lastMove 翻转），配额此时该发**绝对上限**（引擎历史手数完整）。
    // 只能声明在「状态 = 开局盘面 + 着法表」的棋种上：洞/桥/雷/中立等特殊格只有 set_position 能发。
    const replayHistory = buildReplayHistory(self);
    if (replayHistory) {
        opts.initialBoard = typeof self.copyBoard === 'function'
            ? self.copyBoard(self.openingBoard)
            : self.openingBoard.map((r) => r.slice());
        opts.replayHistory = replayHistory;
        if ('maxTranspositionMoves' in self && Number.isFinite(Number(self.maxTranspositionMoves))) {
            opts.maxTranslocationMoves = Math.max(0, Number(self.maxTranspositionMoves) | 0);
        }
        // 不 return：下面仍照常备好 opts.lastMove —— 重放成功时用不到它，重放失败退回快照同步时
        // 还靠它把引擎行棋方翻正（否则退回后轮到白会被引擎拒绝）。
    }

    // set_position 后引擎行棋方（presumedNextMovePla）恒为黑；当前轮到白（player2 座）时，
    // 去掉最后一手再同步、重放最后一手来翻转行棋方，否则 genmove 会被引擎拒绝
    const nextSlot = seatToMove(self);
    const mcs = Array.isArray(self.moveCoords) ? self.moveCoords : [];
    const last = mcs.length ? mcs[mcs.length - 1] : null;
    if (nextSlot === 'player2' && last && (last.player === 'player1' || last.player === 'player2')) {
        // 棋谱 player 为座位 id，引擎只认 'black'/'white'
        const lastColor = colorOfSlot(last.player);
        if (last.type === 'move' && Number.isInteger(last.shapeIndex) && Number.isInteger(last.row) && Number.isInteger(last.col)) {
            opts.lastMove = {
                player: lastColor,
                row: last.row,
                col: last.col,
                shapeIndex: last.shapeIndex,
                orientIdx: compoundOrientToEngine(last.shapeIndex, last.rotation, last.flipped),
                stones: Array.isArray(last.stones) ? last.stones : null
            };
        } else if (last.type === 'move' && Number.isInteger(last.row) && Number.isInteger(last.col)) {
            opts.lastMove = { player: lastColor, row: last.row, col: last.col, shapeIndex: null, stones: null };
        } else if (last.type === 'swap' && Number.isInteger(last.fromRow) && Number.isInteger(last.fromCol)
            && Number.isInteger(last.row) && Number.isInteger(last.col)) {
            // 易位围棋：最后一手是易位同样要重放（`play B ts A B`），否则引擎行棋方停在黑，
            // 随后 genmove 白会触发 AsyncBot::genMoveAsync 的 setPlayerAndClearHistory →
            // `BoardHistory::clear()` 把**着法史**清空（禁全同知识、重复局面罚分、v17 的两个相位特征全丢）。
            // 注：2026-09-27 重构后的引擎里 clear() 已不再清 maxTranslocationMoves（相位还在），
            // 但丢历史这一条照旧 —— 所以「对齐行棋方、让引擎走上 setPlayerIfNew」这个做法仍然必要。
            opts.lastMove = {
                player: lastColor, type: 'swap',
                fromRow: last.fromRow, fromCol: last.fromCol, row: last.row, col: last.col
            };
        } else if (last.type === 'pass') {
            opts.lastMove = { player: lastColor, type: 'pass' };
        }
    }
    // 引擎判 canTranslocate 用的是 `moveHistory.size() < maxTranslocationMoves`（boardhistory.cpp），
    // 而「重放的那一手」在 set_position（历史清零）之后也会占掉一手历史：重放后 size=1。
    // 所以重放了最后一手就要把配额补 1，否则电脑执白时引擎比网站少算一手，
    // 网站上允许易位的最后那一手会被引擎拒绝（人机对局的最后一手易位白丢）。
    // 重放同步时上面已发绝对上限（引擎历史手数完整），这一条只用于「整盘快照 + 末手重放」那条路
    if (remain != null && opts.lastMove && !opts.replayHistory) opts.maxTranslocationMoves = remain + 1;
    return opts;
}

/**
 * 着法表条目 → 引擎重放条目（`{ type:'move'|'swap'|'compound'|'pass', color:'black'|'white', … }`）。
 * 引擎只认 black/white；不支持/信息不全的条目返回 null（调用方据此放弃重放、退回整盘快照同步）。
 */
function replayEntryOf(m) {
    if (!m || (m.player !== 'player1' && m.player !== 'player2')) return null;
    const color = colorOfSlot(m.player);
    if (m.type === 'pass') return { type: 'pass', color };
    if (m.type === 'swap' && Number.isInteger(m.fromRow) && Number.isInteger(m.fromCol)
        && Number.isInteger(m.row) && Number.isInteger(m.col)) {
        return { type: 'swap', color, fromRow: m.fromRow, fromCol: m.fromCol, row: m.row, col: m.col };
    }
    if (m.type === 'move' && Number.isInteger(m.row) && Number.isInteger(m.col)) {
        if (Number.isInteger(m.shapeIndex)) {
            return {
                type: 'compound', color, row: m.row, col: m.col,
                shapeIndex: m.shapeIndex,
                orientIdx: compoundOrientToEngine(m.shapeIndex, m.rotation, m.flipped)
            };
        }
        return { type: 'move', color, row: m.row, col: m.col };
    }
    return null;
}

/** 把整段着法历史交给引擎重放（见 buildKatagoSetupOpts 的注释）。
 *  **默认开**：凡是「状态 = 开局盘面 + 着法表」的棋种都能重放；中局还有别的变化的棋种
 *  （如埋雷围棋：雷是中局埋的、还能补埋，着法表里是 `mineHit`/`holeReveal` 这类条目）
 *  显式声明 `this.katagoReplayHistory = false` 退出，回到整盘快照同步。
 *  返回 null 表示不能重放（显式退出 / 开局盘面缺失 / 着法表里有引擎不认识的条目）。 */
function buildReplayHistory(self) {
    if (!self || self.katagoReplayHistory === false) return null;
    if (!Array.isArray(self.openingBoard)) return null;
    const mcs = Array.isArray(self.moveCoords) ? self.moveCoords : [];
    if (!mcs.length) return null;
    const entries = [];
    for (const m of mcs) {
        const e = replayEntryOf(m);
        if (!e) {
            console.warn(`[katago:${engineGameId(self)}] 着法表含无法重放的条目（type=${m && m.type}），本次仍用整盘快照同步`);
            return null;
        }
        entries.push(e);
    }
    return entries;
}

function bumpMoveCount(self) {
    if ('moveCount' in self && Number.isFinite(Number(self.moveCount))) {
        self.moveCount = (Number(self.moveCount) | 0) + 1;
    }
}

function enrichState(self, state) {
    if (!state || typeof state !== 'object') return state;
    // 子棋类统一规则：每次 getState 时按当前 subGameId 动态重检引擎 id——
    // 磁性围棋等切换子棋类（weak/medium/strong）后自动换到对应引擎（katagos/{子棋类id}/），
    // 无需为每个棋种单独修改
    if (self._qiKatagoInstalled) {
        // 与 install 一致：getState 广播 subGameId（如 weak-magnetism-weiqi）→ 实例属性 subGameId → 棋类 id
        const sub = state.subGameId;
        const curId = (typeof sub === 'string' && sub.trim()) ? sub.trim()
            : (typeof self.subGameId === 'string' && self.subGameId.trim() ? self.subGameId.trim() : (self.room && self.room.gameType));
        if (curId && curId !== self._qiKatagoGameId) {
            self._qiKatagoGameId = curId;
            self.katagoAvailable = isKatagoAvailable(engineDirIdOf(curId));
            stopKatago(self);   // 旧 id 的引擎会话停掉——下次按新 id 拉取
        }
    }
    state.katagoAvailable = !!self.katagoAvailable;
    // 中级仍由配置文件 maxVisits > 1 决定；新手/初级始终可选。
    state.katagoMaxVisits = self.katagoAvailable ? readConfigMaxVisits(engineDirId(self)) : null;
    state.computerSlot = self.computerSlot || null;
    state.aiLevel = self.computerSlot ? (self.aiLevel || 'basic') : null;
    if (!state.slots) state.slots = { player1: false, player2: false };
    if (self.computerSlot === 'player1') state.slots.player1 = true;
    if (self.computerSlot === 'player2') state.slots.player2 = true;
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
    console.log(`[katago:${engineGameId(self)}] 对局超过 ${KATAGO_HIBERNATE_MS / 60000} 分钟无落子，引擎转入空闲`);
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
    self._qiKatagoEndCheck = null;
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
    if (!self || !self.katagoAvailable || !isKatagoAvailable(engineDirId(self))) return;
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
    const prepPromise = acquireKatagoSession(engineDirId(self), buildKatagoBoardOpts(self)).then((session) => {
        if (gen !== self._qiKatagoPrepareGen) {
            releaseSessionToPool(session);
            return null;
        }
        self._qiKatagoPrepared = session;
        // 预热成功后回推一次状态：「与电脑对战」窗口靠它拿到 katagoMaxVisits（棋力档位）。
        // 客户端收到的是带完整状态的消息，不会额外触发别的 UI。
        if (ws && ws.readyState === 1) {
            try {
                ws.send(JSON.stringify({ type: 'gameState', ...self.getState() }));
            } catch (_) { /* ignore */ }
        }
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
    if (!supportsSquareWeiqiGtp(self)) return '该棋类暂不支持与电脑对战。';
    if (!self.katagoAvailable || !isKatagoAvailable(engineDirId(self))) return '该棋类暂不支持与电脑对战。';
    if (self.matchStarted || self.computerSlot || self.gameOver) return '对局已开始。';
    if (Array.isArray(self.moveHistory) && self.moveHistory.length > 0) return '对局已开始。';
    if (self.tcNego) return '请先完成限时协商。';
    const room = self.room;
    const p1 = room.getPlayerBySlot('player1');
    const p2 = room.getPlayerBySlot('player2');
    const seatedCount = (p1 ? 1 : 0) + (p2 ? 1 : 0);
    if (seatedCount >= 2) return '房间已满，无法与电脑对战。';
    const mySlot = room.getSlotByWs(ws);
    if (seatedCount === 1 && !mySlot) return '仅入座者可与电脑对战。';
    return null;
}

function humanWs(self) {
    return self.room.getPlayerBySlot('player1') || self.room.getPlayerBySlot('player2') || null;
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

/** 服务端 (rot, flip) → 引擎 rs 协议 orientIdx（shape 局部 0-7 = rot*2+flip，与引擎
 *   orientIdxToRotFlip 一致）。引擎 canonical 集：shape0 仅 rot0、shape4 仅 rot0/1、
 *   shape1-3 任意 rot —— 与服务端 30 朝向限制相同，局部编号即 canonical，无需全局偏移 */
function compoundOrientToEngine(shapeIdx, rot, flip) {
    return (rot & 3) * 2 + (flip ? 1 : 0);
}

/**
 * 引擎中途死掉（崩溃/被杀）时把**能复现的现场**打进日志：路数、贴目（站点值→引擎值）、
 * 着法表与盘面。引擎是定制版、崩溃通常是「某个局面 + 某个贴目」触发（2026-10-01 capture-weiqi
 * 的 2.75 贴目就是），没有这一份现场就只能猜。
 */
function logEngineCrashPosition(self, err) {
    try {
        const size = Number(self.boardSize) || 0;
        const mm = (Array.isArray(self.moveCoords) ? self.moveCoords : [])
            .map((m) => (m && m.type === 'pass' ? (m.player === 'player1' ? 'Bp' : 'Wp')
                : (m && (m.player === 'player1' ? 'B' : 'W') + m.row + ',' + m.col))).join(' ');
        let pic = '';
        if (Array.isArray(self.board)) {
            for (let r = size - 1; r >= 0; r--) {
                pic += '\n    ' + (Array.isArray(self.board[r]) ? self.board[r]
                    .map((v) => (v === 1 ? 'X' : v === 2 ? 'O' : v === 0 ? '.' : '?')).join(' ') : '');
            }
        }
        console.error(`[katago:${engineGameId(self)}] 引擎死亡现场（原因：${err && err.message ? err.message : err}）`
            + `\n  路数 ${size}、站点贴目 ${readKomi(self)} → 引擎贴目 ${engineKomi(self)}`
            + `\n  着法表 ${mm || '(空)'}\n  盘面（row0 = 最下，X 黑 / O 白）：${pic}`);
    } catch (_) { /* 日志失败不影响对局收尾 */ }
}

function boardToString(self, board) {
    if (typeof self.boardToString === 'function') return self.boardToString(board);
    return board.map((row) => row.join(',')).join(';');
}

function applyComputerMove(self, row, col) {
    if (!self.computerSlot || self.gameOver) return false;
    const moveSlot = self.computerSlot;
    if (moveSlot !== seatToMove(self)) return false;
    const playerVal = self.currentPlayer === 1 ? 1 : 2;
    // 提子判负类棋种（不围棋）：房间用 tryPlaceStoneResult 返回 { newBoard, capturedOpponent }；
    // 其余棋类走标准 tryPlaceStone（返回盘面或 null）
    const hasResultApi = typeof self.tryPlaceStoneResult === 'function';
    const placed = hasResultApi
        ? self.tryPlaceStoneResult(self.board, row, col, playerVal)
        : self.tryPlaceStone(self.board, row, col, playerVal);
    if (!placed) return false;
    const newBoard = hasResultApi ? placed.newBoard : placed;
    if (!newBoard) return false;
    const capturedOpponent = hasResultApi ? !!placed.capturedOpponent : false;
    const newBoardStr = boardToString(self, newBoard);
    if (self.historyBoardSet && self.historyBoardSet.has(newBoardStr)) return false;

    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, newBoard));
    if (self.historyBoardSet) self.historyBoardSet.add(newBoardStr);
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({ type: 'move', player: moveSlot, row, col });
    const prevBoard = self.board;
    self.board = newBoard;
    self.lastMoveMarkers = [{ row, col, color: playerVal }];
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = playerVal;
    if ('passCounter' in self) self.passCounter = 0;
    bumpMoveCount(self);

    // 提子判负（不围棋）：电脑先提子 → 电脑负（与房间人类着法一致：不切换行棋方）
    if (capturedOpponent) {
        self.gameOver = true;
        self.winner = otherSlot(moveSlot);
        if (typeof self.setCaptureLossResultText === 'function') self.setCaptureLossResultText(moveSlot);
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
        if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
        return true;
    }
    // 棋种自带的「落子即终局」判定（吃子围棋：提子即胜 / 自杀即负）——交回棋种自己判，别再在这里漏掉
    if (typeof self.resolveMoveOutcome === 'function'
        && self.resolveMoveOutcome(prevBoard, newBoard, row, col, playerVal, moveSlot) === true) {
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
        if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
        return true;
    }
    syncTurnAfterComputerAction(self);
    // 棋盘走满即终局的棋种（不围棋）：电脑落满最后一子 → 和棋（与房间人类着法一致）
    if (typeof self.isBoardFull === 'function' && self.isBoardFull()) {
        self.gameOver = true;
        self.winner = 'draw';
        if (typeof self.onDrawResolved === 'function') self.onDrawResolved();
        self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
        if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
        return true;
    }
    self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    return true;
}

/** 电脑复合棋子着法：引擎 rs 复合 → 服务端 tryPlaceShape（一次放 3 子：2 己 1 敌） */
function applyComputerCompound(self, mv) {
    if (!self.computerSlot || self.gameOver) return false;
    if (typeof self.tryPlaceShape !== 'function') return false;
    const moveSlot = self.computerSlot;
    if (moveSlot !== seatToMove(self)) return false;
    const playerVal = self.currentPlayer === 1 ? 1 : 2;
    // 引擎 orient → 服务端 (rot, flip)：引擎 rot 可多圈（shape1-3 偏移 4、shape4 偏移 16）——取模 4
    const rot = (mv.orientIdx >> 1) % 4;
    const flipped = (mv.orientIdx & 1) === 1;
    const newBoard = self.tryPlaceShape(self.board, mv.shapeIdx, rot, flipped, mv.anchorRow, mv.anchorCol, playerVal);
    if (!newBoard) return false;
    const newBoardStr = boardToString(self, newBoard);
    if (self.historyBoardSet && self.historyBoardSet.has(newBoardStr)) return false;

    const coords = (typeof self.generatePlacementCoords === 'function')
        ? self.generatePlacementCoords(mv.shapeIdx, rot, flipped, mv.anchorRow, mv.anchorCol)
        : null;
    const owners = (self.SHAPE_STONE_OWNERS || ['self', 'opp', 'self']);
    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, newBoard));
    if (self.historyBoardSet) self.historyBoardSet.add(newBoardStr);
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({
        type: 'move',
        player: moveSlot,
        shapeIndex: mv.shapeIdx,
        rotation: rot,
        flipped,
        row: mv.anchorRow,
        col: mv.anchorCol,
        stones: coords,
        stoneOwners: [...owners]
    });
    self.board = newBoard;
    self.lastMoveMarkers = (coords || []).map(([r, c], i) => ({
        row: r, col: c, color: owners[i] === 'opp' ? (3 - playerVal) : playerVal
    }));
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = playerVal;
    if ('passCounter' in self) self.passCounter = 0;
    bumpMoveCount(self);
    syncTurnAfterComputerAction(self);
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
    if (moveSlot !== seatToMove(self)) return false;
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
    syncTurnAfterComputerAction(self);
    self.broadcast({ type: 'broadcast', action: 'move', ...self.getState() });
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    return true;
}

async function requestRatedEnd(self, ws) {
    if (self._qiKatagoEndCheck) return;
    if (self._qiKatagoBusy) {
        ws.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
        return;
    }
    const token = {};
    self._qiKatagoEndCheck = token;
    const boardKey = boardToString(self, self.board);
    const moves = (self.moveHistory || []).length;
    const turn = seatToMove(self);
    const positionUnchanged = () => moves === (self.moveHistory || []).length
        && turn === seatToMove(self) && boardKey === boardToString(self, self.board);
    let isCurrent = () => self._qiKatagoEndCheck === token && !self.gameOver && humanWs(self) === ws && ws.readyState === 1;
    try {
        const session = await ensureKatagoEngine(self);
        if (!session || !isCurrent()) return;
        const gen = self._qiKatagoGen;
        const active = isCurrent;
        isCurrent = () => active() && gen === self._qiKatagoGen && self._qiKatago === session;
        // 查询实际行棋方，避免切换引擎行棋方而清掉禁全同历史。
        const accepted = await session.canEndGame(colorOfSlot(turn), { isCurrent, canSearch: positionUnchanged });
        if (!isCurrent()) return;
        if (!positionUnchanged()) {
            ws.send(JSON.stringify({ type: 'error', message: '局面已变化，请重新申请终局。' }));
        } else if (accepted) startScoreVsComputer(self);
        else ws.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
    } catch (err) {
        if (isCurrent()) {
            console.warn('KataGo 终局判断失败', err && err.message);
            ws.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
        }
    } finally {
        if (self._qiKatagoEndCheck === token) {
            self._qiKatagoEndCheck = null;
            maybeScheduleKatago(self);
        }
    }
}

function startScoreVsComputer(self) {
    stopKatago(self);
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

/**
 * 电脑「回退虚着」留痕（只记非引擎本意的虚着；引擎自己选择虚着是正常的，不记）。
 * 回退虚着说明服务端落不了引擎给的着手——通常意味着引擎内部局面已与服务端漂移
 * （genmove 会先把着手落进引擎自己的盘面），是「下着下着完全乱下」的形态之一。
 * 线索：正常局面模型虚着概率仅 ~5e-5（实测），所以连虚几乎不会是引擎本意。
 * @param {string} reason 回退原因（写进日志）
 */
function logComputerPassFallback(self, reason, detail) {
    const moves = Array.isArray(self.moveCoords) ? self.moveCoords.length : 0;
    let d;
    if (typeof detail === 'string') d = detail;
    else if (detail instanceof Error) d = detail.message;          // JSON.stringify(Error) 会是 "{}"，别丢原因
    else {
        try { d = JSON.stringify(detail); } catch (_) { d = String(detail); }
    }
    console.warn(`[katago:${engineGameId(self)}] 电脑回退虚着（${reason}，手数 ${moves}）：${d == null ? String(detail) : String(d).slice(0, 160)}`);
}

function applyComputerPass(self) {
    if (!self.computerSlot || self.gameOver) return;
    const moveSlot = self.computerSlot;
    if (moveSlot !== seatToMove(self)) return;
    // 不允许虚着的棋种（不围棋）：棋盘走满 → 和棋；其它情况虚着 → 电脑判负
    if (typeof self.passIsIllegal === 'function' && self.passIsIllegal()) {
        if (typeof self.isBoardFull === 'function' && self.isBoardFull()) {
            self.gameOver = true;
            self.winner = 'draw';
            if (typeof self.onDrawResolved === 'function') self.onDrawResolved();
        } else {
            self.gameOver = true;
            self.winner = otherSlot(moveSlot);
            if (typeof self.setPassLossResultText === 'function') self.setPassLossResultText(moveSlot);
        }
        self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
        if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
        return;
    }
    // 棋种自带虚着实现（先一各二围棋：虚着＝本回合剩下的一并虚掉、连两个「整回合虚着」才数点）：
    // 交给棋种自己走一遍——写历史/换手/判终局/广播都在它里面，别在这里另写一份规则。
    if (typeof self._resolvePass === 'function') {
        self._resolvePass(moveSlot);
        return;
    }
    if (Array.isArray(self.historyBoards)) self.historyBoards.push(copyBoard(self, self.board));
    if (Array.isArray(self.historyMarkers)) self.historyMarkers.push(copyMarkers(self, self.lastMoveMarkers));
    if (Array.isArray(self.moveHistory)) self.moveHistory.push(moveSlot);
    if (Array.isArray(self.moveCoords)) self.moveCoords.push({ type: 'pass', player: moveSlot });
    if ('moveHighlightMarkers' in self) self.moveHighlightMarkers = [];
    if ('movePlayerColor' in self) self.movePlayerColor = self.currentPlayer;
    bumpMoveCount(self);
    syncTurnAfterComputerAction(self);
    if ('passCounter' in self) self.passCounter = (self.passCounter || 0) + 1;
    self.lastMoveMarkers = [];
    self.broadcast({ type: 'broadcast', action: 'pass', ...self.getState() });
    if ((self.passCounter || 0) >= 2) {
        self.passCounter = 0;   // 数点后重新计数（无论同意与否）
        startScoreVsComputer(self);
        return;
    }
    if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
}

/** 最近几手的简写（自检报错时贴出来，一眼看出是哪一手之后开始不同步） */
function describeRecentMoves(self, n) {
    const mc = Array.isArray(self.moveCoords) ? self.moveCoords : [];
    const start = Math.max(0, mc.length - (n || 6));
    const out = [];
    for (let i = start; i < mc.length; i++) {
        const m = mc[i] || {};
        const at = Number.isInteger(m.row) && Number.isInteger(m.col) ? `(${m.row},${m.col})` : '';
        const from = m.type === 'swap' && Number.isInteger(m.fromRow) ? `自(${m.fromRow},${m.fromCol})` : '';
        out.push(`#${i + 1}${m.player ? ' ' + m.player : ''} ${m.type || '?'}${from}${at}`);
    }
    return out.join('；');
}

/** 权重回读的抽样间隔（手）：权重只在 setupGame 里下发并回读校验，中途抽查是防「莫名丢失」的保险 */
const WEIGHT_PROBE_EVERY = 5;
function isWeightProbeDue(moveCount) { return moveCount > 0 && moveCount % WEIGHT_PROBE_EVERY === 0; }

// 易位配额回读抽样：配额只该在同步时变（每局固定），但中途被清/被改就是引擎跟着网站规则跑偏的信号
const TRANSLOC_PROBE_EVERY = 5;
function isTranslocProbeDue(moveCount) { return moveCount > 0 && moveCount % TRANSLOC_PROBE_EVERY === 0; }

/** 权重矩阵（站点 row 序）按站点→引擎的展开顺序拍平（与 setupGame 下发的顺序一致） */
function flattenWeightsForEngine(self, weights, width, height) {
    const flat = [];
    for (let r = 0; r < height; r++) {
        const row = Array.isArray(weights[r]) ? weights[r] : [];
        for (let c = 0; c < width; c++) {
            const v = Number(row[c]);
            flat.push(Number.isFinite(v) ? v : 0);
        }
    }
    return flat;
}

/**
 * 引擎状态自检（每一手之后都做）：引擎内部的盘面、行棋方、权重必须与服务端一致。
 * 不一致 = 引擎局面已漂移（此后 genmove 都基于错误局面，表现就是「下着下着完全乱下」
 * 或「突然只有入门水平」）。漂移来源例如：某一手没同步成功（play 失败被吞、着法类型
 * 未识别、引擎提议的着法服务端落不下去而改成虚着、undo 步数不匹配…）；权重局里
 * 「引擎手里没有这一局的权重」会让它按普通围棋下（分数全错），也是同一种表现。
 * 发现不一致 → 记日志（含最近几手与触发点）+ 全量重同步（用服务端盘面与权重重建）。
 * 纯文本回读（showboard / kata-get-weights），不做推理，每手调用开销可忽略。
 * @param {string} trigger 触发点说明（写进日志，便于定位是哪条路径之后不同步的）
 */
async function verifyEngineState(self, session, gen, trigger) {
    if (!session || session.dead || typeof session.probeBoard !== 'function') return;
    if (gen !== self._qiKatagoGen || session !== self._qiKatago) return;
    const size = Number(self.boardSize);
    const width = Number(self.katagoBoardWidth) || size;
    const height = Number(self.katagoBoardHeight) || size;
    let probed = null;
    try {
        probed = await session.probeBoard(height, width);
    } catch (_) {
        return;
    }
    if (!probed) return;   // 不支持的引擎/特殊格棋盘：无法比对
    if (gen !== self._qiKatagoGen || session !== self._qiKatago || self.gameOver) return;

    // 站点盘面 = probed.stones 的比对：坐标系不同的棋盘（六角）要先把站点格换算成引擎格
    const coordOf = (typeof self.katagoCoordOf === 'function') ? self.katagoCoordOf.bind(self) : null;
    const bridgeEngine = engineGameId(self) === 'bridge-weiqi';
    const holeEngine = engineGameId(self) === 'hole-weiqi';
    const fixedTopologyEngine = isFixedTopologyEngine(engineGameId(self));
    let stoneDiff = 0;
    let firstStoneDiff = null;
    for (let r = 0; r < (self.board ? self.board.length : 0) && stoneDiff === 0; r++) {
        const row = Array.isArray(self.board[r]) ? self.board[r] : [];
        for (let c = 0; c < row.length; c++) {
            let mine = row[c] === 1 || row[c] === 2 ? row[c] : 0;
            // placeBridges / placeHoles 将站点的桥 -2 / 洞 -1 存成 C_WALL，
            // showboard 打印为 '#'（回读哨兵 -9）。按对应棋种转换后仍逐点核对位置，
            // 避免把结构格当空点而每手误报，也不能跳过它们而漏报真正的拓扑差异。
            if ((bridgeEngine && row[c] === -2) || (holeEngine && row[c] === -1)) mine = -9;
            // 固定拓扑引擎（开罗五角 / 扭棱四角 / 六角 / 扭转空间）：棋盘上不存在的格点在
            // 站点盘面里是 -1，而引擎按 boardsize 自行把它们标成 C_WALL，showboard 同样是 '#'
            // （-9）。不换算成同一口径的话，自检会把「结构墙 vs 空点」当成棋子差异，
            // 从第 0 手起每一手都误报「棋盘有差异」并触发一次无谓的全量重同步
            // （2026-10 开罗/扭棱人机对战刷屏的就是这个）。六角盘多走下面的 coordOf 换算，
            // 不在引擎盘面上的站点格仍由 `if (!e) continue` 跳过，不受影响。
            if (fixedTopologyEngine && row[c] === -1) mine = -9;
            let er = r; let ec = c;
            if (coordOf) {
                const e = coordOf(r, c);
                if (!e) continue;                 // 不属于引擎盘面的格（掩码外）：跳过
                er = e.row; ec = e.col;
            } else if (r >= height || c >= width) {
                continue;
            }
            const line = probed.stones[er];
            if (!line || ec >= line.length) continue;
            // -9 = 蜂窝外的墙（六角）：站点实点映到墙上说明坐标映射错了，按不一致处理
            if (line[ec] !== mine) {
                stoneDiff += 1;
                firstStoneDiff = `首处 (${er},${ec}) 站点=${mine === -9 ? '#' : mine} 引擎=${line[ec] === -9 ? '#' : line[ec]}`;
                break;
            }
        }
    }
    const expectPla = colorOfSlot(seatToMove(self));
    const turnDiff = !!probed.nextPlayer && probed.nextPlayer !== expectPla;
    const moveCount = Array.isArray(self.moveCoords) ? self.moveCoords.length : 0;
    const reasons = [];
    if (stoneDiff) reasons.push(`棋盘有差异（${firstStoneDiff}）`);
    if (turnDiff) reasons.push(`行棋方 ${probed.nextPlayer}≠${expectPla}`);

    // 引擎着法史手数（showboard 的 MoveNum = 引擎 BoardHistory::moveHistory.size()，即 set_position 之后
    // 引擎实际收到的着手数）：盘面与行棋方都「看着对」、手数却少了 = 引擎的禁全同/重复局面罚分历史丢了
    // （易位围棋还多两个 NN 相位特征跟着算错），表现就是「引擎一直提议网站判非法/判禁全同的着法 →
    // 被驳回成虚着」。只在**整段重放同步**之后比对：那时网站着法表就是引擎收到的着手序列，逐手一一对应；
    // 快照同步（含 mineHit/holeReveal 这类非着手条目的棋种）不比对，免得误报。
    if (probed.moveNum != null && session.lastSyncReplayed
        && session.lastSyncMoveNum != null && session.lastSyncSiteMoveCount != null) {
        const expected = session.lastSyncMoveNum + (moveCount - session.lastSyncSiteMoveCount);
        if (expected >= 0 && probed.moveNum !== expected) {
            reasons.push(`引擎着法史 ${probed.moveNum}≠${expected}`);
        }
    }

    // 权重局：核对引擎手里的权重还是不是本站点这一局的那组（丢了 = 正按普通围棋下、分数全错）。
    // 权重只可能被 clear_board 作废，而每次 clear_board 之后都会重发并回读校验（见 setupGame），
    // 所以这里按 WEIGHT_PROBE_EVERY 手抽样即可；盘面/行棋方已发现异常时必查（便于一次性定位）。
    if (isWeightWeiqiEngine(engineGameId(self)) && typeof session.probeWeights === 'function'
        && (isWeightProbeDue(moveCount) || reasons.length > 0)) {
        const w = readWeights(self);
        let pw = null;
        try { pw = await session.probeWeights(); } catch (_) { pw = null; }
        if (gen !== self._qiKatagoGen || session !== self._qiKatago) return;
        if (w && pw) {
            const flat = flattenWeightsForEngine(self, w, width, height);
            let am = 0;
            for (let i = 1; i < flat.length; i++) if (flat[i] > flat[am]) am = i;
            if (pw.count !== flat.length) reasons.push(`权重个数 ${pw.count}≠${flat.length}`);
            else if (pw.allEqual) reasons.push('引擎权重全相等（等于没设权重，正按普通围棋下）');
            else if (pw.argmax !== am) reasons.push(`最高权重点 ${pw.argmax}≠${am}`);
        }
        if (pw) self._qiKatagoWeightProbedAt = moveCount;   // 仅供调试观察，不参与判断
    }

    // 易位配额：引擎侧 maxTranslocationMoves 应当等于网站最近一次下发的值（规则权威在网站）。
    // 配额被清/被改 → 引擎会认为「不在易位期」而不肯易位（或反之提议网站判非法的易位），
    // 两种都会让引擎看起来在「乱下/虚着」。非易位引擎没有该命令 → probe 返回 null，跳过。
    if (session.lastTranslocationBudget != null && typeof session.probeTranslocationMax === 'function'
        && (isTranslocProbeDue(moveCount) || reasons.length > 0)) {
        let pm = null;
        try { pm = await session.probeTranslocationMax(); } catch (_) { pm = null; }
        if (gen !== self._qiKatagoGen || session !== self._qiKatago) return;
        if (pm != null && pm !== session.lastTranslocationBudget) {
            reasons.push(`易位配额 ${pm}≠${session.lastTranslocationBudget}`);
        }
        self._qiKatagoBudgetProbedAt = moveCount;   // 仅供调试观察，不参与判断
    }

    if (!reasons.length) return;

    console.warn(`[katago:${engineGameId(self)}] 引擎状态与服务端不一致（触发：${trigger}；`
        + `${reasons.join('、')}`
        + `，手数 ${moveCount}）：全量重同步引擎状态。最近几手：${describeRecentMoves(self, 6)}`);
    try {
        const snap = typeof self.copyBoard === 'function' ? self.copyBoard(self.board) : self.board.map((r) => r.slice());
        await session.setupGame(buildKatagoSetupOpts(self, snap));
    } catch (err) {
        console.error('KataGo 自检后重同步失败', err && err.message ? err.message : err);
    }
}

function maybeScheduleKatago(self) {
    if (!self.computerSlot || self.gameOver || self._qiKatagoBusy || self._qiKatagoEndCheck || !self.matchStarted) return;
    if (!humanWs(self) || humanWs(self).readyState !== 1) return;
    if (self.pendingScore) return;
    const turnSlot = seatToMove(self);
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
        if (!self.computerSlot || self.gameOver || self._qiKatagoBusy || self._qiKatagoEndCheck || !self.matchStarted) return;
        if (!humanWs(self) || humanWs(self).readyState !== 1) return;
        if (self.pendingScore) return;
        if (seatToMove(self) !== self.computerSlot) return;
        if (!self._qiKatago) return;

        const gen = self._qiKatagoGen;
        self._qiKatagoBusy = true;
        touchKatagoActivity(self);
		
        const session = self._qiKatago;
        session.genMove(colorOfSlot(self.computerSlot), {
            confirmPass: self.aiLevel === 'novice',
            isCurrent: () => gen === self._qiKatagoGen && self._qiKatago === session
                && !!humanWs(self) && humanWs(self).readyState === 1
        }).then((mv) => {
            if (gen !== self._qiKatagoGen || self.gameOver || !self.computerSlot) return;
            if (!humanWs(self) || humanWs(self).readyState !== 1) {
                stopKatago(self); // genmove 已改变引擎盘面，续坐时重新同步服务端盘面。
                return;
            }
            if (mv && mv.pass) {
                // 引擎自认输（genmove 返回 resign）：本站约定电脑不认输——会话每次 setup 都发
                // kata-set-param allowResignation false（见 katago-gtp.js 的 disableResignation），
                // 仍出现说明该引擎不认这个参数 / cfg 又开了：留痕（含改哪份配置文件），
                // 行为上按虚着继续对局，不让「引擎自评落后」直接判掉一盘还在下的棋。
                if (mv.resign) {
                    logComputerPassFallback(self, '引擎自认输（genmove 返回 resign）→ 本站按虚着处理',
                        `检查 katagos/${engineDirId(self)}/gtp.cfg 的 allowResignation（应为 false）`);
                }
                applyComputerPass(self);           // 引擎本意虚着：正常，不记日志
            }
            else if (mv && mv.compound) {
                // 复合棋子着法（rus-weiqi 等）：一次落 3 子
                if (!applyComputerCompound(self, mv)) {
                    logComputerPassFallback(self, '复合着法落不下去', mv);
                    applyComputerPass(self);
                }
            } else if (mv && mv.swap) {
                if (!applyComputerSwap(self, mv.aRow, mv.aCol, mv.bRow, mv.bCol)) {
                    logComputerPassFallback(self, '易位落不下去', `ts (${mv.aRow},${mv.aCol}) (${mv.bRow},${mv.bCol})`);
                    applyComputerPass(self);
                }
            } else if (mv && Number.isInteger(mv.row) && Number.isInteger(mv.col)) {
                if (!applyComputerMove(self, mv.row, mv.col)) {
                    logComputerPassFallback(self, '着法落不下去', `引擎提议 (${mv.row},${mv.col})`);
                    applyComputerPass(self);
                }
            } else {
                logComputerPassFallback(self, '引擎响应无法解析', mv);
                applyComputerPass(self);
            }
            touchKatagoActivity(self);
            // 自检：引擎内部状态是否仍与服务端一致（漂移要立刻重同步，否则后续着法会「乱下」）
            verifyEngineState(self, self._qiKatago, gen, '电脑落子').catch(() => { /* ignore */ });
        }).catch((err) => {
            console.error('KataGo genmove 失败', err);
            if (gen !== self._qiKatagoGen || self.gameOver) return;
            if (!humanWs(self) || humanWs(self).readyState !== 1) {
                stopKatago(self);
                return;
            }
            // 超时杀进程 / 引擎崩溃：结束人机，禁止落子后再拉起
            if (!self._qiKatago || self._qiKatago.dead) {
                logEngineCrashPosition(self, err);
                abortVsComputerOnEngineFailure(self, null, err);
                return;
            }
            const h = humanWs(self);
            if (h) {
                try { h.send(JSON.stringify({ type: 'error', message: '电脑思考失败，已虚着。' })); } catch (_) { /* ignore */ }
            }
            logComputerPassFallback(self, '思考失败/超时', err && err.message ? err.message : String(err));
            applyComputerPass(self);
            // 引擎可能已经/没有走子，局面未必与服务端一致：自检并重同步
            verifyEngineState(self, self._qiKatago, gen, '电脑思考失败').catch(() => { /* ignore */ });
        }).finally(() => {
            if (gen === self._qiKatagoGen) self._qiKatagoBusy = false;
            // 一「回合」能连走多手的棋种（先一各二围棋：黑第 1 手之后双方各连走两手）：
            // 电脑走完一手后可能**还是**它走，这里再排一次；普通棋种走完就换人，等于空跑。
            if (gen === self._qiKatagoGen) maybeScheduleKatago(self);
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
            session = await acquireKatagoSession(engineDirId(self), buildKatagoBoardOpts(self));
        }
        if (gen !== self._qiKatagoGen) {
            releaseSessionToPool(session);
            return null;
        }
        // 参数在每次开局/唤醒时设置，不修改 cfg；新手温度不能泄漏到热池的其它对局。
        try {
            await session.setMaxVisits(Number(self.aiVisits) || 1, self.aiLevel === 'novice');
            await session.setNoviceTemperature(self.aiLevel === 'novice');
        } catch (err) {
            session.destroy();
            throw err;
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
        // 刚同步完就核一次：确认盘面/行棋方/权重真的进了引擎（权重没吃下 = 引擎按普通围棋下）
        await verifyEngineState(self, session, gen, '开局/唤醒同步').catch(() => { /* ignore */ });
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
    const pending = ensureKatagoEngine(self, { preferPrepared });
    const generation = self._qiKatagoGen;
    pending.then(() => {
        maybeScheduleKatago(self);
    }).catch((err) => {
        if (generation !== self._qiKatagoGen || !humanWs(self) || humanWs(self).readyState !== 1) return;
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
    if (!hasPreparedEngine && !preparePending && !canAcquireKatagoNow(engineDirId(self))) {
        ws.send(JSON.stringify({ type: 'error', message: KATAGO_BUSY_MESSAGE }));
        return;
    }

    const room = self.room;
    const mySlot = room.getSlotByWs(ws);

    // 执方选项统一折算为座位 id（兼容旧客户端的 black/white/hostBlack/hostWhite）
    let choice = msg && msg.colorChoice;
    if (choice === 'hostBlack' || choice === 'black') choice = 'player1';
    if (choice === 'hostWhite' || choice === 'white') choice = 'player2';
    if (choice !== 'player1' && choice !== 'player2' && choice !== 'random') choice = 'player1';
    const humanSlot = choice === 'random'
        ? (Math.random() < 0.5 ? 'player1' : 'player2')
        : choice;
    const computerSlot = otherSlot(humanSlot);

    if (!mySlot) {
        room.setPlayerSlot(ws, humanSlot);
        if (typeof self.afterColorAssigned === 'function') self.afterColorAssigned(ws, humanSlot);
        ws.send(JSON.stringify({ type: 'colorAssigned', color: humanSlot, finalized: true }));
        room.broadcast({ type: 'slotOccupied', slot: humanSlot }, ws);
    } else if (mySlot !== humanSlot) {
        const other = otherSlot(mySlot);
        if (room.getPlayerBySlot(other)) {
            ws.send(JSON.stringify({ type: 'error', message: '无法调整座位。' }));
            return;
        }
        if (typeof room.reassignPlayerSlot === 'function') {
            room.reassignPlayerSlot(ws, humanSlot);
        } else {
            room.slotOccupancy.delete(mySlot);
            room.setPlayerSlot(ws, humanSlot);
        }
        if (self.slotJoinedAt) {
            self.slotJoinedAt[mySlot] = null;
            self.slotJoinedAt[humanSlot] = Date.now();
        }
        room.broadcast({ type: 'slotReleased', slot: mySlot });
        room.broadcast({ type: 'slotOccupied', slot: humanSlot });
        ws.send(JSON.stringify({ type: 'colorAssigned', color: humanSlot, finalized: true }));
    }

    // 释放上一局正式引擎；预热进程由 ensure 接手
    const old = self._qiKatago;
    self._qiKatago = null;
    clearKatagoHibernateTimer(self);
    if (old) releaseSessionToPool(old);

    self.computerSlot = computerSlot;
    self.friendlyMatch = msg && msg.friendlyMatch === true;
    self._qiRatedUndoCount = 0;
    self.tcNego = null;
    self.tcSettings = { timed: false };
    self.tcClock = null;
    // 让子：人机开局不走 _finalizeTimeControl，这里按对话框传来的让子数摆白子（被让子方执白、黑先）
    require('./common').qiApplyHandicapFromRequest(self, msg && msg.handicap);
    self.friendlyMatch = self.friendlyMatch || require('./common').qiForcedFriendlyMatch(self);
    // 棋力：初级 = 配置文件 maxVisits 1；中级 = 配置文件里的值（配置本身为 1 或没这项时不提供中级）
    {
        const cfgVisits = readConfigMaxVisits(engineDirId(self));
        const useIntermediate = msg && msg.aiLevel === 'intermediate'
            && Number.isFinite(cfgVisits) && cfgVisits > 1;
        self.aiLevel = msg && msg.aiLevel === 'novice' ? 'novice' : useIntermediate ? 'intermediate' : 'basic';
        self.aiVisits = useIntermediate ? cfgVisits : 1;
    }
    self.matchStarted = true;
    room.broadcast({ type: 'slotOccupied', slot: computerSlot });

    // 先开局，立刻可落子；KataGo 在后台启动/同步
    self.broadcast({
        type: 'timeControlAgreed',
        settings: self.tcSettings,
        clock: null,
        slots: {
            player1: slotOccupied(self, 'player1'),
            player2: slotOccupied(self, 'player2')
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
    if (!slot || slot !== seatToMove(self)) return;

    // 先立刻虚着，不因引擎启动阻塞
    const coordsBefore = Array.isArray(self.moveCoords) ? self.moveCoords.length : 0;
    let scoring = false;
    // 棋种自带虚着实现（先一各二围棋：虚着＝本回合剩下的一并虚掉、连两个「整回合虚着」才数点）：
    // 交给棋种自己走一遍——写历史/换手/判终局/数点/广播都在它里面，别在这里另写一份规则。
    if (typeof self._resolvePass === 'function') {
        self._resolvePass(slot);
    } else {
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
            self.passCounter = 0;   // 数点后重新计数（无论同意与否）
            scoring = true;
        }
        if (typeof self._syncClockAfterTurnChange === 'function') self._syncClockAfterTurnChange();
    }
    // 站点一次虚着可能补满整个回合的好几手（先一各二围棋＝1~2 手），**逐笔**喂给引擎：
    // 少喂会让引擎的手数排程（轮次）与站点错开 → 引擎按错误轮次出招、着法全被站点驳回
    const added = (Array.isArray(self.moveCoords) ? self.moveCoords.length : 0) - coordsBefore;
    if (scoring && added <= 0) { startScoreVsComputer(self); return; }
    touchKatagoActivity(self);

    if (self._qiKatago && !self._qiKatago.dead && added > 0) {
        const gen = self._qiKatagoGen;
        const color = colorOfSlot(slot);
        let chain = Promise.resolve();
        for (let i = 0; i < added; i++) chain = chain.then(() => self._qiKatago.play(color, null, null));
        chain.then(() => verifyEngineState(self, self._qiKatago, gen, `人类虚着 ×${added}`)
            .catch(() => { /* ignore */ })
            .then(() => { if (gen === self._qiKatagoGen) maybeScheduleKatago(self); })
        ).catch((err) => {
            console.error('KataGo play pass 失败，改用全量同步', err && err.message ? err.message : err);
            // 虚着没同步进去 → 引擎行棋方会错位，必须整盘重设
            const session = self._qiKatago;
            if (!session || session.dead || gen !== self._qiKatagoGen) return;
            const snap = typeof self.copyBoard === 'function' ? self.copyBoard(self.board) : self.board.map((r) => r.slice());
            session.setupGame(buildKatagoSetupOpts(self, snap)).then(() => {
                if (gen === self._qiKatagoGen) maybeScheduleKatago(self);
            }).catch((e2) => console.error('KataGo 虚着后重同步失败', e2));
        });
        return;
    }
    if (scoring) { startScoreVsComputer(self); return; }
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
    // 子棋类统一解析（多层兜底）：getState().subGameId → 实例属性 subGameId → 传入 gameId
    let resolved = null;
    try {
        const st = typeof self.getState === 'function' ? self.getState() : null;
        if (st && typeof st.subGameId === 'string' && st.subGameId.trim()) resolved = st.subGameId.trim();
    } catch (_) { /* ignore */ }
    if (!resolved && typeof self.subGameId === 'string' && self.subGameId.trim()) resolved = self.subGameId.trim();
    gameId = resolved || gameId;
    self._qiKatagoGameId = gameId;   // 引擎棋类 id（子棋类优先）——引擎检查/获取/setup 统一使用
    // 棋种若已自带 computerSlot，只暴露是否有 KataGo，不接管对局
    const hadBuiltinComputer = Object.prototype.hasOwnProperty.call(self, 'computerSlot');
    self.katagoAvailable = isKatagoAvailable(engineDirIdOf(gameId));
    if (!hadBuiltinComputer) self.computerSlot = null;
    self._qiKatago = null;
    self._qiKatagoBusy = false;
    self._qiKatagoGen = 0;
    self._qiKatagoHibernateTimer = null;
    self._qiKatagoWakePromise = null;

    wrapStateGetter(self, 'getState');
    wrapStateGetter(self, 'getInitialState');
    wrapStateGetter(self, 'getStateForClient');

    // 棋种自带电脑逻辑：只暴露可用性，绝不接管（其余情况一律继续挂包装）
    if (hadBuiltinComputer) {
        return self;
    }
    // 注意：这里**不能**按「当前子棋类有没有引擎」提前返回。
    // 有子棋类的棋种可以在开局前切换子棋类（例如非四角围棋：六角没引擎、扭棱四角有），
    // 提前返回会导致切过去之后既没有消息包装、也不能开局——表现就是按钮不出现（刷新才对）与设置窗卡死。
    // 可用性在收到消息时按当前子棋类重新判定（canRequestVsComputer / prepareKatagoEngine 内）。

    const wrapReset = (name) => {
        if (typeof self[name] !== 'function') return;
        const orig = self[name].bind(self);
        self[name] = function (...args) {
            stopKatago(this);
            this.computerSlot = null;
            this.aiLevel = null;
            this.aiVisits = null;
            this._qiRatedUndoCount = 0;
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
            } else if (this.room.getPlayerCount() === 0) {
                stopKatago(this);
            }
        };
    }

    self.resumeComputerGame = function (ws) {
        if (this.computerSlot && !this.gameOver && this.matchStarted)
            startKatagoEngineInBackground(this, ws, { preferPrepared: false, abortMatchOnFail: false });
    };

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
                if (!slot && (this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2'))) return;
                if (typeof this.resetGame === 'function') this.resetGame();
                return;
            }

            if (msg.type === 'selectColor' || msg.type === 'takeSeat') {
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
                if (!slot || this.gameOver || !this.matchStarted || this.pendingScore) return;
                if (this.friendlyMatch || require('./common').qiForcedFriendlyMatch(this)) startScoreVsComputer(this);
                else requestRatedEnd(this, ws);
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
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
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
                const rated = !this.friendlyMatch && !require('./common').qiForcedFriendlyMatch(this);
                if (rated && (this._qiRatedUndoCount || 0) >= 3) {
                    ws.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                    return;
                }
                let steps = 0;
                // 一「回合」能连走多手的棋种（先一各二围棋）：退到「该方回合开始之前」，由棋种自己算
                if (typeof this._undoStepsToTurnStart === 'function') {
                    steps = this._undoStepsToTurnStart(slot) || 0;
                } else {
                    for (let i = (this.moveHistory || []).length - 1; i >= 0; i--) {
                        steps++;
                        if (this.moveHistory[i] === slot) break;
                    }
                }
                if (steps === 0 || steps > (this.historyBoards || []).length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const beforeUndo = (this.moveHistory || []).length;
                if (typeof this.performUndo === 'function') this.performUndo(steps, ws);
                if ((this.moveHistory || []).length >= beforeUndo) return;
                if (rated) this._qiRatedUndoCount = (this._qiRatedUndoCount || 0) + 1;
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
                    session.undoMoves(steps).then(() => verifyEngineState(this, session, gen, `悔棋 ${steps} 手后`)
                        .catch(() => { /* ignore */ })
                        .then(() => { if (gen === this._qiKatagoGen) maybeScheduleKatago(this); })
                    ).catch((undoErr) => {
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
                            colorOfSlot(slot), last.fromRow, last.fromCol, last.row, last.col
                        ).then(() => verifyEngineState(this, this._qiKatago, gen, '人类易位')
                            .catch(() => { /* ignore */ })
                            .then(() => { if (gen === this._qiKatagoGen) maybeScheduleKatago(this); })
                        ).catch((err) => {
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
                        if (Number.isInteger(last.shapeIndex) && Number.isInteger(last.row) && Number.isInteger(last.col)) {
                            // 复合棋子着法（rus-weiqi）：服务端 rot/flip → 引擎规范 orient
                            const orient = compoundOrientToEngine(last.shapeIndex, last.rotation, last.flipped);
                            this._qiKatago.playCompound(colorOfSlot(slot), last.row, last.col, last.shapeIndex, orient).then(() => verifyEngineState(this, this._qiKatago, gen, '人类复合着法')
                                .catch(() => { /* ignore */ })
                                .then(() => { if (gen === this._qiKatagoGen) maybeScheduleKatago(this); })
                            ).catch((err) => {
                                console.error('KataGo playCompound 失败，全量重同步引擎局面', err);
                                const session = this._qiKatago;
                                if (!session || session.dead || gen !== this._qiKatagoGen) return;
                                const snap = typeof this.copyBoard === 'function'
                                    ? this.copyBoard(this.board)
                                    : this.board.map((row) => row.slice());
                                session.setupGame(buildKatagoSetupOpts(this, snap)).then(() => {
                                    if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                                }).catch((e2) => console.error('KataGo 复合着后重同步失败', e2));
                            });
                        } else {
                            this._qiKatago.play(colorOfSlot(slot), last.row, last.col).then(() => verifyEngineState(this, this._qiKatago, gen, '人类着法')
                                .catch(() => { /* ignore */ })
                                .then(() => { if (gen === this._qiKatagoGen) maybeScheduleKatago(this); })
                            ).catch((err) => {
                                console.error('KataGo play 失败，全量重同步引擎局面', err);
                                // 引擎内部局面与服务器不一致会累积错位（后续 genmove 决策基于错误局面）：
                                // 全量 set_position 以服务器盘面重建引擎局面
                                const session = this._qiKatago;
                                if (!session || session.dead || gen !== this._qiKatagoGen) return;
                                const snap = typeof this.copyBoard === 'function'
                                    ? this.copyBoard(this.board)
                                    : this.board.map((row) => row.slice());
                                session.setupGame(buildKatagoSetupOpts(this, snap)).then(() => {
                                    if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                                }).catch((e2) => console.error('KataGo 重同步失败', e2));
                            });
                        }
                    } else {
                        // 未识别的着法类型没有对应的引擎同步方式：绝不能静默跳过（引擎会缺这一手）
                        console.warn(`[katago:${engineGameId(this)}] 未识别的着法类型（${last ? last.type : '空'}），该手未同步给引擎：全量重同步引擎状态。最近几手：${describeRecentMoves(this, 6)}`);
                        const session = this._qiKatago;
                        if (session && !session.dead && gen === this._qiKatagoGen) {
                            const snap = typeof this.copyBoard === 'function'
                                ? this.copyBoard(this.board)
                                : this.board.map((row) => row.slice());
                            session.setupGame(buildKatagoSetupOpts(this, snap)).then(() => {
                                if (gen === this._qiKatagoGen) maybeScheduleKatago(this);
                            }).catch((e2) => console.error('KataGo 未识别着法后重同步失败', e2));
                        } else {
                            maybeScheduleKatago(this);
                        }
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
    // 子棋类统一规则：只要棋种在 getState 里广播 subGameId（如 weak-magnetism-weiqi、
    // rhom-triangle-weiqi），就只检查子棋类 id（katagos/{subGameId}/），不检查棋类 id；
    // 没有子棋类才用棋类 id——无需为每个棋种单独修改
    let subGameId = null;
    try {
        const st = typeof room.gameLogic.getState === 'function' ? room.gameLogic.getState() : null;
        // 无子棋类的棋类 getState 没有 subGameId 字段（或为 undefined/null/空串）——此时用主棋类 id；
        // 有子棋类的棋种在 getState 广播 subGameId（如 weak-magnetism-weiqi）
        if (st && typeof st.subGameId === 'string' && st.subGameId.trim()) subGameId = st.subGameId.trim();
    } catch (_) { /* ignore */ }
    const gameId = subGameId || room.gameType;
    install(room.gameLogic, gameId);
}

module.exports = {
    weightsForEngine,
    /** 站点贴目(点) → 引擎贴目(目)：自建 setup opts 的棋种（选点围棋）共用这一处换算 */
    engineKomi,
    install,
    attachToRoom,
    disposeRoom(room) {
        if (room && room.gameLogic) stopKatago(room.gameLogic);
    },
    isKatagoAvailable,
    /** 电脑着法的落子入口（单测直接调用，平时只在本文件内部用） */
    applyComputerMove
};
