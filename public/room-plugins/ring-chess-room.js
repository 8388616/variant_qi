window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["ring-chess"] = {
    shell: {
        "title": "环国际象棋",
        "rulesHtml": "基本规则类似国际象棋。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 4,
        "boardSizeMax": 4,
        "defaultBoardSize": 4,
        "minLib": 1,
        "recordDownloadPrefix": "环国际象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "editBoard": true,
            "xiangqi": true,
            "chess": true,
            "hideBoardSize": true
        },
        // 顺序：后车马象兵王。白棋用空心字形♙♘♗♖♕♔（与最初黑棋相同的字形和颜色 #222），黑棋用实心字形♛♜♞♝♟♚
        "editTools": [
            { "value": "empty", "label": "空", "cellValue": "" },
            { "value": "wq", "label": "♕", "cellValue": "wq", "color": "#222" },
            { "value": "wr", "label": "♖", "cellValue": "wr", "color": "#222" },
            { "value": "wn", "label": "♘", "cellValue": "wn", "color": "#222" },
            { "value": "wb", "label": "♗", "cellValue": "wb", "color": "#222" },
            { "value": "wp", "label": "♙", "cellValue": "wp", "color": "#222" },
            { "value": "wk", "label": "♔", "cellValue": "wk", "color": "#222" },
            { "value": "bq", "label": "♛", "cellValue": "bq", "color": "#222" },
            { "value": "br", "label": "♜", "cellValue": "br", "color": "#222" },
            { "value": "bn", "label": "♞", "cellValue": "bn", "color": "#222" },
            { "value": "bb", "label": "♝", "cellValue": "bb", "color": "#222" },
            { "value": "bp", "label": "♟", "cellValue": "bp", "color": "#222" },
            { "value": "bk", "label": "♚", "cellValue": "bk", "color": "#222" }
        ],
        "editToolGlyphSize": 26
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "环国际象棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
        const R = (function () {
'use strict';

const RINGS = 4;
const SECTORS = 16;

const PIECE_CHAR = {
    wk: '♚', wq: '♛', wr: '♜', wn: '♞', wb: '♝', wp: '♟',
    bk: '♚', bq: '♛', br: '♜', bn: '♞', bb: '♝', bp: '♟'
};

const PROMOTE_TYPES = ['q', 'r', 'n', 'b'];

const key = (ring, sector) => ring + ',' + sector;

function pawnDir(side, sector) {
    if (side === 'white') return sector === 6 ? -1 : (sector === 9 ? 1 : 0);
    return sector === 14 ? -1 : (sector === 1 ? 1 : 0);
}

function setup() {
    const WHITE_LAYOUT = [
        ['wp', 'wq', 'wk', 'wp'],
        ['wp', 'wb', 'wb', 'wp'],
        ['wp', 'wn', 'wn', 'wp'],
        ['wp', 'wr', 'wr', 'wp']
    ];
    const board = {};
    for (let r = 0; r < RINGS; r++) {
        for (let k = 0; k < 4; k++) {
            const w = WHITE_LAYOUT[r][k];
            board[key(r, 6 + k)] = w;
            board[key(r, (6 + k + 8) % 16)] = 'b' + w.slice(1);
        }
        for (const s of [6, 9, 14, 1]) {
            const k = key(r, s);
            const pc = board[k];
            board[k] = { 0: pc[0], 1: pc[1], dir: pawnDir(pc[0] === 'w' ? 'white' : 'black', s), steps: 0 };
        }
    }
    return board;
}

/** 编辑清空：flat 64 数组（ring-major） */
function emptyBoard() {
    return Array(RINGS * SECTORS).fill('');
}

function copyBoard(src) {
    return JSON.parse(JSON.stringify(src));
}

function pieceSide(pc) { return pc[0] === 'w' ? 'white' : 'black'; }
function oppositeSide(side) { return side === 'white' ? 'black' : 'white'; }
function sideFromSlot(slot) { return slot === 'black' ? 'white' : 'black'; }
function slotFromSide(side) { return side === 'white' ? 'black' : 'white'; }
function sideColorChar(side) { return side[0]; }
function normalizePromote(p) {
    p = String(p || '').toLowerCase();
    return PROMOTE_TYPES.indexOf(p) >= 0 ? p : 'q';
}
function inBounds(ring) { return ring >= 0 && ring < RINGS; }

/** 兵升级：累计走满 6 步（首步 2 步算 2 步）。走子前判断本次走子是否触发升变 */
function needsPromotion(piece, fromSector, toSector) {
    if (!piece || piece[1] !== 'p') return false;
    let dS = toSector - fromSector;
    if (dS > 8) dS -= 16;
    if (dS < -8) dS += 16;
    return (piece.steps || 0) + (Math.abs(dS) === 2 ? 2 : 1) >= 6;
}

/**
 * 直线延伸：径向（内外）、环向（沿环）、斜向（径向+环向各一步）。
 * noLoop：环向直线不允许绕一整圈回到原点（车/后）。
 */
function lineTargets(board, ring, sector, dirs, side, noLoop) {
    const out = [];
    const ch = side[0];
    for (const [dR, dS] of dirs) {
        let r = ring + dR;
        let s = (sector + dS + SECTORS) % SECTORS;
        let steps = 0;
        while (inBounds(r) && (!noLoop || !(steps > 0 && s === sector))) {
            const pc = board[key(r, s)];
            if (pc) {
                if (pc[0] !== ch) out.push({ ring: r, sector: s });
                break;
            }
            out.push({ ring: r, sector: s });
            r += dR;
            s = (s + dS + SECTORS) % SECTORS;
            steps++;
        }
    }
    return out;
}

function attacksSquare(pc, fromRing, fromSector, toRing, toSector, board) {
    if (!pc || !inBounds(toRing)) return false;
    if (fromRing === toRing && fromSector === toSector) return false;
    const type = pc[1];
    const dR = toRing - fromRing;
    let dS = toSector - fromSector;
    if (dS > 8) dS -= 16;
    if (dS < -8) dS += 16;
    const aR = Math.abs(dR), aS = Math.abs(dS);
    if (type === 'k') return aR <= 1 && aS <= 1 && (aR + aS) > 0;
    if (type === 'n') return (aR === 2 && aS === 1) || (aR === 1 && aS === 2);
    if (type === 'p') {
        const dir = pc.dir || 0;
        return aR === 1 && dS === dir;
    }
    if (type === 'r') {
        if (dR !== 0 && dS !== 0) return false;
        const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
        const d = lineTargets(board, fromRing, fromSector, dirs, pieceSide(pc), dS !== 0);
        return d.some(t => t.ring === toRing && t.sector === toSector);
    }
    if (type === 'b') {
        if (aR !== aS) return false;
        const d = lineTargets(board, fromRing, fromSector, [[dR > 0 ? 1 : -1, dS > 0 ? 1 : -1]], pieceSide(pc), false);
        return d.some(t => t.ring === toRing && t.sector === toSector);
    }
    if (type === 'q') {
        if (dR !== 0 && dS !== 0 && aR !== aS) return false;
        const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
        const d = lineTargets(board, fromRing, fromSector, dirs, pieceSide(pc), dS !== 0 && dR === 0);
        return d.some(t => t.ring === toRing && t.sector === toSector);
    }
    return false;
}

function isSquareAttackedBy(board, ring, sector, bySide) {
    const ch = bySide[0];
    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < SECTORS; s++) {
            const pc = board[key(r, s)];
            if (!pc || pc[0] !== ch) continue;
            if (attacksSquare(pc, r, s, ring, sector, board)) return true;
        }
    }
    return false;
}

function findKing(board, side) {
    const code = side[0] + 'k';
    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < SECTORS; s++) {
            const pc = board[key(r, s)];
            if (pc && pc[0] + pc[1] === code) return { ring: r, sector: s };
        }
    }
    return null;
}

