const { QiTwoPlayerRoomBase } = require('../common');

/**
 * 生成 n 路蜂巢棋盘数据（与客户端 room-plugin 一致）：
 * 六角格 = 蜂巢格子本身，数量 = 3n²−9n+7（轴向半径 n−2 的六角区域），
 * neighbors = 共享边的相邻六角格；
 * dirs = 每格的 6 方向邻接（方向 d 的邻格索引，无邻格为 -1；方向定义
 * [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]，规则二沿方向前进用）。
 */
function generateHexBoardData(n) {
    const radius = n - 2;
    const idx = new Map();
    const cells = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            if (Math.abs(q + r) > radius) continue;
            idx.set(`${q},${r}`, cells.length);
            cells.push({ q, r });
        }
    }
    const C = cells.length;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    const neighborList = Array.from({ length: C }, () => []);
    const dirList = Array.from({ length: C }, () => Array(6).fill(-1));
    for (let i = 0; i < C; i++) {
        const { q, r } = cells[i];
        for (let d = 0; d < 6; d++) {
            const [dq, dr] = DIRS[d];
            const j = idx.get(`${q + dq},${r + dr}`);
            if (j !== undefined) {
                neighborList[i].push(j);
                dirList[i][d] = j;
            }
        }
    }
    return { cellCount: C, neighbors: neighborList, dirs: dirList };
}

/**
 * 生成 n 路方形棋盘数据（与客户端 room-plugin 一致）：
 * 四角格 = 正方形格子本身，数量 = n²（行优先：第 y 行第 x 列的格索引 = y*n+x），
 * neighbors = 共享边的相邻正方形格；
 * dirs = 每格的 4 方向邻接（方向 d 的邻格索引，无邻格为 -1；方向定义
 * [[0,-1],[1,0],[0,1],[-1,0]]，规则二沿方向前进用）。
 */
function generateSquareBoardData(n) {
    const C = n * n;
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const neighborList = Array.from({ length: C }, () => []);
    const dirList = Array.from({ length: C }, () => Array(4).fill(-1));
    const inBoard = (x, y) => x >= 0 && x < n && y >= 0 && y < n;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            for (let d = 0; d < 4; d++) {
                const [dx, dy] = DIRS[d];
                const nx = x + dx, ny = y + dy;
                if (inBoard(nx, ny)) {
                    const j = ny * n + nx;
                    neighborList[i].push(j);
                    dirList[i][d] = j;
                }
            }
        }
    }
    return { cellCount: C, neighbors: neighborList, dirs: dirList };
}

/**
 * 遍历式随机移除六角格，保证：
 * - 所有保留格全部连通；
 * - 每个保留格至少 2 个不相邻的保留邻格（即：≥3 个邻格满足；恰好 2 个时必须不相邻）。
 * 每个点只遍历一次：初始随机生成包含所有点的数组并打乱顺序，遍历一圈，
 * 每个点只检查一次（第一次不能删除则不再重试），遍历完即结束。
 * 准备删除某格时：先逐个检查其保留邻格在删除后的状态（邻格关系需实时判断，
 * 不能只用邻格数数组——恰好 2 个邻格时必须不相邻），通过后再做连通性判断
 * （仅需判断待删格的保留邻格之间能否相互连通——从一邻格出发不经过待删格
 * BFS 到其余邻格，无需全盘判断）。
 */
/**
 * 【规则一】生成 DFW 棋盘格局（独立工具函数，不依赖页面/房间，可复用于其它场景）。
 * 输入：V = 六角格总数，neighbors = 每格的相邻格索引数组（由 generateHexBoardData 提供）。
 * 输出：Uint8Array（1 = 被移除的格，0 = 保留格）。
 *
 * 规则一流程：
 * 1. 遍历两圈随机移除：第一圈随机序遍历所有格，第二圈只遍历剩余格；
 *    每次移除前检查：删除后每个保留邻格满足「≥3 个邻格，或恰好 2 个且不相邻」，
 *    且其保留邻格之间（不经过该格）仍连通。
 * 2. 环清理（连通块 ≤4）：单环/双环按原逻辑（0 邻点删、1 邻点删+链式删孤悬路、
 *    2 邻点删+点亮最短路径连接且新点亮格不成团、≥3 邻点保留）；
 *    三环/四环仅当只有 1 个邻点且删环后该邻点仍 ≥2 邻点时才删；五环及以上不处理。
 * 3. 约束修复：迭代删除违反邻格约束的保留格。
 * 4. 兜底：若删除后剩余不足 10%（运气差时可能几乎全删），重新开始整个流程
 *    （全新随机，最多 20 次重试）。
 */
function generateMapRule1(V, neighbors) {
    const removed = new Uint8Array(V);

    const visitStamp = new Uint32Array(V);
    let stamp = 0;
    const bfsStack = new Int32Array(V);
    // 双向快速路径的缓冲（a 侧 2 层 / b 侧 2 层交替）
    const f1 = new Int32Array(2048);
    const f2 = new Int32Array(2048);
    const visit2 = new Uint32Array(V);
    let seq = 0;

    /** 双向检查：a 侧扩 2 层标记 seqA，b 侧扩 2 层撞到 seqA 即连通（≤4 跳，含 1 跳相邻）。
     *  双向扩展节点量约为单侧 3 跳的一半，且覆盖更远，显著降低连通性检查成本。 */
    function linkedWithin(a, b, v) {
        const seqA = ++seq;
        let fa = f1, fb = f2, lenA = 1;
        fa[0] = a;
        visit2[a] = seqA;
        for (let h = 0; h < 2 && lenA > 0; h++) {
            let lenB = 0;
            for (let i = 0; i < lenA; i++) {
                const nf = neighbors[fa[i]];
                for (let k = 0; k < nf.length; k++) {
                    const m = nf[k];
                    if (m === v || removed[m] || visit2[m] === seqA) continue;
                    if (m === b) return true;
                    visit2[m] = seqA;
                    fb[lenB++] = m;
                }
            }
            const tmp = fa; fa = fb; fb = tmp;
            lenA = lenB;
        }
        const seqB = ++seq;
        fa = f1; fb = f2; lenA = 1;
        fa[0] = b;
        visit2[b] = seqB;
        for (let h = 0; h < 2 && lenA > 0; h++) {
            let lenB = 0;
            for (let i = 0; i < lenA; i++) {
                const nf = neighbors[fa[i]];
                for (let k = 0; k < nf.length; k++) {
                    const m = nf[k];
                    if (m === v || removed[m] || visit2[m] === seqB) continue;
                    if (visit2[m] === seqA) return true;
                    visit2[m] = seqB;
                    fb[lenB++] = m;
                }
            }
            const tmp = fa; fa = fb; fb = tmp;
            lenA = lenB;
        }
        return false;
    }

    function canRemove(v) {
        const nbr = neighbors[v];
        const nbs = [];
        for (let k = 0; k < nbr.length; k++) {
            if (!removed[nbr[k]]) nbs.push(nbr[k]);
        }
        // 删除后 v 的邻格数不足 2 时必然非法
        if (nbs.length < 2) return false;
        // 1) 邻格约束（需实时判断邻格间关系，不能只用邻格数数组）：
        //    删除 v 后，v 的每个保留邻格 u 必须满足「≥3 个保留邻格」，
        //    或「恰好 2 个保留邻格且这 2 个不相邻」
        for (let k = 0; k < nbs.length; k++) {
            const u = nbs[k];
            const un = neighbors[u];
            let cnt = 0;
            let uo1 = -1, uo2 = -1;
            for (let j = 0; j < un.length; j++) {
                const m = un[j];
                if (m === v || removed[m]) continue;
                cnt++;
                if (uo1 === -1) uo1 = m;
                else if (uo2 === -1) uo2 = m;
            }
            if (cnt === 1) return false;   // 只剩 1 个邻格 → 非法
            if (cnt === 2) {
                // 恰好 2 个邻格：必须不相邻
                const nn = neighbors[uo1];
                let adj = false;
                for (let j = 0; j < nn.length; j++) {
                    if (nn[j] === uo2) { adj = true; break; }
                }
                if (adj) return false;
            }
            // cnt >= 3 → 满足
        }
        // 快速路径：每对保留邻居 ≤4 跳连通（双向扩展，含相邻/2跳/3跳…）
        let direct = true;
        outer2:
        for (let a = 0; a < nbs.length && direct; a++) {
            for (let b = a + 1; b < nbs.length; b++) {
                if (!linkedWithin(nbs[a], nbs[b], v)) { direct = false; break outer2; }
            }
        }
        if (direct) return true;
        // 2) 连通性判断：仅判断 v 的保留邻格之间能否相互连通（不经过 v，无需全盘）
        //    预分配 Int32 栈 + 索引循环（比数组 push/pop 快数倍）
        stamp++;
        let sp = 0;
        bfsStack[sp++] = nbs[0];
        visitStamp[nbs[0]] = stamp;
        let found = 1;
        while (sp > 0 && found < nbs.length) {
            const cur = bfsStack[--sp];
            const cn = neighbors[cur];
            for (let k = 0; k < cn.length; k++) {
                const nb = cn[k];
                if (nb === v || removed[nb] || visitStamp[nb] === stamp) continue;
                visitStamp[nb] = stamp;
                bfsStack[sp++] = nb;
                for (let j = 0; j < nbs.length; j++) {
                    if (nbs[j] === nb) { found++; break; }
                }
            }
        }
        return found === nbs.length;
    }

    /** 遍历两圈：第一圈随机序遍历所有点；第二圈只遍历剩余的格子（同样随机序） */
    function twoPass() {
        removed.fill(0);
        const order = [];
        for (let i = 0; i < V; i++) order.push(i);
        for (let i = V - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        for (const v of order) {
            if (canRemove(v)) removed[v] = 1;
        }
        const order2 = [];
        for (let i = 0; i < V; i++) {
            if (!removed[i]) order2.push(i);
        }
        for (let i = order2.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = order2[i]; order2[i] = order2[j]; order2[j] = t;
        }
        for (const v of order2) {
            if (canRemove(v)) removed[v] = 1;
        }
    }

    /** 链式删除：cur 只剩 1 个保留邻格则删掉它并继续判断其邻格，
     *  直至某个格有多个保留邻格（或没有保留邻格）为止 */
    /** 点亮 nb 是否会使其被删邻格 w 形成新的单圈环（w 只剩 nb 一个被删邻格）
     *  或双格环（w 只剩 nb + 另一个相邻被删格）——会则不安全，尽量避开 */
    function isSafeToLight(nb) {
        for (const w of neighbors[nb]) {
            if (!removed[w]) continue;
            let d = 0;
            for (const m of neighbors[w]) {
                if (removed[m]) d++;
            }
            if (d <= 2) return false;
        }
        return true;
    }

    /** A-B 最短路径（全棋盘 BFS）；safeOnly 时只走安全格；找不到返回 null */
    function bfsPath(a, b, safeOnly) {
        const prev = new Int32Array(V).fill(-1);
        const queue = [a];
        let qi = 0;
        prev[a] = a;
        while (qi < queue.length) {
            const cur = queue[qi++];
            if (cur === b) break;
            for (const nb of neighbors[cur]) {
                if (prev[nb] !== -1) continue;
                if (safeOnly && !isSafeToLight(nb)) continue;
                prev[nb] = cur;
                queue.push(nb);
            }
        }
        if (prev[b] === -1) return null;
        const path = [];
        let cur = b;
        while (cur !== a) {
            path.push(cur);
            cur = prev[cur];
        }
        path.push(a);
        return path;
    }

    /** 全图连通性检查（移除某个格后棋盘是否仍连通） */
    function isStillConnected() {
        let start = -1;
        for (let i = 0; i < V; i++) {
            if (!removed[i]) { start = i; break; }
        }
        if (start < 0) return false;
        stamp++;
        let sp = 0;
        bfsStack[sp++] = start;
        visitStamp[start] = stamp;
        let cnt = 0;
        while (sp > 0) {
            const cur = bfsStack[--sp];
            cnt++;
            for (const nb of neighbors[cur]) {
                if (removed[nb] || visitStamp[nb] === stamp) continue;
                visitStamp[nb] = stamp;
                bfsStack[sp++] = nb;
            }
        }
        let total = 0;
        for (let i = 0; i < V; i++) {
            if (!removed[i]) total++;
        }
        return cnt === total;
    }

    /** 连接后消除「团」：3 个格两两相邻；成团则随机去掉一个（破坏连通则恢复换候选）；循环直至不再成团 */
    function breakTriangles(litCells) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const p of litCells) {
                if (removed[p]) continue;
                const np = neighbors[p];
                for (let a = 0; a < np.length; a++) {
                    const u = np[a];
                    if (removed[u]) continue;
                    for (let b = a + 1; b < np.length; b++) {
                        const v = np[b];
                        if (removed[v]) continue;
                        let adj = false;
                        for (const m of neighbors[u]) {
                            if (m === v) { adj = true; break; }
                        }
                        if (!adj) continue;
                        const tries = [p, u, v];
                        for (let i = tries.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            const t = tries[i]; tries[i] = tries[j]; tries[j] = t;
                        }
                        for (const cand of tries) {
                            if (removed[cand]) continue;
                            removed[cand] = 1;
                            if (isStillConnected()) {
                                changed = true;
                                break;
                            }
                            removed[cand] = 0;
                        }
                    }
                }
            }
        }
    }

    /** 环清理：收集大小 ≤4 的被删格连通块（单环/双环/三环/四环，周围保留），随机顺序遍历：
     *  - 单环/双环：0 邻点删环；1 邻点删环并链式删除孤悬路；恰好 2 邻点删环并点亮最短路径连接（成团去一）；≥3 邻点保留；
     *  - 三环/四环：只有 1 个邻点、且删环后该邻点仍 ≥2 邻点才删；
     *  - 五环及以上：跳过。 */
    function ringCleanup() {
        const rings = [];
        const addRing = (blockCells) => {
            const seen = new Set();
            for (const p of blockCells) {
                for (const nb of neighbors[p]) {
                    if (!removed[nb]) seen.add(nb);
                }
            }
            if (seen.size) rings.push({ points: Array.from(seen), block: blockCells });
        };
        const blockSeen = new Uint8Array(V);
        for (let v = 0; v < V; v++) {
            if (!removed[v] || blockSeen[v]) continue;
            const block = [];
            const q = [v];
            blockSeen[v] = 1;
            let qi = 0;
            while (qi < q.length) {
                const cur = q[qi++];
                block.push(cur);
                for (const nb of neighbors[cur]) {
                    if (removed[nb] && !blockSeen[nb]) {
                        blockSeen[nb] = 1;
                        q.push(nb);
                    }
                }
            }
            if (block.length <= 4) addRing(block);
        }
        for (let i = rings.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = rings[i]; rings[i] = rings[j]; rings[j] = t;
        }
        for (const ring of rings) {
            const ringSet = new Set(ring.points);
            let alive = 0;
            for (const p of ring.points) if (!removed[p]) alive++;
            if (!alive) continue;
            const external = new Set();
            for (const p of ring.points) {
                if (removed[p]) continue;
                for (const nb of neighbors[p]) {
                    if (!ringSet.has(nb) && !removed[nb]) external.add(nb);
                }
            }
            const ext = Array.from(external);
            const blockSize = ring.block.length;
            if (blockSize >= 3) {
                if (ext.length !== 1) continue;
                const A = ext[0];
                let aKept = 0, ringNbs = 0;
                for (const nb of neighbors[A]) {
                    if (!removed[nb]) aKept++;
                    if (ringSet.has(nb) && !removed[nb]) ringNbs++;
                }
                if (aKept - ringNbs < 2) continue;
                for (const p of ring.points) removed[p] = 1;
                continue;
            }
            if (ext.length >= 3) continue;
            for (const p of ring.points) removed[p] = 1;
            if (ext.length === 0) continue;
            if (ext.length === 1) {
                removeChain(ext[0]);
            } else {
                const a = ext[0], b = ext[1];
                let adjacent = false;
                for (const nb of neighbors[a]) {
                    if (nb === b) { adjacent = true; break; }
                }
                if (!adjacent) {
                    let path = bfsPath(a, b, false);
                    if (path) {
                        let allSafe = true;
                        for (const p of path) {
                            if (!removed[p]) continue;
                            if (!isSafeToLight(p)) { allSafe = false; break; }
                        }
                        if (!allSafe) {
                            const safePath = bfsPath(a, b, true);
                            if (safePath) path = safePath;
                        }
                        const litCells = [];
                        for (const p of path) {
                            if (removed[p]) {
                                removed[p] = 0;
                                litCells.push(p);
                            }
                        }
                        if (litCells.length) breakTriangles(litCells);
                    } else {
                        removeChain(a);
                        removeChain(b);
                    }
                }
            }
        }
    }

    /** 约束修复：迭代删除违反邻格约束的保留格 */
    function constraintRepair() {
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < V; i++) {
                if (removed[i]) continue;
                const nbs = [];
                for (const nb of neighbors[i]) {
                    if (!removed[nb]) nbs.push(nb);
                }
                let ok = nbs.length >= 3;
                if (nbs.length === 2) {
                    let adj = false;
                    for (const m of neighbors[nbs[0]]) {
                        if (m === nbs[1]) { adj = true; break; }
                    }
                    ok = !adj;
                }
                if (!ok) { removed[i] = 1; changed = true; }
            }
        }
    }

    let keptTotal = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
        twoPass();
        ringCleanup();
        constraintRepair();
        keptTotal = 0;
        for (let i = 0; i < V; i++) if (!removed[i]) keptTotal++;
        if (keptTotal >= Math.round(V * 0.1)) return removed;
    }
    return removed;
}

