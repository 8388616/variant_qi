window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["continuous-weiqi"] = {
    shell: {
        "title": "连续围棋",
        "rulesHtml": "棋盘为边长 <i>L</i> 的正方形连续平面 [0, L] × [0, L]。棋子为直径 1 的圆盘，黑先白后轮流落子，圆心可在盘面任意一点。<br /><br />\n<strong>落子限制：</strong>新子圆心与任意已有棋子圆心距离须 ≥ 1/2。允许圆盘重叠，但圆心不能过近。<br /><br />\n<strong>接触与棋块：</strong>两子圆心距 ≤ 1 即视为接触，同色接触链组成棋块。<br /><br />\n<strong>气：</strong>单颗棋子初始气为 4；每接触一颗其他棋子或棋盘边界，气数 −1。棋块总气为成员气数之和。<br /><br />\n<strong>提子：</strong>落子后先提对方无气棋块，再禁自杀；全局同形（接触图同构）禁止。<br /><br />\n<strong>终局与计分：</strong>双方连续虚着终局。按棋子覆盖面积与空地归属（距圆盘边缘最近者）计分，白方加贴目 Komi。<br /><br />\n观战模式下可开启「编辑」摆放初始棋子。",
        "defaultKomiText": "黑贴白7.5点",
        "boardSizeMin": 9,
        "boardSizeMax": 25,
        "defaultBoardSize": 18,
        "minLib": 1,
        "recordDownloadPrefix": "连续围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "continuousExtras": true
        },
        "editTools": [
            {
                "value": "empty",
                "label": "空"
            },
            {
                "value": "black",
                "label": "黑子"
            },
            {
                "value": "white",
                "label": "白子"
            }
        ],
        "boardSizeValues": [
            9,
            13,
            15,
            18,
            19,
            21,
            25
        ],
        "sizeSelectId": "boardLengthSelect",
        "sizeLabel": "L=",
        "sizeLabelIsPrefix": true
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "连续围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
            var sel = document.getElementById('boardSizeSelect');
            if (sel && !document.getElementById("boardLengthSelect")) {
                sel.id = "boardLengthSelect";
            }
        })();

        (function () {
(function () {
    const COORD_SCALE = 1000000;
    const BOARD_SIZE_PX = 600;
    const PIECE_RADIUS = 0.5;
    const MIN_DISTANCE = 0.5;
    const TOUCH_DISTANCE = 1.0;
    const EPS = 1e-9;
    const SCORE_GRID = 80;
    const KOMI = 7.5;

    let boardLength = 18;
    let scale = BOARD_SIZE_PX / boardLength;
    let piecePx = Math.round(scale);

    function ixToX(ix) { return (ix / COORD_SCALE) * boardLength; }
    function iyToY(iy) { return (iy / COORD_SCALE) * boardLength; }
    function toIx(x) { return Math.round((x / boardLength) * COORD_SCALE); }
    function toIy(y) { return Math.round((y / boardLength) * COORD_SCALE); }
    function pxToGame(px, py) { return [px / scale, py / scale]; }
    function gameToPx(x, y) { return [x * scale, y * scale]; }
    function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    function deepCopyStones(src) { return src.map(s => ({ ix: s.ix, iy: s.iy, color: s.color })); }
    function stonesEqual(a, b) { return a.ix === b.ix && a.iy === b.iy && a.color === b.color; }

    let _uid = 0;
    function makeBoardFromStones(stoneList) {
        const pieces = stoneList.map(s => ({ ...s, _uid: ++_uid }));
        return {
            boardLength,
            pieces,
            stateHistory: [],
            graphHistory: [],
            _neighborCache: null,
            _scoreCache: null
        };
    }

    function invalidateBoard(b) { b._neighborCache = null; b._scoreCache = null; }
    function xyOf(b, p) { return { x: ixToX(p.ix, b.boardLength || boardLength), y: iyToY(p.iy, b.boardLength || boardLength) }; }

    function buildNeighborCache(b) {
        if (b._neighborCache) return b._neighborCache;
        const cache = new Map();
        for (const p of b.pieces) cache.set(p._uid, []);
        for (let i = 0; i < b.pieces.length; i++) {
            const pi = b.pieces[i];
            const pxy = xyOf(b, pi);
            for (let j = i + 1; j < b.pieces.length; j++) {
                const pj = b.pieces[j];
                const pjy = xyOf(b, pj);
                if (dist(pxy.x, pxy.y, pjy.x, pjy.y) <= TOUCH_DISTANCE + EPS) {
                    cache.get(pi._uid).push(pj);
                    cache.get(pj._uid).push(pi);
                }
            }
        }
        b._neighborCache = cache;
        return cache;
    }

    function neighbors(b, p) { return buildNeighborCache(b).get(p._uid); }
    function boundaryContacts(x, y) {
        let n = 0;
        if (x - PIECE_RADIUS <= EPS) n++;
        if (x + PIECE_RADIUS >= boardLength - EPS) n++;
        if (y - PIECE_RADIUS <= EPS) n++;
        if (y + PIECE_RADIUS >= boardLength - EPS) n++;
        return n;
    }
    function pieceLiberty(b, p) {
        const { x, y } = xyOf(b, p);
        return 4 - boundaryContacts(x, y) - neighbors(b, p).length;
    }
    function groupOf(b, p) {
        const seen = new Set([p._uid]);
        const out = [p];
        const stack = [p];
        const cache = buildNeighborCache(b);
        while (stack.length) {
            const cur = stack.pop();
            for (const nb of cache.get(cur._uid)) {
                if (nb.color === p.color && !seen.has(nb._uid)) {
                    seen.add(nb._uid);
                    out.push(nb);
                    stack.push(nb);
                }
            }
        }
        return out;
    }
    function groupLiberty(b, grp) { let s = 0; for (const p of grp) s += pieceLiberty(b, p); return s; }

    function graphsIsomorphic(g1, g2) {
        const n = g1.colors.length;
        if (n !== g2.colors.length) return false;
        if (n === 0) return true;
        let e1 = 0, e2 = 0;
        for (let i = 0; i < n; i++) { e1 += g1.adj[i].length; e2 += g2.adj[i].length; }
        if (e1 !== e2) return false;
        const adjSet2 = g2.adj.map(a => new Set(a));
        const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => g1.adj[b].length - g1.adj[a].length);
        const mapping = new Array(n).fill(-1);
        const used = new Array(n).fill(false);
        function backtrack(k) {
            if (k === n) return true;
            const u = order[k];
            for (let v = 0; v < n; v++) {
                if (used[v] || g2.colors[v] !== g1.colors[u] || g2.adj[v].length !== g1.adj[u].length) continue;
                let ok = true;
                for (const u2 of g1.adj[u]) {
                    const v2 = mapping[u2];
                    if (v2 !== -1 && !adjSet2[v].has(v2)) { ok = false; break; }
                }
                if (!ok) continue;
                mapping[u] = v; used[v] = true;
                if (backtrack(k + 1)) return true;
                mapping[u] = -1; used[v] = false;
            }
            return false;
        }
        return backtrack(0);
    }

    function makeGraph(b) {
        const n = b.pieces.length;
        if (!n) return { colors: [], adj: [] };
        const cache = buildNeighborCache(b);
        const idx = new Map();
        b.pieces.forEach((p, i) => idx.set(p._uid, i));
        return {
            colors: b.pieces.map(p => p.color),
            adj: b.pieces.map(p => cache.get(p._uid).map(q => idx.get(q._uid)).sort((a, c) => a - c))
        };
    }

    function makeSignature(b) {
        if (!b.pieces.length) return 'empty';
        const cache = buildNeighborCache(b);
        let labels = new Map();
        for (const p of b.pieces) labels.set(p._uid, String(p.color));
        const iters = Math.min(b.pieces.length + 1, 12);
        for (let it = 0; it < iters; it++) {
            const newSig = new Map();
            for (const p of b.pieces) {
                const neighLbls = cache.get(p._uid).map(q => labels.get(q._uid)).sort();
                newSig.set(p._uid, labels.get(p._uid) + '|' + neighLbls.join(','));
            }
            const uniq = [...new Set(newSig.values())].sort();
            const mp = new Map();
            uniq.forEach((s, i) => mp.set(s, 'L' + i));
            labels = new Map();
            for (const [k, v] of newSig) labels.set(k, mp.get(v));
        }
        return [...labels.values()].sort().join(';');
    }

    function isKoRepeat(b, sig, graph) {
        for (let i = 0; i < b.stateHistory.length; i++) {
            if (b.stateHistory[i] !== sig) continue;
            if (graphsIsomorphic(graph, b.graphHistory[i])) return true;
        }
        return false;
    }

    function tryPlaceOnBoard(b, color, x, y) {
        for (const p of b.pieces) {
            if (p.color === color) {
                const { x: px, y: py } = xyOf(b, p);
                if (dist(x, y, px, py) < MIN_DISTANCE - EPS) return { ok: false, why: 'distance' };
            }
        }
        if (x < -EPS || x > boardLength + EPS || y < -EPS || y > boardLength + EPS) return { ok: false, why: 'distance' };
        const newPiece = { color, ix: toIx(x), iy: toIy(y), _uid: ++_uid };
        b.pieces.push(newPiece);
        invalidateBoard(b);
        const opp = color === 1 ? 2 : 1;
        const captured = [];
        const visited = new Set();
        for (const p of [...b.pieces]) {
            if (p.color !== opp || visited.has(p._uid)) continue;
            const grp = groupOf(b, p);
            for (const q of grp) visited.add(q._uid);
            if (groupLiberty(b, grp) <= 0) captured.push(...grp);
        }
        if (captured.length) {
            const capIds = new Set(captured.map(p => p._uid));
            b.pieces = b.pieces.filter(p => !capIds.has(p._uid));
            invalidateBoard(b);
        }
        for (const p of b.pieces) {
            if (p._uid === newPiece._uid || p.color !== opp) continue;
            const { x: px, y: py } = xyOf(b, p);
            if (dist(x, y, px, py) < MIN_DISTANCE - EPS) {
                b.pieces = b.pieces.filter(pp => pp._uid !== newPiece._uid);
                for (const cap of captured) b.pieces.push(cap);
                invalidateBoard(b);
                return { ok: false, why: 'distance' };
            }
        }
        const ownGrp = groupOf(b, newPiece);
        if (groupLiberty(b, ownGrp) <= 0) {
            b.pieces = b.pieces.filter(p => p._uid !== newPiece._uid);
            for (const p of captured) b.pieces.push(p);
            invalidateBoard(b);
            return { ok: false, why: 'suicide' };
        }
        const sig = makeSignature(b);
        const graph = makeGraph(b);
        if (isKoRepeat(b, sig, graph)) {
            b.pieces = b.pieces.filter(p => p._uid !== newPiece._uid);
            for (const p of captured) b.pieces.push(p);
            invalidateBoard(b);
            return { ok: false, why: 'ko' };
        }
        b.stateHistory.push(sig);
        b.graphHistory.push(graph);
        return { ok: true, newPiece };
    }

    function computeScoreFromStones(stoneList) {
        const b = makeBoardFromStones(stoneList);
        const L = boardLength;
        const cell = L / SCORE_GRID;
        const cellArea = cell * cell;
        let blackCells = 0, whiteCells = 0, blackTerr = 0, whiteTerr = 0;
        for (let i = 0; i < SCORE_GRID; i++) {
            const cx = (i + 0.5) * cell;
            for (let j = 0; j < SCORE_GRID; j++) {
                const cy = (j + 0.5) * cell;
                let covB = false, covW = false;
                let bestB = Infinity, bestW = Infinity;
                for (const p of b.pieces) {
                    const { x, y } = xyOf(b, p);
                    const d = dist(cx, cy, x, y);
                    if (d <= PIECE_RADIUS + EPS) {
                        if (p.color === 1) covB = true; else covW = true;
                    }
                    if (p.color === 1) { if (d < bestB) bestB = d; }
                    else { if (d < bestW) bestW = d; }
                }
                if (covB) blackCells += cellArea;
                if (covW) whiteCells += cellArea;
                if (!covB && !covW && (bestB < Infinity || bestW < Infinity)) {
                    if (Math.abs(bestB - bestW) >= 1e-6) {
                        if (bestB < bestW) blackTerr += cellArea;
                        else whiteTerr += cellArea;
                    }
                }
            }
        }
        const bs = blackCells + blackTerr;
        const ws = whiteCells + whiteTerr;
        return { black: bs, white: ws, lead: bs - ws - KOMI };
    }

    let stones = [];
    let openingStones = [];
    let currentPlayer = 1;
    let mySlot = null;
    let slots = { black: false, white: false };
    let numberOfHands = 1;
    let gameOver = false;
    let winner = null;
    let moveCoords = [];
    let lastMoveMarkers = [];
    let showEstimateActive = false;
    let territoryCanvas = null;
    let territoryKey = '';
    let hoverGx = -1, hoverGy = -1;
    let isHoverValid = false;
    let showMoveNumbers = false;
    let showLiberty = false;
    let showGrid = true;
    let userBoardMarks = Object.create(null);
    if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks);
    let replayMode = false;
    let replayStonesSeq = [];
    let replayMarkersSeq = [];
    let replayStepPlayers = [];
    let replayStep = 0;
    let replayTotalSteps = 0;
    let liveReplayStonesSeq = [];
    let liveReplayMarkers = [];
    let liveViewStep = 0;
    let liveFollowLatest = true;
    let waitingScoreConfirm = false;
    let iRejected = false;
    let reconnectTimer = null;
    let matchTime = null;
    let matchStarted = false;
    let matchStartedOnce = false;
    let gameStarted = false;
    let editModeEnabled = false;
    let editTool = 'empty';
    let ws;
    let bindingsUpdateRadioStyles = null;

    const canvas = document.getElementById('goBoard');
    const ctx = canvas.getContext('2d');
    const turnDisplay = document.getElementById('turnDisplay');
    const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
    const scoreBoard = document.getElementById('scoreBoard');
    const leadInfo = document.getElementById('leadInfo');
    const boardLengthSelect = document.getElementById('boardLengthSelect');
    const showNumbersCheck = document.getElementById('showNumbersCheck');
    const showLibertyCheck = document.getElementById('showLibertyCheck');
    const showGridCheck = document.getElementById('showGridCheck');
    const boardMarkSelect = document.getElementById('boardMarkSelect');
    const editModeCheckbox = document.getElementById('editModeCheckbox');
    const editToolSelect = document.getElementById('editToolSelect');
    const clearBoardBtn = document.getElementById('clearBoardBtn');
    const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
    const scoreConfirmText = document.getElementById('scoreConfirmText');
    const scoreConfirmYes = document.getElementById('scoreConfirmYes');
    const scoreConfirmNo = document.getElementById('scoreConfirmNo');

    const BOARD_MARK_CHAR_LIST = (() => {
        const a = ['?', '!'];
        for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
        a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
        return a;
    })();
    QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
    QiSquareWeiqiCanvas.initBoardMarkFoldDom(
        document.getElementById('boardMarkPanel'),
        document.getElementById('boardMarkFoldBtn'),
        document.getElementById('boardMarkExpandBtn')
    );

    function formatScore(n) {
        let s = n.toFixed(2);
        return s.replace(/\.?0+$/, '');
    }

    function updateGeometry() {
        scale = BOARD_SIZE_PX / boardLength;
        piecePx = Math.round(scale);
    }

    function isLegalHover(x, y) {
        const b = makeBoardFromStones(stones);
        for (const p of b.pieces) {
            const { x: px, y: py } = xyOf(b, p);
            if (dist(x, y, px, py) < MIN_DISTANCE - EPS) return false;
        }
        return x >= 0 && x <= boardLength && y >= 0 && y <= boardLength;
    }

    function territoryCacheKey() {
        return stones.map(s => `${s.color}${s.ix},${s.iy}`).join('|') + '|' + boardLength;
    }

    function renderTerritoryCanvas() {
        const off = document.createElement('canvas');
        off.width = BOARD_SIZE_PX;
        off.height = BOARD_SIZE_PX;
        const octx = off.getContext('2d');
        const img = octx.createImageData(BOARD_SIZE_PX, BOARD_SIZE_PX);
        const data = img.data;
        const inv = 1 / scale;
        const radSq = PIECE_RADIUS * PIECE_RADIUS;
        const bx = [], by = [], wx = [], wy = [];
        for (const p of stones) {
            const gx = ixToX(p.ix), gy = iyToY(p.iy);
            if (p.color === 1) { bx.push(gx); by.push(gy); }
            else { wx.push(gx); wy.push(gy); }
        }
        for (let py = 0; py < BOARD_SIZE_PX; py++) {
            const gy = py * inv;
            for (let px = 0; px < BOARD_SIZE_PX; px++) {
                const gx = px * inv;
                let bestB2 = Infinity, bestW2 = Infinity, covB = false, covW = false;
                for (let k = 0; k < bx.length; k++) {
                    const dx = gx - bx[k], dy = gy - by[k];
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestB2) bestB2 = d2;
                    if (d2 <= radSq) covB = true;
                }
                for (let k = 0; k < wx.length; k++) {
                    const dx = gx - wx[k], dy = gy - wy[k];
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestW2) bestW2 = d2;
                    if (d2 <= radSq) covW = true;
                }
                let r = 0, g = 0, b = 0, a = 0;
                if (!covB && !covW && (bestB2 < Infinity || bestW2 < Infinity)) {
                    if (Math.abs(bestB2 - bestW2) < 1e-7) { r = 170; g = 170; b = 170; a = 70; }
                    else if (bestB2 < bestW2) { r = 25; g = 18; b = 10; a = 96; }
                    else { r = 255; g = 248; b = 220; a = 150; }
                }
                const idx = (py * BOARD_SIZE_PX + px) * 4;
                data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
            }
        }
        octx.putImageData(img, 0, 0);
        return off;
    }

    function drawBoard() {
        const viewStones = replayMode ? (replayStonesSeq[replayStep] || []) : stones;
        ctx.fillStyle = '#debe87';
        ctx.fillRect(0, 0, BOARD_SIZE_PX, BOARD_SIZE_PX);
        if (showGrid) {
            ctx.fillStyle = '#b08e60';
            for (let i = 0; i <= boardLength; i++) {
                for (let j = 0; j <= boardLength; j++) {
                    const [px, py] = gameToPx(i, j);
                    ctx.beginPath();
                    ctx.arc(px, py, 1, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        if (showEstimateActive) {
            const key = territoryCacheKey();
            if (territoryKey !== key) {
                territoryCanvas = renderTerritoryCanvas();
                territoryKey = key;
            }
            if (territoryCanvas) ctx.drawImage(territoryCanvas, 0, 0);
        }
        const radius = piecePx / 2;
        for (const s of viewStones) {
            const [px, py] = gameToPx(ixToX(s.ix), iyToY(s.iy));
            ctx.fillStyle = s.color === 1 ? '#1a1a1a' : '#f4f1ea';
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#28201a';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        if (lastMoveMarkers && lastMoveMarkers.length > 0 && !replayMode) {
            const lm = lastMoveMarkers[0];
            const [px, py] = gameToPx(ixToX(lm.ix), iyToY(lm.iy));
            ctx.strokeStyle = '#c83838';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(3, radius / 3), 0, Math.PI * 2);
            ctx.stroke();
        }
        if (showLiberty && viewStones.length) {
            const b = makeBoardFromStones(viewStones);
            const libMap = new Map();
            const seen = new Set();
            for (const p of b.pieces) {
                if (seen.has(p._uid)) continue;
                const grp = groupOf(b, p);
                const lib = groupLiberty(b, grp);
                for (const q of grp) { seen.add(q._uid); libMap.set(q._uid, lib); }
            }
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const p of b.pieces) {
                const [px, py] = gameToPx(ixToX(p.ix), iyToY(p.iy));
                ctx.fillStyle = p.color === 1 ? '#ddd' : '#222';
                ctx.fillText(String(libMap.get(p._uid)), px, py);
            }
        }
        if (showMoveNumbers && moveCoords.length) {
            const numMap = new Map();
            let n = 0;
            for (const m of moveCoords) {
                if (m.type !== 'move') continue;
                n++;
                numMap.set(`${m.ix},${m.iy}`, n);
            }
            ctx.font = `bold ${Math.max(9, Math.floor(radius * 0.7))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const s of viewStones) {
                const num = numMap.get(`${s.ix},${s.iy}`);
                if (!num) continue;
                const [px, py] = gameToPx(ixToX(s.ix), iyToY(s.iy));
                ctx.fillStyle = s.color === 1 ? '#fff' : '#111';
                ctx.fillText(String(num), px, py);
            }
        }
        if (!replayMode && !gameOver && isMyTurn() && isHoverValid && hoverGx >= 0) {
            const [px, py] = gameToPx(hoverGx, hoverGy);
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = currentPlayer === 1 ? '#1a1a1a' : '#f4f1ea';
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        for (const key of Object.keys(userBoardMarks)) {
            if (showEstimateActive) continue;
            const [ixs, iys] = key.split(',').map(Number);
            const [px, py] = gameToPx(ixToX(ixs), iyToY(iys));
            const ch = userBoardMarks[key];
            ctx.font = `bold ${Math.max(10, radius)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#3a281c';
            ctx.fillText(ch, px, py);
        }
    }

    function isMyTurn() {
        if (!matchStarted || !mySlot || gameOver) return false;
        return (mySlot === 'black' && currentPlayer === 1) || (mySlot === 'white' && currentPlayer === 2);
    }

    function updateEstimate() {
        if (!showEstimateActive) {
            scoreTitle.innerText = '　';
            scoreBoard.innerText = '　';
            leadInfo.innerText = '　';
            return;
        }
        const { black, white, lead } = computeScoreFromStones(stones);
        scoreTitle.innerText = '🏆 形势';
        scoreBoard.innerText = `黑: ${formatScore(black)}　|　白: ${formatScore(white)} (+${KOMI})`;
        leadInfo.innerText = lead >= 0 ? `黑+${formatScore(lead)}` : `白+${formatScore(-lead)}`;
    }

    function updateTurn() {
        if (matchStarted) matchStartedOnce = true;
        const both = slots.black && slots.white;
        if (!matchStarted) turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
        else if (numberOfHands <= 1) turnDisplay.innerText = '初始局面';
        else {
            const lastPlayer = currentPlayer === 1 ? 2 : 1;
            turnDisplay.innerText = `${lastPlayer === 1 ? '⚫' : '⚪'} 第${numberOfHands - 1}手`;
        }
        const canEditLen = !gameStarted && !gameOver && !mySlot && stones.length === 0 && moveCoords.length === 0;
        if (boardLengthSelect) boardLengthSelect.style.display = canEditLen ? 'inline-block' : 'none';
        updateEditModeUI();
        drawBoard();
        updateEstimate();
    }

    function updateEditModeUI() {
        const canEdit = !gameOver && !gameStarted && !(typeof matchStarted !== "undefined" && matchStarted)
            && !(matchTime && matchTime.settings);
        const editControls = document.getElementById('editControls');
        if (editControls && editControls.dataset.qiEditFeature === '1') {
            editControls.hidden = !canEdit;
        }
        if (editModeCheckbox) editModeCheckbox.disabled = !canEdit;
        if (!canEdit && editModeEnabled) {
            editModeEnabled = false;
            if (editModeCheckbox) editModeCheckbox.checked = false;
            if (editToolSelect) editToolSelect.classList.add('hidden');
            if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
        }
    }

    function sendEditBoard(newStones) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (gameOver || gameStarted || matchStarted || (matchTime && matchTime.settings)) return;
        ws.send(JSON.stringify({ type: 'editBoard', stones: newStones }));
    }

    function applyEditChange(newStones) {
        stones = deepCopyStones(newStones);
        openingStones = deepCopyStones(newStones);
        liveReplayStonesSeq = [deepCopyStones(stones)];
        liveReplayMarkers = [[]];
        liveViewStep = 0;
        territoryKey = '';
        drawBoard();
        sendEditBoard(stones);
    }

    function rebuildLiveReplayFromMoveCoords(coords) {
        let cur = deepCopyStones(openingStones);
        liveReplayStonesSeq = [deepCopyStones(cur)];
        liveReplayMarkers = [[]];
        for (const m of coords) {
            if (m.type === 'move') {
                const b = makeBoardFromStones(cur);
                b.stateHistory = [];
                b.graphHistory = [makeGraph(b)];
                const pv = m.player === 'black' ? 1 : 2;
                const r = tryPlaceOnBoard(b, pv, ixToX(m.ix), iyToY(m.iy));
                if (r.ok) cur = b.pieces.map(p => ({ ix: p.ix, iy: p.iy, color: p.color }));
                liveReplayMarkers.push([{ ix: m.ix, iy: m.iy, color: pv }]);
            } else {
                liveReplayMarkers.push([]);
            }
            liveReplayStonesSeq.push(deepCopyStones(cur));
        }
    }

    function setLiveViewStep(step) {
        liveViewStep = step;
        if (liveReplayStonesSeq.length) stones = deepCopyStones(liveReplayStonesSeq[step] || []);
        lastMoveMarkers = (liveReplayMarkers[step] || []).map(m => ({ ...m }));
        drawBoard();
        updateEstimate();
    }

    function setReplayStep(step) {
        replayStep = step;
        drawBoard();
    }

    function exitReplayMode() {
        replayMode = false;
        replayStonesSeq = [];
        replayMarkersSeq = [];
        replayStep = 0;
        replayTotalSteps = 0;
        const slider = document.getElementById('replaySlider');
        if (slider) { slider.max = 0; slider.value = 0; }
        syncStateFromServer();
    }

    function syncStateFromServer() {
        if (liveReplayStonesSeq.length) setLiveViewStep(liveFollowLatest ? liveReplayStonesSeq.length - 1 : liveViewStep);
        else drawBoard();
        updateTurn();
    }

    function syncState(state) {
        if (state.boardLength) {
            boardLength = state.boardLength;
            boardLengthSelect.value = String(boardLength);
            updateGeometry();
        }
        stones = deepCopyStones(state.stones || []);
        openingStones = deepCopyStones(state.openingStones || stones);
        currentPlayer = state.currentPlayer || 1;
        numberOfHands = state.numberOfHands || 1;
        gameOver = !!state.gameOver;
        winner = state.winner || null;
        moveCoords = (state.moveCoords || []).map(m => ({ ...m }));
        lastMoveMarkers = (state.lastMoveMarkers || []).map(m => ({ ...m }));
        slots = state.slots || slots;
        gameStarted = (numberOfHands || 1) > 1;
        rebuildLiveReplayFromMoveCoords(moveCoords);
        liveFollowLatest = true;
        territoryKey = '';
        if (!replayMode) syncStateFromServer();
        updateEditModeUI();
    }

    function enterReplayMode(data) {
        let cur = deepCopyStones(data.openingStones || openingStones);
        replayStonesSeq = [deepCopyStones(cur)];
        replayMarkersSeq = [[]];
        replayStepPlayers = [0];
        for (const m of (data.moves || [])) {
            if (m.type === 'move') {
                const b = makeBoardFromStones(cur);
                b.stateHistory = [];
                b.graphHistory = [makeGraph(b)];
                const pv = m.player === 'black' ? 1 : 2;
                tryPlaceOnBoard(b, pv, ixToX(m.ix), iyToY(m.iy));
                cur = b.pieces.map(p => ({ ix: p.ix, iy: p.iy, color: p.color }));
                replayMarkersSeq.push([{ ix: m.ix, iy: m.iy, color: pv }]);
            } else replayMarkersSeq.push([]);
            replayStonesSeq.push(deepCopyStones(cur));
            replayStepPlayers.push(m.player === 'black' ? 1 : 2);
        }
        replayTotalSteps = replayStonesSeq.length - 1;
        replayMode = true;
        replayStep = replayTotalSteps;
        const slider = document.getElementById('replaySlider');
        slider.max = replayTotalSteps;
        slider.value = replayStep;
        document.getElementById('replayStepDisplay').textContent = `${replayStep} / ${replayTotalSteps}`;
        drawBoard();
    }

    function hideScoreConfirm() { scoreConfirmPanel.style.display = 'none'; }
    function showScoreConfirm(lead) {
        const abs = Math.abs(lead);
        const t = lead > 0 ? `黑胜${formatScore(abs)}点` : (lead < 0 ? `白胜${formatScore(abs)}点` : '平局');
        scoreConfirmText.innerText = `${t}，是否同意该结果？`;
        scoreConfirmPanel.style.display = 'block';
    }
    function clearEstimate() {
        showEstimateActive = false;
        territoryCanvas = null;
        territoryKey = '';
        scoreTitle.innerText = '　';
        scoreBoard.innerText = '　';
        leadInfo.innerText = '　';
        drawBoard();
    }
    function showEstimate() {
        showEstimateActive = true;
        territoryKey = '';
        drawBoard();
        updateEstimate();
    }
    function downloadRecord(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `连续围棋_L${data.boardLength}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
        roomId, gameType,
        pageState: {
            get matchTime() { return matchTime; }, set matchTime(v) { matchTime = v; },
            get matchStarted() { return matchStarted; }, set matchStarted(v) { matchStarted = !!v; },
            get matchStartedOnce() { return matchStartedOnce; }, set matchStartedOnce(v) { matchStartedOnce = !!v; },
            get numberOfHands() { return numberOfHands; }, set numberOfHands(v) { numberOfHands = v; },
            get currentPlayer() { return currentPlayer; }, set currentPlayer(v) { currentPlayer = v; },
            get mySlot() { return mySlot; }, set mySlot(v) { mySlot = v; },
            get gameOver() { return gameOver; }, set gameOver(v) { gameOver = !!v; },
            get winner() { return winner; }, set winner(v) { winner = v; },
            get lastMoveMarkers() { return lastMoveMarkers; }, set lastMoveMarkers(v) { lastMoveMarkers = v || []; },
            get showEstimateActive() { return showEstimateActive; }, set showEstimateActive(v) { showEstimateActive = !!v; },
            get waitingScoreConfirm() { return waitingScoreConfirm; }, set waitingScoreConfirm(v) { waitingScoreConfirm = !!v; },
            get iRejected() { return iRejected; }, set iRejected(v) { iRejected = !!v; },
            get slots() { return slots; }, set slots(v) { slots = v || { black: false, white: false }; },
            get ws() { return ws; }, set ws(v) { ws = v; },
            get replayMode() { return replayMode; }, set replayMode(v) { replayMode = !!v; }
        },
        drawBoard, exitTryPlay: () => {}, enterTryPlay: () => {}, setTryPlayStep: () => {},
        setReplayStep, setLiveViewStep,
        getWs: () => ws,
        getBoardSize: () => boardLength,
        setBoardSize: (n) => { boardLength = n; boardLengthSelect.value = String(n); updateGeometry(); },
        getKomi: () => KOMI, setKomi: () => {},
        getBoard: () => stones, setBoard: (s) => { stones = s; },
        getSlots: () => slots, setSlots: (s) => { slots = s; },
        getMySlot: () => mySlot, setMySlot: (s) => { mySlot = s; },
        getGameOver: () => gameOver, setGameOver: (v) => { gameOver = !!v; },
        getWinner: () => winner, setWinner: (w) => { winner = w; },
        getReplayMode: () => replayMode,
        getShowEstimateActive: () => showEstimateActive, setShowEstimateActive: (v) => { showEstimateActive = !!v; },
        getWaitingScoreConfirm: () => waitingScoreConfirm, setWaitingScoreConfirm: (v) => { waitingScoreConfirm = !!v; },
        getIRejected: () => iRejected, setIRejected: (v) => { iRejected = !!v; },
        colorStatus, scoreTitle, turnDisplay, syncState, updateBoardGeometry: updateGeometry, initBoardArray: () => [],
        exitReplayMode, clearEstimate, hideScoreConfirm, showEstimate,
        clearMobileMovePreview: () => {}, downloadRecord, enterReplayMode, updateTurn, showScoreConfirm,
        isMouseDevice: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
        standardWeiqiMatchTime,
            boardSeatOverlay: true,
        onNewGameStarted() {
            editModeEnabled = false;
            gameStarted = false;
            if (editModeCheckbox) {
                editModeCheckbox.checked = false;
                editModeCheckbox.disabled = false;
            }
            if (editToolSelect) editToolSelect.classList.add('hidden');
            if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
            updateEditModeUI();
        },
        updateEditModeUI
    });
    const bindingsHandleMessage = _weiqiBindings.handleMessage;
    bindingsUpdateRadioStyles = _weiqiBindings.updateRadioStyles;

    function handleMessage(msg) {
        if (msg.type === 'boardLengthChanged' || msg.type === 'editBoardAccepted') {
            syncState(msg);
            if (msg.type === 'editBoardAccepted') drawBoard();
            return;
        }
        bindingsHandleMessage(msg);
        if (msg.type === 'importSuccess') qiAlert('棋谱已导入');
    }

    function connectWebSocket() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/qi/ws?game=${gameType}&room=${roomId}`);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', password: roomPassword, requestedSlot: null }));
        ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
        ws.onclose = (ev) => {
            if (ev.code === 1008 && String(ev.reason || '').includes('房间')) {
                qiAlert('房间不存在');
                window.location.href = '/qi';
                return;
            }
            colorStatus.innerText = '连接断开，重连中...';
            reconnectTimer = setTimeout(connectWebSocket, 2000);
        };
    }

    function canvasCoordsFromClient(cx, cy) {
        const rect = canvas.getBoundingClientRect();
        const s = BOARD_SIZE_PX / rect.width;
        return { x: (cx - rect.left) * s, y: (cy - rect.top) * s };
    }

    function findNearestStone(gx, gy, maxDist) {
        let best = null, bestD = maxDist;
        for (const s of stones) {
            const d = dist(gx, gy, ixToX(s.ix), iyToY(s.iy));
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    function commitMoveFromCanvas(px, py) {
        if (replayMode || !isMyTurn() || gameOver || waitingScoreConfirm) return;
        const [gx, gy] = pxToGame(px, py);
        if (!isLegalHover(gx, gy)) return;
        ws.send(JSON.stringify({ type: 'move', ix: toIx(gx), iy: toIy(gy) }));
    }

    function applyUserBoardMarkAt(ix, iy) {
        const key = `${ix},${iy}`;
        const v = boardMarkSelect ? boardMarkSelect.value : '?';
        if (!v) { delete userBoardMarks[key]; } else {
            if (userBoardMarks[key] === v) delete userBoardMarks[key];
            else userBoardMarks[key] = v;
        }
        drawBoard();
    }

    if (editModeCheckbox) {
        editModeCheckbox.addEventListener('change', () => {
            editModeEnabled = editModeCheckbox.checked;
            if (editToolSelect) editToolSelect.classList.toggle('hidden', !editModeEnabled);
            if (clearBoardBtn) clearBoardBtn.classList.toggle('hidden', !editModeEnabled);
        });
    }
    if (editToolSelect) editToolSelect.addEventListener('change', () => { editTool = editToolSelect.value; });
    if (clearBoardBtn) clearBoardBtn.addEventListener('click', () => applyEditChange([]));

    if (boardLengthSelect) {
        boardLengthSelect.addEventListener('change', () => {
            const n = parseFloat(boardLengthSelect.value);
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'setBoardLength', boardLength: n }));
        });
    }
    if (showNumbersCheck) showNumbersCheck.addEventListener('change', () => { showMoveNumbers = showNumbersCheck.checked; drawBoard(); });
    if (showLibertyCheck) showLibertyCheck.addEventListener('change', () => { showLiberty = showLibertyCheck.checked; drawBoard(); });
    if (showGridCheck) showGridCheck.addEventListener('change', () => { showGrid = showGridCheck.checked; drawBoard(); });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        const [gx, gy] = pxToGame(x, y);
        if (editModeEnabled) {
            const near = findNearestStone(gx, gy, 0.6);
            if (near) applyEditChange(stones.filter(s => !stonesEqual(s, near)));
            return;
        }
        applyUserBoardMarkAt(toIx(gx), toIy(gy));
    });

    canvas.addEventListener('mousemove', (e) => {
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        const [gx, gy] = pxToGame(x, y);
        hoverGx = gx; hoverGy = gy;
        isHoverValid = !editModeEnabled && isLegalHover(gx, gy);
        drawBoard();
        if (showEstimateActive) updateEstimate();
    });
    canvas.addEventListener('mouseleave', () => { isHoverValid = false; drawBoard(); });

    canvas.addEventListener('click', (e) => {
        if (waitingScoreConfirm) return;
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        const [gx, gy] = pxToGame(x, y);
        if (editModeEnabled) {
            if (editTool === 'empty') {
                const near = findNearestStone(gx, gy, 0.6);
                if (near) applyEditChange(stones.filter(s => !stonesEqual(s, near)));
                return;
            }
            const color = editTool === 'black' ? 1 : 2;
            const trial = deepCopyStones(stones);
            const ix = toIx(gx), iy = toIy(gy);
            const dup = trial.findIndex(s => s.ix === ix && s.iy === iy);
            if (dup >= 0) trial.splice(dup, 1);
            for (const s of trial) {
                if (s.color !== color) continue;
                if (dist(gx, gy, ixToX(s.ix), iyToY(s.iy)) < MIN_DISTANCE - EPS) return;
            }
            trial.push({ ix, iy, color });
            applyEditChange(trial);
            return;
        }
        commitMoveFromCanvas(x, y);
    });

    if (scoreConfirmYes) {
        scoreConfirmYes.onclick = () => { ws.send(JSON.stringify({ type: 'scoreResponse', accept: true })); hideScoreConfirm(); };
        scoreConfirmNo.onclick = () => {
            iRejected = true;
            ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
            hideScoreConfirm();
            if (showEstimateActive) clearEstimate();
            waitingScoreConfirm = false;
        };
    }

    document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
    document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
    document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };

    connectWebSocket();
    updateTurn();
})();
        })();
    }
};