function isInCheck(board, side) {
    const king = findKing(board, side);
    if (!king) return true;
    return isSquareAttackedBy(board, king.ring, king.sector, oppositeSide(side));
}

/** 几何走法（不含将军应将） */
function isPseudoLegalMove(pc, fromRing, fromSector, toRing, toSector, board) {
    if (!pc || !inBounds(toRing)) return false;
    if (fromRing === toRing && fromSector === toSector) return false;
    const type = pc[1];
    const color = pc[0];
    const target = board[key(toRing, toSector)];
    if (target && target[0] === color) return false;
    let dS = toSector - fromSector;
    if (dS > 8) dS -= 16;
    if (dS < -8) dS += 16;
    const dR = toRing - fromRing;
    const aR = Math.abs(dR), aS = Math.abs(dS);
    const side = color === 'w' ? 'white' : 'black';

    if (type === 'n') return (aR === 2 && aS === 1) || (aR === 1 && aS === 2);
    if (type === 'b') {
        if (aR !== aS) return false;
        return lineTargets(board, fromRing, fromSector, [[dR > 0 ? 1 : -1, dS > 0 ? 1 : -1]], side, false)
            .some(t => t.ring === toRing && t.sector === toSector);
    }
    if (type === 'r') {
        if (dR !== 0 && dS !== 0) return false;
        const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
        return lineTargets(board, fromRing, fromSector, dirs, side, dS !== 0)
            .some(t => t.ring === toRing && t.sector === toSector);
    }
    if (type === 'q') {
        if (dR !== 0 && dS !== 0 && aR !== aS) return false;
        const dirs = [[dR > 0 ? 1 : (dR < 0 ? -1 : 0), dS > 0 ? 1 : (dS < 0 ? -1 : 0)]];
        return lineTargets(board, fromRing, fromSector, dirs, side, dS !== 0 && dR === 0)
            .some(t => t.ring === toRing && t.sector === toSector);
    }
    if (type === 'k') return aR <= 1 && aS <= 1 && (aR + aS) > 0;
    if (type === 'p') {
        const dir = pc.dir || 0;
        if (dir === 0) return false;
        // 直走：1 步（dS=dir）或首步 2 步（dS=2*dir）
        if (dR === 0 && !target && aS >= 1 && aS <= 2 && (dS === dir || dS === 2 * dir)) {
            if (aS === 1) return true;
            if (aS === 2 && !pc.hasMoved && !board[key(fromRing, (fromSector + dir + SECTORS) % SECTORS)]) return true;
            return false;
        }
        if (dS === dir && aR === 1 && target && target[0] !== color) return true;
        return false;
    }
    return false;
}

