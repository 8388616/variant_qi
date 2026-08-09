window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["simulated-makruk"] = {
    shell: {
        "title": "模拟泰国象棋",
        "rulesHtml": "基本规则同泰国象棋（Makruk）。<br /><br /><strong>王</strong>：直走或斜走一格。<br /><strong>車</strong>：直走任意格，路径上不能有其它棋子，。<br /><strong>馬</strong>：走日（无蹩腿）。<br /><strong>象</strong>：斜走一格，或向前直走一格。<br /><strong>士</strong>：斜走一格。<br /><strong>兵</strong>：直走一格或斜吃一格，到达己方第6行时升变为士。<br /><br />将死对方的王获胜。困毙和棋。双方均无未升变兵后64手未将死则和棋。<br /><br />",
        "defaultKomiText": "红先",
        "boardSizeMin": 8,
        "boardSizeMax": 8,
        "defaultBoardSize": 8,
        "minLib": 1,
        "recordDownloadPrefix": "模拟泰国象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "xiangqi": true,
            "simulatedMakruk": true,
            "hideBoardSize": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "模拟泰国象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const BOARD_H = 8;
const BOARD_W = 8;

const PIECE_CHAR = {
    rk: '王', rm: '士', re: '象', rn: '馬', rr: '車', rp: '兵',
    bk: '王', bm: '士', be: '象', bn: '馬', br: '車', bp: '兵'
};

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function createInitialBoard() {
    const b = emptyBoard();
    // 与 games/simulated-makruk.js 一致：旋转对称 — 黑士在 D、黑将在 E；红王在 D、红士在 E
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'bm';
    b[0][4] = 'bk'; b[0][5] = 'be'; b[0][6] = 'bn'; b[0][7] = 'br';
    for (let c = 0; c < 8; c++) b[2][c] = 'bp';

    for (let c = 0; c < 8; c++) b[5][c] = 'rp';
    b[7][0] = 'rr'; b[7][1] = 'rn'; b[7][2] = 're'; b[7][3] = 'rk';
    b[7][4] = 'rm'; b[7][5] = 're'; b[7][6] = 'rn'; b[7][7] = 'rr';
    return b;
}

function sideColorChar(side) { return side === 'red' ? 'r' : 'b'; }
function oppositeSide(side) { return side === 'red' ? 'black' : 'red'; }
function sideFromSlot(slot) { return slot === 'black' ? 'red' : 'black'; }
function slotFromSide(side) { return side === 'red' ? 'black' : 'white'; }
function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function findKing(board, side) {
    const code = side === 'red' ? 'rk' : 'bk';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            if (board[r][c] === code) return { row: r, col: c };
        }
    }
    return null;
}

function pathClearOrtho(board, fr, fc, tr, tc) {
    if (fr !== tr && fc !== tc) return false;
    const dR = Math.sign(tr - fr);
    const dC = Math.sign(tc - fc);
    let r = fr + dR, c = fc + dC;
    while (r !== tr || c !== tc) {
        if (board[r][c] !== '') return false;
        r += dR; c += dC;
    }
    return true;
}

function pawnPromotesAt(side, toRow) {
    if (side === 'red') return toRow <= 2;
    return toRow >= 5;
}

function attacksSquare(piece, fr, fc, tr, tc, board) {
    if (!piece || !inBounds(tr, tc)) return false;
    if (fr === tr && fc === tc) return false;
    const color = piece[0];
    const type = piece[1];
    const target = board[tr][tc];
    if (target && target[0] === color) return false;
    const dR = tr - fr, dC = tc - fc;
    const aR = Math.abs(dR), aC = Math.abs(dC);
    const side = color === 'r' ? 'red' : 'black';
    const forward = side === 'red' ? -1 : 1;

    if (type === 'k') return aR <= 1 && aC <= 1;
    if (type === 'm') return aR === 1 && aC === 1;
    if (type === 'e') {
        if (aR === 1 && aC === 1) return true;
        return dR === forward && dC === 0;
    }
    if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);
    if (type === 'r') return pathClearOrtho(board, fr, fc, tr, tc);
    if (type === 'p') {
        return dR === forward && aC === 1;
    }
    return false;
}

