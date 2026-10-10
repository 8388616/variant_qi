/* 导入棋谱的分支浏览：复用棋种自己的回放器，圆环独立于候选点绘制。 */
(function () {
    'use strict';
    function create(ctx) {
        const state = ctx.pageState;
        const movePoint = (move) => window.__qiTsumego ? window.QiTsumego.recordPoint(move) : window.QiRecordTree.movePoint(move);
        const canvas = document.getElementById('goBoard');
        const slider = document.getElementById('replaySlider');
        if (!canvas || !slider || typeof ctx.enterReplayMode !== 'function' || typeof ctx.setReplayStep !== 'function') return { handle() {} };
        let tree = null, path = [], version = null, active = false, busy = false, editing = false, source = null, ended = false;
        let pendingPoint = null;
        let successfulNodes = new Set();
        function refreshOutcomes() {
            successfulNodes = new Set();
            if (!window.__qiTsumego || !tree) return;
            for (const node of tree.nodes) {
                if (node?.outcome !== 'success') continue;
                let current = node;
                while (current && !successfulNodes.has(current.id)) {
                    successfulNodes.add(current.id);
                    current = current.parent === null ? null : tree.nodes[current.parent];
                }
            }
        }
        const editingOpening = () => window.__qiTsumego && (!!state.editModeEnabled
            || !!document.getElementById('editModeCheckbox')?.checked);
        const authoringAnswer = () => window.__qiTsumego && !!window.QiTsumego?.authoring && !editingOpening();
        let frame = 0, signature = '', hoverPosition = null;
        const overlay = document.createElement('div');
        overlay.className = 'record-variation-overlay';
        overlay.id = 'recordVariationOverlay';
        overlay.setAttribute('aria-label', '棋谱分支');
        const pointsLayer = document.createElement('div');
        const hoverPreview = document.createElement('div');
        hoverPreview.className = 'record-variation-hover';
        hoverPreview.hidden = true;
        overlay.append(pointsLayer, hoverPreview);
        const contextMenu = document.createElement('div');
        contextMenu.id = 'recordVariationContextMenu';
        contextMenu.className = 'record-variation-context-menu';
        contextMenu.setAttribute('role', 'menu');
        contextMenu.hidden = true;
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button'; deleteButton.textContent = '删除分支';
        deleteButton.id = 'deleteRecordVariationBtn';
        deleteButton.setAttribute('role', 'menuitem');
        const mainButton = document.createElement('button');
        mainButton.type = 'button'; mainButton.textContent = '设为主线'; mainButton.id = 'setMainRecordVariationBtn';
        mainButton.setAttribute('role', 'menuitem'); mainButton.hidden = true;
        const sideButton = document.createElement('button');
        sideButton.type = 'button'; sideButton.textContent = '设为支线'; sideButton.id = 'setSideRecordVariationBtn';
        sideButton.setAttribute('role', 'menuitem'); sideButton.hidden = true;
        contextMenu.append(deleteButton, mainButton, sideButton);
        document.body.append(overlay, contextMenu);
        function closeMenu() { contextMenu.hidden = true; }
        function showMenu(event, nodeId) {
            event.preventDefault(); event.stopPropagation();
            hoverPosition = null; hoverPreview.hidden = true;
            deleteButton.disabled = busy || !ended;
            deleteButton.onclick = () => {
                closeMenu();
                const socket = ctx.getWs();
                if (busy || !ended || !socket || socket.readyState !== 1) return;
                busy = true; source = null; refresh();
                socket.send(JSON.stringify({ type: 'deleteRecordVariation', nodeId, recordTreeVersion: version }));
            };
            const node = tree && tree.nodes[nodeId];
            mainButton.hidden = !node || node.key === 'main';
            mainButton.disabled = busy || !ended;
            mainButton.onclick = () => {
                closeMenu();
                const socket = ctx.getWs();
                if (busy || !ended || mainButton.hidden || !socket || socket.readyState !== 1) return;
                busy = true; source = null; refresh();
                socket.send(JSON.stringify({ type: 'setMainRecordVariation', nodeId, recordTreeVersion: version }));
            };
            sideButton.hidden = !node || node.key !== 'main';
            sideButton.disabled = busy || !ended;
            sideButton.onclick = () => {
                closeMenu();
                const socket = ctx.getWs();
                if (busy || !ended || sideButton.hidden || !socket || socket.readyState !== 1) return;
                busy = true; source = null; refresh();
                socket.send(JSON.stringify({ type: 'setSideRecordVariation', nodeId, recordTreeVersion: version }));
            };
            contextMenu.hidden = false;
            contextMenu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - contextMenu.offsetWidth)) + 'px';
            contextMenu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - contextMenu.offsetHeight)) + 'px';
            deleteButton.focus();
        }
        document.addEventListener('pointerdown', (event) => { if (!contextMenu.contains(event.target)) closeMenu(); });
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
        window.addEventListener('resize', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        const storageKey = 'qiRecordView_' + ctx.roomId + '_' + ctx.gameType;
        const stride = ctx.recordReplayStride || 1;
        const recordStep = () => Math.floor((Number(slider.value) || 0) / stride);
        const addButton = document.createElement('button');
        addButton.type = 'button'; addButton.className = 'ctrl-btn'; addButton.id = 'addRecordVariationBtn';
        addButton.textContent = '添加分支'; addButton.hidden = true;
        const passButton = document.createElement('button');
        passButton.type = 'button'; passButton.className = 'ctrl-btn'; passButton.id = 'recordVariationPassBtn';
        passButton.textContent = '分支虚着'; passButton.hidden = true;
        const panel = document.querySelector('.button-panel');
        if (panel) {
            const answerButton = window.__qiTsumego && document.getElementById('tsumegoCorrectBtn');
            if (answerButton) answerButton.before(addButton, passButton);
            else panel.append(addButton, passButton);
        }
        function syncButton() {
            if (window.__qiTsumego) ended = !!window.QiTsumego?.authoring;
            if (!ended) editing = false;
            addButton.hidden = !ended;
            addButton.disabled = busy || !!state.tryPlayMode;
            addButton.textContent = editing ? '结束添加' : '添加分支';
            passButton.hidden = !editing || !String(ctx.gameType || '').endsWith('weiqi');
            passButton.disabled = busy;
        }
        function beginEditing() {
            if (!ended || busy) return;
            const socket = ctx.getWs();
            if (!socket || socket.readyState !== 1) return;
            busy = true; syncButton();
            const step = recordStep();
            socket.send(JSON.stringify({ type: 'beginRecordVariations', step,
                nodeId: tree ? step === 0 ? 0 : path[step - 1] : undefined }));
        }
        addButton.onclick = () => {
            if (editing) { editing = false; source = null; pendingPoint = null; syncButton(); refresh(); return; }
            beginEditing();
        };
        function addMove(move) {
            if (!tree || busy || !editing) return;
            const step = recordStep();
            const parentId = step === 0 ? 0 : path[step - 1];
            busy = true; source = null; syncButton(); refresh();
            ctx.getWs().send(JSON.stringify({ type: 'addRecordVariation', parentId, move, recordTreeVersion: version }));
        }
        passButton.onclick = () => addMove({ type: 'pass' });
        function placeAt(clientX, clientY) {
            const point = pick(clientX, clientY);
            if (!point) return;
            if (ctx.recordMoveKind === 'travel') {
                if (!source) { source = point; syncButton(); return; }
                if (source.row === point.row && source.col === point.col) { source = null; syncButton(); return; }
                addMove({ type: 'move', fromRow: source.row, fromCol: source.col, toRow: point.row, toCol: point.col, promotion: 'q' });
            } else addMove(ctx.recordMoveFromPoint ? ctx.recordMoveFromPoint(point)
                : point.ix !== undefined ? { type: 'move', ix: point.ix, iy: point.iy }
                    : { type: 'move', row: point.row, col: point.col });
        }
        canvas.addEventListener('click', (event) => {
            if (state.tryPlayMode || editingOpening() || (!(editing && active) && !authoringAnswer())) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (busy) return;
            if (!editing || !active) {
                // 空题目还没有回放棋树；先初始化，再提交触发编辑的这一点击。
                pendingPoint = { x: event.clientX, y: event.clientY };
                beginEditing(); return;
            }
            placeAt(event.clientX, event.clientY);
        }, true);
        canvas.addEventListener('mousemove', (event) => {
            if (state.tryPlayMode || editingOpening() || (!(editing && active) && !authoringAnswer())) return;
            // 原有对局 hover 按真实对局的行棋方判断；编辑时由当前回放节点决定。
            event.stopImmediatePropagation();
            hoverPosition = { x: event.clientX, y: event.clientY };
            updateHover();
        }, true);
        canvas.addEventListener('mouseleave', () => { hoverPosition = null; hoverPreview.hidden = true; });
        function pick(clientX, clientY) {
            const direct = ctx.recordPointFromClient || state.recordPointFromClient;
            if (direct) return direct(clientX, clientY);
            const board = ctx.getBoard();
            if (!Array.isArray(board)) return null;
            const rect = canvas.getBoundingClientRect();
            let nearest = null, distance = Infinity;
            for (let row = 0; row < board.length; row++) {
                if (!Array.isArray(board[row])) continue;
                for (let col = 0; col < board[row].length; col++) {
                    const p = pointFor({ move: { row, col } });
                    if (!p) continue;
                    const size = p.size || 600;
                    const x = rect.left + p.x / size * rect.width, y = rect.top + p.y / size * rect.height;
                    const d = Math.hypot(x - clientX, y - clientY);
                    if (d < distance && d <= (p.cell || 30) * .55 / size * rect.width) {
                        distance = d; nearest = { row, col };
                    }
                }
            }
            return nearest;
        }

        function choose(id) {
            const socket = ctx.getWs();
            if (busy || !socket || socket.readyState !== 1) return;
            busy = true;
            source = null;
            signature = '';
            socket.send(JSON.stringify({ type: 'selectRecordVariation', nodeId: id, recordTreeVersion: version }));
        }
        function pointFor(node) {
            const point = movePoint(node.move);
            if (!point) return null;
            const project = ctx.recordPointToCanvas || state.recordPointToCanvas;
            if (typeof project === 'function') return project(point.row, point.col);
            if (!Number.isFinite(state.CELL_SIZE) || !Number.isFinite(state.PADDING)) return null;
            return { x: state.PADDING + point.col * state.CELL_SIZE,
                y: state.PADDING + (ctx.getBoardSize() - 1 - point.row) * state.CELL_SIZE,
                cell: state.CELL_SIZE, size: 600 };
        }
        const colors = { B: '#222', W: '#fff', R: '#932c13', L: '#176eaa', G: '#287a3d', Y: '#d5a016' };
        const colorsByName = { black: colors.B, white: colors.W, red: colors.R, blue: colors.L, green: colors.G, yellow: colors.Y };
        const firstStoneColor = () => colorsByName[window.QiTsumego.getFirstPlayer()];
        function slotColor(slot) {
            const ui = ctx.slotUi && ctx.slotUi[slot];
            const name = state.sideLabels && state.sideLabels[slot] || ui && (ui.name || ui.statusText) || '';
            const named = [['红', 'R'], ['蓝', 'L'], ['绿', 'G'], ['黄', 'Y'], ['白', 'W'], ['黑', 'B']];
            const found = named.find(([label]) => name.includes(label));
            return colors[found ? found[1] : slot === 'player2' ? 'W' : 'B'];
        }
        function moveColor(move) {
            if (window.__qiTsumego && ctx.gameType === 'sync-weiqi') return firstStoneColor();
            if (typeof move === 'string') return colors[move[0].toUpperCase()] || null;
            if (!move) return null;
            if (typeof move.color === 'number') return colors[['', 'B', 'W', 'R', 'L'][move.color]] || null;
            const side = move.side || move.color || move.player;
            return colorsByName[side] || (side === 'player1' || side === 1 ? slotColor('player1')
                : side === 'player2' || side === 2 ? slotColor('player2') : null);
        }
        function nextColor() {
            if (window.__qiTsumego && ctx.gameType === 'sync-weiqi') return firstStoneColor();
            const step = recordStep();
            const parent = tree && tree.nodes[step === 0 ? 0 : path[step - 1]];
            if (parent && parent.children.length) return moveColor(tree.nodes[parent.children[0]].move) || slotColor('player1');
            if (parent && parent.move) {
                const previous = moveColor(parent.move);
                if (ctx.gameType === 'duo-quadricolour-weiqi') {
                    const cycle = [colors.B, colors.W, colors.R, colors.L];
                    return cycle[(cycle.indexOf(previous) + 1) % 4];
                }
                return previous === slotColor('player1') ? slotColor('player2') : slotColor('player1');
            }
            return window.__qiTsumego ? firstStoneColor() : slotColor('player1');
        }
        function isPlayerBranch(color) {
            if (!window.__qiTsumego || !window.QiTsumego?.authoring) return false;
            // 同步／猜子棋的一条棋谱节点记录整轮，标记投影到玩家本轮的作答点。
            if (ctx.gameType === 'sync-weiqi' || ctx.gameType === 'guess-wuziqi') return true;
            const room = window.QiTsumego.getRoom();
            const slot = window.QiTsumego.getPlayerSlot();
            return Object.entries(room?.colorSlots || {}).some(([name, side]) => side === slot && colorsByName[name] === color);
        }
        function updateHover() {
            hoverPreview.hidden = true;
            if (!hoverPosition || busy || editingOpening() || state.tryPlayMode || !contextMenu.hidden
                || (!(editing && ctx.getReplayMode()) && !authoringAnswer())) return;
            const point = pick(hoverPosition.x, hoverPosition.y);
            if (!point) return;
            const board = ctx.getBoard();
            // 普通落子盘不在已有棋子上显示预览；走子盘选定起点后显示目标预览。
            if (ctx.recordMoveKind === 'travel') { if (!source) return; }
            else if (point.ix === undefined && board && board[point.row] && board[point.row][point.col]) return;
            if ((String(ctx.gameType).startsWith('choice-') || ctx.gameType === 'greedy-weiqi' && (state.candidates || []).length > 0)
                && (!Array.isArray(state.candidates) || !state.candidates.some((c) => c.row === point.row && c.col === point.col))) return;
            const projected = pointFor({ move: point });
            if (!projected) return;
            const rect = canvas.getBoundingClientRect(), size = projected.size || 600;
            hoverPreview.style.left = rect.left + projected.x / size * rect.width + 'px';
            hoverPreview.style.top = rect.top + projected.y / size * rect.height + 'px';
            hoverPreview.style.width = hoverPreview.style.height = (projected.cell || 30) * .88 / size * rect.width + 'px';
            hoverPreview.style.backgroundColor = nextColor();
            hoverPreview.hidden = false;
        }
        function label(node, index) {
            const point = movePoint(node.move);
            return (node.key === 'main' ? '主线' : '支线 ' + (index + 1)) + (point ? `（${point.row},${point.col}）` : '（虚着／特殊着法）');
        }
        function update() {
            frame = 0;
            syncButton();
            updateHover();
            if (!active || !tree) { frame = requestAnimationFrame(update); return; }
            const step = recordStep();
            const parent = tree.nodes[step === 0 ? 0 : path[step - 1]];
            const children = ctx.getReplayMode() && !state.tryPlayMode && !editingOpening() && parent && parent.children.length > 0
                ? parent.children.map((id) => tree.nodes[id]) : [];
            const rect = canvas.getBoundingClientRect();
            const points = children.map(pointFor);
            const next = JSON.stringify([parent && parent.id, children.map((n) => n.id), points,
                rect.left, rect.top, rect.width, rect.height, busy, path[step], document.hidden]);
            if (next !== signature) {
                signature = next;
                sessionStorage.setItem(storageKey, JSON.stringify({ version, nodeId: path[path.length - 1] || 0, step }));
                pointsLayer.replaceChildren();
                children.forEach((node, index) => {
                    const text = label(node, index);
                    const point = points[index];
                    if (!point || document.hidden) return;
                    const size = point.size || 600;
                    const x = rect.left + point.x / size * rect.width;
                    const y = rect.top + point.y / size * rect.height;
                    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
                    const ring = document.createElement('button');
                    ring.type = 'button';
                    ring.className = 'record-variation-point';
                    ring.dataset.nodeId = node.id;
                    ring.dataset.row = movePoint(node.move).row;
                    ring.dataset.col = movePoint(node.move).col;
                    ring.setAttribute('aria-label', text);
                    ring.title = text;
                    ring.disabled = busy;
                    ring.classList.toggle('is-main', node.key === 'main');
                    const color = moveColor(node.move) || nextColor();
                    ring.style.setProperty('--record-stone-color', color);
                    if (isPlayerBranch(color)) {
                        const correct = successfulNodes.has(node.id);
                        ring.dataset.outcome = correct ? 'success' : 'failure';
                        ring.style.borderColor = correct ? '#287a3d' : '#c62828';
                    } else if (node.key === 'main') ring.style.borderColor = color;
                    ring.style.left = x + 'px';
                    ring.style.top = y + 'px';
                    ring.style.width = ring.style.height = Math.max(10, (point.cell || 30) * .76 / size * rect.width) + 'px';
                    ring.onclick = (event) => { event.stopPropagation(); source = null; choose(node.id); };
                    ring.oncontextmenu = (event) => showMenu(event, node.id);
                    ring.onmouseenter = () => { hoverPosition = null; hoverPreview.hidden = true; };
                    pointsLayer.appendChild(ring);
                });
            }
            frame = requestAnimationFrame(update);
        }
        function refresh() { signature = ''; syncButton(); if (!frame) frame = requestAnimationFrame(update); }
        function clear() {
            active = false; tree = null; path = []; busy = false; editing = false; source = null;
            successfulNodes.clear();
            pendingPoint = null;
            cancelAnimationFrame(frame); frame = 0;
            pointsLayer.replaceChildren(); hoverPosition = null; hoverPreview.hidden = true; closeMenu(); refresh();
        }
        function handle(message) {
            const live = message.type === 'joined' ? message.state : message;
            if (!['recordTreeUpdated', 'recordVariation'].includes(message.type)) {
                if (live && live.gameOver !== undefined) ended = !!live.gameOver;
            }
            if (message.recordEnded !== undefined) ended = !!message.recordEnded;
            if (message.type === 'importSuccess' || message.type === 'recordTree') {
                const pending = message.recordEditing ? pendingPoint : null;
                const saved = message.type === 'recordTree' && !message.recordEditing && message.recordRestore !== false
                    ? JSON.parse(sessionStorage.getItem(storageKey) || 'null') : null;
                clear();
                if (!message.recordTree) return;
                tree = window.QiRecordTree.parse(message.recordTree, { terminals: !!window.__qiTsumego });
                if (message.recordNodes) { tree.nodes = message.recordNodes; tree.root = tree.nodes[0]; }
                refreshOutcomes();
                path = message.recordPath || window.QiRecordTree.path(tree).ids;
                version = message.recordTreeVersion;
                active = true;
                state.seatOverlayForceHide = true;
                if (message.type === 'recordTree') {
                    ctx.enterReplayMode(message.replayData);
                    if (message.recordStep !== undefined) ctx.setReplayStep(message.recordStep * stride);
                    editing = !!message.recordEditing;
                    if (saved && saved.version === version && tree.nodes[saved.nodeId]) {
                        busy = true;
                        ctx.getWs().send(JSON.stringify({ type: 'selectRecordVariation', nodeId: saved.nodeId,
                            step: saved.step, recordTreeVersion: version }));
                    }
                }
                if (message.type === 'importSuccess' && ctx.seatOverlayOnly) queueMicrotask(() => {
                    ctx.enterReplayMode(message.replayData);
                    ctx.setReplayStep(path.length * stride);
                    refresh();
                });
                refresh();
                if (pending && editing && authoringAnswer()) placeAt(pending.x, pending.y);
            } else if (message.type === 'recordTreeUpdated') {
                const step = recordStep();
                if (!active) {
                    path = message.recordPath;
                    ctx.enterReplayMode(message.replayData);
                    ctx.setReplayStep(step * stride);
                }
                tree = { nodes: message.recordNodes, root: message.recordNodes[0], hasBranches: true };
                refreshOutcomes();
                version = message.recordTreeVersion;
                active = true;
                if (message.recordMainChanged !== undefined) {
                    closeMenu(); source = null;
                    const nodeId = step === 0 ? 0 : path[step - 1];
                    busy = true;
                    ctx.getWs().send(JSON.stringify({ type: 'selectRecordVariation', nodeId,
                        step, recordTreeVersion: version }));
                }
                if (message.recordDeleted) {
                    busy = false; source = null; closeMenu();
                    const missing = path.findIndex((id) => !tree.nodes[id]);
                    if (missing !== -1) {
                        const nodeId = missing === 0 ? 0 : path[missing - 1];
                        path = window.QiRecordTree.path(tree, nodeId).ids;
                        busy = true;
                        ctx.getWs().send(JSON.stringify({ type: 'selectRecordVariation', nodeId,
                            step: Math.min(step, missing), recordTreeVersion: version }));
                    }
                }
                refresh();
            } else if (message.type === 'recordVariation' && message.recordTreeVersion === version) {
                busy = false;
                path = message.recordPath;
                if (state.tryPlayMode) ctx.exitTryPlay();
                ctx.enterReplayMode(message.replayData);
                ctx.setReplayStep(message.recordStep * stride);
                if (message.recordEditing) editing = true;
                refresh();
            } else if (message.type === 'error' || message.type === 'recordVariationIgnored') {
                pendingPoint = null;
                busy = false;
                refresh();
            } else if (['roomReset', 'newGameStarted', 'boardSizeChanged', 'subGameChanged', 'recordTreeCleared'].includes(message.type)) {
                sessionStorage.removeItem(storageKey); clear();
            }
        }
        refresh();
        return { handle };
    }
    window.QiRoomRecordTree = { create };
})();
