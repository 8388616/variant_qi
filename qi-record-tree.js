'use strict';

const Tree = require('./public/record-tree');
const { normalizeQiRecordForImport } = require('./common');
const clone = (value) => JSON.parse(JSON.stringify(value));
function replayBundle(message) {
    const { replayData, ...state } = message;
    return clone({ ...(replayData || { moves: state.moveCoords || [] }), recordState: state });
}
function rememberCandidates(study, selected, replay) {
    const candidates = replay.recordState && replay.recordState.candidates;
    if (!Array.isArray(candidates) || !candidates.length) return replay;
    if (!study.candidates) study.candidates = new Map();
    const id = selected.ids[selected.ids.length - 1] || 0;
    if (!study.candidates.has(id)) study.candidates.set(id, clone(candidates));
    return { ...replay, recordState: { ...replay.recordState, candidates: clone(study.candidates.get(id)) } };
}

// 棋谱树与对局盘面分开保存。选择支线只在临时房间计算，不改变真实房间。
function install(room, createScratch, disposeScratch) {
    const logic = room.gameLogic;
    if (!logic || logic._qiRecordTreeInstalled || typeof logic.importRecord !== 'function') return;
    logic._qiRecordTreeInstalled = true;
    const originalImport = logic.importRecord.bind(logic);
    const originalExport = typeof logic.exportRecord === 'function' ? logic.exportRecord.bind(logic) : null;
    const originalBroadcast = room.broadcast.bind(room);
    let pending = null;
    let version = 0;
    let writing = false;

    logic.importRecord = (data, client) => {
        try {
            const tree = Tree.parse(data && data.moves || [], { terminals: data && data.format === 'muzei-tsumego' });
            const main = Tree.path(tree);
            pending = main.moves.length ? { tree, record: clone(data), path: main.ids, version: ++version, cache: new Map() } : null;
            room.recordTree = null;
            return originalImport({ ...data, moves: main.moves }, client);
        } catch (error) {
            pending = null;
            client.send(JSON.stringify({ type: 'error', message: error.message }));
        }
    };
    room.broadcast = (message, exclude) => {
        if (message.type === 'importSuccess' && pending) {
            const study = pending;
            pending = null;
            study.replayData = replayBundle(message);
            study.exportedMain = originalExport ? clone(originalExport().moves || []) : [];
            room.recordTree = study;
            message = { ...message, replayData: study.replayData, recordTree: study.record.moves, recordNodes: study.tree.nodes,
                recordPath: study.path, recordTreeVersion: study.version };
        } else if (['roomReset', 'newGameStarted', 'boardSizeChanged', 'subGameChanged'].includes(message.type)) {
            if (message.type === 'roomReset') pending = null;
            room.recordTree = null;
        } else if (room.recordTree && message.type === 'broadcast' && originalExport
            && JSON.stringify(originalExport().moves || []) !== JSON.stringify(room.recordTree.exportedMain)) {
            room.recordTree = null;
            originalBroadcast({ type: 'recordTreeCleared' });
        }
        return originalBroadcast(message, exclude);
    };
    if (originalExport) logic.exportRecord = (...args) => {
        const record = originalExport(...args);
        const study = room.recordTree;
        if (study && JSON.stringify(record.moves || []) === JSON.stringify(study.exportedMain))
            return { ...record, moves: clone(study.record.moves) };
        return record;
    };
    for (const method of ['resetGame', 'resetToEmpty']) {
        if (typeof logic[method] !== 'function') continue;
        const reset = logic[method].bind(logic);
        logic[method] = (...args) => {
            room.recordTree = null;
            return reset(...args);
        };
    }

    room.sendRecordTree = (client) => {
        const study = room.recordTree;
        if (study) client.send(JSON.stringify({ type: 'recordTree', recordTree: study.record.moves,
            recordNodes: study.tree.nodes, recordPath: study.path, recordTreeVersion: study.version, replayData: study.replayData,
            recordEnded: !!logic.gameOver }));
    };

    room.beginRecordVariations = async (client, message) => {
        if (!logic.gameOver || !originalExport) {
            client.send(JSON.stringify({ type: 'error', message: '只有对局结束后才能在回放中添加分支。' }));
            return;
        }
        try {
            let study = room.recordTree;
            if (!study) {
                const record = clone(originalExport());
                const tree = Tree.parse(record.moves || []);
                const main = Tree.path(tree);
                const replayData = await replayVariation(room, record, createScratch, disposeScratch);
                if (!logic.gameOver) return;
                study = { tree, record, path: main.ids, replayData, version: ++version,
                    exportedMain: clone(record.moves || []), cache: new Map() };
                room.recordTree = study;
            }
            const selected = Tree.path(study.tree, message.nodeId === undefined
                ? study.path[Math.max(0, Number(message.step) - 1)] || 0 : message.nodeId);
            let replayData = JSON.stringify(selected.ids) === JSON.stringify(study.path) ? study.replayData
                : await replayVariation(room, { ...study.record, moves: selected.moves,
                    result: null, resultText: null }, createScratch, disposeScratch);
            if (room.gameType.startsWith('choice-') && !(replayData.recordState.candidates || []).length)
                replayData = await replayVariation(room, { ...study.record, moves: selected.moves,
                    result: null, resultText: null }, createScratch, disposeScratch);
            replayData = rememberCandidates(study, selected, replayData);
            if (!logic.gameOver || room.recordTree !== study) throw new Error('房间已开始新对局，请结束后再添加分支。');
            client.send(JSON.stringify({ type: 'recordTree', recordTree: study.record.moves,
                recordNodes: study.tree.nodes, recordPath: selected.ids, recordTreeVersion: study.version, replayData,
                recordStep: Math.max(0, Math.min(selected.ids.length, Number(message.step) || 0)), recordEditing: true, recordEnded: !!logic.gameOver }));
        } catch (error) {
            client.send(JSON.stringify({ type: 'error', message: '无法开始分支编辑：' + error.message }));
        }
    };

    room.addRecordVariation = async (client, message) => {
        const study = room.recordTree;
        if (!logic.gameOver || !study || message.recordTreeVersion !== study.version) {
            client.send(JSON.stringify({ type: 'error', message: '对局尚未结束或棋谱已更新，不能添加分支。' }));
            return;
        }
        if (writing) {
            client.send(JSON.stringify({ type: 'error', message: '另一个页面正在保存分支，请稍后重试。' }));
            return;
        }
        writing = true;
        try {
            const prefix = Tree.path(study.tree, message.parentId, false);
            const move = message.move;
            if (!move || !['move', 'pass', 'quoridorPawn', 'quoridorWall'].includes(move.type)) throw new Error('不支持的分支着法');
            const next = study.tree.nodes[message.parentId].children.map((id) => study.tree.nodes[id].move);
            const added = await replayVariation(room, { ...study.record, moves: prefix.moves,
                result: null, resultText: null }, createScratch, disposeScratch, async (scratch) => {
                const game = scratch.gameLogic;
                game.gameOver = false; game.winner = null; game.recordResultText = '';
                game.matchStarted = true; game.tcSettings = { timed: false }; game.tcClock = null; game.tcNego = null;
                const candidates = next.map((entry) => {
                    if (typeof game.constructor.parseRecordedMove === 'function') return game.constructor.parseRecordedMove(entry);
                    if (typeof game.constructor.parseMoveEntry === 'function') return game.constructor.parseMoveEntry(entry);
                    if (entry && typeof entry === 'object') return entry;
                    return null;
                }).find((entry) => entry && Array.isArray(entry.candidatesBefore));
                if (candidates) game.candidates = clone(candidates.candidatesBefore);
                else if (study.candidates && study.candidates.has(message.parentId))
                    game.candidates = clone(study.candidates.get(message.parentId));
                let rejected = null;
                const seat = () => ({ readyState: 1, send(data) {
                    const reply = JSON.parse(data);
                    if (reply.type === 'error') rejected = reply.message;
                } });
                const a = seat(), b = seat();
                scratch.setPlayerSlot(a, 'player1'); scratch.setPlayerSlot(b, 'player2');
                const state = game.getState ? game.getState() : game.getStateForClient(a);
                const slot = state.currentPlayer === 2 || state.currentPlayer === 'player2' || state.currentPlayer === 'white' ? b : a;
                const defaultSide = typeof room.recordVariationDefaultsToSide === 'function'
                    && room.recordVariationDefaultsToSide(scratch);
                const before = game.exportRecord().moves || [];
                if (typeof room.applyRecordMove === 'function') await room.applyRecordMove(scratch, slot, move);
                else game.handleMessage(slot, move);
                // 候选点生成可能通过微任务完成；导出的 candidatesBefore 已在提交着法时保存。
                await Promise.resolve();
                const after = game.exportRecord().moves || [];
                if (rejected || after.length !== before.length + 1) {
                    const error = new Error(rejected || '该点不能落子');
                    error.code = 'ILLEGAL_RECORD_MOVE';
                    throw error;
                }
                return { move: after[after.length - 1], defaultSide };
            });
            if (room.recordTree !== study || !logic.gameOver || message.recordTreeVersion !== study.version)
                throw new Error('棋谱已被其他页面更新，请重新选择起点。');
            const candidateTree = { nodes: clone(study.tree.nodes), hasBranches: study.tree.hasBranches };
            candidateTree.root = candidateTree.nodes[0];
            const addedId = Tree.add(candidateTree, message.parentId, added.move);
            if (added.defaultSide && addedId >= study.tree.nodes.length) Tree.setSide(candidateTree, addedId);
            const selected = Tree.path(candidateTree, addedId);
            const replayData = rememberCandidates(study, selected, await replayVariation(room, { ...study.record, moves: selected.moves,
                result: null, resultText: null }, createScratch, disposeScratch));
            if (room.recordTree !== study || message.recordTreeVersion !== study.version) throw new Error('棋谱已更新，请重试。');
            const main = Tree.path(candidateTree);
            const mainReplay = JSON.stringify(main.ids) === JSON.stringify(study.path) ? study.replayData
                : await replayVariation(room, { ...study.record, moves: main.moves }, createScratch, disposeScratch);
            if (room.recordTree !== study || message.recordTreeVersion !== study.version) throw new Error('棋谱已更新，请重试。');
            study.tree = candidateTree;
            study.record.moves = Tree.serialize(study.tree);
            study.path = main.ids;
            study.replayData = mainReplay;
            study.version = version = Math.max(version, study.version) + 1;
            study.cache.clear();
            // id 随新增节点保持不变；发送节点表，避免重新解析后的遍历顺序改变旧节点 id。
            room.broadcast({ type: 'recordTreeUpdated', recordTree: study.record.moves,
                recordNodes: study.tree.nodes, recordTreeVersion: study.version,
                recordPath: study.path, replayData: study.replayData, recordEnded: !!logic.gameOver });
            client.send(JSON.stringify({ type: 'recordVariation', replayData, recordPath: selected.ids,
                recordTreeVersion: study.version, recordStep: selected.ids.indexOf(addedId) + 1, recordEditing: true }));
        } catch (error) {
            client.send(JSON.stringify(error.code === 'ILLEGAL_RECORD_MOVE'
                ? { type: 'recordVariationIgnored' }
                : { type: 'error', message: '无法添加分支：' + error.message }));
        } finally { writing = false; }
    };

    room.deleteRecordVariation = async (client, message) => {
        const study = room.recordTree;
        if (!logic.gameOver || !study || message.recordTreeVersion !== study.version) {
            client.send(JSON.stringify({ type: 'error', message: '对局尚未结束或棋谱已更新，不能删除分支。' }));
            return;
        }
        if (writing) {
            client.send(JSON.stringify({ type: 'error', message: '另一个页面正在保存分支，请稍后重试。' }));
            return;
        }
        writing = true;
        try {
            const node = study.tree.nodes[message.nodeId];
            if (!Number.isInteger(message.nodeId) || !node || node.parent === null) throw new Error('不存在的分支');
            const candidateTree = { nodes: clone(study.tree.nodes) };
            candidateTree.root = candidateTree.nodes[0];
            const parent = candidateTree.nodes[node.parent];
            parent.children = parent.children.filter((id) => id !== node.id);
            if (node.key === 'main' && parent.children.length) candidateTree.nodes[parent.children[0]].key = 'main';
            const deleted = [], stack = [node.id];
            while (stack.length) {
                const id = stack.pop();
                stack.push(...candidateTree.nodes[id].children);
                deleted.push(id);
                // 保留其余节点的 id，使其它页面和正在进行的回放不会指向另一手棋。
                candidateTree.nodes[id] = null;
            }
            candidateTree.hasBranches = candidateTree.nodes.some((n) => n && n.children.length > 1);
            const main = Tree.path(candidateTree);
            const replayData = JSON.stringify(main.ids) === JSON.stringify(study.path) ? study.replayData
                : await replayVariation(room, { ...study.record, moves: main.moves }, createScratch, disposeScratch);
            if (room.recordTree !== study || !logic.gameOver || message.recordTreeVersion !== study.version)
                throw new Error('棋谱已更新，请重试。');
            study.tree = candidateTree;
            study.record.moves = Tree.serialize(candidateTree);
            study.path = main.ids;
            study.replayData = replayData;
            study.version = version = Math.max(version, study.version) + 1;
            study.cache.clear();
            if (study.candidates) deleted.forEach((id) => study.candidates.delete(id));
            room.broadcast({ type: 'recordTreeUpdated', recordTree: study.record.moves,
                recordNodes: study.tree.nodes, recordTreeVersion: study.version,
                recordPath: study.path, replayData, recordDeleted: deleted, recordEnded: true });
        } catch (error) {
            client.send(JSON.stringify({ type: 'error', message: '无法删除分支：' + error.message }));
        } finally { writing = false; }
    };

    async function setVariationKind(client, message, makeMain) {
        const name = makeMain ? '主线' : '支线';
        const study = room.recordTree;
        if (!logic.gameOver || !study || message.recordTreeVersion !== study.version) {
            client.send(JSON.stringify({ type: 'error', message: '对局尚未结束或棋谱已更新，不能设置' + name + '。' }));
            return;
        }
        if (writing) {
            client.send(JSON.stringify({ type: 'error', message: '另一个页面正在保存分支，请稍后重试。' }));
            return;
        }
        writing = true;
        try {
            const candidateTree = { nodes: clone(study.tree.nodes), hasBranches: study.tree.hasBranches };
            candidateTree.root = candidateTree.nodes[0];
            const changed = makeMain ? Tree.setMain(candidateTree, message.nodeId) : Tree.setSide(candidateTree, message.nodeId);
            const main = Tree.path(candidateTree);
            const replayData = JSON.stringify(main.ids) === JSON.stringify(study.path) ? study.replayData
                : await replayVariation(room, { ...study.record, moves: main.moves }, createScratch, disposeScratch);
            if (room.recordTree !== study || !logic.gameOver || message.recordTreeVersion !== study.version)
                throw new Error('棋谱已更新，请重试。');
            if (changed) {
                study.tree = candidateTree;
                study.record.moves = Tree.serialize(candidateTree);
                study.path = main.ids;
                study.replayData = replayData;
                study.version = version = Math.max(version, study.version) + 1;
                study.cache.clear();
            }
            const update = { type: 'recordTreeUpdated', recordTree: study.record.moves,
                recordNodes: study.tree.nodes, recordTreeVersion: study.version,
                recordPath: study.path, replayData: study.replayData, recordMainChanged: message.nodeId, recordEnded: true };
            if (changed) room.broadcast(update);
            else client.send(JSON.stringify(update));
        } catch (error) {
            client.send(JSON.stringify({ type: 'error', message: '无法设置' + name + '：' + error.message }));
        } finally { writing = false; }
    }
    room.setMainRecordVariation = (client, message) => setVariationKind(client, message, true);
    room.setSideRecordVariation = (client, message) => setVariationKind(client, message, false);

    room.selectRecordVariation = async (client, message) => {
        const study = room.recordTree;
        if (!study || message.recordTreeVersion !== study.version) {
            client.send(JSON.stringify({ type: 'error', message: '棋谱已更新，请刷新后重新选择分支。' }));
            return;
        }
        try {
            const selected = Tree.path(study.tree, message.nodeId);
            const cacheKey = JSON.stringify(selected.ids);
            let replay = study.cache.get(cacheKey);
            if (!replay) {
                if (study.cache.size >= 32) study.cache.delete(study.cache.keys().next().value);
                replay = replayVariation(room, { ...study.record, moves: selected.moves, result: null, resultText: null }, createScratch, disposeScratch);
                study.cache.set(cacheKey, replay);
                replay.catch(() => study.cache.delete(cacheKey));
            }
            const replayData = rememberCandidates(study, selected, await replay);
            if (room.recordTree !== study || client.readyState !== 1) return;
            client.send(JSON.stringify({ type: 'recordVariation', replayData, recordPath: selected.ids,
                recordTreeVersion: study.version, recordStep: message.step === undefined ? selected.ids.indexOf(message.nodeId) + 1
                    : Math.max(0, Math.min(selected.ids.length, Number(message.step) || 0)) }));
        } catch (error) {
            client.send(JSON.stringify({ type: 'error', message: '支线回放失败：' + error.message }));
        }
    };
}

