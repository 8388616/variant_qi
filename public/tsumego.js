/* 离线死活题：规则直接复用 games/，本地消息通道供原有棋盘插件使用。 */
(function () {
    'use strict';
    const route = window.__qiRoomRoute;
    const Rules = window.QiTsumegoRules;
    const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const colorNames = { black: '黑', white: '白', red: '红', blue: '蓝', green: '绿', yellow: '黄' };
    let params = new URLSearchParams(location.search);
    const embedded = window.parent !== window && location.pathname === '/qi/tsumego-view';
    const questionCache = new Map();
    const storageKey = 'qiTsumegoDraft';
    const requestedIndex = Number(params.get('index'));
    let socket, room, record, tree, files = [], index = Number.isSafeInteger(requestedIndex) ? requestedIndex : 0;
    let cursor = 0, played = [], undoPoints = [], finished = false, selectedPath = [];
    let status, firstSelect, titleInput, ready;
    let importing = false;
    let changingQuestion = false, viewReady = false, navigationPreviousIndex = null;
    let openingEditing = false, redispatchEdit = false;
    let viewContext, partialTurn = false;
    const api = window.QiTsumego = { authoring: params.get('mode') === 'author' };
    function report(text, result = '') {
        if (status) { status.textContent = text; status.dataset.result = result; }
    }
    function gameId(data) {
        const catalog = window.QiGameCatalog.games.filter((g) => g.enabled && window.__qiTsumegoGameIds.includes(g.id));
        const found = catalog.find((g) => g.id === data.gameId) || catalog.find((g) => g.id === data.gameType)
            || catalog.find((g) => g.name === data.gameType);
        if (!found) throw new Error('棋谱中没有支持死活题的 gameId / gameType');
        return found.id;
    }
    function normalize(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('题目必须是 JSON 对象');
        if (data.firstPlayer !== undefined && (typeof data.firstPlayer !== 'string' || !Object.hasOwn(colorNames, data.firstPlayer)))
            throw new Error('firstPlayer 须使用棋子颜色，例如 black、white、red、blue');
        const out = { ...clone(data), gameId: gameId(data), firstPlayer: data.firstPlayer, komi: data.komi ?? null };
        window.QiRecordTree.parse(out.moves || [], { terminals: true });
        return out;
    }
    function notifyHost(message) {
        if (embedded) window.parent.postMessage(message, location.origin);
    }
    function recordUrl(data, authoring, local = true) {
        const url = new URL('/qi/tsumego', location.origin);
        url.searchParams.set('game', data.gameId);
        if (authoring) url.searchParams.set('mode', 'author');
        else if (local) url.searchParams.set('mode', 'local');
        else url.searchParams.set('index', String(index));
        return url;
    }
    function updateLocation(data, authoring, local = true) {
        const url = recordUrl(data, authoring, local);
        notifyHost({ type: 'qiTsumegoLocation', url: url.pathname + url.search });
        url.pathname = '/qi/tsumego-view';
        history.replaceState(null, '', url.pathname + url.search);
        params = new URLSearchParams(url.search);
        refreshQuestionNumber();
    }
    function navigate(data, authoring, local = true) {
        if (local) sessionStorage.setItem(storageKey, JSON.stringify(data));
        const url = recordUrl(data, authoring, local);
        window.__qiRoomLeaving = true;
        if (embedded) { notifyHost({ type: 'qiTsumegoNavigate', url: url.pathname + url.search }); return; }
        url.pathname = '/qi/tsumego-view';
        location.replace(url.pathname + url.search);
    }
    function readQuestion(i) {
        const name = files[i];
        if (!questionCache.has(name)) {
            const request = fetch('/qi/tsumego/' + encodeURIComponent(name)).then((r) => {
                if (!r.ok) throw new Error('读取题目失败');
                return r.json();
            }).catch((error) => { questionCache.delete(name); throw error; });
            questionCache.set(name, request);
            if (questionCache.size > 8) questionCache.delete(questionCache.keys().next().value);
        }
        return questionCache.get(name);
    }
    function preloadQuestions() {
        if (files.length > 1) void Promise.allSettled([
            readQuestion((index + 1) % files.length), readQuestion((index + files.length - 1) % files.length)
        ]);
    }
    window.addEventListener('message', (event) => {
        if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
        if (event.data?.type === 'qiTsumegoNavigationCancelled') {
            if (navigationPreviousIndex !== null) questionCache.delete(files[index]);
            if (navigationPreviousIndex !== null) index = navigationPreviousIndex;
            navigationPreviousIndex = null;
            window.__qiRoomLeaving = false; changingQuestion = false; refreshUI();
            report(event.data.message, 'failure');
        }
    });
    // 在房间插件注册返回大厅事件前处理，避免在棋盘视图内嵌入大厅。
    document.addEventListener('click', (event) => {
        if (embedded && event.target.closest?.('#backToLobbyBtn')) {
            event.preventDefault(); event.stopImmediatePropagation(); notifyHost({ type: 'qiTsumegoLobby' });
        }
    }, true);
    function playerSlot() { return room?.firstPlayer || 'player1'; }
    function colorSlots(game) {
        const labels = (game.getState ? game.getState() : game.getStateForClient(null)).sideLabels || {};
        const slots = {};
        for (const slot of ['player1', 'player2']) {
            const name = typeof game.getChatSideLabel === 'function' ? game.getChatSideLabel(slot) : labels[slot] || '';
            const colors = Object.keys(colorNames).filter((color) => name.includes(colorNames[color]));
            for (const color of colors.length ? colors : [slot === 'player1' ? 'black' : 'white']) slots[color] = slot;
        }
        return slots;
    }
    function turn(game, first) {
        const slot = game._tsumegoColorSlots[first];
        const val = slot === 'player2' ? 2 : 1;
        game.currentPlayer = game._tsumegoStringPlayer ? slot : val;
        if (game.turnColor !== undefined) game.turnColor = { black: 1, white: 2, red: 3, blue: 4 }[first];
        if (game.sideToMove !== undefined) {
            const a = game._tsumegoDefaultSide;
            const opposite = { red: 'black', black: 'white', white: 'black', blue: 'red' };
            game.sideToMove = val === game._tsumegoDefaultPlayer ? a : opposite[a] || a;
            if (a === 'red') game.sideToMove = val === game._tsumegoDefaultPlayer ? a : 'black';
        }
    }
    function applyOpening(game, data, setTurn = true) {
        if (Array.isArray(data.initialPosition) && Array.isArray(game.board) && Array.isArray(game.board[0])) {
            const pieces = game.board.some((r) => r.some((v) => typeof v === 'string'));
            // 保留棋盘外格、洞等几何信息，只清除棋子。
            game.board = game.board.map((r) => r.map((v) => pieces ? '' : v === 1 || v === 2 ? 0 : v));
            for (const entry of data.initialPosition) {
                if (typeof entry !== 'string') continue;
                const m = /^([A-Za-z]+)(\d+),(\d+)$/.exec(entry);
                if (!m || !game.board[+m[2]] || +m[3] >= game.board[+m[2]].length) continue;
                const values = { B: 1, W: 2, R: 3, L: 4, N: 10000, H: -1, I: -2, M: -3 };
                game.board[+m[2]][+m[3]] = pieces ? m[1] : values[m[1]] ?? 0;
            }
        }
        if (game.board) game.openingBoard = clone(game.board);
        if (setTurn) turn(game, data.firstPlayer);
    }
    class NativeRoom {
        constructor(data, author = false) {
            this.gameType = data.gameId; this.roomId = ''; this.players = new Map();
            this.slotOccupancy = new Map(); this.observers = new Set(); this.maxPlayers = 2;
            this.messages = []; this.silent = true;
            Rules.game.initRoom(this);
            const game = this.gameLogic;
            if (typeof game.importRecord !== 'function' || typeof game.exportRecord !== 'function')
                throw new Error('该棋类尚无棋谱导入规则');
            game._tsumegoDefaultSide = game.sideToMove;
            game._tsumegoDefaultPlayer = game.currentPlayer === 2 || game.currentPlayer === 'player2' ? 2 : 1;
            game._tsumegoStringPlayer = typeof game.currentPlayer === 'string';
            this.colorSlots = game._tsumegoColorSlots = colorSlots(game);
            this.defaultFirstColor = Object.keys(this.colorSlots).find((color) => this.colorSlots[color] === 'player1');
            data.firstPlayer ??= this.defaultFirstColor;
            this.firstColor = data.firstPlayer;
            this.firstPlayer = this.colorSlots[this.firstColor];
            if (!this.firstPlayer) { this.dispose(); throw new Error('该棋类不支持 firstPlayer: ' + this.firstColor); }
            if (typeof game.buildGuessSnapshotsFromEvents === 'function') {
                const build = game.buildGuessSnapshotsFromEvents.bind(game);
                game.buildGuessSnapshotsFromEvents = (events) => {
                    if (this.firstPlayer !== 'player2') return build(events);
                    const swap = (slot) => slot === 'player1' ? 'player2' : slot === 'player2' ? 'player1' : slot;
                    const snapshots = build(events.map((e) => ({ ...e, player: swap(e.player) })));
                    return snapshots?.map((s) => ({ ...s, currentPlayer: swap(s.currentPlayer), winner: swap(s.winner),
                        board: s.board.map((r) => r.map((v) => v === 1 ? 2 : v === 2 ? 1 : v)),
                        lastMoveMarkers: (s.lastMoveMarkers || []).map((m) => ({ ...m, color: m.color === 1 ? 2 : m.color === 2 ? 1 : m.color })) }));
                };
            }
            const rawExport = game.exportRecord.bind(game);
            const defaults = rawExport();
            game.exportRecord = () => {
                const out = { ...rawExport(), gameId: data.gameId, firstPlayer: this.firstColor };
                if (out.initialPosition === undefined && Array.isArray(game.openingBoard) && Array.isArray(game.openingBoard[0])) {
                    out.initialPosition = [];
                    game.openingBoard.forEach((row, r) => row.forEach((value, c) => {
                        if (typeof value === 'string' && value) out.initialPosition.push(value + r + ',' + c);
                        else {
                            const prefix = { 1: 'B', 2: 'W', 10000: 'N', '-1': 'H', '-2': 'I', '-3': 'M' }[value];
                            if (prefix) out.initialPosition.push(prefix + r + ',' + c);
                        }
                    }));
                }
                return out;
            };
            const rawImport = game.importRecord.bind(game);
            game.importRecord = async (input, client) => {
                input = { ...defaults, ...input, gameId: defaults.gameId };
                this.firstColor = input.firstPlayer || this.firstColor;
                this.firstPlayer = this.colorSlots[this.firstColor];
                if (!this.firstPlayer) throw new Error('该棋类不支持 firstPlayer: ' + this.firstColor);
                let opening;
                const reset = game.resetToEmpty;
                const boardDescriptor = Object.getOwnPropertyDescriptor(game, 'board');
                let board = game.board, firstBoard = true, importedOpening;
                if (boardDescriptor?.configurable && boardDescriptor.writable) Object.defineProperty(game, 'board', {
                    configurable: true, enumerable: true, get: () => board, set: (next) => {
                        board = next;
                        if (firstBoard) {
                            firstBoard = false; applyOpening(game, input, false); importedOpening = clone(board);
                        }
                    }
                });
                const descriptor = Object.getOwnPropertyDescriptor(game, 'currentPlayer');
                let player = game.currentPlayer, firstAssignment = true;
                if (descriptor?.configurable && descriptor.writable) Object.defineProperty(game, 'currentPlayer', {
                    configurable: true, enumerable: true, get: () => player, set: (next) => {
                        if (firstAssignment) {
                            firstAssignment = false;
                            player = typeof next === 'string' ? this.firstPlayer : this.firstPlayer === 'player2' ? 2 : 1;
                        } else player = next;
                    }
                });
                if (reset) game.resetToEmpty = (...args) => {
                    const result = reset.apply(game, args);
                    applyOpening(game, input); opening = clone(game.board);
                    return result;
                };
                try { return await rawImport(input, client); }
                finally {
                    if (reset) game.resetToEmpty = reset;
                    if (opening || importedOpening) game.openingBoard = opening || importedOpening;
                    if (boardDescriptor?.configurable && boardDescriptor.writable) Object.defineProperty(game, 'board', { ...boardDescriptor, value: board });
                    if (descriptor?.configurable && descriptor.writable) Object.defineProperty(game, 'currentPlayer', { ...descriptor, value: player });
                    if (!(input.moves || []).length) turn(game, this.firstColor);
                }
            };
            if (author) {
                // 依据原生局面的行棋方决定新着法的默认分支类型，连续多手和先行方换色也适用。
                this.recordVariationDefaultsToSide = (scratch) => {
                    if (roundGame()) return true;
                    const g = scratch.gameLogic;
                    const state = g.getState ? g.getState() : g.getStateForClient(null);
                    const slot = state.currentPlayer === 2 || state.currentPlayer === 'player2' ? 'player2' : 'player1';
                    return slot === this.firstPlayer;
                };
                Rules.records.install(this, () => new NativeRoom(data), (r) => r.dispose());
            }
        }
        setPlayerSlot(ws, slot) { this.players.set(ws, slot); this.slotOccupancy.set(slot, ws); this.observers.delete(ws); }
        getSlotByWs(ws) { return this.players.get(ws) || null; }
        getPlayerBySlot(slot) { return this.slotOccupancy.get(slot) || null; }
        getPlayerCount() { return this.players.size; }
        getHumanCount() { return this.players.size; }
        getSeatedCount() { return this.players.size; }
        addObserver(ws) { this.observers.add(ws); }
        removeClient(ws) { const s = this.players.get(ws); this.players.delete(ws); this.slotOccupancy.delete(s); this.observers.delete(ws); }
        clearDestroyTimer() {}
        scheduleDestroyIfEmpty() {}
        broadcast(message) {
            this.messages.push(clone(message));
            if (message.type === 'importSuccess' && this.onImport) this.onImport(message);
            if (!this.silent && this === room) emit(message);
        }
        dispose() {
            const g = this.gameLogic;
            for (const key of ['_clockInterval', 'clockInterval', '_ticker']) if (g[key]) clearInterval(g[key]);
            if (typeof g._stopClockTicker === 'function') g._stopClockTicker();
        }
    }
    function state() {
        const g = room.gameLogic;
        const seat = room.getPlayerBySlot(playerSlot());
        return g.getStateForClient ? g.getStateForClient(seat) : g.getState();
    }
    function emit(message) {
        if (!socket || socket.readyState !== 1) return;
        if (message.recordPath) selectedPath = message.recordPath;
        if (message.type === 'error') {
            if (api.authoring) socket.receive({ type: 'recordVariationIgnored' });
            report(message.message, 'failure'); return;
        }
        socket.receive({ ...message, ...(message.type === 'joined' ? {} : { recordEnded: api.authoring }) });
        refreshUI();
    }
    async function importNative(target, data) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('载入棋谱超时')), 10000);
            function finish(error, message) {
                clearTimeout(timer); target.onImport = null;
                target.observers.delete(client);
                if (error) reject(error); else resolve(message);
            }
            target.onImport = (message) => finish(null, message);
            const client = { readyState: 1, send(raw) {
                const m = JSON.parse(raw);
                if (m.type === 'error') finish(new Error(m.message));
                if (m.type === 'importSuccess') target.broadcast(m);
            } };
            target.addObserver(client);
            try {
                Promise.resolve(target.gameLogic.importRecord(Rules.common.normalizeQiRecordForImport(target.gameLogic, data), client))
                    .catch((e) => finish(e));
            } catch (e) { finish(e); }
        });
    }
    function activateGame() {
        const g = room.gameLogic;
        g.gameOver = false; g.winner = null; g.recordResultText = null;
        g.matchStarted = true; g.tcSettings = { timed: false }; g.tcClock = null; g.tcNego = null;
        for (const slot of ['player1', 'player2']) room.setPlayerSlot({ readyState: 1, send() {} }, slot);
        if (g.slots) { g.slots.player1 = true; g.slots.player2 = true; }
    }
    async function rebuild(moves, initial = false) {
        const previousRoom = room;
        const nextRoom = new NativeRoom(record, api.authoring);
        const data = { ...record, format: 'muzei-tsumego', moves, result: null, resultText: null, timeControl: null };
        let message;
        try {
            message = await importNative(nextRoom, data);
            room = nextRoom;
            if (!api.authoring) activateGame();
            if (typeof room.gameLogic.generateCandidates === 'function' && !(room.gameLogic.candidates || []).length) {
                room.gameLogic.matchStarted = !api.authoring;
                await room.gameLogic.generateCandidates();
            }
            if (!api.authoring && tree) prepareCandidates(tree.nodes[cursor]);
        } catch (error) {
            nextRoom.dispose(); room = previousRoom; throw error;
        }
        if (previousRoom) previousRoom.dispose();
        room.silent = false;
        if (initial) {
            emit({ type: 'joined', role: api.authoring ? 'observer' : 'player', slot: api.authoring ? null : playerSlot(),
                state: { ...state(), slots: api.authoring ? { player1: false, player2: false } : { player1: true, player2: true } } });
            emit({ type: 'roomSwitchState', canSwitch: api.authoring });
        } else {
            if (!api.authoring) emit({ type: 'colorAssigned', color: playerSlot(), isHost: true });
            emit({ type: 'roomReset', ...state(), slots: api.authoring ? { player1: false, player2: false } : { player1: true, player2: true } });
        }
        if (api.authoring && moves.length) {
            emit({ ...message, ...state(), type: 'importSuccess', recordEnded: true });
            emit({ ...message, type: 'recordTree', recordStep: 0, recordRestore: false, recordEnded: true });
        }
        refreshUI();
    }
    async function restart(initial = false) {
        const previous = { cursor, played, undoPoints, finished, openingEditing, partialTurn, tree };
        cursor = 0; played = []; undoPoints = []; finished = false; openingEditing = false; partialTurn = false;
        tree = window.QiRecordTree.parse(record.moves || [], { terminals: true });
        try { await rebuild(api.authoring ? record.moves || [] : [], initial); }
        catch (error) {
            ({ cursor, played, undoPoints, finished, openingEditing, partialTurn, tree } = previous);
            throw error;
        }
        report('');
        if (!api.authoring && !tree.root.children.length) {
            if (!files.length && !(record.moves || []).length) report('暂无题目，可导入 JSON 棋谱或创作题目。');
            else complete(tree.root.outcome);
        }
    }
    function complete(outcome) {
        if (finished) return;
        finished = true;
        report('');
        window.qiAlert(outcome === 'success' ? '答对了。' : '答错了。');
    }
    function sameMove(a, b) {
        if (typeof a === 'string' && typeof b === 'string') return a.split('@')[0] === b.split('@')[0];
        if (typeof a !== typeof b) {
            const parse = (m) => {
                if (typeof m !== 'string') return m;
                const parser = room.gameLogic.constructor.parseRecordedMove || room.gameLogic.constructor.parseMoveEntry || room.gameLogic.constructor.parseMove;
                if (parser) return parser.call(room.gameLogic.constructor, m);
                const travel = /^[A-Za-z]+(\d+),(\d+)-(\d+),(\d+)/.exec(m);
                if (travel) return { type: 'move', fromRow: +travel[1], fromCol: +travel[2], toRow: +travel[3], toCol: +travel[4] };
                const point = window.QiRecordTree.movePoint(m);
                return point ? { type: 'move', ...point } : /^[A-Za-z]+p$/i.test(m) ? { type: 'pass' } : null;
            };
            const x = parse(a), y = parse(b);
            if (x && y) return ['type', 'row', 'col', 'fromRow', 'fromCol', 'toRow', 'toCol', 'ix', 'iy'].every((key) => x[key] === y[key]);
        }
        return JSON.stringify(a) === JSON.stringify(b);
    }
    function prepareCandidates(node) {
        const g = room.gameLogic;
        for (const id of node.children) {
            const move = tree.nodes[id].move;
            const parser = g.constructor.parseRecordedMove || g.constructor.parseMoveEntry || g.constructor.parseMoveRound;
            if (!parser) continue;
            const parsed = parser.call(g.constructor, move);
            const candidates = parsed?.candidatesBefore || parsed?.select?.candidatesBefore;
            if (candidates) { g.candidates = clone(candidates); break; }
        }
    }
    const roundGame = () => ['sync-weiqi', 'guess-wuziqi'].includes(route.gameType);
    function round(move) {
        const C = room.gameLogic.constructor;
        if (route.gameType === 'guess-wuziqi') return C.parseMoveRound(move);
        if (route.gameType === 'sync-weiqi') return C.parseTurnEntry(move);
        return null;
    }
    function roundActions(move) {
        const r = round(move);
        if (!r || r.err) return null;
        if (r.select) return { mine: { ...r.select, type: 'move' }, peer: { ...r.guess, type: 'guess' }, slot: r.select.player };
        const mine = playerSlot() === 'player1' ? r.black : r.white;
        const peer = playerSlot() === 'player1' ? r.white : r.black;
        return { mine: mine ? { type: 'move', ...mine } : { type: 'pass' }, peer: peer ? { type: 'move', ...peer } : { type: 'pass' }, slot: playerSlot() };
    }
    function isPlayerTurn() {
        if (route.gameType === 'sync-weiqi') return true;
        const current = state().currentPlayer;
        return current === playerSlot() || current === (playerSlot() === 'player1' ? 1 : 2);
    }
    async function play(message) {
        if (api.authoring || finished) return;
        const g = room.gameLogic, node = tree.nodes[cursor];
        prepareCandidates(node);
        const before = g.exportRecord().moves || [];
        const emittedAt = room.messages.length;
        room.silent = true;
        g.handleMessage(room.getPlayerBySlot(playerSlot()), message);
        await Promise.resolve();
        let after = g.exportRecord().moves || [];
        if (roundGame() && after.length === before.length && (g.phase === 'guess' || g.pendingBlack || g.pendingWhite)) {
            const matching = node.children.filter((id) => {
                const actions = roundActions(tree.nodes[id].move);
                return actions && actions.slot === playerSlot() && actions.mine.type === message.type
                    && (message.type === 'pass' || actions.mine.row === message.row && actions.mine.col === message.col);
            });
            if (!matching.length) {
                room.silent = false; undoPoints.push({ cursor, played: clone(played) });
                emit({ type: 'gameState', ...state() }); complete('failure'); return;
            }
            const selected = window.QiRecordTree.choose(tree, matching, { preferMain: false, mainWeight: 2 });
            const actions = roundActions(tree.nodes[selected].move);
            g.handleMessage(room.getPlayerBySlot(playerSlot() === 'player1' ? 'player2' : 'player1'), actions.peer);
            await Promise.resolve(); after = g.exportRecord().moves || [];
        }
        room.silent = false;
        if (after.length <= before.length) {
            // 一手包含多次点选的棋类继续展示其原生中间阶段。
            for (const pending of room.messages.slice(emittedAt)) if (pending.type === 'broadcast') { partialTurn = true; emit(pending); }
            return;
        }
        partialTurn = false;
        undoPoints.push({ cursor, played: clone(played) });
        const added = after.slice(before.length);
        emit({ type: 'gameState', ...state() });
        for (const move of added) {
            const id = tree.nodes[cursor].children.find((id) => sameMove(tree.nodes[id].move, move));
            if (id === undefined) { complete('failure'); return; }
            played.push(tree.nodes[id].move); cursor = id;
        }
        if (!tree.nodes[cursor].children.length) { complete(tree.nodes[cursor].outcome); return; }
        // 多子棋种可能仍轮到玩家，遵循其原有回合规则。
        while (!isPlayerTurn()) {
            const parent = tree.nodes[cursor];
            const id = window.QiRecordTree.choose(tree, parent.children, { preferMain: false, mainWeight: 2 });
            if (id === undefined) { complete(parent.outcome); return; }
            played.push(tree.nodes[id].move); cursor = id;
            await rebuild(played);
            if (!tree.nodes[cursor].children.length) { complete(tree.nodes[cursor].outcome); return; }
        }
        prepareCandidates(tree.nodes[cursor]);
        emit({ type: 'gameState', ...state() });
        report('');
    }
    function saveDraft() {
        if (!api.authoring || !room) return;
        const current = room.gameLogic.exportRecord();
        const answers = openingEditing ? clone(record.moves || []) : null;
        record = { ...record, ...current, format: 'muzei-tsumego', firstPlayer: firstSelect.value,
            title: titleInput.value, komi: record.komi ?? null, result: null, resultText: null };
        if (answers) record.moves = answers;
        if (room.recordTree) record.moves = window.QiRecordTree.serialize(room.recordTree.tree);
        sessionStorage.setItem(storageKey, JSON.stringify(record));
    }
    function mark(outcome) {
        if (room._pendingRecordMoves || room._pendingRound) { report('请先完成这一手棋，或悔棋取消当前点选。'); return; }
        const study = room.recordTree;
        if (!study) { report('请先点击“添加分支”并落子。'); return; }
        const stride = route.gameType.startsWith('choice-') ? 2 : route.gameType === 'guess-wuziqi' ? 3 : 1;
        const step = Math.floor(Number(document.getElementById('replaySlider').value) / stride);
        const node = study.tree.nodes[step ? selectedPath[step - 1] : 0];
        if (!node) return;
        const deleted = [], stack = [...node.children];
        while (stack.length) { const id = stack.pop(); stack.push(...study.tree.nodes[id].children); deleted.push(id); study.tree.nodes[id] = null; }
        node.children = []; node.outcome = outcome;
        study.version++; study.cache.clear();
        study.record.moves = window.QiRecordTree.serialize(study.tree);
        emit({ type: 'recordTreeUpdated', recordNodes: study.tree.nodes, recordTree: study.record.moves,
            recordTreeVersion: study.version, recordPath: study.path, replayData: study.replayData, recordDeleted: deleted, recordEnded: true });
        const button = document.getElementById('addRecordVariationBtn');
        if (button && button.textContent === '结束添加') button.click();
        saveDraft(); report(outcome === 'success' ? '此分支已设为正确。' : '此分支已设为错误。');
    }
    async function process(message) {
        if (['leave', 'ping', 'exportRecord', 'prepareVsComputer', 'chat'].includes(message.type)) return;
        await ready;
        if (window.__qiRoomLeaving || changingQuestion) return;
        if (message.type === 'join') {
            await restart(true);
            if (!viewReady) requestAnimationFrame(() => requestAnimationFrame(() => {
                viewReady = true;
                const url = recordUrl(record, api.authoring, params.has('mode'));
                notifyHost({ type: 'qiTsumegoReady', url: url.pathname + url.search });
                preloadQuestions();
            }));
            return;
        }
        if (!room) return;
        if (message.type === 'switchGame' && api.authoring) {
            navigate({ format: 'muzei-tsumego', version: 2, gameId: message.game, gameType: message.game,
                komi: null, moves: [] }, true); return;
        }
        if (message.type === 'importRecord') { await loadRecord(message.data, api.authoring); return; }
        if (message.type === 'requestNewGame' || message.type === 'resetRoom') { await restart(); return; }
        if (message.type === 'requestUndo') { await undo(); return; }
        if (['move', 'pass', 'quoridorPawn', 'quoridorWall'].includes(message.type) && !api.authoring) { await play(message); return; }
        if (!api.authoring) return;
        if (message.type === 'beginRecordVariations') {
            room._pendingRound = null;
            room._pendingRecordMoves = null;
            if (openingEditing) { saveDraft(); await restart(); }
            room.gameLogic.gameOver = true;
            await room.beginRecordVariations(socket.client, message); saveDraft(); return;
        }
        const handlers = { addRecordVariation: 'addRecordVariation', deleteRecordVariation: 'deleteRecordVariation', selectRecordVariation: 'selectRecordVariation', setMainRecordVariation: 'setMainRecordVariation', setSideRecordVariation: 'setSideRecordVariation' };
        if (handlers[message.type]) {
            if (message.type !== 'addRecordVariation') { room._pendingRound = null; room._pendingRecordMoves = null; }
            if (['deleteRecordVariation', 'setMainRecordVariation', 'setSideRecordVariation'].includes(message.type)) room.gameLogic.gameOver = true;
            if (message.type === 'addRecordVariation' && roundGame()) {
                if (!room._pendingRound || room._pendingRound.parentId !== message.parentId) {
                    const prefix = window.QiRecordTree.path(room.recordTree.tree, message.parentId, false);
                    const scratch = new NativeRoom(record);
                    try {
                        await importNative(scratch, { ...record, moves: prefix.moves, result: null, resultText: null });
                        const g = scratch.gameLogic;
                        g.gameOver = false; g.matchStarted = true; g.tcSettings = { timed: false }; g.tcNego = null;
                        const seat = { readyState: 1, send() {} };
                        const current = g.currentPlayer === 'player2' || g.currentPlayer === 2 ? 'player2' : playerSlot();
                        scratch.setPlayerSlot(seat, current); g.handleMessage(seat, message.move);
                        if (g.phase === 'guess' || g.pendingBlack || g.pendingWhite) {
                            room._pendingRound = { ...message, slot: current };
                            report(route.gameType === 'sync-weiqi' ? '再选择对方的落点，完成这一轮。' : '再选择对方的猜测点，完成这一轮。');
                        }
                    } finally { scratch.dispose(); }
                    emit({ type: 'recordVariationIgnored' }); return;
                }
                const first = room._pendingRound; room._pendingRound = null;
                room.applyRecordMove = (scratch) => {
                    const g = scratch.gameLogic;
                    g.handleMessage(scratch.getPlayerBySlot(first.slot), first.move);
                    g.handleMessage(scratch.getPlayerBySlot(first.slot === 'player1' ? 'player2' : 'player1'),
                        { ...message.move, type: route.gameType === 'guess-wuziqi' ? 'guess' : message.move.type });
                };
                try { await room.addRecordVariation(socket.client, first); }
                finally { room.applyRecordMove = null; }
                saveDraft(); return;
            }
            if (message.type === 'addRecordVariation') {
                const cached = room._pendingRecordMoves;
                const previous = cached?.parentId === message.parentId && cached.version === message.recordTreeVersion ? cached.moves : [];
                let partial = false, complete = false;
                room.applyRecordMove = async (scratch, slot, move) => {
                    const g = scratch.gameLogic;
                    const sendMove = (action) => {
                        const s = g.getState ? g.getState() : g.getStateForClient(slot);
                        const player = s.currentPlayer === 2 || s.currentPlayer === 'player2' ? 'player2' : 'player1';
                        g.handleMessage(scratch.getPlayerBySlot(player), action);
                    };
                    for (const action of previous) sendMove(action);
                    const stateOf = () => g.getState ? g.getState() : g.getStateForClient(slot);
                    const identity = (s) => JSON.stringify({ ...s, matchTime: null, clock: null });
                    const before = identity(stateOf()), count = g.exportRecord().moves.length;
                    sendMove(move); await Promise.resolve();
                    complete = g.exportRecord().moves.length > count;
                    partial = !complete && before !== identity(stateOf());
                    if (partial && viewContext) {
                        const snapshot = stateOf();
                        viewContext.syncState?.(snapshot);
                        if (snapshot.board && viewContext.setBoard) viewContext.setBoard(clone(snapshot.board));
                        viewContext.drawBoard?.();
                    }
                };
                try { await room.addRecordVariation(socket.client, message); }
                finally { room.applyRecordMove = null; }
                room._pendingRecordMoves = complete ? null : partial ? { parentId: message.parentId, version: message.recordTreeVersion,
                    moves: [...previous, clone(message.move)] } : cached;
                if (partial) report('继续落子，完成这一手。');
                if (complete) saveDraft();
                return;
            }
            await room[handlers[message.type]](socket.client, message);
            saveDraft(); return;
        }
        if (['editBoard', 'boardSize', 'changeBoardSize', 'setBoardSize', 'changeSubGame', 'setSubGame', 'subGame'].includes(message.type)) {
            room.gameLogic.gameOver = false; room.gameLogic.matchStarted = false;
            room.gameLogic.tcSettings = null; room.players.clear(); room.slotOccupancy.clear();
            room.gameLogic.handleMessage(socket.client, message);
            room.recordTree = null;
            emit({ type: 'recordTreeCleared' }); saveDraft();
            if (message.type === 'editBoard' && openingEditing) await restart();
            return;
        }
        // 其余房间协议（聊天、座位、计时等）不属于离线题目。
    }
    async function undo() {
        if (api.authoring) {
            if (room._pendingRecordMoves || room._pendingRound) {
                room._pendingRecordMoves = null; room._pendingRound = null;
                const slider = document.getElementById('replaySlider');
                viewContext?.setReplayStep(Number(slider.value)); return;
            }
            const slider = document.getElementById('replaySlider');
            slider.value = Math.max(0, Number(slider.value) - (route.gameType.startsWith('choice-') ? 2 : 1));
            slider.dispatchEvent(new Event('input', { bubbles: true })); return;
        }
        if (partialTurn) {
            partialTurn = false; await rebuild(played); report(''); return;
        }
        const point = undoPoints.pop();
        if (!point) return;
        cursor = point.cursor; played = point.played; finished = false;
        await rebuild(played); prepareCandidates(tree.nodes[cursor]); emit({ type: 'gameState', ...state() }); report('');
    }
    class OfflineSocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) {
            super(); this.url = String(url); this.readyState = 0; this.queue = Promise.resolve(); socket = this;
            this.client = { readyState: 1, send(raw) { emit(JSON.parse(raw)); } };
            queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); if (this.onopen) this.onopen(new Event('open')); });
        }
        receive(message) {
            const e = new MessageEvent('message', { data: JSON.stringify(message) });
            this.dispatchEvent(e); if (this.onmessage && !e.cancelBubble) this.onmessage(e);
        }
        send(raw) {
            const message = JSON.parse(raw);
            this.queue = this.queue.then(() => process(message)).catch((error) => {
                console.error(error); report(error.message, 'failure');
                if (!viewReady) notifyHost({ type: 'qiTsumegoLoadError', message: error.message });
            });
        }
        close() { this.readyState = 3; }
    }
    window.WebSocket = OfflineSocket;
    function refreshQuestionNumber() {
        const display = document.getElementById('turnDisplay');
        if (!display || !record) return;
        const text = params.has('mode') ? (api.authoring ? '创作题目' : '本地题目')
            : files.length ? '第' + (index + 1) + '题' : '暂无题目';
        if (display.textContent !== text) display.textContent = text;
    }
    function refreshUI() {
        if (!document.body || !record) return;
        document.body.classList.add('qi-tsumego');
        document.body.classList.toggle('tsumego-author', api.authoring);
        document.title = '死活题';
        const komi = document.getElementById('komiInfo');
        if (komi) { komi.hidden = record.komi == null; komi.style.display = record.komi == null ? 'none' : ''; if (record.komi != null) komi.textContent = '贴目：' + record.komi; }
        for (const id of ['boardSizeSelect', 'subGameSelect', 'gameTitleInfo']) {
            const el = document.getElementById(id); if (el) el.disabled = !api.authoring || changingQuestion;
        }
        for (const id of ['importBtn', 'undoBtn', 'newGameBtn', 'exportBtn']) {
            const el = document.getElementById(id); if (el) { el.hidden = false; el.disabled = changingQuestion; }
        }
        document.querySelectorAll('.tsumego-author-only').forEach((el) => { el.hidden = !api.authoring; });
        refreshQuestionNumber();
        const create = document.getElementById('tsumegoCreateBtn');
        if (create) { create.textContent = api.authoring ? '退出创作' : '创作题目'; create.disabled = changingQuestion; }
        for (const id of ['tsumegoPreviousBtn', 'tsumegoNextBtn']) {
            const el = document.getElementById(id); if (el) el.disabled = api.authoring || !files.length || changingQuestion;
        }
        if (firstSelect && room) {
            const colors = Object.keys(room.colorSlots);
            if (Array.from(firstSelect.options, (option) => option.value).join() !== colors.join()) {
                firstSelect.replaceChildren();
                for (const color of colors) {
                    const option = document.createElement('option'); option.value = color;
                    option.textContent = colorNames[color] + '先'; firstSelect.appendChild(option);
                }
            }
            firstSelect.value = record.firstPlayer;
        }
        if (api.authoring) {
            const controls = document.getElementById('editControls');
            if (controls?.dataset.qiEditFeature === '1') controls.hidden = false;
            const checkbox = document.getElementById('editModeCheckbox');
            if (checkbox) checkbox.disabled = false;
            if (viewContext?.pageState.currentShapeIndex !== undefined) {
                document.getElementById('bottomPalette')?.classList.remove('observer-mode');
                document.querySelectorAll('#shapeSelector .piece-btn').forEach((el) => el.classList.remove('disabled'));
            }
        }
    }
    async function loadRecord(data, author = false, local = true) {
        const next = normalize(data);
        if (next.gameId !== route.gameType) { navigate(next, author, local); return; }
        const previousRecord = record, previousAuthor = api.authoring;
        record = next; api.authoring = author;
        if (firstSelect) firstSelect.value = record.firstPlayer;
        if (titleInput) titleInput.value = record.title || '';
        refreshUI();
        try { await restart(); }
        catch (error) {
            record = previousRecord; api.authoring = previousAuthor;
            if (firstSelect) firstSelect.value = record.firstPlayer;
            if (titleInput) titleInput.value = record.title || '';
            refreshUI(); throw error;
        }
        // 题目切换可能同时从创建模式回到解题，重新同步座位及设置的可用性。
        emit({ type: 'joined', role: author ? 'observer' : 'player', slot: author ? null : playerSlot(), state: state() });
        emit({ type: 'roomSwitchState', canSwitch: author });
        if (local) sessionStorage.setItem(storageKey, JSON.stringify(record));
        updateLocation(record, author, local);
    }
    async function changeQuestion(delta) {
        if (api.authoring || !files.length || !room || changingQuestion) return;
        changingQuestion = true; refreshUI();
        const previousIndex = index;
        const nextIndex = (index + delta + files.length) % files.length;
        try {
            const data = normalize(await readQuestion(nextIndex));
            await socket.queue;
            index = nextIndex;
            navigationPreviousIndex = previousIndex;
            await loadRecord(data, false, false);
            if (!window.__qiRoomLeaving) { navigationPreviousIndex = null; preloadQuestions(); }
        } catch (error) {
            questionCache.delete(files[nextIndex]);
            index = previousIndex; navigationPreviousIndex = null; throw error;
        }
        finally {
            if (!window.__qiRoomLeaving) { changingQuestion = false; refreshUI(); }
        }
    }
    function download() {
        if (api.authoring) saveDraft();
        const data = { ...record, format: 'muzei-tsumego', firstPlayer: record.firstPlayer || room.defaultFirstColor, komi: record.komi ?? null };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = (data.title || '死活题') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function setup() {
        document.body.classList.add('qi-tsumego');
        const panel = document.querySelector('.button-panel');
        const addButton = (id, text, fn, authorOnly = false, container = panel) => {
            const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'ctrl-btn' + (authorOnly ? ' tsumego-author-only' : '');
            b.textContent = text; b.onclick = () => Promise.resolve(fn()).catch((e) => report(e.message, 'failure')); container.appendChild(b); return b;
        };
        const turnDisplay = document.getElementById('turnDisplay');
        const questionNav = document.createElement('div'); questionNav.className = 'tsumego-question-nav';
        questionNav.setAttribute('role', 'group'); questionNav.setAttribute('aria-label', '切换题目');
        addButton('tsumegoPreviousBtn', '上一题', () => changeQuestion(-1), false, questionNav);
        addButton('tsumegoNextBtn', '下一题', () => changeQuestion(1), false, questionNav);
        turnDisplay.after(questionNav);
        // 原棋种插件仍会写入回合文本；死活题独立维护题号，按钮作为相邻元素不会被这些更新清除。
        new MutationObserver(refreshQuestionNumber).observe(turnDisplay, { childList: true, characterData: true, subtree: true });
        addButton('tsumegoCorrectBtn', '设为正确', () => mark('success'), true);
        addButton('tsumegoWrongBtn', '设为错误', () => mark('failure'), true);
        addButton('tsumegoCreateBtn', '创作题目', async () => {
            if (api.authoring) { saveDraft(); navigate(record, false); return; }
            const base = { ...record, moves: [], result: null, resultText: null, format: 'muzei-tsumego' };
            navigate(base, true);
        });
        const tools = document.createElement('div'); tools.className = 'tsumego-tools tsumego-author-only';
        firstSelect = document.createElement('select'); firstSelect.id = 'tsumegoFirstPlayer'; firstSelect.className = 'board-size-select tsumego-author-only'; firstSelect.setAttribute('aria-label', '先手');
        for (const [value, text] of [['black', '黑先'], ['white', '白先']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; firstSelect.appendChild(option);
        }
        document.getElementById('boardSizeSelect').after(firstSelect);
        firstSelect.onchange = async () => { saveDraft(); record.firstPlayer = firstSelect.value; await restart(); };
        titleInput = document.createElement('input'); titleInput.id = 'tsumegoTitle'; titleInput.className = 'tsumego-title-input tsumego-author-only'; titleInput.placeholder = '题目名称'; titleInput.setAttribute('aria-label', '题目名称'); titleInput.oninput = saveDraft;
        tools.appendChild(titleInput); panel.before(tools);
        status = document.createElement('div'); status.id = 'tsumegoStatus'; status.className = 'tsumego-status'; status.setAttribute('role', 'status'); panel.after(status);
        // 捕获按钮事件，避免原房间的确认、开局协商和联网棋谱导出。
        document.addEventListener('click', (event) => {
            const bag = event.target.closest('.vl-bag-slot-btn');
            if (api.authoring && bag && viewContext) {
                event.preventDefault(); event.stopImmediatePropagation();
                viewContext.pageState.selectedBagIndex = Array.from(bag.parentElement.children).indexOf(bag);
                document.querySelectorAll('.vl-bag-slot-btn').forEach((el) => el.classList.toggle('active', el === bag));
                return;
            }
            const button = event.target.closest('button'); if (!button) return;
            const actions = { newGameBtn: () => restart(), undoBtn: undo, exportBtn: download };
            if (!actions[button.id]) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (changingQuestion) return;
            Promise.resolve(actions[button.id]()).catch((e) => report(e.message, 'failure'));
        }, true);
        const input = document.getElementById('importFileInput');
        input.addEventListener('change', async (event) => {
            event.stopImmediatePropagation(); const file = input.files[0]; if (!file || importing || changingQuestion) return;
            importing = true;
            try {
                const text = await file.text();
                const data = /\.sgf$/i.test(file.name) ? window.QiSgf.sgfToRecord(text, { gameId: route.gameType }).record : JSON.parse(text);
                await loadRecord(data, api.authoring);
            } catch (e) { report('导入失败：' + e.message, 'failure'); }
            finally { importing = false; input.value = ''; }
        }, true);
        document.getElementById('editModeCheckbox').addEventListener('change', async (event) => {
            if (!api.authoring || redispatchEdit || !event.target.checked) return;
            event.stopImmediatePropagation();
            try {
                saveDraft(); openingEditing = true;
                await rebuild([]);
                event.target.checked = true; redispatchEdit = true;
                event.target.dispatchEvent(new Event('change', { bubbles: true }));
                redispatchEdit = false;
                report('编辑初始棋盘；确认后保留已有答案分支。');
            } catch (e) { redispatchEdit = false; report(e.message, 'failure'); }
        }, true);
        files = await fetch('/qi/tsumego-files').then((r) => { if (!r.ok) throw new Error('读取题目列表失败'); return r.json(); });
        if (params.has('mode') && sessionStorage.getItem(storageKey)) record = normalize(JSON.parse(sessionStorage.getItem(storageKey)));
        else if (files.length) {
            index = ((index % files.length) + files.length) % files.length;
            record = normalize(await readQuestion(index));
        } else record = { format: 'muzei-tsumego', version: 2, gameId: route.gameType, gameType: route.gameType, komi: null, moves: [] };
        if (record.gameId !== route.gameType) { navigate(record, api.authoring, params.has('mode')); return; }
        firstSelect.value = record.firstPlayer; titleInput.value = record.title || ''; refreshUI();
    }
    ready = new Promise((resolve, reject) => document.addEventListener('DOMContentLoaded', () => setup().then(resolve, reject), { once: true }));
    api.getRecord = () => clone(record);
    api.getFirstPlayer = () => record?.firstPlayer || 'black';
    api.getPlayerSlot = playerSlot;
    api.getRoom = () => room;
    api.recordPoint = (move) => {
        const actions = roundGame() && room ? roundActions(move) : null;
        return actions ? (actions.mine.type === 'move' ? actions.mine : null) : window.QiRecordTree.movePoint(move);
    };
    // 走子棋的旧回放器以标准开局、第一方先手生成快照。死活题回放使用原生规则
    // 计算选中的前缀，补齐编辑残局和第二方先手的快照；无需改动每个棋种的绘制器。
    api.attachReplay = (ctx) => {
        viewContext = ctx;
        if (route.gameType === 'guess-wuziqi') ctx.recordReplayStride = 3;
        const ps = ctx.pageState, originalEnter = ctx.enterReplayMode, originalStep = ctx.setReplayStep;
        if (!ctx.recordMoveFromPoint && (ps.currentShapeIndex !== undefined || ps.blackBag && ps.whiteBag)) {
            ctx.recordMoveFromPoint = (point) => {
                const move = { type: 'move', ...point };
                if (ps.currentShapeIndex !== undefined) {
                    Object.assign(move, ps.normalGoPhase ? { singleStone: true } : { shapeIndex: ps.currentShapeIndex,
                        rotation: ps.rotation || 0, flipped: !!ps.flipped });
                }
                if (ps.blackBag && ps.whiteBag) {
                    const step = Number(document.getElementById('replaySlider').value) || 0;
                    const previous = step ? room.recordTree?.tree.nodes[selectedPath[step - 1]]?.move : null;
                    const player = previous ? (typeof previous === 'string' && previous[0] === 'B' ? 'player2' : 'player1') : playerSlot();
                    const bag = player === 'player1' ? ps.blackBag : ps.whiteBag;
                    move.level = bag[Math.min(ps.selectedBagIndex || 0, bag.length - 1)];
                }
                return move;
            };
        }
        if (!originalEnter || !originalStep) return;
        const canvas = document.getElementById('goBoard');
        if (ctx.recordPointToCanvas) {
            const project = ctx.recordPointToCanvas;
            ctx.recordPointToCanvas = (row, col) => {
                const p = project(row, col);
                // 部分走子棋在安装回放器之后才重设画布尺寸，须按调用时的尺寸投影。
                return p ? { ...p, x: p.x * 600 / canvas.width, y: p.y * 600 / canvas.height,
                    cell: p.cell * 600 / canvas.width, size: 600 } : p;
            };
        }
        let data, generation = 0;
        async function patchStep() {
            if (!api.authoring || !data || !ps.replayMode || !Array.isArray(ps.replaySnapshots)) return;
            const step = Number(ps.replayStep) || 0, request = ++generation;
            const scratch = new NativeRoom(record);
            try {
                await importNative(scratch, { ...record, moves: (data.moves || []).slice(0, step), result: null, resultText: null, timeControl: null });
                if (request !== generation || !ps.replayMode) return;
                const g = scratch.gameLogic;
                const snapshot = g.getState ? g.getState() : g.getStateForClient(null);
                const total = (data.moves || []).length;
                const base = ps.replaySnapshots[0] || {};
                ps.replaySnapshots = Array.from({ length: total + 1 }, (_, i) => ps.replaySnapshots[i] || clone(base));
                ps.replayTotalSteps = total;
                ps.replaySnapshots[step] = { ...ps.replaySnapshots[step], ...snapshot };
                originalStep(step);
            } catch (e) { report('回放失败：' + e.message, 'failure'); }
            finally { scratch.dispose(); }
        }
        ctx.enterReplayMode = (next) => {
            data = next; generation++;
            originalEnter(next);
            if (Array.isArray(ps.replaySnapshots)) {
                const base = ps.replaySnapshots[0] || {};
                ps.replaySnapshots = Array.from({ length: (next.moves || []).length + 1 }, (_, i) => ps.replaySnapshots[i] || clone(base));
                ps.replayTotalSteps = (next.moves || []).length;
            }
            patchStep();
        };
        ctx.setReplayStep = (step) => { originalStep(step); patchStep(); };
        document.getElementById('replaySlider').addEventListener('input', () => queueMicrotask(patchStep));
        document.addEventListener('click', (event) => { if (event.target.closest('#replayPanel button')) queueMicrotask(patchStep); });
    };
})();
