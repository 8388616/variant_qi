window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["simulated-shogi"] = {
    shell: {
        "title": "模拟日本将棋",
        "rulesHtml": "基本规则同日本将棋。<br /><br />",
        "defaultKomiText": "红先",
        "boardSizeMin": 9,
        "boardSizeMax": 9,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "模拟日本将棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": false,
            "xiangqi": true,
            "dyeingBags": true,
            "shogiBags": true,
            "simulatedShogi": true,
            "hideBoardSize": true
        }
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "模拟日本将棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const BOARD_H = 9;
const BOARD_W = 9;

const PIECE_CHAR = {
    rk: '王', bk: '玉',
    rr: '飛', br: '飛', rR: '龍', bR: '龍',
    rb: '角', bb: '角', rB: '馬', bB: '馬',
    rg: '金', bg: '金',
    rs: '銀', bs: '銀', rS: '全', bS: '全',
    rn: '桂', bn: '桂', rN: '圭', bN: '圭',
    rl: '香', bl: '香', rL: '杏', bL: '杏',
    rp: '步', bp: '步', rP: '个', bP: '个'
};

const HAND_ORDER = ['r', 'b', 'g', 's', 'n', 'l', 'p'];

function emptyBoard() {
    return Array(BOARD_H).fill(null).map(() => Array(BOARD_W).fill(''));
}

function copyBoard(src) {
    return src.map((row) => row.slice());
}

function emptyHands() {
    return { red: [], black: [] };
}

function copyHands(h) {
    return { red: (h.red || []).slice(), black: (h.black || []).slice() };
}

function createInitialBoard() {
    const b = emptyBoard();
    b[0][0] = 'bl'; b[0][1] = 'bn'; b[0][2] = 'bs'; b[0][3] = 'bg'; b[0][4] = 'bk';
    b[0][5] = 'bg'; b[0][6] = 'bs'; b[0][7] = 'bn'; b[0][8] = 'bl';
    // 角在各自左手、飞在各自右手 → 双方对角
    b[1][7] = 'bb'; b[1][1] = 'br';
    for (let c = 0; c < 9; c++) b[2][c] = 'bp';
    for (let c = 0; c < 9; c++) b[6][c] = 'rp';
    b[7][1] = 'rb'; b[7][7] = 'rr';
    b[8][0] = 'rl'; b[8][1] = 'rn'; b[8][2] = 'rs'; b[8][3] = 'rg'; b[8][4] = 'rk';
    b[8][5] = 'rg'; b[8][6] = 'rs'; b[8][7] = 'rn'; b[8][8] = 'rl';
    return b;
}

function sideColorChar(side) { return side === 'red' ? 'r' : 'b'; }
function oppositeSide(side) { return side === 'red' ? 'black' : 'red'; }
function sideFromSlot(slot) { return slot === 'black' ? 'red' : 'black'; }
function slotFromSide(side) { return side === 'red' ? 'black' : 'white'; }
function inBounds(row, col) {
    return row >= 0 && row < BOARD_H && col >= 0 && col < BOARD_W;
}

function pieceType(code) { return code ? code[1] : ''; }
function pieceColor(code) { return code ? code[0] : ''; }

function isPromotedType(t) {
    return t === 'R' || t === 'B' || t === 'S' || t === 'N' || t === 'L' || t === 'P';
}

function baseType(t) {
    if (t === 'R') return 'r';
    if (t === 'B') return 'b';
    if (t === 'S') return 's';
    if (t === 'N') return 'n';
    if (t === 'L') return 'l';
    if (t === 'P') return 'p';
    return t;
}

function promoteType(t) {
    const b = baseType(t);
    if (b === 'r') return 'R';
    if (b === 'b') return 'B';
    if (b === 's') return 'S';
    if (b === 'n') return 'N';
    if (b === 'l') return 'L';
    if (b === 'p') return 'P';
    return t;
}

function canPromoteType(t) {
    const b = baseType(t);
    return b === 'r' || b === 'b' || b === 's' || b === 'n' || b === 'l' || b === 'p';
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

function inPromotionZone(side, row) {
    if (side === 'red') return row <= 2;
    return row >= 6;
}

function mustPromote(type, side, toRow) {
    const b = baseType(type);
    if (b === 'p' || b === 'l') {
        return side === 'red' ? toRow === 0 : toRow === 8;
    }
    if (b === 'n') {
        return side === 'red' ? toRow <= 1 : toRow >= 7;
    }
    return false;
}

function goldDeltas(side) {
    const f = side === 'red' ? -1 : 1;
    return [[f, 0], [f, -1], [f, 1], [0, -1], [0, 1], [-f, 0]];
}

function silverDeltas(side) {
    const f = side === 'red' ? -1 : 1;
    return [[f, 0], [f, -1], [f, 1], [-f, -1], [-f, 1]];
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

function pathClearDiag(board, fr, fc, tr, tc) {
    if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
    const dR = Math.sign(tr - fr);
    const dC = Math.sign(tc - fc);
    let r = fr + dR, c = fc + dC;
    while (r !== tr || c !== tc) {
        if (board[r][c] !== '') return false;
        r += dR; c += dC;
    }
    return true;
}

function attacksSquare(piece, fr, fc, tr, tc, board) {
    if (!piece || !inBounds(tr, tc)) return false;
    if (fr === tr && fc === tc) return false;
    const color = piece[0];
    const type = piece[1];
    const side = color === 'r' ? 'red' : 'black';
    const target = board[tr][tc];
    if (target && target[0] === color) return false;
    const dR = tr - fr, dC = tc - fc;
    const aR = Math.abs(dR), aC = Math.abs(dC);
    const forward = side === 'red' ? -1 : 1;

    if (type === 'k') return aR <= 1 && aC <= 1;
    if (type === 'g' || type === 'S' || type === 'N' || type === 'L' || type === 'P') {
        return goldDeltas(side).some(([dr, dc]) => dR === dr && dC === dc);
    }
    if (type === 's') return silverDeltas(side).some(([dr, dc]) => dR === dr && dC === dc);
    if (type === 'n') return dR === 2 * forward && aC === 1;
    if (type === 'l') {
        if (dC !== 0 || Math.sign(dR) !== forward) return false;
        return pathClearOrtho(board, fr, fc, tr, tc);
    }
    if (type === 'p') return dR === forward && dC === 0;
    if (type === 'r') return pathClearOrtho(board, fr, fc, tr, tc);
    if (type === 'b') return pathClearDiag(board, fr, fc, tr, tc);
    if (type === 'R') {
        if (aR <= 1 && aC <= 1) return true;
        return pathClearOrtho(board, fr, fc, tr, tc);
    }
    if (type === 'B') {
        if (aR <= 1 && aC <= 1) return true;
        return pathClearDiag(board, fr, fc, tr, tc);
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

function isPseudoLegalMove(piece, fr, fc, tr, tc, board) {
    return attacksSquare(piece, fr, fc, tr, tc, board);
}

function applyBoardMove(board, hands, fr, fc, tr, tc, promote) {
    const next = copyBoard(board);
    const nextHands = copyHands(hands);
    const piece = next[fr][fc];
    const side = piece[0] === 'r' ? 'red' : 'black';
    const captured = next[tr][tc];
    if (captured) {
        const bt = baseType(captured[1]);
        if (bt !== 'k') nextHands[side].push(bt);
    }
    let placed = piece;
    const t = piece[1];
    const canProm = canPromoteType(t) && !isPromotedType(t)
        && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
    if (mustPromote(t, side, tr)) {
        placed = piece[0] + promoteType(t);
    } else if (promote && canProm) {
        placed = piece[0] + promoteType(t);
    }
    next[tr][tc] = placed;
    next[fr][fc] = '';
    return { board: next, hands: nextHands, captured: captured || '', placed };
}

function hasUnpromotedPawnOnFile(board, side, col) {
    const ch = sideColorChar(side);
    for (let r = 0; r < BOARD_H; r++) {
        if (board[r][col] === ch + 'p') return true;
    }
    return false;
}

function dropDestOk(type, side, row) {
    if (type === 'p' || type === 'l') {
        return side === 'red' ? row > 0 : row < 8;
    }
    if (type === 'n') {
        return side === 'red' ? row > 1 : row < 7;
    }
    return true;
}

function isLegalDrop(board, hands, side, type, row, col, opts) {
    if (!inBounds(row, col) || board[row][col] !== '') return false;
    if (!dropDestOk(type, side, row)) return false;
    const hand = hands[side] || [];
    if (hand.indexOf(type) < 0) return false;
    if (type === 'p' && hasUnpromotedPawnOnFile(board, side, col)) return false;
    const next = copyBoard(board);
    next[row][col] = sideColorChar(side) + type;
    const nextHands = copyHands(hands);
    const idx = nextHands[side].indexOf(type);
    nextHands[side].splice(idx, 1);
    if (isInCheck(next, side)) return false;
    if (type === 'p' && !(opts && opts.skipUchifuzume)) {
        const opp = oppositeSide(side);
        if (isInCheck(next, opp) && !hasLegalMove(next, nextHands, opp, { skipUchifuzume: true })) {
            return false;
        }
    }
    return true;
}

function isLegalMove(board, hands, fr, fc, tr, tc, side, promote) {
    const piece = board[fr] && board[fr][fc];
    if (!piece || piece[0] !== sideColorChar(side)) return false;
    if (!isPseudoLegalMove(piece, fr, fc, tr, tc, board)) return false;
    const t = piece[1];
    const canProm = canPromoteType(t) && !isPromotedType(t)
        && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
    const must = mustPromote(t, side, tr);
    if (must && promote === false) return false;
    if (promote && !canProm && !must) return false;
    const applied = applyBoardMove(board, hands, fr, fc, tr, tc, !!promote || must);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, hands, side, opts) {
    const moves = [];
    const ch = sideColorChar(side);
    for (let fr = 0; fr < BOARD_H; fr++) {
        for (let fc = 0; fc < BOARD_W; fc++) {
            const p = board[fr][fc];
            if (!p || p[0] !== ch) continue;
            for (let tr = 0; tr < BOARD_H; tr++) {
                for (let tc = 0; tc < BOARD_W; tc++) {
                    if (!isPseudoLegalMove(p, fr, fc, tr, tc, board)) continue;
                    const t = p[1];
                    const canProm = canPromoteType(t) && !isPromotedType(t)
                        && (inPromotionZone(side, fr) || inPromotionZone(side, tr));
                    const must = mustPromote(t, side, tr);
                    if (must) {
                        if (isLegalMove(board, hands, fr, fc, tr, tc, side, true)) {
                            moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: true });
                        }
                    } else {
                        if (isLegalMove(board, hands, fr, fc, tr, tc, side, false)) {
                            moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: false });
                        }
                        if (canProm && isLegalMove(board, hands, fr, fc, tr, tc, side, true)) {
                            moves.push({ kind: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promote: true });
                        }
                    }
                }
            }
        }
    }
    const seenDrop = {};
    for (const type of hands[side] || []) {
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const key = type + ':' + r + ',' + c;
                if (seenDrop[key]) continue;
                if (isLegalDrop(board, hands, side, type, r, c, opts)) {
                    seenDrop[key] = true;
                    moves.push({ kind: 'drop', pieceType: type, toRow: r, toCol: c });
                }
            }
        }
    }
    return moves;
}