/**
 * 【规则二】生成 DFW 棋盘格局（独立工具函数，不依赖页面/房间，可复用于其它场景）。
 * 输入：V = 格总数，neighbors = 每格的相邻格索引数组，dirs = 每格方向邻接
 * （由 generateHexBoardData / generateSquareBoardData 提供）。onStage 为可选阶段回调
 * （可视化调试用）。shape = 'hex'（默认，六角格：K3 团）| 'square'（四角格：2×2 团）。
 * 输出：Uint8Array（1 = 灭/移除的格，0 = 点亮/保留格）。
 *
 * 规则二流程（初始所有格全灭，逐渐点亮）：
 * 1. 从「可做初始格」候选池随机选格（点亮格已点亮邻格数 < 2 且未点亮；点亮某格时
 *    该格移出候选池，其邻格点亮邻格数达 2 时也移出），随机选初始方向，点亮。
 * 2. 沿方向前进点亮；重新选方向时沿用原方向的概率是其它每个可选方向的 10 倍
 *    （原方向不可用如到棋盘边缘时，等概率从其它可选方向选）。
 * 3. 点亮前进的格后，若它除前一个格之外还有其它之前点亮的邻格（撞上其它段/本段
 *    更早的格），则点亮这一格（连接两段）并中断，回到 1 重新选格。
 * 4. 总点亮格数 > 总格数 40% 时停止（兜底：最多尝试 0.3V 个段后结束主流程）。
 * 5. 连通：每次取最小的孤立岛，连接与它最近的其它岛（点亮路径上的灭格），
 *    直至只有一个岛（一次 BFS 找全部分量，之后只更新）。
 * 6. 循环删除孤悬极大团（外部点亮邻点数 == 1）和孤悬单环、双环（被删格连通块 ≤2
 *    且只有一个邻点；孤悬格不删除只连接）：删除后从邻点出发按主线方式随机游走点亮
 *    （方向选择避团避环；游走结束后若形成团/小环则回退重试，最多 8 次；4 次都失败
 *    取最轻结果（四环→三环→二环→一环），最轻也是团则链式删除；从头到尾只有唯一
 *    选项时不重试）。每轮还把所有孤悬格（亮邻 <2）作为种子游走连接；循环至没有新的
 *    可处理项，最多 8 轮，之后单独清扫孤悬格直至没有（最多 8 轮）。
 * 7. 乱序熄灭（循环直至一轮内无格可熄）：熄灭后仍连通且不产生 1 邻格的格则熄灭。
 * 8. 兜底：点亮格数不足 10% 总格数时全部清空重来（全新随机，最多 20 次重试）。
 */