function isPseudoLegalMove(piece, fr, fc, tr, tc, board) {
    if (!piece || !inBounds(tr, tc)) return false;
    if (fr === tr && fc === tc) return false;
    const color = piece[0];
    const type = piece[1];
    const target = board[tr][tc];
    if (target && target[0] === color) return false;
    const dR = tr - fr, dC = tc - fc;
    const aR = Math.abs(dR), aC = Math.abs(dC);
    const side = color === 'r' ? 'red' : 'black';
    const forward = side === 'red' ? -1 : 1;

    if (type === 'p') {
        if (dC === 0 && dR === forward && !target) return true;
        if (aC === 1 && dR === forward && target && target[0] !== color) return true;
        return false;
    }
    return attacksSquare(piece, fr, fc, tr, tc, board);
}

function isSquareAttackedBy(board, row, col, bySide) {
    const ch = sideColorChar(bySide);
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (attacksSquare(p, r, c, row, col, board)) return true;
        }
    }
    return false;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

function applyMoveOnBoard(board, fr, fc, tr, tc) {
    const next = copyBoard(board);
    const piece = next[fr][fc];
    const captured = next[tr][tc] || '';
    const side = piece[0] === 'r' ? 'red' : 'black';
    let placed = piece;
    if (piece[1] === 'p' && pawnPromotesAt(side, tr)) {
        placed = piece[0] + 'm';
    }
    next[tr][tc] = placed;
    next[fr][fc] = '';
    return { board: next, captured, placed, wasPawnMove: piece[1] === 'p' };
}

function isLegalMove(board, fr, fc, tr, tc, side) {
    const piece = board[fr] && board[fr][fc];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fr, fc, tr, tc, board)) return false;
    const applied = applyMoveOnBoard(board, fr, fc, tr, tc);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, side) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (isLegalMove(board, fr, fc, tr, tc, side)) {
                        moves.push({
                            fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                            capture: !!board[tr][tc]
                        });
                    }
                }
            }
        }
    }
    return moves;
}

function hasLegalMove(board, side) {
    return generateLegalMoves(board, side).length > 0;
}

function hasUnpromotedPawn(board) {
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (p && p[1] === 'p') return true;
        }
    }
    return false;
}

function isInsufficientMaterial(board) {
    const extras = [];
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[1] === 'k') continue;
            if (p[1] === 'r' || p[1] === 'p') return false;
            extras.push(p[1]);
        }
    }
    if (extras.length === 0) return true;
    if (extras.length === 1) {
        const t = extras[0];
        return t === 'm' || t === 'e' || t === 'n';
    }
    if (extras.length === 2 && extras[0] === 'm' && extras[1] === 'm') return true;
    if (extras.length === 2 && extras[0] === 'n' && extras[1] === 'n') return true;
    return false;
}

function positionKey(board, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'b|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            s += board[r][c] || '.';
            s += ',';
        }
        s += ';';
    }
    return s;
}

function judgeRepetition(historyKeys) {
    if (!historyKeys || historyKeys.length < 3) return null;
    const cur = historyKeys[historyKeys.length - 1];
    let count = 0;
    for (let i = 0; i < historyKeys.length; i++) {
        if (historyKeys[i] === cur) count++;
    }
    if (count >= 3) return { result: 'draw', reason: 'repetition' };
    return null;
}

function pieceLabel(code) {
    return PIECE_CHAR[code] || '?';
}

