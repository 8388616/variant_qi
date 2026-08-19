window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["double-xiangqi"] = {
    shell: {
        "title": "二象棋",
        "rulesHtml": "基本规则同象棋。<br /><br />吃掉对方的一个帥/將后将死另一个帥/將时获胜。<br /><br /><br /><br /><i>什么，你也带了一副象棋，但是没带棋盘？</i><br /><br />",
        "defaultKomiText": "红先",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "二象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "xiangqi": true,
            "hideBoardSize": true
        },
        // 顺序：车马炮象士兵将
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "rr", "label": "俥", "cellValue": "rr" },
            { "value": "rn", "label": "傌", "cellValue": "rn" },
            { "value": "rc", "label": "炮", "cellValue": "rc" },
            { "value": "re", "label": "相", "cellValue": "re" },
            { "value": "ra", "label": "仕", "cellValue": "ra" },
            { "value": "rp", "label": "兵", "cellValue": "rp" },
            { "value": "rk", "label": "帥", "cellValue": "rk" },
            { "value": "br", "label": "車", "cellValue": "br" },
            { "value": "bn", "label": "馬", "cellValue": "bn" },
            { "value": "bc", "label": "砲", "cellValue": "bc" },
            { "value": "be", "label": "象", "cellValue": "be" },
            { "value": "ba", "label": "士", "cellValue": "ba" },
            { "value": "bp", "label": "卒", "cellValue": "bp" },
            { "value": "bk", "label": "將", "cellValue": "bk" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "二象棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const R = QiXiangqiRules;

        /** 二象棋专属开局（子力加倍） */
        function createDoubleInitialBoard() {
            const b = R.emptyBoard();
            b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'ba'; b[0][4] = 'bk';
            b[0][5] = 'ba'; b[0][6] = 'be'; b[0][7] = 'bn'; b[0][8] = 'br';
            b[1][0] = 'br'; b[1][1] = 'bn'; b[1][2] = 'bc'; b[1][3] = 'bc'; b[1][4] = 'bk';
            b[1][5] = 'bc'; b[1][6] = 'bc'; b[1][7] = 'bn'; b[1][8] = 'br';
            b[2][3] = 'ba'; b[2][4] = 'bp'; b[2][5] = 'ba';
            for (let c = 0; c < R.BOARD_W; c++) b[3][c] = 'bp';
            b[4][2] = 'be'; b[4][6] = 'be';
            b[5][2] = 're'; b[5][6] = 're';
            for (let c = 0; c < R.BOARD_W; c++) b[6][c] = 'rp';
            b[7][3] = 'ra'; b[7][4] = 'rp'; b[7][5] = 'ra';
            b[8][0] = 'rr'; b[8][1] = 'rn'; b[8][2] = 'rc'; b[8][3] = 'rc'; b[8][4] = 'rk';
            b[8][5] = 'rc'; b[8][6] = 'rc'; b[8][7] = 'rn'; b[8][8] = 'rr';
            b[9][0] = 'rr'; b[9][1] = 'rn'; b[9][2] = 're'; b[9][3] = 'ra'; b[9][4] = 'rk';
            b[9][5] = 'ra'; b[9][6] = 're'; b[9][7] = 'rn'; b[9][8] = 'rr';
            return b;
        }

        function countKings(board, side) {
            const code = side === 'red' ? 'rk' : 'bk';
            let n = 0;
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    if (board[r][c] === code) n++;
                }
            }
            return n;
        }

        function findKings(board, side) {
            const code = side === 'red' ? 'rk' : 'bk';
            const list = [];
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    if (board[r][c] === code) list.push({ row: r, col: c });
                }
            }
            return list;
        }

        function kingsFaceEachOtherMulti(board) {
            const reds = findKings(board, 'red');
            const blacks = findKings(board, 'black');
            for (const rk of reds) {
                for (const bk of blacks) {
                    if (rk.col !== bk.col) continue;
                    let blocked = false;
                    const minR = Math.min(rk.row, bk.row);
                    const maxR = Math.max(rk.row, bk.row);
                    for (let r = minR + 1; r < maxR; r++) {
                        if (board[r][rk.col] !== '') { blocked = true; break; }
                    }
                    if (!blocked) return true;
                }
            }
            return false;
        }

        function isSquareAttackedBy(board, row, col, bySide) {
            const ch = R.sideColorChar(bySide);
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const p = board[r][c];
                    if (!p || p[0] !== ch) continue;
                    if (R.isPseudoLegalMove(p, r, c, row, col, board)) return true;
                }
            }
            return false;
        }

        /** 任一将被攻击或对脸即视为被将军/叫吃 */
        function isInCheckDouble(board, side) {
            const kings = findKings(board, side);
            if (kings.length === 0) return true;
            if (kingsFaceEachOtherMulti(board)) return true;
            const opp = R.oppositeSide(side);
            for (const k of kings) {
                if (isSquareAttackedBy(board, k.row, k.col, opp)) return true;
            }
            return false;
        }

        /** 仅剩一将时的真将军（用于长将/限着） */
        function isTrueCheck(board, side) {
            return countKings(board, side) === 1 && isInCheckDouble(board, side);
        }

        function isLegalMoveDouble(board, fromRow, fromCol, toRow, toCol, side) {
            const piece = board[fromRow] && board[fromRow][fromCol];
            if (!piece || piece[0] !== R.sideColorChar(side)) return false;
            if (!R.isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board)) return false;
            const next = R.applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
            const kingsLeft = countKings(next, side);
            if (kingsLeft === 0) return false;
            // 双将时可送将、可不应；只剩一将时必须应将且不得自送
            if (kingsLeft === 1 && isInCheckDouble(next, side)) return false;
            return true;
        }

        function hasLegalMoveDouble(board, side) {
            const ch = R.sideColorChar(side);
            for (let fr = 0; fr < R.BOARD_H; fr++) {
                for (let fc = 0; fc < R.BOARD_W; fc++) {
                    const p = board[fr][fc];
                    if (!p || p[0] !== ch) continue;
                    for (let tr = 0; tr < R.BOARD_H; tr++) {
                        for (let tc = 0; tc < R.BOARD_W; tc++) {
                            if (isLegalMoveDouble(board, fr, fc, tr, tc, side)) return true;
                        }
                    }
                }
            }
            return false;
        }

        const SLOT_UI = {
            black: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };

