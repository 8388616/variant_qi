window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['mirror-weiqi'] = {
    shell: {
        "title": "镜子围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />开局随机布置镜子，数量约为棋盘总点数的8.3%。镜子提供气，也可以落子；被棋子覆盖后永久消失。<br /><br />镜子的斜边是镜子的方向。落子时，会经过上下左右四个方向面向落子的点的镜子反射，在反射点同时落子；如果在反射途中又遇到其它镜子，则继续反射。若遇到背对的镜子，则穿过。<br /><br />若反射点已经有棋子，则不再落子；若反射点有镜子，则落子同时清除镜子。<br /><br />",
        "defaultKomiText": "黑贴白4.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 31,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "镜子围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "editBoard": true,
            "compoundPalette": false,
            "zoomScroll": false,
            "holeStyle": false
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
            },
            { "value": "mirrorUL", "label": "镜子 ↖", "cellValue": -40 },
            { "value": "mirrorDL", "label": "镜子 ↙", "cellValue": -41 },
            { "value": "mirrorUR", "label": "镜子 ↗", "cellValue": -42 },
            { "value": "mirrorDR", "label": "镜子 ↘", "cellValue": -43 }
        ]
    },
    mount: function (ctx) {
        // Keep these rules in sync with games/mirror-weiqi.js.
        const mirrorRules = (() => {
            'use strict';
            const MIRROR = -4;
            const DIRECTIONS = ['UL', 'DL', 'UR', 'DR'];
            const vectors = { U: [1, 0], D: [-1, 0], L: [0, -1], R: [0, 1] };
            const opposite = { U: 'D', D: 'U', L: 'R', R: 'L' };
            const isStone = (v) => v === 1 || v === 2;
            const canPlace = (v) => v === 0 || v === MIRROR;
            const copy = (board) => board.map(row => row.slice());

            function reflect(direction, travel) {
                if (!DIRECTIONS.includes(direction)) return null;
                const incoming = opposite[travel];
                if (!direction.includes(incoming)) return null;
                return direction[0] === incoming ? direction[1] : direction[0];
            }

            // Each ray searches for its first usable mirror, then travels that same
            // distance again. Later reflections turn the ray without resetting its budget.
            function destinations(board, directions, row, col) {
                const size = board.length;
                const inside = (r, c) => r >= 0 && r < size && c >= 0 && c < size;
                const points = new Map([[`${row},${col}`, { row, col }]]);
                for (const initial of Object.keys(vectors)) {
                    let r = row, c = col, travel = initial, distance = 0, remaining = null;
                    while (true) {
                        const [dr, dc] = vectors[travel];
                        r += dr;
                        c += dc;
                        if (!inside(r, c) || isStone(board[r][c])) break;
                        if (remaining !== null) {
                            remaining--;
                            // A mirror at the endpoint is covered, rather than turning
                            // a ray that has no distance left to travel.
                            if (remaining === 0) {
                                if (canPlace(board[r][c])) points.set(`${r},${c}`, { row: r, col: c });
                                break;
                            }
                        } else distance++;
                        if (board[r][c] !== MIRROR) continue;
                        const next = reflect(directions[r] && directions[r][c], travel);
                        if (!next) continue;
                        if (remaining === null) remaining = distance;
                        travel = next;
                    }
                }
                return [...points.values()];
            }

            function removeDead(board, color) {
                const size = board.length, visited = new Set(), dead = [];
                for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
                    if (board[r][c] !== color || visited.has(`${r},${c}`)) continue;
                    const group = [[r, c]];
                    visited.add(`${r},${c}`);
                    let liberty = false;
                    for (let i = 0; i < group.length; i++) {
                        const [gr, gc] = group[i];
                        for (const [dr, dc] of Object.values(vectors)) {
                            const nr = gr + dr, nc = gc + dc;
                            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                            const v = board[nr][nc], key = `${nr},${nc}`;
                            if (canPlace(v)) liberty = true;
                            else if (v === color && !visited.has(key)) {
                                visited.add(key);
                                group.push([nr, nc]);
                            }
                        }
                    }
                    if (!liberty) dead.push(...group);
                }
                for (const [r, c] of dead) board[r][c] = 0;
            }

            function tryPlaceStone(board, directions, row, col, color) {
                if (!Number.isInteger(row) || !Number.isInteger(col) || !board[row]
                    || !canPlace(board[row][col]) || !isStone(color)) return null;
                const points = destinations(board, directions, row, col);
                const next = copy(board);
                for (const p of points) next[p.row][p.col] = color;
                removeDead(next, 3 - color);
                removeDead(next, color);
                Object.defineProperty(next, 'moveMarkers', {
                    value: points.map(p => ({ ...p, color }))
                });
                return next;
            }

            function parseInitial(initialPosition, size) {
                const directions = Array.from({ length: size }, () => Array(size).fill(null));
                for (const entry of initialPosition || []) {
                    if (typeof entry !== 'string' || entry[0] !== 'J') continue;
                    const match = /^J(\d+),(\d+),(UL|DL|UR|DR)$/.exec(entry);
                    if (!match || +match[1] >= size || +match[2] >= size)
                        throw new Error('镜子初始位置须为 J行,列,方向（UL/DL/UR/DR）');
                    directions[+match[1]][+match[2]] = match[3];
                }
                return directions;
            }

            function encodeInitial(board, directions) {
                const out = [];
                for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
                    const v = board[r][c];
                    if (v === 1 || v === 2) out.push(`${v === 1 ? 'B' : 'W'}${r},${c}`);
                    else if (v === MIRROR) out.push(`J${r},${c},${directions[r][c]}`);
                }
                return out;
            }

            return { MIRROR, DIRECTIONS, canPlace, reflect, destinations, tryPlaceStone, parseInitial, encodeInitial };
        })();
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "镜子围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        /** 镜子围棋贴目（按路数，与服务端 komiForSizeMirror 一致）：7 路 4.75，其余（含默认 19 路）4.25 */
        function komiForSizeMirror(boardSize) {
            if (boardSize === 7) return 4.75;
            return 4.25;
        }

		const ps = {
            BOARD_SIZE: 19,
            KOMI: komiForSizeMirror(19),
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
            isHoverValid: false,
            mirrorDirections: [],
            liveOpeningBoard: null,
            gameStarted: false,
            editModeEnabled: false,
            editTool: 'empty'
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
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
        const scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');
        const styleSelect = document.getElementById('styleSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const R = () => QiWeiqiSquarePageRuntime;

        function mirrorTryPlaceStone(boardBefore, row, col, playerVal) {
            return mirrorRules.tryPlaceStone(boardBefore, ps.mirrorDirections, row, col, playerVal);
        }

        function isStoneVal(v) {
            return v === 1 || v === 2;
        }

        function mirrorComputeStoneNumbers() {
            const nums = Array.from({ length: ps.BOARD_SIZE }, () => Array(ps.BOARD_SIZE).fill(0));
            const markers = ps.tryPlayMode ? ps.tryPlayMarkers
                : ps.replayMode ? ps.replayMarkers : ps.liveReplayMarkers;
            const step = ps.tryPlayMode ? ps.tryPlayStep
                : ps.replayMode ? ps.replayStep : ps.liveViewStep;
            for (let i = 1; i <= step; i++) {
                for (const m of markers[i] || []) {
                    if (ps.board[m.row] && isStoneVal(ps.board[m.row][m.col])) nums[m.row][m.col] = i;
                }
            }
            return nums;
        }

        function drawMirror(row, col, direction, preview) {
            if (!mirrorRules.DIRECTIONS.includes(direction)) return;
            const x = ps.PADDING + col * ps.CELL_SIZE;
            const y = ps.PADDING + (ps.BOARD_SIZE - 1 - row) * ps.CELL_SIZE;
            const a = ps.CELL_SIZE * 0.37;
            // The right angle is opposite the facing direction; the hypotenuse faces it.
            const sx = direction.includes('L') ? 1 : -1;
            const sy = direction.includes('U') ? 1 : -1;
            const corners = [
                { x: sx * a, y: sy * a },
                { x: sx * a, y: -sy * a },
                { x: -sx * a, y: sy * a }
            ];
            function triangle(points, dx = 0, dy = 0) {
                ctx.beginPath();
                ctx.moveTo(points[0].x + dx, points[0].y + dy);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x + dx, points[i].y + dy);
                ctx.closePath();
            }
            ctx.save();
            if (preview) ctx.globalAlpha = 0.6;
            ctx.translate(x, y);
            ctx.lineJoin = 'round';
            // One fixed light source above the board: backing and shadow extend straight down.
            const depth = ps.CELL_SIZE * 0.065;
            ctx.shadowColor = 'rgba(25, 20, 16, 0.42)';
            ctx.shadowBlur = ps.CELL_SIZE * 0.13;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = ps.CELL_SIZE * 0.07;
            triangle(corners, 0, depth);
            ctx.fillStyle = '#414b55';
            ctx.fill();
            ctx.shadowColor = 'transparent';

            const frame = ctx.createLinearGradient(0, -a, 0, a);
            frame.addColorStop(0, '#f5f7f9');
            frame.addColorStop(1, '#7b8791');
            triangle(corners);
            ctx.fillStyle = frame;
            ctx.fill();
            ctx.strokeStyle = '#727d86';
            ctx.lineWidth = ps.CELL_SIZE * 0.025;
            ctx.stroke();

            // Inset about the triangle's incenter to keep an even silver rim.
            const insetCenter = a * (Math.SQRT2 - 1);
            const glass = corners.map(p => ({
                x: sx * insetCenter + (p.x - sx * insetCenter) * 0.79,
                y: sy * insetCenter + (p.y - sy * insetCenter) * 0.79
            }));
            triangle(glass);
            // The glass also fades vertically, independent of the mirror's facing direction.
            const reflection = ctx.createLinearGradient(0, -a, 0, a);
            reflection.addColorStop(0, '#f4f7f9');
            reflection.addColorStop(1, '#9daab3');
            ctx.fillStyle = reflection;
            ctx.fill();

            // Bevels facing upward catch the light; downward-facing edges stay darker.
            const center = { x: sx * a / 3, y: sy * a / 3 };
            for (let i = 0; i < corners.length; i++) {
                const p = corners[i], q = corners[(i + 1) % corners.length];
                const dx = q.x - p.x, dy = q.y - p.y;
                let nx = dy, ny = -dx;
                if (nx * ((p.x + q.x) / 2 - center.x) + ny * ((p.y + q.y) / 2 - center.y) < 0) {
                    nx = -nx;
                    ny = -ny;
                }
                const lighting = -ny / Math.hypot(dx, dy);
                const silver = Math.round(153 + 100 * Math.max(0, lighting) - 65 * Math.max(0, -lighting));
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.strokeStyle = `rgb(${silver}, ${Math.min(255, silver + 4)}, ${Math.min(255, silver + 8)})`;
                ctx.lineWidth = ps.CELL_SIZE * 0.035;
                ctx.stroke();
            }
            ctx.restore();
        }

        function mirrorDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(ctx, cs);
            d.grid(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            for (let r = 0; r < ps.BOARD_SIZE; r++) for (let c = 0; c < ps.BOARD_SIZE; c++) {
                const v = ps.board[r][c];
                if (v === -4) drawMirror(r, c, (ps.mirrorDirections[r] || [])[c]);
                else if (v <= -40 && v >= -43) drawMirror(r, c, mirrorRules.DIRECTIONS[-40 - v]);
            }
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
            }
            function isUserBoardMarkVisibleAt(br, bc) {
                if (ps.showEstimateActive) return false;
                if (br < 0 || br >= ps.BOARD_SIZE || bc < 0 || bc >= ps.BOARD_SIZE) return false;
                // 点层标记可覆盖镜子；棋子盖住时不画。
                return !QiSquareWeiqiCanvas.isStoneCellValue(ps.board[br][bc]);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt,
                { board: ps.board, stoneMarks: ps.userStoneMarks, live: QiSquareWeiqiCanvas.boardMarksLiveLatest(ps) });
            if (ps.showMoveNumbers) {
                const nums = mirrorComputeStoneNumbers();
                d.moveNumbersOnStones(ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            const hoverOptions = {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid,
                hoverCapture: !!ps.hoverCapture,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool,
                canPlaceAt: (r, c) => mirrorRules.canPlace(ps.board[r][c])
            };
            if (ps.editModeEnabled) {
                d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, hoverOptions);
            } else if (ps.isHoverValid && !ps.waitingScoreConfirm
                && (ps.tryPlayMode || (!ps.gameOver && ps.isMyTurn))
                && ps.board[ps.hoverRow] && mirrorRules.canPlace(ps.board[ps.hoverRow][ps.hoverCol])) {
                // Use the same unchanged board as placement, including blockers and deduplication.
                const points = mirrorRules.destinations(ps.board, ps.mirrorDirections, ps.hoverRow, ps.hoverCol);
                for (const point of points) {
                    d.hoverPreviewStone(ctx, point.row, point.col, ps.board, ps.PADDING, cellSize, hoverOptions);
                }
            }
            if (ps.editModeEnabled && ps.isHoverValid && ps.editTool.startsWith('mirror')) {
                drawMirror(ps.hoverRow, ps.hoverCol, ps.editTool.slice(6), true);
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                const scoringBoard = ps.board.map(row => row.map(v => v === -4 ? 0 : v));
                d.estimateOverlay(ctx, scoringBoard, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        }

        const domPage = {
            turnDisplay,
            scoreTitle,
            scoreBoard,
            leadInfo,
            scoreConfirmPanel,
            scoreConfirmText,
            komiInfo,
            canvas,
            ctx,
            boardMarkSelect,
            colorStatus
        };

        const pageHolder = {};
        function mirrorBensonRemoveDead(srcBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            const source = srcBoard.map(row => row.map(v => v === -4 ? 0 : v));
            const size = ps.BOARD_SIZE;
            const copy = b => QiSquareWeiqiCanvas.deepCopyBoard(b);
            const benson = RT.bensonAliveWithHoles(source, size, () => false);
            let live = copy(source), changed = true;
            while (changed) {
                changed = false;
                const cleaned = RT.removeDeadAndDying(live, size, copy, 2);
                for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
                    const v = source[r][c];
                    if (benson.alive[r][c] && isStoneVal(v) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
                live = cleaned;
            }
            return live;
        }
        function mirrorBensonTerritory(liveBoard) {
            const RT = window.QiWeiqiSquarePageRuntime;
            const territory = RT.assignTerritoryWithRange(liveBoard, ps.BOARD_SIZE);
            const secure = RT.bensonAliveWithHoles(liveBoard, ps.BOARD_SIZE, () => false);
            for (let r = 0; r < ps.BOARD_SIZE; r++) for (let c = 0; c < ps.BOARD_SIZE; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
            return territory;
        }

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            editTools: config.editTools,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            // 镜子可落子并提供气，总点数为 N²。
            totalPoints: (p) => p.BOARD_SIZE * p.BOARD_SIZE,
            tryPlaceStone: mirrorTryPlaceStone,
            canPlaceAt: (r, c) => mirrorRules.canPlace(ps.board[r][c]),
            drawBoard: mirrorDrawBoard,
            removeDeadAndDying: mirrorBensonRemoveDead,
            assignTerritoryWithRange: mirrorBensonTerritory,
            rebuildLiveReplayFromMoveCoords(moveCoords) {
                const syncedLen = ps.liveReplayBoards.length - 1;
                const mcs = moveCoords || [];
                if (syncedLen >= 0 && mcs.length > syncedLen) {
                    const inc = R().applyLiveReplayIncrementalBoards(
                        ps.liveReplayBoards, ps.liveReplayMarkers, ps.liveReplayStepPlayers,
                        mcs, mirrorTryPlaceStone, QiSquareWeiqiCanvas.deepCopyBoard);
                    if (inc.ok) return;
                }
                const ob = ps.liveOpeningBoard;
                const o = R().rebuildLiveReplayFromMoveCoords(
                    moveCoords,
                    mirrorTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    () => ob ? QiSquareWeiqiCanvas.deepCopyBoard(ob) : QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE)
                );
                ps.liveReplayBoards = o.liveReplayBoards;
                ps.liveReplayMarkers = o.liveReplayMarkers;
                ps.liveReplayStepPlayers = o.liveReplayStepPlayers;
            },
            enterReplayMode(data) {
                ps.mirrorDirections = mirrorRules.parseInitial(data.initialPosition, ps.BOARD_SIZE);
                function createEmptyBoard() {
                    return QiSquareWeiqiCanvas.initBoardArray(ps.BOARD_SIZE);
                }
                const built = R().buildReplayFromImportData(
                    { initialPosition: data.initialPosition, moves: data.moves || [] },
                    mirrorTryPlaceStone,
                    QiSquareWeiqiCanvas.deepCopyBoard,
                    createEmptyBoard
                );
                ps.replayBoards = built.replayBoards;
                ps.replayMarkers = built.replayMarkers;
                ps.replayStepPlayers = built.replayStepPlayers;
                ps.replayTotalSteps = built.replayTotalSteps;
                ps.replayMode = true;
                const slider = document.getElementById('replaySlider');
                slider.max = ps.replayTotalSteps;
                const p = pageHolder.page;
                if (p) {
                    p.setReplayStep(ps.replayTotalSteps);
                    p.updateReplayUI();
                }
            }
        });
        pageHolder.page = page;

        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard,
            updateTurn,
            showEstimate,
            clearEstimate,
            downloadRecord,
            showScoreConfirm,
            hideScoreConfirm,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            updateReplayUI,
            enterTryPlay,
            exitTryPlay,
            setTryPlayStep,
            updateTryPlayDisplay,
            applyLiveViewBoard,
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState: syncStateBase,
            getClosestIntersection,
            canvasCoordsFromClient,
            applyUserBoardMark,
            updateEditModeUI,
            clearEditModeUi
        } = page;

        // Mirror cells are playable; do not send them through an empty-only
        // ordinary-Go entry retained by an older shared page runtime.
        function commitMove(row, col) {
            if (ps.gameOver || !ps.isMyTurn || ps.waitingScoreConfirm) return false;
            if (!Number.isInteger(row) || !Number.isInteger(col) || !ps.board[row]
                || !mirrorRules.canPlace(ps.board[row][col])) return false;
            ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        function tryPlayMove(row, col) {
            const newBoard = mirrorTryPlaceStone(ps.board, row, col, ps.tryPlayCurrentPlayer);
            if (!newBoard) return false;
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
            }
            ps.tryPlayBoards.push(QiSquareWeiqiCanvas.deepCopyBoard(newBoard));
            ps.tryPlayMarkers.push(newBoard.moveMarkers);
            ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;
            ps.board = QiSquareWeiqiCanvas.deepCopyBoard(newBoard);
            ps.lastMoveMarkers = newBoard.moveMarkers;
            const slider = document.getElementById('replaySlider');
            slider.max = ps.tryPlayTotalSteps;
            slider.value = ps.tryPlayStep;
            updateTryPlayDisplay();
            if (ps.showEstimateActive) showEstimate();
            else drawBoard();
            return true;
        }

        function syncState(state) {
            if (state.mirrorDirections) ps.mirrorDirections = state.mirrorDirections;
            if (state.initialBoard && !ps.editModeEnabled) {
                // Use the server's normalized -4 cells, rather than temporary
                // directional edit commands retained in the local opening cache.
                ps.liveOpeningBoard = QiSquareWeiqiCanvas.deepCopyBoard(state.initialBoard);
                if (state.type === 'editBoardAccepted') {
                    ps._editCommitSnapshot = null;
                    ps._editCommitPending = false;
                    ps._editLocalBoard = null;
                }
            }
            ps.gameStarted = (state.numberOfHands || 1) > 1;
            syncStateBase(state);
            updateEditModeUI();
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
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
            // 物理总点数为 N²（限时默认值等用）。
            getTotalPoints: () => ps.BOARD_SIZE * ps.BOARD_SIZE,
            getKomi: () => ps.KOMI,
            setKomi: (n) => { ps.KOMI = n; },
            getBoard: () => ps.board.map(row => row.map(c => (c === -4 ? 0 : c))),
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
syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate,
            hideScoreConfirm,
            showEstimate,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm,
            isMouseDevice,
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            onNewGameStarted() {
                clearEditModeUi();
            },
            onBoardSizeChanged(msg) {
                syncState(msg);
            }
        });
        function handleMessage(msg) {
            _weiqiBindings.handleMessage(msg);
            if (msg.type === 'boardSizeChanged') _weiqiBindings.updateRadioStyles();
        }
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
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
                const { row, col } = getClosestIntersection(x, y);
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
            const { row, col } = getClosestIntersection(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoard();
                    return;
                }
                if (!mirrorRules.canPlace(ps.board[row][col])) return;
                if (mobileTwoStepPlacing()) {
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
            if (ps.gameOver) return;
            if (!ps.isMyTurn) return;
            if (ps.waitingScoreConfirm) return;

            if (row < 0 || col < 0) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoard();
                return;
            }
            if (!mirrorRules.canPlace(ps.board[row][col])) return;

            if (mobileTwoStepPlacing()) {
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

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoard(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && mirrorRules.canPlace(ps.board[row][col]));
                drawBoard();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    drawBoard();
                }
            });
        }

        if (scoreConfirmYes)
        {
            scoreConfirmYes.onclick = () => {
                ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
                hideScoreConfirm();
            };
            scoreConfirmNo.onclick = () => {
                ps.iRejected = true;
                ps.ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (ps.showEstimateActive) {
                    ps.showEstimateActive = false;
                    clearEstimate();
                }
                ps.waitingScoreConfirm = false;
            };
        }
        connectWebSocket(handleMessage);
        })();
    }
};
