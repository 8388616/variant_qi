'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KATAGOS_ROOT = path.join(__dirname, 'katagos');
// 与 KataGo 一致：A-Z 跳过 I（单字母 0-24）；≥25 用双字母（AA=25），与 cpp tryParseLetterCoordinate 一致
const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

/** 列号 → GTP 坐标字母（单字母或双字母） */
function gtpColLetters(col) {
    if (col < GTP_LETTERS.length) return GTP_LETTERS[col];
    const rest = col - GTP_LETTERS.length;
    return GTP_LETTERS[Math.floor(rest / GTP_LETTERS.length)] + GTP_LETTERS[rest % GTP_LETTERS.length];
}

/** 字母坐标 → 列号（支持单/双字母，与 cpp (x+1)*25+x1 一致） */
function gtpLettersToCol(s) {
    const idx = (ch) => {
        const i = GTP_LETTERS.indexOf(ch.toUpperCase());
        return i < 0 ? -1 : i;
    };
    if (s.length === 1) return idx(s[0]);
    const a = idx(s[0]);
    const b = idx(s[1]);
    if (a < 0 || b < 0) return -1;
    return (a + 1) * GTP_LETTERS.length + b;
}

/** 与各 games/*.js 约定一致的盘面特殊格 id */
const BOARD_CELL = {
    EMPTY: 0,
    BLACK: 1,
    WHITE: 2,
    HOLE: -1,
    BRIDGE: -2,
    MINE: -3,
    NEUTRAL: 10000
};

function safeGameId(gameId) {
    return typeof gameId === 'string' && /^[a-zA-Z0-9_-]+$/.test(gameId) ? gameId : null;
}

/** 解析并校验目录落在 katagos/ 下，防止路径穿越 */
function resolveKatagoDir(gameId) {
    const id = safeGameId(gameId);
    if (!id) return null;
    const dir = path.resolve(KATAGOS_ROOT, id);
    const root = path.resolve(KATAGOS_ROOT);
    if (dir !== root && !dir.startsWith(root + path.sep)) return null;
    try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
    } catch (_) {
        return null;
    }
    return dir;
}

function findKatagoExecutable(dir) {
    if (!dir) return null;
    const candidates = process.platform === 'win32'
        ? ['katago.exe', 'katago']
        : ['katago', 'katago.exe'];
    for (const name of candidates) {
        const p = path.join(dir, name);
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch (_) { /* ignore */ }
    }
    return null;
}

/**
 * 是否具备人机对战条件：katagos/{gameId}/ 下存在 katago、model.bin.gz、gtp.cfg
 * （不向客户端暴露任何路径）
 */
function isKatagoAvailable(gameId) {
    const dir = resolveKatagoDir(gameId);
    if (!dir) return false;
    const exe = findKatagoExecutable(dir);
    const model = path.join(dir, 'model.bin.gz');
    const cfg = path.join(dir, 'gtp.cfg');
    try {
        return !!(exe && fs.existsSync(model) && fs.statSync(model).isFile()
            && fs.existsSync(cfg) && fs.statSync(cfg).isFile());
    } catch (_) {
        return false;
    }
}

/** 非方形棋盘（如开罗五角围棋）时 boardHeight 为行数；缺省与 boardSize（宽）相同 */
function toGtpVertex(row, col, boardSize, boardHeight) {
    if (row == null || col == null) return 'pass';
    const h = boardHeight || boardSize;
    if (col < 0 || col >= boardSize || row < 0 || row >= h) return null;
    return gtpColLetters(col) + String(h - row);
}

function fromGtpVertex(vertex, boardSize, boardHeight) {
    if (vertex == null) return { pass: true };
    const s = String(vertex).trim();
    if (!s || /^pass$/i.test(s) || /^resign$/i.test(s)) return { pass: true };
    const m = s.match(/^([A-Za-z]{1,2})\s*(\d+)$/);
    if (!m) return null;
    const col = gtpLettersToCol(m[1]);
    const fromBottom = parseInt(m[2], 10);
    if (col < 0 || !Number.isFinite(fromBottom)) return null;
    const h = boardHeight || boardSize;
    const row = h - fromBottom;
    if (row < 0 || row >= h || col >= boardSize) return null;
    return { row, col, pass: false };
}

