window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["chess"] = {
    shell: {
        "title": "国际象棋",
        "rulesHtml": "基本规则同国际象棋。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 8,
        "boardSizeMax": 8,
        "defaultBoardSize": 8,
        "minLib": 1,
        "recordDownloadPrefix": "国际象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "xiangqi": true,
            "chess": true,
            "hideBoardSize": true
        },
        // 顺序：后车马象兵王 + 象(倒置主教)士(倒置后)相(车+马)亚(后+马)。白棋用空心字形（与最初黑棋相同的字形和颜色 #222），黑棋用实心字形
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "wq", "label": "♕", "cellValue": "wq", "color": "#222" },
            { "value": "wr", "label": "♖", "cellValue": "wr", "color": "#222" },
            { "value": "wn", "label": "♘", "cellValue": "wn", "color": "#222" },
            { "value": "wb", "label": "♗", "cellValue": "wb", "color": "#222" },
            { "value": "wp", "label": "♙", "cellValue": "wp", "color": "#222" },
            { "value": "wk", "label": "♔", "cellValue": "wk", "color": "#222" },
            { "value": "we", "label": "♗", "cellValue": "we", "color": "#222", "upsideDown": true },
            { "value": "wf", "label": "♕", "cellValue": "wf", "color": "#222", "upsideDown": true },
            { "value": "wc", "label": "♘♖", "cellValue": "wc", "color": "#222", "stack": true },
            { "value": "wa", "label": "♘♕", "cellValue": "wa", "color": "#222", "stack": true },
            { "value": "bq", "label": "♛", "cellValue": "bq", "color": "#222" },
            { "value": "br", "label": "♜", "cellValue": "br", "color": "#222" },
            { "value": "bn", "label": "♞", "cellValue": "bn", "color": "#222" },
            { "value": "bb", "label": "♝", "cellValue": "bb", "color": "#222" },
            { "value": "bp", "label": "♟", "cellValue": "bp", "color": "#222" },
            { "value": "bk", "label": "♚", "cellValue": "bk", "color": "#222" },
            { "value": "be", "label": "♝", "cellValue": "be", "color": "#222", "upsideDown": true },
            { "value": "bf", "label": "♛", "cellValue": "bf", "color": "#222", "upsideDown": true },
            { "value": "bc", "label": "♞♜", "cellValue": "bc", "color": "#222", "stack": true },
            { "value": "ba", "label": "♞♛", "cellValue": "ba", "color": "#222", "stack": true }
        ],
        "editToolGlyphSize": 26
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "国际象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';


const BOARD_H = 8;
const BOARD_W = 8;

const PIECE_CHAR = {
    wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
    bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟',
    we: '♝', wf: '♛', wc: '♜', wa: '♛',
    be: '♝', bf: '♛', bc: '♜', ba: '♛'
};

const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function copyCastling(c) {
    return {
        whiteK: !!c.whiteK, whiteQ: !!c.whiteQ,
        blackK: !!c.blackK, blackQ: !!c.blackQ
    };
}

function defaultCastling() {
    return { whiteK: true, whiteQ: true, blackK: true, blackQ: true };
}

function createInitialBoard() {
    const b = emptyBoard();
    b[0][0] = 'br'; b[0][1] = 'bn'; b[0][2] = 'bb'; b[0][3] = 'bq';
    b[0][4] = 'bk'; b[0][5] = 'bb'; b[0][6] = 'bn'; b[0][7] = 'br';
    for (let c = 0; c < 8; c++) b[1][c] = 'bp';

    b[7][0] = 'wr'; b[7][1] = 'wn'; b[7][2] = 'wb'; b[7][3] = 'wq';
    b[7][4] = 'wk'; b[7][5] = 'wb'; b[7][6] = 'wn'; b[7][7] = 'wr';
    for (let c = 0; c < 8; c++) b[6][c] = 'wp';
    return b;
}

function createInitialMeta() {
    return { castling: defaultCastling(), enPassant: null };
}

function sideColorChar(side) {
    return side === 'white' ? 'w' : 'b';
}

function oppositeSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function sideFromSlot(slot) {
    return slot === 'black' ? 'white' : 'black';
}

function slotFromSide(side) {
    return side === 'white' ? 'black' : 'white';
}

function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function findKing(board, side) {
    const code = side === 'white' ? 'wk' : 'bk';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            if (board[r][c] === code) return { row: r, col: c };
        }
    }
    return null;
}

function pathClear(board, fromRow, fromCol, toRow, toCol) {
    const dR = Math.sign(toRow - fromRow);
    const dC = Math.sign(toCol - fromCol);
    let r = fromRow + dR;
    let c = fromCol + dC;
    while (r !== toRow || c !== toCol) {
        if (board[r][c] !== '') return false;
        r += dR;
        c += dC;
    }
    return true;
}

/** 攻击判定（不含易位；兵按斜吃） */
function attacksSquare(piece, fromRow, fromCol, toRow, toCol, board) {
    if (!piece || !inBounds(toRow, toCol)) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    const type = piece[1];
    const dR = toRow - fromRow;
    const dC = toCol - fromCol;
    const aR = Math.abs(dR);
    const aC = Math.abs(dC);

    if (type === 'k') return aR <= 1 && aC <= 1;
    if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);
    if (type === 'p') {
        const forward = piece[0] === 'w' ? -1 : 1;
        return dR === forward && aC === 1;
    }
    if (type === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    if (type === 'b') {
        if (aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    if (type === 'q') {
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    // 象（elephant）：斜走两步，不卡象眼
    if (type === 'e') {
        return aR === aC && aR >= 1 && aR <= 2;
    }
    // 士（ferz）：斜走一格
    if (type === 'f') {
        return aR === 1 && aC === 1;
    }
    // 相（chancellor）：车 + 马
    if (type === 'c') {
        if ((aR === 2 && aC === 1) || (aR === 1 && aC === 2)) return true;
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    // 亚（amazon）：后 + 马
    if (type === 'a') {
        if ((aR === 2 && aC === 1) || (aR === 1 && aC === 2)) return true;
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    return false;
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

/**
 * 几何走法（含吃过路兵目标格、易位目标格；不含将军应将）。
 * promote 仅在升变时需要，此处不校验。
 */
function isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta) {
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
    const side = color === 'w' ? 'white' : 'black';
    const castling = (meta && meta.castling) || defaultCastling();
    const ep = meta && meta.enPassant;

    if (type === 'n') return (aR === 2 && aC === 1) || (aR === 1 && aC === 2);

    if (type === 'b') {
        if (aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'r') {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'q') {
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    if (type === 'k') {
        if (aR <= 1 && aC <= 1) return true;
        // 易位：王横移两格
        if (aR !== 0 || aC !== 2) return false;
        if (isInCheck(board, side)) return false;
        const homeRow = side === 'white' ? 7 : 0;
        if (fromRow !== homeRow || fromCol !== 4) return false;
        if (toCol === 6) {
            if (side === 'white' ? !castling.whiteK : !castling.blackK) return false;
            if (board[homeRow][5] !== '' || board[homeRow][6] !== '') return false;
            if (board[homeRow][7] !== (side === 'white' ? 'wr' : 'br')) return false;
            if (isSquareAttackedBy(board, homeRow, 5, oppositeSide(side))) return false;
            if (isSquareAttackedBy(board, homeRow, 6, oppositeSide(side))) return false;
            return true;
        }
        if (toCol === 2) {
            if (side === 'white' ? !castling.whiteQ : !castling.blackQ) return false;
            if (board[homeRow][1] !== '' || board[homeRow][2] !== '' || board[homeRow][3] !== '') return false;
            if (board[homeRow][0] !== (side === 'white' ? 'wr' : 'br')) return false;
            if (isSquareAttackedBy(board, homeRow, 3, oppositeSide(side))) return false;
            if (isSquareAttackedBy(board, homeRow, 2, oppositeSide(side))) return false;
            return true;
        }
        return false;
    }

    if (type === 'p') {
        const forward = side === 'white' ? -1 : 1;
        const startRow = side === 'white' ? 6 : 1;
        // 直走
        if (dC === 0 && dR === forward && !target) return true;
        if (dC === 0 && dR === 2 * forward && fromRow === startRow && !target) {
            const mid = fromRow + forward;
            return board[mid][fromCol] === '';
        }
        // 斜吃 / 吃过路兵
        if (aC === 1 && dR === forward) {
            if (target && target[0] !== color) return true;
            if (ep && ep.row === toRow && ep.col === toCol) return true;
        }
        return false;
    }

    // 象（elephant）：斜走两步，不卡象眼
    if (type === 'e') {
        return aR === aC && aR >= 1 && aR <= 2;
    }
    // 士（ferz）：斜走一格
    if (type === 'f') {
        return aR === 1 && aC === 1;
    }
    // 相（chancellor）：车 + 马
    if (type === 'c') {
        if ((aR === 2 && aC === 1) || (aR === 1 && aC === 2)) return true;
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }
    // 亚（amazon）：后 + 马
    if (type === 'a') {
        if ((aR === 2 && aC === 1) || (aR === 1 && aC === 2)) return true;
        if (fromRow !== toRow && fromCol !== toCol && aR !== aC) return false;
        return pathClear(board, fromRow, fromCol, toRow, toCol);
    }

    return false;
}

function needsPromotion(piece, toRow) {
    if (!piece || piece[1] !== 'p') return false;
    if (piece[0] === 'w') return toRow === 0;
    return toRow === 7;
}

function normalizePromote(promote) {
    if (!promote) return 'q';
    const t = String(promote).toLowerCase();
    return PROMOTE_TYPES.indexOf(t) >= 0 ? t : 'q';
}

/**
 * 执行走子，返回 { board, castling, enPassant, captured, wasPawnMove }
 */
function applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote) {
    const next = copyBoard(board);
    const piece = next[fromRow][fromCol];
    const castling = copyCastling((meta && meta.castling) || defaultCastling());
    const ep = meta && meta.enPassant;
    let captured = next[toRow][toCol] || '';
    let newEp = null;
    const wasPawnMove = piece && piece[1] === 'p';

    // 吃过路兵
    if (piece && piece[1] === 'p' && ep && ep.row === toRow && ep.col === toCol && !captured) {
        const capRow = piece[0] === 'w' ? toRow + 1 : toRow - 1;
        captured = next[capRow][toCol] || '';
        next[capRow][toCol] = '';
    }

    // 易位：挪车
    if (piece && piece[1] === 'k' && Math.abs(toCol - fromCol) === 2) {
        const homeRow = fromRow;
        if (toCol === 6) {
            next[homeRow][5] = next[homeRow][7];
            next[homeRow][7] = '';
        } else if (toCol === 2) {
            next[homeRow][3] = next[homeRow][0];
            next[homeRow][0] = '';
        }
    }

    next[toRow][toCol] = piece;
    next[fromRow][fromCol] = '';

    // 升变
    if (needsPromotion(piece, toRow)) {
        const t = normalizePromote(promote);
        next[toRow][toCol] = piece[0] + t;
    }

    // 更新易位权
    if (piece === 'wk') { castling.whiteK = false; castling.whiteQ = false; }
    if (piece === 'bk') { castling.blackK = false; castling.blackQ = false; }
    if (piece === 'wr' && fromRow === 7 && fromCol === 0) castling.whiteQ = false;
    if (piece === 'wr' && fromRow === 7 && fromCol === 7) castling.whiteK = false;
    if (piece === 'br' && fromRow === 0 && fromCol === 0) castling.blackQ = false;
    if (piece === 'br' && fromRow === 0 && fromCol === 7) castling.blackK = false;
    if (captured === 'wr' && toRow === 7 && toCol === 0) castling.whiteQ = false;
    if (captured === 'wr' && toRow === 7 && toCol === 7) castling.whiteK = false;
    if (captured === 'br' && toRow === 0 && toCol === 0) castling.blackQ = false;
    if (captured === 'br' && toRow === 0 && toCol === 7) castling.blackK = false;

    // 新过路兵格
    if (piece && piece[1] === 'p' && Math.abs(toRow - fromRow) === 2) {
        newEp = { row: (fromRow + toRow) / 2, col: fromCol };
    }

    return {
        board: next,
        castling,
        enPassant: newEp,
        captured,
        wasPawnMove
    };
}

function isLegalMove(board, fromRow, fromCol, toRow, toCol, side, meta, promote) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board, meta)) return false;
    if (needsPromotion(piece, toRow)) {
        const t = promote == null ? 'q' : String(promote).toLowerCase();
        if (PROMOTE_TYPES.indexOf(t) < 0) return false;
    }
    const applied = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol, meta, promote);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, side, meta) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (!isPseudoLegalMove(p, fr, fc, tr, tc, board, meta)) continue;
                    if (needsPromotion(p, tr)) {
                        for (const promo of PROMOTE_TYPES) {
                            if (isLegalMove(board, fr, fc, tr, tc, side, meta, promo)) {
                                moves.push({
                                    fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                                    promote: promo,
                                    capture: !!board[tr][tc] || !!(meta && meta.enPassant
                                        && meta.enPassant.row === tr && meta.enPassant.col === tc)
                                });
                            }
                        }
                    } else if (isLegalMove(board, fr, fc, tr, tc, side, meta, null)) {
                        moves.push({
                            fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                            promote: null,
                            capture: !!board[tr][tc] || !!(meta && meta.enPassant
                                && meta.enPassant.row === tr && meta.enPassant.col === tc)
                        });
                    }
                }
            }
        }
    }
    return moves;
}