function generateMapRule2(V, neighbors, dirs, onStage, shape) {
    const isSquare = shape === 'square';
    const TARGET = Math.round(V * 0.4);
    const MIN_KEPT = Math.round(V * 0.1);
    let removed;   // 函数作用域（内部闭包引用；每次重试重新赋值）
    let lit = 0;   // 当前点亮格数

    // —— 邻格间连通检查（不经过 v；快速路径 + BFS 兜底，供熄灭判定用）——
    const visitStamp = new Uint32Array(V);
    let stamp = 0;
    const bfsStack = new Int32Array(V);
    const f1 = new Int32Array(2048);
    const f2 = new Int32Array(2048);
    const visit2 = new Uint32Array(V);
    let seq = 0;
    /** 双向快速路径：a 侧扩 2 层标记 seqA，b 侧扩 2 层撞到 seqA 即连通（≤4 跳） */
    const linkedWithin = (a, b, v) => {
        const seqA = ++seq;
        let fa = f1, fb = f2, lenA = 1;
        fa[0] = a;
        visit2[a] = seqA;
        for (let h = 0; h < 2 && lenA > 0; h++) {
            let lenB = 0;
            for (let i = 0; i < lenA; i++) {
                const nf = neighbors[fa[i]];
                for (let k = 0; k < nf.length; k++) {
                    const m = nf[k];
                    if (m === v || removed[m] || visit2[m] === seqA) continue;
                    if (m === b) return true;
                    visit2[m] = seqA;
                    fb[lenB++] = m;
                }
            }
            const tmp = fa; fa = fb; fb = tmp;
            lenA = lenB;
        }
        const seqB = ++seq;
        fa = f1; fb = f2; lenA = 1;
        fa[0] = b;
        visit2[b] = seqB;
        for (let h = 0; h < 2 && lenA > 0; h++) {
            let lenB = 0;
            for (let i = 0; i < lenA; i++) {
                const nf = neighbors[fa[i]];
                for (let k = 0; k < nf.length; k++) {
                    const m = nf[k];
                    if (m === v || removed[m] || visit2[m] === seqB) continue;
                    if (visit2[m] === seqA) return true;
                    visit2[m] = seqB;
                    fb[lenB++] = m;
                }
            }
            const tmp = fa; fa = fb; fb = tmp;
            lenA = lenB;
        }
        return false;
    };
    /** v 的亮邻格 nbs 之间（不经过 v）是否连通 */
    const nbsConnected = (v, nbs) => {
        if (nbs.length < 2) return true;
        for (let a = 0; a < nbs.length; a++) {
            for (let b = a + 1; b < nbs.length; b++) {
                if (!linkedWithin(nbs[a], nbs[b], v)) {
                    stamp++;
                    let sp = 0;
                    bfsStack[sp++] = nbs[a];
                    visitStamp[nbs[a]] = stamp;
                    let ok = false;
                    while (sp > 0 && !ok) {
                        const cur = bfsStack[--sp];
                        if (cur === nbs[b]) { ok = true; break; }
                        for (const nb of neighbors[cur]) {
                            if (nb === v || !removed[nb] || visitStamp[nb] === stamp) continue;
                            visitStamp[nb] = stamp;
                            bfsStack[sp++] = nb;
                        }
                    }
                    if (!ok) return false;
                }
            }
        }
        return true;
    };

    /** 枚举全部「团」（当前 removed 状态下）：六角 = 3 格两两相邻（K3）；四角 = 2×2 四格。
     *  返回排序去重后的格索引数组列表（只含全亮的团）。 */
    const enumClusters = (removedNow) => {
        const out = [];
        const seen = new Set();
        if (isSquare) {
            // 2×2 方块：以每个亮格为角点枚举——两个互相垂直（不相邻）的亮邻 u、w
            // 与「同时邻 u、w 且不邻 i」的第 4 格 m 构成方块
            for (let i = 0; i < V; i++) {
                if (removedNow[i]) continue;
                const nbs = neighbors[i];
                for (let a = 0; a < nbs.length; a++) {
                    const u = nbs[a];
                    if (removedNow[u]) continue;
                    for (let b = a + 1; b < nbs.length; b++) {
                        const w = nbs[b];
                        if (removedNow[w]) continue;
                        let adjUW = false;
                        for (const m of neighbors[u]) if (m === w) { adjUW = true; break; }
                        if (adjUW) continue;   // u、w 相邻 → 直线排列，不是方块
                        for (const m of neighbors[u]) {
                            if (m === i || m === w || removedNow[m]) continue;
                            let adjMW = false, adjMI = false;
                            for (const k of neighbors[m]) {
                                if (k === w) adjMW = true;
                                if (k === i) adjMI = true;
                            }
                            if (!adjMW || adjMI) continue;
                            const cells = [i, u, w, m].sort((p, q) => p - q);
                            const key = cells.join(',');
                            if (!seen.has(key)) { seen.add(key); out.push(cells); }
                        }
                    }
                }
            }
            return out;
        }
        // 六角：K3（三格两两相邻）
        for (let i = 0; i < V; i++) {
            if (removedNow[i]) continue;
            for (const u of neighbors[i]) {
                if (u <= i || removedNow[u]) continue;
                for (const w of neighbors[i]) {
                    if (w === u || removedNow[w]) continue;
                    let adjU = false;
                    for (const m of neighbors[u]) {
                        if (m === w) { adjU = true; break; }
                    }
                    if (!adjU) continue;
                    const cells = [i, u, w].sort((a, b) => a - b);
                    const key = cells.join(',');
                    if (!seen.has(key)) { seen.add(key); out.push(cells); }
                }
            }
        }
        return out;
    };

    /** 团豁免判定：团 C 的亮邻点（集合外、棋盘上实际存在的邻点）中找 |C| 个两两不相邻的格
     *  （六角：三条路；四角：四条路）。找到 → 豁免（不算团）。 */
    const clusterExempted = (C) => {
        const Nset = new Set();
        for (const c of C) {
            for (const nb of neighbors[c]) {
                if (!C.includes(nb) && !removed[nb]) Nset.add(nb);
            }
        }
        const arr = Array.from(Nset);
        const used = [];
        let found = false;
        const dfs = (startIdx) => {
            if (found) return;
            if (used.length >= C.length) { found = true; return; }
            for (let i = startIdx; i < arr.length && !found; i++) {
                let ok = true;
                for (const w of used) {
                    let adj = false;
                    for (const m of neighbors[w]) if (m === arr[i]) { adj = true; break; }
                    if (adj) { ok = false; break; }
                }
                if (ok) { used.push(arr[i]); dfs(i + 1); used.pop(); }
            }
        };
        dfs(0);
        return found;
    };
    /** u 所在的「团」（全部点亮）若存在不被豁免的 → true（u 必须是点亮格；熄灭/删除邻格后检查用） */
    const clusterViolationAt = (u) => {
        if (isSquare) {
            for (const a of neighbors[u]) {
                if (removed[a]) continue;
                for (const b of neighbors[u]) {
                    if (b === a || removed[b]) continue;
                    let adjAB = false;
                    for (const m of neighbors[a]) if (m === b) { adjAB = true; break; }
                    if (adjAB) continue;   // 直线排列不是 2×2
                    for (const m of neighbors[a]) {
                        if (m === u || m === b || removed[m]) continue;
                        let adjMB = false, adjMU = false;
                        for (const k of neighbors[m]) {
                            if (k === b) adjMB = true;
                            if (k === u) adjMU = true;
                        }
                        if (!adjMB || adjMU) continue;
                        if (!clusterExempted([u, a, b, m])) return true;
                    }
                }
            }
            return false;
        }
        // 六角：K3
        for (const a of neighbors[u]) {
            if (removed[a]) continue;
            for (const b of neighbors[u]) {
                if (b <= a || removed[b]) continue;
                let adjAB = false;
                for (const m of neighbors[a]) if (m === b) { adjAB = true; break; }
                if (!adjAB) continue;
                if (!clusterExempted([u, a, b])) return true;
            }
        }
        return false;
    };

    /** 连通：每次取最小的孤立岛，连接与它最近的其它岛（点亮路径上的灭格），
     *  直至只有一个岛。初始一次 BFS 找全部分量，之后每次连接只更新（不重找）。 */
    const connectComponents = () => {
        const compId = new Int32Array(V).fill(-1);
        const comps = [];
        const qBuf = new Int32Array(V);
        for (let i = 0; i < V; i++) {
            if (!removed[i] && compId[i] === -1) {
                const id = comps.length;
                const cells = [];
                let qh = 0, qt = 0;
                qBuf[qt++] = i;
                compId[i] = id;
                while (qh < qt) {
                    const cur = qBuf[qh++];
                    cells.push(cur);
                    for (const nb of neighbors[cur]) {
                        if (!removed[nb] && compId[nb] === -1) {
                            compId[nb] = id;
                            qBuf[qt++] = nb;
                        }
                    }
                }
                comps.push({ id, cells });
            }
        }
        const prevArr = new Int32Array(V);
        while (comps.length > 1) {
            let mi = 0;
            for (let i = 1; i < comps.length; i++) {
                if (comps[i].cells.length < comps[mi].cells.length) mi = i;
            }
            const minId = comps[mi].id;
            const minCells = comps[mi].cells;
            for (let i = 0; i < V; i++) prevArr[i] = -1;
            let qh = 0, qt = 0;
            for (const c of minCells) { qBuf[qt++] = c; prevArr[c] = c; }
            let target = -1;
            while (qh < qt && target === -1) {
                const cur = qBuf[qh++];
                for (const nb of neighbors[cur]) {
                    if (prevArr[nb] !== -1) continue;
                    prevArr[nb] = cur;
                    if (!removed[nb]) {
                        if (compId[nb] !== minId) { target = nb; break; }
                        continue;
                    }
                    qBuf[qt++] = nb;
                }
            }
            if (target === -1) break;
            const pathCells = [];
            let p = prevArr[target];
            while (removed[p]) {
                removed[p] = 0;
                lit++;
                pathCells.push(p);
                p = prevArr[p];
            }
            for (const c of pathCells) {
                compId[c] = minId;
                minCells.push(c);
            }
            const tId = compId[target];
            const tIdx = comps.findIndex((c) => c.id === tId);
            if (tIdx !== -1) {
                for (const c of comps[tIdx].cells) {
                    compId[c] = minId;
                    minCells.push(c);
                }
                comps.splice(tIdx, 1);
            }
        }
    };

    /** 乱序遍历点亮格：熄灭后若仍连通且不产生 1 邻格的格则熄灭。
     *  熄灭 v 后立即检查 v 的原亮邻是否仍 ≥2 个亮邻，不足则回退该熄灭
     *  （防止多个邻格被陆续熄灭导致累积成孤悬格）。 */
    const extinguishPass = () => {
        // 循环熄灭直到一轮内没有格可熄：单次乱序遍历会残留「当时熄不掉、但其它格
        // 熄灭后变得可熄」的格（连通性/孤悬条件随熄灭变化）
        let changed = true;
        let guard = 0;
        while (changed && guard < 20) {
            changed = false;
            guard++;
            const order = [];
            for (let i = 0; i < V; i++) {
                if (!removed[i]) order.push(i);
            }
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = order[i]; order[i] = order[j]; order[j] = t;
            }
            for (const v of order) {
                if (removed[v]) continue;
                const nbs = [];
                for (const nb of neighbors[v]) {
                    if (!removed[nb]) nbs.push(nb);
                }
                if (nbs.length === 0) { removed[v] = 1; lit--; changed = true; continue; }
                if (!nbsConnected(v, nbs)) continue;
                removed[v] = 1;
                lit--;
                // 熄灭后检查：v 的原亮邻必须仍 ≥2 个亮邻，否则回退
                let ok = true;
                for (const u of nbs) {
                    let cnt = 0;
                    for (const m of neighbors[u]) {
                        if (!removed[m]) cnt++;
                    }
                    if (cnt < 2) { ok = false; break; }
                }
                if (!ok) {
                    removed[v] = 0;
                    lit++;
                } else {
                    changed = true;
                }
            }
        }
    };


    /** 找所有孤悬极大团（外部点亮邻点数 == 1）并熄灭，把外部邻点加入 seeds */
    const collectLoneCliqueSeeds = (seeds) => {
        // 1) 找所有「团」（六角：K3；四角：2×2）
        const clusters = enumClusters(removed);
        // 2) 并查集：共享一条边（2 格）的团属于同一极大团
        const parent = new Int32Array(clusters.length);
        for (let i = 0; i < clusters.length; i++) parent[i] = i;
        const find = (x) => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
        };
        const edgeToClusters = new Map();
        for (let k = 0; k < clusters.length; k++) {
            const cells = clusters[k];
            // 枚举团内全部格对（六角 K3 = 3 对；四角 2×2 = 6 对）——共享任意 2 格的团合并
            for (let a = 0; a < cells.length; a++) {
                for (let b = a + 1; b < cells.length; b++) {
                    const x = cells[a], y = cells[b];
                    const key = x < y ? x * V + y : y * V + x;
                    if (!edgeToClusters.has(key)) edgeToClusters.set(key, []);
                    edgeToClusters.get(key).push(k);
                }
            }
        }
        for (const list of edgeToClusters.values()) {
            for (let i = 1; i < list.length; i++) union(list[0], list[i]);
        }
        // 3) 极大团分组，判断「外部亮邻格数 == 1」
        const groups = new Map();
        for (let k = 0; k < clusters.length; k++) {
            const r = find(k);
            if (!groups.has(r)) groups.set(r, []);
            groups.get(r).push(...clusters[k]);
        }
        for (const cellsArr of groups.values()) {
            const cells = Array.from(new Set(cellsArr));
            const cellSet = new Set(cells);
            const external = new Set();
            let alive = 0;
            for (const c of cells) {
                if (removed[c]) continue;
                alive++;
                for (const nb of neighbors[c]) {
                    if (!cellSet.has(nb) && !removed[nb]) external.add(nb);
                }
            }
            if (!alive || external.size !== 1) continue;
            // 熄灭整个团
            for (const c of cells) {
                if (!removed[c]) { removed[c] = 1; lit--; }
            }
            for (const a of external) seeds.add(a);
        }
    };

    /** 找所有单环和双环（被删格连通块 ≤2）且只有一个点亮邻点：删除环（周围点亮格），
     *  把唯一邻点加入 seeds */
    const collectRingSeeds = (seeds) => {
        const blockSeen = new Uint8Array(V);
        for (let v = 0; v < V; v++) {
            if (!removed[v] || blockSeen[v]) continue;
            const block = [];
            const q = [v];
            blockSeen[v] = 1;
            let qi = 0;
            while (qi < q.length) {
                const cur = q[qi++];
                block.push(cur);
                for (const nb of neighbors[cur]) {
                    if (!removed[nb] && !blockSeen[nb]) {
                        blockSeen[nb] = 1;
                        q.push(nb);
                    }
                }
            }
            if (block.length > 2) continue;
            // 环点 = 块中格的保留（点亮）邻格并集
            const ringSet = new Set();
            const external = new Set();
            for (const p of block) {
                for (const nb of neighbors[p]) {
                    if (!removed[nb]) ringSet.add(nb);
                }
            }
            if (!ringSet.size) continue;
            for (const p of ringSet) {
                for (const nb of neighbors[p]) {
                    if (!ringSet.has(nb) && !removed[nb]) external.add(nb);
                }
            }
            if (external.size !== 1) continue;   // 只处理只有一个邻点的环
            // 删除环（周围点亮格）
            for (const p of ringSet) {
                if (!removed[p]) { removed[p] = 1; lit--; }
            }
            for (const a of external) seeds.add(a);
        }
    };

    /** 点亮 next 后的形状严重度（越小越严重）：
     *  6=安全 5=四环 4=三环 3=二环 2=一环 1=团。
     *  团：next 的亮邻中存在一对互相相邻（三格两两相邻）。
     *  环：点亮 next 后，其灭格邻格 w 所在的灭格连通块（≤4 格）周围亮格中
     *  仅一个格与环外亮格相连（external==1，与 collectRingSeeds 同标准）。 */
    const shapeStamp = new Uint32Array(V);
    let shapeSeq = 0;
    const shapeSeverity = (next) => {
        if (!removed[next]) return 6;   // 已亮格：不点亮，无新形状（撞上方向因此是干净方向）
        shapeSeq++;
        const seq = shapeSeq;
        let worst = 6;
        // 团检查（含豁免）：点亮 next 后若形成「团」（六角：3 格两两相邻；四角：2×2 四格）
        // 且不被豁免 → 判团。不能贪心扩展（顺序敏感会漏判）——从每个候选格对扩展成团，
        // 逐一检查豁免；存在任一不豁免的团 → 判团。
        // 豁免：C 的亮邻点（集合外、棋盘上实际存在的邻点）中找 |C| 个两两不相邻的格
        const litNbs = [];
        for (const nb of neighbors[next]) if (!removed[nb]) litNbs.push(nb);
        if (litNbs.length >= 2 && worst > 1) {
            outer:
            for (let ai = 0; ai < litNbs.length; ai++) {
                for (let bi = ai + 1; bi < litNbs.length; bi++) {
                    const a = litNbs[ai], b = litNbs[bi];
                    if (isSquare) {
                        // 四角：a、b 是 next 的两个互相垂直邻格（不相邻），且存在第 4 格 m
                        // 同时邻 a、b、不邻 next → C = next + a + b + m（2×2 方块）
                        let adjAB = false;
                        for (const m of neighbors[a]) if (m === b) { adjAB = true; break; }
                        if (adjAB) continue;
                        for (const m of neighbors[a]) {
                            if (m === next || m === b || removed[m]) continue;
                            let adjMB = false, adjMNext = false;
                            for (const k of neighbors[m]) {
                                if (k === b) adjMB = true;
                                if (k === next) adjMNext = true;
                            }
                            if (!adjMB || adjMNext) continue;
                            if (!clusterExempted([next, a, b, m])) { worst = 1; break outer; }
                        }
                    } else {
                        let adjAB = false;
                        for (const m of neighbors[a]) if (m === b) { adjAB = true; break; }
                        if (!adjAB) continue;
                        // 极大团扩展：next + a + b + 与全员相邻的亮邻
                        const C = [next, a, b];
                        for (const w of litNbs) {
                            if (w === a || w === b) continue;
                            let allAdj = true;
                            for (const c of C) {
                                let adj = false;
                                for (const m of neighbors[c]) if (m === w) { adj = true; break; }
                                if (!adj) { allAdj = false; break; }
                            }
                            if (allAdj) C.push(w);
                        }
                        if (!clusterExempted(C)) { worst = 1; break outer; }   // 存在不豁免的团 → 判团
                    }
                }
            }
        }
        // 环检查：next 的灭格邻格 w → 灭格连通块（≤4，不含 next）→ 亮邻集合 S → external
        for (const w0 of neighbors[next]) {
            if (removed[w0] || shapeStamp[w0] === seq) continue;
            shapeStamp[w0] = seq;
            const block = [];
            const q = [w0];
            let qi = 0, overflow = false;
            while (qi < q.length) {
                const cur = q[qi++];
                block.push(cur);
                if (block.length > 4) { overflow = true; break; }
                for (const nb of neighbors[cur]) {
                    if (nb === next) continue;   // 点亮后 next 不是灭格
                    if (!removed[nb] && shapeStamp[nb] !== seq) { shapeStamp[nb] = seq; q.push(nb); }
                }
            }
            if (overflow) continue;   // 连通块 >4 格 → 不是 1~4 环
            const S = new Set();
            S.add(next);
            for (const p of block) {
                for (const nb of neighbors[p]) {
                    if (nb === next || !removed[nb]) S.add(nb);
                }
            }
            let ext = 0;
            for (const u of S) {
                for (const v of neighbors[u]) {
                    if (!removed[v] && !S.has(v)) { ext++; break; }
                }
                if (ext > 1) break;
            }
            // 环判定：block 的邻格「除 1 个出口外几乎全亮」才算环（被真正围死）。
            // 周围空旷（亮邻只占少数）不是环——否则段在空旷区域会被误拦成 2~4 格段
            const nbSet2 = new Set();
            for (const p of block) {
                for (const nb of neighbors[p]) {
                    if (!block.includes(nb)) nbSet2.add(nb);
                }
            }
            if ((ext === 1 && S.size >= nbSet2.size - 1) || (ext === 0 && S.size >= nbSet2.size)) {
                const sev = 1 + block.length;   // 一环=2, 二环=3, 三环=4, 四环=5
                if (sev < worst) worst = sev;
            }
        }
        return worst;
    };

    /** 在 cur 处从可选方向 opts 中选方向：只选不会形成团/小环（1~4环）的干净方向
     *  （原方向权重 10，其它各 1）。strict=true（main 用）：所有方向都会形成团或小环时
     *  返回 -1（无干净方向，中止并保留当前段）；strict=false（游走连接用）：按
     *  四环→三环→二环→一环→团的优先级取最轻者，同级随机 */
    const pickDir = (cur, opts, prevDir, strict) => {
        // 「撞上」（已点亮方向）与「成团/成环」（未点亮方向）是两码事：
        // 这里只判定未点亮方向是否成团/成环；撞上是前进时自然发生的，不参与方向选择
        const unlit = [];
        for (const d of opts) {
            if (removed[dirs[cur][d]]) unlit.push(d);
        }
        if (!unlit.length) return -1;   // 无可走的未点亮方向（周围全亮/全脏）→ 无干净方向
        let bestSev = -1;
        const best = [];
        for (const d of unlit) {
            const sev = shapeSeverity(dirs[cur][d]);
            if (sev > bestSev) { bestSev = sev; best.length = 0; best.push(d); }
            else if (sev === bestSev) best.push(d);
        }
        if (bestSev < 6) {
            if (strict) return -1;   // main：无干净方向 → 中止信号
            return best[Math.floor(Math.random() * best.length)];   // 游走：选最轻的
        }
        if (prevDir !== -1 && best.includes(prevDir)) {
            const others = best.filter((d) => d !== prevDir);
            if (!others.length) return prevDir;
            const total = 10 + others.length;
            const r = Math.floor(Math.random() * total);
            if (r < 10) return prevDir;
            return others[r - 10];
        }
        return best[Math.floor(Math.random() * best.length)];
    };

    /** 链式删除：从 seeds 出发，亮邻数 <2 的格删除，其亮邻继续检查，直至稳定。
     *  用于游走连接无论如何都会形成团时的兜底（不生成团） */
    const removeChain = (seeds) => {
        const q = [...seeds];
        const inQ = new Uint8Array(V);
        for (const s of seeds) inQ[s] = 1;
        while (q.length) {
            const v = q.pop();
            inQ[v] = 0;
            if (removed[v]) continue;
            let cnt = 0;
            for (const nb of neighbors[v]) {
                if (!removed[nb]) cnt++;
            }
            if (cnt < 2) {
                removed[v] = 1;
                lit--;
                for (const nb of neighbors[v]) {
                    if (!removed[nb] && !inQ[nb]) { inQ[nb] = 1; q.push(nb); }
                }
            }
        }
    };

    /** 团修复：熄灭「团」（六角 K3 / 四角 2×2）中的格——前面各阶段（连通/游走/熄灭）
     *  可能产生不被豁免的团（如熄灭格去掉了一条出口路，或密集区连成团），统一在最后清扫：
     *  随机尝试移除团内一格；移除后若有邻格掉到 <2 个亮邻则级联移除（叶格移除不切断连通），
     *  每步都校验「其余格 ≥2 亮邻且不新增违规团」；循环直至没有违规团或无可移除格。 */
    const clusterRepairPass = () => {
        let guard = 0;
        while (guard++ < 100) {
            const viols = [];
            for (const C of enumClusters(removed)) {
                if (!clusterExempted(C)) viols.push(C);
            }
            if (!viols.length) return;
            let progressed = false;
            for (const C of viols) {
                if (clusterExempted(C)) continue;   // 前面的移除可能已破坏该团
                const tries = C.slice();
                for (let i = tries.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const t = tries[i]; tries[i] = tries[j]; tries[j] = t;
                }
                for (const v of tries) {
                    if (removed[v]) continue;
                    // 尝试移除 v（含级联：邻格掉到 <2 亮邻时一并移除，直至稳定）
                    const cascade = [v];
                    const inQ = new Set([v]);
                    const removedLog = [];
                    let ok = true;
                    let qi = 0;
                    while (qi < cascade.length && ok) {
                        const cur = cascade[qi++];
                        removed[cur] = 1;
                        lit--;
                        removedLog.push(cur);
                        for (const u of neighbors[cur]) {
                            if (removed[u] || inQ.has(u)) continue;   // 已移除/将移除：无需检查
                            let cnt = 0;
                            for (const m of neighbors[u]) if (!removed[m]) cnt++;
                            if (cnt < 2) {
                                inQ.add(u);
                                cascade.push(u);
                                continue;
                            }
                            if (clusterViolationAt(u)) { ok = false; break; }
                        }
                    }
                    if (ok) {
                        // 连通性：级联移除的都是「掉到 <2 亮邻的叶格」，不切断连通；
                        // 首格 v 可能 ≥2 亮邻——校验 v 的亮邻间不经过 v 仍连通
                        const nbsV = [];
                        for (const nb of neighbors[v]) if (!removed[nb]) nbsV.push(nb);
                        if (!nbsConnected(v, nbsV)) ok = false;
                    }
                    if (!ok) {
                        for (let k = removedLog.length - 1; k >= 0; k--) {
                            removed[removedLog[k]] = 0;
                            lit++;
                        }
                        continue;
                    }
                    progressed = true;
                    break;
                }
            }
            if (!progressed) return;   // 无可移除格 → 保持现状
        }
    };

    let lastRemoved = null;
    for (let attempt = 0; attempt < 20; attempt++) {
        removed = new Uint8Array(V).fill(1);   // 全灭
        lit = 0;
        // 状态表：每个格是否可做初始格（已点亮邻格数 < 2 且未点亮）。
        // 点亮某格时：该格不可再做初始格；同时其邻格的已点亮邻格数 +1，
        // 达到 2 个或以上时该邻格也不可再做初始格。选初始格直接从候选池随机取。
        const eligible = new Uint8Array(V).fill(1);
        const eligPos = new Int32Array(V);   // 格在 eligList 中的位置（交换删除用）
        const eligList = [];
        for (let i = 0; i < V; i++) { eligPos[i] = i; eligList.push(i); }
        const litNbCount = new Uint8Array(V);
        const removeFromElig = (v) => {
            if (!eligible[v]) return;
            eligible[v] = 0;
            const idx = eligPos[v];
            const lastV = eligList[eligList.length - 1];
            eligList[idx] = lastV;
            eligPos[lastV] = idx;
            eligList.pop();   // 交换后移除末尾（原先缺这行：列表不缩短，池中残留重复格）
        };
        const lightUp = (v) => {
            removed[v] = 0;
            lit++;
            if (eligible[v]) removeFromElig(v);
            for (const nb of neighbors[v]) {
                litNbCount[nb]++;
                if (litNbCount[nb] >= 2 && eligible[nb]) removeFromElig(nb);
            }
        };
        // 点亮并记入 log（含回退所需的 eligible/litNbCount 状态）：主流程段与游走共用，
        // 供回退（undoLog）撤销点亮
        const lightUpLogged = (v, log) => {
            const wasElig = !!eligible[v];
            const nbs = [];
            for (const nb of neighbors[v]) nbs.push(nb);   // 所有邻格（lightUp 都会 litNbCount++）
            lightUp(v);
            log.push({ v, wasElig, nbs });
        };
        /** 撤销 log 记录的全部点亮（从后往前恢复 removed/lit/eligible/litNbCount） */
        const undoLog = (log) => {
            for (let i = log.length - 1; i >= 0; i--) {
                const e = log[i];
                for (const nb of e.nbs) {
                    litNbCount[nb]--;
                    if (litNbCount[nb] < 2 && !eligible[nb]) {
                        eligible[nb] = 1;
                        eligList.push(nb);
                        eligPos[nb] = eligList.length - 1;
                    }
                }
                removed[e.v] = 1;
                lit--;
                if (e.wasElig && !eligible[e.v]) {
                    eligible[e.v] = 1;
                    eligList.push(e.v);
                    eligPos[e.v] = eligList.length - 1;
                }
            }
        };
        /** 按 log 原顺序重放点亮（状态已回退到游走前，顺序一致） */
        const replayLog = (log) => {
            for (const e of log) lightUp(e.v);
        };
        /** 游走：从种子格出发按主线方式点亮，撞到已点亮格或其它点亮邻格时停止。
         *  每步选方向都排除会形成团/小环的方向（pickDir）。返回 forced：
         *  从头到尾每个选方向的决策点都只有一个选项时为 true（结果唯一，无需重试）。 */
        const wander = (seed, log) => {
            let cur = seed;
            let prev = seed;
            let forced = true;   // 每个决策点是否都只有一个选项
            // 第一步：排除已点亮方向（撞上无连接）和棋盘外方向，从其余方向中按新规则选
            const opts0 = [];
            for (let d = 0; d < dirs[cur].length; d++) {
                const nx = dirs[cur][d];
                if (nx !== -1 && removed[nx]) opts0.push(d);
            }
            if (!opts0.length) return forced;   // 无可用方向（seed 被亮格围死）→ 无连接
            if (opts0.length > 1) forced = false;
            let dir = pickDir(cur, opts0, -1);
            let steps = 0;
            while (steps < V) {
                steps++;
                let next = dirs[cur][dir];
                if (next === -1) {
                    // 原方向不可用（棋盘边缘）：从其它可选方向中按新规则选（排除回走）
                    const opts = [];
                    for (let d = 0; d < dirs[cur].length; d++) {
                        if (d !== dir && dirs[cur][d] !== -1 && dirs[cur][d] !== prev) opts.push(d);
                    }
                    if (!opts.length) break;
                    if (opts.length > 1) forced = false;
                    dir = pickDir(cur, opts, -1);
                    continue;
                }
                if (!removed[next]) break;   // 撞到已点亮格 → 停止
                let hit = false;
                for (const nb of neighbors[next]) {
                    if (nb !== prev && !removed[nb]) { hit = true; break; }
                }
                if (hit) { lightUpLogged(next, log); break; }   // 撞上其它点亮邻格 → 点亮后停止
                lightUpLogged(next, log);
                prev = next;
                cur = next;
                const opts = [];
                for (let d = 0; d < dirs[cur].length; d++) {
                    if (dirs[cur][d] !== -1 && dirs[cur][d] !== prev) opts.push(d);
                }
                if (!opts.length) break;
                if (opts.length > 1) forced = false;
                dir = pickDir(cur, opts, dir);
            }
            return forced;
        };
        /** 游走连接：尝试游走，若最终形成小环（1~4环）或团则回退重试（最多 8 次）；
         *  若游走从头到尾只有一个选项（结果唯一）则不重试；
         *  多次都失败取最轻结果（四环→三环→二环→一环）；最轻结果也必须形成团时
         *  不再连接，改为链式删除（无论如何不生成团） */
        const wanderWithRetry = (seed) => {
            if (removed[seed]) return;
            const results = [];
            for (let trial = 0; trial < 8; trial++) {
                const log = [];
                const forced = wander(seed, log);
                if (!log.length) return;   // 一步未点亮（立即撞上）→ 无新形状
                // 逐格复查：wander 里 pickDir(strict=false) 每步允许选「最轻」方向（可能形成团），
                // 这里从后往前临时熄灭已点亮格后判断「点亮该格」是否形成团/环——检查时地图
                // = 该格点亮时刻的状态（后点亮格已逐格熄灭）；复查完恢复整段点亮。
                // （不能直接对已亮格调用 shapeSeverity——它要求格是灭的，否则直接返回安全）
                let worst = 6;
                for (let k = log.length - 1; k >= 0; k--) {
                    const v = log[k].v;
                    removed[v] = 1;
                    lit--;
                    const sev = shapeSeverity(v);
                    if (sev < worst) worst = sev;
                    // 保持熄灭：继续检查更早的格
                }
                for (const e of log) {
                    removed[e.v] = 0;
                    lit++;
                }
                if (worst === 6) return;   // 本次游走干净 → 保留
                if (forced) {
                    // 从头到尾只有一个选项 → 结果唯一，不再重试：
                    // 只形成环 → 保留（已应用）；形成团 → 回退后链式删除
                    if (worst === 1) {
                        undoLog(log);
                        removeChain([seed]);
                    }
                    return;
                }
                results.push({ worst, log });
                undoLog(log);   // 回退重新游走
            }
            // 8 次都形成团或环：选最轻的（worst 越大越轻：四环>三环>二环>一环>团）
            let best = results[0];
            for (let i = 1; i < results.length; i++) {
                if (results[i].worst > best.worst) best = results[i];
            }
            if (best.worst === 1) {
                // 最轻结果也必须形成团 → 不游走连接，改为链式删除
                removeChain([seed]);
                return;
            }
            replayLog(best.log);   // 只有环：应用最轻结果
        };
        // 主流程：点亮至 >40%。
        // 段撞到任何已点亮格（其它段或本段更早的格）即停止；撞点（next 除前一个格外
        // 还有其它点亮邻格）点亮后停止（撞到必须点亮）。
        // 方向选择排除回走方向（前一个格），且只从「未点亮方向」中选不会形成团/小环
        // （1~4环）的干净方向（原方向权重 10，其它各 1）；无干净方向 → 中止并保留这一段。
        // 第一步同样从干净灭方向中选（start 还有灭方向可走时不该立即成 1 格段）。
        // 兜底：最多尝试 0.3V 个段后结束主流程
        let segTries = 0;
        const MAX_SEG = Math.round(V * 0.3);
        while (lit <= TARGET && segTries < MAX_SEG) {
            segTries++;
            // 1) 从可做初始格的格中随机选
            if (!eligList.length) break;   // 无可用初始格 → 停止
            const start = eligList[Math.floor(Math.random() * eligList.length)];
            const segLog = [];
            lightUpLogged(start, segLog);
            // 2) 第一步从「未点亮方向」中选不会形成团/小环的干净方向（撞上方向无意义——
            //    start 还有灭方向可走时不该立即 1 格段）；无干净灭方向（start 被围）→ 1 格段
            let cur = start;
            let prev = start;
            let dir = -1;
            {
                const opts0 = [];
                for (let d = 0; d < dirs[cur].length; d++) {
                    const nx = dirs[cur][d];
                    if (nx !== -1 && removed[nx]) opts0.push(d);
                }
                dir = pickDir(cur, opts0, -1, true);
                // dir === -1：无干净灭方向 → 1 格段（start 被围），主流程继续
            }
            let steps = 0;
            while (dir !== -1 && steps < V) {
                steps++;
                let next = dirs[cur][dir];
                if (next === -1) {
                    // 原方向不可用（棋盘边缘）：从其它可选方向中按新规则选（排除回走）
                    const opts = [];
                    for (let d = 0; d < dirs[cur].length; d++) {
                        if (d !== dir && dirs[cur][d] !== -1 && dirs[cur][d] !== prev) opts.push(d);
                    }
                    if (!opts.length) break;
                    dir = pickDir(cur, opts, -1, true);
                    if (dir === -1) break;   // 无干净方向 → 中止并保留这一段
                    continue;
                }
                if (!removed[next]) break;   // 撞到已点亮的格（其它段或本段更早的格）→ 段完成
                // 3) 撞点检查：next 除前一个格外还有其它点亮邻格（其它段或本段更早的格）
                //    → 点亮撞点后停止（撞到必须点亮；撞本段也停）
                let hit = false;
                for (const nb of neighbors[next]) {
                    if (nb !== prev && !removed[nb]) { hit = true; break; }
                }
                if (hit) {
                    lightUpLogged(next, segLog);
                    break;
                }
                lightUpLogged(next, segLog);
                prev = next;
                cur = next;
                // 4) 重新选方向：排除回走方向与会形成团/小环的方向（原方向权重 10，其它各 1）
                const opts = [];
                for (let d = 0; d < dirs[cur].length; d++) {
                    if (dirs[cur][d] !== -1 && dirs[cur][d] !== prev) opts.push(d);
                }
                if (!opts.length) break;
                dir = pickDir(cur, opts, dir, true);
                if (dir === -1) break;   // 无干净方向 → 中止并保留这一段
            }
            // 段内每个点亮格都经过形状检查（每步只选干净方向），段不会形成团/小环，
            // 无需段后丢弃；可能未撞上其它段（无干净方向中止），保留这一段
        }
        if (onStage) onStage(removed, 'main');
        // 4) 连通：最小岛连接最近岛，直至单分量
        connectComponents();
        if (onStage) onStage(removed, 'connected');
        // 6) 循环删除孤悬极大团和孤悬单环、双环（环需只有一个邻点；孤悬格不删除，只连接）：
        //    每轮先删除团/环，再把删除后的邻点与所有孤悬格（亮邻 <2）作为种子，
        //    从它们出发按主线方式随机游走点亮（避团避环、失败重试），直至撞到另一个点；
        //    循环至没有新的可处理项为止，最多 8 轮
        for (let round = 0; round < 8; round++) {
            const seeds = new Set();
            // 6a) 孤悬极大团（外部点亮邻点数 == 1）
            collectLoneCliqueSeeds(seeds);
            // 6b) 单环和双环（只有一个点亮邻点）
            collectRingSeeds(seeds);
            // 6c) 孤悬格（亮邻 <2）：不删除，作为种子游走连接（补足亮邻）
            for (let i = 0; i < V; i++) {
                if (removed[i]) continue;
                let cnt = 0;
                for (const nb of neighbors[i]) {
                    if (!removed[nb]) cnt++;
                }
                if (cnt < 2) seeds.add(i);
            }
            if (seeds.size === 0) break;   // 本轮无可处理项 → 停止
            // 6d) 从种子出发按主线方式随机游走，直至撞到另一个点
            const seedList = Array.from(seeds);
            for (let i = seedList.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = seedList[i]; seedList[i] = seedList[j]; seedList[j] = t;
            }
            for (const seed of seedList) {
                wanderWithRetry(seed);
            }
        }
        // 6e) 清扫：主循环最后一轮游走保留的环可能产生新的孤悬环点，
        //     单独再扫孤悬格并游走连接，直至没有（最多 8 轮）
        for (let round = 0; round < 8; round++) {
            const seeds = new Set();
            for (let i = 0; i < V; i++) {
                if (removed[i]) continue;
                let cnt = 0;
                for (const nb of neighbors[i]) {
                    if (!removed[nb]) cnt++;
                }
                if (cnt < 2) seeds.add(i);
            }
            if (seeds.size === 0) break;
            const seedList = Array.from(seeds);
            for (let i = seedList.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = seedList[i]; seedList[i] = seedList[j]; seedList[j] = t;
            }
            for (const seed of seedList) {
                wanderWithRetry(seed);
            }
        }
        // 5) 熄灭多余格：乱序熄灭后仍连通且不产生 1 邻格的格（熄灭不产生新的团/环判定外的形态）
        extinguishPass();
        if (onStage) onStage(removed, 'extinguished');
        // 团修复：清扫前面各阶段残留的不被豁免的团（见 clusterRepairPass）
        clusterRepairPass();
        if (onStage) onStage(removed, 'final');
        lastRemoved = removed;
        // 7) 兜底：点亮 <10% 时全部清空重来
        if (lit >= MIN_KEPT) return removed;
    }
    return lastRemoved;
}
const DFW_LANES = 16;           // 六角棋盘路数（3n²−9n+7 = 631 格）
const DFW_LANES_SQUARE = 26;    // 四角棋盘每边格数（26² = 676 格）
const DFW_MAX_PLAYERS = 6;
/** 格属性字典（便于后续修改）：每格按概率随机获得一个属性（一格至多一个）。
 *  概率为每格独立命中概率；生成时按顺序判定（mine 最稀有优先）。 */