/**
 * 解析 genmove / play 着法：pass、落子、或易位 `ts A1 B1`（两端无序）。
 * @returns {{ pass: true } | { pass: false, row: number, col: number } | { pass: false, swap: true, aRow: number, aCol: number, bRow: number, bCol: number } | null}
 */
function fromGtpMove(raw, boardSize, boardHeight) {
    if (raw == null) return { pass: true };
    const s = String(raw).trim();
    if (!s || /^pass$/i.test(s) || /^resign$/i.test(s)) return { pass: true };
    const ts = s.match(/^ts\s+(\S+)\s+(\S+)$/i);
    if (ts) {
        const a = fromGtpVertex(ts[1], boardSize, boardHeight);
        const b = fromGtpVertex(ts[2], boardSize, boardHeight);
        if (!a || a.pass || !b || b.pass) return null;
        return {
            pass: false,
            swap: true,
            aRow: a.row,
            aCol: a.col,
            bRow: b.row,
            bCol: b.col
        };
    }
    return fromGtpVertex(s, boardSize, boardHeight);
}

function slotToGtpColor(slot) {
    return slot === 'white' ? 'W' : 'B';
}

class KatagoGtpSession {
    /**
     * @param {string} gameId
     */
    constructor(gameId) {
        this.gameId = gameId;
        this.proc = null;
        this.buf = '';
        this.queue = [];
        this.pending = null;
        this.dead = false;
        this.generation = 0;
        /** @type {number|null} 尚未 GTP boardsize 时为 null（非方形时存宽/列数） */
        this.boardSize = null;
        this.boardWidth = null;
        this.boardHeight = null;
        this._nnPrimedForSize = null;
    }