/** 执行走子，返回 { board, captured, wasPawnMove } */
function applyMoveOnBoard(board, fromRing, fromSector, toRing, toSector, promote) {
    const next = {};
    for (const k in board) next[k] = board[k] && typeof board[k] === 'object' ? { ...board[k] } : board[k];
    const piece = next[key(fromRing, fromSector)];
    const captured = next[key(toRing, toSector)] || '';
    let moveSteps = 0;
    if (piece && piece[1] === 'p') {
        let dS = toSector - fromSector;
        if (dS > 8) dS -= 16;
        if (dS < -8) dS += 16;
        moveSteps = Math.abs(dS) === 2 ? 2 : 1;
    }
    next[key(toRing, toSector)] = piece;
    delete next[key(fromRing, fromSector)];
    if (piece && piece[1] === 'p') {
        const steps = (piece.steps || 0) + moveSteps;
        next[key(toRing, toSector)] = { 0: piece[0], 1: piece[1], dir: piece.dir, steps, hasMoved: true };
        if (steps >= 6) {
            const t = normalizePromote(promote);
            next[key(toRing, toSector)] = { 0: piece[0], 1: t, dir: piece.dir, steps, hasMoved: true };
        }
    }
    return { board: next, captured, wasPawnMove: piece && piece[1] === 'p' };
}

function isLegalMove(board, fromRing, fromSector, toRing, toSector, side, promote) {
    const piece = board[key(fromRing, fromSector)];
    if (!piece || piece[0] !== side[0]) return false;
    if (!isPseudoLegalMove(piece, fromRing, fromSector, toRing, toSector, board)) return false;
    const applied = applyMoveOnBoard(board, fromRing, fromSector, toRing, toSector, promote);
    if (isInCheck(applied.board, side)) return false;
    return true;
}

