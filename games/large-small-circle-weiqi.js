/**
 * 大小圆围棋（large-small-circle-weiqi）
 *
 * 棋盘：路数 n（4-11）→ (n-1)×(n-1) 个大圆，上下左右相邻的大圆相切；每个大圆内上下左右四个小圆
 * 与大圆内切、且四个对角两两相切（大圆半径 = 小圆半径 ×(1+√2)）。所有切点都是可落子点，
 * 用 (宮, 位) 编号（宮 = 大圆槽位，位 0=左大圆点 1=上大圆点 2=左上 3=右上 4=右下 5=左下）。
 *
 * 盘：掩码二维网格 board[宮][位]，-1 = 无效点、0/1/2 = 空/黑/白；gridW = 宮 数、gridH = 6
 * 规则核心（本棋种独有，见文件里的 circle* 纯函数）：
 *   - 点分大圆点（既在大圆又在小圆，位 0/1）与小圆点（只在小圆，位 2~5）
 *   - 气不对称：大圆点只把相邻空大圆点算气；小圆点把所有相邻空点算气
 *   - 提子：组按连通的闭包（大小圆点混算一组）；自己有气的子算活，气沿连通迭代传递
 *     （大圆点→相邻大圆点/小圆点，小圆点→相邻小圆点），传不到气的子提掉（可只提一部分）
 *   - 落子后先判对方：候选组统一判定、一次性提完；再按提完后的盘面判己方落子所在组
 * 协议：坐标「行,列」即 (宮, 位)；棋谱 B5,5 / 虚着 Bp；编辑盘面走公共 editBoardMode='maskedGrid'
 * 数点/形势判断沿用非四角围棋那套（Benson 保活 + 确定领地覆盖，按本盘邻接计算；没有内置 AI 引擎）
 */

const { qiApplyRecordKomi, qiEffectiveKomi, QiTwoPlayerRoomBase, gridGraphWeiqiRules, qiMatchTimeControl, qiProtocol, qiBoardSeatOverlay } = require('../common');

/* ============================ 一、棋盘几何 ============================ */
/**
 * 大小圆围棋：大圆阵 (路数-1)×(路数-1)，上下左右相邻的大圆相切；
 * 每个大圆内上下左右四个小圆与其内切，且四个对角两两相切（大圆半径 = 小圆半径 ×(1+√2)）。
 * 可落子点 = 所有切点。点用 (宮, 位) 编号（服务端与客户端必须逐点一致）：
 *   宮 = 大圆槽位，按「列 + 行×路数」编号，0 .. 路数²-2（右下角那一宫不存点）
 *   位 0 = 左大圆点、1 = 上大圆点、2 = 左上、3 = 右上、4 = 右下、5 = 左下（2~5 为小圆点）
 * 去重：最右「虚拟列」只留位 0（它就是左边实圆的右大圆点）、最下「虚拟行」只留位 1（上边实圆的下大圆点）。
 * 总点数：大圆点 4(n-1)+2(n-1)(n-2)，小圆点 4(n-1)²（4 路 60 点、11 路 620 点）。
 *
 * 类型：既在大圆上又在小圆上的点 = 大圆点（位 0、1）；只在小圆上的点 = 小圆点（位 2~5）。
 *
 * 邻接（对称，内部最多 8）：大圆上四个大圆点成环：左(宮,0) → 上(宮,1) → 右(宮+1,0) → 下(宮+路数,1) → 左；
 * 每个小圆上的三个切点两两相邻（1 个大圆点 + 2 个对角小圆点）。
 *
 * 气（不对称，本棋种的关键）：大圆点只把相邻的**空大圆点**算气（最多 4，边角更少）；
 * 小圆点把所有相邻空点算气（最多 4）。所以 A 是 B 的气、B 不一定是 A 的气。
 */
const KIND_BIG = 1;
const KIND_SMALL = 2;
/** 位 0、1 是大圆点，位 2~5 是小圆点 */
const SEAT_KIND = [KIND_BIG, KIND_BIG, KIND_SMALL, KIND_SMALL, KIND_SMALL, KIND_SMALL];

