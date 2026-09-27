window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['symmetry-weiqi'] = {
    shell: {
        "title": "对称围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />每手棋随机选择一种对称。落子时，在落子点的对称点也同时落下一子，除非该点已经有棋子。<br /><br />对称共7种，包括两种棋盘中线对称、两种棋盘对角线对称、顺时针和逆时针90度旋转对称、中心对称。",
        "defaultKomiText": "黑贴白4.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "对称围棋",
        "useBenson": true,
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": false
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
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "对称围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
const C = QiSquareWeiqiCanvas, R = QiWeiqiSquarePageRuntime;
        var ps = {
            BOARD_SIZE: 19, KOMI: 4.25, PADDING: 0, CELL_SIZE: 0, numberOfHands: 1, currentPlayer: 1, mySlot: null, gameOver: false, winner: null,
            lastMoveMarkers: [], showEstimateActive: false, cachedLiveBoard: null, cachedTerritory: null, waitingScoreConfirm: false, iRejected: false,
            ws: null, isMyTurn: false, slots: { player1: false, player2: false }, reconnectTimer: null,
            replayMode: false, replayBoards: [], replayMarkers: [], replayStepPlayers: [], replaySymmetryAxes: [], replayStep: 0, replayTotalSteps: 0,
            showMoveNumbers: false, moveLog: [],
            tryPlayMode: false, tryPlayBaseStep: 0, tryPlayBoards: [], tryPlayMarkers: [], tryPlayCurrentPlayer: 1, tryPlaySymmetryAxis: 'diag1',
            tryPlayStepAxes: [], tryPlayStep: 0, tryPlayTotalSteps: 0,
            liveReplayBoards: [], liveReplayMarkers: [], liveReplayStepPlayers: [], liveReplaySymmetryAxes: [], liveViewStep: 0, liveFollowLatest: true,
            symmetryAxis: 'diag1', serverSymmetryAxis: 'diag1', matchStarted: false, enabledSymmetries: null,
            userBoardMarks: Object.create(null), hoverRow: -1, hoverCol: -1, isHoverValid: false
        };
        (function () {
            const g = C.computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding; ps.CELL_SIZE = g.cellSize;
            ps.board = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
        })();

const BOARD_MARK_CHAR_LIST = (() => {
            const a = ['?', '!']; for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩'); return a;
        })();
        const komiInfo = document.getElementById('komiInfo'), canvas = document.getElementById('goBoard'), ctx = canvas.getContext('2d');
        const turnDisplay = document.getElementById('turnDisplay'), colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle'), scoreBoard = document.getElementById('scoreBoard'), leadInfo = document.getElementById('leadInfo');
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel'), scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes'), scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');
        C.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        C.initBoardMarkFoldDom(document.getElementById('boardMarkPanel'), document.getElementById('boardMarkFoldBtn'), document.getElementById('boardMarkExpandBtn'));
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const domPage = { turnDisplay, scoreTitle, scoreBoard, leadInfo, scoreConfirmPanel, scoreConfirmText, komiInfo, canvas, ctx, boardMarkSelect, colorStatus };

        const dc = (b) => b.map(r => r.slice());
        const getMP = (r, c, ax) => {
            const L = ps.BOARD_SIZE - 1;
            // 四种轴对称
            if (ax === 'horizontal') return { row: L - r, col: c };
            if (ax === 'vertical') return { row: r, col: L - c };
            if (ax === 'diag1') return { row: c, col: r };
            if (ax === 'diag2') return { row: L - c, col: L - r };
            // 三种旋转（屏幕视角：row 0 在下、col 0 在左）
            if (ax === 'rotate90cw') return { row: L - c, col: r };
            if (ax === 'rotate90ccw') return { row: c, col: L - r };
            if (ax === 'rotate180') return { row: L - r, col: L - c };
            return { row: r, col: c };
        };
        /** 全部七种对称与「启用的对称」——须与 games/symmetry-weiqi.js 的 SYMMETRY_TYPES / ENABLED_SYMMETRIES 一致 */
        const SYMMETRY_TYPES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
        const ENABLED_SYMMETRIES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
        const OPENING_SYMMETRIES = ['diag1', 'diag2'];
        /** 是否为旋转类（绘制时用旋转符号而不是镜像线） */
        const isRotationAxis = (ax) => typeof ax === 'string' && ax.indexOf('rotate') === 0;
        const nextAxis = (hn) => {
            if (hn === 1) return OPENING_SYMMETRIES[0];
            if (hn === 2) return OPENING_SYMMETRIES[1];
            const pool = (ps.enabledSymmetries && ps.enabledSymmetries.length) ? ps.enabledSymmetries
                : (ENABLED_SYMMETRIES.length ? ENABLED_SYMMETRIES : SYMMETRY_TYPES);
            return pool[Math.floor(Math.random() * pool.length)];
        };
        const performCap = (brd, pv) => {
            let ch;
            do {
                ch = false;
                for (let i = 0; i < ps.BOARD_SIZE; i++) for (let j = 0; j < ps.BOARD_SIZE; j++) {
                    if (brd[i][j] === 3 - pv && R.countGroupLiberties(brd, i, j, ps.BOARD_SIZE) === 0) {
                        R.removeGroup(brd, i, j, 3 - pv, ps.BOARD_SIZE); ch = true;
                    }
                }
                for (let i = 0; i < ps.BOARD_SIZE; i++) for (let j = 0; j < ps.BOARD_SIZE; j++) {
                    if (brd[i][j] === pv && R.countGroupLiberties(brd, i, j, ps.BOARD_SIZE) === 0) {
                        R.removeGroup(brd, i, j, pv, ps.BOARD_SIZE); ch = true;
                    }
                }
            } while (ch);
        };
        const trySymmetry = (bf, r, c, pv, ax) => {
            if (bf[r][c] !== 0) return null;
            const m = getMP(r, c, ax), nb = dc(bf);
            nb[r][c] = pv;
            if (!(m.row === r && m.col === c) && nb[m.row][m.col] === 0) nb[m.row][m.col] = pv;
            performCap(nb, pv);
            return nb;
        };
        function rebuildLive(mc) {
            const n = ps.BOARD_SIZE;
            ps.liveReplayBoards = []; ps.liveReplayMarkers = []; ps.liveReplayStepPlayers = [0]; ps.liveReplaySymmetryAxes = [null];
            let cur = Array(n).fill().map(() => Array(n).fill(0));
            ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
            let curAx = 'diag1';
            for (const mv of (mc || [])) {
                const pv = mv.player === 'player1' ? 1 : 2;
                ps.liveReplayStepPlayers.push(pv);
                if (mv.type === 'move') {
                    const ax = mv.symmetryAxis || curAx;
                    ps.liveReplaySymmetryAxes.push(ax);
                    const nb = trySymmetry(cur, mv.row, mv.col, pv, ax);
                    if (nb) cur = nb;
                    const mk = [{ row: mv.row, col: mv.col, color: pv }];
                    const mp = getMP(mv.row, mv.col, ax);
                    if (!(mp.row === mv.row && mp.col === mv.col) && cur[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push(mk);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                } else if (mv.type === 'pass') {
                    ps.liveReplaySymmetryAxes.push(null);
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                }
            }
        }
        function applyLiveReplayIncremental(mc) {
            const startLen = ps.liveReplayBoards.length - 1;
            const mcs = mc || [];
            if (mcs.length <= startLen) return true;
            let cur = dc(ps.liveReplayBoards[ps.liveReplayBoards.length - 1]);
            let curAx = 'diag1';
            const lastAx = ps.liveReplaySymmetryAxes && ps.liveReplaySymmetryAxes.length
                ? ps.liveReplaySymmetryAxes[ps.liveReplaySymmetryAxes.length - 1]
                : null;
            if (lastAx) curAx = nextAxis(ps.liveReplayBoards.length);
            for (let i = startLen; i < mcs.length; i++) {
                const mv = mcs[i];
                const pv = mv.player === 'player1' ? 1 : 2;
                ps.liveReplayStepPlayers.push(pv);
                if (mv.type === 'move') {
                    const ax = mv.symmetryAxis || curAx;
                    ps.liveReplaySymmetryAxes.push(ax);
                    const nb = trySymmetry(cur, mv.row, mv.col, pv, ax);
                    if (nb) cur = nb;
                    const mk = [{ row: mv.row, col: mv.col, color: pv }];
                    const mp = getMP(mv.row, mv.col, ax);
                    if (!(mp.row === mv.row && mp.col === mv.col) && cur[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push(mk);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                } else if (mv.type === 'pass') {
                    ps.liveReplaySymmetryAxes.push(null);
                    ps.liveReplayBoards.push(dc(cur)); ps.liveReplayMarkers.push([]);
                    curAx = nextAxis(ps.liveReplayBoards.length);
                } else { return false; }
            }
            return true;
        }
        function applyLiveView() {
            if (!ps.liveReplayBoards.length) {
                ps.board = page.initBoardArray(ps.BOARD_SIZE); ps.lastMoveMarkers = []; ps.symmetryAxis = 'diag1'; return;
            }
            if (ps.liveViewStep < 0) ps.liveViewStep = 0;
            if (ps.liveViewStep >= ps.liveReplayBoards.length) ps.liveViewStep = ps.liveReplayBoards.length - 1;
            ps.board = dc(ps.liveReplayBoards[ps.liveViewStep]);
            ps.lastMoveMarkers = ps.liveReplayMarkers[ps.liveViewStep].map(m => ({ ...m }));
            // liveReplaySymmetryAxes[step] 是该手「已使用」的轴；跟最新时要用服务端「下一手」轴
            const atLatest = ps.liveFollowLatest && ps.liveViewStep === ps.liveReplayBoards.length - 1;
            ps.symmetryAxis = atLatest ? (ps.serverSymmetryAxis || ps.liveReplaySymmetryAxes[ps.liveViewStep] || 'diag1')
                : ps.liveReplaySymmetryAxes[ps.liveViewStep];
        }
        function numsSymmetry() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            const step = (i, mk, lim) => {
                if (!mk) return;
                for (const m of mk) {
                    if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i;
                }
            };
            if (ps.replayMode && ps.tryPlayMode) { for (let i = 1; i <= ps.tryPlayStep; i++) step(i, ps.tryPlayMarkers[i], 0); }
            else if (ps.replayMode) { for (let i = 1; i <= ps.replayStep; i++) step(i, ps.replayMarkers[i], 0); }
            else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) step(i, ps.liveReplayMarkers[i], 0);
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const e = ps.moveLog[i]; if (!e) continue;
                    for (const m of e) if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0) nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }
        /** 试下用分支下一手轴；否则用 ps.symmetryAxis（跟最新时已在 applyLiveView 换成服务端下一手轴） */
        function getCurrentSymmetryAxis() {
            if (ps.tryPlayMode && ps.replayMode) return ps.tryPlaySymmetryAxis;
            return ps.symmetryAxis;
        }
        /**
         * 旋转类对称的符号：棋盘中心一个弧 + 终点箭头（不画镜像线）。
         *   顺时针 90°：6 点起，逆时针（视觉）270° 到 9 点，箭头在 9 点、朝行进方向（向下）
         *   逆时针 90°：6 点起，顺时针（视觉）270° 到 3 点，箭头在 3 点、朝行进方向（向下）
         *   180°      ：6 点起，逆时针（视觉）180° 到 12 点，箭头在 12 点、朝行进方向（向左）
         * 半径 = 80px（画布固定 600；19 路时约 2.7 格；曾试过 1/10=60 与 1/5=120，用户最终定 80）；
         * 箭头长/宽固定为「半径 60 时的大小」（20.4 / 15.6px，用户要求不随半径变）。线宽/配色/阴影与镜像线完全一致。
         */
        function drawRotationSymbol(axis, symmetryColor) {
            const P = ps.PADDING, z = ps.CELL_SIZE, cs = C.DEFAULT_CANVAS_SIZE;
            const cx = P + (ps.BOARD_SIZE - 1) * z / 2;
            const cy = P + (ps.BOARD_SIZE - 1) * z / 2;
            const r = 80;                                       // 圆弧半径（px；画布固定 600）
            const D = Math.PI / 180;
            // 点钟方向 → 画布角度：画布 y 轴向下，故 0=3 点、90=6 点、180=9 点、270=12 点
            const h2a = (h) => (h - 3) * 30 * D;
            let start, end, anticlockwise;                      // anticlockwise = 画布角度递减（视觉逆时针）
            if (axis === 'rotate90cw') {
                start = h2a(6); end = h2a(9); anticlockwise = true;
            } else if (axis === 'rotate90ccw') {
                start = h2a(6); end = h2a(3); anticlockwise = false;
            } else {
                start = h2a(6); end = h2a(12); anticlockwise = true;
            }
            ctx.beginPath();
            ctx.arc(cx, cy, r, start, end, anticlockwise);
            ctx.stroke();
            // 终点箭头：**根部（两后角连线的中点）对齐弧的终点**，箭尖沿行进方向再往前一个箭头长。
            // 弧的终点 = 中心 + r(cosθ, sinθ)；画布角度递增（视觉顺时针）的切线 = (-sinθ, cosθ)，逆时针取反
            const sign = anticlockwise ? -1 : 1;
            const tx = sign * -Math.sin(end), ty = sign * Math.cos(end);
            const baseX = cx + Math.cos(end) * r, baseY = cy + Math.sin(end) * r;
            const nx = -ty, ny = tx;
            const AL = 60 * 0.34, AW = 60 * 0.26;               // 箭头长/宽：保持半径 60 时的大小（不随半径变）
            ctx.fillStyle = symmetryColor === 1 ? '#000000' : '#ffffff';
            ctx.beginPath();
            ctx.moveTo(baseX + tx * AL, baseY + ty * AL);        // 箭尖（终点前方一个箭头长）
            ctx.lineTo(baseX + nx * (AW / 2), baseY + ny * (AW / 2));   // 后角 1（落在弧的终点上）
            ctx.lineTo(baseX - nx * (AW / 2), baseY - ny * (AW / 2));   // 后角 2（落在弧的终点上）
            ctx.closePath();
            ctx.fill();
        }

        function drawSymmetryAxisLine() {
            if (ps.showEstimateActive) return;
            if (!ps.replayMode && !ps.matchStarted) return;
            const axis = getCurrentSymmetryAxis();
            const last = ps.BOARD_SIZE - 1;
            if (!axis) return;
            let symmetryColor;
            if (ps.replayMode && !ps.tryPlayMode) {
                symmetryColor = ps.replayStepPlayers[ps.replayStep] || 1;
            } else if (!ps.replayMode && ps.liveReplayBoards.length > 0 && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                symmetryColor = ps.liveReplayStepPlayers[ps.liveViewStep] || 1;
            } else if (ps.tryPlayMode) {
                if (ps.tryPlayStep === 0) symmetryColor = ps.replayStepPlayers[ps.tryPlayBaseStep] || 1;
                else symmetryColor = 3 - ps.tryPlayCurrentPlayer;
            } else {
                symmetryColor = ps.currentPlayer;
            }
            const P = ps.PADDING, z = ps.CELL_SIZE, edge = C.DEFAULT_CANVAS_SIZE - P;
            ctx.save();
            ctx.lineWidth = 3;
            ctx.strokeStyle = symmetryColor === 1 ? '#000000' : '#ffffff';
            ctx.shadowBlur = 4;
            ctx.shadowColor = symmetryColor === 1 ? '#aaa' : '#333';
            ctx.shadowOffsetY = 1;
            ctx.setLineDash([]);
            // 旋转类：在棋盘中心画旋转符号（弧 + 箭头），不画镜像线
            if (isRotationAxis(axis)) {
                drawRotationSymbol(axis, symmetryColor);
                ctx.restore();
                return;
            }
            ctx.beginPath();
            // 统一显示变换（与 stones/hover 一致）：数据行 0 显示在底边，
            // 四个轴都先取"数据坐标下的两个端点"再经 show() 落到像素，避免按画布直觉另写一套
            const show = (r, c) => ({ x: P + c * z, y: P + (last - r) * z });
            let pa = null, pb = null;
            if (axis === 'horizontal') {
                // 对称规则 r ↔ last-r：中轴为数据行 last/2
                const mid = last / 2;
                pa = show(mid, 0); pb = show(mid, last);
            } else if (axis === 'vertical') {
                // 对称规则 c ↔ last-c：中轴为数据列 last/2
                const mid = last / 2;
                pa = show(0, mid); pb = show(last, mid);
            } else if (axis === 'diag1') {
                // 主对角线 r=c：数据 (0,0)（显示左下）↔ (last,last)（显示右上）
                pa = show(0, 0); pb = show(last, last);
            } else if (axis === 'diag2') {
                // 反对角线 r+c=last：数据 (0,last)（显示左上）↔ (last,0)（显示右下）
                pa = show(0, last); pb = show(last, 0);
            } else {
                ctx.restore();
                return;
            }
            ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.restore();
        }
        function drawBoardSymmetry() {
            const d = C.draw, cs = C.DEFAULT_CANVAS_SIZE, z = ps.CELL_SIZE, low = ps.showMoveNumbers || ps.showEstimateActive;
            d.clear(ctx, cs); d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, z, cs); d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, z);
            drawSymmetryAxisLine();
            const sr = z * 0.44, ml = z * 0.352;
            if (low) d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, z, sr, ps.BOARD_SIZE);
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, sr, ps.showMoveNumbers);
            if (!low) d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, z, ml, ps.BOARD_SIZE);
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, z, (r, c) =>
                !ps.showEstimateActive && r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE && ps.board[r][c] === 0);
            if (ps.showMoveNumbers) d.moveNumbersOnStones(ctx, numsSymmetry(), ps.board, ps.BOARD_SIZE, ps.PADDING, z);
            const hoverOpts = {
                tryPlayMode: ps.tryPlayMode, tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer, gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn, mySlot: ps.mySlot, isHoverValid: ps.isHoverValid,
                pageState: ps, editModeEnabled: !!ps.editModeEnabled, editTool: ps.editTool
            };
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, z, hoverOpts);
            // 对称点同步悬停（须用下一手镜面轴，否则白方会画到上一手轴的错误位置）
            const axis = getCurrentSymmetryAxis();
            if (ps.isHoverValid && ps.hoverRow >= 0 && ps.hoverCol >= 0 && axis) {
                const mp = getMP(ps.hoverRow, ps.hoverCol, axis);
                if (!(mp.row === ps.hoverRow && mp.col === ps.hoverCol))
                    d.hoverPreviewStone(ctx, mp.row, mp.col, ps.board, ps.PADDING, z, hoverOpts);
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory)
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, z, ps.cachedLiveBoard, ps.cachedTerritory);
        }

        var page;
        function symmetrySync(state) {
            page.clearMobileMovePreview();
            if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = state.boardSize;
                ps.KOMI = (state.komi != null && Number.isFinite(state.komi)) ? state.komi : (ps.BOARD_SIZE <= 8 ? 5.25 : 4.25);
                ps.board = page.initBoardArray(ps.BOARD_SIZE);
                page.updateBoardGeometry();
                const sel = document.getElementById('boardSizeSelect'); if (sel) sel.value = ps.BOARD_SIZE;
            }
            ps.numberOfHands = state.numberOfHands || 1; ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false; ps.winner = state.winner || null;
            if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
            ps.serverSymmetryAxis = state.symmetryAxis || 'diag1';
            // 「启用的对称」以服务端为准（停用只改 games/symmetry-weiqi.js 一处；这里只是兜底默认）
            if (Array.isArray(state.enabledSymmetries) && state.enabledSymmetries.length) {
                ps.enabledSymmetries = state.enabledSymmetries.filter((ax) => SYMMETRY_TYPES.indexOf(ax) >= 0);
            }
            if (state.moveCoords) ps.moveLog = state.moveCoords.map(m => {
                if (m.type !== 'move') return null;
                const en = [{ row: m.row, col: m.col }];
                if (m.symmetryAxis) { const mp = getMP(m.row, m.col, m.symmetryAxis); if (!(mp.row === m.row && mp.col === m.col)) en.push({ row: mp.row, col: mp.col }); }
                return en;
            });
            if (state.slots) ps.slots = state.slots;
            if (!ps.replayMode) {
                const prevT = Math.max(0, ps.liveReplayBoards.length - 1), wasEnd = ps.liveFollowLatest || ps.liveViewStep >= prevT;
                const syncedLen = ps.liveReplayBoards.length - 1;
                const mcs = state.moveCoords || [];
                if (syncedLen >= 0 && mcs.length > syncedLen && applyLiveReplayIncremental(mcs)) {
                } else {
                    rebuildLive(mcs);
                }
                const newT = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newT === 0) { ps.liveViewStep = 0; ps.liveFollowLatest = true; }
                else if (wasEnd) { ps.liveViewStep = newT; ps.liveFollowLatest = true; }
                else { ps.liveViewStep = Math.min(ps.liveViewStep, newT); if (ps.liveViewStep === newT) ps.liveFollowLatest = true; }
                if (!ps.tryPlayMode) {
                    applyLiveView();
                    if (ps.liveFollowLatest && ps.liveViewStep === newT) ps.symmetryAxis = ps.serverSymmetryAxis;
                    page.updateLiveReplayPanelUI();
                }
            } else if (!ps.tryPlayMode) {
                ps.board = state.board; ps.lastMoveMarkers = state.lastMoveMarkers || []; ps.symmetryAxis = state.symmetryAxis || 'diag1';
            }
            const hasS = ps.board.some(row => row.some(v => v !== 0)), hasP = ps.slots.player1 || ps.slots.player2;
            const sel = document.getElementById('boardSizeSelect');
            if (!hasS && !hasP && !ps.gameOver && ps.mySlot === null) sel.style.display = 'inline-block'; else sel.style.display = 'none';
            if (ps.showEstimateActive) { ps.cachedLiveBoard = page.removeDeadAndDying(ps.board); ps.cachedTerritory = page.assignTerritoryWithRange(ps.cachedLiveBoard); page.showEstimate(); }
            else page.updateTurn();
            page.updateReplayUI();
        }

        // 标准围棋：形势判断/数点用 Benson 档（公共钩子；档位见 shell.useBenson）
        const scoringHooks = QiWeiqiSquarePageRuntime.weiqiScoringHooks(config.useBenson !== false, {
            boardSize: () => ps.BOARD_SIZE,
            maxWeakLiberties: 2
        });

        page = R.create(ps, domPage, {
            recordDownloadPrefix, minLib, maxWeakLiberties: 2, gameType, roomId, roomPassword, isMouseDevice,
            ...scoringHooks,
            enableEditBoard: true,
            drawBoard: drawBoardSymmetry, syncState: symmetrySync,
            rebuildLiveReplayFromMoveCoords: rebuildLive, applyLiveViewBoard: applyLiveView,
            enterReplayMode(data) {
                const n = ps.BOARD_SIZE;
                ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = [0]; ps.replaySymmetryAxes = [null];
                let cur = Array(n).fill().map(() => Array(n).fill(0));
                if (data.initialPosition) {
                    if (Array.isArray(data.initialPosition)) R.applyInitialPositionCompact(cur, n, data.initialPosition);
                    else {
                        for (const pos of data.initialPosition.black || []) if (Array.isArray(pos) && pos.length === 2) cur[pos[0]][pos[1]] = 1;
                        for (const pos of data.initialPosition.white || []) if (Array.isArray(pos) && pos.length === 2) cur[pos[0]][pos[1]] = 2;
                    }
                }
                ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
                let curAx = 'diag1';
                for (const mv of (data.moves || [])) {
                    const pv = mv.player === 'player1' ? 1 : 2;
                    ps.replayStepPlayers.push(pv);
                    if (mv.type === 'move') {
                        const ax = mv.symmetryAxis || curAx;
                        ps.replaySymmetryAxes.push(ax);
                        const nb = trySymmetry(cur, mv.row, mv.col, pv, ax);
                        if (nb) cur = nb;
                        const mk = [{ row: mv.row, col: mv.col, color: pv }];
                        const mp = getMP(mv.row, mv.col, ax);
                        if (!(mp.row === mv.row && mp.col === mv.col) && cur[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                        ps.replayBoards.push(dc(cur)); ps.replayMarkers.push(mk);
                        curAx = nextAxis(ps.replayBoards.length);
                    } else if (mv.type === 'pass') {
                        ps.replaySymmetryAxes.push(null); ps.replayBoards.push(dc(cur)); ps.replayMarkers.push([]);
                        curAx = nextAxis(ps.replayBoards.length);
                    }
                }
                ps.replayTotalSteps = ps.replayBoards.length - 1; ps.replayMode = true;
                document.getElementById('replaySlider').max = ps.replayTotalSteps;
                page.setReplayStep(ps.replayTotalSteps); page.updateReplayUI();
            },
            exitReplayMode() {
                page.clearMobileMovePreview();
                ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = []; ps.tryPlayStepAxes = []; ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                ps.replayMode = false; ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = []; ps.replaySymmetryAxes = [];
                ps.replayStep = 0; ps.replayTotalSteps = 0;
                page.updateReplayUI();
            },
            setReplayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
                ps.replayStep = step; ps.board = dc(ps.replayBoards[step]); ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));
                ps.symmetryAxis = ps.replaySymmetryAxes[step];
                document.getElementById('replaySlider').value = step;
                document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;
                turnDisplay.innerText = step === 0 ? '初始局面' : `${ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪'} 第${step}手`;
                ps.isMyTurn = false;
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardSymmetry();
            },
            enterTryPlay() {
                page.clearMobileMovePreview(); const fromLive = !ps.replayMode;
                ps.tryPlayFromLive = fromLive; ps.tryPlayFromLiveStep = ps.liveViewStep || 0;
                ps.tryPlayMode = true; ps.tryPlayBaseStep = ps.replayStep;
                ps.tryPlayBoards = [dc(ps.board)]; ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];
                ps.tryPlaySymmetryAxis = ps.symmetryAxis; ps.tryPlayStepAxes = [ps.replaySymmetryAxes[ps.replayStep]];
                {
                    const RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
                    ps.tryPlayCurrentPlayer = RT && RT.resolveTryPlaySideToMove
                        ? RT.resolveTryPlaySideToMove({
                            fromLive,
                            replayStep: ps.replayStep,
                            replayStepPlayers: ps.replayStepPlayers,
                            liveViewStep: ps.liveViewStep,
                            liveReplayStepPlayers: ps.liveReplayStepPlayers,
                            liveReplayBoardsLength: (ps.liveReplayBoards && ps.liveReplayBoards.length) || 0,
                            currentPlayer: ps.currentPlayer
                        })
                        : (ps.replayStep === 0 ? 1 : (ps.replayStepPlayers[ps.replayStep] === 1 ? 2 : 1));
                    ps.tryPlayBasePlayer = ps.tryPlayCurrentPlayer;
                }
                if (fromLive) {
                    // 挂 replayMode 脚手架（与公共 enterTryPlay 一致）：直播进入试下时点击/绘制按 replayMode && tryPlayMode 判断
                    ps.replayMode = true;
                    ps.replayBoards = [dc(ps.board)];
                    ps.replayMarkers = [(ps.lastMoveMarkers || []).map(m => ({ ...m }))];
                    ps.replayStepPlayers = [ps.tryPlayCurrentPlayer === 1 ? 2 : 1];
                    ps.replayStep = 0; ps.replayTotalSteps = 0;
                }
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0; sl.max = 0; sl.value = 0;
                page.updateTryPlayDisplay(); page.updateReplayUI();
            },
            exitTryPlay() {
                page.clearMobileMovePreview();
                // 从直播进入试下的要退回直播局面（与公共 exitTryPlay 一致），而不是走打谱 setReplayStep
                const fromLive = !!ps.tryPlayFromLive;
                const savedLiveStep = ps.tryPlayFromLiveStep != null ? ps.tryPlayFromLiveStep : ps.liveViewStep;
                const snapBoard = fromLive && ps.tryPlayBoards.length > 0 ? dc(ps.tryPlayBoards[0]) : null;
                const snapMarkers = fromLive && ps.tryPlayMarkers.length > 0 && ps.tryPlayMarkers[0]
                    ? ps.tryPlayMarkers[0].map(m => ({ ...m }))
                    : [];
                ps.tryPlayMode = false; ps.tryPlayBoards = []; ps.tryPlayMarkers = []; ps.tryPlayStepAxes = [];
                ps.tryPlayFromLive = false;
                if ('tryPlayFromLiveStep' in ps) ps.tryPlayFromLiveStep = null;
                ps.tryPlayStep = 0; ps.tryPlayTotalSteps = 0;
                const sl = document.getElementById('replaySlider'); sl.min = 0;
                if (fromLive) {
                    ps.replayMode = false; ps.replayBoards = []; ps.replayMarkers = []; ps.replayStepPlayers = [];
                    ps.replayStep = 0; ps.replayTotalSteps = 0;
                    if (snapBoard) {
                        ps.board = snapBoard;
                        ps.lastMoveMarkers = snapMarkers.map(m => ({ ...m }));
                        if (ps.liveReplayBoards.length > 0) {
                            const step = Math.min(Math.max(0, savedLiveStep), ps.liveReplayBoards.length - 1);
                            ps.liveReplayBoards[step] = dc(snapBoard);
                            if (!ps.liveReplayMarkers[step]) ps.liveReplayMarkers[step] = [];
                            ps.liveReplayMarkers[step] = snapMarkers.map(m => ({ ...m }));
                            ps.liveViewStep = step;
                        } else {
                            ps.liveReplayBoards = [dc(snapBoard)];
                            ps.liveReplayMarkers = [snapMarkers.map(m => ({ ...m }))];
                            ps.liveReplayStepPlayers = [0];
                            ps.liveViewStep = 0;
                        }
                    } else if (typeof page.applyLiveViewBoard === 'function') {
                        page.applyLiveViewBoard();
                    }
                    page.updateLiveReplayPanelUI();
                    if (ps.showEstimateActive) page.showEstimate(); else page.updateTurn();
                } else {
                    sl.max = ps.replayTotalSteps;
                    page.setReplayStep(ps.tryPlayBaseStep);
                }
                page.updateReplayUI();
            },
            tryPlayMove(row, col) {
                if (ps.board[row][col] !== 0) return false;
                const pv = ps.tryPlayCurrentPlayer, nb = trySymmetry(ps.board, row, col, pv, ps.tryPlaySymmetryAxis);
                if (!nb) return false;
                if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                    ps.tryPlayBoards.length = ps.tryPlayStep + 1; ps.tryPlayMarkers.length = ps.tryPlayStep + 1; ps.tryPlayStepAxes.length = ps.tryPlayStep + 1;
                }
                ps.tryPlayStepAxes.push(ps.tryPlaySymmetryAxis);
                const mk = [{ row, col, color: pv }], mp = getMP(row, col, ps.tryPlaySymmetryAxis);
                if (!(mp.row === row && mp.col === col) && nb[mp.row][mp.col] === pv) mk.push({ row: mp.row, col: mp.col, color: pv });
                ps.tryPlayBoards.push(dc(nb)); ps.tryPlayMarkers.push(mk);
                ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1; ps.tryPlayStep = ps.tryPlayTotalSteps;
                ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
                ps.tryPlaySymmetryAxis = nextAxis(ps.tryPlayBaseStep + ps.tryPlayStep + 1);
                ps.board = dc(nb); ps.lastMoveMarkers = mk.map(m => ({ ...m }));
                const sl = document.getElementById('replaySlider'); sl.max = ps.tryPlayTotalSteps; sl.value = ps.tryPlayStep;
                page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardSymmetry();
                return true;
            },
            setTryPlayStep(step) {
                page.clearMobileMovePreview();
                if (step < 0) step = 0; if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
                ps.tryPlayStep = step; ps.board = dc(ps.tryPlayBoards[step]); ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));
                const baseP = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                    ? ps.tryPlayBasePlayer
                    : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
                ps.tryPlayCurrentPlayer = step % 2 === 0 ? baseP : (3 - baseP);
                ps.tryPlaySymmetryAxis = nextAxis(ps.tryPlayBaseStep + step + 1);
                document.getElementById('replaySlider').value = step; page.updateTryPlayDisplay();
                if (ps.showEstimateActive) page.showEstimate(); else drawBoardSymmetry();
            }
        });
        const _setLive = page.setLiveViewStep;
        page.setLiveViewStep = function (step) {
            _setLive(step);
            // applyLiveView 在跟最新时已写入 serverSymmetryAxis；此处仅兜底
            const t = Math.max(0, ps.liveReplayBoards.length - 1);
            if (ps.liveFollowLatest && ps.liveViewStep === t)
                ps.symmetryAxis = ps.serverSymmetryAxis || ps.symmetryAxis || 'diag1';
        };
        const {
            mobileTwoStepPlacing, clearMobileMovePreview, drawBoard, updateTurn, showEstimate, clearEstimate, downloadRecord,
            showScoreConfirm, hideScoreConfirm, enterReplayMode, exitReplayMode, setReplayStep, updateReplayUI,
            enterTryPlay, exitTryPlay, tryPlayMove, setTryPlayStep, updateTryPlayDisplay, rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard, updateLiveReplayPanelUI, setLiveViewStep, connectWebSocket, initBoardArray, updateBoardGeometry,
            syncState, commitMove, getClosestIntersection, canvasCoordsFromClient, applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId, gameType, pageState: ps, drawBoard, exitTryPlay, enterTryPlay, setTryPlayStep, setReplayStep, setLiveViewStep,
            getWs: () => ps.ws, getBoardSize: () => ps.BOARD_SIZE, setBoardSize: (n) => { ps.BOARD_SIZE = n; },
            getKomi: () => ps.KOMI, setKomi: (n) => { ps.KOMI = n; if (komiInfo) QiWeiqiSquarePageRuntime.writeKomiInfoText(komiInfo, ps.KOMI, ps.BOARD_SIZE * ps.BOARD_SIZE); },
            getBoard: () => ps.board, setBoard: (b) => { ps.board = b; }, getSlots: () => ps.slots, setSlots: (s) => { ps.slots = s; },
            getMySlot: () => ps.mySlot, setMySlot: (s) => { ps.mySlot = s; }, getGameOver: () => ps.gameOver, setGameOver: (v) => { ps.gameOver = v; },
            getWinner: () => ps.winner, setWinner: (w) => { ps.winner = w; }, getReplayMode: () => ps.replayMode,
            getShowEstimateActive: () => ps.showEstimateActive, setShowEstimateActive: (v) => { ps.showEstimateActive = v; },
            getWaitingScoreConfirm: () => ps.waitingScoreConfirm, setWaitingScoreConfirm: (v) => { ps.waitingScoreConfirm = v; },
            getIRejected: () => ps.iRejected, setIRejected: (v) => { ps.iRejected = v; },
            colorStatus, scoreTitle, turnDisplay, syncState, updateBoardGeometry, initBoardArray,
            exitReplayMode, clearEstimate, hideScoreConfirm, showEstimate, clearMobileMovePreview, downloadRecord, enterReplayMode, updateTurn, updateReplayUI,
            showScoreConfirm, isMouseDevice, onNewGameStarted: () => { colorStatus.innerText = '未选择阵营'; },
            standardWeiqiMatchTime,
            boardSeatOverlay: true
        });
        (function wrapReplayNewGame() {
            const b = document.getElementById('newGameBtn'); if (!b) return;
            const p = b.onclick;
            b.onclick = () => { if (ps.replayMode) { if (ps.ws && ps.ws.readyState === WebSocket.OPEN) ps.ws.send(JSON.stringify({ type: 'resetRoom' })); return; } if (typeof p === 'function') p(); };
        })();
        const handleMessage = _weiqiBindings.handleMessage;

        let suppressCanvasClickAfterLongMark = false;
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        });
        const LONG_MARK_MS = 500, LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null, longMarkStart = null;
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0]; longMarkStart = { x: t.clientX, y: t.clientY };
            longMarkTimer = setTimeout(() => {
                longMarkTimer = null; if (!longMarkStart) return;
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                const { row, col } = getClosestIntersection(x, y);
                applyUserBoardMark(row, col); suppressCanvasClickAfterLongMark = true;
                setTimeout(() => { suppressCanvasClickAfterLongMark = false; }, 450); longMarkStart = null;
            }, LONG_MARK_MS);
        }, { passive: true });
        canvas.addEventListener('touchmove', (e) => {
            if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - longMarkStart.x, dy = t.clientY - longMarkStart.y;
            if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) { clearTimeout(longMarkTimer); longMarkTimer = null; }
        }, { passive: true });
        function clearLongMarkTouch() { if (longMarkTimer) { clearTimeout(longMarkTimer); longMarkTimer = null; } longMarkStart = null; }
        canvas.addEventListener('touchend', clearLongMarkTouch); canvas.addEventListener('touchcancel', clearLongMarkTouch);
        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) { e.preventDefault(); return; }
            const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
            const x = (e.clientX - rect.left) * sc, y = (e.clientY - rect.top) * sc;
            const { row, col } = getClosestIntersection(x, y);
            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
                if (ps.board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); tryPlayMove(row, col); }
                    else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                    return;
                }
                tryPlayMove(row, col); return;
            }
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return;
            if (row < 0 || col < 0) { if (mobileTwoStepPlacing()) clearMobileMovePreview(); drawBoard(); return; }
            if (ps.board[row][col] !== 0) return;
            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) { clearMobileMovePreview(); commitMove(row, col); drawBoard(); }
                else { ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = true; drawBoard(); }
                return;
            }
            commitMove(row, col);
        });
        if (isMouseDevice) {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect(), sc = 600 / rect.width;
                const { row, col } = getClosestIntersection((e.clientX - rect.left) * sc, (e.clientY - rect.top) * sc);
                ps.hoverRow = row; ps.hoverCol = col; ps.isHoverValid = row >= 0 && col >= 0 && ps.board[row][col] === 0; drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
            });
        }
        if (scoreConfirmYes) {
            scoreConfirmYes.onclick = () => { ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: true })); hideScoreConfirm(); };
            scoreConfirmNo.onclick = () => {
                ps.iRejected = true; ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false })); hideScoreConfirm();
                if (ps.showEstimateActive) { ps.showEstimateActive = false; clearEstimate(); }
                ps.waitingScoreConfirm = false;
            };
        }

        connectWebSocket(handleMessage);
        })();
    }
};