function hasLegalMove(board, hands, side, opts) {
    return generateLegalMoves(board, hands, side, opts).length > 0;
}

function applyDrop(board, hands, side, type, row, col) {
    const next = copyBoard(board);
    const nextHands = copyHands(hands);
    const idx = nextHands[side].indexOf(type);
    if (idx < 0) return null;
    nextHands[side].splice(idx, 1);
    next[row][col] = sideColorChar(side) + type;
    return { board: next, hands: nextHands };
}

function positionKey(board, hands, sideToMove) {
    let s = sideToMove === 'red' ? 'r|' : 'b|';
    for (let r = 0; r < BOARD_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
            s += board[r][c] || '.';
            s += ',';
        }
        s += ';';
    }
    s += 'H:' + (hands.red || []).slice().sort().join('') + '/' + (hands.black || []).slice().sort().join('');
    return s;
}

function judgeRepetition(historyKeys) {
    if (!historyKeys || historyKeys.length < 4) return null;
    const cur = historyKeys[historyKeys.length - 1];
    let count = 0;
    for (let i = 0; i < historyKeys.length; i++) {
        if (historyKeys[i] === cur) count++;
    }
    if (count >= 4) return { result: 'draw', reason: 'sennichite' };
    return null;
}

function sortedHand(hand) {
    const arr = (hand || []).slice();
    arr.sort((a, b) => HAND_ORDER.indexOf(a) - HAND_ORDER.indexOf(b));
    return arr;
}

