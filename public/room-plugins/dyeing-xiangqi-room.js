window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["dyeing-xiangqi"] = {
    shell: {
        "title": "染色象棋",
        "rulesHtml": "基本规则同象棋，对局双方变为红与绿，所有棋子初始时为黑色中立。<br /><br />每手棋可以可移动己方棋子或中立棋子，移动中立棋子时占领这枚棋子。<br /><br />每方最多可占领1枚帥/將、2枚俥/車、2枚傌/馬、2枚炮/砲、2枚相/象、2枚仕/士、5枚兵/卒。<br /><br />棋盘上仅剩一枚將/帥时占领將/帥的一方获胜；无将帅时和棋。<br /><br />",
        "defaultKomiText": "",
        "boardSizeMin": 7,
        "boardSizeMax": 21,
        "defaultBoardSize": 19,
        "minLib": 1,
        "recordDownloadPrefix": "染色象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "xiangqi": true,
            "dyeingBags": true,
            "hideBoardSize": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "染色象棋";
        var minLib = config.minLib != null ? config.minLib : 1;
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;


        (function () {
const R = (function () {
'use strict';

const BOARD_H = 10;
const BOARD_W = 9;

const PIECE_CHAR = {
    rk: '帥', ra: '仕', re: '相', rn: '傌', rr: '俥', rc: '炮', rp: '兵',
    bk: '將', ba: '士', be: '象', bn: '馬', br: '車', bc: '砲', bp: '卒'
};

const CATEGORY_OF = {
    k: 'king', a: 'advisor', e: 'elephant', n: 'horse',
    r: 'rook', c: 'cannon', p: 'pawn'
};

const CAP_LIMITS = {
    king: 1, advisor: 2, elephant: 2, horse: 2, rook: 2, cannon: 2, pawn: 5
};

/** 背包展示顺序：帥將俥車傌馬炮砲相象仕士兵卒 */
const DISPLAY_ORDER = [
    'rk', 'bk', 'rr', 'br', 'rn', 'bn', 'rc', 'bc',
    're', 'be', 'ra', 'ba', 'rp', 'bp'
];

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(null));
}

function copyCell(cell) {
    if (!cell) return null;
    return { type: cell.type, owner: cell.owner };
}

function copyBoard(src) {
    return src.map((row) => row.map(copyCell));
}

function emptyBags() {
    return { red: [], green: [] };
}

function copyBags(bags) {
    return {
        red: (bags && bags.red ? bags.red.slice() : []),
        green: (bags && bags.green ? bags.green.slice() : [])
    };
}

function createInitialBoard() {
    const b = emptyBoard();
    const N = 'neutral';
    b[0][0] = { type: 'br', owner: N }; b[0][8] = { type: 'br', owner: N };
    b[0][1] = { type: 'bn', owner: N }; b[0][7] = { type: 'bn', owner: N };
    b[0][2] = { type: 'be', owner: N }; b[0][6] = { type: 'be', owner: N };
    b[0][3] = { type: 'ba', owner: N }; b[0][5] = { type: 'ba', owner: N };
    b[0][4] = { type: 'bk', owner: N };
    b[2][1] = { type: 'bc', owner: N }; b[2][7] = { type: 'bc', owner: N };
    for (let i = 0; i < 5; i++) b[3][2 * i] = { type: 'bp', owner: N };

    b[9][0] = { type: 'rr', owner: N }; b[9][8] = { type: 'rr', owner: N };
    b[9][1] = { type: 'rn', owner: N }; b[9][7] = { type: 'rn', owner: N };
    b[9][2] = { type: 're', owner: N }; b[9][6] = { type: 're', owner: N };
    b[9][3] = { type: 'ra', owner: N }; b[9][5] = { type: 'ra', owner: N };
    b[9][4] = { type: 'rk', owner: N };
    b[7][1] = { type: 'rc', owner: N }; b[7][7] = { type: 'rc', owner: N };
    for (let i = 0; i < 5; i++) b[6][2 * i] = { type: 'rp', owner: N };
    return b;
}

function oppositeSide(side) {
    return side === 'red' ? 'green' : 'red';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'red' : 'green';
}

function slotFromSide(side) {
    return side === 'red' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function categoryOfType(type) {
    if (!type || type.length < 2) return null;
    return CATEGORY_OF[type[1]] || null;
}

function countCategory(bag, cat) {
    let n = 0;
    for (let i = 0; i < bag.length; i++) {
        if (categoryOfType(bag[i]) === cat) n++;
    }
    return n;
}

function canOccupy(bags, side, type) {
    const cat = categoryOfType(type);
    if (!cat) return false;
    return countCategory(bags[side] || [], cat) < CAP_LIMITS[cat];
}

function sortedBag(bag) {
    const list = bag ? bag.slice() : [];
    list.sort((a, b) => {
        const ia = DISPLAY_ORDER.indexOf(a);
        const ib = DISPLAY_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return list;
}

function inPalace(camp, row, col) {
    if (col < 3 || col > 5) return false;
    if (camp === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function findKings(board) {
    const kings = [];
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (p && p.type && p.type[1] === 'k') {
                kings.push({ row: r, col: c, type: p.type, owner: p.owner });
            }
        }
    }
    return kings;
}

function findOwnedKing(board, side) {
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (p && p.type && p.type[1] === 'k' && p.owner === side) {
                return { row: r, col: c, type: p.type, owner: p.owner };
            }
        }
    }
    return null;
}

function kingsFaceEachOther(board) {
    let rk = null;
    let bk = null;
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            if (p.type === 'rk') rk = { row: r, col: c };
            if (p.type === 'bk') bk = { row: r, col: c };
        }
    }
    if (!rk || !bk || rk.col !== bk.col) return false;
    const minR = Math.min(rk.row, bk.row);
    const maxR = Math.max(rk.row, bk.row);
    for (let r = minR + 1; r < maxR; r++) {
        if (board[r][rk.col]) return false;
    }
    return true;
}

/**
 * 几何走法（阵营约束按 type 前缀；炮吃子看目标是否有子）。
 * 「不能吃己方」由 isLegalMove / isPseudoLegalMove 按行棋方判定。
 */
function isGeometryLegal(pieceType, fromRow, fromCol, toRow, toCol, board) {
    if (!pieceType || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    const color = pieceType[0];
    const kind = pieceType[1];
    const target = board[toRow][toCol];
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    const camp = color === 'r' ? 'red' : 'black';

    if (kind === 'k') {
        if (aR + aC !== 1) return false;
        return inPalace(camp, toRow, toCol);
    }
    if (kind === 'a') {
        if (!(aR === 1 && aC === 1)) return false;
        return inPalace(camp, toRow, toCol);
    }
    if (kind === 'e') {
        if (!(aR === 2 && aC === 2)) return false;
        const midR = fromRow + dR / 2;
        const midC = fromCol + dC / 2;
        if (board[midR][midC]) return false;
        if (camp === 'red') return toRow >= 5;
        return toRow <= 4;
    }
    if (kind === 'n') {
        if (aR === 2 && aC === 1) {
            const legR = fromRow + (dR > 0 ? 1 : -1);
            return !board[legR][fromCol];
        }
        if (aR === 1 && aC === 2) {
            const legC = fromCol + (dC > 0 ? 1 : -1);
            return !board[fromRow][legC];
        }
        return false;
    }
    if (kind === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        if (fromRow === toRow) {
            const step = toCol > fromCol ? 1 : -1;
            for (let c = fromCol + step; c !== toCol; c += step) {
                if (board[fromRow][c]) return false;
            }
            return true;
        }
        const step = toRow > fromRow ? 1 : -1;
        for (let r = fromRow + step; r !== toRow; r += step) {
            if (board[r][fromCol]) return false;
        }
        return true;
    }
    if (kind === 'c') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        let cnt = 0;
        if (fromRow === toRow) {
            const step = toCol > fromCol ? 1 : -1;
            for (let c = fromCol + step; c !== toCol; c += step) {
                if (board[fromRow][c]) cnt++;
            }
        } else {
            const step = toRow > fromRow ? 1 : -1;
            for (let r = fromRow + step; r !== toRow; r += step) {
                if (board[r][fromCol]) cnt++;
            }
        }
        if (!target) return cnt === 0;
        return cnt === 1;
    }
    if (kind === 'p') {
        const forward = camp === 'red' ? -1 : 1;
        const crossed = camp === 'red' ? fromRow <= 4 : fromRow >= 5;
        if (dR === forward && dC === 0) return true;
        if (crossed && aR === 0 && aC === 1) return true;
        return false;
    }
    return false;
}

function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, moverSide) {
    if (!piece || !piece.type) return false;
    const side = moverSide || piece.owner;
    if (side !== 'red' && side !== 'green') return false;
    const target = board[toRow] && board[toRow][toCol];
    if (target && target.owner === side) return false;
    return isGeometryLegal(piece.type, fromRow, fromCol, toRow, toCol, board);
}

function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, newOwner) {
    const next = copyBoard(board);
    const piece = next[fromRow][fromCol];
    next[toRow][toCol] = {
        type: piece.type,
        owner: newOwner != null ? newOwner : piece.owner
    };
    next[fromRow][fromCol] = null;
    return next;
}

function isSquareAttackedBy(board, row, col, bySide) {
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p.owner !== bySide) continue;
            if (isPseudoLegalMove(p, r, c, row, col, board, bySide)) return true;
        }
    }
    return false;
}

