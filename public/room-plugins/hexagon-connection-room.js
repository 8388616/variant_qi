// Hexagon connection rules are shared verbatim with games/hexagonConnection.js.
const hexagonConnectionRules = (() => {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1]];
    const empty = n => Array.from({ length: n }, () => Array(n).fill(0));
    const copy = board => board.map(row => row.slice());
    const valid = (n, r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < n && c < n;
    function place(board, row, col, color) {
        if ((color !== 1 && color !== 2) || !valid(board.length, row, col) || board[row][col] !== 0) return null;
        const next = copy(board);
        next[row][col] = color;
        return next;
    }
    function winningPath(board, color) {
        if ((color !== 1 && color !== 2) || !board.length) return [];
        const n = board.length, queue = [], parents = new Int32Array(n * n).fill(-2);
        for (let i = 0; i < n; i++) {
            const r = color === 1 ? 0 : i, c = color === 1 ? i : 0;
            if (board[r][c] === color) { const id = r * n + c; parents[id] = -1; queue.push(id); }
        }
        for (let index = 0; index < queue.length; index++) {
            const id = queue[index], r = Math.floor(id / n), c = id % n;
            if (color === 1 ? r === n - 1 : c === n - 1) {
                const path = [];
                for (let p = id; p >= 0; p = parents[p]) path.push([Math.floor(p / n), p % n]);
                return path.reverse();
            }
            for (const [dr, dc] of directions) {
                const nr = r + dr, nc = c + dc, next = nr * n + nc;
                if (valid(n, nr, nc) && parents[next] === -2 && board[nr][nc] === color) {
                    parents[next] = id; queue.push(next);
                }
            }
        }
        return [];
    }
    return { directions, empty, copy, valid, place, winningPath };
})();

const hexBoardGeometry = (() => {
    const root = Math.sqrt(3) / 2;
    function build(n) {
        const outset = 1.3 + Math.max(0, n - 11) * 0.06;
        const cell = 568 / (2 * root * (n - 1) + 4 * outset);
        const offsetX = 16 + 2 * outset * cell;
        const point = (r, c) => ({ x: offsetX + root * (r + c) * cell, y: 300 + (r - c) * cell * 0.5 });
        const radius = cell / Math.sqrt(3);
        const frame = [
            { x: 16, y: 300 },
            { x: 300, y: 300 - ((n - 1) * 0.5 + outset / root) * cell },
            { x: 584, y: 300 },
            { x: 300, y: 300 + ((n - 1) * 0.5 + outset / root) * cell }
        ];
        const polygons = [], edges = [], seen = new Set();
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            const p = point(r, c), vertices = [];
            for (let k = 0; k < 6; k++) vertices.push({ x: p.x + radius * Math.cos(k * Math.PI / 3), y: p.y + radius * Math.sin(k * Math.PI / 3) });
            polygons.push(vertices);
            for (let k = 0; k < 6; k++) {
                const a = vertices[k], b = vertices[(k + 1) % 6];
                const key = [a, b].map(q => Math.round(q.x * 10000) + ',' + Math.round(q.y * 10000)).sort().join(':');
                if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
            }
        }
        // Four continuous paths made only of exposed hex edges. The top and
        // bottom corner edges are split at their midpoint between both colors.
        const vertex = (r, c, k) => polygons[r * n + c][k];
        const midpoint = (a, b) => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
        const top = midpoint(vertex(0, n - 1, 4), vertex(0, n - 1, 5));
        const bottom = midpoint(vertex(n - 1, 0, 1), vertex(n - 1, 0, 2));
        const northwest = [vertex(0, 0, 3)], northeast = [top];
        const southeast = [vertex(n - 1, n - 1, 0)], southwest = [bottom];
        for (let c = 0; c < n; c++) northwest.push(vertex(0, c, 4), c === n - 1 ? top : vertex(0, c, 5));
        for (let r = 0; r < n; r++) northeast.push(vertex(r, n - 1, 5), vertex(r, n - 1, 0));
        for (let c = n - 1; c >= 0; c--) southeast.push(vertex(n - 1, c, 1), c === 0 ? bottom : vertex(n - 1, c, 2));
        for (let r = n - 1; r >= 0; r--) southwest.push(vertex(r, 0, 2), vertex(r, 0, 3));
        const boundaries = [{ color: 1, points: northwest }, { color: 2, points: northeast },
            { color: 1, points: southeast }, { color: 2, points: southwest }];
        function pick(x, y) {
            const u = (x - offsetX) / cell, v = (y - 300) / cell;
            const r0 = Math.round(u / (2 * root) + v), c0 = Math.round(u / (2 * root) - v);
            let best = Infinity, result = { row: -1, col: -1 };
            for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
                if (!hexagonConnectionRules.valid(n, r, c)) continue;
                const p = point(r, c), dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
                if (dx > radius + 1e-7 || dy > root * radius + 1e-7 || Math.sqrt(3) * dx + dy > Math.sqrt(3) * radius + 1e-7) continue;
                const distance = dx * dx + dy * dy;
                if (distance < best) { best = distance; result = { row: r, col: c }; }
            }
            return result;
        }
        const stoneRadius = cell * 0.35;
        // Midpoint of the gap from the facing hex edge to the wood frame,
        // measured along the same slanted line through the cell center.
        const labelOffset = cell * (outset * 0.5 + Math.sqrt(3) / 8);
        return { n, cell, radius, stoneRadius, labelOffset, outset, point, polygons, edges, boundaries, frame, pick };
    }
    function roundedFrame(ctx, vertices, radius) {
        QiSquareWeiqiCanvas.traceRoundedPolygon(ctx, vertices, radius);
    }
    return { build, roundedFrame };
})();