function pieceLabel(code) {
    return PIECE_CHAR[code] || '?';
}

function handPieceLabel(type) {
    return PIECE_CHAR['r' + type] || PIECE_CHAR['r' + promoteType(type)] || type;
}

function moveCanOfferPromote(board, fr, fc, tr, tc, side) {
    const piece = board[fr][fc];
    if (!piece) return false;
    const t = piece[1];
    if (!canPromoteType(t) || isPromotedType(t)) return false;
    if (mustPromote(t, side, tr)) return false;
    return inPromotionZone(side, fr) || inPromotionZone(side, tr);
}

return {
    BOARD_H, BOARD_W, PIECE_CHAR, HAND_ORDER,
    emptyBoard, copyBoard, emptyHands, copyHands, createInitialBoard,
    sideColorChar, oppositeSide, sideFromSlot, slotFromSide, inBounds,
    pieceType, baseType, promoteType, canPromoteType, isPromotedType, mustPromote,
    findKing, isInCheck, isPseudoLegalMove, isLegalMove, isLegalDrop,
    applyBoardMove, applyDrop, generateLegalMoves, hasLegalMove,
    positionKey, judgeRepetition, sortedHand, pieceLabel, handPieceLabel,
    moveCanOfferPromote, inPromotionZone
};
})();

        const SLOT_UI = {
            black: { name: '红方', emoji: '🔴', continueText: '继续执红', choiceText: '执红', youText: '您执红', absentText: '红方已退出', statusText: '红方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        const PAD = 0.5;
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
            hands: R.emptyHands(),
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
            selectedDropType: null,
            legalTargets: [],
            hoverRow: -1,
            hoverCol: -1,
            inCheck: false,
            checkBannerUntil: 0,
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


        let promoBar = document.getElementById('scPromoteBar');
        if (!promoBar) {
            promoBar = document.createElement('div');
            promoBar.id = 'scPromoteBar';
            promoBar.style.cssText = 'display:none;position:absolute;z-index:40;gap:6px;padding:6px;background:rgba(40,28,16,0.92);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);';
            const wrap = canvas.parentElement || document.body;
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            wrap.appendChild(promoBar);
            [
                { label: '升变', promote: true },
                { label: '不升变', promote: false }
            ].forEach(({ label, promote }) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = label;
                btn.dataset.promote = promote ? '1' : '0';
                btn.style.cssText = 'min-width:52px;height:36px;border:none;border-radius:6px;background:#e8d2a0;color:#932c13;font:14px "Segoe UI",sans-serif;cursor:pointer;line-height:1;padding:0 8px;';
                btn.onclick = () => {
                    if (!ps.pendingPromote) return;
                    const { fromRow, fromCol, toRow, toCol, tryPlay } = ps.pendingPromote;
                    hidePromote();
                    if (tryPlay) tryPlayMove(fromRow, fromCol, toRow, toCol, promote);
                    else commitMove(fromRow, fromCol, toRow, toCol, promote);
                    clearSelection();
                    drawBoard();
                };
                promoBar.appendChild(btn);
            });
        }

        function hidePromote() {
            ps.pendingPromote = null;
            promoBar.style.display = 'none';
        }

        function showPromote(fromRow, fromCol, toRow, toCol, tryPlay) {
            ps.pendingPromote = { fromRow, fromCol, toRow, toCol, tryPlay: !!tryPlay };
            const d = toDisplayCoord(toRow, toCol);
            const rect = canvas.getBoundingClientRect();
            const scaleX = rect.width / canvas.width;
            const scaleY = rect.height / canvas.height;
            const cx = offsetX + (d.col + 0.5) * cellSize;
            const cy = offsetY + (d.row + 0.5) * cellSize;
            promoBar.style.display = 'flex';
            promoBar.style.left = Math.max(4, cx * scaleX - 60) + 'px';
            promoBar.style.top = Math.max(4, cy * scaleY - 48) + 'px';
        }

        function sideOfSlot(slot) { return R.sideFromSlot(slot); }
        function slotOfSide(side) { return R.slotFromSide(side); }
        function handColor(side) { return side === 'red' ? '#932c13' : '#222'; }

        function clearSelection() {
            ps.selectedRow = -1;
            ps.selectedCol = -1;
            ps.selectedDropType = null;
            ps.legalTargets = [];
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
                ? ['1', '2', '3', '4', '5', '6', '7', '8', '9']
                : ['9', '8', '7', '6', '5', '4', '3', '2', '1'];
            const ranks = boardFlipped()
                ? ['九', '八', '七', '六', '五', '四', '三', '二', '一']
                : ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
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
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            if (ps.selectedDropType) {
                for (const m of R.generateLegalMoves(ps.board, ps.hands, side)) {
                    if (m.kind === 'drop' && m.pieceType === ps.selectedDropType) {
                        ps.legalTargets.push({ row: m.toRow, col: m.toCol });
                    }
                }
                return;
            }
            if (ps.selectedRow < 0) return;
            const seen = {};
            for (const m of R.generateLegalMoves(ps.board, ps.hands, side)) {
                if (m.kind !== 'move') continue;
                if (m.fromRow !== ps.selectedRow || m.fromCol !== ps.selectedCol) continue;
                const key = m.toRow + ',' + m.toCol;
                if (seen[key]) continue;
                seen[key] = true;
                ps.legalTargets.push({ row: m.toRow, col: m.toCol });
            }
        }

        function renderBags() {
            const redRow = document.getElementById('dyeingRedBagRow');
            const greenRow = document.getElementById('dyeingGreenBagRow');
            if (!redRow || !greenRow) return;
            redRow.innerHTML = '';
            greenRow.innerHTML = '';

            function fill(rowEl, hand, owner) {
                const sorted = R.sortedHand(hand || []);
                const color = handColor(owner);
                const side = owner;
                const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
                const canSelect = (ps.tryPlayMode || (ps.isMyTurn && matchStarted)) && !ps.gameOver && !ps.replayMode;
                const mySide = ps.tryPlayMode ? ps.tryPlaySide : (ps.mySlot ? sideOfSlot(ps.mySlot) : null);
                const isMyHand = canSelect && mySide === side;

                const cells = sorted.slice();
                while (cells.length < 16) cells.push(null);

                for (let i = 0; i < cells.length; i++) {
                    const type = cells[i];
                    if (!type) {
                        const empty = document.createElement('div');
                        empty.className = 'dyeing-bag-piece';
                        empty.style.visibility = 'hidden';
                        rowEl.appendChild(empty);
                        continue;
                    }
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'dyeing-bag-piece';
                    btn.style.color = color;
                    btn.textContent = R.handPieceLabel(type);
                    if (isMyHand && ps.selectedDropType === type) btn.classList.add('active');
                    if (isMyHand) {
                        btn.onclick = () => {
                            if (ps.selectedDropType === type) {
                                ps.selectedDropType = null;
                            } else {
                                ps.selectedDropType = type;
                                ps.selectedRow = -1;
                                ps.selectedCol = -1;
                            }
                            hidePromote();
                            refreshLegalTargets();
                            drawBoard();
                            renderBags();
                        };
                    }
                    rowEl.appendChild(btn);
                }
            }
            fill(redRow, ps.hands.red, 'red');
            fill(greenRow, ps.hands.black, 'black');
        }

        function drawBoard() {
            calcGeometry();
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);

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
            } else if (ps.lastTo) {
                const d = toDisplayCoord(ps.lastTo.row, ps.lastTo.col);
                ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                ctx2d.fillRect(offsetX + d.col * cellSize, offsetY + d.row * cellSize, cellSize, cellSize);
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
            turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label + (ps.inCheck ? '（王手）' : '');
            scoreTitle.innerText = '　';
            scoreBoard.innerText = `第 ${Math.floor(ps.moveHistory.length / 2) + 1} 回合`;
            leadInfo.innerText = '　';
        }

        function normalizeMoveEntry(m) {
            if (m.kind === 'drop' || m.type === 'drop') {
                return { kind: 'drop', pieceType: m.pieceType, toRow: m.toRow, toCol: m.toCol, player: m.player };
            }
            return {
                kind: 'move',
                fromRow: m.fromRow, fromCol: m.fromCol, toRow: m.toRow, toCol: m.toCol,
                promote: !!m.promote, player: m.player
            };
        }

        function applyHistoryStep(b, hands, side, m) {
            if (m.kind === 'drop') {
                if (!R.isLegalDrop(b, hands, side, m.pieceType, m.toRow, m.toCol)) return null;
                const applied = R.applyDrop(b, hands, side, m.pieceType, m.toRow, m.toCol);
                if (!applied) return null;
                return {
                    board: applied.board,
                    hands: applied.hands,
                    side: R.oppositeSide(side),
                    lastFrom: null,
                    lastTo: { row: m.toRow, col: m.toCol }
                };
            }
            if (!R.isLegalMove(b, hands, m.fromRow, m.fromCol, m.toRow, m.toCol, side, m.promote)) return null;
            const applied = R.applyBoardMove(b, hands, m.fromRow, m.fromCol, m.toRow, m.toCol, m.promote);
            return {
                board: applied.board,
                hands: applied.hands,
                side: R.oppositeSide(side),
                lastFrom: { row: m.fromRow, col: m.fromCol },
                lastTo: { row: m.toRow, col: m.toCol }
            };
        }

        function syncState(state) {
            if (!state) return;
            if (state.board) ps.board = R.copyBoard(state.board);
            if (state.hands) ps.hands = R.copyHands(state.hands);
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
            if (state.slots) ps.slots = state.slots;
            if (state.matchStarted != null) ps.matchStarted = !!state.matchStarted;
            if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
            if (state.moveHistory) {
                ps.moveHistory = state.moveHistory.map(normalizeMoveEntry);
            } else if (state.moveCoords) {
                ps.moveHistory = state.moveCoords.map(normalizeMoveEntry);
            }
            if (state.recordResultText) ps.recordResultText = state.recordResultText;
            if (state.showCheck) triggerCheckBanner();
            hidePromote();
            rebuildLiveSnapshots();
            if (!ps.replayMode && !ps.tryPlayMode && ps.liveFollowLatest) {
                ps.liveViewStep = Math.max(0, ps.liveSnapshots.length - 1);
            }
            clearSelection();
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

        function snapshotFrom(board, hands, side, lastFrom, lastTo) {
            return {
                board: R.copyBoard(board),
                hands: R.copyHands(hands),
                sideToMove: side,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFrom(R.createInitialBoard(), R.emptyHands(), 'red', null, null)];
            let b = R.createInitialBoard();
            let hands = R.emptyHands();
            let side = 'red';
            for (const raw of ps.moveHistory) {
                const m = normalizeMoveEntry(raw);
                const step = applyHistoryStep(b, hands, side, m);
                if (!step) break;
                b = step.board;
                hands = step.hands;
                side = step.side;
                snaps.push(snapshotFrom(b, hands, side, step.lastFrom, step.lastTo));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.hands = R.copyHands(s.hands || R.emptyHands());
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'red' ? 1 : 2;
            ps.lastFrom = s.lastFrom;
            ps.lastTo = s.lastTo;
            ps.inCheck = R.isInCheck(ps.board, ps.sideToMove);
            clearSelection();
            hidePromote();
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
            a.download = `${recordDownloadPrefix}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function parseReplayMove(raw) {
            if (typeof raw !== 'string') return normalizeMoveEntry(raw);
            const drop = raw.match(/^([BW])D([rbgslnp])(\d+),(\d+)$/i);
            if (drop) {
                return { kind: 'drop', pieceType: drop[2].toLowerCase(), toRow: +drop[3], toCol: +drop[4] };
            }
            const mov = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(\+)?$/i);
            if (mov) {
                return {
                    kind: 'move',
                    fromRow: +mov[2], fromCol: +mov[3], toRow: +mov[4], toCol: +mov[5],
                    promote: !!mov[6]
                };
            }
            return null;
        }

        function enterReplayMode(data) {
            const moves = data.moves || [];
            const snaps = [snapshotFrom(R.createInitialBoard(), R.emptyHands(), 'red', null, null)];
            let b = R.createInitialBoard();
            let hands = R.emptyHands();
            let side = 'red';
            for (const raw of moves) {
                const m = parseReplayMove(raw);
                if (!m) break;
                const step = applyHistoryStep(b, hands, side, m);
                if (!step) break;
                b = step.board;
                hands = step.hands;
                side = step.side;
                snaps.push(snapshotFrom(b, hands, side, step.lastFrom, step.lastTo));
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
                ps.board = R.createInitialBoard();
                ps.hands = R.emptyHands();
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
                const base = ps.liveSnapshots[ps.liveViewStep] || snapshotFrom(ps.board, ps.hands, ps.sideToMove, ps.lastFrom, ps.lastTo);
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.hands, base.sideToMove, base.lastFrom, base.lastTo)];
            } else {
                ps.tryPlayBaseStep = ps.replayStep;
                const base = ps.replaySnapshots[ps.replayStep];
                ps.tryPlaySnapshots = [snapshotFrom(base.board, base.hands, base.sideToMove, base.lastFrom, base.lastTo)];
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
            const side = ps.tryPlaySide;
            if (!R.isLegalMove(ps.board, ps.hands, fromRow, fromCol, toRow, toCol, side, promote)) return false;
            const applied = R.applyBoardMove(ps.board, ps.hands, fromRow, fromCol, toRow, toCol, promote);
            const nextSide = R.oppositeSide(side);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(
                applied.board, applied.hands, nextSide,
                { row: fromRow, col: fromCol }, { row: toRow, col: toCol }
            ));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = nextSide;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function tryPlayDrop(pieceType, toRow, toCol) {
            const side = ps.tryPlaySide;
            const t = String(pieceType || '').toLowerCase();
            if (!R.isLegalDrop(ps.board, ps.hands, side, t, toRow, toCol)) return false;
            const applied = R.applyDrop(ps.board, ps.hands, side, t, toRow, toCol);
            if (!applied) return false;
            const nextSide = R.oppositeSide(side);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(
                applied.board, applied.hands, nextSide,
                null, { row: toRow, col: toCol }
            ));
            ps.tryPlayTotalSteps = ps.tryPlaySnapshots.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlaySide = nextSide;
            applySnapshot(ps.tryPlaySnapshots[ps.tryPlayStep]);
            updateReplayUI();
            return true;
        }

        function commitMove(fromRow, fromCol, toRow, toCol, promote) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            const msg = { type: 'move', fromRow, fromCol, toRow, toCol };
            if (promote) msg.promote = true;
            ps.ws.send(JSON.stringify(msg));
        }

        function commitDrop(pieceType, toRow, toCol) {
            if (!ps.ws || ps.ws.readyState !== 1) return;
            ps.ws.send(JSON.stringify({ type: 'drop', pieceType, toRow, toCol }));
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

        function attemptMove(fr, fc, row, col, tryPlay) {
            const side = tryPlay ? ps.tryPlaySide : ps.sideToMove;
            const piece = ps.board[fr][fc];
            const t = piece[1];
            if (R.mustPromote(t, side, row)) {
                if (tryPlay) tryPlayMove(fr, fc, row, col, true);
                else commitMove(fr, fc, row, col, true);
                clearSelection();
                return;
            }
            if (R.moveCanOfferPromote(ps.board, fr, fc, row, col, side)) {
                showPromote(fr, fc, row, col, tryPlay);
                return;
            }
            if (tryPlay) tryPlayMove(fr, fc, row, col, false);
            else commitMove(fr, fc, row, col, false);
            clearSelection();
        }

        function attemptDrop(pieceType, row, col, tryPlay) {
            if (tryPlay) tryPlayDrop(pieceType, row, col);
            else commitDrop(pieceType, row, col);
            clearSelection();
        }

        function handleBoardClick(clientX, clientY) {
            if (ps.pendingPromote) {
                hidePromote();
                drawBoard();
            }
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { row, col } = getRowColFromClient(clientX, clientY);
            if (row < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const ch = R.sideColorChar(side);

            if (ps.selectedDropType) {
                if (ps.board[row][col] !== '') return;
                const hit = ps.legalTargets.some((t) => t.row === row && t.col === col);
                if (!hit) return;
                attemptDrop(ps.selectedDropType, row, col, ps.tryPlayMode);
                drawBoard();
                renderBags();
                return;
            }

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
                clearSelection();
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
            drawBoard();
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
        renderBags();
        updateMatchControlButtons();
        })();
    }
};
