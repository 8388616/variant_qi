/**
 * 象棋规则（皮卡鱼向：行棋、将死/困毙、子力不足、自然限着、循环局面简判）。
 * Node / 浏览器共用（UMD）。
 *
 * 棋盘 10×9；空串 ""；棋子两字符：颜色 r|b + 类型 k|a|e|n|r|c|p
 * 座位协议：black=红方(先手)，white=黑方(后手)
 */
(function (root, factory) {
    const api = factory();
    // Node：勿用 module.exports 真值判断（个别环境会踩空）
    if (typeof module === 'object' && module !== null) {
        module.exports = api;
    }
    if (root) root.QiXiangqiRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const BOARD_H = 10;
    const BOARD_W = 9;

    const PIECE_CHAR = {
        rk: '帥', ra: '仕', re: '相', rn: '傌', rr: '俥', rc: '炮', rp: '兵',
        bk: '將', ba: '士', be: '象', bn: '馬', br: '車', bc: '砲', bp: '卒'
    };

    function emptyBoard() {
        return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
    }

    function copyBoard(src) {
        return src.map((row) => row.slice());
    }

    function createInitialBoard() {
        const b = emptyBoard();
        b[0][0] = 'br'; b[0][8] = 'br';
        b[0][1] = 'bn'; b[0][7] = 'bn';
        b[0][2] = 'be'; b[0][6] = 'be';
        b[0][3] = 'ba'; b[0][5] = 'ba';
        b[0][4] = 'bk';
        b[2][1] = 'bc'; b[2][7] = 'bc';
        for (let i = 0; i < 5; i++) b[3][2 * i] = 'bp';

        b[9][0] = 'rr'; b[9][8] = 'rr';
        b[9][1] = 'rn'; b[9][7] = 'rn';
        b[9][2] = 're'; b[9][6] = 're';
        b[9][3] = 'ra'; b[9][5] = 'ra';
        b[9][4] = 'rk';
        b[7][1] = 'rc'; b[7][7] = 'rc';
        for (let i = 0; i < 5; i++) b[6][2 * i] = 'rp';
        return b;
    }

    function sideColorChar(side) {
        return side === 'red' ? 'r' : 'b';
    }

    function oppositeSide(side) {
        return side === 'red' ? 'black' : 'red';
    }

    /** 协议座位 ↔ 行棋方 */
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

    function findKing(board, side) {
        const code = side === 'red' ? 'rk' : 'bk';
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                if (board[r][c] === code) return { row: r, col: c };
            }
        }
        return null;
    }

    function kingsFaceEachOther(board) {
        const rk = findKing(board, 'red');
        const bk = findKing(board, 'black');
        if (!rk || !bk || rk.col !== bk.col) return false;
        const minR = Math.min(rk.row, bk.row);
        const maxR = Math.max(rk.row, bk.row);
        for (let r = minR + 1; r < maxR; r++) {
            if (board[r][rk.col] !== '') return false;
        }
        return true;
    }

    /** 几何走法（不含将军/应将/对脸） */
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

        if (type === 'k') {
            if (aR + aC !== 1) return false;
            return inPalace(side, toRow, toCol);
        }
        if (type === 'a') {
            if (!(aR === 1 && aC === 1)) return false;
            return inPalace(side, toRow, toCol);
        }
        if (type === 'e') {
            if (!(aR === 2 && aC === 2)) return false;
            const midR = fromRow + dR / 2;
            const midC = fromCol + dC / 2;
            if (board[midR][midC] !== '') return false;
            if (side === 'red') return toRow >= 5;
            return toRow <= 4;
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
            if (fromRow !== toRow && fromCol !== toCol) return false;
            if (fromRow === toRow) {
                const step = toCol > fromCol ? 1 : -1;
                for (let c = fromCol + step; c !== toCol; c += step) {
                    if (board[fromRow][c] !== '') return false;
                }
                return true;
            }
            const step = toRow > fromRow ? 1 : -1;
            for (let r = fromRow + step; r !== toRow; r += step) {
                if (board[r][fromCol] !== '') return false;
            }
            return true;
        }
        if (type === 'c') {
            if (fromRow !== toRow && fromCol !== toCol) return false;
            let cnt = 0;
            if (fromRow === toRow) {
                const step = toCol > fromCol ? 1 : -1;
                for (let c = fromCol + step; c !== toCol; c += step) {
                    if (board[fromRow][c] !== '') cnt++;
                }
            } else {
                const step = toRow > fromRow ? 1 : -1;
                for (let r = fromRow + step; r !== toRow; r += step) {
                    if (board[r][fromCol] !== '') cnt++;
                }
            }
            if (!target) return cnt === 0;
            return cnt === 1;
        }
        if (type === 'p') {
            const forward = side === 'red' ? -1 : 1;
            const crossed = side === 'red' ? fromRow <= 4 : fromRow >= 5;
            if (dR === forward && dC === 0) return true;
            if (crossed && aR === 0 && aC === 1) return true;
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

    function isSquareAttackedBy(board, row, col, bySide) {
        const ch = sideColorChar(bySide);
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const p = board[r][c];
                if (!p || p[0] !== ch) continue;
                if (isPseudoLegalMove(p, r, c, row, col, board)) return true;
            }
        }
        return false;
    }

    function isInCheck(board, side) {
        const king = findKing(board, side);
        if (!king) return true;
        if (kingsFaceEachOther(board)) return true;
        return isSquareAttackedBy(board, king.row, king.col, oppositeSide(side));
    }

    function isLegalMove(board, fromRow, fromCol, toRow, toCol, side) {
        const piece = board[fromRow] && board[fromRow][fromCol];
        if (!piece || piece[0] !== sideColorChar(side)) return false;
        if (!isPseudoLegalMove(piece, fromRow, fromCol, toRow, toCol, board)) return false;
        const next = applyMoveOnBoard(board, fromRow, fromCol, toRow, toCol);
        if (kingsFaceEachOther(next)) return false;
        if (isInCheck(next, side)) return false;
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

    /** 仅将/士/象（相）——无车马炮兵 */
    function isInsufficientMaterial(board) {
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const p = board[r][c];
                if (!p) continue;
                const t = p[1];
                if (t === 'r' || t === 'n' || t === 'c' || t === 'p') return false;
            }
        }
        return true;
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

    /**
     * 自然限着状态。
     * 超过十次的将军不计入；该将军导致的对手应将也不计入（skipNext）。
     */
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

    /**
     * 循环局面：同一局面（含行棋方）出现 ≥3 次。
     * 循环内一方每步均为将军 → 该方长将判负；双方同级 → 和棋。
     */
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
        sideColorChar,
        oppositeSide,
        sideFromSlot,
        slotFromSide,
        inBounds,
        findKing,
        kingsFaceEachOther,
        isPseudoLegalMove,
        applyMoveOnBoard,
        isInCheck,
        isLegalMove,
        generateLegalMoves,
        hasLegalMove,
        isInsufficientMaterial,
        positionKey,
        nextHalfmoveState,
        judgeRepetition,
        pieceLabel
    };
});
