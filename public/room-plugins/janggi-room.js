window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["janggi"] = {
    shell: {
        "title": "朝鲜将棋",
        "rulesHtml": "基本规则同朝鲜将棋，蓝先红后，将死对方的漢/楚获胜。<br /><br /><strong>开局配置</strong>：开局前可以任意交换每一边馬和象的位置，红方先交换。<br /><strong>楚/漢</strong>：在九宫内沿直线或斜线走一格，不能出九宫。<br /><strong>車</strong>：直走或沿九宫斜线走任意格。<br /><strong>馬</strong>：直走一格再斜走一格，路径上不能有其它棋子。<br /><strong>包</strong>：路线与車相同，但是移动和吃子时都必须跨越一子，跨越的这颗棋子不能是包，也不能吃包。<br /><strong>象</strong>：直走一格再斜走两格，路径上不能有其它棋子。<br /><strong>士</strong>：在九宫内沿直线或斜线走一格，不能出九宫。<br /><strong>兵/卒</strong>：向前或左右直走一格，或沿九宫的斜线前进一格。<br /><br />一方可以用楚漢照面来邀请和棋，另一方可以停止照面来拒绝和棋，或接受和棋。<br /><br />允许虚着（无困毙）。<br /><br />",
        "defaultKomiText": "蓝先",
        "boardSizeMin": 9,
        "boardSizeMax": 9,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "朝鲜将棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "xiangqi": true,
            "janggi": true,
            "hideBoardSize": true
        },
        // 顺序：楚漢士象馬車包兵卒。双方为蓝/红：蓝方（楚）棋子 #1a5fa8、红方（漢）棋子 #932c13，与棋盘一致
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "rk", "label": "楚", "cellValue": "rk", "color": "#1a5fa8" },
            { "value": "ra", "label": "士", "cellValue": "ra", "color": "#1a5fa8" },
            { "value": "re", "label": "象", "cellValue": "re", "color": "#1a5fa8" },
            { "value": "rn", "label": "馬", "cellValue": "rn", "color": "#1a5fa8" },
            { "value": "rr", "label": "車", "cellValue": "rr", "color": "#1a5fa8" },
            { "value": "rc", "label": "包", "cellValue": "rc", "color": "#1a5fa8" },
            { "value": "rp", "label": "兵", "cellValue": "rp", "color": "#1a5fa8" },
            { "value": "bk", "label": "漢", "cellValue": "bk", "color": "#932c13" },
            { "value": "ba", "label": "士", "cellValue": "ba", "color": "#932c13" },
            { "value": "be", "label": "象", "cellValue": "be", "color": "#932c13" },
            { "value": "bn", "label": "馬", "cellValue": "bn", "color": "#932c13" },
            { "value": "br", "label": "車", "cellValue": "br", "color": "#932c13" },
            { "value": "bc", "label": "包", "cellValue": "bc", "color": "#932c13" },
            { "value": "bp", "label": "卒", "cellValue": "bp", "color": "#932c13" }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "朝鲜将棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const BOARD_H = 10;
const BOARD_W = 9;

const PIECE_CHAR = {
    rk: '楚', bk: '漢',
    ra: '士', ba: '士',
    re: '象', be: '象',
    rn: '馬', bn: '馬',
    rr: '車', br: '車',
    rc: '包', bc: '包',
    rp: '兵', bp: '卒'
};

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function createInitialBoard() {
    const b = emptyBoard();
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'be'; b[0][3] = 'ba';
    b[0][5] = 'ba'; b[0][6] = 'be'; b[0][7] = 'bn'; b[0][8] = 'br';
    b[1][4] = 'bk';
    b[2][1] = 'bc'; b[2][7] = 'bc';
    for (let c = 0; c < BOARD_W; c += 2) b[3][c] = 'bp';

    b[9][0] = 'rr'; b[9][1] = 'rn'; b[9][2] = 're'; b[9][3] = 'ra';
    b[9][5] = 'ra'; b[9][6] = 're'; b[9][7] = 'rn'; b[9][8] = 'rr';
    b[8][4] = 'rk';
    b[7][1] = 'rc'; b[7][7] = 'rc';
    for (let c = 0; c < BOARD_W; c += 2) b[6][c] = 'rp';
    return b;
}

const SETUP_WINGS = [[1, 2], [6, 7]];

function setupBackRow(side) {
    return side === 'red' ? 9 : 0;
}