window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["hexagon-connection"] = {
    shell: {
        "title": "六贯棋",
        "rulesHtml": "双方轮流在格内落子，黑先白后。<br /><br />黑方连接左上与右下两边，白方连接左下与右上两边，先连通者获胜。<br /><br />棋子以共边相邻。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 3,
        "boardSizeMax": 21,
        "defaultBoardSize": 11,
        "minLib": 1,
        "recordDownloadPrefix": "六贯棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "woodTexture": true,
            "editBoard": true, "customTimeControl": true
        },
        "editTools": [
            { "value": "empty", "label": "空" },
            { "value": "black", "label": "黑子" },
            { "value": "white", "label": "白子" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "六贯棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const ps = {
            BOARD_SIZE: 11,
            KOMI: 0,
            PADDING: 0,
            CELL_SIZE: 0,
            numberOfHands: 1,
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            winner: null,
            lastMoveMarkers: [],
            showEstimateActive: false,
            cachedLiveBoard: null,
            cachedTerritory: null,
            waitingScoreConfirm: false,
            iRejected: false,
            ws: null,
            isMyTurn: false,
            slots: { player1: false, player2: false },
            reconnectTimer: null,
            replayMode: false,
            replayBoards: [],
            replayMarkers: [],
            replayStepPlayers: [],
            replayStep: 0,
            replayTotalSteps: 0,
            showMoveNumbers: false,
            moveLog: [],
            tryPlayMode: false,
            tryPlayBaseStep: 0,
            tryPlayBoards: [],
            tryPlayMarkers: [],
            tryPlayCurrentPlayer: 1,
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            liveReplayBoards: [],
            liveReplayMarkers: [],
            liveReplayStepPlayers: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            userBoardMarks: Object.create(null),
            hoverRow: -1,
            hoverCol: -1,
            isHoverValid: false
        };
        (function initSquareGeometry() {
            const g = QiSquareWeiqiCanvas.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        const komiInfo = document.getElementById('komiInfo');
        const canvas = document.getElementById('goBoard');
        const ctx = canvas.getContext('2d');
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        document.body.classList.add('qi-room-transparent-canvas', 'qi-hexagon-connection-room');
        const style = document.createElement('style');
        style.textContent = 'body.qi-hexagon-connection-room #passBtn,body.qi-hexagon-connection-room #endReqBtn,body.qi-hexagon-connection-room #estimateBtn{display:none!important}';
        document.head.appendChild(style);
        canvas.style.backgroundImage = '';
        let layout = null;
        function ensureLayout() {
            if (!layout || layout.n !== ps.BOARD_SIZE) layout = hexBoardGeometry.build(ps.BOARD_SIZE);
            ps.CELL_SIZE = layout.cell;
            ps.PADDING = 0;
            return layout;
        }
        function pickCell(x, y) { return ensureLayout().pick(x, y); }
        function drawStone(x, y, color, alpha = 1) {
            const g = ensureLayout(), radius = g.stoneRadius;
            const scale = radius / (g.cell * 0.44), gloss = 3 * scale;
            ctx.save(); ctx.globalAlpha = alpha;
            ctx.shadowBlur = 6 * scale; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowOffsetY = 2 * scale;
            const gradient = ctx.createRadialGradient(x - gloss, y - gloss, radius * 0.2, x, y, radius * 1.2);
            const stops = color === 1 ? [[0, '#444'], [0.6, '#222'], [1, '#111']] : [[0, '#fff'], [0.5, '#eee'], [1, '#aaa']];
            for (const [offset, color] of stops) gradient.addColorStop(offset, color);
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = gradient; ctx.fill();
            ctx.restore();
        }
        function paintBoard() {
            const g = ensureLayout(), n = g.n, stoneRadius = g.stoneRadius;
            ctx.clearRect(0, 0, 600, 600);
            ctx.save(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.fillStyle = QiSquareWeiqiCanvas.getWoodFill(ctx, canvas) || '#fdcc90';
            ctx.strokeStyle = '#3a281c'; ctx.lineWidth = 0.5;
            hexBoardGeometry.roundedFrame(ctx, g.frame, 4); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#3a281c'; ctx.lineWidth = 1;
            ctx.beginPath();
            for (const [a, b] of g.edges) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
            ctx.stroke();
            ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
            for (const boundary of g.boundaries) {
                ctx.beginPath(); ctx.moveTo(boundary.points[0].x, boundary.points[0].y);
                for (let i = 1; i < boundary.points.length; i++) ctx.lineTo(boundary.points[i].x, boundary.points[i].y);
                ctx.strokeStyle = boundary.color === 1 ? '#222' : '#fafafa';
                ctx.lineWidth = Math.max(2.5, g.cell * 0.10); ctx.stroke();
            }
            ctx.font = 'bold ' + Math.max(9, g.cell * 0.37) + 'px Arial';
            ctx.fillStyle = '#3a281c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (let i = 0; i < n; i++) {
                const p = g.point(0, i), q = g.point(i, n - 1), offset = g.labelOffset;
                // Keep alignment with the hex centers, centered in the wood margin.
                ctx.fillText(String(i + 1), p.x - offset, p.y - offset / Math.sqrt(3));
                ctx.fillText(String.fromCharCode(65 + i), q.x + offset, q.y - offset / Math.sqrt(3));
            }
            function drawLastMoveMarkers(lower) {
                for (const m of ps.lastMoveMarkers || []) {
                    if (!hexagonConnectionRules.valid(n, m.row, m.col)) continue;
                    const p = g.point(m.row, m.col), len = stoneRadius * 0.8;
                    ctx.beginPath();
                    if (lower) {
                        // Same lower-right marker as ordinary Go: paint below
                        // the stone so move numbers stay clear.
                        ctx.moveTo(p.x + stoneRadius, p.y + stoneRadius);
                        ctx.lineTo(p.x, p.y + stoneRadius); ctx.lineTo(p.x + stoneRadius, p.y);
                    } else {
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p.x + len, p.y); ctx.lineTo(p.x, p.y + len);
                    }
                    ctx.closePath(); ctx.fillStyle = m.color === 1 ? '#fff' : '#222'; ctx.fill();
                }
            }
            if (ps.showMoveNumbers) drawLastMoveMarkers(true);
            const numbers = page && ps.showMoveNumbers ? page.computeStoneNumbers() : null;
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                const color = ps.board[r] && ps.board[r][c];
                if (color !== 1 && color !== 2) continue;
                const p = g.point(r, c); drawStone(p.x, p.y, color);
                if (numbers && numbers[r] && numbers[r][c]) {
                    ctx.fillStyle = color === 1 ? '#fff' : '#222';
                    ctx.font = 'bold ' + Math.max(5, stoneRadius * 0.86) + 'px Arial';
                    ctx.fillText(String(numbers[r][c]), p.x, p.y, stoneRadius * 1.7);
                }
            }
            if (!ps.showMoveNumbers) drawLastMoveMarkers(false);
            for (const [marks, stoneLayer] of [[ps.userBoardMarks, false], [ps.userStoneMarks, true]]) {
                if (stoneLayer && !QiSquareWeiqiCanvas.boardMarksLiveLatest(ps)) continue;
                for (const key of Object.keys(marks || {})) {
                    const [r, c] = key.split(',').map(Number);
                    if (!hexagonConnectionRules.valid(n, r, c) || !!ps.board[r][c] !== stoneLayer) continue;
                    const p = g.point(r, c);
                    QiSquareWeiqiCanvas.draw.boardMarkGlyph(ctx, p.x, p.y, stoneLayer ? stoneRadius / 0.44 : g.cell, marks[key],
                        stoneLayer ? ps.board[r][c] === 1 ? 'light' : 'dark' : 'point');
                }
            }
            if (ps.isHoverValid && hexagonConnectionRules.valid(n, ps.hoverRow, ps.hoverCol) && ps.board[ps.hoverRow][ps.hoverCol] === 0
                && (ps.tryPlayMode ? !ps.tryPlayHexagonConnectionWinner : ps.editModeEnabled || !ps.gameOver && ps.isMyTurn)) {
                const color = ps.editModeEnabled ? ps.editTool === 'white' ? 2 : ps.editTool === 'black' ? 1 : 0
                    : ps.tryPlayMode ? ps.tryPlayCurrentPlayer : ps.mySlot === 'player1' ? 1 : 2;
                if (color) { const p = g.point(ps.hoverRow, ps.hoverCol); drawStone(p.x, p.y, color, 0.45); }
            }
            ctx.restore();
        }

        const domPage = {
            turnDisplay,
            scoreTitle,
            scoreBoard,
            leadInfo,
            scoreConfirmPanel: null,
            scoreConfirmText: null,
            komiInfo,
            canvas,
            ctx,
            boardMarkSelect,
            colorStatus
        };

        let page;
        page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true, recordDownloadPrefix, komiInfoText: '', gameType, roomId, roomPassword, isMouseDevice,
            replayGameButtonIds: ['undoBtn', 'resignBtn', 'drawBtn'],
            tryPlaceStone: (b, r, c, color) => hexagonConnectionRules.place(b, r, c, color),
            getClosestIntersection: pickCell,
            drawBoard: paintBoard,
            updateTryPlayDisplay() {
                const winner = hexagonConnectionRules.winningPath(ps.board, 1).length ? 1 : hexagonConnectionRules.winningPath(ps.board, 2).length ? 2 : 0;
                ps.tryPlayHexagonConnectionWinner = winner;
                document.getElementById('replayStepDisplay').innerText = '试下 ' + ps.tryPlayStep + ' / ' + ps.tryPlayTotalSteps;
                turnDisplay.innerText = winner ? (winner === 1 ? '黑方已连通两边' : '白方已连通两边')
                    : (ps.tryPlayCurrentPlayer === 1 ? '⚫ 试下' : '⚪ 试下');
            },
            onExitTryPlay() { ps.tryPlayHexagonConnectionWinner = 0; }
        });
        const originalTryMove = page.tryPlayMove;
        page.tryPlayMove = (r, c) => {
            if (!hexagonConnectionRules.valid(ps.BOARD_SIZE, r, c) || hexagonConnectionRules.winningPath(ps.board, 1).length
                || hexagonConnectionRules.winningPath(ps.board, 2).length) return false;
            return originalTryMove(r, c);
        };
        const originalEnterReplay = page.enterReplayMode;
        page.enterReplayMode = data => {
            const size = data.boardSize == null ? ps.BOARD_SIZE : Number(data.boardSize);
            if (!Number.isInteger(size) || size < 3 || size > 21 || !Array.isArray(data.moves)) return;
            const moves = data.moves.map(raw => {
                const match = typeof raw === 'string' && /^([BW])(\d+),(\d+)$/.exec(raw);
                const move = match ? { row: Number(match[2]), col: Number(match[3]), player: match[1] === 'B' ? 'player1' : 'player2' } : raw;
                return move && (!move.type || move.type === 'move') && hexagonConnectionRules.valid(size, move.row, move.col)
                    ? { ...move, type: 'move' } : null;
            });
            if (moves.some((move, i) => !move || move.player !== (i % 2 ? 'player2' : 'player1'))) return;
            if (size !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = size; ps.board = hexagonConnectionRules.empty(size);
                ps.liveOpeningBoard = null;
                page.updateBoardGeometry();
                const select = document.getElementById('boardSizeSelect');
                if (select) select.value = String(size);
            }
            originalEnterReplay({ ...data, moves });
        };
        ps.recordPointToCanvas = (row, col) => ({ ...ensureLayout().point(row, col), cell: layout.cell, size: 600 });

        const _sync0 = page.syncState;
        page.syncState = function (state) {
            if (!state.moveCoords && state.moveHistory) {
                state.moveCoords = state.moveHistory.map(m =>
                    (m.type === 'pass')
                        ? { type: 'pass', player: m.player }
                        : { type: 'move', player: m.player, row: m.row, col: m.col }
                );
            }
            _sync0(state);
        };

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard,
            updateTurn,
            downloadRecord,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            updateReplayUI,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState,
            commitMove,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            roomId,
            gameType,
            seatOverlayShape: 'rhombus',
            getSeatOverlayVertices: () => ensureLayout().frame,
            seatOverlayCornerRadius: 4,
            pageState: ps,
            drawBoard,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ps.ws,
            getBoardSize: () => ps.BOARD_SIZE,
            setBoardSize: (n) => { ps.BOARD_SIZE = n; },
            getKomi: () => ps.KOMI,
            setKomi: (n) => { ps.KOMI = n; },
            getBoard: () => ps.board,
            setBoard: (b) => { ps.board = b; },
            getSlots: () => ps.slots,
            setSlots: (s) => { ps.slots = s; },
            getMySlot: () => ps.mySlot,
            setMySlot: (s) => { ps.mySlot = s; },
            getGameOver: () => ps.gameOver,
            setGameOver: (v) => { ps.gameOver = v; },
            getWinner: () => ps.winner,
            setWinner: (w) => { ps.winner = w; },
            getReplayMode: () => ps.replayMode,
            getShowEstimateActive: () => ps.showEstimateActive,
            setShowEstimateActive: (v) => { ps.showEstimateActive = v; },
            getWaitingScoreConfirm: () => ps.waitingScoreConfirm,
            setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
            getIRejected: () => ps.iRejected,
            setIRejected: (v) => { ps.iRejected = v; },
            colorStatus,
            scoreTitle,
            turnDisplay,