function hasLegalMove(board, side, meta) {
    return generateLegalMoves(board, side, meta).length > 0;
}

/** K / K+B / K+N / K+B vs K+B（同色格象） */
function isInsufficientMaterial(board) {
    const pieces = [];
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p[1];
            if (t === 'k') continue;
            if (t === 'q' || t === 'w' || t === 'p') return false;
            pieces.push({ type: t, color: p[0], row: r, col: c });
        }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
        return pieces[0].type === 'n' || pieces[0].type === 'b';
    }
    if (pieces.length === 2
        && pieces[0].type === 'b' && pieces[1].type === 'b'
        && pieces[0].color !== pieces[1].color) {
        const color0 = (pieces[0].row + pieces[0].col) % 2;
        const color1 = (pieces[1].row + pieces[1].col) % 2;
        return color0 === color1;
    }
    return false;
}

function positionKey(board, sideToMove, meta) {
    let s = sideToMove === 'white' ? 'w|' : 'b|';
    const castling = (meta && meta.castling) || defaultCastling();
    s += (castling.whiteK ? 'K' : '') + (castling.whiteQ ? 'Q' : '')
        + (castling.blackK ? 'k' : '') + (castling.blackQ ? 'q' : '') + '|';
    const ep = meta && meta.enPassant;
    s += ep ? `${ep.row},${ep.col}|` : '-|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            s += board[r][c] || '.';
            s += ',';
        }
        s += ';';
    }
    return s;
}