const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const XQ_PAD_X = 0.62;
        const XQ_PAD_TOP = 0.82;
        const XQ_PAD_BOT = 0.9;
        const xqUnitsW = (R.BOARD_W - 1) + 2 * XQ_PAD_X;
        const xqUnitsH = (R.BOARD_H - 1) + XQ_PAD_TOP + XQ_PAD_BOT;
        canvas.width = 560;
        canvas.height = Math.round(560 * xqUnitsH / xqUnitsW);
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const ps = {
            board: createDoubleInitialBoard(),
            sideToMove: 'red',
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
            gameStarted: false,
            winner: null,
            lastFrom: null,
            lastTo: null,
            ws: null,
            isMyTurn: false,
            slots: { black: false, white: false },
            reconnectTimer: null,
            replayMode: false,
            tryPlayMode: false,
            matchStarted: false,
            matchTime: null,
            selectedRow: -1,
            selectedCol: -1,
            legalTargets: [],
            hoverRow: -1,
            hoverCol: -1,
            inCheck: false,
            halfmoveClock: 0,
            moveHistory: [],
            liveViewStep: 0,
            liveFollowLatest: true,
            liveSnapshots: [],
            replaySnapshots: [],
            replayStep: 0,
            replayTotalSteps: 0,
            tryPlayBaseStep: 0,
            tryPlaySnapshots: [],
            tryPlayStep: 0,
            tryPlayTotalSteps: 0,
            tryPlaySide: 'red',
            recordResultText: null,
            waitingScoreConfirm: false,
            iRejected: false,
            showEstimateActive: false,
            checkBannerUntil: 0
        };

        let cellSize = 0, offsetX = 0, offsetY = 0;
        let checkBannerTimer = null;

        function triggerCheckBanner() {
            ps.checkBannerUntil = Date.now() + 2000;
            if (checkBannerTimer) clearTimeout(checkBannerTimer);
            checkBannerTimer = setTimeout(() => {
                checkBannerTimer = null;
                ps.checkBannerUntil = 0;
                drawBoard();
            }, 2000);
            drawBoard();
        }

        function drawCheckBanner() {
            if (!ps.checkBannerUntil || Date.now() >= ps.checkBannerUntil) return;
            const cx = offsetX + ((R.BOARD_W - 1) * cellSize) / 2;
            const cy = offsetY + ((R.BOARD_H - 1) * cellSize) / 2;
            const fontSize = Math.max(48, cellSize * 2.0);
            // 勿用 bold：xiangqi.ttf 仅 Regular，请求粗体时浏览器会回退到系统字体
            const fontSpec = `${fontSize}px XiangqiPiece`;
            ctx2d.save();
            ctx2d.font = fontSpec;
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.lineJoin = 'round';
            ctx2d.lineWidth = Math.max(4, fontSize * 0.12);
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.fillStyle = '#c62828';
            ctx2d.strokeText('将军！', cx, cy);
            ctx2d.fillText('将军！', cx, cy);
            ctx2d.restore();
        }


        function sideOfSlot(slot) { return R.sideFromSlot(slot); }
        function slotOfSide(side) { return R.slotFromSide(side); }

        function boardFlipped() {
            return ps.mySlot === 'white';
        }

        function toDisplayCoord(row, col) {
            if (!boardFlipped()) return { row, col };
            return { row: R.BOARD_H - 1 - row, col: R.BOARD_W - 1 - col };
        }

        function toOriginalCoord(dispRow, dispCol) {
            if (!boardFlipped()) return { row: dispRow, col: dispCol };
            return { row: R.BOARD_H - 1 - dispRow, col: R.BOARD_W - 1 - dispCol };
        }

        function calcGeometry() {
            const w = canvas.width, h = canvas.height;
            cellSize = Math.min(w / xqUnitsW, h / xqUnitsH);
            offsetX = (w - (R.BOARD_W - 1) * cellSize) / 2;
            offsetY = (h - (R.BOARD_H - 1) * cellSize) / 2;
        }

        function drawCoordinates() {
            const top = boardFlipped()
                ? ['一', '二', '三', '四', '五', '六', '七', '八', '九']
                : ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
            const bottom = boardFlipped()
                ? ['9', '8', '7', '6', '5', '4', '3', '2', '1']
                : ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
            ctx2d.fillStyle = '#5a3a1e';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.font = `${cellSize * 0.22}px Segoe UI`;
            const topY = offsetY - cellSize * 0.55;
            const botY = offsetY + (R.BOARD_H - 1) * cellSize + cellSize * 0.65;
            for (let c = 0; c < R.BOARD_W; c++) {
                const x = offsetX + c * cellSize;
                ctx2d.fillText(top[c], x, topY);
                ctx2d.fillText(bottom[c], x, botY);
            }
        }

        function refreshLegalTargets() {
            ps.legalTargets = [];
            if (ps.selectedRow < 0) return;
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    if (isLegalMoveDouble(ps.board, ps.selectedRow, ps.selectedCol, r, c, side))
                        ps.legalTargets.push({ row: r, col: c });
                }
            }
        }

        function drawBoard() {
            calcGeometry();
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            ctx2d.lineWidth = 1.8;
            ctx2d.strokeStyle = '#3a281c';

            for (let i = 0; i < R.BOARD_H; i++) {
                const y = offsetY + i * cellSize;
                ctx2d.beginPath();
                ctx2d.moveTo(offsetX, y);
                ctx2d.lineTo(offsetX + (R.BOARD_W - 1) * cellSize, y);
                ctx2d.stroke();
            }
            for (let dispCol = 0; dispCol < R.BOARD_W; dispCol++) {
                const x = offsetX + dispCol * cellSize;
                if (dispCol === 0 || dispCol === R.BOARD_W - 1) {
                    ctx2d.beginPath();
                    ctx2d.moveTo(x, offsetY);
                    ctx2d.lineTo(x, offsetY + (R.BOARD_H - 1) * cellSize);
                    ctx2d.stroke();
                } else {
                    ctx2d.beginPath();
                    ctx2d.moveTo(x, offsetY);
                    ctx2d.lineTo(x, offsetY + 4 * cellSize);
                    ctx2d.stroke();
                    ctx2d.beginPath();
                    ctx2d.moveTo(x, offsetY + 5 * cellSize);
                    ctx2d.lineTo(x, offsetY + (R.BOARD_H - 1) * cellSize);
                    ctx2d.stroke();
                }
            }

            ctx2d.fillStyle = '#5a3a1e';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.font = `${cellSize * 0.7}px XiangqiPiece`;
            const riverY = offsetY + 4.5 * cellSize;
            if (boardFlipped()) {
                ctx2d.fillText('楚河', offsetX + 6 * cellSize, riverY);
                ctx2d.fillText('漢界', offsetX + 2 * cellSize, riverY);
            } else {
                ctx2d.fillText('楚河', offsetX + 2 * cellSize, riverY);
                ctx2d.fillText('漢界', offsetX + 6 * cellSize, riverY);
            }

            function drawPalaceLine(r1, c1, r2, c2) {
                const a = toDisplayCoord(r1, c1);
                const b = toDisplayCoord(r2, c2);
                ctx2d.beginPath();
                ctx2d.moveTo(offsetX + a.col * cellSize, offsetY + a.row * cellSize);
                ctx2d.lineTo(offsetX + b.col * cellSize, offsetY + b.row * cellSize);
                ctx2d.stroke();
            }
            drawPalaceLine(7, 3, 9, 5); drawPalaceLine(9, 3, 7, 5);
            drawPalaceLine(0, 3, 2, 5); drawPalaceLine(2, 3, 0, 5);
            drawCoordinates();

            const marks = [
                [2, 1], [2, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
                [7, 1], [7, 7], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
            ];
            ctx2d.save();
            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 1.5;
            for (const [mr, mc] of marks) {
                const d = toDisplayCoord(mr, mc);
                const x = offsetX + d.col * cellSize;
                const y = offsetY + d.row * cellSize;
                const off = cellSize * 0.06, len = cellSize * 0.12;
                // 边路兵位：只画盘内两侧折线，不画出盘外
                let corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
                if (d.col === 0) corners = [[1, -1], [1, 1]];
                else if (d.col === R.BOARD_W - 1) corners = [[-1, -1], [-1, 1]];
                corners.forEach(([sx, sy]) => {
                    ctx2d.beginPath();
                    ctx2d.moveTo(x + sx * off, y + sy * off);
                    ctx2d.lineTo(x + sx * (off + len), y + sy * off);
                    ctx2d.moveTo(x + sx * off, y + sy * off);
                    ctx2d.lineTo(x + sx * off, y + sy * (off + len));
                    ctx2d.stroke();
                });
            }
            ctx2d.restore();

            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom, ps.lastTo].forEach((p) => {
                    const d = toDisplayCoord(p.row, p.col);
                    ctx2d.beginPath();
                    ctx2d.arc(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize * 0.45, 0, Math.PI * 2);
                    ctx2d.strokeStyle = 'rgba(255,255,255,0.75)';
                    ctx2d.lineWidth = 2;
                    ctx2d.stroke();
                });
            }

            for (const t of ps.legalTargets) {
                const d = toDisplayCoord(t.row, t.col);
                const half = cellSize * 0.1;
                const x = offsetX + d.col * cellSize;
                const y = offsetY + d.row * cellSize;
                ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
            }

            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const piece = ps.board[r][c];
                    if (!piece) continue;
                    const d = toDisplayCoord(r, c);
                    const x = offsetX + d.col * cellSize;
                    const y = offsetY + d.row * cellSize;
                    const radius = cellSize * 0.42;
                    ctx2d.shadowOffsetY = radius * 0.2;
                    ctx2d.shadowBlur = radius * 0.4;
                    ctx2d.shadowColor = 'rgba(0,0,0,0.45)';
                    ctx2d.beginPath();
                    ctx2d.arc(x, y, radius, 0, Math.PI * 2);
                    ctx2d.fillStyle = '#e8d2a0';
                    ctx2d.fill();
                    ctx2d.shadowBlur = 0; ctx2d.shadowOffsetY = 0;
                    ctx2d.strokeStyle = '#c49c6a';
                    ctx2d.lineWidth = 1.5;
                    ctx2d.stroke();
                    const color = piece[0] === 'r' ? '#932c13' : '#222';
                    ctx2d.fillStyle = color;
                    ctx2d.font = `${cellSize * 0.52}px XiangqiPiece`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    ctx2d.fillText(R.pieceLabel(piece), x, y + cellSize * 0.02);
                    ctx2d.beginPath();
                    ctx2d.arc(x, y, radius * 0.78, 0, Math.PI * 2);
                    ctx2d.strokeStyle = color;
                    ctx2d.lineWidth = 1.2;
                    ctx2d.stroke();
                }
            }

            if (ps.selectedRow >= 0) {
                const d = toDisplayCoord(ps.selectedRow, ps.selectedCol);
                ctx2d.beginPath();
                ctx2d.arc(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize * 0.46, 0, Math.PI * 2);
                ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                ctx2d.lineWidth = 2;
                ctx2d.stroke();
            }

            drawCheckBanner();
        }

        function updateTurn() {
            if (ps.gameOver) {
                let text = '对局结束';
                if (ps.winner === 'draw') text = '和棋';
                else if (ps.winner === 'black') text = '🔴 红方胜';
                else if (ps.winner === 'white') text = '⚫ 黑方胜';
                if (ps.recordResultText) text = ps.recordResultText;
                turnDisplay.innerText = text;
                scoreTitle.innerText = '结果';
                scoreBoard.innerText = text;
                leadInfo.innerText = ps.inCheck ? '' : '　';
                return;
            }
            const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (!matchStarted && !ps.tryPlayMode && !ps.replayMode) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                scoreTitle.innerText = '　';
                scoreBoard.innerText = '　';
                leadInfo.innerText = '　';
                return;
            }
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const label = side === 'red' ? '🔴 红方行棋' : '⚫ 黑方行棋';
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label;
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            leadInfo.innerText = ps.halfmoveClock > 60 ? `未吃子 ${ps.halfmoveClock}/120` : '　';
        }

        function syncState(state) {
            if (!state) return;
            if (state.board) ps.board = R.copyBoard(state.board);
            if (state.sideToMove) {
                ps.sideToMove = state.sideToMove;
                ps.currentPlayer = state.sideToMove === 'red' ? 1 : 2;
            } else if (state.currentPlayer) {
                ps.currentPlayer = state.currentPlayer;
                ps.sideToMove = state.currentPlayer === 1 ? 'red' : 'black';
            }
            ps.gameOver = !!state.gameOver;
            ps.winner = state.winner != null ? state.winner : null;
            ps.lastFrom = state.lastFrom || null;
            ps.lastTo = state.lastTo || null;
            ps.inCheck = !!state.inCheck;
            ps.halfmoveClock = state.halfmoveClock || 0;
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) ps.moveHistory = state.moveHistory.slice();
            else if (state.moveCoords) {
                ps.moveHistory = state.moveCoords.filter((m) => m.type === 'move').map((m) => ({
                    player: m.player, fromRow: m.fromRow, fromCol: m.fromCol,
                    toRow: m.toRow, toCol: m.toCol, piece: m.piece, captured: m.captured
                }));
            }
            if (state.recordResultText) ps.recordResultText = state.recordResultText;
            if (state.showCheck) triggerCheckBanner();
            rebuildLiveSnapshots();
            if (!ps.replayMode && !ps.tryPlayMode && ps.liveFollowLatest) {
                ps.liveViewStep = Math.max(0, ps.liveSnapshots.length - 1);
            }
            ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
            updateIsMyTurn();
            updateTurn();
            drawBoard();
            updateReplayUI();
        }

        function updateIsMyTurn() {
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (ps.gameOver || ps.replayMode || ps.tryPlayMode || !matchStarted || !ps.mySlot) {
                ps.isMyTurn = false;
            } else {
                ps.isMyTurn = ps.mySlot === slotOfSide(ps.sideToMove);
            }
            updateMatchControlButtons();
        }

        function updateMatchControlButtons() {
            const isPlayer = !!ps.mySlot;
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            const showMatch = isPlayer && matchStarted && !ps.replayMode;
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = showMatch ? '' : 'none';
            });
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) {
                tryPlayBtn.style.display = showMatch ? 'none' : '';
                tryPlayBtn.textContent = ps.tryPlayMode ? '试下结束' : '试下';
            }
            updateRecordButtons();
        }

        function snapshotFromBoard(board, side, lastFrom, lastTo, extra) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null,
                ...(extra || {})
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFromBoard(createDoubleInitialBoard(), 'red', null, null)];
            let b = createDoubleInitialBoard();
            let side = 'red';
            for (const m of ps.moveHistory) {
                if (!isLegalMoveDouble(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, side, { row: m.fromRow, col: m.fromCol }, { row: m.toRow, col: m.toCol }));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'red' ? 1 : 2;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = isInCheckDouble(ps.board, ps.sideToMove);
            ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
            updateTurn();
            drawBoard();
        }

        function setLiveViewStep(step) {
            if (!ps.liveSnapshots.length) return;
            const max = ps.liveSnapshots.length - 1;
            step = Math.max(0, Math.min(max, step));
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= max;
            if (!ps.replayMode && !ps.tryPlayMode) applySnapshot(ps.liveSnapshots[step]);
            updateReplayUI();
        }

        function updateReplayUI() {
            const slider = document.getElementById('replaySlider');
            const stepDisp = document.getElementById('replayStepDisplay');
            let total = 0, cur = 0;
            if (ps.tryPlayMode) {
                total = ps.tryPlayTotalSteps;
                cur = ps.tryPlayStep;
            } else if (ps.replayMode) {
                total = ps.replayTotalSteps;
                cur = ps.replayStep;
            } else {
                total = Math.max(0, ps.liveSnapshots.length - 1);
                cur = ps.liveViewStep;
            }
            if (slider) { slider.max = total; slider.value = cur; }
            if (stepDisp) stepDisp.textContent = `${cur} / ${total}`;
            updateMatchControlButtons();
        }

        function downloadRecord(data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `二象棋_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function enterReplayMode(data) {
            const moves = data.moves || [];
            const snaps = [snapshotFromBoard(createDoubleInitialBoard(), 'red', null, null)];
            let b = createDoubleInitialBoard();
            let side = 'red';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5] };
                }
                if (!isLegalMoveDouble(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
                const lf = { row: m.fromRow, col: m.fromCol };
                const lt = { row: m.toRow, col: m.toCol };
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, side, lf, lt));
            }
            ps.replaySnapshots = snaps;
            ps.replayTotalSteps = snaps.length - 1;
            ps.replayMode = true;
            ps.tryPlayMode = false;
            setReplayStep(ps.replayTotalSteps);
            document.getElementById('tryPlayBtn').textContent = '试下';
            ['undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }

        function exitReplayMode() {
            ps.replayMode = false;
            ps.tryPlayMode = false;
            document.getElementById('tryPlayBtn').textContent = '试下';
            if (ps.liveSnapshots.length) setLiveViewStep(ps.liveSnapshots.length - 1);
            else {
                ps.board = createDoubleInitialBoard();
                ps.sideToMove = 'red';
                updateTurn();
                drawBoard();
            }
        }

        function setReplayStep(step) {
            step = Math.max(0, Math.min(ps.replayTotalSteps, step));
            ps.replayStep = step;
            applySnapshot(ps.replaySnapshots[step]);
            updateReplayUI();
        }

        function enterTryPlay() {
            if (!ps.replayMode) {
                rebuildLiveSnapshots();
                ps.tryPlayBaseStep = ps.liveViewStep;
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFromBoard(ps.board, ps.sideToMove, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
            }
            ps.tryPlayMode = true;
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            ps.tryPlaySide = ps.tryPlaySnapshots[0].sideToMove;
            applySnapshot(ps.tryPlaySnapshots[0]);
            document.getElementById('tryPlayBtn').textContent = '退出试下';
            updateReplayUI();
        }

        function exitTryPlay() {
            ps.tryPlayMode = false;
            document.getElementById('tryPlayBtn').textContent = '试下';
            if (ps.replayMode) setReplayStep(ps.tryPlayBaseStep);
            else setLiveViewStep(ps.tryPlayBaseStep);
        }

        function setTryPlayStep(step) {
            step = Math.max(0, Math.min(ps.tryPlayTotalSteps, step));
            ps.tryPlayStep = step;
            const s = ps.tryPlaySnapshots[step];
            ps.tryPlaySide = s.sideToMove;
            applySnapshot(s);
            updateReplayUI();
        }

        function tryPlayMove(fromRow, fromCol, toRow, toCol) {
            if (!isLegalMoveDouble(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide)) return false;
            const next = R.applyMoveOnBoard(ps.board, fromRow, fromCol, toRow, toCol);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFromBoard(next, side, { row: fromRow, col: fromCol }, { row: toRow, col: toCol }));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = side;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(fromRow, fromCol, toRow, toCol) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            ps.ws.send(JSON.stringify({ type: 'move', fromRow, fromCol, toRow, toCol }));
        }

        function getRowColFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const canvasX = (clientX - rect.left) * scaleX;
            const canvasY = (clientY - rect.top) * scaleY;
            let best = null, bestD = Infinity;
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const x = offsetX + c * cellSize;
                    const y = offsetY + r * cellSize;
                    const d = Math.hypot(canvasX - x, canvasY - y);
                    if (d < bestD && d < cellSize * 0.48) {
                        bestD = d;
                        best = { row: r, col: c };
                    }
                }
            }
            if (!best) return { row: -1, col: -1 };
            return toOriginalCoord(best.row, best.col);
        }

        function handleBoardClick(clientX, clientY) {
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { row, col } = getRowColFromClient(clientX, clientY);
            if (row < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const ch = R.sideColorChar(side);

            if (ps.selectedRow < 0) {
                const p = ps.board[row][col];
                if (p && p[0] === ch) {
                    ps.selectedRow = row;
                    ps.selectedCol = col;
                    refreshLegalTargets();
                    drawBoard();
                }
                return;
            }

            if (row === ps.selectedRow && col === ps.selectedCol) {
                ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }

            const p2 = ps.board[row][col];
            if (p2 && p2[0] === ch) {
                ps.selectedRow = row;
                ps.selectedCol = col;
                refreshLegalTargets();
                drawBoard();
                return;
            }

            const fr = ps.selectedRow, fc = ps.selectedCol;
            if (ps.tryPlayMode) {
                if (tryPlayMove(fr, fc, row, col)) {
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                }
                return;
            }
            if (isLegalMoveDouble(ps.board, fr, fc, row, col, side)) {
                commitMove(fr, fc, row, col);
                ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                drawBoard();
            }
        }

        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            slotUi: SLOT_UI,
            timeControlDefaults: { mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 },
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
            getBoardSize: () => R.BOARD_W,
            setBoardSize: () => {},
            getKomi: () => 0,
            setKomi: () => {},
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
            getShowEstimateActive: () => false,
            setShowEstimateActive: () => {},
            getWaitingScoreConfirm: () => false,
            setWaitingScoreConfirm: () => {},
            getIRejected: () => false,
            setIRejected: () => {},
            colorStatus,
            scoreTitle,
            turnDisplay,
                        syncState: (state) => {
                // 开局状态随同步更新，刷新编辑区可用性
                if (state) ps.gameStarted = (state.numberOfHands || 1) > 1 || !!state.matchStarted;
                syncState(state);
                if (editApi) editApi.updateEditModeUI();
            },
            updateBoardGeometry: () => {},
            initBoardArray: () => createDoubleInitialBoard(),
            exitReplayMode,
            clearEstimate: () => {},
            hideScoreConfirm: () => {},
            showEstimate: () => {},
            clearMobileMovePreview: () => {},
            downloadRecord,
            enterReplayMode,
            updateTurn,
            updateReplayUI,
            showScoreConfirm: () => {},
            isMouseDevice,
            onSeatOverlayUpdated() { drawBoard(); }
        });

        const handleMessage = _weiqiBindings.handleMessage;
        const updateRecordButtons = _weiqiBindings.updateRecordButtons;

        function connectWebSocket() {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const url = `${proto}://${location.host}/qi/ws?game=${encodeURIComponent(gameType)}&room=${encodeURIComponent(roomId)}`;
            const ws = new WebSocket(url);
            ps.ws = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', password: roomPassword || '' }));
            };
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                handleMessage(msg);
                if (msg.type === 'timeControlAgreed' || msg.type === 'colorAssigned' || msg.type === 'colorsFinalized'
                    || msg.type === 'gameState' || msg.type === 'broadcast' || msg.type === 'joined'
                    || msg.type === 'newGameStarted' || msg.type === 'roomReset') {
                    updateIsMyTurn();
                    drawBoard();
                    updateTurn();
                    updateReplayUI();
                }
                if (msg.type === 'gameRecord') downloadRecord(msg.data);
            };
            ws.onclose = () => {
                if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
                if (ps.reconnectTimer) return;
                ps.reconnectTimer = setTimeout(() => {
                    ps.reconnectTimer = null;
                    connectWebSocket();
                }, 1200);
            };
        }

        connectWebSocket();
        if (document.fonts && document.fonts.load) {
            document.fonts.load('48px XiangqiPiece').then(() => drawBoard()).catch(() => {});
        }

        canvas.addEventListener('click', (e) => handleBoardClick(e.clientX, e.clientY));

        document.getElementById('tryPlayBtn').onclick = () => {
            if (ps.tryPlayMode) exitTryPlay();
            else enterTryPlay();
            updateMatchControlButtons();
        };
        document.getElementById('replayBackBtn').onclick = () => {
            if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
            else if (ps.replayMode) setReplayStep(ps.replayStep - 1);
            else setLiveViewStep(ps.liveViewStep - 1);
        };
        document.getElementById('replayForwardBtn').onclick = () => {
            if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
            else if (ps.replayMode) setReplayStep(ps.replayStep + 1);
            else setLiveViewStep(ps.liveViewStep + 1);
        };
        document.getElementById('replaySlider').addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            if (ps.tryPlayMode) setTryPlayStep(v);
            else if (ps.replayMode) setReplayStep(v);
            else setLiveViewStep(v);
        });

        document.getElementById('helpBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'flex'; };
        document.getElementById('closeRulesBtn').onclick = () => { document.getElementById('rulesModal').style.display = 'none'; };
        document.getElementById('backToLobbyBtn').onclick = () => { location.href = '/qi'; };


        // 编辑模式：安装公共编辑 UI（点击放置棋子，关闭编辑时提交服务器）
        let editApi = null;
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'grid2d',
                editTools: config.editTools,
                pickAtClient(clientX, clientY) {
                    return getRowColFromClient(clientX, clientY);
                },
                drawBoard,
                getBoard: () => ps.board,
                setBoard: (b) => { ps.board = b; },
                emptyBoard: () => R.emptyBoard()
            });
        }

        // 导入/导出、新局/悔棋/认输/和棋由 createWeiqiMessageBindings 绑定
        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
