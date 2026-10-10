/* JSON 棋谱：分叉对象用可选的 main 和 v1 / v2 等 key 表示后续变化。 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QiRecordTree = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const MAX_NODES = 20000;
    const MAX_DEPTH = 128;

    function parse(moves, options = {}) {
        if (!Array.isArray(moves)) throw new Error('棋谱 moves 必须是数组');
        const nodes = [{ id: 0, parent: null, move: null, children: [] }];
        function append(parent, move, key = 'main') {
            if (typeof move !== 'string' && (!move || typeof move !== 'object' || Array.isArray(move)))
                throw new Error('分支中的着法必须是字符串或着法对象');
            if (typeof move === 'string' && !move.trim()) throw new Error('分支中不能有空着法');
            if (nodes.length >= MAX_NODES) throw new Error('棋谱着法过多');
            const node = { id: nodes.length, parent: parent.id, move, key, children: [] };
            nodes.push(node);
            parent.children.push(node.id);
            return node;
        }
        function sequence(parent, entries, depth, key = 'main') {
            if (depth > MAX_DEPTH) throw new Error('棋谱分支嵌套过深');
            let tail = parent;
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (options.terminals && (entry === 'success' || entry === 'failure')) {
                    if (i !== entries.length - 1) throw new Error('答案标记须放在分支末尾');
                    tail.outcome = entry;
                    return;
                }
                if (Array.isArray(entry)) throw new Error('分叉请使用包含 main、v1 等 key 的对象');
                const branchKeys = entry && typeof entry === 'object' ? Object.keys(entry) : [];
                const isFork = branchKeys.includes('main') || branchKeys.some((k) => /^v\d+$/.test(k))
                    || branchKeys.length > 0 && branchKeys.every((k) => Array.isArray(entry[k]));
                if (isFork) {
                    if (i !== entries.length - 1) throw new Error('分叉对象须放在该条变化的末尾，后续着法请写在各分支中');
                    const keys = branchKeys.includes('main') ? ['main', ...branchKeys.filter((k) => k !== 'main')] : branchKeys;
                    for (const branchKey of keys) {
                        if (!Array.isArray(entry[branchKey]) || !entry[branchKey].length)
                            throw new Error('每个分支必须是非空着法数组');
                        sequence(tail, entry[branchKey], depth + 1, branchKey);
                    }
                    return;
                }
                tail = append(tail, entry, i === 0 ? key : 'main');
            }
        }
        sequence(nodes[0], moves, 0);
        return { nodes, root: nodes[0], hasBranches: nodes.some((n) => n.children.length > 1) };
    }

    function choose(tree, children, { preferMain = true, mainWeight = 1, random = Math.random } = {}) {
        if (!children.length) return undefined;
        const main = children.find((id) => tree.nodes[id].key === 'main');
        if (preferMain && main !== undefined) return main;
        const total = children.length + (main === undefined ? 0 : mainWeight - 1);
        let ticket = random() * total;
        for (const id of children) {
            ticket -= id === main ? mainWeight : 1;
            if (ticket < 0) return id;
        }
        return children[children.length - 1];
    }

    function path(tree, nodeId = 0, continueMain = true, options) {
        if (!Number.isInteger(nodeId) || !tree.nodes[nodeId]) throw new Error('不存在的棋谱分支');
        const ids = [];
        let node = tree.nodes[nodeId];
        while (node.parent !== null) { ids.push(node.id); node = tree.nodes[node.parent]; }
        ids.reverse();
        node = tree.nodes[nodeId];
        while (continueMain && node.children.length) {
            node = tree.nodes[choose(tree, node.children, options)];
            ids.push(node.id);
        }
        return { ids, moves: ids.map((id) => tree.nodes[id].move) };
    }

    function serialize(tree) {
        function sequence(parent) {
            const out = [];
            let node = parent;
            while (node.children.length === 1 && tree.nodes[node.children[0]].key === 'main') {
                node = tree.nodes[node.children[0]];
                out.push(node.move);
            }
            if (node.children.length) {
                const branches = Object.create(null);
                node.children.forEach((id) => {
                    const child = tree.nodes[id];
                    let key = child.key;
                    if (!key || Object.prototype.hasOwnProperty.call(branches, key)) {
                        let n = 1;
                        while (Object.prototype.hasOwnProperty.call(branches, 'v' + n)) n++;
                        key = 'v' + n;
                    }
                    branches[key] = [child.move, ...sequence(child)];
                });
                out.push(branches);
            }
            if (!node.children.length && node.outcome) out.push(node.outcome);
            return out;
        }
        return sequence(tree.root);
    }

    function movePoint(move) {
        if (move && typeof move === 'object') {
            const row = move.toRow ?? move.row ?? move.ix, col = move.toCol ?? move.col ?? move.iy;
            return Number.isFinite(row) && Number.isFinite(col) ? { row, col } : null;
        }
        if (typeof move !== 'string') return null;
        const travel = /^[A-Za-z]+(\d+),(\d+)-(\d+),(\d+)/.exec(move);
        const place = /^[A-Za-z]+(\d+),(\d+)/.exec(move);
        return travel ? { row: +travel[3], col: +travel[4] }
            : place ? { row: +place[1], col: +place[2] } : null;
    }

    function add(tree, parentId, move) {
        const parent = tree.nodes[parentId];
        if (!parent) throw new Error('不存在的分支起点');
        const identity = (entry) => typeof entry === 'string' ? entry.split('@')[0] : JSON.stringify(entry);
        const existing = parent.children.find((id) => identity(tree.nodes[id].move) === identity(move));
        if (existing !== undefined) return existing;
        if (tree.nodes.length >= MAX_NODES) throw new Error('棋谱着法过多');
        const used = new Set(parent.children.map((id) => tree.nodes[id].key));
        let index = 1;
        while (used.has('v' + index)) index++;
        const node = { id: tree.nodes.length, parent: parentId, move,
            key: parent.children.length ? 'v' + index : 'main', children: [] };
        delete parent.outcome;
        tree.nodes.push(node); parent.children.push(node.id);
        tree.hasBranches = tree.hasBranches || parent.children.length > 1;
        return node.id;
    }
    function setMain(tree, nodeId) {
        const node = tree.nodes[nodeId];
        if (!Number.isInteger(nodeId) || !node || node.parent === null) throw new Error('不存在的分支');
        const parent = tree.nodes[node.parent];
        const index = parent.children.indexOf(nodeId);
        if (index < 0) throw new Error('不存在的分支');
        if (node.key === 'main') return false;
        let key = node.key;
        if (!key || key === 'main') {
            const used = new Set(parent.children.map((id) => tree.nodes[id].key));
            let n = 1;
            while (used.has('v' + n)) n++;
            key = 'v' + n;
        }
        const oldMain = parent.children.find((id) => tree.nodes[id].key === 'main');
        if (oldMain !== undefined) tree.nodes[oldMain].key = key;
        node.key = 'main';
        parent.children.splice(index, 1);
        parent.children.unshift(nodeId);
        return true;
    }
    function setSide(tree, nodeId) {
        const node = tree.nodes[nodeId];
        if (!Number.isInteger(nodeId) || !node || node.parent === null) throw new Error('不存在的分支');
        const parent = tree.nodes[node.parent];
        if (!parent.children.includes(nodeId)) throw new Error('不存在的分支');
        if (node.key !== 'main') return false;
        const used = new Set(parent.children.map((id) => tree.nodes[id].key));
        let n = 1;
        while (used.has('v' + n)) n++;
        node.key = 'v' + n;
        return true;
    }
    return { parse, path, serialize, movePoint, add, setMain, setSide, choose };
});