function isSetupHorseOrElephant(piece, side) {
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    return piece[1] === 'n' || piece[1] === 'e';
}

function canOpeningSwap(board, side, r1, c1, r2, c2) {
    if (r1 !== r2 || r1 !== setupBackRow(side) || c1 === c2) return false;
    const p1 = board[r1][c1];
    const p2 = board[r2][c2];
    if (!isSetupHorseOrElephant(p1, side) || !isSetupHorseOrElephant(p2, side)) return false;
    if (p1[1] === p2[1]) return false;
    return SETUP_WINGS.some((w) => w.includes(c1) && w.includes(c2));
}

function applyOpeningSwap(board, r1, c1, r2, c2) {
    const next = copyBoard(board);
    const tmp = next[r1][c1];
    next[r1][c1] = next[r2][c2];
    next[r2][c2] = tmp;
    return next;
}

function sideColorChar(side) {
    return side === 'red' ? 'r' : 'b';
}

function oppositeSide(side) {
    return side === 'red' ? 'black' : 'red';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'red' : 'black';
}

function slotFromSide(side) {
    return side === 'red' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function inPalace(side, row, col) {
    if (col < 3 || col > 5) return false;
    if (side === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function palaceSideAt(row) {
    return row <= 2 ? 'black' : 'red';
}

function onSamePalaceDiagonal(r1, c1, r2, c2) {
    if (c1 < 3 || c1 > 5 || c2 < 3 || c2 > 5) return false;
    const s1 = palaceSideAt(r1);
    const s2 = palaceSideAt(r2);
    if (s1 !== s2) return false;
    if (s1 === 'black') {
        if (r1 - c1 === -3 && r2 - c2 === -3) return true;
        if (r1 + c1 === 5 && r2 + c2 === 5) return true;
        return false;
    }
    if (r1 - c1 === 4 && r2 - c2 === 4) return true;
    if (r1 + c1 === 12 && r2 + c2 === 12) return true;
    return false;
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

function pathClearOrthogonal(board, fromRow, fromCol, toRow, toCol) {
    if (fromRow === toRow) {
        const step = toCol > fromCol ? 1 : -1;
        for (let c = fromCol + step; c !== toCol; c += step) {
            if (board[fromRow][c] !== '') return false;
        }
        return true;
    }
    if (fromCol === toCol) {
        const step = toRow > fromRow ? 1 : -1;
        for (let r = fromRow + step; r !== toRow; r += step) {
            if (board[r][fromCol] !== '') return false;
        }
        return true;
    }
    return false;
}

function pathClearPalaceDiagonal(board, fromRow, fromCol, toRow, toCol) {
    if (!onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) return false;
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (!onSamePalaceDiagonal(fromRow, fromCol, r, c)) return false;
        if (board[r][c] !== '') return false;
        r += dR;
        c += dC;
    }
    return true;
}

function countScreens(board, fromRow, fromCol, toRow, toCol, diagonal) {
    let cnt = 0;
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (diagonal && !onSamePalaceDiagonal(fromRow, fromCol, r, c)) return -1;
        const p = board[r][c];
        if (p) {
            if (p[1] === 'c') return -1;
            cnt++;
        }
        r += dR;
        c += dC;
    }
    return cnt;
}

function elephantBlocked(board, fromRow, fromCol, toRow, toCol) {
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    if (aR === 3 && aC === 2) {
        const sR = dR > 0 ? 1 : -1;
        const sC = dC > 0 ? 1 : -1;
        if (board[fromRow + sR][fromCol] !== '') return true;
        if (board[fromRow + 2 * sR][fromCol + sC] !== '') return true;
        return false;
    }
    if (aR === 2 && aC === 3) {
        const sR = dR > 0 ? 1 : -1;
        const sC = dC > 0 ? 1 : -1;
        if (board[fromRow + sR][fromCol] !== '') return true;
        if (board[fromRow][fromCol + sC] !== '') return true;
        return false;
    }
    return true;
}

function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board) {
    if (!piece || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const color = piece[0];
    const type = piece[1];
    const target = board[toRow][toCol];
    if (target && target[0] === color) return false;

    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);
    const side = color === 'r' ? 'red' : 'black';

    if (type === 'k' || type === 'a') {
        if (!inPalace(side, toRow, toCol)) return false;
        if (aR + aC === 1) return true;
        if (aR === 1 && aC === 1 && onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) return true;
        return false;
    }

    if (type === 'e') {
        if (!((aR === 3 && aC === 2) || (aR === 2 && aC === 3))) return false;
        return !elephantBlocked(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'n') {
        if (aR === 2 && aC === 1) {
            const legR = fromRow + (dR > 0 ? 1 : -1);
            return board[legR][fromCol] === '';
        }
        if (aR === 1 && aC === 2) {
            const legC = fromCol + (dC > 0 ? 1 : -1);
            return board[fromRow][legC] === '';
        }
        return false;
    }

    if (type === 'r') {
        if (fromRow === toRow || fromCol === toCol) {
            return pathClearOrthogonal(board, fromRow, fromCol, toRow, toCol);
        }
        if (onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
            return pathClearPalaceDiagonal(board, fromRow, fromCol, toRow, toCol);
        }
        return false;
    }

    if (type === 'c') {
        if (target && target[1] === 'c') return false;

        if (fromRow === toRow || fromCol === toCol) {
            const cnt = countScreens(board, fromRow, fromCol, toRow, toCol, false);
            return cnt === 1;
        }
        if (onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
            const cnt = countScreens(board, fromRow, fromCol, toRow, toCol, true);
            return cnt === 1;
        }
        return false;
    }

    if (type === 'p') {
        const forward = side === 'red' ? -1 : 1;
        if (dR === forward && dC === 0) return true;
        if (dR === 0 && aC === 1) return true;
        const enemyPalace = side === 'red' ? 'black' : 'red';
        if (inPalace(enemyPalace, fromRow, fromCol) && inPalace(enemyPalace, toRow, toCol)) {
            if (dR === forward && aR === 1 && aC === 1
                && onSamePalaceDiagonal(fromRow, fromCol, toRow, toCol)) {
                return true;
            }
        }
        return false;
    }

    return false;
}

function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol) {
    const next = copyBoard(board);
    next[toRow][toCol] = next[fromRow][fromCol];
    next[fromRow][fromCol] = '';
    return next;
}

/** 两将同列且中间无子（對宫 / 빅장） */
function kingsFaceEachOther(board) {
    const rk = findKing(board, 'red');
    const bk = findKing(board, 'black');
    if (!rk || !bk || rk.col !== bk.col) return false;
    return pathClearOrthogonal(board, rk.row, rk.col, bk.row, bk.col);
}

/** 将沿纵线攻击（照面用，视同车的直线攻击） */
function kingAttacksSquare(board, kingRow, kingCol, row, col) {
    if (kingCol !== col || kingRow === row) return false;
    return pathClearOrthogonal(board, kingRow, kingCol, row, col);
}

function isSquareAttackedBy(board, row, col, bySide, opts) {
    const ignoreFacingKing = !!(opts && opts.ignoreFacingKing);
    const ch = sideColorChar(bySide);
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p || p[0] !== ch) continue;
            if (p[1] === 'k') {
                if (ignoreFacingKing) continue;
                if (kingAttacksSquare(board, r, c, row, col)) return true;
                continue;
            }
            if (isPseudoLegalMove(p, r, c, row, col, board)) return true;
        }
    }
    return false;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
}

