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
 * 输入：V = 六角格总数，neighbors = 每格的相邻格索引数组，dirs = 每格 6 方向邻接
 * （由 generateHexBoardData 提供）。onStage 为可选阶段回调（可视化调试用）。
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
function generateMapRule2(V, neighbors, dirs, onStage) {
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
        // 1) 找所有 K3（三格两两相邻）
        const k3s = [];
        const k3Seen = new Set();
        for (let i = 0; i < V; i++) {
            if (removed[i]) continue;
            for (const u of neighbors[i]) {
                if (u <= i || removed[u]) continue;
                for (const w of neighbors[i]) {
                    if (w === u || removed[w]) continue;
                    let adjU = false;
                    for (const m of neighbors[u]) {
                        if (m === w) { adjU = true; break; }
                    }
                    if (!adjU) continue;
                    const cells = [i, u, w].sort((a, b) => a - b);
                    const key = cells.join(',');
                    if (!k3Seen.has(key)) {
                        k3Seen.add(key);
                        k3s.push(cells);
                    }
                }
            }
        }
        // 2) 并查集：共享一条边（2 格）的 K3 属于同一极大团
        const parent = new Int32Array(k3s.length);
        for (let i = 0; i < k3s.length; i++) parent[i] = i;
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
        const edgeToK3 = new Map();
        for (let k = 0; k < k3s.length; k++) {
            const [a, b, c] = k3s[k];
            for (const [x, y] of [[a, b], [b, c], [a, c]]) {
                const key = x < y ? x * V + y : y * V + x;
                if (!edgeToK3.has(key)) edgeToK3.set(key, []);
                edgeToK3.get(key).push(k);
            }
        }
        for (const list of edgeToK3.values()) {
            for (let i = 1; i < list.length; i++) union(list[0], list[i]);
        }
        // 3) 极大团分组，判断「外部亮邻格数 == 1」
        const groups = new Map();
        for (let k = 0; k < k3s.length; k++) {
            const r = find(k);
            if (!groups.has(r)) groups.set(r, []);
            groups.get(r).push(...k3s[k]);
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
        // 团检查（含豁免）：next 与亮邻中两两相邻的格构成团 C。
        // 不能贪心扩展（顺序敏感会漏判 K3）——从每个互相相邻的亮邻对（K3 边）扩展成
        // 极大团，逐一检查豁免；存在任一不豁免的团 → 判团。
        // 豁免：C 的亮邻点（集合外、棋盘上实际存在的邻点）中找 |C| 个两两不相邻的格
        const litNbs = [];
        for (const nb of neighbors[next]) if (!removed[nb]) litNbs.push(nb);
        if (litNbs.length >= 2 && worst > 1) {
            outer:
            for (let ai = 0; ai < litNbs.length; ai++) {
                for (let bi = ai + 1; bi < litNbs.length; bi++) {
                    const a = litNbs[ai], b = litNbs[bi];
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
                    // 豁免判定：C 的亮邻点中找 |C| 个两两不相邻（DFS 精确）
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
                    if (!found) { worst = 1; break outer; }   // 存在不豁免的团 → 判团
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
            for (let d = 0; d < 6; d++) {
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
                    for (let d = 0; d < 6; d++) {
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
                for (let d = 0; d < 6; d++) {
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
                let worst = 6;
                for (const e of log) {
                    const sev = shapeSeverity(e.v);
                    if (sev < worst) worst = sev;
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
                for (let d = 0; d < 6; d++) {
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
                    for (let d = 0; d < 6; d++) {
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
                for (let d = 0; d < 6; d++) {
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
        if (onStage) onStage(removed, 'final');
        lastRemoved = removed;
        // 7) 兜底：点亮 <10% 时全部清空重来
        if (lit >= MIN_KEPT) return removed;
    }
    return lastRemoved;
}
const DFW_LANES = 64;
class DfwRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        const { cellCount, neighbors, dirs } = generateHexBoardData(DFW_LANES);
        this.cellCount = cellCount;
        this.neighbors = neighbors;
        // 棋盘格局（removed: 1=被移除的格子）：当前页面使用规则二，同步即时完成
        this.removed = generateMapRule2(cellCount, neighbors, dirs);
    }

    getState() {
        return {
            boardSize: DFW_LANES,
            cellCount: this.cellCount,
            removed: Array.from(this.removed)
        };
    }

    handleMessage(ws, msg) {
        // DFW 为纯棋盘展示：无对局、无棋子相关消息
    }
}

module.exports = {
    generateHexBoardData,
    generateMapRule1,
    generateMapRule2,
    initRoom(room) {
        room.gameLogic = new DfwRoom(room);
        room.maxPlayers = 2;
    }
};