/**
 * 己方已占领的将帅被将军才算被将；叫吃中立将帅不算将军。
 */
function isInCheck(board, side) {
    const king = findOwnedKing(board, side);
    if (!king) return false;
    if (kingsFaceEachOther(board)) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

/**
 * 盘面胜负：仅剩一枚将帅且已被占领 → 占领方胜；无将帅 → 和。
 * 唯一将帅仍中立时未终局。
 */
function evaluateOutcome(board) {
    const kings = findKings(board);
    if (kings.length === 0) return { over: true, winner: 'draw' };
    if (kings.length === 1) {
        const k = kings[0];
        if (k.owner === 'red' || k.owner === 'green') {
            return { over: true, winner: k.owner };
        }
        return { over: false };
    }
    return { over: false };
}

function simulateMove(board, bags, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece) return null;
    const occupying = piece.owner === 'neutral';
    const newOwner = occupying ? side : piece.owner;
    const nextBoard = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, newOwner);
    const nextBags = copyBags(bags);
    if (occupying) nextBags[side].push(piece.type);
    return { board: nextBoard, bags: nextBags, occupying, newOwner, pieceType: piece.type };
}

function isLegalMove(board, bags, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || !piece.type) return false;
    if (piece.owner !== side && piece.owner !== 'neutral') return false;

    const occupying = piece.owner === 'neutral';
    if (occupying && !canOccupy(bags, side, piece.type)) return false;

    const target = board[toRow] && board[toRow][toCol];
    if (target && target.owner === side) return false;
    if (!isGeometryLegal(piece.type, fromRow, fromCol, toRow, toCol, board)) return false;

    const sim = simulateMove(board, bags, fromRow, fromCol, toRow, toCol, side);
    if (!sim) return false;

    const outcome = evaluateOutcome(sim.board);
    // 立即获胜（占领唯一将帅等）允许「送将」
    if (outcome.over && outcome.winner === side) return true;

    if (kingsFaceEachOther(sim.board)) return false;
    if (isInCheck(sim.board, side)) return false;
    return true;
}

