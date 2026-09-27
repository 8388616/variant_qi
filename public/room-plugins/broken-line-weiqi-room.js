window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['broken-line-weiqi'] = {
    shell: {
        "title": "断线围棋",
        "rulesHtml": "基本规则同围棋。<br /><br />棋盘上随机切断一些相邻点之间的连线。被切断的两个点不再相连，互相不提供气<br /><br />",
        "defaultKomiText": "黑贴白3.25点",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "断线围棋",
        "useBenson": true,
        "standardWeiqiMatchTime": true,
        "features": {
            "showEstimate": true,
            "woodTexture": true,
            "zoomScroll": true,
            "editBoard": true,
            "compoundPalette": false
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
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "围棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        const ps = {
            BOARD_SIZE: 19,
            KOMI: 3.25,
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
            /** 棋盘局部缩放（与 qi.js QiWeiqiSquarePageRuntime 视口变换配合） */
            viewZoom: 1,
            viewCenterX: 300,
            viewCenterY: 300,
            /** 断线：[[r1,c1,r2,c2], …]（服务端下发；棋谱也带上） */
            brokenEdges: [],
            /** 断线：由 brokenEdges 懒生成的位掩码（1=上 2=下 4=左 8=右），加速邻接查询 */
            cutMask: null,
            cutMaskSrc: null,
            cutMaskSize: 0
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

        // DOM
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

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const BOARD_VIEW_CS = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
        let boardScrollbarProgrammatic = false;

        function viewCenterBoundsForScrollbars() {
            const z = Math.max(1, Math.min(10, ps.viewZoom || 1));
            const half = (BOARD_VIEW_CS / 2) / z;
            return {
                minX: half,
                maxX: BOARD_VIEW_CS - half,
                minY: half,
                maxY: BOARD_VIEW_CS - half
            };
        }

        function clampBoardView() {
            let z = ps.viewZoom;
            if (!Number.isFinite(z)) z = 1;
            z = Math.max(1, Math.min(10, z));
            ps.viewZoom = z;
            if (z <= 1) {
                ps.viewCenterX = BOARD_VIEW_CS / 2;
                ps.viewCenterY = BOARD_VIEW_CS / 2;
                return;
            }
            const half = (BOARD_VIEW_CS / 2) / z;
            ps.viewCenterX = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterX));
            ps.viewCenterY = Math.min(BOARD_VIEW_CS - half, Math.max(half, ps.viewCenterY));
        }

        /** 落座蒙版显示时不允许缩放（含对局中途再入座） */
        function boardViewZoomAllowed() {
            const o = document.querySelector('.board-container > .qi-seat-overlay');
            return !(o && !o.hidden);
        }

        function resetBoardViewZoom() {
            ps.viewZoom = 1;
            ps.viewCenterX = BOARD_VIEW_CS / 2;
            ps.viewCenterY = BOARD_VIEW_CS / 2;
            syncScrollbarsFromView();
            boardUpdateGrabCursor();
        }

        function applyZoomKeepingScreenPoint(ssx, ssy, zNew) {
            const z0 = ps.viewZoom;
            const cs = BOARD_VIEW_CS;
            const Lx = (ssx - cs / 2) / z0 + ps.viewCenterX;
            const Ly = (ssy - cs / 2) / z0 + ps.viewCenterY;
            ps.viewZoom = zNew;
            ps.viewCenterX = Lx - (ssx - cs / 2) / zNew;
            ps.viewCenterY = Ly - (ssy - cs / 2) / zNew;
            clampBoardView();
        }

        function syncScrollbarsFromView() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            if (ps.viewZoom <= 1) {
                sx.style.display = 'none';
                sy.style.display = 'none';
                return;
            }
            sx.style.display = 'block';
            sy.style.display = 'block';
            const b = viewCenterBoundsForScrollbars();
            const spanX = b.maxX - b.minX;
            const spanY = b.maxY - b.minY;
            boardScrollbarProgrammatic = true;
            sx.value = spanX > 1e-6 ? String(Math.round((ps.viewCenterX - b.minX) / spanX * 1000)) : '500';
            sy.value = spanY > 1e-6 ? String(Math.round((b.maxY - ps.viewCenterY) / spanY * 1000)) : '500';
            boardScrollbarProgrammatic = false;
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
        /* ================= 断线：邻接 / 客户端孪生规则 / 形势判断 ================= */

        /** 从 (r,c) 指向 (r+dr,c+dc) 的方向位（1=上 2=下 4=左 8=右） */
        function cutDirBit(dr, dc) {
            if (dr === -1) return 1;
            if (dr === 1) return 2;
            if (dc === -1) return 4;
            return 8;
        }

        function isValidPoint(r, c) {
            return r >= 0 && r < ps.BOARD_SIZE && c >= 0 && c < ps.BOARD_SIZE;
        }

        /** 断线列表 → 位掩码（列表或路数变了才重建；掩码边长取「路数」与「最大坐标+1」的较大者） */
        function cutMask() {
            if (ps.cutMask && ps.cutMaskSrc === ps.brokenEdges && ps.cutMaskSize === ps.BOARD_SIZE)
                return ps.cutMask;
            const list = ps.brokenEdges || [];
            let dim = ps.BOARD_SIZE;
            for (const e of list) {
                if (!Array.isArray(e) || e.length !== 4) continue;
                dim = Math.max(dim, (e[0] | 0) + 1, (e[2] | 0) + 1);
            }
            const mask = Array(dim).fill().map(() => Array(dim).fill(0));
            for (const e of list) {
                if (!Array.isArray(e) || e.length !== 4) continue;
                const r1 = e[0] | 0, c1 = e[1] | 0, r2 = e[2] | 0, c2 = e[3] | 0;
                if (!isValidPoint(r1, c1) || !isValidPoint(r2, c2)) continue;
                if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) continue;
                mask[r1][c1] |= cutDirBit(r2 - r1, c2 - c1);
                mask[r2][c2] |= cutDirBit(r1 - r2, c1 - c2);
            }
            ps.cutMask = mask;
            ps.cutMaskSrc = ps.brokenEdges;
            ps.cutMaskSize = ps.BOARD_SIZE;
            return mask;
        }

        /** 这两个相邻点之间的线是否被切断 */
        function isCutEdge(r1, c1, r2, c2) {
            if (!isValidPoint(r1, c1) || !isValidPoint(r2, c2)) return false;
            if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
            const m = cutMask();
            return (m[r1][c1] & cutDirBit(r2 - r1, c2 - c1)) !== 0;
        }

        /** 公共层要的邻居函数：四邻里**没被切断**的点（气 / 棋组 / Benson / 归属全走它） */
        function cutNeighbors(r, c) {
            const n = ps.BOARD_SIZE;
            if (r < 0 || r >= n || c < 0 || c >= n) return [];
            const bits = cutMask()[r][c];       // 掩码边长 ≥ 路数，越界断线项已按点判过
            const out = [];
            if (r > 0 && !(bits & 1)) out.push([r - 1, c]);
            if (r + 1 < n && !(bits & 2)) out.push([r + 1, c]);
            if (c > 0 && !(bits & 4)) out.push([r, c - 1]);
            if (c + 1 < n && !(bits & 8)) out.push([r, c + 1]);
            return out;
        }

        /* 客户端孪生：断线版的气 / 提组 / 落子（与服务端 gridGraphWeiqiRules 同口径） */

        function countLibertiesOn(board, row, col) {
            const color = board[row][col];
            if (color === 0) return 0;
            const visited = new Set([row + ',' + col]);
            const queue = [[row, col]];
            const liberties = new Set();
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [nr, nc] of cutNeighbors(r, c)) {
                    if (board[nr] === undefined || board[nr][nc] === undefined) continue;
                    if (board[nr][nc] === 0) liberties.add(nr + ',' + nc);
                    else if (board[nr][nc] === color && !visited.has(nr + ',' + nc)) {
                        visited.add(nr + ',' + nc);
                        queue.push([nr, nc]);
                    }
                }
            }
            return liberties.size;
        }

        function removeGroupOn(board, row, col, color) {
            const queue = [[row, col]];
            board[row][col] = 0;
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [nr, nc] of cutNeighbors(r, c)) {
                    if (board[nr] === undefined || board[nr][nc] === undefined) continue;
                    if (board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function cutTryPlaceStone(boardBefore, row, col, playerVal) {
            if (!isValidPoint(row, col) || boardBefore[row][col] !== 0) return null;
            const newBoard = QiSquareWeiqiCanvas.deepCopyBoard(boardBefore);
            newBoard[row][col] = playerVal;
            const enemyColor = 3 - playerVal;
            const checked = new Set();
            for (const [nr, nc] of cutNeighbors(row, col)) {
                if (newBoard[nr] === undefined || newBoard[nr][nc] !== enemyColor) continue;
                const k = nr + ',' + nc;
                if (checked.has(k)) continue;
                checked.add(k);
                if (countLibertiesOn(newBoard, nr, nc) < 1) removeGroupOn(newBoard, nr, nc, enemyColor);
            }
            if (countLibertiesOn(newBoard, row, col) < 1) removeGroupOn(newBoard, row, col, playerVal);
            return newBoard;
        }

        /**
         * 形势判断 / 数点：与普通围棋同一档（弱气去死子 ↔ Benson 保活 → 空点归属 → 确定领地覆盖），
         * 但气 / 死子 / 空点归属全部按**断线后的邻接**算 —— 归属里的「距离扩张」是图上 BFS 距离，
         * 所以距离不会穿过断线（服务端 computeLead 同口径）。
         */
        function breakageScoringHooks() {
            const ops = () => QiWeiqiSquarePageRuntime.gridGraphWeiqiScoringOps(
                ps.BOARD_SIZE, ps.BOARD_SIZE, cutNeighbors, isValidPoint
            );
            return {
                removeDeadAndDying(srcBoard) {
                    const o = ops();
                    const benson = o.bensonAlive(srcBoard);
                    let live = o.copyBoard(srcBoard);
                    let changed = true;
                    while (changed) {
                        changed = false;
                        const cleaned = o.removeDeadAndDying(live);
                        for (let r = 0; r < srcBoard.length; r++) {
                            const row = srcBoard[r];
                            for (let c = 0; c < row.length; c++) {
                                if (benson.alive[r][c] && (row[c] === 1 || row[c] === 2) && cleaned[r][c] !== row[c]) {
                                    cleaned[r][c] = row[c];
                                    changed = true;
                                }
                            }
                        }
                        live = cleaned;
                    }
                    return live;
                },
                assignTerritoryWithRange(liveBoard) {
                    const o = ops();
                    const territory = o.assignTerritoryWithRange(liveBoard);
                    const secure = o.bensonAlive(liveBoard);
                    for (let r = 0; r < liveBoard.length; r++) {
                        const row = liveBoard[r];
                        for (let c = 0; c < row.length; c++) {
                            if (row[c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
                        }
                    }
                    return territory;
                }
            };
        }
        const scoringHooks = breakageScoringHooks();

        function isUserBoardMarkVisibleAt(br, bc) {
            if (ps.showEstimateActive) return false;
            if (!isValidPoint(br, bc)) return false;
            return ps.board[br][bc] === 0;
        }

        /** 手数标签：与运行时同算法（本棋种没有洞之类特殊格） */
        function breakageComputeStoneNumbers() {
            const isStoneVal = (v) => v === 1 || v === 2;
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            const mark = (markers, i) => {
                if (markers && markers.length > 0) {
                    const m = markers[0];
                    if (isValidPoint(m.row, m.col) && isStoneVal(ps.board[m.row][m.col])) nums[m.row][m.col] = i;
                }
            };
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) mark(ps.tryPlayMarkers[i], i);
            } else if (ps.replayMode) {
                for (let i = 1; i <= ps.replayStep; i++) mark(ps.replayMarkers[i], i);
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) mark(ps.liveReplayMarkers[i], i);
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && m.row != null && m.col != null && isValidPoint(m.row, m.col)
                        && isStoneVal(ps.board[m.row][m.col])) nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        /**
         * 断线围棋的格线：**逐段画**，被切断的那一段整段不画（两个端点之间一点线都没有）。
         * 连续未断的若干段并成一条折线，所以交叉点处不会出现接缝；线宽/颜色与标准格线一致。
         */
        function drawBrokenGrid(useView, invZ) {
            const n = ps.BOARD_SIZE;
            const pad = ps.PADDING;
            const cell = ps.CELL_SIZE;
            let lw = 1.5;
            if (useView && invZ > 0 && invZ < 1) lw = Math.max(0.5, 28 / n * invZ);
            ctx.strokeStyle = '#3a281c';
            ctx.lineWidth = lw;
            const xOf = (c) => pad + c * cell;
            const yOf = (r) => pad + (n - 1 - r) * cell;   // 与标准格线一致：第 0 行画在最下面
            // 横线（按数据行）
            for (let r = 0; r < n; r++) {
                let start = -1;
                for (let c = 0; c < n; c++) {
                    const hasNext = c + 1 < n;
                    const cut = hasNext && isCutEdge(r, c, r, c + 1);
                    if (!cut && start < 0) start = c;
                    if ((cut || !hasNext) && start >= 0 && start !== c) {
                        ctx.beginPath();
                        ctx.moveTo(xOf(start), yOf(r));
                        ctx.lineTo(xOf(c), yOf(r));
                        ctx.stroke();
                        start = -1;
                    }
                }
            }
            // 竖线（按数据列）
            for (let c = 0; c < n; c++) {
                let start = -1;
                for (let r = 0; r < n; r++) {
                    const hasNext = r + 1 < n;
                    const cut = hasNext && isCutEdge(r, c, r + 1, c);
                    if (!cut && start < 0) start = r;
                    if ((cut || !hasNext) && start >= 0 && start !== r) {
                        ctx.beginPath();
                        ctx.moveTo(xOf(c), yOf(start));
                        ctx.lineTo(xOf(c), yOf(r));
                        ctx.stroke();
                        start = -1;
                    }
                }
            }
        }

        /** 断线围棋自绘：与标准方格盘同一套管线，只是格线走「断线段整段不画」的画法 */
        function breakageDrawBoard() {
            const d = QiSquareWeiqiCanvas.draw;
            const cs = QiSquareWeiqiCanvas.DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const zRaw = ps.viewZoom;
            const z = typeof zRaw === 'number' && zRaw >= 1 ? Math.min(10, zRaw) : 1;
            const vcx = typeof ps.viewCenterX === 'number' ? ps.viewCenterX : cs / 2;
            const vcy = typeof ps.viewCenterY === 'number' ? ps.viewCenterY : cs / 2;
            const useView = z > 1;
            const invZ = useView ? 1 / z : 1;
            d.clear(ctx, cs);
            if (useView) {
                ctx.save();
                ctx.translate(cs / 2, cs / 2);
                ctx.scale(z, z);
                ctx.translate(-vcx, -vcy);
            }
            drawBrokenGrid(useView, invZ);
            d.starPoints(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
            }
            d.stonesBlackWhite(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers, invZ);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
            }
            d.userBoardMarks(ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                d.moveNumbersOnStones(ctx, breakageComputeStoneNumbers(), ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
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
                holeDisplayStyle: ps.holeDisplayStyle,
                boardSize: ps.BOARD_SIZE
            });
            if (ps.hoverCapture) {
                d.hoverCaptureRing(ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                    tryPlayMode: ps.tryPlayMode,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn || !!ps.editModeEnabled,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture,
                    strokeInvScale: invZ,
                    boardSize: ps.BOARD_SIZE
                });
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
            if (useView) ctx.restore();
            // 木纹（CSS 背景层）跟随缩放/平移，避免格线与木纹脱节
            QiSquareWeiqiCanvas.syncBoardWoodView(canvas, z, vcx, vcy, cs);
            syncScrollbarsFromView();
        }

        const page = QiWeiqiSquarePageRuntime.create(ps, domPage, {
            enableEditBoard: true,
            recordDownloadPrefix,
            minLib,
            maxWeakLiberties: 2,
            ...scoringHooks,
            gameType,
            roomId,
            roomPassword,
            isMouseDevice,
            tryPlaceStone: cutTryPlaceStone,
            drawBoard: breakageDrawBoard,
            afterDrawBoard: syncScrollbarsFromView
        });
        const {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            drawBoard: drawBoardCore,
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
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
            rebuildLiveReplayFromMoveCoords,
            applyLiveViewBoard,
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState,
            commitMove,
            getClosestIntersection,
            canvasCoordsFromClient,
            boardScreenPointFromClient,
            applyUserBoardMark
        } = page;

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            onNewGameStarted() {
                if (page && page.clearEditModeUi) page.clearEditModeUi();
            },
            roomId,
            gameType,
            pageState: ps,
            drawBoard: drawBoardCore,
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
            onSeatOverlayUpdated({ visible }) {
                if (visible && ps.viewZoom > 1) resetBoardViewZoom();
            }
        });
        const weiqiHandleMessageInner = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;
        const updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function lastMoveMarkerKey() {
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return '';
            return `${m.row},${m.col},${m.color}`;
        }

        function maybeCenterViewOnOpponentMove(msg, keyBefore) {
            if (ps.viewZoom <= 1 || !ps.mySlot || ps.replayMode || ps.tryPlayMode) return;
            if (msg.type !== 'broadcast' && msg.type !== 'gameState') return;
            if (msg.type === 'broadcast' && msg.action !== 'move') return;
            const m = ps.lastMoveMarkers && ps.lastMoveMarkers[0];
            if (!m || m.row < 0 || m.col < 0) return;
            if (lastMoveMarkerKey() === keyBefore) return;
            const oppColor = ps.mySlot === 'player1' ? 2 : 1;
            if (m.color !== oppColor) return;
            ps.viewCenterX = ps.PADDING + m.col * ps.CELL_SIZE;
            ps.viewCenterY = ps.PADDING + (ps.BOARD_SIZE - 1 - m.row) * ps.CELL_SIZE;
            clampBoardView();
            drawBoardCore();
        }

        function handleMessage(msg) {
            // 断线只在几处下发（进房 joined / 开局 newGameStarted / 改路数 boardSizeChanged /
            // 导入 importSuccess / 房间重置 roomReset），对局中每手不带 —— 这里收到就缓存住。
            // joined 的整盘状态嵌在 msg.state 里，其它是平的，两种都认。
            // 注意：**不要**顺手改 ps.BOARD_SIZE —— 改路数那一下必须留给运行时的 syncState
            // （它靠 state.boardSize !== ps.BOARD_SIZE 判断要不要更新棋盘几何），否则盘面几何会停在上一个路数。
            if (msg && typeof msg === 'object') {
                const st = (msg.state && typeof msg.state === 'object') ? msg.state : msg;
                if (Array.isArray(st.brokenEdges)) ps.brokenEdges = st.brokenEdges;
            }
            const mkBefore = lastMoveMarkerKey();
            weiqiHandleMessageInner(msg);
            maybeCenterViewOnOpponentMove(msg, mkBefore);
        }

        let suppressCanvasClickAfterLongMark = false;
        let suppressCanvasClickAfterPan = false;

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }

        (function initWeiqiBoardScrollbars() {
            const sx = document.getElementById('boardScrollX');
            const sy = document.getElementById('boardScrollY');
            if (!sx || !sy) return;
            function applyFromSliders() {
                if (boardScrollbarProgrammatic) return;
                if (ps.viewZoom <= 1) return;
                const b = viewCenterBoundsForScrollbars();
                const tx = Number(sx.value) / 1000;
                const ty = 1 - Number(sy.value) / 1000;
                ps.viewCenterX = b.minX + tx * (b.maxX - b.minX);
                ps.viewCenterY = b.minY + ty * (b.maxY - b.minY);
                clampBoardView();
                drawBoardCore();
            }
            sx.addEventListener('input', applyFromSliders);
            sy.addEventListener('input', applyFromSliders);
        })();

        canvas.addEventListener('wheel', (e) => {
            if (!boardViewZoomAllowed()) return;
            const z0 = ps.viewZoom;
            const z1 = Math.max(1, Math.min(10, z0 * Math.exp(-e.deltaY * 0.002)));
            if (Math.abs(z1 - z0) < 1e-8) return;
            e.preventDefault();
            const ss = boardScreenPointFromClient(e.clientX, e.clientY);
            applyZoomKeepingScreenPoint(ss.x, ss.y, z1);
            drawBoardCore();
        }, { passive: false });

        let boardMousePanning = false;
        let boardPanLastScreen = null;

        function boardUpdateGrabCursor() {
            if (boardMousePanning) {
                canvas.style.cursor = 'grabbing';
            } else {
                canvas.style.cursor = ps.viewZoom > 1 ? 'grab' : 'default';
            }
        }

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || ps.viewZoom <= 1) return;
            boardMousePanning = true;
            boardPanLastScreen = boardScreenPointFromClient(e.clientX, e.clientY);
            boardUpdateGrabCursor();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!boardMousePanning || !boardPanLastScreen) return;
            const p = boardScreenPointFromClient(e.clientX, e.clientY);
            const dx = p.x - boardPanLastScreen.x;
            const dy = p.y - boardPanLastScreen.y;
            ps.viewCenterX -= dx / ps.viewZoom;
            ps.viewCenterY -= dy / ps.viewZoom;
            boardPanLastScreen = p;
            clampBoardView();
            drawBoardCore();
        });

        window.addEventListener('mouseup', () => {
            if (!boardMousePanning) return;
            boardMousePanning = false;
            boardPanLastScreen = null;
            boardUpdateGrabCursor();
        });

        let pinchGesture = false;
        let pinchStartDist = 1;
        let pinchStartZoom = 1;
        let touchPanLastScreen = null;
        let touchDidPan = false;

        function touchDistanceScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return Math.hypot(b.x - a.x, b.y - a.y);
        }

        function touchMidpointScreen(touches) {
            const a = boardScreenPointFromClient(touches[0].clientX, touches[0].clientY);
            const b = boardScreenPointFromClient(touches[1].clientX, touches[1].clientY);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 2) {
                if (!boardViewZoomAllowed()) return;
                clearLongMarkTouch();
                pinchGesture = true;
                pinchStartDist = Math.max(1e-6, touchDistanceScreen(e.touches));
                pinchStartZoom = ps.viewZoom;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { capture: true, passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (pinchGesture && e.touches.length >= 2) {
                if (!boardViewZoomAllowed()) {
                    pinchGesture = false;
                    return;
                }
                e.preventDefault();
                const d = touchDistanceScreen(e.touches);
                const z1 = Math.max(1, Math.min(10, pinchStartZoom * (d / pinchStartDist)));
                const mid = touchMidpointScreen(e.touches);
                applyZoomKeepingScreenPoint(mid.x, mid.y, z1);
                drawBoardCore();
                return;
            }
            if (!pinchGesture && e.touches.length === 1 && ps.viewZoom > 1 && touchPanLastScreen) {
                const cur = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
                const dx = cur.x - touchPanLastScreen.x;
                const dy = cur.y - touchPanLastScreen.y;
                if (dx * dx + dy * dy > 9) {
                    touchDidPan = true;
                    e.preventDefault();
                    ps.viewCenterX -= dx / ps.viewZoom;
                    ps.viewCenterY -= dy / ps.viewZoom;
                    touchPanLastScreen = cur;
                    clampBoardView();
                    drawBoardCore();
                }
            }
        }, { passive: false });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        });

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

        function onCanvasTouchEnd(e) {
            clearLongMarkTouch();
            if (e.touches.length < 2) pinchGesture = false;
            if (e.touches.length === 0) {
                if (touchDidPan) {
                    suppressCanvasClickAfterPan = true;
                    setTimeout(() => { suppressCanvasClickAfterPan = false; }, 450);
                }
                touchDidPan = false;
                touchPanLastScreen = null;
            } else if (e.touches.length === 1 && ps.viewZoom > 1) {
                touchPanLastScreen = boardScreenPointFromClient(e.touches[0].clientX, e.touches[0].clientY);
            }
        }
        canvas.addEventListener('touchend', onCanvasTouchEnd);
        canvas.addEventListener('touchcancel', () => {
            clearLongMarkTouch();
            pinchGesture = false;
            touchPanLastScreen = null;
            touchDidPan = false;
        });

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark || suppressCanvasClickAfterPan) {
                e.preventDefault();
                return;
            }
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);

            if (ps.tryPlayMode && ps.replayMode) {
                if (row < 0 || col < 0) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardCore();
                    return;
                }
                if (ps.board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        ps.hoverRow = row;
                        ps.hoverCol = col;
                        ps.isHoverValid = true;
                        drawBoardCore();
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
                drawBoardCore();
                return;
            }
            if (ps.board[row][col] !== 0) return;

            if (mobileTwoStepPlacing()) {
                if (ps.hoverRow === row && ps.hoverCol === col && ps.isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoardCore();
                } else {
                    ps.hoverRow = row;
                    ps.hoverCol = col;
                    ps.isHoverValid = true;
                    drawBoardCore();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) => {
                if (boardMousePanning) return;
                if (ps.waitingScoreConfirm) {
                    if (ps.isHoverValid) { ps.isHoverValid = false; ps.hoverRow = -1; ps.hoverCol = -1; drawBoardCore(); }
                    return;
                }
                const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
                const { row, col } = getClosestIntersection(x, y);
                ps.hoverRow = row; ps.hoverCol = col;
                ps.isHoverValid = (row >= 0 && col >= 0 && ps.board[row][col] === 0);
                boardUpdateGrabCursor();
                drawBoardCore();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!ps.waitingScoreConfirm) {
                    ps.isHoverValid = false;
                    ps.hoverRow = -1; ps.hoverCol = -1;
                    if (!boardMousePanning) boardUpdateGrabCursor();
                    drawBoardCore();
                }
            });
        }

        // 数点确认按钮事件
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