/** 路数范围、默认路数、贴目、棋谱标识 */
const SIZE_MIN = 4;
const SIZE_MAX = 11;
const DEFAULT_LANES = 9;
const KOMI = 3.25;
const RECORD_GAME_ID = 'large-small-circle-weiqi';
const RECORD_GAME_TYPE = '大小圆围棋';

/**
 * 生成棋盘表（服务端 games/ 与客户端 room-plugins/ 各一份，必须逐点一致）。
 * @returns {{lanes:number, slots:number, gridW:number, gridH:number, pointCount:number,
 *   valid:(g:number,s:number)=>boolean, neighbors:(g:number,s:number)=>number[][],
 *   kindOf:(s:number)=>number, pos:(g:number,s:number)=>{x:number,y:number},
 *   spanUnits:number, bigR:number, smallR:number}}
 */
function circleBoardTable(lanes) {
    const G = lanes;
    const slots = G * G - 1;
    const bigR = 1 + Math.SQRT2;        // 大圆半径（小圆半径取 1）
    const gap = bigR - 1;               // 大圆圆心 → 小圆圆心距离 = √2
    const valid = (g, s) => {
        if (!Number.isInteger(g) || !Number.isInteger(s)) return false;
        if (g < 0 || g >= slots || s < 0 || s > 5) return false;
        if (g % G === G - 1 && s !== 0) return false;                 // 虚拟右列只留位 0
        if (Math.floor(g / G) === G - 1 && s !== 1) return false;     // 虚拟下行只留位 1
        return true;
    };
    const neighbors = (g, s) => {
        const out = [];
        const push = (a, b) => { if (valid(a, b)) out.push([a, b]); };
        if (s === 0) {                 // 左大圆点：本圆的上/下 + 左圆的上/下（大圆上的相邻大圆点），再加两边小圆的对角切点
            push(g, 1); push(g + G, 1); push(g - 1, 1); push(g - 1 + G, 1);
            push(g, 2); push(g, 5); push(g - 1, 3); push(g - 1, 4);
        } else if (s === 1) {          // 上大圆点：本圆的左/右 + 上圆的左/右
            push(g, 0); push(g + 1, 0); push(g - G, 0); push(g - G + 1, 0);
            push(g, 2); push(g, 3); push(g - G, 4); push(g - G, 5);
        } else if (s === 2) {          // 左上小圆点（只在本圆内）
            push(g, 0); push(g, 5); push(g, 1); push(g, 3);
        } else if (s === 3) {          // 右上小圆点
            push(g, 1); push(g, 2); push(g + 1, 0); push(g, 4);
        } else if (s === 4) {          // 右下小圆点
            push(g + 1, 0); push(g, 3); push(g + G, 1); push(g, 5);
        } else {                       // 左下小圆点
            push(g + G, 1); push(g, 4); push(g, 0); push(g, 2);
        }
        return out;
    };
    /** 显示坐标：x 向右、y 向下，单位 = 小圆半径，整盘占 [0, spanUnits]² */
    const pos = (g, s) => {
        const cx = (2 * (g % G) + 1) * bigR;
        const cy = (2 * Math.floor(g / G) + 1) * bigR;
        if (s === 0) return { x: cx - bigR, y: cy };
        if (s === 1) return { x: cx, y: cy - bigR };
        if (s === 2) return { x: cx - gap / 2, y: cy - gap / 2 };
        if (s === 3) return { x: cx + gap / 2, y: cy - gap / 2 };
        if (s === 4) return { x: cx + gap / 2, y: cy + gap / 2 };
        return { x: cx - gap / 2, y: cy + gap / 2 };
    };
    let pointCount = 0;
    for (let g = 0; g < slots; g++) for (let s = 0; s < 6; s++) if (valid(g, s)) pointCount++;
    return {
        lanes: G, slots, gridW: slots, gridH: 6, pointCount,
        valid, neighbors, kindOf: (s) => SEAT_KIND[s], pos,
        spanUnits: 2 * bigR * (G - 1), bigR, smallR: 1
    };
}