    start() {
        if (this.proc) return Promise.resolve();
        const dir = resolveKatagoDir(this.gameId);
        const exe = findKatagoExecutable(dir);
        if (!dir || !exe) return Promise.reject(new Error('KataGo 不可用'));
        const model = path.join(dir, 'model.bin.gz');
        const cfg = path.join(dir, 'gtp.cfg');
        if (!fs.existsSync(model) || !fs.existsSync(cfg)) {
            return Promise.reject(new Error('KataGo 不可用'));
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            try {
                // 限制 OpenMP/BLAS 线程，避免 2 核机器上多进程互相抢核导致假死
                const spawnEnv = {
                    ...process.env,
                    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '1',
                    OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || '1',
                    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || '1',
                    NUMEXPR_NUM_THREADS: process.env.NUMEXPR_NUM_THREADS || '1'
                };
                this.proc = spawn(exe, ['gtp', '-model', model, '-config', cfg], {
                    cwd: dir,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    env: spawnEnv
                });
                registerLiveSession(this);
            } catch (e) {
                this.dead = true;
                reject(e);
                return;
            }

            this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
            /** @type {(() => void) | null} */
            let onGtpReady = null;
            let sawGtpReady = false;
            this.proc.stderr.on('data', (chunk) => {
                const t = chunk.toString();
                if (t.trim()) console.error(`[katago:${this.gameId}]`, t.trim());
                // 等 stderr 出现 GTP ready 再发 name，避免把「加载中」误判成命令无响应后杀进程
                if (!sawGtpReady && /GTP ready/i.test(t)) {
                    sawGtpReady = true;
                    if (onGtpReady) {
                        const cb = onGtpReady;
                        onGtpReady = null;
                        cb();
                    }
                }
            });
            this.proc.on('error', (err) => {
                this.dead = true;
                unregisterLiveSession(this);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
                this._rejectAll(err);
            });
            this.proc.on('exit', (code, signal) => {
                this.dead = true;
                unregisterLiveSession(this);
                const err = new Error(`KataGo 已退出 (code=${code}, signal=${signal})`);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
                this._rejectAll(err);
            });

            // 先等模型加载完成（GTP ready），再短超时探测 name
            const readyWait = new Promise((readyResolve, readyReject) => {
                if (sawGtpReady) {
                    readyResolve();
                    return;
                }
                const timer = setTimeout(() => {
                    onGtpReady = null;
                    readyReject(new Error(`KataGo 加载超时 (${STARTUP_TIMEOUT_MS}ms)：未出现 GTP ready`));
                }, STARTUP_TIMEOUT_MS);
                if (typeof timer.unref === 'function') timer.unref();
                onGtpReady = () => {
                    clearTimeout(timer);
                    readyResolve();
                };
            });

            readyWait
                .then(() => this.command('name', { timeoutMs: 30000 }))
                .then(() => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                })
                .catch((e) => {
                    if (!settled) {
                        settled = true;
                        reject(e);
                    }
                    try { this.destroy(); } catch (_) { /* ignore */ }
                });
        });
    }

    _clearEntryTimer(entry) {
        if (entry && entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
    }

    _rejectAll(err) {
        if (this.pending) {
            const p = this.pending;
            this.pending = null;
            this._clearEntryTimer(p);
            p.reject(err);
        }
        while (this.queue.length) {
            const q = this.queue.shift();
            this._clearEntryTimer(q);
            q.reject(err);
        }
    }

    _onStdout(chunk) {
        this.buf += chunk.toString();
        for (;;) {
            const idx = this.buf.indexOf('\n\n');
            if (idx < 0) {
                const crIdx = this.buf.indexOf('\r\n\r\n');
                if (crIdx < 0) break;
                const block = this.buf.slice(0, crIdx).replace(/\r/g, '');
                this.buf = this.buf.slice(crIdx + 4);
                this._handleBlock(block);
                continue;
            }
            const block = this.buf.slice(0, idx).replace(/\r/g, '');
            this.buf = this.buf.slice(idx + 2);
            this._handleBlock(block);
        }
    }

    _handleBlock(block) {
        if (!this.pending) return;
        const lines = block.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
        const first = (lines[0] || '').trim();
        // genmove 分析等可能往 stdout 打 info 块（含空行）；不能当成 GTP 应答，否则会错位
        if (!first.startsWith('=') && !first.startsWith('?')) {
            return;
        }
        const p = this.pending;
        this.pending = null;
        this._clearEntryTimer(p);
        if (first.startsWith('=')) {
            const rest = first.slice(1).trim();
            const extra = lines.slice(1).join('\n').trim();
            p.resolve(extra ? (rest ? rest + '\n' + extra : extra) : rest);
        } else {
            p.reject(new Error(first.slice(1).trim() || 'GTP error'));
        }
        this._pump();
    }

    _pump() {
        if (this.pending || !this.queue.length || this.dead || !this.proc) return;
        this.pending = this.queue.shift();
        try {
            this.proc.stdin.write(this.pending.cmd + '\n');
        } catch (e) {
            const p = this.pending;
            this.pending = null;
            this._clearEntryTimer(p);
            p.reject(e);
        }
    }

    /**
     * @param {string} cmd
     * @param {{ timeoutMs?: number }} [opts]
     */
    command(cmd, opts) {
        const timeoutMs = opts && Number.isFinite(Number(opts.timeoutMs))
            ? Math.max(1000, Number(opts.timeoutMs) | 0)
            : DEFAULT_CMD_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            if (this.dead || !this.proc) {
                reject(new Error('KataGo 未运行'));
                return;
            }
            const entry = {
                cmd: String(cmd),
                timer: null,
                resolve: (v) => {
                    this._clearEntryTimer(entry);
                    resolve(v);
                },
                reject: (e) => {
                    this._clearEntryTimer(entry);
                    reject(e);
                }
            };
            entry.timer = setTimeout(() => {
                entry.timer = null;
                const idx = this.queue.indexOf(entry);
                if (idx >= 0) this.queue.splice(idx, 1);
                const wasPending = this.pending === entry;
                if (wasPending) this.pending = null;
                const err = new Error(`KataGo 命令超时 (${timeoutMs}ms): ${entry.cmd}`);
                try { entry.reject(err); } catch (_) { /* ignore */ }
                // 超时多半卡在 genmove/推理：杀进程以免占满 CPU/内存
                void wasPending;
                try { this.destroy(); } catch (_) { /* ignore */ }
            }, timeoutMs);
            if (typeof entry.timer.unref === 'function') entry.timer.unref();
            this.queue.push(entry);
            this._pump();
        });
    }

    /**
     * 悔棋：对引擎执行 n 次 GTP undo（避免重设盘面）
     * @param {number} n
     */
    async undoMoves(n) {
        const times = Math.max(0, n | 0);
        for (let i = 0; i < times; i++) {
            await this.command('undo');
        }
    }

    /**
     * 统一用 set_position 同步整盘：
     *   黑/白 → B / W
     *   洞/桥/雷/中立子 → -1 / -2 / -3 / 10000（与 games 盘面 id 一致）
     * 例：set_position B D4 W Q16 -1 A1 10000 C3
     * @param {{ boardSize: number, komi: number, board: number[][], gameId?: string, maxTranslocationMoves?: number }} opts
     */
    async setupGame(opts) {
        const boardWidth = (opts.boardWidth | 0) || (opts.boardSize | 0);
        const boardHeight = (opts.boardHeight | 0) || boardWidth;
        const komi = Number(opts.komi);
        const board = opts.board;
        // 结构洞棋盘（非方形，如开罗五角）：无效格由引擎按尺寸自动识别（C_WALL），不传 -1
        const structuralHoles = boardWidth !== boardHeight;
        // 重复 boardsize 会触发引擎重配缓冲，首着极慢；路数未变则跳过
        // 非方形（开罗等）用 "X:Y"（定制引擎支持）；正方形保持标准 "boardsize N" 兼容普通引擎
        if (this.boardWidth !== boardWidth || this.boardHeight !== boardHeight) {
            await this.command(boardWidth === boardHeight
                ? `boardsize ${boardWidth}`
                : `boardsize ${boardWidth}:${boardHeight}`);
            this.boardWidth = boardWidth;
            this.boardHeight = boardHeight;
            this._nnPrimedForSize = null;
        }
        await this.command('clear_board');
        if (Number.isFinite(komi)) await this.command(`komi ${komi}`);

        const pairs = [];
        if (Array.isArray(board)) {
            for (let r = 0; r < boardHeight; r++) {
                const row = board[r];
                if (!row) continue;
                for (let c = 0; c < boardWidth; c++) {
                    const v = row[c];
                    const vertex = toGtpVertex(r, c, boardWidth, boardHeight);
                    if (!vertex) continue;
                    if (v === BOARD_CELL.BLACK) pairs.push('B', vertex);
                    else if (v === BOARD_CELL.WHITE) pairs.push('W', vertex);
                    else if (!structuralHoles && (v === BOARD_CELL.HOLE
                        || v === BOARD_CELL.BRIDGE
                        || v === BOARD_CELL.MINE
                        || v === BOARD_CELL.NEUTRAL)) {
                        pairs.push(String(v), vertex);
                    }
                }
            }
        }
        // 无子也发 set_position：洞围棋 clear_board 可能随机摆洞，空参数表示清空特殊格
        try {
            await this.command(pairs.length ? `set_position ${pairs.join(' ')}` : 'set_position');
        } catch (err) {
            // 仅黑白时回退 play（无特殊格的旧引擎）
            const onlyBW = pairs.every((p, i) => i % 2 === 1 || p === 'B' || p === 'W');
            if (!onlyBW || !pairs.length) throw err;
            for (let i = 0; i < pairs.length; i += 2) {
                await this.command(`play ${pairs[i]} ${pairs[i + 1]}`);
            }
        }

        // 易位围棋：与网页 maxTranspositionMoves（或剩余手数）对齐；不支持该命令的引擎忽略
        if (opts.maxTranslocationMoves != null && Number.isFinite(Number(opts.maxTranslocationMoves))) {
            const n = Math.max(0, Number(opts.maxTranslocationMoves) | 0);
            try {
                await this.command(`kata-set-max-translocation-moves ${n}`);
            } catch (_) { /* 非易位引擎 */ }
        }
    }

    /**
     * 在当前 boardSize 上做一次前向，把「该路数」的首次推理成本挪到开局同步阶段，
     * 避免电脑第一手 genmove 才触发。
     */
    async primeNn() {
        const size = this.boardWidth != null
            ? this.boardWidth + 'x' + this.boardHeight
            : this.boardSize;
        if (size == null) return;
        if (this._nnPrimedForSize === size) return;
        try {
            await this.command('kata-raw-nn 0', { timeoutMs: 180000 });
            this._nnPrimedForSize = size;
        } catch (_) {
            // 无该命令则留给首着 genmove
        }
    }

    async play(slot, row, col) {
        const color = slotToGtpColor(slot);
        if (row == null && col == null) {
            await this.command(`play ${color} pass`);
            return;
        }
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        const vertex = toGtpVertex(row, col, bs, bh);
        if (!vertex) throw new Error('无效坐标');
        await this.command(`play ${color} ${vertex}`);
    }

    /** 易位：`play B ts D4 D5`（两端顺序任意，引擎按行棋方颜色定向） */
    async playSwap(slot, fromRow, fromCol, toRow, toCol) {
        const color = slotToGtpColor(slot);
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        const from = toGtpVertex(fromRow, fromCol, bs, bh);
        const to = toGtpVertex(toRow, toCol, bs, bh);
        if (!from || !to) throw new Error('无效易位坐标');
        await this.command(`play ${color} ts ${from} ${to}`);
    }

    async genMove(slot) {
        const color = slotToGtpColor(slot);
        const raw = await this.command(`genmove ${color}`, { timeoutMs: GENMOVE_TIMEOUT_MS });
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        return fromGtpMove(raw, bs, bh);
    }

    destroy() {
        this.generation += 1;
        this.dead = true;
        this._fromPool = false;
        unregisterLiveSession(this);
        this._rejectAll(new Error('KataGo 已关闭'));
        const proc = this.proc;
        this.proc = null;
        if (!proc) return;
        try { proc.stdin.end(); } catch (_) { /* ignore */ }
        try { proc.kill(); } catch (_) { /* ignore */ }
        setTimeout(() => {
            try { if (!proc.killed) proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
        }, 2000);
    }
}