return {
    BOARD_H, BOARD_W, PIECE_CHAR,
    emptyBoard, copyBoard, createInitialBoard,
    sideColorChar, oppositeSide, sideFromSlot, slotFromSide, inBounds,
    findKing, isInCheck, isPseudoLegalMove, applyMoveOnBoard, isLegalMove,
    generateLegalMoves, hasLegalMove, hasUnpromotedPawn, isInsufficientMaterial,
    positionKey, judgeRepetition, pieceLabel, pawnPromotesAt
};
})();
        const SLOT_UI = {
            black: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const PAD = 0.55;
        const units = R.BOARD_W + 2 * PAD;
        canvas.width = 560;
        canvas.height = 560;
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const ps = {
            board: R.createInitialBoard(),
            sideToMove: 'red',
            currentPlayer: 1,
            mySlot: null,
            gameOver: false,
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
            noPawnMoveCount: 0,
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
            const cx = offsetX + (R.BOARD_W * cellSize) / 2;
            const cy = offsetY + (R.BOARD_H * cellSize) / 2;
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
            cellSize = Math.min(w / units, h / units);
            offsetX = (w - R.BOARD_W * cellSize) / 2;
            offsetY = (h - R.BOARD_H * cellSize) / 2;
        }

        function squareCenter(dispRow, dispCol) {
            return {
                x: offsetX + (dispCol + 0.5) * cellSize,
                y: offsetY + (dispRow + 0.5) * cellSize
            };
        }

        function drawCoordinates() {
            const files = boardFlipped()
                ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
                : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            const ranks = boardFlipped()
                ? ['1', '2', '3', '4', '5', '6', '7', '8']
                : ['8', '7', '6', '5', '4', '3', '2', '1'];
            ctx2d.fillStyle = '#5a3a1e';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.font = `${cellSize * 0.22}px Segoe UI`;
            for (let c = 0; c < R.BOARD_W; c++) {
                const x = offsetX + (c + 0.5) * cellSize;
                ctx2d.fillText(files[c], x, offsetY - cellSize * 0.28);
                ctx2d.fillText(files[c], x, offsetY + R.BOARD_H * cellSize + cellSize * 0.28);
            }
            ctx2d.textAlign = 'right';
            for (let r = 0; r < R.BOARD_H; r++) {
                const y = offsetY + (r + 0.5) * cellSize;
                ctx2d.fillText(ranks[r], offsetX - cellSize * 0.18, y);
            }
            ctx2d.textAlign = 'left';
            for (let r = 0; r < R.BOARD_H; r++) {
                const y = offsetY + (r + 0.5) * cellSize;
                ctx2d.fillText(ranks[r], offsetX + R.BOARD_W * cellSize + cellSize * 0.18, y);
            }
        }

        function refreshLegalTargets() {
            ps.legalTargets = [];
            if (ps.selectedRow < 0) return;
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const seen = {};
            for (const m of R.generateLegalMoves(ps.board, side)) {
                if (m.fromRow !== ps.selectedRow || m.fromCol !== ps.selectedCol) continue;
                const key = m.toRow + ',' + m.toCol;
                if (seen[key]) continue;
                seen[key] = true;
                ps.legalTargets.push({ row: m.toRow, col: m.toCol });
            }
        }

        function drawBoard() {
            calcGeometry();
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);

            const boardFill = '#edbc80';
            ctx2d.fillStyle = boardFill;
            ctx2d.fillRect(offsetX, offsetY, R.BOARD_W * cellSize, R.BOARD_H * cellSize);

            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 1.2;
            for (let i = 0; i <= R.BOARD_W; i++) {
                const x = offsetX + i * cellSize;
                ctx2d.beginPath();
                ctx2d.moveTo(x, offsetY);
                ctx2d.lineTo(x, offsetY + R.BOARD_H * cellSize);
                ctx2d.stroke();
            }
            for (let i = 0; i <= R.BOARD_H; i++) {
                const y = offsetY + i * cellSize;
                ctx2d.beginPath();
                ctx2d.moveTo(offsetX, y);
                ctx2d.lineTo(offsetX + R.BOARD_W * cellSize, y);
                ctx2d.stroke();
            }

            ctx2d.strokeStyle = '#3a281c';
            ctx2d.lineWidth = 2;
            ctx2d.strokeRect(offsetX, offsetY, R.BOARD_W * cellSize, R.BOARD_H * cellSize);
            drawCoordinates();

            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom, ps.lastTo].forEach((p) => {
                    const d = toDisplayCoord(p.row, p.col);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                });
            }

            if (ps.inCheck) {
                const king = R.findKing(ps.board, ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove);
                if (king) {
                    const d = toDisplayCoord(king.row, king.col);
                    ctx2d.fillStyle = 'rgba(200,40,40,0.35)';
                    ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
                }
            }

            for (const t of ps.legalTargets) {
                const d = toDisplayCoord(t.row, t.col);
                const { x, y } = squareCenter(d.row, d.col);
                const occupied = !!ps.board[t.row][t.col];
                if (occupied) {
                    ctx2d.beginPath();
                    ctx2d.arc(x, y, cellSize * 0.44, 0, Math.PI * 2);
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = 4;
                    ctx2d.stroke();
                } else {
                    ctx2d.beginPath();
                    ctx2d.arc(x, y, cellSize * 0.14, 0, Math.PI * 2);
                    ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.fill();
                }
            }

            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const piece = ps.board[r][c];
                    if (!piece) continue;
                    const d = toDisplayCoord(r, c);
                    const { x, y } = squareCenter(d.row, d.col);
                    const radius = cellSize * 0.40;
                    ctx2d.shadowOffsetY = radius * 0.2;
                    ctx2d.shadowBlur = radius * 0.4;
                    ctx2d.shadowColor = 'rgba(0,0,0,0.4)';
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
                    ctx2d.font = `${cellSize * 0.48}px XiangqiPiece`;
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
                ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                ctx2d.lineWidth = 2;
                ctx2d.strokeRect(
                    offsetX + d.col * cellSize + 2,
                    offsetY + d.row * cellSize + 2,
                    cellSize - 4,
                    cellSize - 4
                );
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
                leadInfo.innerText = '　';
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
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label + (ps.inCheck ? '（将军）' : '');
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            const noPawn = !R.hasUnpromotedPawn(ps.board);
            leadInfo.innerText = (noPawn && ps.noPawnMoveCount > 32)
                ? `无兵限着 ${ps.noPawnMoveCount}/64` : '　';
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
            ps.noPawnMoveCount = state.noPawnMoveCount || 0;
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

        function snapshotFrom(board, side, lastFrom, lastTo) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFrom(R.createInitialBoard(), 'red', null, null)];
            let b = R.createInitialBoard();
            let side = 'red';
            for (const m of ps.moveHistory) {
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol).board;
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side,
                    { row: m.fromRow, col: m.fromCol }, { row: m.toRow, col: m.toCol }));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'red' ? 1 : 2;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = R.isInCheck(ps.board, ps.sideToMove);
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
            a.download = `${recordDownloadPrefix}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function enterReplayMode(data) {
            const moves = data.moves || [];
            const snaps = [snapshotFrom(R.createInitialBoard(), 'red', null, null)];
            let b = R.createInitialBoard();
            let side = 'red';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5] };
                }
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                b = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol).board;
                const lf = { row: m.fromRow, col: m.fromCol };
                const lt = { row: m.toRow, col: m.toCol };
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, lf, lt));
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
                ps.board = R.createInitialBoard();
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
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFrom(ps.board, ps.sideToMove, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.lastFrom, base.lastTo)];
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
            if (!R.isLegalMove(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide)) return false;
            const applied = R.applyMoveOnBoard(ps.board, fromRow, fromCol, toRow, toCol);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(applied.board, side,
                { row: fromRow, col: fromCol }, { row: toRow, col: toCol }));
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
            const dispCol = Math.floor((canvasX - offsetX) / cellSize);
            const dispRow = Math.floor((canvasY - offsetY) / cellSize);
            if (dispRow < 0 || dispRow >= R.BOARD_H || dispCol < 0 || dispCol >= R.BOARD_W) {
                return { row: -1, col: -1 };
            }
            return toOriginalCoord(dispRow, dispCol);
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
            const hit = ps.legalTargets.some((t) => t.row === row && t.col === col);
            if (!hit) return;

            if (ps.tryPlayMode) {
                if (tryPlayMove(fr, fc, row, col)) {
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                }
                return;
            }
            if (R.isLegalMove(ps.board, fr, fc, row, col, side)) {
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
            syncState,
            updateBoardGeometry: () => {},
            initBoardArray: () => R.createInitialBoard(),
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

        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