function generateLegalMoves(board, bags, side) {
    const moves = [];
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || (p.owner !== side && p.owner !== 'neutral')) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (isLegalMove(board, bags, fr, fc, tr, tc, side)) {
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

function hasLegalMove(board, bags, side) {
    return generateLegalMoves(board, bags, side).length > 0;
}

function positionKey(board, bags, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'g|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) s += '.';
            else s += p.type + (p.owner === 'red' ? 'R' : p.owner === 'green' ? 'G' : 'N');
            s += ',';
        }
        s += ';';
    }
    s += '|B:' + (bags.red || []).join('') + '/' + (bags.green || []).join('');
    return s;
}

function pieceLabel(type) {
    return PIECE_CHAR[type] || '?';
}

function ownerColorHex(owner) {
    if (owner === 'red') return '#932c13';
    if (owner === 'green') return '#1c7353';
    return '#2c2c2c';
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    CAP_LIMITS,
    DISPLAY_ORDER,
    emptyBoard,
    copyBoard,
    copyBags,
    emptyBags,
    createInitialBoard,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    categoryOfType,
    countCategory,
    canOccupy,
    sortedBag,
    findKings,
    findOwnedKing,
    kingsFaceEachOther,
    isGeometryLegal,
    isPseudoLegalMove,
    applyMoveOnBoard,
    simulateMove,
    isSquareAttackedBy,
    isInCheck,
    evaluateOutcome,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    positionKey,
    pieceLabel,
    ownerColorHex
};
})();

        const SLOT_UI = {
            black: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' },
            white: { name: '绿方', emoji: '🟢', continueText: '继续执绿', choiceText: '执绿', youText: '您执绿', absentText: '绿方已退出', statusText: '绿方' }
        };