/**
 * 全服活跃+空闲 KataGo 进程上限。
 * 每个进程会加载整模并多线程搜索，过高极易把小机器内存/CPU 打满。
 */
const GLOBAL_PROCESS_LIMIT = 1;
const KATAGO_BUSY_MESSAGE = '服务器繁忙，请稍后重试。';
/** 每个棋类最多保留的空闲热进程数（避免重复加载模型） */
const IDLE_POOL_MAX_PER_GAME = 1;
/** 空闲超过此时长则回收进程（毫秒） */
const IDLE_RECLAIM_MS = 5 * 60 * 1000;
/** 单条 GTP 默认超时；超时杀进程 */
const DEFAULT_CMD_TIMEOUT_MS = 120 * 1000;
/** 启动探测（name）：须覆盖「加载模型」时间，过短会被误杀成 SIGKILL */
const STARTUP_TIMEOUT_MS = 10 * 60 * 1000;
/** genmove 超时（含人机思考） */
const GENMOVE_TIMEOUT_MS = 180 * 1000;

class KatagoBusyError extends Error {
    constructor(message) {
        super(message || KATAGO_BUSY_MESSAGE);
        this.name = 'KatagoBusyError';
        this.code = 'KATAGO_BUSY';
    }
}

function isKatagoBusyError(err) {
    return !!(err && (err.code === 'KATAGO_BUSY' || err.name === 'KatagoBusyError'));
}