const CELL_PROPS = {
    empty: { bg: 'rgb(255,255,255)' }, 
    developableLandA: { prob: 0.2, symbol: '⭐', fg: 'rgb(128,128,128)' }, 
    developableLandB: { prob: 0.05, symbol: '🌟', fg: 'rgb(128,128,128)' }, 
    mine: { prob: 0.05, symbol: '💰️', bg: 'rgb(255,224,128)' },
    stop: { prob: 0.02, symbol: '🛑', bg: 'rgb(255,224,128)' },
	redLandA: { bg: 'rgb(255,160,160)' }, 
	redLandB: { bg: 'rgb(255,160,160)' }, 
	blueLandA: { bg: 'rgb(152,168,255)' }, 
	blueLandB: { bg: 'rgb(152,168,255)' }, 
};
/** 正态随机（Box-Muller）：占领可开发土地时生成价值 */
function gaussRandom(mean, sd) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 每座位的棋子（座位 0-2 红方，3-5 蓝方，双方均为 ♜♞♝） */
const DFW_SEAT_PIECES = ['♜', '♞', '♝', '♜', '♞', '♝'];
/** 随机玩家 ID 池（参照竞速扫雷：进入房间随机分配一个） */
const DFW_PLAYER_NAMES = [
    '木贼', '银杏', '水杉', '雪松', '云杉', '冷杉', '红杉', '落羽', '池杉', '圆柏',
    '侧柏', '龙柏', '垂柏', '桧柏', '刺柏', '杜松', '香樟', '楠木', '泡桐', '梧桐',
    '榆树', '槐树', '楝树', '皂角', '枫杨', '白蜡', '黄栌', '槭树', '椴树', '桦树'
];

