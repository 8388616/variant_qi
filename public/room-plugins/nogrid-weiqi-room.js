window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["nogrid-weiqi"] = {
    shell: {
        "title": "无格线围棋",
        "rulesHtml": "可以在棋盘内任意点落子，但不允许与其它棋子有重叠。<br /><br />（记d为棋子直径。）<br /><br /><strong>相邻：</strong>记同色的棋子A和棋子B的中点为C。若AB&lt;2d，且当前棋盘上不存在棋子D和棋子E满足AB和DE相交且DE&lt;AB，且不存在棋子F满足CF&lt;AC，则棋子A和棋子B相邻。<br /><br /><strong>一片棋：</strong>从某颗棋子出发，经过有限步的相邻关系所能达到的所有棋子组成一片棋。<br /><br /><strong>提子：</strong>对于一片棋，如果棋盘内无法放下一枚不与当前棋盘上的棋子重叠的棋子，使之与这片棋子中的任何一枚紧贴，则这片棋是无气的，需要被提掉。<br /><br /><strong>禁全同：</strong>不禁全同。但是若上一步棋提子且只提掉一子，那么本手棋提子且只提掉上一步的棋子是不允许的。<br /><br />采用数点法。棋盘上每个像素点归属于离自己最近的棋子所属的一方。按双方各自占的像素点所占总像素点数的比例分配棋盘。棋盘共计(路数 * 路数)点，黑贴白3.25点。<br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 6,
        "boardSizeMax": 20,
        "defaultBoardSize": 18,
        "minLib": 1,
        "recordDownloadPrefix": "无格线围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "nogridExtras": true
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
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
            16,
            17,
            18,
            19,
            20
        ],
        "sizeSelectId": "roadCountSelect",
        "sizeLabel": "路"
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "无格线围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
            var sel = document.getElementById('boardSizeSelect');
            if (sel && !document.getElementById("roadCountSelect")) {
                sel.id = "roadCountSelect";
            }
        })();

        (function () {
(function () {
    const COORD_SCALE = 1000000;
    const BOARD_SIZE_PX = 600;
    const PADDING = 25;
    const INNER_SIZE = BOARD_SIZE_PX - 2 * PADDING;
    const KOMI = 3.25;
    const LIBERTY_ANGLE_STEP = Math.PI / 36;

    let roadCount = 18;
    function getDiameter() { return INNER_SIZE / roadCount; }
    function getRadius() { return getDiameter() / 2; }
    function totalAreaCells() { return roadCount * roadCount; }

    function ixToX(ix) { return PADDING + (ix / COORD_SCALE) * INNER_SIZE; }
    function iyToY(iy) { return PADDING + (iy / COORD_SCALE) * INNER_SIZE; }
    function toIx(x) { return Math.round(((x - PADDING) / INNER_SIZE) * COORD_SCALE); }
    function toIy(y) { return Math.round(((y - PADDING) / INNER_SIZE) * COORD_SCALE); }
    function stoneXY(s) { return { x: ixToX(s.ix), y: iyToY(s.iy) }; }

    let stones = [];
    let currentPlayer = 1;
    let mySlot = null;
    let slots = { black: false, white: false };
    let numberOfHands = 1;
    let gameOver = false;
    let winner = null;
    let moveCoords = [];
    let lastMoveMarkers = [];

    let showEstimateActive = false;
    let territoryImageData = null;
    let territoryStats = { blackPoints: 0, whitePoints: 0, totalPixels: 0 };

    let hoverIx = -1, hoverIy = -1;
    let isHoverValid = false;

    let showMoveNumbers = false;
    let showLibertyStones = false;

    let userBoardMarks = Object.create(null);
    if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks);

    /** 与标准围棋一致：导入棋谱后的打谱模式 */
    let replayMode = false;
    let replayStonesSeq = [];
    let replayMarkersSeq = [];
    let replayStepPlayers = [];
    let replayStep = 0;
    let replayTotalSteps = 0;

    let liveReplayStonesSeq = [];
    /** 与 liveReplayStonesSeq 同下标：该步局面下的最后落子标记 */
    let liveReplayMarkers = [];
    let liveViewStep = 0;
    let liveFollowLatest = true;

    let waitingScoreConfirm = false;
    let iRejected = false;
    let reconnectTimer = null;
    let matchTime = null;
    let matchStarted = false;
    let matchStartedOnce = false;
    let ws;
    let bindingsUpdateRadioStyles = null;
    let bindingsUpdateRecordButtons = null;

    const canvas = document.getElementById('goBoard');
    const ctx = canvas.getContext('2d');
    const turnDisplay = document.getElementById('turnDisplay');
    const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
    const scoreBoard = document.getElementById('scoreBoard');
    const leadInfo = document.getElementById('leadInfo');
    const roadCountSelect = document.getElementById('roadCountSelect');
    const showNumbersCheck = document.getElementById('showNumbersCheck');
    const showLibertyStonesCheck = document.getElementById('showLibertyStonesCheck');
    const showAdjacentLinesCheckbox = document.getElementById('showAdjacentLinesCheckbox');
    const boardMarkSelect = document.getElementById('boardMarkSelect');

    const BOARD_MARK_CHAR_LIST = (function () {
        const a = [];
        a.push('?', '!');
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

    const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
    const scoreConfirmText = document.getElementById('scoreConfirmText');
    const scoreConfirmYes = document.getElementById('scoreConfirmYes');
    const scoreConfirmNo = document.getElementById('scoreConfirmNo');

    function formatScore(num) {
        let str = num.toFixed(1);
        str = str.replace(/\.?0+$/, '');
        return str;
    }

    function deepCopyStones(src) {
        return src.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
    }

    function stonesEqual(a, b) {
        return a.ix === b.ix && a.iy === b.iy && a.color === b.color;
    }

    function isPointInBoard(x, y) {
        return x >= PADDING && x <= BOARD_SIZE_PX - PADDING && y >= PADDING && y <= BOARD_SIZE_PX - PADDING;
    }

    function distanceSq(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    }
    function distance(p1, p2) { return Math.sqrt(distanceSq(p1, p2)); }

    function segmentsIntersect(p1, p2, p3, p4) {
        function orientation(a, b, c) {
            const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
            if (Math.abs(val) < 1e-9) return 0;
            return val > 0 ? 1 : 2;
        }
        function onSeg(a, b, c) {
            return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) &&
                b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y);
        }
        const o1 = orientation(p1, p2, p3);
        const o2 = orientation(p1, p2, p4);
        const o3 = orientation(p3, p4, p1);
        const o4 = orientation(p3, p4, p2);
        if (o1 !== o2 && o3 !== o4) return true;
        if (o1 === 0 && onSeg(p1, p3, p2)) return true;
        if (o2 === 0 && onSeg(p1, p4, p2)) return true;
        if (o3 === 0 && onSeg(p3, p1, p4)) return true;
        if (o4 === 0 && onSeg(p3, p2, p4)) return true;
        return false;
    }

    function areAdjacent(a, b, allStones, diameter) {
        if (a.color !== b.color) return false;
        const pa = stoneXY(a);
        const pb = stoneXY(b);
        const d = distance(pa, pb);
        if (d >= 2 * diameter) return false;
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const halfAB = d / 2;
        for (let f of allStones) {
            if (stonesEqual(f, a) || stonesEqual(f, b)) continue;
            if (distance(stoneXY(f), mid) < halfAB - 1e-7) return false;
        }
        for (let i = 0; i < allStones.length; i++) {
            for (let j = i + 1; j < allStones.length; j++) {
                const ds = allStones[i], es = allStones[j];
                if (stonesEqual(ds, a) || stonesEqual(ds, b) || stonesEqual(es, a) || stonesEqual(es, b)) continue;
                const pd = stoneXY(ds), pe = stoneXY(es);
                const deLen = distance(pd, pe);
                if (deLen < d - 1e-7 && segmentsIntersect(pa, pb, pd, pe)) return false;
            }
        }
        return true;
    }

    function getGroups(allStones, targetColor, diameter) {
        const visited = new Set();
        const groups = [];
        for (let i = 0; i < allStones.length; i++) {
            const s = allStones[i];
            if (s.color !== targetColor) continue;
            const key = `${s.ix},${s.iy}`;
            if (visited.has(key)) continue;
            const queue = [s];
            visited.add(key);
            const group = [s];
            while (queue.length) {
                const cur = queue.shift();
                for (let j = 0; j < allStones.length; j++) {
                    const ns = allStones[j];
                    if (ns.color !== targetColor) continue;
                    const nKey = `${ns.ix},${ns.iy}`;
                    if (visited.has(nKey)) continue;
                    if (areAdjacent(cur, ns, allStones, diameter)) {
                        visited.add(nKey);
                        queue.push(ns);
                        group.push(ns);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    function hasGroupLiberty(group, allStones, diameter) {
        const d2 = diameter * diameter;
        for (let stone of group) {
            const sxy = stoneXY(stone);
            for (let ang = 0; ang < 2 * Math.PI; ang += LIBERTY_ANGLE_STEP) {
                const px = sxy.x + diameter * Math.cos(ang);
                const py = sxy.y + diameter * Math.sin(ang);
                if (px < PADDING - 1e-5 || px > BOARD_SIZE_PX - PADDING + 1e-5 ||
                    py < PADDING - 1e-5 || py > BOARD_SIZE_PX - PADDING + 1e-5) continue;
                let occupied = false;
                for (let s of allStones) {
                    const t = stoneXY(s);
                    const dx = px - t.x;
                    const dy = py - t.y;
                    if (dx * dx + dy * dy < d2 - 1e-7) { occupied = true; break; }
                }
                if (!occupied) return true;
            }
        }
        return false;
    }

    function isOverlapWithStonesXY(x, y, stoneList, diameter, excludeStone) {
        const d2 = diameter * diameter;
        for (let s of stoneList) {
            if (excludeStone && stonesEqual(s, excludeStone)) continue;
            const t = stoneXY(s);
            const dx = x - t.x;
            const dy = y - t.y;
            if (dx * dx + dy * dy < d2) return true;
        }
        return false;
    }

    function applyMoveClient(currentStones, moveStone, diameter) {
        let newStones = deepCopyStones(currentStones);
        newStones.push(moveStone);
        const opponentColor = moveStone.color === 1 ? 2 : 1;
        let changed = true;
        while (changed) {
            changed = false;
            const opponentGroups = getGroups(newStones, opponentColor, diameter);
            for (let group of opponentGroups) {
                if (!hasGroupLiberty(group, newStones, diameter)) {
                    newStones = newStones.filter(s => !group.some(g => stonesEqual(g, s)));
                    changed = true;
                }
            }
            const selfGroups = getGroups(newStones, moveStone.color, diameter);
            for (let group of selfGroups) {
                if (!hasGroupLiberty(group, newStones, diameter)) {
                    newStones = newStones.filter(s => !group.includes(s));
                    changed = true;
                }
            }
        }
        return newStones;
    }

    /** 该棋子旁是否存在可落子点与之紧贴（距离为直径） */
    function stoneHasLocalLiberty(stone, allStones, diameter) {
        const sxy = stoneXY(stone);
        for (let ang = 0; ang < 2 * Math.PI; ang += LIBERTY_ANGLE_STEP) {
            const px = sxy.x + diameter * Math.cos(ang);
            const py = sxy.y + diameter * Math.sin(ang);
            if (!isPointInBoard(px, py)) continue;
            if (isOverlapWithStonesXY(px, py, allStones, diameter, null)) continue;
            return true;
        }
        return false;
    }

    function computeTerritory() {
        const width = BOARD_SIZE_PX;
        const diameter = getDiameter();
        const stonesList = stones.map(s => ({ ...stoneXY(s), color: s.color }));
        const imageData = ctx.createImageData(width, BOARD_SIZE_PX);
        const data = imageData.data;
        let blackPixels = 0, whitePixels = 0, totalInsidePixels = 0;
        for (let y = 0; y < BOARD_SIZE_PX; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
                if (x < PADDING || x > BOARD_SIZE_PX - PADDING || y < PADDING || y > BOARD_SIZE_PX - PADDING) continue;
                totalInsidePixels++;
                let minDistSq = Infinity, bestColor = 0, tie = false;
                for (let stone of stonesList) {
                    const dx = x - stone.x;
                    const dy = y - stone.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < minDistSq - 1e-7) { minDistSq = distSq; bestColor = stone.color; tie = false; }
                    else if (Math.abs(distSq - minDistSq) < 1e-7) tie = true;
                }
                if (tie) {
                    data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 0;
                    blackPixels += 0.5; whitePixels += 0.5;
                } else if (bestColor === 1) {
                    data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 160;
                    blackPixels += 1;
                } else if (bestColor === 2) {
                    data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 160;
                    whitePixels += 1;
                }
            }
        }
        const ta = totalAreaCells();
        const blackPoints = ta * (blackPixels / totalInsidePixels);
        const whitePoints = ta * (whitePixels / totalInsidePixels);
        return { imageData, stats: { blackPoints, whitePoints, totalPixels: totalInsidePixels } };
    }

    function recomputeTerritory() {
        if (!showEstimateActive) return;
        const r = computeTerritory();
        territoryImageData = r.imageData;
        territoryStats = r.stats;
    }

    function drawAdjacentLines(pieces, allStones, diameter) {
        const pairs = [];
        for (let i = 0; i < pieces.length; i++) {
            for (let j = i + 1; j < pieces.length; j++) {
                const a = pieces[i], b = pieces[j];
                if (a.color === b.color && areAdjacent(a, b, allStones, diameter)) pairs.push([a, b]);
            }
        }
        for (let [a, b] of pairs) {
            const pa = stoneXY(a), pb = stoneXY(b);
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.lineWidth = 2;
            ctx.strokeStyle = a.color === 1 ? '#000000' : '#FFFFFF';
            ctx.stroke();
        }
    }

    function computeStoneNumbers() {
        const nums = new Map();
        const key = (s) => `${s.ix},${s.iy}`;
        let n = 0;
        for (const m of moveCoords) {
            if (m.type !== 'move') continue;
            n++;
            const st = stones.find(s => s.ix === m.ix && s.iy === m.iy);
            if (st) nums.set(key(st), n);
        }
        return nums;
    }

    function drawBoard() {
        ctx.clearRect(0, 0, BOARD_SIZE_PX, BOARD_SIZE_PX);
        const diameter = getDiameter();
        const radius = getRadius();

        if (showEstimateActive && territoryImageData)
            ctx.putImageData(territoryImageData, 0, 0);

        let previewStone = null;
        if (isMyTurn() && isHoverValid) {
            const x = ixToX(hoverIx), y = iyToY(hoverIy);
            if (isPointInBoard(x, y) && !isOverlapWithStonesXY(x, y, stones, diameter, null))
                previewStone = { ix: hoverIx, iy: hoverIy, color: mySlot === 'black' ? 1 : 2 };
        }

        if (showAdjacentLinesCheckbox.checked && stones.length > 0)
            drawAdjacentLines(stones, stones, diameter);

        if (previewStone) {
            const allPrev = [...stones, previewStone];
            const pp = stoneXY(previewStone);
            for (let s of stones) {
                if (s.color === previewStone.color && areAdjacent(s, previewStone, allPrev, diameter)) {
                    const sp = stoneXY(s);
                    ctx.beginPath();
                    ctx.moveTo(sp.x, sp.y);
                    ctx.lineTo(pp.x, pp.y);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = previewStone.color === 1 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
                    ctx.stroke();
                }
            }
        }

        const numMap = showMoveNumbers ? computeStoneNumbers() : null;

        for (let s of stones) {
            const x = ixToX(s.ix), y = iyToY(s.iy);
            ctx.save();
            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowOffsetY = 2;
            const grad = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
            if (s.color === 1) {
                grad.addColorStop(0, '#444'); grad.addColorStop(0.6, '#222'); grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, '#eee'); grad.addColorStop(1, '#aaa');
            }
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.restore();
            if (!showMoveNumbers) {
                ctx.beginPath();
                ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                ctx.fillStyle = s.color === 1 ? '#444' : '#fff';
                ctx.fill();
            }
        }

        if (showLibertyStonesCheck.checked && stones.length > 0) {
            for (let s of stones) {
                if (!stoneHasLocalLiberty(s, stones, diameter)) continue;
                const x = ixToX(s.ix), y = iyToY(s.iy);
                ctx.strokeStyle = s.color === 1 ? '#ff9900' : '#0099ff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(x, y, radius + 1, 0, 2 * Math.PI);
                ctx.stroke();
            }
        }

        if (previewStone) {
            const px = ixToX(previewStone.ix), py = iyToY(previewStone.iy);
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, 2 * Math.PI);
            ctx.fillStyle = previewStone.color === 1 ? '#222' : '#ddd';
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        if (lastMoveMarkers && lastMoveMarkers.length > 0) {
            const lm = lastMoveMarkers[0];
            const x = ixToX(lm.ix), y = iyToY(lm.iy);
            const markLen = radius * 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + markLen, y);
            ctx.lineTo(x, y + markLen);
            ctx.closePath();
            ctx.fillStyle = lm.color === 1 ? '#ffffff' : '#222222';
            ctx.fill();
        }

        if (showMoveNumbers) {
            ctx.font = `bold ${Math.max(10, Math.floor(radius * 0.85))}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let s of stones) {
                const n = numMap.get(`${s.ix},${s.iy}`);
                if (!n) continue;
                const x = ixToX(s.ix), y = iyToY(s.iy);
                ctx.fillStyle = s.color === 1 ? '#fff' : '#111';
                ctx.fillText(String(n), x, y);
            }
        }

        for (const key of Object.keys(userBoardMarks)) {
            const [ixs, iys] = key.split(',').map(Number);
            const x = ixToX(ixs);
            const y = iyToY(iys);
            if (!isPointInBoard(x, y)) continue;
            if (showEstimateActive) continue;
            const ch = userBoardMarks[key];
            const fontPx = radius * (ch === '🚩' ? 1.2 : 1.32);
            ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#3a281c';
            ctx.fillText(ch, x, y + 1);
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
        const { blackPoints, whitePoints } = territoryStats;
        const lead = blackPoints - whitePoints - 2 * KOMI;
        const leadStr = (lead >= 0 ? '+' : '') + formatScore(lead);
        scoreTitle.innerText = '🏆 形势';
        scoreBoard.innerText = `黑: ${formatScore(blackPoints)}点　|　白: ${formatScore(whitePoints)}点`;
        leadInfo.innerText = `黑${leadStr}点`;
    }

    function updateTurn() {
        if (matchStartedOnce === undefined) matchStartedOnce = false;
        if (matchStarted) matchStartedOnce = true;
        const bothSelected = !!(slots && slots.black && slots.white);
        const hasStoneOnBoard = stones.length > 0 || (moveCoords && moveCoords.some(m => m.type === 'move'));
        const matchReady = !!(matchStarted || matchStartedOnce);
        if (bothSelected && matchReady) matchStartedOnce = true;
        if (numberOfHands > 1 || hasStoneOnBoard) matchStartedOnce = true;
        if (!matchStarted) {
            turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
        } else if (numberOfHands <= 1) {
            turnDisplay.innerText = '初始局面';
        } else {
            const lastStep = numberOfHands - 1;
            const lastPlayer = currentPlayer === 1 ? 2 : 1;
            turnDisplay.innerText = `${lastPlayer === 1 ? '⚫' : '⚪'} 第${lastStep}手`;
        }
        drawBoard();
        updateEstimate();
    }

    function updateReplayUI() {
        const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
        const tryPlayBtn = document.getElementById('tryPlayBtn');
        const isPlayer = !!mySlot;
        const started = !!(matchStarted || (matchTime && matchTime.settings));
        const showMatchButtons = isPlayer && started && !replayMode;
        for (const id of gameButtonIds) {
            const el = document.getElementById(id);
            if (el) el.style.display = showMatchButtons ? '' : 'none';
        }
        if (tryPlayBtn) {
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = '试下';
        }
        const rp = document.getElementById('replayPanel');
        if (rp) rp.style.display = '';
    }

    function enterReplayMode(data) {
        const diameter = getDiameter();
        let cur = [];
        replayStonesSeq = [deepCopyStones(cur)];
        replayMarkersSeq = [[]];
        replayStepPlayers = [0];
        for (const move of (data.moves || [])) {
            const playerVal = move.player === 'black' ? 1 : 2;
            replayStepPlayers.push(playerVal);
            if (move.type === 'move') {
                cur = applyMoveClient(cur, { ix: move.ix, iy: move.iy, color: playerVal }, diameter);
                replayStonesSeq.push(deepCopyStones(cur));
                replayMarkersSeq.push([{ ix: move.ix, iy: move.iy, color: playerVal }]);
            } else if (move.type === 'pass') {
                replayStonesSeq.push(deepCopyStones(cur));
                replayMarkersSeq.push([]);
            }
        }
        replayTotalSteps = Math.max(0, replayStonesSeq.length - 1);
        replayMode = true;
        const slider = document.getElementById('replaySlider');
        if (slider) slider.max = replayTotalSteps;
        setReplayStep(replayTotalSteps);
        updateReplayUI();
        updateRecordButtons();
    }

    function exitReplayMode() {
        replayMode = false;
        replayStonesSeq = [];
        replayMarkersSeq = [];
        replayStepPlayers = [];
        replayStep = 0;
        replayTotalSteps = 0;
        updateReplayUI();
    }

    function setReplayStep(step) {
        if (step < 0) step = 0;
        if (step > replayTotalSteps) step = replayTotalSteps;
        replayStep = step;
        if (!replayStonesSeq.length) return;
        stones = deepCopyStones(replayStonesSeq[step]);
        const mk = replayMarkersSeq[step];
        lastMoveMarkers = mk && mk.length ? mk.map(m => ({ ix: m.ix, iy: m.iy, color: m.color })) : [];
        const slider = document.getElementById('replaySlider');
        if (slider) slider.value = step;
        const stepDisplay = document.getElementById('replayStepDisplay');
        if (stepDisplay) stepDisplay.innerText = `${step} / ${replayTotalSteps}`;
        if (step === 0) turnDisplay.innerText = '初始局面';
        else {
            const emoji = replayStepPlayers[step] === 1 ? '⚫' : '⚪';
            turnDisplay.innerText = `${emoji} 第${step}手`;
        }
        recomputeTerritory();
        if (showEstimateActive) updateEstimate();
        else drawBoard();
    }

    function updateRadioStyles() {
        if (bindingsUpdateRadioStyles) {
            bindingsUpdateRadioStyles();
            return;
        }
        updateRecordButtons();
    }

    /** 与标准围棋 updateRecordButtons 一致；hasAnyStone 兼看棋谱手顺，避免打谱回退到空盘时误显「导入」 */
    function updateRecordButtons() {
        if (bindingsUpdateRecordButtons) {
            bindingsUpdateRecordButtons();
            return;
        }
        const importBtn = document.getElementById('importBtn');
        const exportBtn = document.getElementById('exportBtn');
        if (!importBtn || !exportBtn) return;
        if (replayMode) {
            importBtn.style.display = 'none';
            exportBtn.style.display = 'none';
            return;
        }
        const noPlayers = !slots.black && !slots.white;
        const hasStoneOnBoard = stones.length > 0;
        const hasMovesInRecord = moveCoords && moveCoords.some(m => m.type === 'move');
        const hasAnyStone = hasStoneOnBoard || hasMovesInRecord;
        if (noPlayers && !hasAnyStone) {
            importBtn.style.display = '';
            exportBtn.style.display = 'none';
        } else {
            importBtn.style.display = 'none';
            exportBtn.style.display = '';
        }
    }

    function rebuildLiveReplayFromMoveCoords(coords) {
        const diameter = getDiameter();
        let cur = [];
        liveReplayStonesSeq = [deepCopyStones(cur)];
        liveReplayMarkers = [[]];
        for (const m of coords || []) {
            const pv = m.player === 'black' ? 1 : 2;
            if (m.type === 'move') {
                cur = applyMoveClient(cur, { ix: m.ix, iy: m.iy, color: pv }, diameter);
                liveReplayStonesSeq.push(deepCopyStones(cur));
                liveReplayMarkers.push([{ ix: m.ix, iy: m.iy, color: pv }]);
            } else if (m.type === 'pass') {
                liveReplayStonesSeq.push(deepCopyStones(cur));
                liveReplayMarkers.push([]);
            }
        }
    }

    function applyLiveViewStones() {
        if (!liveReplayStonesSeq.length) {
            stones = [];
            lastMoveMarkers = [];
            return;
        }
        const i = Math.max(0, Math.min(liveViewStep, liveReplayStonesSeq.length - 1));
        stones = deepCopyStones(liveReplayStonesSeq[i]);
        const mk = liveReplayMarkers[i];
        lastMoveMarkers = mk && mk.length ? mk.map(m => ({ ix: m.ix, iy: m.iy, color: m.color })) : [];
    }

    function updateLiveReplayPanelUI() {
        const total = Math.max(0, liveReplayStonesSeq.length - 1);
        const slider = document.getElementById('replaySlider');
        slider.min = 0;
        slider.max = total;
        slider.value = liveViewStep;
        document.getElementById('replayStepDisplay').innerText = `${liveViewStep} / ${total}`;
    }

    function setLiveViewStep(step) {
        const total = Math.max(0, liveReplayStonesSeq.length - 1);
        if (step < 0) step = 0;
        if (step > total) step = total;
        liveViewStep = step;
        liveFollowLatest = step >= total;
        applyLiveViewStones();
        recomputeTerritory();
        updateLiveReplayPanelUI();
        updateRecordButtons();
        if (showEstimateActive) updateEstimate();
        else drawBoard();
    }

    function syncState(state) {
        if (state.roadCount && state.roadCount !== roadCount) {
            roadCount = state.roadCount;
            roadCountSelect.value = String(roadCount);
        }
        numberOfHands = state.numberOfHands || 1;
        currentPlayer = state.currentPlayer;
        gameOver = state.gameOver || false;
        winner = state.winner || null;
        if (state.matchStarted !== undefined) {
            matchStarted = !!state.matchStarted;
            if (matchStarted) matchStartedOnce = true;
            else if ((state.numberOfHands || 1) <= 1) matchStartedOnce = false;
        }
        if (state.moveCoords) moveCoords = state.moveCoords.map(m => ({ ...m }));
        if (state.slots) slots = state.slots;

        if (!replayMode) {
            const prevTotal = Math.max(0, liveReplayStonesSeq.length - 1);
            const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
            rebuildLiveReplayFromMoveCoords(state.moveCoords || []);
            const newTotal = Math.max(0, liveReplayStonesSeq.length - 1);
            if (newTotal === 0) { liveViewStep = 0; liveFollowLatest = true; }
            else if (wasAtEnd) { liveViewStep = newTotal; liveFollowLatest = true; }
            else { liveViewStep = Math.min(liveViewStep, newTotal); if (liveViewStep === newTotal) liveFollowLatest = true; }

            if (liveFollowLatest && state.stones) {
                stones = state.stones.map(s => ({ ix: s.ix, iy: s.iy, color: s.color }));
                lastMoveMarkers = (state.lastMoveMarkers || []).map(m => ({ ix: m.ix, iy: m.iy, color: m.color }));
            } else {
                applyLiveViewStones();
            }
            updateLiveReplayPanelUI();
        }
        /* 打谱模式：不覆盖当前步的 stones/lastMoveMarkers，避免与 setReplayStep 冲突 */

        const hasStoneOnBoard = stones.length > 0;
        const hasMovesInRecord = moveCoords && moveCoords.some(m => m.type === 'move');
        const hasAnyStone = hasStoneOnBoard || hasMovesInRecord;
        const hasPlayer = slots.black || slots.white;
        roadCountSelect.style.display = (!replayMode && !hasAnyStone && !hasPlayer && !gameOver && mySlot === null) ? 'inline-block' : 'none';

        recomputeTerritory();
        if (replayMode) {
            if (showEstimateActive) updateEstimate();
            else drawBoard();
        } else {
            if (showEstimateActive) updateEstimate();
            else updateTurn();
        }
        updateRecordButtons();
    }

    function hideScoreConfirm() {
        scoreConfirmPanel.style.display = 'none';
    }
    function showScoreConfirm(lead) {
        const abs = Math.abs(lead);
        const t = lead > 0 ? `黑胜${formatScore(abs)}点` : (lead < 0 ? `白胜${formatScore(abs)}点` : '平局');
        scoreConfirmText.innerText = `${t}，是否同意该结果？`;
        scoreConfirmPanel.style.display = 'block';
    }

    function clearEstimate() {
        showEstimateActive = false;
        territoryImageData = null;
        scoreTitle.innerText = '　';
        scoreBoard.innerText = '　';
        leadInfo.innerText = '　';
        drawBoard();
    }

    function showEstimate() {
        if (!showEstimateActive) showEstimateActive = true;
        recomputeTerritory();
        updateEstimate();
    }

    function downloadRecord(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const d = new Date();
        a.download = `无格线围棋_${data.roadCount}路_${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
        roomId,
        gameType,
        pageState: {
            get matchTime() { return matchTime; },
            set matchTime(v) { matchTime = v; },
            get matchStarted() { return matchStarted; },
            set matchStarted(v) { matchStarted = !!v; },
            get matchStartedOnce() { return matchStartedOnce; },
            set matchStartedOnce(v) { matchStartedOnce = !!v; },
            get numberOfHands() { return numberOfHands; },
            set numberOfHands(v) { numberOfHands = v; },
            get currentPlayer() { return currentPlayer; },
            set currentPlayer(v) { currentPlayer = v; },
            get mySlot() { return mySlot; },
            set mySlot(v) { mySlot = v; },
            get gameOver() { return gameOver; },
            set gameOver(v) { gameOver = !!v; },
            get winner() { return winner; },
            set winner(v) { winner = v; },
            get lastMoveMarkers() { return lastMoveMarkers; },
            set lastMoveMarkers(v) { lastMoveMarkers = v || []; },
            get showEstimateActive() { return showEstimateActive; },
            set showEstimateActive(v) { showEstimateActive = !!v; },
            get waitingScoreConfirm() { return waitingScoreConfirm; },
            set waitingScoreConfirm(v) { waitingScoreConfirm = !!v; },
            get iRejected() { return iRejected; },
            set iRejected(v) { iRejected = !!v; },
            get slots() { return slots; },
            set slots(v) { slots = v || { black: false, white: false }; },
            get ws() { return ws; },
            set ws(v) { ws = v; },
            get replayMode() { return replayMode; },
            set replayMode(v) { replayMode = !!v; }
        },
        drawBoard,
        exitTryPlay: () => {},
        enterTryPlay: () => {},
        setTryPlayStep: () => {},
        setReplayStep,
        setLiveViewStep,
        getWs: () => ws,
        getBoardSize: () => roadCount,
        setBoardSize: (n) => { roadCount = n; roadCountSelect.value = String(n); },
        getKomi: () => KOMI,
        setKomi: () => {},
        getBoard: () => [],
        setBoard: () => {},
        getSlots: () => slots,
        setSlots: (s) => { slots = s; },
        getMySlot: () => mySlot,
        setMySlot: (s) => { mySlot = s; },
        getGameOver: () => gameOver,
        setGameOver: (v) => { gameOver = !!v; },
        getWinner: () => winner,
        setWinner: (w) => { winner = w; },
        getReplayMode: () => replayMode,
        getShowEstimateActive: () => showEstimateActive,
        setShowEstimateActive: (v) => { showEstimateActive = !!v; },
        getWaitingScoreConfirm: () => waitingScoreConfirm,
        setWaitingScoreConfirm: (v) => { waitingScoreConfirm = !!v; },
        getIRejected: () => iRejected,
        setIRejected: (v) => { iRejected = !!v; },
        colorStatus,
        scoreTitle,
        turnDisplay,
syncState,
        updateBoardGeometry: () => {},
        initBoardArray: () => [],
        exitReplayMode,
        clearEstimate,
        hideScoreConfirm,
        showEstimate,
        clearMobileMovePreview: () => {},
        downloadRecord,
        enterReplayMode,
        updateTurn,
        showScoreConfirm,
        isMouseDevice: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
        standardWeiqiMatchTime,
            boardSeatOverlay: true,
        timeControlMainByoScale: 1.5
    });
    const bindingsHandleMessage = _weiqiBindings.handleMessage;
    bindingsUpdateRadioStyles = _weiqiBindings.updateRadioStyles;
    bindingsUpdateRecordButtons = _weiqiBindings.updateRecordButtons;

        function connectWebSocket() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/qi/ws?game=${gameType}&room=${roomId}`;
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', password: roomPassword, requestedSlot: null }));
        };
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'roadCountChanged') {
                if (msg.roadCount) {
                    roadCount = msg.roadCount;
                    roadCountSelect.value = String(roadCount);
                    rebuildLiveReplayFromMoveCoords(moveCoords);
                    setLiveViewStep(liveViewStep);
                }
                return;
            }
            bindingsHandleMessage(msg);
            if (msg.type === 'importSuccess') qiAlert('棋谱已导入');
        };
        ws.onclose = (event) => {
            if (event.code === 1008 && String(event.reason || '').includes('房间')) {
                qiAlert('房间不存在');
                window.location.href = '/qi';
                return;
            }
            colorStatus.innerText = '连接断开，重连中...';
            reconnectTimer = setTimeout(connectWebSocket, 2000);
        };
    }

    function canvasCoordsFromClient(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scale = BOARD_SIZE_PX / rect.width;
        return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
    }

    function commitMoveFromCanvas(x, y) {
        if (replayMode || !isMyTurn() || gameOver) return;
        const ix = toIx(x), iy = toIy(y);
        const px = ixToX(ix), py = iyToY(iy);
        if (!isPointInBoard(px, py)) return;
        if (isOverlapWithStonesXY(px, py, stones, getDiameter(), null)) return;
        ws.send(JSON.stringify({ type: 'move', ix, iy }));
    }

    function getSelectedBoardMark() {
        if (!boardMarkSelect) return { clear: false, ch: '?' };
        const v = boardMarkSelect.value;
        if (v === '') return { clear: true, ch: '' };
        return { clear: false, ch: v };
    }

    function applyUserBoardMarkAt(ix, iy) {
        const x = ixToX(ix), y = iyToY(iy);
        if (!isPointInBoard(x, y)) return;
        const { clear, ch } = getSelectedBoardMark();
        const key = `${ix},${iy}`;
        const existing = userBoardMarks[key];
        if (clear) {
            if (existing !== undefined) { delete userBoardMarks[key]; drawBoard(); }
            return;
        }
        if (existing === undefined) userBoardMarks[key] = ch;
        else if (existing !== ch) userBoardMarks[key] = ch;
        else delete userBoardMarks[key];
        drawBoard();
    }

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        applyUserBoardMarkAt(toIx(x), toIy(y));
    });

    canvas.addEventListener('mousemove', (e) => {
        const canHover = !waitingScoreConfirm && !replayMode && !gameOver && isMyTurn();
        if (!canHover) {
            if (isHoverValid || hoverIx >= 0 || hoverIy >= 0) {
                isHoverValid = false;
                hoverIx = -1;
                hoverIy = -1;
                drawBoard();
                updateEstimate();
            }
            return;
        }
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        hoverIx = toIx(x);
        hoverIy = toIy(y);
        isHoverValid = true;
        drawBoard();
        updateEstimate();
    });
    canvas.addEventListener('mouseleave', () => {
        isHoverValid = false;
        hoverIx = -1;
        hoverIy = -1;
        drawBoard();
    });
    canvas.addEventListener('click', (e) => {
        if (waitingScoreConfirm) return;
        const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
        commitMoveFromCanvas(x, y);
    });

    let longMarkTimer = null;
    let longMarkStart = null;
    let touchMarkLongFired = false;
    const LONG_MARK_MS = 500;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        touchMarkLongFired = false;
        longMarkStart = { x: t.clientX, y: t.clientY };
        longMarkTimer = setTimeout(() => {
            longMarkTimer = null;
            touchMarkLongFired = true;
            if (longMarkStart) {
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                applyUserBoardMarkAt(toIx(x), toIy(y));
            }
        }, LONG_MARK_MS);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
        if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - longMarkStart.x;
        const dy = t.clientY - longMarkStart.y;
        if (dx * dx + dy * dy > 14 * 14) {
            clearTimeout(longMarkTimer);
            longMarkTimer = null;
        }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
        if (longMarkTimer) {
            clearTimeout(longMarkTimer);
            longMarkTimer = null;
            if (!touchMarkLongFired && e.changedTouches.length === 1 && !waitingScoreConfirm) {
                const t = e.changedTouches[0];
                const { x, y } = canvasCoordsFromClient(t.clientX, t.clientY);
                commitMoveFromCanvas(x, y);
            }
        }
        longMarkStart = null;
    });
    canvas.addEventListener('touchcancel', () => {
        if (longMarkTimer) clearTimeout(longMarkTimer);
        longMarkTimer = null;
        longMarkStart = null;
    });

    document.getElementById('newGameBtn').onclick = () => {
        if (replayMode) {
            ws.send(JSON.stringify({ type: 'resetRoom' }));
            return;
        }
        if (!mySlot) { qiAlert('只有对局者可以开始新局'); return; }
        const opp = mySlot === 'black' ? 'white' : 'black';
        if (slots[opp]) {
            qiConfirm('确定向对方申请开始新局吗？').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'requestNewGame' })); });
        } else {
            qiConfirm('确定开始新局吗？').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'requestNewGame' })); });
        }
    };
    document.getElementById('estimateBtn').onclick = () => {
        showEstimateActive = !showEstimateActive;
        if (showEstimateActive) recomputeTerritory();
        else { territoryImageData = null; scoreTitle.innerText = '　'; scoreBoard.innerText = '　'; leadInfo.innerText = '　'; }
        drawBoard();
        updateEstimate();
    };
    document.getElementById('passBtn').onclick = () => {
        if (!isMyTurn()) return;
        ws.send(JSON.stringify({ type: 'pass' }));
    };
    document.getElementById('undoBtn').onclick = () => {
        if (!mySlot) { qiAlert('只有对局者可以悔棋'); return; }
        const opp = mySlot === 'black' ? 'white' : 'black';
        if (slots[opp]) {
            qiConfirm('确定向对方申请悔棋吗？').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'requestUndo' })); });
        } else {
            qiConfirm('确定悔棋吗？').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'requestUndo' })); });
        }
    };
    document.getElementById('resignBtn').onclick = () => {
        if (!mySlot) return;
        qiConfirm('确定认输吗？').then(ok => { if (ok) ws.send(JSON.stringify({ type: 'resign' })); });
    };
    document.getElementById('drawBtn').onclick = () => {
        if (!mySlot) return;
        ws.send(JSON.stringify({ type: 'requestDraw' }));
    };
    document.getElementById('endReqBtn').onclick = () => {
        if (!mySlot) return;
        ws.send(JSON.stringify({ type: 'requestEnd' }));
    };
    document.getElementById('exportBtn').onclick = () => ws.send(JSON.stringify({ type: 'exportRecord' }));
    document.getElementById('importBtn').onclick = () => document.getElementById('importFileInput').click();
    document.getElementById('importFileInput').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                ws.send(JSON.stringify({ type: 'importRecord', data }));
            } catch (err) { qiAlert('棋谱文件解析失败'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
    roadCountSelect.addEventListener('change', (e) => {
        const n = parseInt(e.target.value, 10);
        if (ws && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'setRoadCount', size: n }));
    });
    showNumbersCheck.onchange = (e) => { showMoveNumbers = e.target.checked; drawBoard(); };
    showLibertyStonesCheck.onchange = () => drawBoard();
    showAdjacentLinesCheckbox.addEventListener('change', () => drawBoard());
    document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };
    document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
    document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };

    scoreConfirmYes.onclick = () => {
        ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
        hideScoreConfirm();
    };
    scoreConfirmNo.onclick = () => {
        iRejected = true;
        ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
        hideScoreConfirm();
        waitingScoreConfirm = false;
        if (showEstimateActive) {
            showEstimateActive = false;
            territoryImageData = null;
            drawBoard();
        }
    };

    document.getElementById('replayBackBtn').onclick = () => {
        if (replayMode) setReplayStep(replayStep - 1);
        else setLiveViewStep(liveViewStep - 1);
    };
    document.getElementById('replayForwardBtn').onclick = () => {
        if (replayMode) setReplayStep(replayStep + 1);
        else setLiveViewStep(liveViewStep + 1);
    };
    document.getElementById('replaySlider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (replayMode) setReplayStep(val);
        else setLiveViewStep(val);
    });

    updateReplayUI();
    connectWebSocket();
})();
        })();
    }
};