/** 是否被非「对方将照面」的棋子将军 */
function isInCheckExceptFacingKing(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side), { ignoreFacingKing: true });
}

function isLegalMove(board, fromRow, fromCol, toRow, toCol, side) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board)) return false;
    const next = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
    const faceBefore = kingsFaceEachOther(board);
    const faceAfter = kingsFaceEachOther(next);
    if (isInCheckExceptFacingKing(next, side)) return false;
    if (faceBefore && faceAfter) return false;
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

function isInsufficientMaterial(board) {
    let majors = 0;
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p[1];
            if (t === 'r' || t === 'n' || t === 'c' || t === 'p') return false;
            if (t === 'e') majors++;
        }
    }
    return majors <= 2;
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

function nextHalfmoveState(prev, moveWasCapture, gaveCheck, moverSide) {
    const base = prev || { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
    if (moveWasCapture) {
        return { halfmoveClock: 0, checksRed: 0, checksBlack: 0, skipNext: false };
    }
    let { halfmoveClock, checksRed, checksBlack, skipNext } = base;
    if (skipNext) {
        return { halfmoveClock, checksRed, checksBlack, skipNext: false };
    }
    if (gaveCheck) {
        if (moverSide === 'red') {
            if (checksRed < 10) {
                checksRed++;
                halfmoveClock++;
                return { halfmoveClock, checksRed, checksBlack, skipNext: false };
            }
            return { halfmoveClock, checksRed, checksBlack, skipNext: true };
        }
        if (checksBlack < 10) {
            checksBlack++;
            halfmoveClock++;
            return { halfmoveClock, checksRed, checksBlack, skipNext: false };
        }
        return { halfmoveClock, checksRed, checksBlack, skipNext: true };
    }
    halfmoveClock++;
    return { halfmoveClock, checksRed, checksBlack, skipNext: false };
}

function judgeRepetition(historyKeys, checkFlags) {
    if (!historyKeys || historyKeys.length < 3) return null;
    const cur = historyKeys[historyKeys.length - 1];
    const indices = [];
    for (let i = 0; i < historyKeys.length; i++) {
        if (historyKeys[i] === cur) indices.push(i);
    }
    if (indices.length < 3) return null;

    const i2 = indices[indices.length - 1];
    const i1 = indices[indices.length - 2];
    if (i2 - i1 < 2) return { result: 'draw', reason: 'repetition' };

    const stats = { red: { moves: 0, checks: 0 }, black: { moves: 0, checks: 0 } };
    for (let j = i1; j < i2; j++) {
        const mover = historyKeys[j][0] === 'r' ? 'red' : 'black';
        stats[mover].moves++;
        if (checkFlags && checkFlags[j]) stats[mover].checks++;
    }

    const redPerp = stats.red.moves > 0 && stats.red.checks === stats.red.moves;
    const blackPerp = stats.black.moves > 0 && stats.black.checks === stats.black.moves;
    if (redPerp && !blackPerp) return { result: 'loss', loserSide: 'red', reason: 'perpetualCheck' };
    if (blackPerp && !redPerp) return { result: 'loss', loserSide: 'black', reason: 'perpetualCheck' };
    return { result: 'draw', reason: 'repetition' };
}

function pieceLabel(code) {
    return PIECE_CHAR[code] || '?';
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    emptyBoard,
    copyBoard,
    createInitialBoard,
    SETUP_WINGS,
    setupBackRow,
    isSetupHorseOrElephant,
    canOpeningSwap,
    applyOpeningSwap,
    sideColorChar,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    inPalace,
    findKing,
    kingsFaceEachOther,
    isPseudoLegalMove,
    applyMoveOnBoard,
    isInCheck,
    isInCheckExceptFacingKing,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    isInsufficientMaterial,
    positionKey,
    nextHalfmoveState,
    judgeRepetition,
    pieceLabel
};
})();

        const SLOT_UI = {
            black: { name: '蓝方', emoji: '🔵', continueText: '继续执蓝', choiceText: '执蓝', youText: '您执蓝', absentText: '蓝方已退出', statusText: '蓝方' },
            white: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' }
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
            openingSetup: null,
            setupBoard: null,
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
                    if (R.isLegalMove(ps.board, ps.selectedRow, ps.selectedCol, r, c, side))
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
                ctx2d.beginPath();
                ctx2d.moveTo(x, offsetY);
                ctx2d.lineTo(x, offsetY + (R.BOARD_H - 1) * cellSize);
                ctx2d.stroke();
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

            function pathOctagon(cx, cy, rad) {
                ctx2d.beginPath();
                for (let i = 0; i < 8; i++) {
                    const a = Math.PI / 8 + i * Math.PI / 4;
                    const px = cx + rad * Math.cos(a);
                    const py = cy + rad * Math.sin(a);
                    if (i === 0) ctx2d.moveTo(px, py);
                    else ctx2d.lineTo(px, py);
                }
                ctx2d.closePath();
            }

            function pieceSizeScaleOf(piece) {
                if (!piece) return 1;
                const t = piece[1];
                if (t === 'k') return 1.22;
                if (t === 'a' || t === 'p') return 0.78;
                return 1;
            }

            function pieceSizeScaleAt(row, col) {
                return pieceSizeScaleOf(ps.board[row] && ps.board[row][col]);
            }

            if (ps.lastFrom && ps.lastTo) {
                const lastMove = ps.moveHistory[ps.moveHistory.length - 1];
                const moveScale = (lastMove && lastMove.piece)
                    ? pieceSizeScaleOf(lastMove.piece)
                    : 1;
                [ps.lastFrom, ps.lastTo].forEach((p) => {
                    const d = toDisplayCoord(p.row, p.col);
                    const x = offsetX + d.col * cellSize;
                    const y = offsetY + d.row * cellSize;
                    const rad = cellSize * 0.45 * moveScale;
                    pathOctagon(x, y, rad);
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
                    const sizeScale = pieceSizeScaleAt(r, c);
                    const radius = cellSize * 0.42 * sizeScale;
                    const color = piece[0] === 'r' ? '#1a5fa8' : '#932c13';
                    ctx2d.shadowOffsetY = radius * 0.2;
                    ctx2d.shadowBlur = radius * 0.4;
                    ctx2d.shadowColor = 'rgba(0,0,0,0.45)';
                    pathOctagon(x, y, radius);
                    ctx2d.fillStyle = '#e8d2a0';
                    ctx2d.fill();
                    ctx2d.shadowBlur = 0; ctx2d.shadowOffsetY = 0;
                    ctx2d.strokeStyle = '#c49c6a';
                    ctx2d.lineWidth = 1.5;
                    pathOctagon(x, y, radius);
                    ctx2d.stroke();
                    ctx2d.fillStyle = color;
                    ctx2d.font = `${cellSize * 0.62 * sizeScale}px XiangqiPiece`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    ctx2d.fillText(R.pieceLabel(piece), x, y + cellSize * 0.02 * sizeScale);
                }
            }

            if (ps.selectedRow >= 0) {
                const d = toDisplayCoord(ps.selectedRow, ps.selectedCol);
                const x = offsetX + d.col * cellSize;
                const y = offsetY + d.row * cellSize;
                // 原先圆形 0.46 / 棋子 0.42
                const rad = cellSize * 0.46 * pieceSizeScaleAt(ps.selectedRow, ps.selectedCol);
                pathOctagon(x, y, rad);
                ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                ctx2d.lineWidth = 2;
                ctx2d.stroke();
            }

            drawCheckBanner();
        }

        function resetScoreBoardLayout() {
            scoreBoard.style.display = '';
            scoreBoard.style.justifyContent = '';
            scoreBoard.style.alignItems = '';
            scoreBoard.style.textAlign = '';
        }

        function updateTurn() {
            if (ps.gameOver) {
                let text = '对局结束';
                if (ps.winner === 'draw') text = '和棋';
                else if (ps.winner === 'black') text = '🔵 蓝方胜';
                else if (ps.winner === 'white') text = '🔴 红方胜';
                if (ps.recordResultText) text = ps.recordResultText;
                turnDisplay.innerText = text;
                scoreTitle.innerText = '结果';
                resetScoreBoardLayout();
                scoreBoard.innerText = text;
                leadInfo.innerText = ps.inCheck ? '' : '　';
                return;
            }
            const bothSelected = !!(ps.slots && ps.slots.black && ps.slots.white);
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            if (!matchStarted && !ps.tryPlayMode && !ps.replayMode) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                scoreTitle.innerText = '　';
                resetScoreBoardLayout();
                scoreBoard.innerText = '　';
                leadInfo.innerText = '　';
                return;
            }
            if (ps.openingSetup && !ps.tryPlayMode && !ps.replayMode) {
                turnDisplay.innerText = ps.openingSetup === 'white'
                    ? '🔴 红方配置开局'
                    : '🔵 蓝方配置开局';
                scoreTitle.innerText = '　';
                leadInfo.innerText = '　';
                resetScoreBoardLayout();
                scoreBoard.innerHTML = '';
                if (ps.mySlot === ps.openingSetup) {
                    scoreBoard.style.display = 'flex';
                    scoreBoard.style.justifyContent = 'center';
                    scoreBoard.style.alignItems = 'center';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'ctrl-btn';
                    btn.id = 'janggiSetupDoneBtn';
                    btn.textContent = '配置完成';
                    btn.style.padding = '6px 12px';
                    btn.addEventListener('click', () => {
                        if (!ps.ws || ps.ws.readyState !== 1) return;
                        if (ps.mySlot !== ps.openingSetup) return;
                        ps.ws.send(JSON.stringify({ type: 'setupDone' }));
                    });
                    scoreBoard.appendChild(btn);
                } else {
                    scoreBoard.innerText = '　';
                }
                return;
            }
            resetScoreBoardLayout();
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const label = side === 'red' ? '🔵 蓝方行棋' : '🔴 红方行棋';
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
            if (state.openingSetup !== undefined) ps.openingSetup = state.openingSetup || null;
            if (state.setupBoard !== undefined) {
                ps.setupBoard = state.setupBoard ? R.copyBoard(state.setupBoard) : null;
            }
            if (state.moveHistory) ps.moveHistory = state.moveHistory.slice();
            else if (state.moveCoords) {
                ps.moveHistory = state.moveCoords.map((m) => {
                    if (m.type === 'pass') {
                        return { player: m.player, type: 'pass', pass: true, fromRow: -1, fromCol: -1, toRow: -1, toCol: -1, piece: '', captured: '' };
                    }
                    return {
                        player: m.player, fromRow: m.fromRow, fromCol: m.fromCol,
                        toRow: m.toRow, toCol: m.toCol, piece: m.piece, captured: m.captured
                    };
                });
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
            } else if (ps.openingSetup) {
                ps.isMyTurn = ps.mySlot === ps.openingSetup;
            } else {
                ps.isMyTurn = ps.mySlot === slotOfSide(ps.sideToMove);
            }
            updateMatchControlButtons();
        }

        function updateMatchControlButtons() {
            const isPlayer = !!ps.mySlot;
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            const inSetup = !!ps.openingSetup;
            const showMatch = isPlayer && matchStarted && !ps.replayMode && !inSetup;
            ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = showMatch ? '' : 'none';
            });
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (tryPlayBtn) {
                tryPlayBtn.style.display = (isPlayer && matchStarted && !ps.replayMode) ? 'none' : '';
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
            if (ps.openingSetup) {
                ps.liveSnapshots = [snapshotFromBoard(ps.board, ps.sideToMove, null, null)];
                return;
            }
            const base = ps.setupBoard ? R.copyBoard(ps.setupBoard) : R.createInitialBoard();
            const snaps = [snapshotFromBoard(base, 'red', null, null)];
            let b = R.copyBoard(base);
            let side = 'red';
            for (const m of ps.moveHistory) {
                if (m.pass || m.type === 'pass') {
                    side = R.oppositeSide(side);
                    snaps.push(snapshotFromBoard(b, side, null, null));
                    continue;
                }
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
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
            const base = (data.setupBoard && Array.isArray(data.setupBoard))
                ? R.copyBoard(data.setupBoard)
                : R.createInitialBoard();
            const snaps = [snapshotFromBoard(base, 'red', null, null)];
            let b = R.copyBoard(base);
            let side = 'red';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mp = raw.match(/^([BW])p$/i);
                    if (mp) {
                        side = R.oppositeSide(side);
                        snaps.push(snapshotFromBoard(b, side, null, null));
                        continue;
                    }
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5] };
                } else if (raw && (raw.type === 'pass' || raw.pass)) {
                    side = R.oppositeSide(side);
                    snaps.push(snapshotFromBoard(b, side, null, null));
                    continue;
                }
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side)) break;
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
            ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn'].forEach((id) => {
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
            if (!R.isLegalMove(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide)) return false;
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

            if (ps.openingSetup && !ps.tryPlayMode && !ps.replayMode) {
                if (!ps.isMyTurn) return;
                const side = R.sideFromSlot(ps.openingSetup);
                if (ps.selectedRow < 0) {
                    const p = ps.board[row][col];
                    if (p && R.isSetupHorseOrElephant(p, side)) {
                        ps.selectedRow = row;
                        ps.selectedCol = col;
                        ps.legalTargets = [];
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
                if (R.canOpeningSwap(ps.board, side, fr, fc, row, col)) {
                    if (ps.ws && ps.ws.readyState === 1) {
                        ps.ws.send(JSON.stringify({
                            type: 'setupSwap',
                            fromRow: fr, fromCol: fc, toRow: row, toCol: col
                        }));
                    }
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    drawBoard();
                    return;
                }
                const p2 = ps.board[row][col];
                if (p2 && R.isSetupHorseOrElephant(p2, side)) {
                    ps.selectedRow = row;
                    ps.selectedCol = col;
                    ps.legalTargets = [];
                    drawBoard();
                }
                return;
            }

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
                // timeControlAgreed 在通用绑定里不会 syncState，需补开局配置字段
                if (msg.type === 'timeControlAgreed' && (msg.board || msg.openingSetup != null)) {
                    syncState(msg);
                }
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
