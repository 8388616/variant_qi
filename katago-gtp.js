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
 * 引擎文件的指纹（gtp.cfg 与二进制的路径+大小+改动时间）：进程启动时记一份，取用池中空闲进程时
 * 再算一次，不一致就把老进程作废——「改了 cfg / 换了二进制却没生效」几乎都是老进程还在跑。
 * 取不到时返回 null（不比较，不误杀）。
 */
function engineFilesStamp(id) {
    const dir = resolveKatagoDir(id);
    if (!dir) return null;
    const parts = [];
    try {
        const cfg = path.join(dir, 'gtp.cfg');
        if (fs.existsSync(cfg)) { const st = fs.statSync(cfg); parts.push(`cfg:${st.size}:${st.mtimeMs}`); }
        const exe = findKatagoExecutable(dir);
        if (exe) { const st = fs.statSync(exe); parts.push(`exe:${st.size}:${st.mtimeMs}`); }
    } catch (_) {
        return null;
    }
    return parts.length ? parts.join('|') : null;
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

/**
 * gtp.cfg 里的 maxVisits（人机「棋力」档位用：初级 = 1、中级 = 这里读到的值）。
 * 读不到（文件缺失/没写这项）返回 null。
 * **按 mtime+大小缓存**：改了配置文件后新开的对局就能读到新值，**不用重启服务端**
 * （每局开始都会 `kata-set-param maxVisits N` 覆盖引擎进程启动时读的旧值；引擎自身仍按启动时的 cfg）。
 */
const _cfgMaxVisitsCache = new Map();
function readConfigMaxVisits(gameId) {
    const id = safeGameId(gameId);
    const dir = resolveKatagoDir(id);
    let cfgPath = null;
    let stat = null;
    if (dir) {
        cfgPath = path.join(dir, 'gtp.cfg');
        try { stat = fs.statSync(cfgPath); } catch (_) { stat = null; }
    }
    const stamp = stat ? `${stat.mtimeMs}:${stat.size}` : 'none';
    const hit = _cfgMaxVisitsCache.get(id);
    if (hit && hit.stamp === stamp) return hit.value;
    let value = null;
    if (stat) {
        try {
            // 宽松一点：允许行尾注释与空格（`maxVisits = 500  # 注释`）
            const m = String(fs.readFileSync(cfgPath, 'utf8')).match(/^[ \t]*maxVisits[ \t]*=[ \t]*([0-9]+)\b/m);
            if (m) value = parseInt(m[1], 10);
        } catch (_) {
            value = null;
        }
    }
    _cfgMaxVisitsCache.set(id, { stamp, value });
    return value;
}

/** 非方形棋盘（如开罗五角围棋）时 boardHeight 为行数；缺省与 boardSize（宽）相同。
 *  坐标约定：row=0 为棋盘最低行（界面自下而上编号 1..N）。
 *  映射到 GTP 行号 = 路数 − row，即 row 0 → A19：站点行号与 GTP 行号方向相反，
 *  整盘是一致地垂直翻转；发盘面（本函数）与回读着法（fromGtpVertex）都走这一映射，收发对称。 */
function toGtpVertex(row, col, boardSize, boardHeight) {
    if (row == null || col == null) return 'pass';
    const h = boardHeight || boardSize;
    if (col < 0 || col >= boardSize || row < 0 || row >= h) return null;
    return gtpColLetters(col) + String(h - row);
}

function fromGtpVertex(vertex, boardSize, boardHeight) {
    if (vertex == null) return { pass: true };
    const s = String(vertex).trim();
    if (!s || /^pass$/i.test(s)) return { pass: true };
    // 认输单独标出来：网站目前按虚着处理，但**必须让上层能看见**（否则日志里就是「莫名虚着」）
    if (/^resign$/i.test(s)) return { pass: true, resign: true };
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
 * @returns {{ pass: true, resign?: true } | { pass: false, row: number, col: number } | { pass: false, swap: true, aRow: number, aCol: number, bRow: number, bCol: number } | null}
 */
function fromGtpMove(raw, boardSize, boardHeight) {
    if (raw == null) return { pass: true };
    const s = String(raw).trim();
    if (!s || /^pass$/i.test(s)) return { pass: true };
    // 认输单独标出来：网站目前按虚着处理，但**必须让上层能看见**（否则日志里就是「莫名虚着」）
    if (/^resign$/i.test(s)) return { pass: true, resign: true };
    // 复合棋子着法（罗斯围棋等）：`rs <anchorX> <anchorY> <shapeIdx> <orientIdx>`
    //   anchor 为 0 基坐标、y 自上而下（与普通 GTP 字母坐标的 y 翻转不同，不能走 fromGtpVertex）
    const rs = s.match(/^rs\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/i);
    if (rs) {
        const anchorCol = parseInt(rs[1], 10);
        const anchorRow = parseInt(rs[2], 10);
        const shapeIdx = parseInt(rs[3], 10);
        const orientIdx = parseInt(rs[4], 10);
        if (Number.isFinite(anchorRow) && Number.isFinite(anchorCol) && Number.isFinite(shapeIdx) && Number.isFinite(orientIdx)) {
            return { pass: false, compound: true, anchorRow, anchorCol, shapeIdx, orientIdx };
        }
        return null;
    }
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

/**
 * 调试用：`QI_KATAGO_LOG=1` 时把 GTP 往来打到服务端日志（长响应只打前 300 字；kata-raw-nn 只打命令）。
 * 排查「引擎乱下/莫名虚着」时，这一份往来是最直接的证据。
 */
function gtpTrafficLog(gameId, cmd, resp, isErr) {
    if (!process.env.QI_KATAGO_LOG) return;
    const c = String(cmd);
    if (/^kata-raw-nn\b/.test(c)) { console.log(`[gtp:${gameId}] > ${c}`); return; }
    let out;
    if (isErr) out = '!! ' + (resp && resp.message ? resp.message : String(resp));
    else {
        const t = String(resp == null ? '' : resp).replace(/\s+/g, ' ').trim();
        out = t.length > 300 ? t.slice(0, 300) + ` …(共 ${t.length} 字)` : t;
    }
    console.log(`[gtp:${gameId}] > ${c}`);
    console.log(`[gtp:${gameId}] < ${out}`);
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
        /** 上次同步后引擎着法史应有的手数（set_position 之后实际喂进去的着手数）；null = 未知，自检跳过 */
        this.lastSyncMoveNum = null;
        /** 上次同步时网站的着法表长度（与 lastSyncMoveNum 配对，用来推算此刻应有的手数） */
        this.lastSyncSiteMoveCount = null;
        /** 最近一次实际下发的易位配额（kata-set-max-translocation-moves）；null = 没下发过 */
        this.lastTranslocationBudget = null;
        /** 本次同步是否走了整段着法重放（= 网站着法表就是纯引擎着手序列，手数才可逐手比对） */
        this.lastSyncReplayed = false;
        /** 最近一次下发的 kata-set-move-number 值（先一各二围棋的轮次排程基准） */
        this.lastMoveNumberSent = null;
        /** 引擎不支持 kata-set-move-number（老引擎）：探测一次后不再尝试 */
        this.noMoveNumberCommand = false;
        /** 站点坐标 → 引擎网格坐标（只有坐标系不同的棋盘需要，如六角围棋；默认 null = 1:1） */
        this.coordOf = null;
        /** 本进程启动时的 gtp.cfg/二进制指纹（见 engineFilesStamp）：变了就作废重开 */
        this.filesStamp = null;
        /** 引擎网格坐标 → 站点坐标（上者的逆） */
        this.coordInverse = null;
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
        const lines = block.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
        const first = (lines[0] || '').trim();
        // 分析命令（kata-search_analyze 等）持续输出 info 行：处于收集模式时先记录下来
        // （须在 pending 检查之前：analyzeMoves 直接写 stdin 时无 pending）
        // 非响应行：不是 GTP 应答就当「引擎自己的输出」打出来 —— KataGo 的致命错误走的是
        // **stdout**（core/global.cpp 的 fatalError 打到 cout 后 quick_exit(1)），不记下来就只剩
        // 一句「KataGo 已退出 code=1」什么都查不到（2026-10-01 吃子围棋那次就是）。
        if (!first.startsWith('=') && !first.startsWith('?')) {
            const t = block.trim();
            if (t) console.error(`[katago:${this.gameId}] 引擎输出(非 GTP 应答)：${t.slice(0, 600)}`);
            return;
        }
        this._finishPending(first, lines);
    }

    _finishPending(first, lines) {
        if (!this.pending) return;
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
                    gtpTrafficLog(this.gameId, entry.cmd, v, false);
                    resolve(v);
                },
                reject: (e) => {
                    this._clearEntryTimer(entry);
                    gtpTrafficLog(this.gameId, entry.cmd, e, true);
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
     * 取模型策略网络的前 N 个落子点（AI 候选）。
     * 用 kata-raw-nn all（gtp.cpp rawNN）：同步命令、标准 `=` 响应（与 genmove 一样
     * 简单可靠），输出当前局面下策略网络的全部先验概率，按棋盘扫描序排列
     * （第 i 个概率 = 第 i 个交点；y 从顶向下、x 从左向右，与服务器 board[row][col] 对应）。
     * genmove（cfg maxVisits=1）会选先验最高的点 = 本方法返回的第 1 个点，对电脑对战一致。
     * @param {number} boardSize 棋盘路数
     * @param {{ minMoves?: number }} [opts] 需要的候选数
     * @returns {Promise<Array<{row:number, col:number}>>} 按先验概率降序的前 N 个点
     */
    async analyzeMoves(boardSize, opts) {
        const need = (opts && Number.isFinite(Number(opts.minMoves)))
            ? Math.max(1, Number(opts.minMoves) | 0)
            : 3;
        if (!this.proc || this.dead) throw new Error('KataGo 未运行');
        const resp = await this.command('kata-raw-nn all');
        const lines = String(resp).split('\n');
        // 解析 policy 网格：`policy` 行后、`policyPass` 行前，每行一个棋盘的 x_size 个概率
        const probs = [];
        let inPolicy = false;
        for (const line of lines) {
            const t = String(line).trim();
            if (!t) continue;
            if (t.startsWith('policyPass')) break;
            if (inPolicy) {
                for (const tok of t.split(/\s+/)) {
                    if (!tok) continue;
                    const p = parseFloat(tok);
                    // 被占位置输出 NAN：保留占位（记 -1，排序垫底），否则数组错位、
                    // 之后所有坐标偏移一格，候选点看起来像随机
                    probs.push(Number.isFinite(p) ? p : -1);
                }
            } else if (t === 'policy') {
                inPolicy = true;
            }
        }
        const size = boardSize | 0;
        return probs
            .map((p, i) => ({ p, row: Math.floor(i / size), col: i % size }))
            .filter(v => v.row >= 0 && v.row < size && v.col >= 0 && v.col < size)
            .sort((a, b) => b.p - a.p)
            .slice(0, need)
            .map(v => ({ row: v.row, col: v.col }));
    }

    /**
     * 校验权重真的进了引擎：kata-get-weights 回读归一化权重，核对数量、是否全相等、最高权重点位置。
     * 老引擎没有该命令时静默跳过（无法校验，不代表失败）；校验不通过只告警、不打断对局。
     * @param {number[]} rawWeights 刚下发的原始权重（row-major）
     */
    async verifyWeights(rawWeights) {
        let resp;
        try {
            resp = await this.command('kata-get-weights');
        } catch (_) {
            return;   // 引擎不支持回读（旧版），跳过校验
        }
        const got = String(resp).trim().split(/\s+/).map(Number).filter((v) => Number.isFinite(v));
        if (got.length !== rawWeights.length) {
            console.warn(`[katago:${this.gameId}] 权重校验失败：回读 ${got.length} 个，期望 ${rawWeights.length} 个`);
            return;
        }
        if (got.every((v) => v === got[0])) {
            console.warn(`[katago:${this.gameId}] 权重校验失败：引擎回读的权重全相等（等于没设权重），本局将按均权下棋`);
            return;
        }
        const argmax = (arr) => { let bi = 0; for (let i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i; return bi; };
        if (argmax(got) !== argmax(rawWeights)) {
            console.warn(`[katago:${this.gameId}] 权重校验失败：引擎权重与下发不一致（最高权重点 ${argmax(got)} ≠ ${argmax(rawWeights)}）`);
        }
    }

    /**
     * 回读引擎当前局面（showboard）：棋子分布、行棋方、引擎着法史手数，供上层与服务端盘面比对。
     * 行序与站点 row 一致（引擎内部 y=0 即站点 row 0）；X/O 为棋子，./@ 为空点，'#' 为墙（记 -9）。
     * 墙包括蜂窝盘的盘外格、桥围棋的桥格；上层按棋种及站点格类型比对。行数/行长不符则返回 null
     * （不误报）。任何异常都返回 null：自检不能影响对局。
     * 六角盘也走这里：`boardsize 31:32` 下每行恰好 31 格（含墙），行宽能对上，自检照常生效。
     * moveNum = `BoardHistory::printBasicInfo` 打印的 `MoveNum:`（= `moveHistory.size()`，即
     * set_position 之后引擎实际收到的着手数）：整段重放正常时应当等于网站着法表长度，
     * 对不上就是「盘面/行棋方看着都对、引擎着法史其实丢了」——那正是引擎乱提议（被网站驳回成虚着）
     * 的根因。旧引擎不打这一行 → moveNum 为 null，跳过该项检查。
     * @param {number} expectRows 期望行数（棋盘行数）
     * @param {number} expectCols 期望列数
     * @returns {Promise<{stones: number[][], nextPlayer: ('black'|'white'|null), moveNum: (number|null)}|null>}
     */
    async probeBoard(expectRows, expectCols) {
        let resp;
        try {
            resp = await this.command('showboard');
        } catch (_) {
            return null;
        }
        const rows = [];
        let nextPlayer = null;
        let moveNum = null;
        for (const raw of String(resp).split('\n')) {
            const line = raw.replace(/\r/g, '');
            const mNext = line.match(/Next player:\s*(\w+)/i);
            if (mNext) {
                const v = mNext[1].toUpperCase();
                nextPlayer = v.startsWith('B') ? 'black' : (v.startsWith('W') ? 'white' : null);
                continue;
            }
            // MoveNum 头：`MoveNum: 12 HASH: …`（printBoard 在传了着法史时打印）
            if (/^MoveNum:/.test(line)) {
                const mNum = line.match(/MoveNum:\s*(\d+)/);
                if (mNum) moveNum = Number(mNum[1]);
                continue;
            }
            // 棋盘行必须按**固定宽度**切格：`Board::printBoard`（board.cpp）对最近三手的棋子
            // 会紧跟着打印标记数字、**且该格后面不补空格**，于是与下一格黏成 `X1.` / `O2.` 这种 token。
            // 用 split(/\s+/) 切会让格数变少（整行对不上 expectCols → 回 null → 自检静默失效，实为从未生效）。
            // 每格恒为 2 字元（色字元 + 标记数字或空白；末格可能只有 1 字元），故直接按 2 字元步进。
            const mRow = line.match(/^\s*\d+\s(.*)$/);
            if (!mRow) continue;
            const rest = mRow[1].replace(/\s+$/, '');
            const cells = [];
            for (let i = 0; i < rest.length; i += 2) {
                const ch = rest[i];
                // C_WALL 印成 '#'：六角盘的盘外格、桥围棋的桥等，占一格但不可落子。
                // 单列出来当哨兵，由上层核对结构格；站点实点若映到墙上也要能发现。
                if (ch === '#') { cells.push(-9); continue; }
                if (ch !== 'X' && ch !== 'O' && ch !== '.' && ch !== '@') continue;
                cells.push(ch === 'X' ? 1 : (ch === 'O' ? 2 : 0));
            }
            rows.push(cells);
        }
        if (!rows.length) return null;
        if (Number.isFinite(expectRows) && rows.length !== expectRows) return null;
        for (const r of rows) {
            if (Number.isFinite(expectCols) && r.length !== expectCols) return null;
        }
        return { stones: rows, nextPlayer, moveNum };
    }

    /**
     * 回读引擎当前局面的易位配额（kata-get-max-translocation-moves）。
     * 引擎侧它就是 `BoardHistory::maxTranslocationMoves`（相位总长，绝对手数）；网站每次同步都会
     * 下发自己的值，所以这里回读应当等于**网站最近一次下发的值**（见 lastTranslocationBudget）。
     * 非易位引擎 / 旧引擎没有该命令 → 返回 null，跳过检查。
     * @returns {Promise<number|null>}
     */
    async probeTranslocationMax() {
        let resp;
        try {
            resp = await this.command('kata-get-max-translocation-moves');
        } catch (_) {
            return null;
        }
        const m = String(resp).match(/-?\d+/);
        if (!m) return null;
        const v = Number(m[0]);
        return Number.isFinite(v) ? v : null;
    }

    /**
     * 回读引擎当前的每点权重（kata-get-weights，归一化值，y 升序 = 站点 row 序）。
     * 只返回概要，供「对局中途权重是否还在」的自检用；旧引擎/异常返回 null（不误报）。
     * 纯文本命令、不做推理，每手调用也很便宜。
     * @returns {Promise<{count: number, allEqual: boolean, argmax: number, max: number}|null>}
     */
    async probeWeights() {
        let resp;
        try {
            resp = await this.command('kata-get-weights');
        } catch (_) {
            return null;
        }
        const vals = String(resp).trim().split(/\s+/).map(Number).filter((v) => Number.isFinite(v));
        if (!vals.length) return null;
        let argmax = 0;
        for (let i = 1; i < vals.length; i++) {
            if (vals[i] > vals[argmax]) argmax = i;
        }
        return { count: vals.length, allEqual: vals.every((v) => v === vals[0]), argmax, max: vals[argmax] };
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
     * @param {{ boardSize: number, komi: number, board: number[][], gameId?: string, maxTranslocationMoves?: number, weights?: number[][] }} opts
     */
    async setupGame(opts) {
        // 坐标映射（六角围棋这类「引擎网格 ≠ 站点网格」的棋盘）：由棋种提供，见 games/non-rectangular-weiqi.js
        this.coordOf = (opts && typeof opts.coordOf === 'function') ? opts.coordOf : null;
        this.coordInverse = (opts && typeof opts.coordInverse === 'function') ? opts.coordInverse : null;
        const boardWidth = (opts.boardWidth | 0) || (opts.boardSize | 0);
        const boardHeight = (opts.boardHeight | 0) || boardWidth;
        const komi = Number(opts.komi);
        // 同步期间先作废「引擎着法史手数」基准：中途抛错时基于陈旧基准的判断会误报（见 verifyEngineState）
        this.lastSyncMoveNum = null;
        this.lastSyncSiteMoveCount = null;
        this.lastSyncReplayed = false;
        // 轮到白时（opts.lastMove）：最后一手不 set_position（set_position 后引擎行棋方恒为黑，
        // 重放最后一手才能翻转为白），先把这一手从盘面上撤掉，重放时才合法
        const lastMove = opts.lastMove || null;
        let board = opts.board;
        if (lastMove && Array.isArray(board)) {
            board = board.map((r) => r.slice());
            if (lastMove.type === 'swap' && Number.isInteger(lastMove.fromRow) && Number.isInteger(lastMove.fromCol)
                && Number.isInteger(lastMove.row) && Number.isInteger(lastMove.col)) {
                // 易位：把两端换回去（易位是自逆的），否则重放 `play B ts A B` 时引擎看到的
                // 是「一端空着」的盘面 → 报 illegal move（只清落点那颗子是不够的）
                const a = board[lastMove.fromRow];
                const b = board[lastMove.row];
                if (a && b && a[lastMove.fromCol] !== undefined && b[lastMove.col] !== undefined) {
                    const tmp = a[lastMove.fromCol];
                    a[lastMove.fromCol] = b[lastMove.col];
                    b[lastMove.col] = tmp;
                }
            } else if (Array.isArray(lastMove.stones)) {
                for (const [r, c] of lastMove.stones) {
                    if (board[r] && board[r][c] !== undefined) board[r][c] = 0;
                }
            } else if (Number.isInteger(lastMove.row) && Number.isInteger(lastMove.col)) {
                if (board[lastMove.row] && board[lastMove.row][lastMove.col] !== undefined)
                    board[lastMove.row][lastMove.col] = 0;
            }
        }
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
        await this.disableResignation();

        // 权重围棋：kata-set-weights w0 w1 … w(N-1)——引擎要求盘上无子，故须在 clear_board
        // 之后、set_position 之前发送。展开顺序与棋子天然一致（2026-09 对引擎源码核实）：
        // toGtpVertex 给出 GTP 行号 = 路数 − row，引擎内部 y = 路数 − 行号 = row
        // （`Location::tryOfString` / `toString`），`Board::setWeights` 读 rawWeights[y*x + x]，
        // 故 weights[row][col] 自 row 0 起逐行拼接即与棋子同向对齐、不需翻转。
        // 不支持该命令的引擎返回错误（告警，见下）。
        if (Array.isArray(opts.weights)) {
            const flat = [];
            for (let r = 0; r < boardHeight; r++) {
                const row = opts.weights[r];
                for (let c = 0; c < boardWidth; c++) {
                    const v = Number(row && row[c]);
                    flat.push(Number.isFinite(v) ? v : 1);
                }
            }
            if (flat.length === boardWidth * boardHeight) {
                let weightsOk = false;
                try {
                    await this.command(`kata-set-weights ${flat.join(' ')}`);
                    weightsOk = true;
                } catch (err) {
                    // 权重没同步成功 = 引擎按均权（普通围棋）判断：权重局里会明显「棋力暴跌」，必须显式告警
                    console.warn(`[katago:${this.gameId}] kata-set-weights 未生效，本局引擎将按均权下棋：${err && err.message ? err.message : err}`);
                }
                // 回读校验放在 try 之外：校验失败只告警，不会被误报成「下发失败」
                if (weightsOk) await this.verifyWeights(flat);
            } else {
                console.warn(`[katago:${this.gameId}] 权重数量 ${flat.length} 与棋盘 ${boardWidth}×${boardHeight} 不符，未同步权重`);
            }
        }

        // 着法历史重放（棋种声明 katagoReplayHistory 时由上层给出）：set_position 会把引擎的对局历史清零
        // （禁全同知识、重复局面罚分、虚着计数全丢），把整段着法一手手重放回去能一并还原。
        // 此时基准盘面是**开局盘面**（棋子由重放摆回来），行棋方也由重放自然得出，不需要 lastMove 那套翻转技巧。
        const replayHistory = Array.isArray(opts.replayHistory) ? opts.replayHistory : null;
        const baseBoard = (replayHistory && replayHistory.length && Array.isArray(opts.initialBoard))
            ? opts.initialBoard
            : board;

        // 网站着法表长度（与 opts.board 同一时刻）：自检据此推算引擎着法史应有的手数
        const siteCount = Number.isFinite(Number(opts.moveCount)) ? (Number(opts.moveCount) | 0) : null;
        await this.syncPositionAndBudget(baseBoard, opts);
        if (replayHistory && replayHistory.length) {
            let replayed = false;
            let idx = 0;
            try {
                for (idx = 0; idx < replayHistory.length; idx++) {
                    await this.playReplayEntry(replayHistory[idx]);
                }
                replayed = true;
            } catch (err) {
                console.warn(`[katago:${this.gameId}] 着法重放失败（第 ${idx + 1}/${replayHistory.length} 手），`
                    + `退回整盘快照同步：${err && err.message ? err.message : err}`);
            }
            if (replayed) {                              // 重放成功：盘面/行棋方/历史都对上了
                this.lastSyncMoveNum = replayHistory.length;
                this.lastSyncSiteMoveCount = siteCount;
                this.lastSyncReplayed = true;            // 着法表 = 纯引擎着手序列（自检才敢按手数比对）
                // 先一各二围棋：重放后引擎自己数得对（这条等于空跑），但轮到「同一个人连走两手」的
                // 中间那一手时，重放推不出站点的手数基准，还是显式对齐一次最稳。
                if (siteCount != null) await this.setMoveNumberAlreadyPlayed(siteCount);
                return;
            }
            await this.syncPositionAndBudget(board, opts);   // 退回：用最终盘面重设，再按老办法补最后一手
        }

        // 重放最后一手：set_position 后引擎行棋方恒为黑，只有轮到白时才需要。
        // 单条被拒（如该手带提子的易位还原不回来）不能让整次同步失败：盘面已经设对了，
        // 引擎行棋方下次 genmove 时自己会校正（setPlayerAndClearHistory），只是那一刻丢了历史。
        if (lastMove && (lastMove.player === 'black' || lastMove.player === 'white')) {
            try {
                const color = slotToGtpColor(lastMove.player);
                if (lastMove.type === 'pass') {
                    await this.command(`play ${color} pass`);
                } else if (lastMove.type === 'swap' && Number.isInteger(lastMove.fromRow) && Number.isInteger(lastMove.fromCol)
                    && Number.isInteger(lastMove.row) && Number.isInteger(lastMove.col)) {
                    // 易位围棋：`play B ts A B`（与 genmove 输出同格式，见引擎 Location::toString/tryOfString）
                    await this.playSwap(color, lastMove.fromRow, lastMove.fromCol, lastMove.row, lastMove.col);
                } else if (Number.isInteger(lastMove.shapeIndex) && Number.isInteger(lastMove.row) && Number.isInteger(lastMove.col)) {
                    await this.playCompound(color, lastMove.row, lastMove.col, lastMove.shapeIndex, lastMove.orientIdx);
                } else if (Number.isInteger(lastMove.row) && Number.isInteger(lastMove.col)) {
                    await this.play(color, lastMove.row, lastMove.col);
                }
                this.lastSyncMoveNum = 1;                   // 引擎只收到 set_position + 这一手
                this.lastSyncSiteMoveCount = siteCount;
            } catch (err) {
                console.warn(`[katago:${this.gameId}] 末手重放被引擎拒绝（盘面已设对，行棋方待引擎自行校正）：`
                    + `${err && err.message ? err.message : err}`);
                // 这一手没进引擎 → 手数基准不可用（别拿它当真，否则自检会一路误报）
                this.lastSyncMoveNum = null;
                this.lastSyncSiteMoveCount = null;
            }
        } else {
            this.lastSyncMoveNum = 0;                       // 只发了 set_position，引擎着法史为空
            this.lastSyncSiteMoveCount = siteCount;
        }

        // 先一各二围棋（fotte-weiqi）：这一盘到目前已经下过几手要告诉引擎，它的「第一位连走两手」
        // 轮次排程才和站点一致（第 1 手黑、之后同一人连走两手；摆在盘上的开局子不算手数）。
        // 整段重放时引擎自己数得对（这条等于空跑），快照同步/中途导入时才是必需的。
        // 老引擎没有这条命令 → 探测一次就记下，之后不再发（其他棋种完全不受影响）。
        if (siteCount != null) await this.setMoveNumberAlreadyPlayed(siteCount);
    }

    /**
     * 「这一盘到目前已经下过几手」（GTP 扩展 `kata-set-move-number`，先一各二围棋的轮次排程用）。
     * 引擎侧只改手数偏移（initialTurnNumber）与行棋方，不动盘面/历史；不支持该命令的引擎返回 false。
     * @param {number} n 已经下过的**着手数**（含虚着，不含开局摆在盘上的子、不含接下来这一手）
     * @returns {Promise<boolean>} 引擎是否接受
     */
    async setMoveNumberAlreadyPlayed(n) {
        if (this.noMoveNumberCommand) return false;
        const v = Math.max(0, Math.floor(Number(n) || 0));
        try {
            await this.command(`kata-set-move-number ${v}`);
            this.lastMoveNumberSent = v;
            return true;
        } catch (err) {
            this.noMoveNumberCommand = true;   // 老引擎没有这条命令：本次会话不再尝试
            return false;
        }
    }

    /**
     * 同步整盘位置 + 易位配额（set_position 一段）。
     * @param {number[][]} board 要发过去的盘面
     * @param {{ maxTranslocationMoves?: number }} opts 同一份 opts（读易位配额）
     */
    async syncPositionAndBudget(board, opts) {
        const boardWidth = (this.boardWidth | 0);
        const boardHeight = (this.boardHeight | 0) || boardWidth;
        // 结构洞棋盘（非方形，如开罗五角）：无效格由引擎按尺寸自动识别（C_WALL），不传 -1
        const structuralHoles = boardWidth !== boardHeight;
        const pairs = [];
        if (Array.isArray(board)) {
            for (let r = 0; r < boardHeight; r++) {
                const row = board[r];
                if (!row) continue;
                for (let c = 0; c < boardWidth; c++) {
                    const v = row[c];
                    const vertex = this.vertexOfSite(r, c, boardWidth, boardHeight);
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
        if (opts && opts.maxTranslocationMoves != null && Number.isFinite(Number(opts.maxTranslocationMoves))) {
            const n = Math.max(0, Number(opts.maxTranslocationMoves) | 0);
            try {
                await this.command(`kata-set-max-translocation-moves ${n}`);
                this.lastTranslocationBudget = n;   // 自检据此回读核对（probeTranslocationMax）
            } catch (_) { /* 非易位引擎 */ }
        }
    }

    /**
     * 重放着法历史里的一手（`{ type:'move'|'swap'|'compound'|'pass', color, … }`）。
     * 未知类型直接抛错 → 上层退回整盘快照同步（宁可丢历史也不能同步错局面）。
     */
    async playReplayEntry(mv) {
        // 注意 play/playSwap/playCompound 收的是**座位色**（'black'/'white'），只有 pass 这里直接拼 GTP 字母；
        // 早先版本把转好的 'W'/'B' 又喂回 play()（内部再转一次）→ 白棋被写成黑棋。
        const slotColor = mv && (mv.color === 'white' || mv.color === 'black') ? mv.color : null;
        if (!slotColor) throw new Error('着法缺颜色');
        if (mv.type === 'pass') {
            await this.command(`play ${slotToGtpColor(slotColor)} pass`);
            return;
        }
        if (mv.type === 'swap') {
            await this.playSwap(slotColor, mv.fromRow, mv.fromCol, mv.row, mv.col);
            return;
        }
        if (mv.type === 'compound') {
            await this.playCompound(slotColor, mv.row, mv.col, mv.shapeIndex, mv.orientIdx);
            return;
        }
        if (mv.type === 'move') {
            await this.play(slotColor, mv.row, mv.col);
            return;
        }
        throw new Error(`不支持的着法类型 ${mv.type}`);
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

    /** 站点坐标 → GTP 顶点：有坐标映射（六角等）时先换算成引擎网格坐标；非法点返回 null */
    vertexOfSite(row, col, boardWidth, boardHeight) {
        const e = this.coordOf ? this.coordOf(row, col) : { row, col };
        if (!e) return null;
        return toGtpVertex(e.row, e.col, boardWidth, boardHeight);
    }

    async play(slot, row, col) {
        const color = slotToGtpColor(slot);
        if (row == null && col == null) {
            await this.command(`play ${color} pass`);
            return;
        }
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        const vertex = this.vertexOfSite(row, col, bs, bh);
        if (!vertex) throw new Error('无效坐标');
        await this.command(`play ${color} ${vertex}`);
    }

    /** 复合棋子着法：`play B rs <ax> <ay> <shapeIdx> <orientIdx>`（0 基、y 自上而下） */
    async playCompound(slot, anchorRow, anchorCol, shapeIdx, orientIdx) {
        const color = slotToGtpColor(slot);
        await this.command(`play ${color} rs ${anchorCol} ${anchorRow} ${shapeIdx} ${orientIdx}`);
    }

    /** 易位：`play B ts D4 D5`（两端顺序任意，引擎按行棋方颜色定向） */
    async playSwap(slot, fromRow, fromCol, toRow, toCol) {
        const color = slotToGtpColor(slot);
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        const from = this.vertexOfSite(fromRow, fromCol, bs, bh);
        const to = this.vertexOfSite(toRow, toCol, bs, bh);
        if (!from || !to) throw new Error('无效易位坐标');
        await this.command(`play ${color} ts ${from} ${to}`);
    }

    async genMove(slot) {
        const color = slotToGtpColor(slot);
        const raw = await this.command(`genmove ${color}`, { timeoutMs: GENMOVE_TIMEOUT_MS });
        const bs = this.boardWidth || (this.boardSize | 0);
        const bh = this.boardHeight || bs;
        const mv = fromGtpMove(raw, bs, bh);
        if (mv && !mv.pass && !mv.swap && !mv.compound && this.coordInverse) {
            const site = this.coordInverse(mv.row, mv.col);
            if (!site) return { pass: true };   // 引擎报了个不在本站盘面上的点（不该发生）：当虚着
            mv.row = site.row;
            mv.col = site.col;
        }
        return mv;
    }

    /**
     * 设置本会话的搜索量（人机棋力：初级 1、中级 = 配置值）。
     * 用 kata-set-param（KataGo 扩展命令）；失败不抛，继续用配置文件里的值。
     */
    async setMaxVisits(n) {
        const v = Math.max(1, Math.floor(Number(n) || 1));
        this.maxVisits = v;
        try {
            await this.command(`kata-set-param maxVisits ${v}`);
        } catch (err) {
            console.warn('[katago] kata-set-param maxVisits 失败，按配置文件的值继续：', err && err.message);
        }
        return v;
    }

    /**
     * 关掉引擎自带的认输（genmove 返回 'resign'）。本站约定**电脑永远不认输**：
     * 各子棋类的 gtp.cfg 都显式写了 allowResignation = false（该配置默认 false，但抄 example
     * 或漏写时会变成 true），这里在会话内再用 kata-set-param 兜一层，与 cfg 无关地生效。
     * 起因（2026-10-13 用户报）：翻转围棋电脑大优却突然认输——引擎自评落后就 resign，
     * 而网站此前把 resign 当成普通虚着（不记日志、不提示），玩家看到的就是「电脑忽然不下了」。
     * 老引擎不认这个参数就告警一次、按配置文件继续（与 setMaxVisits 同），绝不阻塞对局。
     */
    async disableResignation() {
        if (this._resignationDisabled) return;
        this._resignationDisabled = true;   // 只试一次（失败也不反复发）
        try {
            await this.command('kata-set-param allowResignation false');
        } catch (err) {
            console.warn(`[katago:${this.gameId}] kata-set-param allowResignation 失败（引擎太老？），按配置文件继续：`, err && err.message);
        }
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
const GLOBAL_PROCESS_LIMIT = 10;
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
    const nowStamp = engineFilesStamp(id);
    while (idle.length) {
        const entry = idle.pop();
        if (!entry) continue;
        clearIdleTimer(entry);
        const session = entry.session;
        // cfg / 二进制在进程活着的时候被改过（换引擎、调 cfg）：老进程仍按旧配置跑，
        // 症状是「配置明明改了却没生效」——直接作废重开，并留一行日志
        if (session && nowStamp != null && session.filesStamp != null && session.filesStamp !== nowStamp) {
            console.warn(`[katago:${id}] gtp.cfg 或引擎二进制已改动，作废池中的旧引擎进程（按新配置重开）`);
            try { session.destroy(); } catch (_) { /* ignore */ }
            continue;
        }
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
        session.filesStamp = engineFilesStamp(id);   // 记下本进程是按哪份 cfg/二进制起来的
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
    readConfigMaxVisits,
    canAcquireKatagoNow,
    KatagoGtpSession,
    acquireKatagoSession,
    releaseKatagoSession,
    toGtpVertex,
    fromGtpVertex,
    fromGtpMove
};