/**
 * @typedef {{ session: KatagoGtpSession, idleSince: number, timer: NodeJS.Timeout|null }} IdlePoolEntry
 * @type {Map<string, IdlePoolEntry[]>}
 */
const idlePool = new Map();
/** @type {Set<KatagoGtpSession>} */
const liveSessions = new Set();
/** 正在 spawn/warmup 的名额（尚未计入 live，或与 live 重叠前占位） */
let spawnReservations = 0;
/**
 * 串行化 acquire + release：
 * 若 release 的 clear_board 尚未进池就又 acquire，会误判池空而再 spawn，
 * 造成「一局两个已加载模型」打满小机器。
 */
let lifecycleQueue = Promise.resolve();

function enqueueLifecycle(fn) {
    const p = lifecycleQueue.then(fn, fn);
    lifecycleQueue = p.then(() => undefined, () => undefined);
    return p;
}

function registerLiveSession(session) {
    if (session) liveSessions.add(session);
}

function unregisterLiveSession(session) {
    if (session) liveSessions.delete(session);
}

function countLiveProcesses() {
    let n = 0;
    for (const s of liveSessions) {
        if (s && !s.dead && s.proc) n++;
    }
    return n;
}

function countProcessesForLimit() {
    return countLiveProcesses() + spawnReservations;
}

