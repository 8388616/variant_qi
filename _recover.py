# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
path = 'games/dfw.js'
lines = open(path, encoding='utf-8').read().split('\n')

# 行号（1-based）：A=1-65, B=66-215, D=231-423, C=426-540, E=541+
A = '\n'.join(lines[0:65])          # generateHexBoardData
B = '\n'.join(lines[65:215])        # 规则一核心（linkedWithin/canRemove/twoPass/removeChain）
D = '\n'.join(lines[230:423])       # wander/collectLoneCliqueSeeds/collectRingSeeds
C = '\n'.join(lines[425:540])       # 规则二主体（eligible/lightUp/主流程/第6步/兜底）
E = '\n'.join(lines[540:])          # DFW_LANES/DfwRoom/exports

# ============ 规则一补全（ringCleanup + constraintRepair + 主流程） ============
R1_TAIL = '''
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
'''

# ============ 规则二补全（函数头 + 辅助） ============
R2_HEAD = '''
/**
 * 【规则二】生成 DFW 棋盘格局（独立工具函数，不依赖页面/房间，可复用于其它场景）。
 * 输入：V = 六角格总数，neighbors = 每格的相邻格索引数组，dirs = 每格 6 方向邻接
 * （由 generateHexBoardData 提供）。onStage 为可选阶段回调（可视化调试用）。
 * 输出：Uint8Array（1 = 灭/移除的格，0 = 点亮/保留格）。
 *
 * 规则二流程（初始所有格全灭，逐渐点亮）：
 * 1. 从「可做初始格」候选池随机选格（点亮格已点亮邻格数 < 2 且未点亮；点亮某格时
 *    该格移出候选池，其邻格点亮邻格数达 2 时也移出），随机选初始方向，点亮。
 * 2. 沿方向前进点亮；重新选方向时沿用原方向的概率是其它每个可选方向的 20 倍
 *    （原方向不可用如到棋盘边缘时，等概率从其它可选方向选）。
 * 3. 点亮前进的格后，若它除前一个格之外还有其它之前点亮的邻格（撞上其它段/本段
 *    更早的格），则点亮这一格（连接两段）并中断，回到 1 重新选格。
 * 4. 总点亮格数 > 总格数 40% 时停止。
 * 5. 连通：每次取最小的孤立岛，连接与它最近的其它岛（点亮路径上的灭格），
 *    直至只有一个岛（一次 BFS 找全部分量，之后只更新）。
 * 6. 乱序熄灭：熄灭后仍连通且不产生 1 邻格的格则熄灭。
 * 7. 删除孤悬的格（<2 邻格）、团（极大团外部 1 邻点）、1~4 的环（只有一个邻点）：
 *    找到所有并删除，不再链式删除；之后从删除后的邻点出发按主线方式随机游走点亮，
 *    直至撞到另一个点（不额外处理其它环）。
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

    /** 乱序遍历点亮格：熄灭后若仍连通且不产生 1 邻格的格则熄灭 */
    const extinguishPass = () => {
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
            if (nbs.length === 0) { removed[v] = 1; lit--; continue; }
            let ok = true;
            for (const u of nbs) {
                let cnt = 0;
                for (const m of neighbors[u]) {
                    if (!removed[m] && m !== v) cnt++;
                }
                if (cnt < 2) { ok = false; break; }
            }
            if (!ok) continue;
            if (!nbsConnected(v, nbs)) continue;
            removed[v] = 1;
            lit--;
        }
    };

'''

out = A + '\n' + B + R1_TAIL + R2_HEAD + D + '\n' + C + E
open(path, 'w', encoding='utf-8').write(out)
print('恢复完成，行数:', len(out.split('\n')))