const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        // 房间壳默认 600×600；象棋须用与格口边距一致的像素比，否则左右空隙过大
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
            board: R.createInitialBoard(),
            bags: R.emptyBags(),
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
            // 按设计边距落位（宽高比匹配时左右即为 padX，不再被正方形画布撑开）
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
                    if (R.isLegalMove(ps.board, ps.bags, ps.selectedRow, ps.selectedCol, r, c, side))
                        ps.legalTargets.push({ row: r, col: c });
                }
            }
        }

        function renderBags() {
            const redRow = document.getElementById('dyeingRedBagRow');
            const greenRow = document.getElementById('dyeingGreenBagRow');
            if (!redRow || !greenRow) return;
            redRow.innerHTML = '';
            greenRow.innerHTML = '';

            function fill(rowEl, bag, owner) {
                const sorted = R.sortedBag(bag || []);
                const color = R.ownerColorHex(owner);
                for (let i = 0; i < sorted.length; i++) {
                    const type = sorted[i];
                    const slot = document.createElement('div');
                    slot.className = 'dyeing-bag-piece';
                    slot.style.color = color;
                    slot.textContent = R.pieceLabel(type);
                    rowEl.appendChild(slot);
                }
            }
            fill(redRow, ps.bags.red, 'red');
            fill(greenRow, ps.bags.green, 'green');
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
                    if (!piece || !piece.type) continue;
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
                    const color = R.ownerColorHex(piece.owner);
                    ctx2d.fillStyle = color;
                    ctx2d.font = `${cellSize * 0.52}px XiangqiPiece`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    ctx2d.fillText(R.pieceLabel(piece.type), x, y + cellSize * 0.02);
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
                else if (ps.winner === 'white') text = '🟢 绿方胜';
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
            const label = side === 'red' ? '🔴 红方行棋' : '🟢 绿方行棋';
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label + (ps.inCheck ? '（将军）' : '');
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            leadInfo.innerText = '　';
        }

        function syncState(state) {
            if (!state) return;
            if (state.board) ps.board = R.copyBoard(state.board);
            if (state.bags) ps.bags = R.copyBags(state.bags);
            if (state.sideToMove) {
                ps.sideToMove = state.sideToMove;
                ps.currentPlayer = state.sideToMove === 'red' ? 1 : 2;
            } else if (state.currentPlayer) {
                ps.currentPlayer = state.currentPlayer;
                ps.sideToMove = state.currentPlayer === 1 ? 'red' : 'green';
            }
            ps.gameOver = !!state.gameOver;
            ps.winner = state.winner != null ? state.winner : null;
            ps.lastFrom = state.lastFrom || null;
            ps.lastTo = state.lastTo || null;
            ps.inCheck = !!state.inCheck;
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) ps.moveHistory = state.moveHistory.slice();
            else if (state.moveCoords) {
                ps.moveHistory = state.moveCoords.filter((m) => m.type === 'move').map((m) => ({
                    player: m.player, fromRow: m.fromRow, fromCol: m.fromCol,
                    toRow: m.toRow, toCol: m.toCol, piece: m.piece, captured: m.captured,
                    occupying: m.occupying
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
            renderBags();
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

        function snapshotFromBoard(board, bags, side, lastFrom, lastTo, extra) {
            return {
                board: R.copyBoard(board),
                bags: R.copyBags(bags),
                sideToMove: side,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null,
                ...(extra || {})
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFromBoard(R.createInitialBoard(), R.emptyBags(), 'red', null, null)];
            let b = R.createInitialBoard();
            let bags = R.emptyBags();
            let side = 'red';
            for (const m of ps.moveHistory) {
                if (!R.isLegalMove(b, bags, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                const sim = R.simulateMove(b, bags, m.fromRow, m.fromCol, m.toRow, m.toCol, side);
                b = sim.board;
                bags = sim.bags;
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, bags, side, { row: m.fromRow, col: m.fromCol }, { row: m.toRow, col: m.toCol }));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.bags = R.copyBags(s.bags || R.emptyBags());
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'red' ? 1 : 2;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = R.isInCheck(ps.board, ps.sideToMove);
            ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
            updateTurn();
            drawBoard();
            renderBags();
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
            a.download = `染色象棋_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function enterReplayMode(data) {
            const moves = data.moves || [];
            const snaps = [snapshotFromBoard(R.createInitialBoard(), R.emptyBags(), 'red', null, null)];
            let b = R.createInitialBoard();
            let bags = R.emptyBags();
            let side = 'red';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5] };
                }
                if (!R.isLegalMove(b, bags, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
                const sim = R.simulateMove(b, bags, m.fromRow, m.fromCol, m.toRow, m.toCol, side);
                b = sim.board;
                bags = sim.bags;
                const lf = { row: m.fromRow, col: m.fromCol };
                const lt = { row: m.toRow, col: m.toCol };
                side = R.oppositeSide(side);
                snaps.push(snapshotFromBoard(b, bags, side, lf, lt));
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
                ps.bags = R.emptyBags();
                ps.sideToMove = 'red';
                updateTurn();
                drawBoard();
                renderBags();
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
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFromBoard(ps.board, ps.bags, ps.sideToMove, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.bags, base.sideToMove, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFromBoard(base.board, base.bags, base.sideToMove, base.lastFrom, base.lastTo)];
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
            if (!R.isLegalMove(ps.board, ps.bags, fromRow, fromCol, toRow, toCol, ps.tryPlaySide)) return false;
            const sim = R.simulateMove(ps.board, ps.bags, fromRow, fromCol, toRow, toCol, ps.tryPlaySide);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFromBoard(sim.board, sim.bags, side, { row: fromRow, col: fromCol }, { row: toRow, col: toCol }));
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

            if (ps.selectedRow < 0) {
                const p = ps.board[row][col];
                if (p && p.type && (p.owner === side || p.owner === 'neutral')) {
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

            const fr = ps.selectedRow, fc = ps.selectedCol;
            if (ps.tryPlayMode) {
                if (tryPlayMove(fr, fc, row, col)) {
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    return;
                }
            } else if (R.isLegalMove(ps.board, ps.bags, fr, fc, row, col, side)) {
                commitMove(fr, fc, row, col);
                ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                drawBoard();
                return;
            }

            const p2 = ps.board[row][col];
            if (p2 && p2.type && (p2.owner === side || p2.owner === 'neutral')) {
                ps.selectedRow = row;
                ps.selectedCol = col;
                refreshLegalTargets();
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
            onSeatOverlayUpdated() { drawBoard(); renderBags(); }
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
                    renderBags();
                    updateTurn();
                    updateReplayUI();
                }
                if (msg.type === 'gameRecord') downloadRecord(msg.data);
            };
            ws.onclose = () => {
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

        // 导入/导出、新局/悔棋/认输/和棋由 createWeiqiMessageBindings 绑定
        updateTurn();
        drawBoard();
        renderBags();
        updateMatchControlButtons();
        })();
    }
};