/** 掩码网格模型（与公共层 gridGraphRules 的约定一致：gridW 行 × gridH 列，无效点 = -1） */
function circleBoardModel(lanes) {
    const T = circleBoardTable(lanes);
    const valid = (r, c) => T.valid(r, c);
    const index = new Map();
    const koordOf = [];
    for (let r = 0; r < T.gridW; r++) {
        for (let c = 0; c < T.gridH; c++) {
            if (!valid(r, c)) continue;
            index.set(r + ',' + c, koordOf.length);
            koordOf.push([r, c]);
        }
    }
    const neighborRows = koordOf.map(([r, c]) => T.neighbors(r, c).map(([nr, nc]) => index.get(nr + ',' + nc)).filter((i) => i !== undefined));
    return {
        gridW: T.gridW,
        gridH: T.gridH,
        vertexCount: koordOf.length,
        table: T,
        koordOf,
        isValidVertex: (r, c) => valid(r, c),
        getNeighbors: (r, c) => T.neighbors(r, c),
        neighborsOfIndex: (i) => neighborRows[i].map((k) => koordOf[k]),
        kindOf: (r, c) => T.kindOf(c),
        posOf: (r, c) => T.pos(r, c)
    };
}
/* ============================ 二、棋规（服务端与客户端各一份，必须一致） ============================ */
/**
 * 下面几个纯函数用「取子/邻接/点类型」回调写成，服务端（掩码 2D 盘）与客户端（1D 点数组）共用同一份逻辑。
 *   get(r,c)  → 0 空 / 1 黑 / 2 白
 *   kind(r,c) → KIND_BIG / KIND_SMALL
 *   nb(r,c)   → [[r,c], ...]
 */

/** 某子的气：大圆点只看相邻的空大圆点；小圆点看相邻的所有空点 */
function circleLibertiesOf(get, kindOf, nb, r, c) {
    const out = [];
    const k = kindOf(r, c);
    for (const [a, b] of nb(r, c)) {
        if (get(a, b) !== 0) continue;
        if (k === KIND_BIG && kindOf(a, b) !== KIND_BIG) continue;
        out.push([a, b]);
    }
    return out;
}

/** 同色连通闭包（大圆点与小圆点相连算同一组） */
function circleGroupOf(get, nb, r, c) {
    const color = get(r, c);
    if (!color) return [];
    const seen = new Set([r + ',' + c]);
    const out = [[r, c]];
    for (let i = 0; i < out.length; i++) {
        const [cr, cc] = out[i];
        for (const [a, b] of nb(cr, cc)) {
            if (get(a, b) !== color) continue;
            const k = a + ',' + b;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push([a, b]);
        }
    }
    return out;
}

/**
 * 组里哪些子要提掉：
 *   1) 自己有气的子算活；
 *   2) 气沿连通**迭代传递** —— 大圆点可以传给相邻的大圆点和小圆点，小圆点只能传给相邻的小圆点；
 *   3) 传不到气的子提掉（于是会出现「同组只提一部分」）。
 */
function circleDoomedStones(get, kindOf, nb, stones) {
    if (!stones.length) return [];
    const alive = new Set();
    const queue = [];
    for (const [r, c] of stones) {
        if (circleLibertiesOf(get, kindOf, nb, r, c).length > 0) {
            alive.add(r + ',' + c);
            queue.push([r, c]);
        }
    }
    const color = get(stones[0][0], stones[0][1]);
    for (let i = 0; i < queue.length; i++) {
        const [r, c] = queue[i];
        const big = kindOf(r, c) === KIND_BIG;
        for (const [a, b] of nb(r, c)) {
            if (get(a, b) !== color) continue;                      // 只在同一组里传
            if (!big && kindOf(a, b) !== KIND_SMALL) continue;      // 小圆点的气只传给小圆点
            const k = a + ',' + b;
            if (alive.has(k)) continue;
            alive.add(k);
            queue.push([a, b]);
        }
    }
    return stones.filter(([r, c]) => !alive.has(r + ',' + c));
}

/** 一组点所在的组（去重）——用于「只判落点及其相邻点所在的组」 */
function circleGroupsAround(get, nb, points) {
    const seen = new Set();
    const groups = [];
    for (const [r, c] of points) {
        if (get(r, c) === 0) continue;
        if (seen.has(r + ',' + c)) continue;
        const grp = circleGroupOf(get, nb, r, c);
        for (const [a, b] of grp) seen.add(a + ',' + b);
        groups.push(grp);
    }
    return groups;
}

/* ============================ 三、房间逻辑 ============================ */

class LargeSmallCircleWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, initialLanes = DEFAULT_LANES) {
        super(room);
        this.editBoardMode = 'maskedGrid';
        this.boardLanes = (Number.isInteger(initialLanes) && initialLanes >= SIZE_MIN && initialLanes <= SIZE_MAX)
            ? initialLanes : DEFAULT_LANES;
        this._initState();
        this._buildBoard();
    }

    /** 初始对局状态（构造与 resetToEmpty 共用） */
    _initState() {
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
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
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    /** 按当前路数重建棋盘、邻接与开局盘（路数变化的唯一入口） */
    _buildBoard() {
        const model = circleBoardModel(this.boardLanes);
        this._model = model;
        this.gridW = model.gridW;
        this.gridH = model.gridH;
        this.vertexCount = model.vertexCount;
        this.board = Array.from({ length: this.gridW }, (_, r) =>
            Array.from({ length: this.gridH }, (_, c) => (model.isValidVertex(r, c) ? 0 : -1)));
        this.openingBoard = this.copyBoard(this.board);
        // 本棋种没有内置人机引擎；boardSize 只为协议与棋谱完整，记「路数」
        this.boardSize = this.boardLanes;
    }

    isValidVertex(r, c) {
        return this._model.isValidVertex(r, c);
    }

    getNeighbors(r, c) {
        return this._model.getNeighbors(r, c);
    }

    _nb() {
        return (r, c) => this.getNeighbors(r, c);
    }

    komi() {
        if (this.importedKomi != null) return this.importedKomi;   // 导入棋谱采纳记录贴目
        return KOMI;
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
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
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
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', now);
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

    copyBoard(src) { return src.map(row => row.slice()); }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    boardToString(board) {
        let s = '';
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                if (this.isValidVertex(r, c)) s += board[r][c];
                else s += 'x';
            }
        }
        return s;
    }

    /* ---------- 规则：全部走公共层 gridGraphWeiqiRules ---------- */

    /** 该子所在组的气数（本棋种口径：大圆点只数相邻空大圆点） */
    countGroupLiberties(board, row, col) {
        const nb = this._nb();
        const get = (r, c) => board[r][c];
        const kind = (r, c) => this._model.kindOf(r, c);
        const seen = new Set();
        for (const [r, c] of circleGroupOf(get, nb, row, col)) {
            for (const [a, b] of circleLibertiesOf(get, kind, nb, r, c)) seen.add(a + ',' + b);
        }
        return seen.size;
    }

    removeGroup(board, row, col, color) {
        const nb = this._nb();
        for (const [r, c] of circleGroupOf((r2, c2) => board[r2][c2], nb, row, col)) board[r][c] = 0;
    }

    /**
     * 落子（先判对方、再判己方；每一方都先算清要提哪些、再一次性提掉）：
     *   1. 落子后受影响组 = 落点及其相邻点所在的组
     *   2. 对方所有候选组基于同一盘面判定，把该提的子一次性提掉
     *   3. 再用提完后的盘面判己方落点所在的整组，该提的一次性提掉（允许自杀）
     */
    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidVertex(row, col) || boardBefore[row][col] !== 0) return null;
        const nb = this._nb();
        const newBoard = this.copyBoard(boardBefore);
        newBoard[row][col] = playerVal;
        const get = (r, c) => newBoard[r][c];
        const kind = (r, c) => this._model.kindOf(r, c);
        const enemy = playerVal === 1 ? 2 : 1;
        const around = [[row, col], ...nb(row, col)];
        const doomed = [];
        for (const grp of circleGroupsAround(get, nb, around)) {
            if (get(grp[0][0], grp[0][1]) !== enemy) continue;
            doomed.push(...circleDoomedStones(get, kind, nb, grp));
        }
        for (const [r, c] of doomed) newBoard[r][c] = 0;
        const own = circleGroupOf((r, c) => newBoard[r][c], nb, row, col);
        for (const [r, c] of circleDoomedStones((r, c) => newBoard[r][c], kind, nb, own)) newBoard[r][c] = 0;
        return newBoard;
    }

    removeDeadAndDying(srcBoard) {
        return gridGraphWeiqiRules.removeDeadAndDying(
            srcBoard, this.gridW, this.gridH,
            (b) => this.copyBoard(b), this._nb(), (r, c) => this.isValidVertex(r, c)
        );
    }

    assignTerritory(liveBoard) {
        return gridGraphWeiqiRules.assignTerritoryWithRange(
            liveBoard, this.gridW, this.gridH,
            this._nb(), (r, c) => this.isValidVertex(r, c)
        );
    }

    computeScore(liveBoard, territory) {
        return gridGraphWeiqiRules.computeScore(
            liveBoard, territory, this.gridW, this.gridH,
            (r, c) => this.isValidVertex(r, c)
        );
    }

    /** 形势判断/数点用的领先目数（Benson 保活 + 确定领地覆盖；四种棋盘同一套算法） */
    computeLead() {
        const bensonOf = (bd) => gridGraphWeiqiRules.bensonAlive(
            bd, this.gridH, this.gridW, this._nb(), (r, c) => this.isValidVertex(r, c)
        );
        const benson = bensonOf(this.board);
        let liveBoard = this.removeDeadAndDying(this.board);
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = this.removeDeadAndDying(liveBoard);
            for (let r = 0; r < this.gridW; r++) {
                for (let c = 0; c < this.gridH; c++) {
                    const v = this.board[r][c];
                    if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
            }
            liveBoard = cleaned;
        }
        const territory = this.assignTerritory(liveBoard);
        const secure = bensonOf(liveBoard);
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
        }
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        return blackTotal - whiteTotal - 2 * this.komi();
    }

    /* ---------- 结果文案 ---------- */

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

    /* ---------- 状态 / 切子棋类 / 改路数 ---------- */

    getState() {
        return {
            gameId: RECORD_GAME_ID,
            gameType: RECORD_GAME_TYPE,
            // 路数（客户端下拉、贴目条、默认时间都按它算）
            boardSize: this.boardLanes,
            gridWidth: this.gridH,
            gridHeight: this.gridW,
            vertexCount: this.vertexCount,
            komi: this.komi(),
            board: this.board,
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

    /**
     * 切换子棋类（仅观战者、房内无棋手时）。首次进入某子棋类用它自己的默认路数，
     * 之后再切回该子棋类沿用上一次用的路数。
     */
    setBoardSize(newSize, requesterWs) {
        const lanes = parseInt(String(newSize ?? ''), 10);
        if (!Number.isInteger(lanes) || lanes < SIZE_MIN || lanes > SIZE_MAX) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘路数无效（${SIZE_MIN}-${SIZE_MAX}）` }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有多人落座，不能修改棋盘大小' }));
            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardLanes = lanes;
        this._buildBoard();
        this._initState();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardLanes, ...this.getState() });
        return true;
    }

    resetGame() {
        this.importedKomi = undefined;
        this._stopClockTicker();
        this._buildBoard();
        this._initState();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    resetToEmpty() {
        this.importedKomi = undefined;
        this._stopClockTicker();
        this._buildBoard();
        this._initState();
    }

    /* ---------- 棋谱 ---------- */

    parseMoveEntry(entry) {
        if (typeof entry !== 'string' || entry.length < 2) return entry;
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        const body = entry.slice(1);
        if (body === 'p') return { type: 'pass', player };
        const m = /^(\d+),(\d+)$/.exec(body);
        if (!m) return { type: 'move', player, row: -1, col: -1 };
        return { type: 'move', player, row: Number(m[1]), col: Number(m[2]) };
    }

    /** 坐标串（B5,5）→ [[行, 列, 颜色]]，忽略越界/无效点 */
    parseInitialPositionCoords(initialPosition) {
        if (!Array.isArray(initialPosition)) return [];
        const stones = [];
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 4) continue;
            const p = s[0];
            if (p !== 'B' && p !== 'W') continue;
            const m = /^(\d+),(\d+)$/.exec(s.slice(1));
            if (!m) continue;
            const r = Number(m[1]), c = Number(m[2]);
            if (!this.isValidVertex(r, c)) continue;
            stones.push([r, c, p === 'B' ? 1 : 2]);
        }
        return stones;
    }

    exportRecord() {
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
            gameType: RECORD_GAME_TYPE,
            gameId: RECORD_GAME_ID,
            boardLanes: this.boardLanes,
            gridWidth: this.gridH,
            gridHeight: this.gridW,
            komi: this.komi(),
            players: { player1: null, player2: null },
            // 只写编辑出来的开局盘（默认空盘）：把终局全盘塞进来会与 moves 重放冲突
            initialPosition: this._encodeInitialPositionCoords(),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : `${p}${m.row},${m.col}`;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: resultText,
            resultText
        };
    }

    _encodeInitialPositionCoords() {
        const out = [];
        const opening = this.openingBoard;
        if (!opening) return out;
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                const val = opening[r][c];
                if (val !== 1 && val !== 2) continue;
                out.push(`${val === 1 ? 'B' : 'W'}${r},${c}`);
            }
        }
        return out;
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== RECORD_GAME_ID && data.gameType !== RECORD_GAME_TYPE)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要大小圆围棋棋谱）。' }));
            return;
        }
        const lanes = data.boardLanes != null ? data.boardLanes : data.boardSize;
        if (!Number.isInteger(lanes) || lanes < SIZE_MIN || lanes > SIZE_MAX) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱中棋盘路数无效（${SIZE_MIN}-${SIZE_MAX}）` }));
            return;
        }

        this.boardLanes = lanes;
        this._buildBoard();
        this.resetToEmpty();

        for (const [r, c, val] of this.parseInitialPositionCoords(data.initialPosition)) this.board[r][c] = val;

        const rawMoves = data.moves || [];
        const moves = rawMoves.map((e) => this.parseMoveEntry(e));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (!Number.isInteger(row) || !Number.isInteger(col) || !this.isValidVertex(row, col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const occ = this.board[row][col];
                if (occ !== 0 && occ !== playerVal) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手位置已有子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                // 开局盘里已有同色子（编辑开局）：盘面不变但仍记入手顺，供客户端从空盘复原
                if (occ === playerVal) {
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'move', player: slot, row, col });
                    this.lastMoveMarkers = [{ row, col, color: playerVal }];
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    continue;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(this.boardToString(newBoard));
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
            } else if (move.type === 'setup') {
                // 允许棋谱里显式给出摆子（颜色 + 坐标），与 initialPosition 等价
                const r = Number(move.row), c = Number(move.col);
                if (this.isValidVertex(r, c) && move.color != null) this.board[r][c] = Number(move.color);
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

        qiApplyRecordKomi(this, data);   // 导入棋谱采纳记录贴目（新局/重置时清掉）
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                gameId: RECORD_GAME_ID,
                boardLanes: this.boardLanes,
                // 打谱从空盘 + 全手顺即可；避免 initialPosition 与 moves 重复导致客户端回放失败
                initialPosition: [],
                moves: moves.map(m => (m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, row: m.row, col: m.col }))
            }
        });
    }

    /* ---------- 悔棋 ---------- */

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
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
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = Array.from({ length: this.gridW }, (_, r) =>
                Array.from({ length: this.gridH }, (_, c) => (this.isValidVertex(r, c) ? 0 : -1)));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    /* ---------- 消息 ---------- */

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    this.slotJoinedAt[newSlot] = Date.now();
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                    this._maybeBeginTimeNegotiation();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                if (qiProtocol.canChangeRoomSettings(this)) this.setBoardSize(msg.size, ws);
                break;

            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                const { row, col } = msg;
                if (!this.isValidVertex(row, col)) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效交点' }));
                    return;
                }
                if (this.board[row][col] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                qiProtocol.weiqiPass(this, ws, slot, {
                    afterBroadcast: () => this._syncClockAfterTurnChange(),
                });
                break;

            case 'requestUndo': {
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
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'player1' ? 'player2' : 'player1';
                this.onResignResolved(slot);
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;
            }

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd': {
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!endOpponent) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;
            }

            case 'endResponse':
                if (this.pendingEnd && msg.accept) this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept) this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝终局。' }));
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
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (room.getPlayerBySlot('player1') || room.getPlayerBySlot('player2')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (room.getPlayerBySlot('player1') || room.getPlayerBySlot('player2')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
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
    SIZE_MIN,
    SIZE_MAX,
    DEFAULT_LANES,
    circleBoardTable,
    circleBoardModel,
    LargeSmallCircleWeiqiRoom,
    initRoom(room) {
        room.gameLogic = new LargeSmallCircleWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