async function replayVariation(room, record, createScratch, disposeScratch, afterImport) {
    const scratch = createScratch(room);
    try {
        const data = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('支线计算超时')), 10000);
            const finish = (error, data) => {
                clearTimeout(timer);
                if (error) reject(error); else resolve(clone(data));
            };
            scratch.broadcast = (message) => {
                if (message.type === 'importSuccess') finish(null, replayBundle(message));
            };
            const client = { readyState: 1, send(data) {
                const message = JSON.parse(data);
                if (message.type === 'error') finish(new Error(message.message));
                else if (message.type === 'importSuccess') finish(null, replayBundle(message));
            } };
            try { scratch.gameLogic.importRecord(normalizeQiRecordForImport(scratch.gameLogic, record), client); }
            catch (error) { finish(error); }
        });
        // 选点围棋的导入不会启动对局；分析支线末尾仍需下一手候选点。
        // 仅启动临时盘面的候选生成，真实房间保持结束状态。
        const game = scratch.gameLogic;
        if (room.gameType.startsWith('choice-') && !record.result && typeof game.generateCandidates === 'function'
            && !(game.candidates || []).length) {
            game.matchStarted = true;
            await game.generateCandidates();
            data.recordState.candidates = clone(game.candidates || []);
        }
        return afterImport ? await afterImport(scratch, data) : data;
    } finally { disposeScratch(scratch); }
}

module.exports = { install };