syncState: page.syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm: () => {},
            isMouseDevice
        });
        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = pickCell(x, y);
            applyUserBoardMark(row, col);
        });

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            longMarkStart = { x: t.clientX, y: t.clientY };
            longMarkTimer = setTimeout(() => {
                longMarkTimer = null;
                if (!longMarkStart) return;
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                const { row, col } = pickCell(x, y);
                applyUserBoardMark(row, col);
                suppressCanvasClickAfterLongMark = true;
                setTimeout(() => { suppressCanvasClickAfterLongMark = false; }, 450);
                longMarkStart = null;
            }, LONG_MARK_MS);
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - longMarkStart.x;
            const dy = t.clientY - longMarkStart.y;
            if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
        }, { passive: true });

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = pickCell(x, y);
            const m2 = mobileTwoStepPlacing();
            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (m2) { clearMobileMovePreview(); drawBoard(); }
                    return;
                }
                if (ps.board[row][col] !== 0) return;
                if (m2) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        drawBoard();
                    }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            const ltLive = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            if (!ps.replayMode && ps.liveReplayBoards.length && ps.liveViewStep < ltLive) return;
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (row < 0 || col < 0) {
                if (m2) { clearMobileMovePreview(); drawBoard(); }
                return;
            }
            if (ps.board[row][col] !== 0) return;
            if (m2) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoard();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoard();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = pickCell(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                ps.isHoverValid = false;
                ps.hoverRow = -1; ps.hoverCol = -1;
                drawBoard();
            });
        }
        connectWebSocket(handleMessage);
        })();
    }
};