/** DFW 六人房间：3V3 红蓝双方，各持 ♜♞♝ 三枚棋子。
 *  大厅阶段：6 个座位（左 3 红、右 3 蓝），第一个坐下的是房主；
 *  座位坐满后房主可开始游戏；开局为 6 人各自在六角棋盘的六个
 *  部分（中心到六个角的连线划分）随机选初始格（与角距离 ≤20 步）。 */
class DfwRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this._qiKatagoInstalled = true;   // DFW 是六人桌游，不需要 KataGo 人机——qi-katago-opponent 见标记跳过安装（必须在 super 之后）
        this._buildMap('hex');
        // 大厅状态
        this.phase = 'lobby';                       // 'lobby' | 'playing'
        this.players = new Map();                   // ws -> { id, seat }
        this.seats = new Array(6).fill(null);       // seat -> ws
        this.hostWs = null;                         // 房主（第一个坐下的人）
        this.piecePositions = null;                 // 开局后 [6]（每人初始格索引）
        this.pieceDirs = null;                      // 开局后 [6]（每人当前方向，方向索引）
        this.cellProps = null;                      // 开局后生成：每格属性（null=无属性）
        // 回合：红1 蓝1 蓝2 红2 红3 蓝3 循环（座位索引）
        this.turnOrder = [0, 3, 4, 1, 2, 5];
        this.turnIndex = 0;                         // 当前轮到 turnOrder[turnIndex]
        this.dicePoint = null;                      // 当前骰子点数（待移动格数）
        this.availNext = new Array(this.turnOrder.length).fill(null);   // 每座位可选邻格集合（目标格 → 除来向外所有点亮邻格）
        this.visitedCells = [new Set(), new Set()];              // 每方（0=红方、1=蓝方）经过过的格子集合（去重）——游历点
        this.wealth = [1000, 1000];                          // 每方财富点（初始 1000）
        this.reachable = null;                      // 当前玩家的可选目标格（骰子后计算）
        this.aiTimer = null;                        // AI 托管自动移动的定时器
        this.lastFrom = new Array(6).fill(null);    // 每个座位上一格的格子（null = 未移动过/开局）
        this.movePath = null;                       // 最近一次移动的路径（[起点,...,目标]，客户端逐格动画）
        this.movePathSeat = -1;                     // 移动路径对应的座位
    }

    /** 按地图形状生成棋盘数据并重新生成格局（开局前切换形状用；shape = 'hex' | 'square'） */
    _buildMap(shape) {
        this.mapType = shape;
        let boardData, cells;
        if (shape === 'square') {
            boardData = generateSquareBoardData(DFW_LANES_SQUARE);
            // 格子直角坐标（与 generateSquareBoardData 相同的遍历顺序：行优先 y 外 x 内）
            cells = [];
            for (let y = 0; y < DFW_LANES_SQUARE; y++) {
                for (let x = 0; x < DFW_LANES_SQUARE; x++) cells.push([x, y]);
            }
        } else {
            boardData = generateHexBoardData(DFW_LANES);
            // 格子轴向坐标（与 generateHexBoardData 相同的遍历顺序）
            const radius = DFW_LANES - 2;
            cells = [];
            for (let q = -radius; q <= radius; q++) {
                for (let r = -radius; r <= radius; r++) {
                    if (Math.abs(q + r) > radius) continue;
                    cells.push([q, r]);
                }
            }
        }
        this.cellCount = boardData.cellCount;
        this.neighbors = boardData.neighbors;
        this.dirs = boardData.dirs;
        this.cells = cells;
        // 棋盘格局（removed: 1=被移除的格子）：当前页面使用规则二，同步即时完成
        this.removed = generateMapRule2(this.cellCount, this.neighbors, this.dirs, null, shape);
        this.sectionCells = this._computeSections();
        this.cellProps = null;                      // 每格属性（开局后生成）
        this.mineWealth = new Array(this.cellCount).fill(0);      // 每格 mine 剩余财富值（0 = 无 mine）
        this.landValue = new Array(this.cellCount).fill(0);       // 每格占领土地的价值（0 = 未占领）
    }

    /** 六部分：每格归入「最近顶点」的部分；与角距离 ≤20 步（所有格点亮前提下的步数），
     *  且必须是点亮格（removed=0）；开局的「空格」过滤在 _startGame 时做（属性那时才生成）。
     *  六角：6 个顶点（轴向距离）；四角：4 角 + 左右边中点（曼哈顿距离）。 */
    _computeSections() {
        const radius = DFW_LANES - 2;
        const gridDist = this.mapType === 'square'
            ? (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2)
            : (q1, r1, q2, r2) => (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs((q1 + r1) - (q2 + r2))) / 2;
        let verts;
        if (this.mapType === 'square') {
            const n1 = DFW_LANES_SQUARE - 1;
            const mid = Math.floor(n1 / 2);
            verts = [[0, 0], [n1, 0], [0, n1], [n1, n1], [0, mid], [n1, mid]];
        } else {
            verts = [[radius, 0], [0, radius], [-radius, 0], [0, -radius], [radius, -radius], [-radius, radius]];
        }
        const sections = [[], [], [], [], [], []];
        for (let i = 0; i < this.cellCount; i++) {
            if (this.removed[i]) continue;   // 只能在点亮格内
            const [c1, c2] = this.cells[i];
            let best = -1, bestD = Infinity;
            for (let v = 0; v < 6; v++) {
                const d = gridDist(c1, c2, verts[v][0], verts[v][1]);
                if (d < bestD) { bestD = d; best = v; }
            }
            if (bestD <= 20) sections[best].push(i);
        }
        return sections;
    }

    _genPlayerId() {
        const used = new Set();
        for (const p of this.players.values()) used.add(p.id);
        const available = DFW_PLAYER_NAMES.filter((n) => !used.has(n));
        if (available.length > 0) {
            return available[Math.floor(Math.random() * available.length)];
        }
        for (let t = 0; t < 500; t++) {
            const id = '选手' + (t + 1);
            if (!used.has(id)) return id;
        }
        return '选手' + Date.now();
    }

    sendState(ws) {
        ws.send(JSON.stringify({ type: 'dfwState', state: this.getStateForClient(ws) }));
    }

    broadcastState() {
        for (const [ws] of this.players) {
            try { this.sendState(ws); } catch (e) { /* 忽略已断开的连接 */ }
        }
    }

    /** 单个角色的视野：以当前格为中心 BFS 5 层（六角距离 ≤5，与客户端一致） */
    visionOfSeat(seat) {
        const vis = new Set();
        if (!this.piecePositions) return vis;   // 开局前（lobby）无棋子位置
        const start = this.piecePositions[seat];
        if (start == null || start < 0) return vis;
        const dist = new Int32Array(this.cellCount).fill(-1);
        dist[start] = 0;
        const q = [start];
        vis.add(start);
        for (let i = 0; i < q.length; i++) {
            const cur = q[i];
            if (dist[cur] >= 5) continue;
            for (const nb of this.neighbors[cur]) {
                if (dist[nb] !== -1) continue;
                dist[nb] = dist[cur] + 1;
                q.push(nb);
                vis.add(nb);
            }
        }
        return vis;
    }

    /** 单格视野：与角色相同的 5 路大六角形（BFS 5 层） */
    visionOfCell(v0) {
        const vis = new Set();
        if (v0 == null || v0 < 0 || v0 >= this.cellCount) return vis;
        const dist = new Int32Array(this.cellCount).fill(-1);
        dist[v0] = 0;
        const q = [v0];
        vis.add(v0);
        for (let i = 0; i < q.length; i++) {
            const cur = q[i];
            if (dist[cur] >= 5) continue;
            for (const nb of this.neighbors[cur]) {
                if (dist[nb] !== -1) continue;
                dist[nb] = dist[cur] + 1;
                q.push(nb);
                vis.add(nb);
            }
        }
        return vis;
    }

    /** 某客户端可见格：红/蓝方 = 本方角色视野 ∪ 本方占领格视野；观战 = 双方交集 */
    visionForSeat(meSeat) {
        const visOfSide = (side) => {
            const vis = new Set();
            for (let s = 0; s < 6; s++) {
                if ((s < 3 ? 0 : 1) !== side) continue;
                for (const v of this.visionOfSeat(s)) vis.add(v);
            }
            // 占领的格也提供视野（范围与角色相同）
            for (let v = 0; v < this.cellCount; v++) {
                const cp = this.cellProps && this.cellProps[v];
                if (!cp) continue;
                const own = (cp.type === 'redLandA' || cp.type === 'redLandB') ? 0
                    : ((cp.type === 'blueLandA' || cp.type === 'blueLandB') ? 1 : -1);
                if (own === side) for (const w of this.visionOfCell(v)) vis.add(w);
            }
            return vis;
        };
        if (meSeat != null && meSeat >= 0 && meSeat < 6) {
            return visOfSide(meSeat < 3 ? 0 : 1);
        }
        // 观战：双方都能看到的格 = 交集
        const red = visOfSide(0), blue = visOfSide(1);
        const inter = new Set();
        for (const v of red) if (blue.has(v)) inter.add(v);
        return inter;
    }

    getStateForClient(ws) {
        const me = this.players.get(ws) || null;
        const vis = this.visionForSeat(me ? me.seat : -1);   // 可见格集合——看不到的格不同步给客户端
        return {
            boardSize: this.mapType === 'square' ? DFW_LANES_SQUARE : DFW_LANES,
            mapType: this.mapType,
            cellCount: this.cellCount,
            removed: Array.from(this.removed),   // 格子存在性是公共地图结构——完整同步（灭掉的格始终不画）
            phase: this.phase,
            myId: me ? me.id : null,
            mySeat: me ? me.seat : -1,
            hostId: this.hostWs ? ((this.players.get(this.hostWs) || {}).id || null) : null,
            players: Array.from(this.players.values()).map((p) => ({ id: p.id, seat: p.seat })),
            seats: this.seats.map((w) => (w ? ((this.players.get(w) || {}).id || null) : null)),
            seatPieces: DFW_SEAT_PIECES,
            piecePositions: this.piecePositions,
            visitedCells: [Array.from(this.visitedCells[0]), Array.from(this.visitedCells[1])],   // 游历 = 全局统计（不按视野过滤）
            pieceDirs: this.pieceDirs,
            cellProps: (this.cellProps || []).map((prop, v) => (vis.has(v) ? prop : null)),   // 视野外的格属性不同步（开局前 cellProps 为 null）
            emptyBg: CELL_PROPS.empty.bg,
            turnOrder: this.turnOrder,
            turnIndex: this.turnIndex,
            currentSeat: this.turnOrder[this.turnIndex],
            dicePoint: this.dicePoint,
            reachable: this.reachable,
            movePath: this.movePath,
            movePathSeat: this.movePathSeat,
            wealth: this.wealth,
            mineWealth: (this.mineWealth || []).map((m, v) => (vis.has(v) ? m : 0)),   // 视野外的 mine 财富不同步
            landValue: (this.landValue || []).map((lv, v) => (vis.has(v) ? lv : 0))   // 视野外的占领地价值不同步
        };
    }

    getState() {
        return this.getStateForClient(null);
    }

    /** 房间层双人槽位不适用：DFW 自行管理 6 人（全部按 observer 接入，UI 全自定义） */
    assignSlot() {
        return null;
    }

    handleMessage(ws, msg) {
        switch (msg.type) {
            case 'dfwEnter': {
                if (!this.players.has(ws)) {
                    if (this.players.size >= DFW_MAX_PLAYERS && this.phase === 'lobby') {
                        ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                        return;
                    }
                    const id = this._genPlayerId();
                    this.players.set(ws, { id, seat: -1 });
                }
                this.sendState(ws);
                break;
            }
            case 'takeSeat': {
                // 开局后空座仍可入座加入游戏（接管该座 AI 托管的位置）
                const me = this.players.get(ws);
                if (!me) return;
                const seat = msg.seat;
                if (typeof seat !== 'number' || seat < 0 || seat >= 6) return;
                if (this.seats[seat] && this.seats[seat] !== ws) return;   // 座位已被占
                if (me.seat !== -1 && me.seat !== seat) this.seats[me.seat] = null;   // 换座
                me.seat = seat;
                this.seats[seat] = ws;
                if (!this.hostWs) this.hostWs = ws;   // 第一个坐下的是房主
                // 暂停恢复：游戏进行中且没有进行中的行动（无骰子、无 AI 定时器）→ 继续掷骰
                if (this.phase === 'playing' && this.dicePoint == null && !this.aiTimer) {
                    this._rollDice();
                }
                this.broadcastState();
                break;
            }
            case 'leaveSeat': {
                if (this.phase !== 'lobby') return;
                const me = this.players.get(ws);
                if (!me || me.seat === -1) return;
                this.seats[me.seat] = null;
                me.seat = -1;
                if (this.hostWs === ws) {
                    // 房主退出座位：按座位顺序，下一个已坐下者成为新房主
                    this.hostWs = this.seats.find(Boolean) || null;
                }
                this.broadcastState();
                break;
            }
            case 'move': {
                if (this.phase !== 'playing') return;
                const me = this.players.get(ws);
                if (!me || me.seat === -1) return;
                const seat = me.seat;
                if (this.turnOrder[this.turnIndex] !== seat) return;   // 不是当前行动者
                if (this.dicePoint == null || !this.reachable) return;
                const to = msg.to;
                if (typeof to !== 'number' || !this.reachable.includes(to)) return;   // 目标不可达
                this.piecePositions[seat] = to;
                // 移动路径（pathsOf = 该终点的一条完整最长路径）
                const path = this.pathsOf.get(to);
                // 游历点：只计落点（每次移动停下的格），去重
                // 财富结算（移动到目标格后）：mine（路径经过的每个：+500、≤500 全给并移除）+
                //   占领/取消占领（♜ 到达终点时）+ 每回合结束双方按占领地结算收入
                {
                    const side = seat < 3 ? 0 : 1;
                    const to = path[path.length - 1];
                    this.visitedCells[side].add(to);
                    // mine：只有到达（终点）矿产格才获得财富（途径不算）
                    if (this.mineWealth[to] > 0) {
                        if (this.mineWealth[to] <= 500) {
                            this.wealth[side] += this.mineWealth[to];
                            this.mineWealth[to] = 0;   // 剩余全给并移除
                        } else {
                            this.wealth[side] += 500;
                            this.mineWealth[to] -= 500;
                        }
                    }
                    // 占领/取消占领：♜（座位 0/3）到达（终点）developableLand 时占领；
                    //   对方到达已占领格时取消（恢复 developableLand）；对方♜到达可直接占领（重新随机价值）
                    const prop = this.cellProps[to];
                    const isRook = (seat === 0 || seat === 3);
                    if (prop && (prop.type === 'developableLandA' || prop.type === 'developableLandB')) {
                        if (isRook) {
                            const isA = prop.type === 'developableLandA';
                            const landType = (side === 0 ? 'redLand' : 'blueLand') + (isA ? 'A' : 'B');
                            this.cellProps[to] = { type: landType, bg: CELL_PROPS[landType].bg };
                            this.landValue[to] = Math.max(1, Math.round(gaussRandom(isA ? 30 : 50, isA ? 10 : 15)));
                        }
                    } else if (prop && /^(redLand|blueLand)[AB]$/.test(prop.type)) {
                        const ownerSide = prop.type.charAt(0) === 'r' ? 0 : 1;
                        if (ownerSide !== side) {
                            const isA = prop.type.endsWith('A');
                            if (isRook) {
                                const landType = (side === 0 ? 'redLand' : 'blueLand') + (isA ? 'A' : 'B');
                                this.cellProps[to] = { type: landType, bg: CELL_PROPS[landType].bg };
                                this.landValue[to] = Math.max(1, Math.round(gaussRandom(isA ? 30 : 50, isA ? 10 : 15)));
                            } else {
                                const devType = isA ? 'developableLandA' : 'developableLandB';
                                this.cellProps[to] = { type: devType, bg: CELL_PROPS[devType].bg, symbol: CELL_PROPS[devType].symbol, fg: CELL_PROPS[devType].fg };
                                this.landValue[to] = 0;
                            }
                        }
                    }
                }
                this.movePath = path.length >= 2 ? path : null;
                this.movePathSeat = seat;
                this.lastFrom[seat] = path.length >= 2 ? path[path.length - 2] : null;   // 记录来向
                // 保存可选邻格集合（目标格 → 除来时格外的所有点亮邻格——下轮寻路第一步必须从中选）
                const cameFrom = path.length >= 2 ? path[path.length - 2] : -1;
                this.availNext[seat] = [];
                for (const nb of this.neighbors[to]) {
                    if (this.removed[nb]) continue;
                    if (nb === cameFrom) continue;
                    this.availNext[seat].push(nb);
                }
                // 更新方向：新格周围所有点亮的方向，排除来时的格（路径前一格）；
                // 若只剩来时格（死胡同），方向就是它
                const cameFrom2 = path.length >= 2 ? path[path.length - 2] : -1;
                const cand = [];
                for (const nb of this.neighbors[to]) {
                    if (this.removed[nb] || nb === cameFrom2) continue;
                    cand.push(this.dirs[to].indexOf(nb));
                }
                if (cand.length > 0) {
                    this.pieceDirs[seat] = cand[Math.floor(Math.random() * cand.length)];
                } else if (cameFrom2 !== -1) {
                    this.pieceDirs[seat] = this.dirs[to].indexOf(cameFrom2);
                }
                this.dicePoint = null;
                this.reachable = null;
                this._advanceTurn();
                this.broadcastState();
                break;
            }
            case 'resurrect': {
                // 重生：轮到当前玩家且已摇骰（摇骰后）——随机移到空白格，本回合行动结束，
                //   并把该玩家移到行动顺序最后（后续回合最后行动；多次重生基于前一次结果）
                if (this.phase !== 'playing') return;
                const me2 = this.players.get(ws);
                if (!me2 || me2.seat === -1) return;
                const seat2 = me2.seat;
                if (this.turnOrder[this.turnIndex] !== seat2) return;   // 只能轮到当前玩家
                if (this.dicePoint == null) return;                     // 摇骰子之后才可用
                // 随机空白格（点亮 + 无角色 + 无属性；全图无候选则放宽到无角色）
                const occupied = new Set(this.piecePositions);
                let pool = [];
                for (let v = 0; v < this.cellCount; v++) {
                    if (this.removed[v] || occupied.has(v) || this.cellProps[v]) continue;
                    pool.push(v);
                }
                if (!pool.length) {
                    for (let v = 0; v < this.cellCount; v++) {
                        if (this.removed[v] || occupied.has(v)) continue;
                        pool.push(v);
                    }
                }
                if (!pool.length) return;   // 全图无空格（几乎不可能）——忽略
                const newPos = pool[Math.floor(Math.random() * pool.length)];
                this.piecePositions[seat2] = newPos;
                this.lastFrom[seat2] = null;        // 新起点：无来向
                this.availNext[seat2] = null;       // 走开局逻辑（初始方向）
                const nbs2 = this.neighbors[newPos].filter((nb) => !this.removed[nb]);
                const dd = nbs2.length ? this.dirs[newPos].indexOf(nbs2[Math.floor(Math.random() * nbs2.length)]) : 0;
                this.pieceDirs[seat2] = dd >= 0 ? dd : 0;
                // 行动顺序：重生玩家移到本轮最后（后续回合最后行动）
                const ridx = this.turnOrder.indexOf(seat2);
                this.turnOrder.splice(ridx, 1);
                this.turnOrder.push(seat2);
                // 本回合结束：下一位 = 移除 seat2 后 ridx 位置的元素——turnIndex 设为 ridx-1（_advanceTurn 会 +1）
                this.turnIndex = (ridx - 1 + this.turnOrder.length) % this.turnOrder.length;
                this.dicePoint = null;
                this.reachable = null;
                if (this.aiTimer) clearTimeout(this.aiTimer);
                this._advanceTurn();
                this.broadcastState();
                break;
            }
            case 'dfwSetMapType': {
                // 开局前切换地图形状（六角 / 四角）：重新生成棋盘格局
                if (this.phase !== 'lobby') return;
                if (!this.players.has(ws)) return;
                const t = msg.mapType;
                if (t !== 'hex' && t !== 'square') return;
                if (t === this.mapType) return;
                this._buildMap(t);
                this.broadcastState();
                break;
            }
            case 'startGame': {
                if (this.phase !== 'lobby') return;
                if (ws !== this.hostWs) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏。' }));
                    return;
                }
                // 即便没有坐满，房主也可以开始游戏；未坐的座位开局无棋子
                this._startGame();
                this.broadcastState();
                break;
            }
            default:
                break;
        }
    }

    /** 随机生成格属性地图（仅点亮格可能有属性；一格至多一个） */
    _generateCellProps() {
        const props = new Array(this.cellCount).fill(null);
        for (let i = 0; i < this.cellCount; i++) {
            if (this.removed[i]) continue;
            let type = null;
            if (Math.random() < CELL_PROPS.mine.prob) type = 'mine';
            else if (Math.random() < CELL_PROPS.developableLandA.prob) type = 'developableLandA';
            else if (Math.random() < CELL_PROPS.developableLandB.prob) type = 'developableLandB';
            else if (Math.random() < CELL_PROPS.stop.prob) type = 'stop';
            if (type) {
                const def = CELL_PROPS[type];
                // bg：无 bg 字段则用 empty 的背景色；symbol 缺失则留空（不写字符）；
                // fg 缺失则客户端按背景亮度决定文字颜色
                props[i] = {
                    type,
                    symbol: def.symbol || null,
                    bg: def.bg || CELL_PROPS.empty.bg,
                    fg: def.fg || null
                };
            }
        }
        return props;
    }

    /** 开局：先生成属性地图；六部分与六个座位随机对应，各随机选 1 个「空格」
     * （点亮且无属性，且至少 1 个邻格也是空格）作为初始格；初始方向从该格的
     * 空格邻格中随机选（空座由 AI 托管，同样有棋子）；随后轮到第一个玩家掷骰子。 */
    _startGame() {
        if (this.aiTimer) clearTimeout(this.aiTimer);
        this.cellProps = this._generateCellProps();
        this.landValue = new Array(this.cellCount).fill(0);   // 每局重置占领价值
        // 坐标表（初始位置距离限制：优先中心 n/2 内 → 0.75n → 全部；与棋盘数据遍历顺序一致）
        const gCoords = [];
        const gCoordIdx = new Map();
        let centerIdx = -1;
        let cellDist;
        if (this.mapType === 'square') {
            const half = Math.floor((DFW_LANES_SQUARE - 1) / 2);
            for (let y = 0; y < DFW_LANES_SQUARE; y++) {
                for (let x = 0; x < DFW_LANES_SQUARE; x++) {
                    gCoordIdx.set(x + ',' + y, gCoords.length);
                    gCoords.push({ x, y });
                }
            }
            centerIdx = gCoordIdx.get(half + ',' + half);
            cellDist = (a, b) => Math.abs(gCoords[a].x - gCoords[b].x) + Math.abs(gCoords[a].y - gCoords[b].y);
        } else {
            const gRadius = DFW_LANES - 2;
            for (let q = -gRadius; q <= gRadius; q++) {
                for (let r = -gRadius; r <= gRadius; r++) {
                    if (Math.abs(q + r) > gRadius) continue;
                    gCoordIdx.set(q + ',' + r, gCoords.length);
                    gCoords.push({ q, r });
                }
            }
            centerIdx = gCoordIdx.get('0,0');
            cellDist = (a, b) => Math.max(
                Math.abs(gCoords[a].q - gCoords[b].q),
                Math.abs(gCoords[a].r - gCoords[b].r),
                Math.abs((gCoords[a].q + gCoords[a].r) - (gCoords[b].q + gCoords[b].r)));
        }
        const isBlank = (v) => !this.removed[v] && !this.cellProps[v];
        const order = [0, 1, 2, 3, 4, 5];
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        const positions = new Array(6);
        const dirs = new Array(6);
        for (let i = 0; i < 6; i++) {
            let sec = this.sectionCells[order[i]].filter((v) => {
                if (!isBlank(v)) return false;
                for (const nb of this.neighbors[v]) {
                    if (isBlank(nb)) return true;   // 至少 1 个空格邻格
                }
                return false;
            });
            if (!sec.length) {
                // 块内没有可选点：全盘随机（点亮 + 空格 + 至少 1 个空格邻格）
                sec = [];
                for (let v = 0; v < this.cellCount; v++) {
                    if (!isBlank(v)) continue;
                    let ok = false;
                    for (const nb of this.neighbors[v]) {
                        if (isBlank(nb)) { ok = true; break; }
                    }
                    if (ok) sec.push(v);
                }
            }
            // 距离限制：优先与中心距离 ≤ n/2 的点，其次 ≤ 0.75n，最后全部
            const lanesN = this.mapType === 'square' ? DFW_LANES_SQUARE : DFW_LANES;
            let cand = sec.filter((v) => cellDist(v, centerIdx) <= lanesN / 2);
            if (!cand.length) cand = sec.filter((v) => cellDist(v, centerIdx) <= 0.75 * lanesN);
            if (!cand.length) cand = sec;
            const pos = cand[Math.floor(Math.random() * cand.length)];
            positions[order[i]] = pos;
            // 初始方向：从 pos 的空格邻格中随机选（方向 = 邻格在 dirs 中的索引）
            const blankNbs = this.neighbors[pos].filter((nb) => isBlank(nb));
            const d = blankNbs[Math.floor(Math.random() * blankNbs.length)];
            dirs[order[i]] = this.dirs[pos].indexOf(d);
        }
        this.piecePositions = positions;
        this.pieceDirs = dirs;
        this.lastFrom = new Array(6).fill(null);
        this.availNext = new Array(6).fill(null);
        this.visitedCells = [new Set(), new Set()];   // 每局重置游历记录
        this.wealth = [1000, 1000];                    // 每局重置财富
        this.mineWealth = new Array(this.cellCount).fill(0);
        for (let v = 0; v < this.cellCount; v++) {
            if (this.cellProps[v] && this.cellProps[v].type === 'mine') {
                this.mineWealth[v] = 1000 + Math.floor(Math.random() * 4001);   // 1000~5000 均匀整数
            }
        }
        this.turnIndex = 0;
        this.dicePoint = null;
        this.reachable = null;
        this.phase = 'playing';
        this._rollDice();
    }

    /** 当前玩家掷骰子：♞ 玩家（座位 1/4）用八角骰子（1-8 步），其它用六角骰子（1-6 步）；
     *  计算全部可选目标格（BFS n 步可达）。
     *  若当前座位无人（AI 托管），延迟（客户端骰子动画 2s + 停留 1s）后自动随机移动 */
    _rollDice() {
        const cur = this.turnOrder[this.turnIndex];
        // 没有人类玩家：暂停游戏（等有人进入后恢复）
        if (!this.seats.some((w) => w != null)) {
            this.dicePoint = null;
            this.reachable = null;
            if (this.aiTimer) clearTimeout(this.aiTimer);
            this.broadcastState();
            return;
        }
        const maxPips = (cur === 0 || cur === 3) ? 8 : 6;   // ♜ 玩家八角骰子
        this.dicePoint = 1 + Math.floor(Math.random() * maxPips);
        this.reachable = this._computeReachable(cur, this.dicePoint);
        if (this.seats[cur] == null) {
            this._scheduleAiAct(cur);   // 空座（AI 托管）：延迟后自动行动
        }
    }

    /** 安排 AI 行动：延迟（等客户端骰子动画结束）后自动移动；期间有人类坐下则取消 */
    _scheduleAiAct(seat) {
        if (this.aiTimer) clearTimeout(this.aiTimer);
        this.aiTimer = setTimeout(() => {
            if (this.phase !== 'playing') return;
            if (this.turnOrder[this.turnIndex] !== seat) return;
            if (this.seats[seat] != null) return;   // 已有人类坐下——交给人类
            if (!this.reachable || !this.reachable.length) {
                this._advanceTurn();
                this.broadcastState();
                return;
            }
            const to = this.reachable[Math.floor(Math.random() * this.reachable.length)];
                this.piecePositions[seat] = to;
                const path = this.pathsOf.get(to);
                // 游历点：只计落点（每次移动停下的格），去重
                // 财富结算（移动到目标格后）：mine（路径经过的每个：+500、≤500 全给并移除）+
                //   占领/取消占领（♜ 到达终点时）+ 每回合结束双方按占领地结算收入
                {
                    const side = seat < 3 ? 0 : 1;
                    const to = path[path.length - 1];
                    this.visitedCells[side].add(to);
                    // mine：只有到达（终点）矿产格才获得财富（途径不算）
                    if (this.mineWealth[to] > 0) {
                        if (this.mineWealth[to] <= 500) {
                            this.wealth[side] += this.mineWealth[to];
                            this.mineWealth[to] = 0;   // 剩余全给并移除
                        } else {
                            this.wealth[side] += 500;
                            this.mineWealth[to] -= 500;
                        }
                    }
                    // 占领/取消占领：♜（座位 0/3）到达（终点）developableLand 时占领；
                    //   对方到达已占领格时取消（恢复 developableLand）；对方♜到达可直接占领（重新随机价值）
                    const prop = this.cellProps[to];
                    const isRook = (seat === 0 || seat === 3);
                    if (prop && (prop.type === 'developableLandA' || prop.type === 'developableLandB')) {
                        if (isRook) {
                            const isA = prop.type === 'developableLandA';
                            const landType = (side === 0 ? 'redLand' : 'blueLand') + (isA ? 'A' : 'B');
                            this.cellProps[to] = { type: landType, bg: CELL_PROPS[landType].bg };
                            this.landValue[to] = Math.max(1, Math.round(gaussRandom(isA ? 30 : 50, isA ? 10 : 15)));
                        }
                    } else if (prop && /^(redLand|blueLand)[AB]$/.test(prop.type)) {
                        const ownerSide = prop.type.charAt(0) === 'r' ? 0 : 1;
                        if (ownerSide !== side) {
                            const isA = prop.type.endsWith('A');
                            if (isRook) {
                                const landType = (side === 0 ? 'redLand' : 'blueLand') + (isA ? 'A' : 'B');
                                this.cellProps[to] = { type: landType, bg: CELL_PROPS[landType].bg };
                                this.landValue[to] = Math.max(1, Math.round(gaussRandom(isA ? 30 : 50, isA ? 10 : 15)));
                            } else {
                                const devType = isA ? 'developableLandA' : 'developableLandB';
                                this.cellProps[to] = { type: devType, bg: CELL_PROPS[devType].bg, symbol: CELL_PROPS[devType].symbol, fg: CELL_PROPS[devType].fg };
                                this.landValue[to] = 0;
                            }
                        }
                    }
                }
                this.movePath = path.length >= 2 ? path : null;
                this.movePathSeat = seat;
                this.lastFrom[seat] = path.length >= 2 ? path[path.length - 2] : null;   // 记录来向
                // 保存可选邻格集合（目标格 → 除来时格外的所有点亮邻格——下轮寻路第一步必须从中选）
                const cameFromA = path.length >= 2 ? path[path.length - 2] : -1;
                this.availNext[seat] = [];
                for (const nb of this.neighbors[to]) {
                    if (this.removed[nb]) continue;
                    if (nb === cameFromA) continue;
                    this.availNext[seat].push(nb);
                }
                // 更新方向（与人类移动一致）：新格周围点亮方向中排除来向随机选；死路则指向来向
                const candA = [];
                for (const nb of this.neighbors[to]) {
                    if (this.removed[nb] || nb === cameFromA) continue;
                    candA.push(this.dirs[to].indexOf(nb));
                }
                if (candA.length > 0) {
                    this.pieceDirs[seat] = candA[Math.floor(Math.random() * candA.length)];
                } else if (cameFromA !== -1) {
                    this.pieceDirs[seat] = this.dirs[to].indexOf(cameFromA);
                }
                this.dicePoint = null;
                this.reachable = null;
                this._advanceTurn();
                this.broadcastState();
            }, 4500);   // 等客户端骰子动画完全结束（视角 600ms + 旋转 2s + 展示 700ms）才行动
    }

    /** 最长无环路径（DFS 全搜索）：第一步必须从保存的可选邻格集合中选（目标格 → 除来时格外的
     * 所有点亮邻格——与客户端箭头指向完全一致）；开局（无来向）沿初始方向。之后每步遍历所有
     * 未走过的点亮邻格——整条路径不重复经过任何格（也不回到起点、不经过来时格——不允许往回走），
     * 死路（无未走过邻格）即路径终点，死路不回走来向（无可选格则无路径）。
     * 取不超过点数 n 的最长路径；若存在多条同样长度的路径则全部返回（终点集合 ends，
     * 每个终点保存一条完整路径 pathsOf——供人类/AI 移动动画使用）。 */
    _computeReachable(seat, n) {
        const start = this.piecePositions[seat];
        if (start == null || n <= 0) return null;
        // 第一格集合：移动后 = 保存的可选邻格集合（除来向）；开局（无来向）= 初始方向
        const from = this.lastFrom[seat];
        const firstSet = [];
        const avail = this.availNext && this.availNext[seat];
        if (avail) {
            // 已保存可选邻格集合（移动后）——第一步必须从中选；空集合 = 死路，无路径
            for (const f of avail) {
                if (!this.removed[f]) firstSet.push(f);
            }
        } else if (from == null) {
            const dir = this.pieceDirs[seat];
            const f = this.dirs[start][dir];
            if (f !== -1 && !this.removed[f]) firstSet.push(f);
        } else {
            for (const nb of this.neighbors[start]) {
                if (this.removed[nb]) continue;
                if (nb === from) continue;
                firstSet.push(nb);
            }
        }
        if (!firstSet.length) return null;   // 死路：无可选邻格——不回溯来向
        this.prevOf = null;   // 前驱链不再使用——用 pathsOf（每终点一条完整路径）
        const onPath = new Uint8Array(this.cellCount);
        onPath[start] = 1;   // 只禁止经过起始格；来时格仅第一步排除（可选格集合不含它），中途可以经过
        let bestLen = 0;
        const ends = new Set();
        const stopEnds = new Set();   // stop 终点（任意长度——玩家点击 stop 时提前停）
        const stopPaths = new Map();  // stop 终点 → 路径（独立保存）
        const pathsOf = new Map();   // 终点 → [start, ...]完整路径
        const curPath = [start];
        const dfs = (cur, len) => {
            if (len >= n) {
                // 已达步数上限——该路径不可能更长
                if (len > bestLen) { bestLen = len; ends.clear(); pathsOf.clear(); }
                if (len === bestLen && len > 0) { ends.add(cur); pathsOf.set(cur, curPath.slice()); }
                return;
            }
            // stop：移动到 stop 立刻停止（以 stop 为终点，剩余步数作废）；从 stop 出发除外（起点不判断）。
            // stop 格是独立候选终点（任意长度都可点击停在 stop——不受最长路径限制）
            const sp = this.cellProps && this.cellProps[cur];
            if (sp && sp.type === 'stop') {
                if (len > bestLen) { bestLen = len; ends.clear(); pathsOf.clear(); }
                if (len === bestLen && len > 0) { ends.add(cur); pathsOf.set(cur, curPath.slice()); }
                stopEnds.add(cur);
                if (!stopPaths.has(cur)) stopPaths.set(cur, curPath.slice());   // stop 路径独立保存（不被最长路径 clear 清掉）
                return;
            }
            let moved = false;
            for (const nb of this.neighbors[cur]) {
                if (this.removed[nb]) continue;
                if (onPath[nb]) continue;   // 已走过（含起点）——不重复经过
                onPath[nb] = 1;
                curPath.push(nb);
                dfs(nb, len + 1);
                curPath.pop();
                onPath[nb] = 0;
                moved = true;
            }
            if (!moved) {
                // 死路：路径到此为止
                if (len > bestLen) { bestLen = len; ends.clear(); pathsOf.clear(); }
                if (len === bestLen && len > 0) { ends.add(cur); pathsOf.set(cur, curPath.slice()); }
            }
        };
        for (const f of firstSet) {
            onPath[f] = 1;
            curPath.push(f);
            dfs(f, 1);
            curPath.pop();
            onPath[f] = 0;
        }
        onPath[start] = 0;
        if (bestLen === 0 && stopEnds.size === 0) return null;
        for (const sv of stopEnds) ends.add(sv);   // 候选 = 最长路径终点 ∪ stop 格
        for (const [k, v] of stopPaths) if (!pathsOf.has(k)) pathsOf.set(k, v);   // 合并 stop 路径
        this.pathsOf = pathsOf;
        return Array.from(ends);
    }

    /** 每轮（所有人都行动完）结束：双方按各自占领地结算财富收入 */
    _settleLandIncome() {
        for (let sd = 0; sd < 2; sd++) {
            let inc = 0;
            for (let v = 0; v < this.cellCount; v++) {
                const cp = this.cellProps[v];
                if (!cp) continue;
                const own = (cp.type === 'redLandA' || cp.type === 'redLandB') ? 0
                    : ((cp.type === 'blueLandA' || cp.type === 'blueLandB') ? 1 : -1);
                if (own === sd) inc += this.landValue[v] || 0;
            }
            this.wealth[sd] += inc;
        }
    }

    /** 下一位玩家，自动掷骰子；一轮（所有人行动完）结束时结算占领收入 */
    _advanceTurn() {
        const next = (this.turnIndex + 1) % this.turnOrder.length;
        if (next === 0) this._settleLandIncome();   // 一轮结束：结算收入
        this.turnIndex = next;
        this._rollDice();
    }

    /** 玩家断开：释放座位；房主退出则按座位顺序由下一个坐下者继任 */
    onPlayerLeave(ws) {
        const me = this.players.get(ws);
        if (!me) return;
        const leftSeat = me.seat;
        if (leftSeat !== -1 && this.seats[leftSeat] === ws) this.seats[leftSeat] = null;
        this.players.delete(ws);
        if (this.hostWs === ws) {
            this.hostWs = this.seats.find(Boolean) || null;
        }
        this.broadcastState();
        // 还有人类则继续游戏：当前行动者若已离开（空座）→ 由 AI 立即接管
        if (this.phase === 'playing' && this.seats.some((w) => w != null)) {
            const cur = this.turnOrder[this.turnIndex];
            if (this.seats[cur] == null && !this.aiTimer) {
                this._scheduleAiAct(cur);
            }
        }
        // 没有人类了 → 暂停（_rollDice 检查后不再掷骰）
    }
}

module.exports = {
    generateHexBoardData,
    generateSquareBoardData,
    generateMapRule1,
    generateMapRule2,
    initRoom(room) {
        room.gameLogic = new DfwRoom(room);
        room.maxPlayers = DFW_MAX_PLAYERS;
    }
};
