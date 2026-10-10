window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["triangle-reversi"] = {
    shell: {
        "title": "三角黑白棋",
        "rulesHtml": "基本规则同黑白棋。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 6,
        "boardSizeMax": 10,
        "defaultBoardSize": 6,
        "minLib": 1,
        "recordDownloadPrefix": "三角黑白棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "woodTexture": false,
            "editBoard": true,
            "customTimeControl": true,
            "transparentCanvas": true
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
        "boardSizeStep": 1,
        "boardSizeValues": [
            6,
            7,
            8,
            9,
            10
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "三角黑白棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
(function () {
            const ps = {
                BOARD_SIZE: 6,          // 路数（6–10）
                ROWS: 11,                // 行数 = 2×路数-1
                PADDING: 45,
                CELL_SIZE: 56,
                board: [],
                blackCount: 0,
                whiteCount: 0,
                passNotice: null,
                openingBoard: null,
                numberOfHands: 1,
                currentPlayer: 1,
                mySlot: null,
                gameOver: false,
                winner: null,
                lastMoveMarkers: [],
                slots: { player1: false, player2: false },
                ws: null,
                reconnectTimer: null,
                moveLog: [],
                showMoveNumbers: false,
                replayMode: false,
                replayBoards: [],
                replayMarkers: [],
                replayStepPlayers: [],
                replayScores: [],
                replayCurrentPlayers: [],
                replayGameOvers: [],
                replayWinners: [],
                replayStep: 0,
                replayTotalSteps: 0,
                tryPlayMode: false,
                tryPlayFromLive: false,
                tryPlayBaseStep: 0,
                tryPlayBoards: [],
                tryPlayMarkers: [],
                tryPlayStepPlayers: [],
                tryPlayScores: [],
                tryPlayCurrentPlayers: [],
                tryPlayGameOvers: [],
                tryPlayWinners: [],
                tryPlayStep: 0,
                tryPlayTotalSteps: 0,
                tryPlayBranchMoves: [],
                hoverRow: -1,
                hoverCol: -1,
                isHoverValid: false,
                matchStarted: false,
                matchTime: null,
                matchStartedOnce: false
            };

const canvas = document.getElementById('goBoard');
            const ctx = canvas.getContext('2d');
            const turnDisplay = document.getElementById('turnDisplay');
            const scoreBoard = document.getElementById('scoreBoard');
            const leadInfo = document.getElementById('leadInfo');
            const scoreTitle = document.getElementById('scoreTitle');
            const colorStatus = document.getElementById('colorStatus');
            const komiInfo = document.getElementById('komiInfo');
            // 黑白棋不需要这一行文字：整行隐藏（子数在右侧计分显示）
            if (komiInfo) {
                komiInfo.hidden = true;
                komiInfo.style.display = 'none';
            }
const boardSizeSelect = document.getElementById('boardSizeSelect');
            const showNumbersCheck = document.getElementById('showNumbersCheck');

            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            const SIZE_MIN = 6;
            const SIZE_MAX = 10;
            /** 六角盘：路数 n → 行数 2n-1；第 r 行格数 n + min(r, 2n-2-r) */
            const rowsOf = (n) => n * 2 - 1;
            const rowLenOf = (n, r) => n + Math.min(r, 2 * n - 2 - r);
            function rowLen(r) { return rowLenOf(ps.BOARD_SIZE, r); }
            function isValidCoord(r, c) {
                return r >= 0 && r < ps.ROWS && c >= 0 && c < rowLen(r);
            }

            /* ---- 固定外框（参考 27 行算出来，不随路数变；内部网格按路数缩放）---- */
            const BASE_WIDTH = 500;
            const CENTER_X_REF = 300;
            const ROWS_REF = 27;
            function hexCornersFromParams(rows, dx, dy, topY, centerX) {
                const R = (rows - 1) / 2;
                const L = (r) => R + 1 + Math.min(r, 2 * R - r);
                const xOf = (r, c) => centerX + (c - (L(r) - 1) / 2) * dx;
                const yOf = (r) => topY + r * dy;
                return [
                    { x: xOf(0, 0), y: yOf(0) },
                    { x: xOf(R, 0), y: yOf(R) },
                    { x: xOf(2 * R, 0), y: yOf(2 * R) },
                    { x: xOf(2 * R, L(2 * R) - 1), y: yOf(2 * R) },
                    { x: xOf(R, L(R) - 1), y: yOf(R) },
                    { x: xOf(0, L(0) - 1), y: yOf(0) }
                ];
            }
            function outwardExpandHexagon(verts, margin) {
                const cx = verts.reduce((s, p) => s + p.x, 0) / verts.length;
                const cy = verts.reduce((s, p) => s + p.y, 0) / verts.length;
                return verts.map((P) => {
                    const vx = P.x - cx, vy = P.y - cy;
                    const len = Math.hypot(vx, vy);
                    return { x: P.x + (vx / len) * margin, y: P.y + (vy / len) * margin };
                });
            }
            const dxRefHex = BASE_WIDTH / (ROWS_REF - 1);
            const dyRefHex = (Math.sqrt(3) / 2) * dxRefHex;
            const topYRefHex = (600 - dyRefHex * (ROWS_REF - 1)) / 2;
            const refHex = hexCornersFromParams(ROWS_REF, dxRefHex, dyRefHex, topYRefHex, CENTER_X_REF);
            const FIXED_OUTER_HEX = outwardExpandHexagon(refHex, 22);
            const HEX_CENTROID = {
                x: FIXED_OUTER_HEX.reduce((s, p) => s + p.x, 0) / FIXED_OUTER_HEX.length,
                y: FIXED_OUTER_HEX.reduce((s, p) => s + p.y, 0) / FIXED_OUTER_HEX.length
            };
            const k27Hex = Math.hypot(refHex[0].x - HEX_CENTROID.x, refHex[0].y - HEX_CENTROID.y)
                / Math.hypot(FIXED_OUTER_HEX[0].x - HEX_CENTROID.x, FIXED_OUTER_HEX[0].y - HEX_CENTROID.y);

            /** 重新按路数算几何：CELL_SIZE 就是格距 DX，DY 是行距（√3/2·DX） */
            function updateGeometry() {
                ps.ROWS = rowsOf(ps.BOARD_SIZE);
                if (ps.ROWS < 3) return;
                ps.PADDING = 24.6 - 0.1 * ps.ROWS;
                let factor = k27Hex * (22 / ps.PADDING);
                if (factor > 1) factor = 1;
                const G = HEX_CENTROID;
                const innerFromOuter = (O) => ({ x: G.x + factor * (O.x - G.x), y: G.y + factor * (O.y - G.y) });
                const innerVerts = FIXED_OUTER_HEX.map(innerFromOuter);
                const R = (ps.ROWS - 1) / 2;
                ps.CELL_SIZE = (innerVerts[5].x - innerVerts[0].x) / R;
                ps.DY = (innerVerts[1].y - innerVerts[0].y) / R;
                ps.TOP_Y = innerVerts[0].y;
                ps.CENTER_X = (innerVerts[0].x + innerVerts[5].x) / 2;
            }

            /* ===== 三角黑白棋规则工具（与服务器 games/triangle-reversi.js 保持同一套实现）===== */
            /** 六角盘 6 个方向：把点写成加倍坐标 X = 2c-(rowLen(r)-1)、y = r 后就是常量向量（= 3 条轴） */
            const HEX_DIRS = [
                [2, 0], [-2, 0],
                [1, 1], [-1, 1],
                [1, -1], [-1, -1]
            ];
            /** 加倍坐标 → (r,c)；出界或不对齐返回 null */
            function fromDoubled(n, X, y) {
                if (y < 0 || y >= rowsOf(n)) return null;
                const len = rowLenOf(n, y);
                const c = (X + len - 1) / 2;
                if (!Number.isInteger(c) || c < 0 || c >= len) return null;
                return [y, c];
            }

            /** 在 (row,col) 落子能翻转的对方子坐标 */
            function reversiFlipsOn(board, n, row, col, val) {
                const flips = [];
                if (!Number.isInteger(row) || !Number.isInteger(col)) return flips;
                if (!isValidCoord(row, col)) return flips;
                if (board[row][col] !== 0) return flips;
                const opp = val === 1 ? 2 : 1;
                const X0 = 2 * col - (rowLen(row) - 1);
                for (const [dX, dy] of HEX_DIRS) {
                    const line = [];
                    let X = X0 + dX;
                    let y = row + dy;
                    let cur = fromDoubled(n, X, y);
                    while (cur && board[cur[0]][cur[1]] === opp) {
                        line.push(cur);
                        X += dX;
                        y += dy;
                        cur = fromDoubled(n, X, y);
                    }
                    if (line.length && cur && board[cur[0]][cur[1]] === val) {
                        for (const cell of line) flips.push(cell);
                    }
                }
                return flips;
            }

            /** 就地落子并翻转，返回被翻的子 */
            function reversiApplyOn(board, n, row, col, val) {
                const flips = reversiFlipsOn(board, n, row, col, val);
                if (flips.length === 0) return flips;
                board[row][col] = val;
                for (const [r, c] of flips) board[r][c] = val;
                return flips;
            }

            function reversiHasMoveOn(board, n, val) {
                for (let r = 0; r < rowsOf(n); r++) {
                    for (let c = 0; c < rowLenOf(n, r); c++) {
                        if (board[r][c] === 0 && reversiFlipsOn(board, n, r, c, val).length > 0) return true;
                    }
                }
                return false;
            }

            function reversiCountOn(board, n) {
                let black = 0;
                let white = 0;
                for (let r = 0; r < rowsOf(n); r++) {
                    for (let c = 0; c < rowLenOf(n, r); c++) {
                        if (board[r][c] === 1) black++;
                        else if (board[r][c] === 2) white++;
                    }
                }
                return { black, white };
            }

            /** 开局座子：天元周围六个点，左上/左下/右 = 白；右上/右下/左 = 黑（r 越大越靠上） */
            function initialBoard(n) {
                const board = Array.from({ length: rowsOf(n) }, (_, r) => Array(rowLenOf(n, r)).fill(0));
                const r = n - 1;
                const c = n - 1;
                board[r + 1][c - 1] = 2;   // 左上
                board[r - 1][c - 1] = 2;   // 左下
                board[r][c + 1] = 2;       // 右
                board[r + 1][c] = 1;       // 右上
                board[r - 1][c] = 1;       // 右下
                board[r][c - 1] = 1;       // 左
                return board;
            }

            function initBoardArrays() {
                ps.board = initialBoard(ps.BOARD_SIZE);
                const counts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = counts.black;
                ps.whiteCount = counts.white;
            }

            /** 本棋种不显示 komiInfo 行，此处保留空实现以免各处调用失效 */
            function updateKomiText() { /* 不显示 */ }

            /** 格心坐标（六角）：row 0 在屏幕下方（y 随 r 反向），每行按该行实际格数水平居中 */
            function boardCenterOfCell(row, col) {
                const y = ps.TOP_Y + (ps.ROWS - 1 - row) * ps.DY;
                const leftX = ps.CENTER_X - ((rowLen(row) - 1) / 2) * ps.CELL_SIZE;
                return { x: leftX + col * ps.CELL_SIZE, y };
            }

            /** 六方向邻接（与服务端 _neighbors 同规则） */
            function hexNeighbors(r, c) {
                const out = [];
                const push = (nr, nc) => { if (isValidCoord(nr, nc)) out.push([nr, nc]); };
                push(r, c - 1);
                push(r, c + 1);
                if (r > 0) {
                    if (rowLen(r - 1) > rowLen(r)) { push(r - 1, c); push(r - 1, c + 1); }
                    else { push(r - 1, c - 1); push(r - 1, c); }
                }
                if (r < ps.ROWS - 1) {
                    if (rowLen(r + 1) > rowLen(r)) { push(r + 1, c); push(r + 1, c + 1); }
                    else { push(r + 1, c - 1); push(r + 1, c); }
                }
                return out;
            }

            /** 点在多边形内判定（ray casting） */
            function pointInPolygon(px, py, verts) {
                let inside = false;
                for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
                    const xi = verts[i].x, yi = verts[i].y;
                    const xj = verts[j].x, yj = verts[j].y;
                    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                        inside = !inside;
                    }
                }
                return inside;
            }

            /** 圆角多边形（与三角围棋的木框同一套画法） */
            function drawRoundedPolygonLocal(vertices, radius, skipStroke) {
                const n = vertices.length;
                if (n < 3) return;
                const startPoints = [], endPoints = [];
                for (let i = 0; i < n; i++) {
                    const curr = vertices[i];
                    const prev = vertices[(i - 1 + n) % n];
                    const next = vertices[(i + 1) % n];
                    const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                    const len1 = Math.hypot(v1.x, v1.y);
                    const len2 = Math.hypot(v2.x, v2.y);
                    const dx1 = v1.x / len1, dy1 = v1.y / len1;
                    const dx2 = v2.x / len2, dy2 = v2.y / len2;
                    startPoints.push({ x: curr.x + dx1 * radius, y: curr.y + dy1 * radius });
                    endPoints.push({ x: curr.x + dx2 * radius, y: curr.y + dy2 * radius });
                }
                ctx.beginPath();
                ctx.moveTo(endPoints[n - 1].x, endPoints[n - 1].y);
                for (let i = 0; i < n; i++) {
                    ctx.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                }
                ctx.closePath();
                ctx.fill();
                if (!skipStroke) ctx.stroke();
            }

            function getClosestCell(x, y) {
                // 六角外框之外的点击不作数，避免吸附到邻近格点
                if (!pointInPolygon(x, y, FIXED_OUTER_HEX)) return { row: -1, col: -1 };
                let best = { row: -1, col: -1, dist: Infinity };
                for (let r = 0; r < ps.ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        const p = boardCenterOfCell(r, c);
                        const d = Math.hypot(x - p.x, y - p.y);
                        if (d < best.dist) best = { row: r, col: c, dist: d };
                    }
                }
                return { row: best.row, col: best.col };
            }

            function computeStoneNumbers() {
                const nums = Array.from({ length: ps.ROWS }, (_, r) => Array(rowLen(r)).fill(0));
                const put = (row, col, n) => {
                    if (!isValidCoord(row, col)) return;
                    if (ps.board[row][col] === 0) return;
                    nums[row][col] = n;
                };
                // 与公共实现（room.js computeStoneNumbers）一致：试下/打谱各自用本分支的标记编号，
                // 否则试下时会去读对局的 moveLog，分支上的棋子拿不到序号（甚至串号）。
                if (ps.tryPlayMode) {
                    for (let i = 1; i <= ps.tryPlayStep; i++) {
                        const markers = ps.tryPlayMarkers[i];
                        if (markers && markers.length > 0) put(markers[0].row, markers[0].col, i);
                    }
                } else if (ps.replayMode) {
                    for (let i = 1; i <= ps.replayStep; i++) {
                        const markers = ps.replayMarkers[i];
                        if (markers && markers.length > 0) put(markers[0].row, markers[0].col, i);
                    }
                } else {
                    // 服务器只在对局记录里存真正的落子（过手不记），因此按落子序计数即可
                    let n = 0;
                    for (const m of ps.moveLog) {
                        if (!m || m.type !== 'move') continue;
                        n++;
                        put(m.row, m.col, n);
                    }
                }
                return nums;
            }

            function canPlayAt(row, col) {
                if (!isValidCoord(row, col)) return false;
                if (ps.tryPlayMode) return false;
                if (ps.replayMode) return false;
                if (ps.gameOver || !isMyTurn()) return false;
                if (ps.board[row][col] !== 0) return false;
                const me = ps.mySlot === 'player1' ? 1 : 2;
                if (!(me > 0)) return false;
                return reversiFlipsOn(ps.board, ps.BOARD_SIZE, row, col, me).length > 0;
            }

            function drawBoard() {
                // 六角木质外框（与三角围棋六角盘同一套外框，本棋种不铺公共木纹）
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = (typeof QiSquareWeiqiCanvas !== 'undefined' && QiSquareWeiqiCanvas.getWoodFill)
                    ? (QiSquareWeiqiCanvas.getWoodFill(ctx, canvas) || '#fdcc90')
                    : '#fdcc90';
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 0.5;
                drawRoundedPolygonLocal(FIXED_OUTER_HEX, 3, false);
                ctx.restore();

                // 格线：每条边只画一次（同行右邻 + 行号更大的邻居）
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = '#3a281c';
                for (let r = 0; r < ps.ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        const start = boardCenterOfCell(r, c);
                        if (c + 1 < rowLen(r)) {
                            const end = boardCenterOfCell(r, c + 1);
                            ctx.beginPath();
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                            ctx.stroke();
                        }
                        for (const [nr, nc] of hexNeighbors(r, c)) {
                            if (nr > r) {
                                const end = boardCenterOfCell(nr, nc);
                                ctx.beginPath();
                                ctx.moveTo(start.x, start.y);
                                ctx.lineTo(end.x, end.y);
                                ctx.stroke();
                            }
                        }
                    }
                }

                // 星位（天元）
                {
                    const mid = (ps.ROWS - 1) / 2;
                    const p = boardCenterOfCell(mid, mid);
                    ctx.fillStyle = '#3a281c';
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, Math.max(3, 10.1 - 0.3 * ps.ROWS), 0, 2 * Math.PI);
                    ctx.fill();
                }

                // 坐标：上边字母、左上数字、左下希腊字母（标签位置固定，取值按行反序）
                const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                const GREEK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
                const labelOff = 17.4 - 0.2 * ps.ROWS;
                const labelDy = ps.DY * 0.35;
                const RH = (ps.ROWS - 1) / 2;
                ctx.font = `bold ${Math.max(9, 16.4 - 0.2 * ps.ROWS)}px Arial`;
                ctx.fillStyle = '#3a281c';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const labelY = (rr) => ps.TOP_Y + rr * ps.DY;
                for (let c = 0; c < rowLen(0); c++) {
                    const p = boardCenterOfCell(0, c);
                    ctx.fillText(LETTERS[c] || String(c + 1), p.x + labelOff * 0.5, labelY(0) - 0.7 * labelOff);
                }
                for (let r = 0; r <= RH; r++) {
                    const x = boardCenterOfCell(r, 0).x - labelOff * 0.6;
                    ctx.fillText(String(RH + 1 - r), x, labelY(r) - labelDy);
                }
                for (let r = RH; r < ps.ROWS; r++) {
                    const x = boardCenterOfCell(r, 0).x - labelOff * 0.6;
                    ctx.fillText(GREEK[ps.ROWS - 1 - r] || String(ps.ROWS - r), x, labelY(r) + labelDy);
                }

                const stoneRadius = ps.CELL_SIZE * 0.42;
                // 最后落子标记（与围棋同一套口径）：平时是从棋子中心往右上画的小三角、在棋子里面；
                // 只有显示手数时才画到棋子外（右下角），而且要画在棋子底下，免得压住序号。
                const markLen = ps.CELL_SIZE * 0.352;

                if (ps.showMoveNumbers) {
                    for (const marker of ps.lastMoveMarkers) {
                        const p = boardCenterOfCell(marker.row, marker.col);
                        ctx.beginPath();
                        ctx.moveTo(p.x + stoneRadius, p.y + stoneRadius);
                        ctx.lineTo(p.x, p.y + stoneRadius);
                        ctx.lineTo(p.x + stoneRadius, p.y);
                        ctx.closePath();
                        ctx.fillStyle = marker.color === 1 ? '#fff' : '#222';
                        ctx.fill();
                    }
                }

                for (let r = 0; r < ps.ROWS; r++) {
                    for (let c2 = 0; c2 < rowLen(r); c2++) {
                        const v = ps.board[r][c2];
                        if (v === 0) continue;
                        const p = boardCenterOfCell(r, c2);
                        const grad = ctx.createRadialGradient(p.x - 3, p.y - 3, stoneRadius * 0.2, p.x, p.y, stoneRadius * 1.2);
                        if (v === 1) {
                            grad.addColorStop(0, '#444');
                            grad.addColorStop(0.6, '#222');
                            grad.addColorStop(1, '#111');
                        } else {
                            grad.addColorStop(0, '#fff');
                            grad.addColorStop(0.5, '#eee');
                            grad.addColorStop(1, '#aaa');
                        }
                        ctx.save();
                        ctx.shadowBlur = 6;
                        ctx.shadowColor = 'rgba(0,0,0,0.5)';
                        ctx.shadowOffsetY = 2;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, stoneRadius, 0, Math.PI * 2);
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.restore();
                    }
                }

                if (!ps.showMoveNumbers) {
                    for (const marker of ps.lastMoveMarkers) {
                        const p = boardCenterOfCell(marker.row, marker.col);
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p.x + markLen, p.y);
                        ctx.lineTo(p.x, p.y + markLen);
                        ctx.closePath();
                        ctx.fillStyle = marker.color === 1 ? '#fff' : '#222';
                        ctx.fill();
                    }
                }

                if (ps.showMoveNumbers) {
                    const nums = computeStoneNumbers();
                    for (let r = 0; r < ps.ROWS; r++) {
                        for (let c2 = 0; c2 < rowLen(r); c2++) {
                            if (nums[r][c2] <= 0 || ps.board[r][c2] === 0) continue;
                            const p = boardCenterOfCell(r, c2);
                            const num = String(nums[r][c2]);
                            const fontSize = Math.max(9, Math.floor(ps.CELL_SIZE * (num.length >= 3 ? 0.308 : 0.396)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = ps.board[r][c2] === 1 ? '#fff' : '#000';
                            ctx.fillText(num, p.x, p.y + 1);
                        }
                    }
                }

                // 可落点提示：与其它棋类一致的小方块，按行棋方着色（黑方黑块、白方白块）
                {
                    // 试下/对局都以 currentPlayer 为准（试下每步会同步该字段）
                    const sideVal = ps.currentPlayer | 0;
                    const engaged = !!(ps.matchStarted || ps.matchStartedOnce
                        || (ps.matchTime && ps.matchTime.settings) || (ps.moveLog && ps.moveLog.length)
                        || ps.tryPlayMode);
                    // 注意：本棋种进入试下时会借用 replay 脚手架，故试下不算「回放」
                    if ((!ps.replayMode || ps.tryPlayMode) && !ps.gameOver && engaged && (sideVal === 1 || sideVal === 2)) {
                        const half = ps.CELL_SIZE * 0.12;
                        for (let r = 0; r < ps.ROWS; r++) {
                            for (let c2 = 0; c2 < rowLen(r); c2++) {
                                if (ps.board[r][c2] !== 0) continue;
                                if (!reversiFlipsOn(ps.board, ps.BOARD_SIZE, r, c2, sideVal).length) continue;
                                const p = boardCenterOfCell(r, c2);
                                ctx.fillStyle = sideVal === 1 ? '#111111' : '#ffffff';
                                ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
                            }
                        }
                    }
                }

                if (!ps.gameOver && ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    let hoverColor = null;
                    if (ps.editModeEnabled) {
                        // 编辑悬停预览：按当前工具着色（空 = 无预览）
                        const t = ps.editTool || 'empty';
                        if (t === 'white') hoverColor = '#fff';
                        else if (t === 'black') hoverColor = '#222';
                        else if (t !== 'empty') hoverColor = '#666';
                    } else if (ps.tryPlayMode) {
                        hoverColor = ps.currentPlayer === 1 ? '#222' : '#fff';
                    } else if (isMyTurn() && canPlayAt(ps.hoverRow, ps.hoverCol)) {
                        hoverColor = ps.mySlot === 'player1' ? '#222' : '#fff';
                    }
                    if (hoverColor) {
                        const p = boardCenterOfCell(ps.hoverRow, ps.hoverCol);
                        ctx.save();
                        ctx.globalAlpha = 0.42;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, stoneRadius, 0, Math.PI * 2);
                        ctx.fillStyle = hoverColor;
                        ctx.fill();
                        ctx.restore();
                    }
                }
            }

            function updateScoreBoard() {
                const counts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = counts.black;
                ps.whiteCount = counts.white;
                scoreBoard.textContent = `黑: ${counts.black}　白: ${counts.white}`;
                updateKomiText();
                leadInfo.textContent = '　'
            }

            function updateTurn() {
                updateActionButtons();
                if (ps.tryPlayMode) {
                    const stepDisplay = document.getElementById('replayStepDisplay');
                    stepDisplay.textContent = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                    const emoji = ps.currentPlayer === 1 ? '⚫' : '⚪';
                    turnDisplay.textContent = `${emoji} 试下`;
                    return;
                }
                if (ps.replayMode) {
                    if (ps.replayStep <= 0) {
                        turnDisplay.textContent = '打谱：初始局面';
                    } else {
                        const playerVal = ps.replayStepPlayers[ps.replayStep] || 0;
                        const emoji = playerVal === 1 ? '⚫' : '⚪';
                        turnDisplay.textContent = `打谱：${emoji}第${ps.replayStep}手`;
                    }
                    return;
                }
                if (ps.gameOver) {
                    turnDisplay.textContent = '对局结束';
                    return;
                }
                const hasStarted = !!(ps.matchStarted || ps.matchStartedOnce);
                if (!hasStarted) {
                    turnDisplay.textContent = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                    if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
                    return;
                }
                const n = ps.moveLog.length;
                if (n === 0) {
                    turnDisplay.textContent = '初始局面';
                } else {
                    turnDisplay.textContent = `第${n}手`;
                }
                if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.updateTimerPanel();
            }

            function updateActionButtons() {
                const showMatchButtons = !!ps.mySlot
                    && !!(ps.matchStarted || ps.matchStartedOnce || (ps.matchTime && ps.matchTime.settings))
                    && !ps.replayMode;
                ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = showMatchButtons ? '' : 'none';
                });
                const tryPlayBtn = document.getElementById('tryPlayBtn');
                if (tryPlayBtn) {
                    tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
                    tryPlayBtn.textContent = ps.tryPlayMode ? '试下结束' : '试下';
                }
            }

            function updateReplayUI() {
                if (ps.tryPlayMode) return;
                const n = ps.BOARD_SIZE;
                // 黑白棋开局即有子：回放起点必须是开局局面，不能是空盘
                const baseBoard = (ps.openingBoard && ps.openingBoard.length === ps.ROWS)
                    ? ps.openingBoard.map((row) => row.slice())
                    : initialBoard(n);
                const replayBoards = [baseBoard.map((row) => row.slice())];
                const replayMarkers = [[]];
                const replayStepPlayers = [0];
                const replayScores = [{ blackScore: 0, whiteScore: 0 }];
                const replayCurrentPlayers = [1];
                const replayGameOvers = [false];
                const replayWinners = [null];

                let curBoard = baseBoard.map((row) => row.slice());
                let curPlayer = 1;
                let curOver = false;
                let curWinner = null;
                let curCounts = reversiCountOn(curBoard, n);

                for (const m of ps.moveLog) {
                    if (!m || m.type !== 'move') continue;
                    const row = m.row;
                    const col = m.col;
                    const playerVal = m.player === 'player1' ? 1 : 2;
                    // 六角盘：行数是 ROWS=2n-1、每行格数 rowLen(row)，不能用路数 n 当边界
                    if (row < 0 || row >= ps.ROWS || col < 0 || col >= rowLen(row)) continue;
                    if (curBoard[row][col] !== 0) continue;
                    reversiApplyOn(curBoard, n, row, col, playerVal);
                    curCounts = reversiCountOn(curBoard, n);
                    const oppVal = playerVal === 1 ? 2 : 1;
                    const oppCan = reversiHasMoveOn(curBoard, n, oppVal);
                    const selfCan = reversiHasMoveOn(curBoard, n, playerVal);
                    if (!oppCan && !selfCan) {
                        curOver = true;
                        curWinner = curCounts.black > curCounts.white ? 'player1'
                            : (curCounts.white > curCounts.black ? 'player2' : 'draw');
                    } else {
                        curPlayer = oppCan ? oppVal : playerVal;
                    }

                    replayBoards.push(curBoard.map((r) => r.slice()));
                    replayMarkers.push([{ row, col, color: playerVal }]);
                    replayStepPlayers.push(playerVal);
                    replayScores.push({ blackScore: curCounts.black, whiteScore: curCounts.white });
                    replayCurrentPlayers.push(curPlayer);
                    replayGameOvers.push(curOver);
                    replayWinners.push(curWinner);
                }

                ps.replayBoards = replayBoards;
                ps.replayMarkers = replayMarkers;
                ps.replayStepPlayers = replayStepPlayers;
                ps.replayScores = replayScores;
                ps.replayCurrentPlayers = replayCurrentPlayers;
                ps.replayGameOvers = replayGameOvers;
                ps.replayWinners = replayWinners;
                const total = replayBoards.length - 1;
                ps.replayTotalSteps = total;
                ps.replayStep = total;
                const slider = document.getElementById('replaySlider');
                slider.max = total;
                slider.value = total;
                document.getElementById('replayStepDisplay').textContent = `${total} / ${total}`;

                ps.board = replayBoards[total].map((row) => row.slice());
                ps.lastMoveMarkers = (replayMarkers[total] || []).map((m) => ({ ...m }));
                ps.blackCount = replayScores[total].blackScore;
                ps.whiteCount = replayScores[total].whiteScore;
                ps.currentPlayer = replayCurrentPlayers[total];
                ps.gameOver = replayGameOvers[total];
                ps.winner = replayWinners[total];
            }

            function setReplayStep(step) {
                if (ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step;
                ps.replayMode = step < ps.replayTotalSteps;
                if (!ps.replayBoards.length) return;

                const board = ps.replayBoards[step];
                ps.board = board.map((row) => row.slice());
                const mk = ps.replayMarkers[step] || [];
                ps.lastMoveMarkers = mk.map((m) => ({ ...m }));

                ps.blackCount = (ps.replayScores[step] && ps.replayScores[step].blackScore) || 0;
                ps.whiteCount = (ps.replayScores[step] && ps.replayScores[step].whiteScore) || 0;
                ps.currentPlayer = ps.replayCurrentPlayers[step] || 1;
                ps.gameOver = !!ps.replayGameOvers[step];
                ps.winner = ps.replayWinners[step] || null;

                document.getElementById('replaySlider').value = String(step);
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.replayTotalSteps}`;
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            function setTryPlayStep(step) {
                if (!ps.tryPlayMode) return;
                if (step < 0) step = 0;
                if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step;
                ps.board = ps.tryPlayBoards[step].map((r) => r.slice());
                ps.lastMoveMarkers = (ps.tryPlayMarkers[step] || []).map((m) => ({ ...m }));
                ps.blackCount = ps.tryPlayScores[step].blackScore;
                ps.whiteCount = ps.tryPlayScores[step].whiteScore;
                ps.currentPlayer = ps.tryPlayCurrentPlayers[step];
                ps.gameOver = !!ps.tryPlayGameOvers[step];
                ps.winner = ps.tryPlayWinners[step];
                const slider = document.getElementById('replaySlider');
                slider.value = String(step);
                slider.max = ps.tryPlayTotalSteps;
                document.getElementById('replayStepDisplay').textContent = `${step} / ${ps.tryPlayTotalSteps}`;
                if (ps.hoverRow >= 0 && ps.hoverCol >= 0) {
                    ps.isHoverValid = tryPlayCanPlayAt(ps.hoverRow, ps.hoverCol);
                } else {
                    ps.isHoverValid = false;
                }
                updateTurn();
                updateScoreBoard();
                drawBoard();
            }

            /** 试下：判断当前试下局面轮到的一方能否在 (row,col) 落子 */
            function tryPlayCanPlayAt(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                if (!isValidCoord(row, col)) return false;
                if (ps.board[row][col] !== 0) return false;
                const me = ps.currentPlayer;
                if (!(me > 0)) return false;
                return reversiFlipsOn(ps.board, ps.BOARD_SIZE, row, col, me).length > 0;
            }

            /** 试下：落子（应用翻转），并按黑白棋规则推进轮次 / 过手 / 终局 */
            function tryPlayTryMove(row, col) {
                if (!ps.tryPlayMode || ps.gameOver) return false;
                if (!tryPlayCanPlayAt(row, col)) return false;
                const t = ps.tryPlayStep;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = t + 1;
                    ps.tryPlayMarkers.length = t + 1;
                    ps.tryPlayStepPlayers.length = t + 1;
                    ps.tryPlayScores.length = t + 1;
                    ps.tryPlayCurrentPlayers.length = t + 1;
                    ps.tryPlayGameOvers.length = t + 1;
                    ps.tryPlayWinners.length = t + 1;
                    ps.tryPlayBranchMoves.length = t;
                }
                const playerVal = ps.tryPlayCurrentPlayers[t];
                const slot = playerVal === 1 ? 'player1' : 'player2';
                const curBoard = ps.tryPlayBoards[t].map((r) => r.slice());
                reversiApplyOn(curBoard, ps.BOARD_SIZE, row, col, playerVal);
                const counts = reversiCountOn(curBoard, ps.BOARD_SIZE);
                const oppVal = playerVal === 1 ? 2 : 1;
                const oppCan = reversiHasMoveOn(curBoard, ps.BOARD_SIZE, oppVal);
                const selfCan = reversiHasMoveOn(curBoard, ps.BOARD_SIZE, playerVal);
                let curPlayer = playerVal;
                let curOver = false;
                let curWinner = null;
                if (!oppCan && !selfCan) {
                    curOver = true;
                    curWinner = counts.black > counts.white ? 'player1'
                        : (counts.white > counts.black ? 'player2' : 'draw');
                } else {
                    curPlayer = oppCan ? oppVal : playerVal;
                }
                ps.tryPlayBranchMoves.push({ type: 'move', row, col, player: slot });
                ps.tryPlayBoards.push(curBoard.map((r) => r.slice()));
                ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
                ps.tryPlayStepPlayers.push(playerVal);
                ps.tryPlayScores.push({ blackScore: counts.black, whiteScore: counts.white });
                ps.tryPlayCurrentPlayers.push(curPlayer);
                ps.tryPlayGameOvers.push(curOver);
                ps.tryPlayWinners.push(curWinner);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
                ps.tryPlayStep = ps.tryPlayTotalSteps;
                setTryPlayStep(ps.tryPlayStep);
                return true;
            }

            function enterTryPlay() {
                updateReplayUI();
                const wasReplay = ps.replayMode;
                const base = wasReplay ? ps.replayStep : ps.replayTotalSteps;
                ps.tryPlayFromLive = !wasReplay;
                ps.tryPlayMode = true;
                ps.tryPlayBaseStep = base;
                if (!wasReplay) ps.replayMode = true;
                ps.tryPlayBoards = [ps.replayBoards[base].map((r) => r.slice())];
                ps.tryPlayMarkers = [(ps.replayMarkers[base] || []).map((m) => ({ ...m }))];
                ps.tryPlayStepPlayers = [ps.replayStepPlayers[base]];
                ps.tryPlayScores = [{ ...ps.replayScores[base] }];
                ps.tryPlayCurrentPlayers = [ps.replayCurrentPlayers[base]];
                ps.tryPlayGameOvers = [!!ps.replayGameOvers[base]];
                ps.tryPlayWinners = [ps.replayWinners[base]];
                ps.tryPlayBranchMoves = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                setTryPlayStep(0);
                const slider = document.getElementById('replaySlider');
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
                updateActionButtons();
            }

            function exitTryPlay() {
                const base = ps.tryPlayBaseStep;
                ps.tryPlayMode = false;
                ps.tryPlayFromLive = false;
                ps.tryPlayBoards = [];
                ps.tryPlayMarkers = [];
                ps.tryPlayStepPlayers = [];
                ps.tryPlayScores = [];
                ps.tryPlayCurrentPlayers = [];
                ps.tryPlayGameOvers = [];
                ps.tryPlayWinners = [];
                ps.tryPlayBranchMoves = [];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                updateReplayUI();
                setReplayStep(base);
            }

            function isMyTurn() {
                if (!ps.mySlot || ps.gameOver || !ps.matchStarted) return false;
                if (ps.mySlot === 'player1' && ps.currentPlayer === 1) return true;
                if (ps.mySlot === 'player2' && ps.currentPlayer === 2) return true;
                return false;
            }

            let bindingsUpdateRecordButtons = null;   // 公共实现（_seatOverlay 建好后赋值）
            function updateRecordButtons() {
                const importBtn = document.getElementById('importBtn');
                const exportBtn = document.getElementById('exportBtn');
                const hasPlayers = ps.slots.player1 || ps.slots.player2;
                const hasMoves = ps.moveLog.length > 0;
                // 开局（开赛/计时协商中/已有落子）隐藏路数选择；终局开新局（盘面清空、未开赛）后恢复可选，
                // 是否已就座不影响——否则新局后玩家仍在座会永远隐藏。
                const engaged = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings) || hasMoves);
                window.QiRoomGameSwitcher.syncSettingsSelect(boardSizeSelect);
                // 按钮显隐走公共实现（导出棋谱任何时候都显示）；下面留一份兜底，万一没接上 bindings
                if (bindingsUpdateRecordButtons) { bindingsUpdateRecordButtons(); return; }
                if (!hasPlayers && !hasMoves) {
                    importBtn.style.display = '';
                    exportBtn.style.display = '';   // 导出棋谱任何时候都显示（还没开局就导空棋谱）
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }

            const _seatOverlay = QiBoardRoomClient.createWeiqiMessageBindings({
                pageState: ps,
                recordPointToCanvas: (row, col) => ({ ...boardCenterOfCell(row, col), cell: ps.CELL_SIZE, size: 600 }),
                boardSeatOverlay: true,
                seatOverlayOnly: true,
                getGameOver: () => ps.gameOver,
                getReplayMode: () => ps.replayMode,
                getBoard: () => ps.board,
                enterReplayMode: (data) => { syncState(data.recordState); ps.replayMode = true; },
                setReplayStep: (step) => { setReplayStep(step); ps.replayMode = true; },
                exitTryPlay,
                // 座位蒙版多边形 = 六角木质外框（600×600 逻辑画布坐标）
                seatOverlayShape: 'hexagon',
                getSeatOverlayVertices: () => FIXED_OUTER_HEX,
                seatOverlayCornerRadius: 3,
                standardWeiqiMatchTime,
                getWs: () => ps.ws,
                getBoardSize: () => ps.BOARD_SIZE,
                // 默认限时与围棋同口径：按棋盘总点数换算
                getTotalPoints: () => 3 * ps.BOARD_SIZE * ps.BOARD_SIZE - 3 * ps.BOARD_SIZE + 1,
                // 主用时系数按本棋种调大（0.05，读秒/次数仍同围棋口径）
                timeControlMainCoef: 0.05,
                getSlots: () => ps.slots,
                setSlots: (s) => { ps.slots = s; },
                getMySlot: () => ps.mySlot,
                setMySlot: (s) => { ps.mySlot = s; },
                updateTurn,
                updateReplayUI: () => { if (typeof updateReplayUI === 'function') updateReplayUI(); },
                // 试下虚着/悔棋要落到具体某一步：seatOverlayOnly 短路后公共代码只能靠这里拿到步进函数
                setTryPlayStep,
                colorStatus});
            bindingsUpdateRecordButtons = _seatOverlay.updateRecordButtons;

            function updateRadioStyles() {
                _seatOverlay.updateRadioStyles();
            }

            function syncState(state) {
                if (ps.tryPlayMode) exitTryPlay();
                if (state.boardSize) { ps.BOARD_SIZE = state.boardSize; ps.ROWS = rowsOf(ps.BOARD_SIZE); }
                updateGeometry();
                if (state.board) ps.board = state.board.map((row) => row.slice());
                if (Array.isArray(state.openingBoard)) ps.openingBoard = state.openingBoard.map((row) => row.slice());
                ps.numberOfHands = state.numberOfHands || 1;
                ps.currentPlayer = state.currentPlayer || 1;
                const _stCounts = reversiCountOn(ps.board, ps.BOARD_SIZE);
                ps.blackCount = state.blackCount != null ? state.blackCount : _stCounts.black;
                ps.whiteCount = state.whiteCount != null ? state.whiteCount : _stCounts.white;
                ps.passNotice = state.passNotice || null;
                ps.lastMoveMarkers = (state.lastMoveMarkers || []).map((m) => ({ ...m }));
                ps.moveLog = (state.moveCoords || []).map((m) => ({ ...m }));
                ps.gameOver = !!state.gameOver;
                ps.winner = state.winner || null;
                ps.matchStarted = !!state.matchStarted;
                ps.matchTime = state.matchTime || null;
                if (ps.matchStarted || ps.moveLog.length > 0 || (ps.matchTime && ps.matchTime.settings)) ps.matchStartedOnce = true;
                if (state.slots) ps.slots = { player1: !!state.slots.player1, player2: !!state.slots.player2 };
                boardSizeSelect.value = String(ps.BOARD_SIZE);
                updateKomiText();
                if (_seatOverlay.matchTimeCtl && state.matchTime !== undefined)
                    _seatOverlay.matchTimeCtl.applyMatchTimeFromState(state);
                updateTurn();
                updateScoreBoard();
                updateReplayUI();
                updateRecordButtons();
                updateRadioStyles();
                drawBoard();
            }

            function handleMessage(msg) {
                _seatOverlay.handleSeatOverlayMessage(msg);
                switch (msg.type) {
                    case 'joined':
                        sessionStorage.removeItem(`roomPassword_${roomId}`);
                        if (msg.role === 'player') {
                            ps.mySlot = msg.slot;
                        } else {
                            ps.mySlot = null;
                        }
                        if (msg.state) syncState(msg.state);
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        break;
                    case 'colorAssigned':
                        ps.mySlot = msg.color;
                        if (msg.color === 'player1') ps.slots.player1 = true;
                        if (msg.color === 'player2') ps.slots.player2 = true;
                        _seatOverlay.refreshColorStatus();
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'slotOccupied':
                        if (msg.slot === 'player1') ps.slots.player1 = true;
                        if (msg.slot === 'player2') ps.slots.player2 = true;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'slotReleased':
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (msg.slot === 'player2') ps.slots.player2 = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'playerLeft':
                        if (msg.slot === 'player1') ps.slots.player1 = false;
                        if (msg.slot === 'player2') ps.slots.player2 = false;
                        if (ps.mySlot === msg.slot) {
                            ps.mySlot = null;
                            colorStatus.textContent = '观战';
                        }
                        if (msg.matchStarted || ps.matchStarted)
                            ps.seatOverlayLocalHide = false;
                        updateRadioStyles();
                        updateRecordButtons();
                        updateTurn();
                        break;
                    case 'colorsFinalized':
                        if (msg.slots) ps.slots = { player1: !!msg.slots.player1, player2: !!msg.slots.player2 };
                        updateRadioStyles();
                        updateTurn();
                        break;
                    case 'boardSizeChanged':
                        ps.BOARD_SIZE = msg.boardSize;
                        ps.ROWS = rowsOf(ps.BOARD_SIZE);
                        updateGeometry();
                        ps.openingBoard = null;
                        initBoardArrays();
                        updateGeometry();
                        updateKomiText();
                        drawBoard();
                        break;
                    case 'gameState':
                        syncState(msg);
                        break;
                    case 'timeControlNegotiation':
                    case 'timeControlWaitPeer':
                    case 'timeControlAgreed':
                    case 'timeControlReset':
                    case 'clockUpdate':
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.handleMessage(msg);
                        if (msg.type === 'timeControlAgreed') {
                            if (msg.slots) ps.slots = { player1: !!msg.slots.player1, player2: !!msg.slots.player2 };
                            updateRadioStyles();
                        }
                        break;
                    case 'broadcast':
                        if (msg.action === 'move' || msg.action === 'undoAccept' || msg.action === 'resign' || msg.action === 'drawAgreed' || msg.action === 'timeLoss') {
                            const wasOver = ps.gameOver;
                            syncState(msg);
                            if (!wasOver && msg.gameOver) {
                                // 优先用服务端给出的终局文案（含双方子数，如「黑 40 : 白 24，黑胜」）
                                if (msg.recordResultText) qiAlert(msg.recordResultText);
                                else if (msg.winner === 'player1') qiAlert('黑胜');
                                else if (msg.winner === 'player2') qiAlert('白胜');
                                else qiAlert('和棋');
                            }
                        }
                        break;
                    case 'newGameStarted':
                        ps.mySlot = null;
                        colorStatus.textContent = '观战';
                        ps.slots = { player1: false, player2: false };
                        ps.matchStarted = false;
                        ps.matchTime = null;
                        ps.matchStartedOnce = false;
                        if (_seatOverlay.matchTimeCtl) _seatOverlay.matchTimeCtl.stop();
                        syncState(msg);
                        break;
                    case 'importSuccess':
                    case 'roomReset':
                        syncState(msg);
                        break;
                    case 'gameRecord':
                        if (msg.data) QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(msg.data, '黑白棋');
                        break;
                    case 'newGameRequest':
                        qiConfirm('对方请求开始新的一局，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'newGameResponse', accept: !!ok })); });
                        break;
                    case 'undoRequest':
                        qiConfirm('对方请求悔棋，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'undoResponse', accept: !!ok })); });
                        break;
                    case 'drawRequest':
                        qiConfirm('对方申请和棋，是否同意？').then(ok => { ps.ws.send(JSON.stringify({ type: 'drawResponse', accept: !!ok })); });
                        break;
                    case 'error':
                        if (msg.message) qiAlert(msg.message);
                        break;
                    default:
                        break;
                }
            }

        function connectWebSocket() {
                if (ps.reconnectTimer) {
                    clearTimeout(ps.reconnectTimer);
                    ps.reconnectTimer = null;
                }
                ps.ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                    gameType,
                    roomId,
                    roomPassword,
                    onMessage: handleMessage,
                    colorStatus,
                    connectWebSocket,
                    clearReconnectTimer: () => {
                        if (ps.reconnectTimer) {
                            clearTimeout(ps.reconnectTimer);
                            ps.reconnectTimer = null;
                        }
                    },
                    getReconnectTimer: () => ps.reconnectTimer,
                    setReconnectTimer: (t) => { ps.reconnectTimer = t; }
                });
            }

            function tryCommitMove(row, col) {
                if (!canPlayAt(row, col)) return;
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            }

            canvas.addEventListener('click', (e) => {
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestCell(x, y);
                if (ps.tryPlayMode) {
                    tryPlayTryMove(row, col);
                    return;
                }
                tryCommitMove(row, col);
            });

            if (isMouseDevice) {
                canvas.addEventListener('mousemove', (e) => {
                    const rect = canvas.getBoundingClientRect();
                    const scale = 600 / rect.width;
                    const x = (e.clientX - rect.left) * scale;
                    const y = (e.clientY - rect.top) * scale;
                    const hit = getClosestCell(x, y);
                    ps.hoverRow = hit.row;
                    ps.hoverCol = hit.col;
                    ps.isHoverValid = ps.tryPlayMode ? tryPlayCanPlayAt(hit.row, hit.col) : canPlayAt(hit.row, hit.col);
                    drawBoard();
                });
                canvas.addEventListener('mouseleave', () => {
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    ps.isHoverValid = false;
                    drawBoard();
                });
            }

            boardSizeSelect.addEventListener('change', () => {
                const n = parseInt(boardSizeSelect.value, 10);
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'setBoardSize', size: n }));
            });
            showNumbersCheck.addEventListener('change', () => {
                ps.showMoveNumbers = !!showNumbersCheck.checked;
                drawBoard();
            });

            // 新局/悔棋/认输/和棋：走公共按钮绑定（带确认对话框，与房间页公共 bindings 同一套口径）
            QiBoardRoomClient.bindPanelButtons({
                getWs: () => ps.ws,
                getMySlot: () => ps.mySlot,
                getSlots: () => ps.slots,
                getComputerSlot: () => ps.computerSlot
            });
            document.getElementById('exportBtn').onclick = () => {
                if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'exportRecord' }));
            };
            document.getElementById('importBtn').onclick = () => document.getElementById('importFileInput').click();
            document.getElementById('importFileInput').onchange = (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = JSON.parse(reader.result);
                        if (ps.ws && ps.ws.readyState === 1) ps.ws.send(JSON.stringify({ type: 'importRecord', data }));
                    } catch (err) {
                        qiAlert('文件解析失败');
                    }
                    e.target.value = '';
                };
                reader.readAsText(f);
            };
            document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
            document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
            document.getElementById('backToLobbyBtn').onclick = () => { window.location.href = '/qi'; };

            document.getElementById('replayBackBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                else setReplayStep(ps.replayStep - 1);
            };
            document.getElementById('replayForwardBtn').onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                else setReplayStep(ps.replayStep + 1);
            };
            document.getElementById('replaySlider').addEventListener('input', (e) => {
                const step = Number(e.target.value) || 0;
                if (ps.tryPlayMode) setTryPlayStep(step);
                else setReplayStep(step);
            });
            {
                const tpBtn = document.getElementById('tryPlayBtn');
                if (tpBtn) {
                    tpBtn.onclick = () => {
                        if (ps.tryPlayMode) exitTryPlay();
                        else enterTryPlay();
                    };
                }
            }

            initBoardArrays();
            updateGeometry();
            updateKomiText();
            updateTurn();
            updateScoreBoard();
            updateReplayUI();
            drawBoard();

        /* board edit UI */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI && typeof ps !== 'undefined') {
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: ps,
                canvas: document.getElementById('goBoard'),
                mode: 'grid2d',
                pickAtClient(clientX, clientY) {
                    // 与正常落子的取点一致：客户端坐标 → 600 逻辑画布 → 最近格
                    const rect = canvas.getBoundingClientRect();
                    const scale = 600 / rect.width;
                    return getClosestCell((clientX - rect.left) * scale, (clientY - rect.top) * scale);
                },
                drawBoard: typeof drawBoard === 'function' ? drawBoard : function () {},
                getBoard() { return ps.board; },
                setBoard(b) { ps.board = b; },
                emptyBoard() {
                    return Array.from({ length: ps.ROWS }, (_, r) => Array(rowLen(r)).fill(0));
                }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) {
                        if (state.initialBoard) ps.liveOpeningBoard = state.initialBoard;
                        ps.gameStarted = (state.numberOfHands || 1) > 1;
                    }
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

            connectWebSocket();
        })();
        })();
    }
};