function generateLegalMoves(board, side) {
    const moves = [];
    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < SECTORS; s++) {
            const p = board[key(r, s)];
            if (!p || p[0] !== side[0]) continue;
            for (let tr = 0; tr < RINGS; tr++) {
                for (let ts = 0; ts < SECTORS; ts++) {
                    if (!isPseudoLegalMove(p, r, s, tr, ts, board)) continue;
                    let dS = ts - s;
                    if (dS > 8) dS -= 16;
                    if (dS < -8) dS += 16;
                    const willPromote = p[1] === 'p' && (p.steps || 0) + (Math.abs(dS) === 2 ? 2 : 1) >= 6;
                    if (willPromote) {
                        for (const promo of PROMOTE_TYPES) {
                            if (isLegalMove(board, r, s, tr, ts, side, promo)) {
                                moves.push({ fromRing: r, fromSector: s, toRing: tr, toSector: ts, promote: promo, capture: !!board[key(tr, ts)] });
                            }
                        }
                    } else if (isLegalMove(board, r, s, tr, ts, side, null)) {
                        moves.push({ fromRing: r, fromSector: s, toRing: tr, toSector: ts, promote: null, capture: !!board[key(tr, ts)] });
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

function pieceLabel(pc) {
    const code = pc[0] + pc[1];
    return PIECE_CHAR[code] || '?';
}

return {
    RINGS, SECTORS, key, PIECE_CHAR, PROMOTE_TYPES,
    setup, emptyBoard, copyBoard, pawnDir, needsPromotion, normalizePromote,
    isSquareAttackedBy, isInCheck, isPseudoLegalMove, applyMoveOnBoard,
    isLegalMove, generateLegalMoves, hasLegalMove, findKing,
    pieceSide, oppositeSide, sideFromSlot, slotFromSide, sideColorChar, pieceLabel
};
})();
        const SLOT_UI = {
            black: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' },
            white: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' }
        };
        const PROMOTE_LABELS = { q: '♛', r: '♜', n: '♞', b: '♝' };

        const canvas = document.getElementById('goBoard');
        const ctx2d = canvas.getContext('2d');
        // 高清渲染：物理分辨率对齐 CSS 尺寸 × devicePixelRatio；绘制逻辑坐标恒为 LOGICAL_SIZE
        const LOGICAL_SIZE = 560;
        const C = LOGICAL_SIZE / 2;
        const R_OUT = LOGICAL_SIZE / 2 - 20;   // 外框半径（大圆）
        const R_IN = R_OUT / 5;                 // 中心小圆半径（大圆半径五等分：4 环 + 中心圆）
        const ringW = (R_OUT - R_IN) / R.RINGS; // 每环径向宽度
        function applyHiDpiCanvas(redraw) {
            if (typeof QiWeiqiSquarePageRuntime === 'undefined' || !QiWeiqiSquarePageRuntime.setupHiDpiCanvas) return;
            QiWeiqiSquarePageRuntime.setupHiDpiCanvas(canvas, LOGICAL_SIZE);
            if (redraw) drawBoard();
        }
        applyHiDpiCanvas(false);
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

        const ps = {
            board: R.setup(),
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
            pendingPromote: null,
            pendingPawnPromote: null
        };

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
            const fontSize = Math.max(48, ringW * 2.0);
            const fontSpec = `${fontSize}px XiangqiPiece`;
            ctx2d.save();
            ctx2d.font = fontSpec;
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.lineJoin = 'round';
            ctx2d.lineWidth = Math.max(4, fontSize * 0.12);
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.fillStyle = '#c62828';
            ctx2d.strokeText('将军！', C, C);
            ctx2d.fillText('将军！', C, C);
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
                    // 编辑盘面满步兵：不走子升变（逐一）
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

        function cellCenter(ring, sector) {
            const a = (sector * 22.5 - 90) * Math.PI / 180;
            const r = R_IN + (ring + 0.5) * ringW;
            return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
        }

        function positionPromoteBar(ring, sector) {
            const p = cellCenter(ring, sector);
            const rect = canvas.getBoundingClientRect();
            const scaleX = rect.width / LOGICAL_SIZE;
            const scaleY = rect.height / LOGICAL_SIZE;
            promoBar.style.display = 'flex';
            promoBar.style.left = Math.max(4, p.x * scaleX - 100) + 'px';
            promoBar.style.top = Math.max(4, p.y * scaleY - 56) + 'px';
        }

        /** 编辑盘面满步兵：显示升变选择条（不走子，直接升变该兵） */
        function showPromotePawn(row, col) {
            ps.pendingPawnPromote = { row, col };
            positionPromoteBar(row, col);
        }

        function showPromote(fromRow, fromCol, toRow, toCol, tryPlay) {
            ps.pendingPromote = { fromRow, fromCol, toRow, toCol, tryPlay: !!tryPlay };
            positionPromoteBar(toRow, toCol);
        }

        function slotOfSide(side) { return R.slotFromSide(side); }

        function boardFlipped() {
            return ps.mySlot === 'white';
        }

        function toDisplaySector(sector) {
            return boardFlipped() ? (sector + 8) % R.SECTORS : sector;
        }

        function toOriginalSector(disp) {
            return boardFlipped() ? (disp + 8) % R.SECTORS : disp;
        }

        function refreshLegalTargets() {
            ps.legalTargets = [];
            if (ps.selectedRow < 0) return;
            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const seen = {};
            const sel = ps.board[R.key(ps.selectedRow, ps.selectedCol)];
            for (const m of R.generateLegalMoves(ps.board, side)) {
                if (m.fromRing !== ps.selectedRow || m.fromSector !== ps.selectedCol) continue;
                const mk = m.toRing + ',' + m.toSector + ',' + (m.promote || '');
                if (seen[mk]) continue;
                seen[mk] = true;
                ps.legalTargets.push({
                    row: m.toRing, col: m.toSector,
                    needsPromote: R.needsPromotion(sel, ps.selectedCol, m.toSector)
                });
            }
        }

        /** 环形格路径：显示扇区 dispSector、半径 [inner, outer]（canvas 角度：0° 正右顺时针；sector 0 在正上） */
        function sectorPath(dispSector, inner, outer) {
            const a0 = (dispSector * 22.5 - 90 - 11.25) * Math.PI / 180;
            const a1 = (dispSector * 22.5 - 90 + 11.25) * Math.PI / 180;
            ctx2d.beginPath();
            ctx2d.arc(C, C, outer, a0, a1, false);
            ctx2d.arc(C, C, inner, a1, a0, true);
            ctx2d.closePath();
        }

        /** 旋转方块（目标格 / 选中框）：沿扇区中心角度方向 */
        function rotatedSquare(ring, dispSector, halfW, halfH, draw) {
            const a = (dispSector * 22.5 - 90) * Math.PI / 180;
            const p = cellCenter(ring, dispSector);
            ctx2d.save();
            ctx2d.translate(p.x, p.y);
            ctx2d.rotate(a);
            draw(-halfW, -halfH, halfW * 2, halfH * 2);
            ctx2d.restore();
        }

        function drawBoard() {
            ctx2d.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);

            // 黑白相间棋格（浅/深，参照国际象棋格色）
            for (let r = 0; r < R.RINGS; r++) {
                const inner = R_IN + r * ringW;
                const outer = inner + ringW;
                for (let s = 0; s < R.SECTORS; s++) {
                    const disp = toDisplaySector(s);
                    sectorPath(disp, inner, outer);
                    ctx2d.fillStyle = (r + s) % 2 === 0 ? '#f0d9b5' : '#b58863';
                    ctx2d.fill();
                }
            }
            // 格线：环向分隔 + 中心圆 + 外框
            ctx2d.strokeStyle = '#8a5a3b';
            ctx2d.lineWidth = 1.5;
            for (let r = 1; r < R.RINGS; r++) {
                ctx2d.beginPath();
                ctx2d.arc(C, C, R_IN + r * ringW, 0, Math.PI * 2);
                ctx2d.stroke();
            }
            ctx2d.beginPath();
            ctx2d.arc(C, C, R_IN, 0, Math.PI * 2);
            ctx2d.stroke();
            ctx2d.beginPath();
            ctx2d.arc(C, C, R_OUT, 0, Math.PI * 2);
            ctx2d.stroke();
            // 径向分隔线（扇区边界：中心角 ±11.25°）
            for (let s = 0; s < R.SECTORS; s++) {
                const a = (s * 22.5 - 90 + 11.25) * Math.PI / 180;
                ctx2d.beginPath();
                ctx2d.moveTo(C + R_IN * Math.cos(a), C + R_IN * Math.sin(a));
                ctx2d.lineTo(C + R_OUT * Math.cos(a), C + R_OUT * Math.sin(a));
                ctx2d.stroke();
            }

            // 最近一步高亮
            if (ps.lastFrom && ps.lastTo) {
                [ps.lastFrom, ps.lastTo].forEach((p) => {
                    const disp = toDisplaySector(p.sector);
                    sectorPath(disp, R_IN + p.ring * ringW, R_IN + (p.ring + 1) * ringW);
                    ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                    ctx2d.fill();
                });
            }

            // 将军高亮
            if (ps.inCheck) {
                const king = R.findKing(ps.board, ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove);
                if (king) {
                    const disp = toDisplaySector(king.sector);
                    sectorPath(disp, R_IN + king.ring * ringW, R_IN + (king.ring + 1) * ringW);
                    ctx2d.fillStyle = 'rgba(200,40,40,0.35)';
                    ctx2d.fill();
                }
            }

            // 目标格：小方块（沿格方向旋转）
            for (const t of ps.legalTargets) {
                const disp = toDisplaySector(t.col);
                const occupied = !!ps.board[R.key(t.row, t.col)];
                if (occupied) {
                    rotatedSquare(t.row, disp, ringW * 0.34, ringW * 0.34, (x, y, w, h) => {
                        ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                        ctx2d.lineWidth = 3.5;
                        ctx2d.strokeRect(x, y, w, h);
                    });
                } else {
                    rotatedSquare(t.row, disp, ringW * 0.12, ringW * 0.12, (x, y, w, h) => {
                        ctx2d.fillStyle = 'rgba(163,92,39,0.9)';
                        ctx2d.fillRect(x, y, w, h);
                    });
                }
            }

            // 棋子
            for (let r = 0; r < R.RINGS; r++) {
                for (let s = 0; s < R.SECTORS; s++) {
                    const piece = ps.board[R.key(r, s)];
                    if (!piece) continue;
                    const disp = toDisplaySector(s);
                    const { x, y } = cellCenter(r, disp);
                    const isWhite = piece[0] === 'w';
                    const fontSize = ringW * 0.8 * (isWhite ? 1 : 1.05);
                    ctx2d.font = `${fontSize}px "XiangqiPiece", "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
                    ctx2d.textAlign = 'center';
                    ctx2d.textBaseline = 'middle';
                    const glyph = R.pieceLabel(piece);
                    const gy = y + ringW * 0.03;
                    if (isWhite) {
                        ctx2d.lineWidth = Math.max(1.5, ringW * 0.04);
                        ctx2d.strokeStyle = '#1a1a1a';
                        ctx2d.fillStyle = '#f7f7f7';
                        ctx2d.strokeText(glyph, x, gy);
                        ctx2d.fillText(glyph, x, gy);
                    } else {
                        ctx2d.fillStyle = '#1a1a1a';
                        ctx2d.fillText(glyph, x, gy);
                    }
                }
            }

            // 选中格
            if (ps.selectedRow >= 0) {
                const disp = toDisplaySector(ps.selectedCol);
                rotatedSquare(ps.selectedRow, disp, ringW * 0.44, ringW * 0.44, (x, y, w, h) => {
                    ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                    ctx2d.lineWidth = 2;
                    ctx2d.strokeRect(x, y, w, h);
                });
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

        function snapshotFrom(board, side, lastFrom, lastTo) {
            return {
                board: R.copyBoard(board),
                sideToMove: side,
                lastFrom: lastFrom ? { ...lastFrom } : null,
                lastTo: lastTo ? { ...lastTo } : null
            };
        }

        function rebuildLiveSnapshots() {
            const snaps = [snapshotFrom(R.setup(), 'white', null, null)];
            let b = R.setup();
            let side = 'white';
            for (const m of ps.moveHistory) {
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side, m.promote)) break;
                const applied = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol, m.promote);
                b = applied.board;
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side,
                    { ring: m.fromRow, sector: m.fromCol }, { ring: m.toRow, sector: m.toCol }));
            }
            ps.liveSnapshots = snaps;
        }

        function applySnapshot(s) {
            ps.board = R.copyBoard(s.board);
            ps.sideToMove = s.sideToMove;
            ps.currentPlayer = s.sideToMove === 'white' ? 1 : 2;
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
            const snaps = [snapshotFrom(R.setup(), 'white', null, null)];
            let b = R.setup();
            let side = 'white';
            for (const raw of moves) {
                let m = raw;
                if (typeof raw === 'string') {
                    const mt = raw.match(/^([BW])(\d+),(\d+)-(\d+),(\d+)(?:=([QRNB]))?$/i);
                    if (!mt) continue;
                    m = { fromRow: +mt[2], fromCol: +mt[3], toRow: +mt[4], toCol: +mt[5], promote: mt[6] ? mt[6].toLowerCase() : null };
                }
                if (!R.isLegalMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol, side, m.promote)) break;
                const applied = R.applyMoveOnBoard(b, m.fromRow, m.fromCol, m.toRow, m.toCol, m.promote);
                b = applied.board;
                side = R.oppositeSide(side);
                snaps.push(snapshotFrom(b, side,
                    { ring: m.fromRow, sector: m.fromCol }, { ring: m.toRow, sector: m.toCol }));
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
                ps.board = R.setup();
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
            if (!R.isLegalMove(ps.board, fromRow, fromCol, toRow, toCol, ps.tryPlaySide, promote)) return false;
            const applied = R.applyMoveOnBoard(ps.board, fromRow, fromCol, toRow, toCol, promote);
            const side = R.oppositeSide(ps.tryPlaySide);
            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlaySnapshots.length = ps.tryPlayStep + 1;
            }
            ps.tryPlaySnapshots.push(snapshotFrom(applied.board, side,
                { ring: fromRow, sector: fromCol }, { ring: toRow, sector: toCol }));
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

        /** 命中：返回原坐标 { row: ring, col: sector }；中心圆/圆外返回 { row: -1, col: -1 } */
        function getRingSectorFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = LOGICAL_SIZE / rect.width;
            const scaleY = LOGICAL_SIZE / rect.height;
            const x = (clientX - rect.left) * scaleX;
            const y = (clientY - rect.top) * scaleY;
            const dx = x - C, dy = y - C;
            const d = Math.hypot(dx, dy);
            if (d < R_IN - 0.5 || d > R_OUT + 0.5) return { row: -1, col: -1 };
            const ring = Math.min(R.RINGS - 1, Math.max(0, Math.floor((d - R_IN) / ringW)));
            const aDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            let raw = (aDeg + 90 + 11.25) / 22.5;
            raw = ((raw % R.SECTORS) + R.SECTORS) % R.SECTORS;
            const disp = Math.floor(raw) % R.SECTORS;
            return { row: ring, col: toOriginalSector(disp) };
        }

        function attemptMove(fr, fc, row, col, tryPlay) {
            const piece = ps.board[R.key(fr, fc)];
            if (R.needsPromotion(piece, fc, col)) {
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
            if (R.isLegalMove(ps.board, fr, fc, row, col, side, null)) {
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
            if (ps.pendingPawnPromote) return;
            const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length && ps.liveViewStep < ps.liveSnapshots.length - 1;
            if (viewingPast) return;
            if (ps.gameOver && !ps.tryPlayMode) return;

            const { row, col } = getRingSectorFromClient(clientX, clientY);
            if (row < 0) return;

            const interactive = ps.tryPlayMode || ps.isMyTurn;
            if (!interactive) return;

            const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
            const ch = R.sideColorChar(side);

            if (ps.selectedRow < 0) {
                const p = ps.board[R.key(row, col)];
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

            const p2 = ps.board[R.key(row, col)];
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
            getBoardSize: () => R.RINGS,
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
                // 编辑盘面满步兵：逐一升变（不走子）。必须在 syncState 之后，否则会被 hidePromote 清掉
                const editing = !!(editApi && editApi.isEditModeActive && editApi.isEditModeActive());
                if (state && state.pendingPromotion && !editing && !ps.gameOver && !ps.replayMode && !ps.tryPlayMode) {
                    showPromotePawn(state.pendingPromotion.ring, state.pendingPromotion.sector);
                }
            },
            updateBoardGeometry: () => {},
            initBoardArray: () => R.setup(),
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

        // 编辑模式：flat 64 数组（ring-major：index = ring*16 + sector）
        let editApi = null;
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps,
                canvas,
                mode: 'flat',
                editTools: config.editTools,
                pickAtClient(clientX, clientY) {
                    const { row, col } = getRingSectorFromClient(clientX, clientY);
                    if (row < 0) return null;
                    return { index: row * R.SECTORS + col };
                },
                drawBoard,
                getBoard: () => {
                    const arr = [];
                    for (let i = 0; i < R.RINGS * R.SECTORS; i++) {
                        const pc = ps.board[R.key(Math.floor(i / R.SECTORS), i % R.SECTORS)];
                        arr.push(pc ? pc[0] + pc[1] : '');
                    }
                    return arr;
                },
                setBoard: (b) => {
                    const next = {};
                    for (let i = 0; i < b.length; i++) {
                        const v = b[i];
                        if (v) next[R.key(Math.floor(i / R.SECTORS), i % R.SECTORS)] = v;
                    }
                    ps.board = next;
                },
                emptyBoard: () => R.emptyBoard()
            });
        }

        updateTurn();
        drawBoard();
        updateMatchControlButtons();
        })();
    }
};