function nextHalfmoveClock(prevClock, wasCapture, wasPawnMove) {
    if (wasCapture || wasPawnMove) return 0;
    return (prevClock || 0) + 1;
}

/** 同一局面（含行棋方、易位权、过路兵）出现 ≥3 次 → 和棋 */
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

function metaFrom(castling, enPassant) {
    return {
        castling: copyCastling(castling || defaultCastling()),
        enPassant: enPassant ? { row: enPassant.row, col: enPassant.col } : null
    };
}

return {
    BOARD_H,
    BOARD_W,
    PIECE_CHAR,
    PROMOTE_TYPES,
    emptyBoard,
    copyBoard,
    copyCastling,
    defaultCastling,
    createInitialBoard,
    createInitialMeta,
    sideColorChar,
    oppositeSide,
    sideFromSlot,
    slotFromSide,
    inBounds,
    findKing,
    isSquareAttackedBy,
    isInCheck,
    isPseudoLegalMove,
    needsPromotion,
    normalizePromote,
    applyMoveOnBoard,
    isLegalMove,
    generateLegalMoves,
    hasLegalMove,
    isInsufficientMaterial,
    positionKey,
    nextHalfmoveClock,
    judgeRepetition,
    pieceLabel,
    metaFrom
};
})();
        const SLOT_UI = {
            black: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };
        const PROMOTE_LABELS = { q: '♛', r: '♜', n: '♞', b: '♝' };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const PAD = 0.55;
        const units = R.BOARD_W + 2 * PAD;
        // 高清渲染：物理分辨率对齐 CSS 尺寸 × devicePixelRatio；绘制逻辑坐标恒为 LOGICAL_SIZE（与下拉框文字同清晰度）
        const LOGICAL_SIZE = 560;
        function applyHiDpiCanvas(redraw) {
            if (typeof QiWeiqiSquarePageRuntime === 'undefined' || !QiWeiqiSquarePageRuntime.setupHiDpiCanvas) return;
            QiWeiqiSquarePageRuntime.setupHiDpiCanvas(canvas, LOGICAL_SIZE);
            if (redraw) drawBoard();
        }
        applyHiDpiCanvas(false); // 挂载早期 ps 尚未初始化，首帧仅设置尺寸，布局完成后重绘
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            window.requestAnimationFrame(() => applyHiDpiCanvas(true));
        }
        window.addEventListener('resize', () => applyHiDpiCanvas(true));
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
        const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        const initMeta = R.createInitialMeta();
        const ps = {
            board: R.createInitialBoard(),
            castling: R.copyCastling(initMeta.castling),
            enPassant: null,
            sideToMove: 'white',
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
            checkBannerUntil: 0,
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
            tryPlaySide: 'white',
            recordResultText: null,
            waitingScoreConfirm: false,
            iRejected: false,
            showEstimateActive: false,
            pendingPromote: null
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


        // 升变选择条
        let promoBar = document.getElementById('scPromoteBar');
        if (!promoBar) {
            promoBar = document.createElement('div');
            promoBar.id = 'scPromoteBar';
            promoBar.style.cssText = 'display:none;position:absolute;z-index:40;gap:6px;padding:6px;background:rgba(40,28,16,0.92);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);';
            const wrap = canvas.parentElement || document.body;
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            wrap.appendChild(promoBar);
            R.PROMOTE_TYPES.forEach((t) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = PROMOTE_LABELS[t];
                btn.dataset.promote = t;
                btn.style.cssText = 'width:48px;height:48px;border:1px solid #555;border-radius:6px;background:#f0e6d2;color:#1a1a1a;font:28px "Segoe UI Symbol", "Apple Color Emoji", sans-serif;cursor:pointer;line-height:1;';
                btn.onclick = () => {
                    // 编辑盘面底线兵：不走子升变（逐一）
                    if (ps.pendingPawnPromote) {
                        const { row, col } = ps.pendingPawnPromote;
                        ps.pendingPawnPromote = null;
                        hidePromote();
                        if (ps.ws && ps.ws.readyState === 1) {
                            ps.ws.send(JSON.stringify({ type: 'promotePawn', row, col, promote: t }));
                        }
                        return;
                    }
                    if (!ps.pendingPromote) return;
                    const { fromRow, fromCol, toRow, toCol, tryPlay } = ps.pendingPromote;
                    hidePromote();
                    if (tryPlay) tryPlayMove(fromRow, fromCol, toRow, toCol, t);
                    else commitMove(fromRow, fromCol, toRow, toCol, t);
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                    drawBoard();
                };
                promoBar.appendChild(btn);
            });
        }

        function hidePromote() {
            ps.pendingPromote = null;
            ps.pendingPawnPromote = null;
            promoBar.style.display = 'none';
        }

        /** 编辑盘面底线兵：显示升变选择条（不走子，直接升变该兵） */
        function showPromotePawn(row, col) {
            ps.pendingPawnPromote = { row, col };
            const d = toDisplayCoord(row, col);
            const rect = canvas.getBoundingClientRect();
            const scaleX = rect.width / LOGICAL_SIZE;
            const scaleY = rect.height / LOGICAL_SIZE;
            const cx = offsetX + (d.col + 0.5) * cellSize;
            const cy = offsetY + d.row * cellSize;
            promoBar.style.display = 'flex';
            promoBar.style.left = Math.max(4, cx * scaleX - 100) + 'px';
            promoBar.style.top = Math.max(4, cy * scaleY - 56) + 'px';
        }

        function showPromote(fromRow, fromCol, toRow, toCol, tryPlay) {
            ps.pendingPromote = { fromRow, fromCol, toRow, toCol, tryPlay: !!tryPlay };
            const d = toDisplayCoord(toRow, toCol);
            const rect = canvas.getBoundingClientRect();
            const scaleX = rect.width / LOGICAL_SIZE;
            const scaleY = rect.height / LOGICAL_SIZE;
            const cx = offsetX + (d.col + 0.5) * cellSize;
            const cy = offsetY + d.row * cellSize;
            promoBar.style.display = 'flex';
            promoBar.style.left = Math.max(4, cx * scaleX - 100) + 'px';
            promoBar.style.top = Math.max(4, cy * scaleY - 56) + 'px';
        }

        function sideOfSlot(slot) { return R.sideFromSlot(slot); }
        function slotOfSide(side) { return R.slotFromSide(side); }
        function currentMeta() {
            return R.metaFrom(ps.castling, ps.enPassant);
        }

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
            const w = LOGICAL_SIZE, h = LOGICAL_SIZE;
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
            const meta = currentMeta();
            const seen = {};
            for (const m of R.generateLegalMoves(ps.board, side, meta)) {
                if (m.fromRow !== ps.selectedRow || m.fromCol !== ps.selectedCol) continue;
                const key = m.toRow + ',' + m.toCol;
                if (seen[key]) continue;
                seen[key] = true;
                ps.legalTargets.push({ row: m.toRow, col: m.toCol, needsPromote: R.needsPromotion(ps.board[ps.selectedRow][ps.selectedCol], m.toRow) });
            }
        }

        function drawBoard() {
            calcGeometry();
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);

            const light = '#f0d9b5';
            const dark = '#b58863';
            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const d = toDisplayCoord(r, c);
                    const x = offsetX + d.col * cellSize;
                    const y = offsetY + d.row * cellSize;
                    ctx2d.fillStyle = ((r + c) % 2 === 0) ? light : dark;
                    ctx2d.fillRect(x, y, cellSize, cellSize);
                }
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
                    const half = cellSize * 0.38;
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = 4;
                    ctx2d.strokeRect(x - half, y - half, half * 2, half * 2);
                } else {
                    const half = cellSize * 0.12;
                    ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.fillRect(x - half, y - half, half * 2, half * 2);
                }
            }

            for (let r = 0; r < R.BOARD_H; r++) {
                for (let c = 0; c < R.BOARD_W; c++) {
                    const piece = ps.board[r][c];
                    if (!piece) continue;
                    const d = toDisplayCoord(r, c);
                    const { x, y } = squareCenter(d.row, d.col);
                    const isWhite = piece[0] === 'w';
                    const fontSize = cellSize * 0.78 * (isWhite ? 1 : 1.05);
                    const type = piece[1];
                    // 与编辑下拉框同一字体栈（XiangqiPiece 不含国际象棋字形时回退 Segoe UI Symbol）
                    const fontStack = `"XiangqiPiece", "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    const glyph = R.pieceLabel(piece);
                    const gy = y + cellSize * 0.03;
                    const paintGlyph = (g, px, py, size) => {
                        ctx2d.font = `${size}px ${fontStack}`;
                        if (isWhite) {
                            ctx2d.lineWidth = Math.max(1.5, cellSize * 0.03);
                            ctx2d.strokeStyle = '#1a1a1a';
                            ctx2d.fillStyle = '#f7f7f7';
                            ctx2d.strokeText(g, px, py);
                            ctx2d.fillText(g, px, py);
                        } else {
                            ctx2d.fillStyle = '#1a1a1a';
                            ctx2d.fillText(g, px, py);
                        }
                    };
                    if (type === 'c' || type === 'a') {
                        // 相/亚：下层车/后靠下、上层马靠上，各 0.9×，轻微错位叠加，总高与正常棋子一致
                        paintGlyph(type === 'c' ? '♜' : '♛', x, y + cellSize * 0.06, fontSize * 0.9);
                        paintGlyph('♞', x, y - cellSize * 0.06, fontSize * 0.9);
                    } else if (type === 'e' || type === 'f') {
                        // 象/士：倒置显示（旋转 180°，偏移与古印度象棋一致）
                        ctx2d.save();
                        ctx2d.translate(x, y);
                        ctx2d.rotate(Math.PI);
                        ctx2d.font = `${fontSize}px ${fontStack}`;
                        if (isWhite) {
                            ctx2d.lineWidth = Math.max(1.5, cellSize * 0.03);
                            ctx2d.strokeStyle = '#1a1a1a';
                            ctx2d.fillStyle = '#f7f7f7';
                            ctx2d.strokeText(glyph, 0, cellSize * 0.1);
                            ctx2d.fillText(glyph, 0, cellSize * 0.1);
                        } else {
                            ctx2d.fillStyle = '#1a1a1a';
                            ctx2d.fillText(glyph, 0, cellSize * 0.1);
                        }
                        ctx2d.restore();
                    } else {
                        paintGlyph(glyph, x, gy, fontSize);
                    }
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
                else if (ps.winner === 'black') text = '⚪ 白方胜';
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
            const label = side === 'white' ? '⚪ 白方行棋' : '⚫ 黑方行棋';
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label + (ps.inCheck ? '（将军）' : '');
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            leadInfo.innerText = ps.halfmoveClock > 40 ? `未吃子/兵动 ${ps.halfmoveClock}/100` : '　';
        }

        function syncState(state) {
            if (!state) return;
            if (state.board) ps.board = R.copyBoard(state.board);
            if (state.castling) ps.castling = R.copyCastling(state.castling);
            if (state.enPassant !== undefined) ps.enPassant = state.enPassant ? { ...state.enPassant } : null;
            if (state.sideToMove) {
                ps.sideToMove = state.sideToMove;
                ps.currentPlayer = state.sideToMove === 'white' ? 1 : 2;
            } else if (state.currentPlayer) {
                ps.currentPlayer = state.currentPlayer;
                ps.sideToMove = state.currentPlayer === 1 ? 'white' : 'black';
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
                    toRow: m.toRow, toCol: m.toCol, piece: m.piece, captured: m.captured,
                    promote: m.promote || null
                }));
            }
            if (state.recordResultText) ps.recordResultText = state.recordResultText;
            if (state.showCheck) triggerCheckBanner();
            hidePromote();
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

        function snapshotFrom(board, side, castling, enPassant, lastFrom, lastTo) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                castling: R.copyCastling(castling),
                enPassant: enPassant ? { ...enPassant } : null,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null
            };
        }

        function rebuildLiveSnapshots() {
            let meta = R.createInitialMeta();
            const snaps = [snapshotFrom(R.createInitialBoard(), 'white', meta.castling, meta.enPassant, null, null)];
            let b = R.createInitialBoard();
            let side = 'white';
            for (const m of ps.moveHistory) {
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side, meta, m.promote)) break;
                const applied = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol, meta, m.promote);
                b = applied.board;
                meta = { castling: applied.castling, enPassant: applied.enPassant };
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, meta.castling, meta.enPassant,
                    { row: m.fromRow, col: m.fromCol }, { row: m.toRow, col: m.toCol }));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'white' ? 1 : 2;
            ps.castling = R.copyCastling(s.castling || R.defaultCastling());
            ps.enPassant = s.enPassant ? { ...s.enPassant } : null;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = R.isInCheck(ps.board, ps.sideToMove);
            ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
            hidePromote();
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
            let meta = R.createInitialMeta();
            const snaps = [snapshotFrom(R.createInitialBoard(), 'white', meta.castling, meta.enPassant, null, null)];
            let b = R.createInitialBoard();
            let side = 'white';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(?:=([QRNB]))?$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5], promote: mt[6] ? mt[6].toLowerCase() : null };
                }
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side, meta, m.promote)) break;
                const applied = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol, meta, m.promote);
                b = applied.board;
                meta = { castling: applied.castling, enPassant: applied.enPassant };
                const lf = { row: m.fromRow, col: m.fromCol };
                const lt = { row: m.toRow, col: m.toCol };
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side, meta.castling, meta.enPassant, lf, lt));
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
            hidePromote();
            document.getElementById('tryPlayBtn').textContent = '试下';
            if (ps.liveSnapshots.length) setLiveViewStep(ps.liveSnapshots.length - 1);
            else {
                const meta = R.createInitialMeta();
                ps.board = R.createInitialBoard();
                ps.castling = meta.castling;
                ps.enPassant = null;
                ps.sideToMove = 'white';
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
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFrom(ps.board, ps.sideToMove, ps.castling, ps.enPassant, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.castling, base.enPassant, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.sideToMove, base.castling, base.enPassant, base.lastFrom, base.lastTo)];
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
            hidePromote();
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

        function tryPlayMove(fromRow, fromCol, toRow, toCol, promote) {
            const meta = currentMeta();
            if (!R.isLegalMove(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide, meta, promote)) return false;
            const applied = R.applyMoveOnBoard(ps.board, fromRow, fromCol, toRow, toCol, meta, promote);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(applied.board, side, applied.castling, applied.enPassant,
                { row: fromRow, col: fromCol }, { row: toRow, col: toCol }));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = side;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(fromRow, fromCol, toRow, toCol, promote) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            const msg = { type: 'move', fromRow, fromCol, toRow, toCol };
            if (promote) msg.promote = promote;
            ps.ws.send(JSON.stringify(msg));
        }

        function getRowColFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = LOGICAL_SIZE / rect.width;
            const scaleY = LOGICAL_SIZE / rect.height;
            const canvasX = (clientX - rect.left) * scaleX;
            const canvasY = (clientY - rect.top) * scaleY;
            const dispCol = Math.floor((canvasX - offsetX) / cellSize);
            const dispRow = Math.floor((canvasY - offsetY) / cellSize);
            if (dispRow < 0 || dispRow >= R.BOARD_H || dispCol < 0 || dispCol >= R.BOARD_W) {
                return { row: -1, col: -1 };
            }
            return toOriginalCoord(dispRow, dispCol);
        }

        function attemptMove(fr, fc, row, col, tryPlay) {
            const piece = ps.board[fr][fc];
            if (R.needsPromotion(piece, row)) {
                showPromote(fr, fc, row, col, tryPlay);
                return;
            }
            if (tryPlay) {
                if (tryPlayMove(fr, fc, row, col, null)) {
                    ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                }
                return;
            }
            const side = ps.sideToMove;
            if (R.isLegalMove(ps.board, fr, fc, row, col, side, currentMeta(), null)) {
                commitMove(fr, fc, row, col, null);
                ps.selectedRow = -1; ps.selectedCol = -1; ps.legalTargets = [];
                drawBoard();
            }
        }

        function handleBoardClick(clientX, clientY) {
            if (ps.pendingPromote) {
                hidePromote();
                drawBoard();
            }
            // 编辑盘面底线兵逐一升变中：忽略棋盘点击，只能点升变按钮
            if (ps.pendingPawnPromote) return;
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
            attemptMove(fr, fc, row, col, ps.tryPlayMode);
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
                if (state) {
                    ps.gameStarted = (state.numberOfHands || 1) > 1 || !!state.matchStarted;
                }
                // 开局后先强制退出编辑模式，编辑中的状态同步不弹升变条
                if (editApi) editApi.updateEditModeUI();
                syncState(state);
                // 编辑盘面底线兵：逐一升变（不走子）。必须在 syncState 之后，否则会被 hidePromote 清掉
                const editing = !!(editApi && editApi.isEditModeActive && editApi.isEditModeActive());
                if (state && state.pendingPromotion && !editing && !ps.gameOver && !ps.replayMode && !ps.tryPlayMode) {
                    showPromotePawn(state.pendingPromotion.row, state.pendingPromotion.col);
                }
            },
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


        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