function clearIdleTimer(entry) {
    if (entry && entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
}

function destroyIdleEntry(entry) {
    if (!entry) return;
    clearIdleTimer(entry);
    const session = entry.session;
    if (session) {
        try { session.destroy(); } catch (_) { /* ignore */ }
    }
}

/** 从所有池中移除并销毁该 session（用于超时回收） */
function reclaimIdleSession(session, reason) {
    if (!session) return false;
    const id = session.gameId;
    const idle = idlePool.get(id);
    if (!idle || !idle.length) {
        try { session.destroy(); } catch (_) { /* ignore */ }
        return true;
    }
    const idx = idle.findIndex((e) => e && e.session === session);
    if (idx < 0) return false;
    const [entry] = idle.splice(idx, 1);
    destroyIdleEntry(entry);
    if (!idle.length) idlePool.delete(id);
    else idlePool.set(id, idle);
    const why = reason || `空闲超过 ${IDLE_RECLAIM_MS / 60000} 分钟`;
    console.log(`[katago:${id}] ${why}，已回收进程`);
    return true;
}

/** 新建进程前清空全部空闲热池，避免「池里已占一份内存 + 再加载一份」拖死小机器 */
function reclaimAllIdle(reason) {
    const why = reason || '新建引擎前回收空闲进程';
    let n = 0;
    for (const [id, list] of idlePool) {
        if (!list || !list.length) continue;
        for (const entry of list.slice()) {
            if (!entry || !entry.session) continue;
            if (reclaimIdleSession(entry.session, `${why} (${id})`)) n += 1;
        }
    }
    return n;
}

/**
 * 回收其它棋类的空闲进程（最久空闲优先），为新建本棋类进程腾出名额。
 * @param {string} keepGameId
 * @returns {boolean} 是否回收到至少一个
 */
function reclaimOtherGamesIdle(keepGameId) {
    const keep = safeGameId(keepGameId);
    /** @type {{ id: string, entry: IdlePoolEntry }[]} */
    const candidates = [];
    for (const [id, list] of idlePool) {
        if (id === keep || !list || !list.length) continue;
        for (const entry of list) {
            if (entry && entry.session && !entry.session.dead && entry.session.proc) {
                candidates.push({ id, entry });
            }
        }
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => (a.entry.idleSince || 0) - (b.entry.idleSince || 0));
    const picked = candidates[0];
    return reclaimIdleSession(picked.entry.session, `为 ${keep || '?'} 腾出名额（跨棋类回收）`);
}

function scheduleIdleReclaim(entry) {
    clearIdleTimer(entry);
    entry.idleSince = Date.now();
    entry.timer = setTimeout(() => {
        entry.timer = null;
        // 仍在池中且确实空闲足够久才回收
        if (entry.session && entry.session._fromPool) {
            reclaimIdleSession(entry.session);
        }
    }, IDLE_RECLAIM_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
}

/**
 * 轻量预热：按对局路数 boardsize + kata-raw-nn（禁止 genmove）。
 * 必须与开局路数一致，否则 setupGame 再改路数会再次冷启动，首着仍然很慢。
 * @param {KatagoGtpSession} session
 * @param {{ boardSize?: number }} [opts]
 */
async function warmupSession(session, opts) {
    const rawSize = opts && opts.boardSize != null ? Number(opts.boardSize) : NaN;
    const boardSize = Number.isFinite(rawSize)
        ? Math.min(19, Math.max(2, rawSize | 0))
        : 19;
    // boardsize 若触发 NN 按路数重建，19 路可能远超 60s
    const boardsizeTimeoutMs = boardSize >= 15 ? 300000 : 120000;
    try {
        await session.command(`boardsize ${boardSize}`, { timeoutMs: boardsizeTimeoutMs });
        session.boardSize = boardSize;
        session._nnPrimedForSize = null;
        await session.command('clear_board', { timeoutMs: 30000 });
        // 已有其它存活 KataGo 时跳过 19 路 raw-nn，避免双进程同时推理把机器打满
        if (countLiveProcesses() <= 1) {
            await session.primeNn();
        } else {
            console.warn(`[katago:${session.gameId}] 已有 ${countLiveProcesses()} 个引擎存活，跳过 warmup kata-raw-nn`);
        }
    } catch (err) {
        console.warn(`[katago:${session.gameId}] warmup 失败:`, err && err.message ? err.message : err);
        try { session.destroy(); } catch (_) { /* ignore */ }
        throw err;
    }
    if (!session || session.dead || !session.proc) {
        throw new Error('KataGo warmup 后进程不可用');
    }
}

/**
 * 从本棋类空闲池取出一个可用 session（不新建）。
 * @param {string} id
 * @returns {Promise<KatagoGtpSession|null>}
 */
async function takeIdleSession(id) {
    const idle = idlePool.get(id) || [];
    while (idle.length) {
        const entry = idle.pop();
        if (!entry) continue;
        clearIdleTimer(entry);
        const session = entry.session;
        if (session && !session.dead && session.proc) {
            session._fromPool = false;
            try {
                await session.command('clear_board');
                idlePool.set(id, idle);
                return session;
            } catch (_) {
                try { session.destroy(); } catch (e) { /* ignore */ }
            }
        } else if (session) {
            try { session.destroy(); } catch (_) { /* ignore */ }
        }
    }
    idlePool.set(id, idle);
    return null;
}

/**
 * @param {string} id
 * @param {{ boardSize?: number }} [opts]
 */
async function spawnNewSession(id, opts) {
    // 先丢掉空闲热池（含其它棋类），再加载新模型，降低双模型并行加载导致的 GTP ready 超时
    reclaimAllIdle('新建引擎前回收空闲进程');
    while (countProcessesForLimit() >= GLOBAL_PROCESS_LIMIT) {
        if (!reclaimOtherGamesIdle(id)) {
            throw new KatagoBusyError(KATAGO_BUSY_MESSAGE);
        }
    }
    spawnReservations += 1;
    const session = new KatagoGtpSession(id);
    try {
        await session.start();
        await warmupSession(session, opts);
        session._fromPool = false;
        return session;
    } catch (err) {
        try { session.destroy(); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        spawnReservations -= 1;
    }
}

/**
 * 取得可用引擎：优先复用空闲进程，否则在全局上限内启动并预热。
 * 达上限且本棋类无空闲时，先回收其它棋类空闲进程；活跃达上限则抛 KatagoBusyError。
 * @param {string} gameId
 * @param {{ boardSize?: number }} [opts]
 * @returns {Promise<KatagoGtpSession>}
 */
/**
 * 只读快速检查：当前能否立即取得引擎（进程未满、本棋类池有空闲、或其它棋类池有可回收空闲）。
 * 不 spawn、不销毁任何进程；用于开局前拦截"服务器繁忙"，避免先开局再回滚。
 * @param {string} gameId
 */
function canAcquireKatagoNow(gameId) {
    const id = safeGameId(gameId);
    if (!id || !isKatagoAvailable(id)) return false;
    if (countProcessesForLimit() < GLOBAL_PROCESS_LIMIT) return true;
    const idle = idlePool.get(id);
    if (idle && idle.some((e) => e && e.session && !e.session.dead && e.session.proc)) return true;
    for (const [gid, list] of idlePool) {
        if (gid === id || !list || !list.length) continue;
        if (list.some((e) => e && e.session && !e.session.dead && e.session.proc)) return true;
    }
    return false;
}

function acquireKatagoSession(gameId, opts) {
    return enqueueLifecycle(async () => {
        const id = safeGameId(gameId);
        if (!id || !isKatagoAvailable(id)) {
            throw new Error('KataGo 不可用');
        }
        const reused = await takeIdleSession(id);
        if (reused) return reused;
        // 同棋类若仍有空闲（并发窗口残留），优先回收后复用，避免无谓双开
        return spawnNewSession(id, opts || {});
    });
}

/**
 * 归还引擎到热池（不杀进程）；池满或异常则销毁。
 * 空闲超过 IDLE_RECLAIM_MS 自动回收。
 * 与 acquire 共用 lifecycleQueue，保证「归还进池」完成后才可能新建进程。
 * @param {KatagoGtpSession|null|undefined} session
 * @returns {Promise<void>}
 */
function releaseKatagoSession(session) {
    if (!session) return Promise.resolve();
    return enqueueLifecycle(async () => {
        if (session.dead || !session.proc) {
            try { session.destroy(); } catch (_) { /* ignore */ }
            return;
        }
        const id = session.gameId;
        // 丢弃尚未发出的命令；正在执行的（如 genmove）等其结束后再 clear，避免应答错位
        const dropErr = new Error('KataGo 已归还');
        while (session.queue.length) {
            session.queue.shift().reject(dropErr);
        }
        try {
            await session.command('clear_board');
        } catch (_) {
            try { session.destroy(); } catch (e) { /* ignore */ }
            return;
        }
        if (session.dead || !session.proc) return;
        const idle = idlePool.get(id) || [];
        if (idle.length >= IDLE_POOL_MAX_PER_GAME) {
            try { session.destroy(); } catch (_) { /* ignore */ }
            return;
        }
        session._fromPool = true;
        const entry = { session, idleSince: Date.now(), timer: null };
        idle.push(entry);
        idlePool.set(id, idle);
        scheduleIdleReclaim(entry);
    });
}

module.exports = {
    BOARD_CELL,
    IDLE_RECLAIM_MS,
    GLOBAL_PROCESS_LIMIT,
    KATAGO_BUSY_MESSAGE,
    KatagoBusyError,
    isKatagoBusyError,
    isKatagoAvailable,
    canAcquireKatagoNow,
    KatagoGtpSession,
    acquireKatagoSession,
    releaseKatagoSession,
    toGtpVertex,
    fromGtpVertex,
    fromGtpMove
};
