'use strict';
/**
 * 融合象棋 hybrid-xiangqi
 *   9×9，棋子落在格内；白先黑后，player1 座执白（白方在下）
 *   开局双方各一枚「旗」（不可移动），吃掉对方旗/將/帅/王即胜
 *   驹台（背包）初始 3 士 + 3 卒；可打入空点，或打入己方棋子上融合成高级棋子
 *   被吃的棋子分解为基础子（士/卒/包）进入吃子方驹台；每方每走满 3 手在自己驹台加一枚
 * 融合配方只看组成（多重集），不看融合路径，未命中则不能打入
 */

const {
    QiTwoPlayerRoomBase,
    qiProtocol,
    qiMatchTimeControl,
    qiBoardSeatOverlay
} = require('../common');

const BOARD_W = 9;
const BOARD_H = 9;
const HOME_ROW_WHITE = 0;   // 白方底线（站点 row 0 = 屏幕最下面一行）
const HOME_ROW_BLACK = 8;

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL8 = ORTH.concat(DIAG);
const KNIGHT_OFFSETS = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

/**
 * 棋子表
 *   comp  组成（基础子多重集）—— 融合与被吃分解都以它为准
 *   move  走法。名字一律以 Move 结尾，与 kind 分属两套名字，绝不同名、也不混用：
 *         noneMove 不可走 / stepMove 单步 / leap2Move 直或斜两格(中间须空) / slideMove 滑行 /
 *         knightMove 日字(可蹩腿) / knightRunMove 沿日字方向连走(路径须空) /
 *         stepKnightMove 单步+日字 / slideStepMove 滑行+单步 / slideKnightMove 滑行+日字 /
 *         cannonMove 砲(吃子须隔一子) / cannonKnightMove 沿日字方向连走(吃子须隔一子)
 *   kind  图标名（客户端 SYMBOLS / LABELS 的键）
 *   royal 皇棋（被吃即负）
 */
const PIECES = {
    S: { name: '士', comp: { S: 1 }, move: 'stepMove', dirs: DIAG, kind: 'scholar' },
    Z: { name: '卒', comp: { Z: 1 }, move: 'stepMove', dirs: ORTH, kind: 'pawn' },
    BA: { name: '包', comp: { BA: 1 }, move: 'noneMove', kind: 'bundle' },        // 只能融合，不能落空点
    Q: { name: '旗', comp: { Q: 1 }, move: 'noneMove', royal: true, kind: 'flag' },
    X: { name: '象', comp: { S: 2 }, move: 'leap2Move', dirs: DIAG, kind: 'elephant' },
    M: { name: '馬', comp: { S: 1, Z: 1 }, move: 'knightMove', leg: true, kind: 'horse' },
    XI: { name: '驍', comp: { S: 1, Z: 1, BA: 1 }, move: 'cannonKnightMove', kind: 'xiao' },
    P: { name: '兵', comp: { Z: 2 }, move: 'leap2Move', dirs: ORTH, kind: 'soldier' },
    WE: { name: '卫', comp: { S: 2, Z: 1 }, move: 'stepKnightMove', dirs: DIAG, leg: true, kind: 'guard' },
    DZ: { name: '督', comp: { S: 4, Z: 2 }, move: 'slideKnightMove', dirs: DIAG, kind: 'viceroy' },
    ZJ: { name: '撫', comp: { S: 3 }, move: 'slideMove', dirs: DIAG, kind: 'bishop' },
    JI: { name: '驥', comp: { S: 2, Z: 2 }, move: 'knightRunMove', kind: 'steed' },
    QS: { name: '騎', comp: { S: 1, Z: 2 }, move: 'knightMove', kind: 'knight' },
    C: { name: '車', comp: { Z: 3 }, move: 'slideMove', dirs: ORTH, kind: 'rook' },
    LM: { name: '驡', comp: { S: 3, Z: 1 }, move: 'slideStepMove', dirs: DIAG, stepDirs: ORTH, kind: 'loongma' },
    LW: { name: '龍', comp: { S: 1, Z: 3 }, move: 'slideStepMove', dirs: ORTH, stepDirs: DIAG, kind: 'loong' },
    H: { name: '后', comp: { S: 3, Z: 3 }, move: 'slideMove', dirs: ALL8, kind: 'queen' },
    SX: { name: '相', comp: { S: 1, Z: 5 }, move: 'slideKnightMove', dirs: DIAG, kind: 'chancellor' },
    PX: { name: '砲', comp: { BA: 1, S: 1 }, move: 'cannonMove', dirs: DIAG, kind: 'trebuchet' },
    PZ: { name: '軳', comp: { BA: 1, Z: 1 }, move: 'cannonMove', dirs: ORTH, kind: 'artillery‌' },
    DP: { name: '炮', comp: { BA: 2, S: 1, Z: 1 }, move: 'cannonMove', dirs: ALL8, kind: 'cannon' },
    J: { name: '將', comp: { Q: 1, Z: 1 }, move: 'stepMove', dirs: ORTH, royal: true, kind: 'general' },
    SH: { name: '帥', comp: { Q: 1, S: 1 }, move: 'stepMove', dirs: DIAG, royal: true, kind: 'marshal' },
    WA: { name: '王', comp: { Q: 1, S: 1, Z: 1 }, move: 'stepMove', dirs: ALL8, royal: true, kind: 'king' }
};

/** 组成 → 棋子类型（多重集键按 f,g,p,o 固定顺序） */
const COMP_ORDER = ['Q', 'S', 'Z', 'BA'];
function compKey(comp) {
    return COMP_ORDER.map((k) => comp[k] || 0).join('');
}
const FUSION = Object.create(null);
for (const t of Object.keys(PIECES)) FUSION[compKey(PIECES[t].comp)] = t;

/** 两枚棋子的组成相加 → 棋子类型（盘上棋子走上去合并用）；无配方返回 null */
function fuseComps(a, b) {
    const c = {};
    for (const k of COMP_ORDER) c[k] = (a[k] || 0) + (b[k] || 0);
    return FUSION[compKey(c)] || null;
}

/** 把一枚驹台棋子（基础子）加到目标棋子的组成上，返回融合后的类型；无配方返回 null */
function fuseType(comp, material) {
    const c = Object.assign({}, comp);
    c[material] = (c[material] || 0) + 1;
    return FUSION[compKey(c)] || null;
}

function materialList(comp) {
    const out = [];
    for (const k of ['S', 'Z', 'BA']) for (let i = 0; i < (comp[k] || 0); i++) out.push(k);
    return out;
}

const R = (function () {
    'use strict';

    function emptyBoard() {
        return Array.from({ length: BOARD_H }, () => new Array(BOARD_W).fill(''));
    }
    function copyBoard(b) {
        return b.map((r) => r.slice());
    }
    function inBounds(r, c) {
        return r >= 0 && r < BOARD_H && c >= 0 && c < BOARD_W;
    }
    function sideOfSlot(slot) {
        return slot === 'player1' ? 'white' : 'black';
    }
    function slotOfSide(side) {
        return side === 'white' ? 'player1' : 'player2';
    }
    function oppositeSide(side) {
        return side === 'white' ? 'black' : 'white';
    }
    function sideChar(side) {
        return side === 'white' ? 'w' : 'b';
    }
    function codeOf(side, t) {
        return sideChar(side) + t;
    }
    function typeOf(code) {
        return code ? code.slice(1) : null;
    }
    function sideOfCode(code) {
        return code ? (code[0] === 'w' ? 'white' : 'black') : null;
    }
    function isRoyal(code) {
        const t = typeOf(code);
        return !!(t && PIECES[t] && PIECES[t].royal);
    }

    /**
     * 初始局面（格号 1..9 自 A 列起）：
     *   底线：第 2/4/6/8 格（偶数格）士、正中第 5 格旗，其余空
     *   倒数第二行：第 1/3/7/9 格卒、正中第 5 格士，其余空
     * 即每方 5 士 + 4 卒 + 1 旗，驹台为空
     */
    function createInitialBoard() {
        const b = emptyBoard();
        const back = [HOME_ROW_WHITE, HOME_ROW_BLACK];
        const front = [HOME_ROW_WHITE + 1, HOME_ROW_BLACK - 1];
        const chars = ['w', 'b'];
        for (let i = 0; i < 2; i++) {
            for (const c of [1, 3, 5, 7]) b[back[i]][c] = chars[i] + 'S';       // 底线偶数格 → 士
            b[back[i]][4] = chars[i] + 'Q';                                     // 底线正中 → 旗
            for (const c of [0, 2, 6, 8]) b[front[i]][c] = chars[i] + 'Z';      // 倒数第二行 1/3/7/9 → 卒
            b[front[i]][4] = chars[i] + 'S';                                    // 倒数第二行正中 → 士
        }
        return b;
    }
    function createInitialHand() {
        return { S: 0, Z: 0, BA: 0 };                                           // 开局无持驹
    }

    /**
     * 生成 (row, col) 处棋子的全部走法（伪合法，未过滤送将；合法性见 legalMovesFrom）
     * @returns {Array<{row:number,col:number,capture:boolean,merge?:string}>}
     */
    function genPieceMoves(board, row, col) {
        const code = board[row] && board[row][col];
        if (!code) return [];
        const def = PIECES[typeOf(code)];
        if (!def || def.move === 'noneMove') return [];
        const side = sideOfCode(code);
        const out = [];
        const at = (r, c) => (inBounds(r, c) ? board[r][c] : undefined);
        /** 落点：空 → 可走；敌子 → 可吃；己方/出界 → 不可；返回 true 表示可继续滑行 */
        const push = (r, c) => {
            const v = at(r, c);
            if (v === undefined) return false;
            if (!v) { out.push({ row: r, col: c, capture: false }); return true; }
            if (sideOfCode(v) !== side) { out.push({ row: r, col: c, capture: true }); return false; }
            // 己方棋子：组成相加若有配方，则可以走上去合并
            const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
            if (merged) out.push({ row: r, col: c, capture: false, merge: merged });
            return false;
        };
        const slide = (dirs) => {
            for (const [dr, dc] of dirs) {
                let r = row + dr, c = col + dc;
                while (push(r, c)) { r += dr; c += dc; }
            }
        };
        const step = (dirs) => {
            for (const [dr, dc] of dirs) push(row + dr, col + dc);
        };
        const leap2 = (dirs) => {
            for (const [dr, dc] of dirs) {
                if (!inBounds(row + dr, col + dc) || board[row + dr][col + dc]) continue;   // 中间格须空
                push(row + 2 * dr, col + 2 * dc);
            }
        };
        const knight = () => {
            for (const [dr, dc] of KNIGHT_OFFSETS) {
                if (def.leg) {
                    const lr = row + (Math.abs(dr) === 2 ? dr / 2 : 0);
                    const lc = col + (Math.abs(dc) === 2 ? dc / 2 : 0);
                    if (!inBounds(lr, lc) || board[lr][lc]) continue;               // 蹩腿
                }
                push(row + dr, col + dc);
            }
        };
        /** 驥：沿馬步方向连走任意步；腿位与中途落点必须为空，最后一步可吃子或走上去合并 */
        const knightRun = () => {
            for (const [dr, dc] of KNIGHT_OFFSETS) {
                let r = row, c = col;
                for (;;) {
                    const legR = r + (Math.abs(dr) === 2 ? dr / 2 : 0);
                    const legC = c + (Math.abs(dc) === 2 ? dc / 2 : 0);
                    if (!inBounds(legR, legC) || board[legR][legC]) break;      // 腿位（直格）必须为空
                    const nr = r + dr, nc = c + dc;
                    if (!inBounds(nr, nc)) break;
                    const v = board[nr][nc];
                    if (!v) { out.push({ row: nr, col: nc, capture: false }); }
                    else {
                        if (sideOfCode(v) !== side) out.push({ row: nr, col: nc, capture: true });
                        else {
                            const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
                            if (merged) out.push({ row: nr, col: nc, capture: false, merge: merged });
                        }
                        break;                                                  // 撞到棋子就到此为止
                    }
                    r = nr; c = nc;
                }
            }
        };
        /** 驍：沿馬步方向连走任意步；移动（含走上去融合）要求路径全空，吃子则路径上必须恰好隔一子 */
        const cannonKnight = () => {
            for (const [dr, dc] of KNIGHT_OFFSETS) {
                let r = row, c = col, screens = 0;
                for (;;) {
                    const legR = r + (Math.abs(dr) === 2 ? dr / 2 : 0);
                    const legC = c + (Math.abs(dc) === 2 ? dc / 2 : 0);
                    if (!inBounds(legR, legC)) break;
                    if (board[legR][legC] && ++screens > 1) break;                 // 腿位上的第二枚：到此为止
                    const nr = r + dr, nc = c + dc;
                    if (!inBounds(nr, nc)) break;
                    const v = board[nr][nc];
                    if (!v) {
                        if (screens === 0) out.push({ row: nr, col: nc, capture: false });      // 移动：路径须全空
                    } else {
                        const enemy = sideOfCode(v) !== side;
                        if (enemy) {
                            if (screens === 1) out.push({ row: nr, col: nc, capture: true });    // 终点吃子：前段恰隔一子
                        } else if (screens === 0) {
                            const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
                            if (merged) out.push({ row: nr, col: nc, capture: false, merge: merged });
                        }
                        if (++screens > 1) break;                                   // 终点上的棋子也算路径上的一子（可被跳过）
                    }
                    r = nr; c = nc;
                }
            }
        };
        const cannon = (dirs) => {
            for (const [dr, dc] of dirs) {
                let r = row + dr, c = col + dc, screen = false;
                while (inBounds(r, c)) {
                    const v = board[r][c];
                    if (!screen) {
                        if (!v) out.push({ row: r, col: c, capture: false });
                        else {
                            // 砲架前的第一枚棋子：若为己方且组成有配方，可按正常走法走上去融合
                            // （吃子仍须隔砲架，故这里只给合并、不给吃）
                            if (sideOfCode(v) === side) {
                                const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
                                if (merged) out.push({ row: r, col: c, capture: false, merge: merged });
                            }
                            screen = true;                                            // 砲架
                        }
                    } else if (v) {
                        if (sideOfCode(v) !== side) out.push({ row: r, col: c, capture: true });
                        break;
                    }
                    r += dr; c += dc;
                }
            }
        };

        switch (def.move) {
            case 'stepMove': step(def.dirs); break;
            case 'leap2Move': leap2(def.dirs); break;
            case 'slideMove': slide(def.dirs); break;
            case 'knightMove': knight(); break;
            case 'cannonKnightMove': cannonKnight(); break;
            case 'knightRunMove': knightRun(); break;
            case 'slideStepMove': slide(def.dirs); step(def.stepDirs); break;
            case 'slideKnightMove': slide(def.dirs); knight(); break;
            case 'cannonMove': cannon(def.dirs); break;
            case 'stepKnightMove': step(def.dirs); knight(); break;
            default: break;
        }
        return out;
    }

    /** 某格的全部走法里是否包含目标格 */
    function findMove(board, fromRow, fromCol, toRow, toCol) {
        if (!inBounds(fromRow, fromCol) || !inBounds(toRow, toCol)) return null;
        const list = genPieceMoves(board, fromRow, fromCol);
        for (const m of list) if (m.row === toRow && m.col === toCol) return m;
        return null;
    }

    /** 把棋子编码分解为基础子列表（包/士/卒；旗不计入驹台） */
    function dematerialize(code) {
        const def = PIECES[typeOf(code)];
        if (!def) return [];
        return materialList(def.comp);
    }

    /** 某方是否还有皇棋，以及它在哪 */
    function findRoyal(board, side) {
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const code = board[r][c];
                if (code && sideOfCode(code) === side && isRoyal(code)) return { row: r, col: c, code };
            }
        }
        return null;
    }

    /** 在棋盘副本上执行一步（含走上去合并），用于送将预判 */
    function applyMoveToBoard(board, fromRow, fromCol, toRow, toCol, mv) {
        const next = copyBoard(board);
        const code = next[fromRow] && next[fromRow][fromCol];
        if (!code) return next;
        const side = sideOfCode(code);
        const target = next[toRow][toCol];
        next[fromRow][fromCol] = '';
        if (target && sideOfCode(target) === side && mv && mv.merge) next[toRow][toCol] = codeOf(side, mv.merge);
        else next[toRow][toCol] = code;
        return next;
    }

    /** 在棋盘副本上执行一次打入/融合 */
    function applyDropToBoard(board, side, toRow, toCol, resultType) {
        const next = copyBoard(board);
        next[toRow][toCol] = codeOf(side, resultType);
        return next;
    }

    /** 某方皇棋（旗/將/帅/王）是否正被对方攻击 */
    function isRoyalAttacked(board, side) {
        const royal = findRoyal(board, side);
        if (!royal) return true;                                   // 已无皇棋
        const enemy = oppositeSide(side);
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const code = board[r][c];
                if (!code || sideOfCode(code) !== enemy) continue;
                for (const m of genPieceMoves(board, r, c)) {
                    if (m.row === royal.row && m.col === royal.col) return true;
                }
            }
        }
        return false;
    }

    /** 该格棋子的合法走法（剔除走后己方皇棋被吃的着法，即不能送将） */
    function legalMovesFrom(board, row, col) {
        const code = board[row] && board[row][col];
        if (!code) return [];
        const side = sideOfCode(code);
        return genPieceMoves(board, row, col).filter((m) =>
            !isRoyalAttacked(applyMoveToBoard(board, row, col, m.row, m.col, m), side));
    }

    /** 打入该点是否合法：空格可落（包除外）、己方棋子可融合，且不能送将 */
    function isLegalDrop(board, side, material, toRow, toCol) {
        if (!inBounds(toRow, toCol)) return false;
        const target = board[toRow][toCol];
        let resultType;
        if (!target) {
            if (material === 'BA') return false;
            resultType = material;
        } else {
            if (sideOfCode(target) !== side) return false;
            resultType = fuseType(PIECES[typeOf(target)].comp, material);
            if (!resultType) return false;
        }
        return !isRoyalAttacked(applyDropToBoard(board, side, toRow, toCol, resultType), side);
    }

    /** 该方是否还有可行着法（走子或打入）；没有即困毙判负 */
    function hasLegalAction(board, hand, side) {
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const code = board[r][c];
                if (!code || sideOfCode(code) !== side) continue;
                if (legalMovesFrom(board, r, c).length) return true;
            }
        }
        const mine = (hand && hand[side]) || {};
        for (const m of ['S', 'Z', 'BA']) {
            if ((mine[m] || 0) <= 0) continue;
            for (let r = 0; r < BOARD_H; r++) {
                for (let c = 0; c < BOARD_W; c++) {
                    if (isLegalDrop(board, side, m, r, c)) return true;
                }
            }
        }
        return false;
    }

    return {
        BOARD_W, BOARD_H, HOME_ROW_WHITE, HOME_ROW_BLACK,
        PIECES, FUSION, compKey, fuseType, fuseComps, materialList, dematerialize,
        emptyBoard, copyBoard, inBounds, sideOfSlot, slotOfSide, oppositeSide,
        sideChar, codeOf, typeOf, sideOfCode, isRoyal,
        createInitialBoard, createInitialHand, genPieceMoves, findMove, findRoyal,
        applyMoveToBoard, applyDropToBoard, isRoyalAttacked, legalMovesFrom, isLegalDrop, hasLegalAction
    };
})();

class HybridXiangqiRoom extends QiTwoPlayerRoomBase {
    constructor(room) {
        super(room);
        this.boardRows = R.BOARD_H;
        this.boardCols = R.BOARD_W;
        this.resetToEmpty();
    }

    // ---------- 时钟（与国际象棋一致） ----------
    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        this.broadcast({ type: 'clockUpdate', clock: qiMatchTimeControl.snapshotForClient(this.tcClock) });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
                this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _firstPickerSlot() {
        const t1 = this.slotJoinedAt.player1;
        const t2 = this.slotJoinedAt.player2;
        if (t1 == null || t2 == null) return 'player1';   // 白先，默认白方先选限时
        return t1 <= t2 ? 'player1' : 'player2';
    }
    afterColorAssigned(ws, slot) {
        this.slotJoinedAt[slot] = Date.now();
        this._maybeBeginTimeNegotiation();
    }
    _timeAllowsPlay(slot) {
        if (this.gameOver || !this.matchStarted || this.tcNego || this.tcSettings === null) return false;
        return slot === R.slotOfSide(this.sideToMove);
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        if (slot !== R.slotOfSide(this.sideToMove)) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.recordResultText = lostSlot === 'player2' ? '黑方超时，白胜' : '白方超时，黑胜';
            this.broadcast({ type: 'broadcast', action: 'timeLoss', player: lostSlot, winner: winnerSlot, ...this.getState() });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        qiMatchTimeControl.setActiveSlot(this.tcClock, R.slotOfSide(this.sideToMove), Date.now());
        this._broadcastClock();
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    /** 这些棋种白方先行，player1 座执白 */
    getChatSideLabel(slot) {
        return slot === 'player1' ? '白方' : (slot === 'player2' ? '黑方' : String(slot));
    }

    getState() {
        return {
            board: this.board,
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            boardSize: R.BOARD_W,
            sideToMove: this.sideToMove,
            currentPlayer: this.sideToMove === 'white' ? 1 : 2,
            numberOfHands: this.moveHistory.length + 1,
            lastFrom: this.lastFrom,
            lastTo: this.lastTo,
            lastMoveMarkers: this.lastTo ? [{ row: this.lastTo.row, col: this.lastTo.col, color: this.sideToMove === 'white' ? 2 : 1 }] : [],
            inCheck: R.isRoyalAttacked(this.board, this.sideToMove),
            hand: {
                white: { ...this.hand.white },
                black: { ...this.hand.black }
            },
            turnCount: { white: this.turnCount.white, black: this.turnCount.black },
            gameOver: this.gameOver,
            winner: this.winner,
            moveHistory: this.moveHistory.map((m) => ({ ...m })),
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
            },
            matchStarted: this.matchStarted,
            recordResultText: this.recordResultText,
            slots: {
                player2: !!this.room.getPlayerBySlot('player2'),
                player1: !!this.room.getPlayerBySlot('player1')
            }
        };
    }

    // ---------- 落子 / 打入 ----------
    _snapshot() {
        return {
            board: R.copyBoard(this.board),
            hand: { white: { ...this.hand.white }, black: { ...this.hand.black } },
            turnCount: { ...this.turnCount },
            sideToMove: this.sideToMove,
            lastFrom: this.lastFrom ? { ...this.lastFrom } : null,
            lastTo: this.lastTo ? { ...this.lastTo } : null
        };
    }

    _restore(snap) {
        this.board = snap.board;
        this.hand = snap.hand;
        this.turnCount = snap.turnCount;
        this.sideToMove = snap.sideToMove;
        this.lastFrom = snap.lastFrom;
        this.lastTo = snap.lastTo;
    }

    /** 被吃棋子分解进吃子方驹台 */
    _absorbCapture(side, code) {
        for (const m of R.dematerialize(code)) {
            this.hand[side][m] = (this.hand[side][m] || 0) + 1;
        }
    }

    /** 走满 3 手 → 本次应加一枚（士40% 卒40% 包20%）；forced 用于棋谱导入按记录回放 */
    _maybeGrowHand(side, forced) {
        this.turnCount[side] = (this.turnCount[side] || 0) + 1;
        const due = this.turnCount[side] % 3 === 0;
        let m = null;
        if (due) {
            if (forced === 'S' || forced === 'Z' || forced === 'BA') m = forced;
            else if (forced === '') m = null;                       // 记录里明确没有加子
            else {
                const r = Math.random();
                m = r < 0.4 ? 'S' : (r < 0.8 ? 'Z' : 'BA');
            }
        } else if (forced) {
            m = forced;                                             // 与推算不一致时以记录为准
        }
        if (m) this.hand[side][m] = (this.hand[side][m] || 0) + 1;
        return m;
    }

    /** 轮到的一方若无可行着法（困毙）则判负 */
    _judgeNoLegalAction(sideToMove) {
        if (this.gameOver) return;
        if (R.hasLegalAction(this.board, this.hand, sideToMove)) return;
        const loser = sideToMove === 'white' ? '白方' : '黑方';
        const winner = sideToMove === 'white' ? '黑胜' : '白胜';
        const bogged = R.isRoyalAttacked(this.board, sideToMove) ? '将死' : '困毙';
        this._endGame(R.slotOfSide(R.oppositeSide(sideToMove)), `${loser}${bogged}，${winner}`);
    }

    _endByRoyalCapture(winnerSide, capturedCode) {
        this.gameOver = true;
        this.winner = R.slotOfSide(winnerSide);
        const lost = PIECES[R.typeOf(capturedCode)].name;
        this.recordResultText = `${winnerSide === 'white' ? '白方' : '黑方'}吃掉对方${lost}获胜`;
        this._stopClockTicker();
    }

    _applyMoveCore(fromRow, fromCol, toRow, toCol, slot, opts) {
        const side = R.sideOfSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        const code = this.board[fromRow] && this.board[fromRow][fromCol];
        if (!code || R.sideOfCode(code) !== side) return { ok: false };
        const mv = R.findMove(this.board, fromRow, fromCol, toRow, toCol);
        if (!mv) return { ok: false };
        if (R.isRoyalAttacked(R.applyMoveToBoard(this.board, fromRow, fromCol, toRow, toCol, mv), side))
            return { ok: false, selfCheck: true };

        const snap = this._snapshot();
        const captured = this.board[toRow][toCol];

        if (captured && R.sideOfCode(captured) === side) {
            // 走上去合并：组成相加（findMove 已保证有配方）
            if (!mv.merge) return { ok: false };
            this.board[toRow][toCol] = R.codeOf(side, mv.merge);
            this.board[fromRow][fromCol] = '';
            const growM = this._maybeGrowHand(side, opts && opts.grow);
            this.moveHistory.push({
                type: 'move', player: slot, piece: R.typeOf(code),
                fromRow, fromCol, toRow, toCol,
                captured: '', merge: mv.merge,
                grow: growM || ''
            });
            this.historyBoards.push(snap.board);
            this.historySnaps.push(snap);
            this.lastFrom = { row: fromRow, col: fromCol };
            this.lastTo = { row: toRow, col: toCol };
            this.sideToMove = R.oppositeSide(side);
            const gaveCheckMerge = R.isRoyalAttacked(this.board, this.sideToMove);
            this._judgeNoLegalAction(this.sideToMove);
            return { ok: true, gaveCheck: gaveCheckMerge };
        }

        this.board[toRow][toCol] = code;
        this.board[fromRow][fromCol] = '';
        if (captured) this._absorbCapture(side, captured);

        const grow = this._maybeGrowHand(side, opts && opts.grow);
        this.moveHistory.push({
            type: 'move', player: slot, piece: R.typeOf(code),
            fromRow, fromCol, toRow, toCol,
            captured: R.typeOf(captured) || '',
            grow: grow || ''
        });
        this.historyBoards.push(snap.board);
        this.historySnaps.push(snap);
        this.lastFrom = { row: fromRow, col: fromCol };
        this.lastTo = { row: toRow, col: toCol };

        if (captured && R.isRoyal(captured)) {
            this._endByRoyalCapture(side, captured);
            return { ok: true, over: true };
        }
        this.sideToMove = R.oppositeSide(side);
        const gaveCheck = R.isRoyalAttacked(this.board, this.sideToMove);
        this._judgeNoLegalAction(this.sideToMove);
        return { ok: true, gaveCheck };
    }

    /** 打入：材料落空点（包除外），或落到己方棋子上融合 */
    _applyDropCore(material, toRow, toCol, slot, opts) {
        const side = R.sideOfSlot(slot);
        if (side !== this.sideToMove) return { ok: false };
        if (!['S', 'Z', 'BA'].includes(material)) return { ok: false };
        if ((this.hand[side][material] || 0) <= 0) return { ok: false };
        if (!R.inBounds(toRow, toCol)) return { ok: false };

        const target = this.board[toRow][toCol];
        let resultType = null;
        if (!target) {
            if (material === 'BA') return { ok: false };      // 包不能落空点
            resultType = material;
        } else {
            if (R.sideOfCode(target) !== side) return { ok: false };
            const comp = PIECES[R.typeOf(target)].comp;
            resultType = R.fuseType(comp, material);
            if (!resultType) return { ok: false };             // 没有配方 → 不能打入
        }
        if (R.isRoyalAttacked(R.applyDropToBoard(this.board, side, toRow, toCol, resultType), side))
            return { ok: false, selfCheck: true };

        const snap = this._snapshot();
        this.hand[side][material] -= 1;
        this.board[toRow][toCol] = R.codeOf(side, resultType);
        const grow = this._maybeGrowHand(side, opts && opts.grow);
        this.moveHistory.push({
            type: 'drop', player: slot, material,
            toRow, toCol,
            intoType: target ? R.typeOf(target) : '',
            result: resultType,
            grow: grow || ''
        });
        this.historyBoards.push(snap.board);
        this.historySnaps.push(snap);
        this.lastFrom = null;
        this.lastTo = { row: toRow, col: toCol };

        this.sideToMove = R.oppositeSide(side);
        const gaveCheck = R.isRoyalAttacked(this.board, this.sideToMove);
        this._judgeNoLegalAction(this.sideToMove);
        return { ok: true, gaveCheck };
    }

    handleMessage(ws, msg) {
        if (!msg || !msg.type) return;
        const slot = this.room.getSlotByWs(ws);
        switch (msg.type) {
            case 'selectColor':
                qiProtocol.selectColor(this, ws, msg, { afterColorAssigned: (logic, _ws, s) => logic.afterColorAssigned(_ws, s) });
                break;
            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;
            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;
            case 'exportRecord':
                ws.send(JSON.stringify({ type: 'recordData', record: this.exportRecord(), slot }));
                break;
            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg);
                break;
            case 'resetRoom':
                this.resetGame();
                break;
            case 'move': {
                if (!slot || !this._drainClockBeforeMove(slot)) return;
                const r = this._applyMoveCore(msg.fromRow, msg.fromCol, msg.toRow, msg.toCol, slot);
                if (!r.ok) {
                    ws.send(JSON.stringify({ type: 'error', message: r.selfCheck ? '该着法会送将。' : '该着法不合法。' }));
                    return;
                }
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'drop': {
                if (!slot || !this._drainClockBeforeMove(slot)) return;
                const r = this._applyDropCore(msg.material, msg.toRow, msg.toCol, slot);
                if (!r.ok) {
                    ws.send(JSON.stringify({ type: 'error', message: r.selfCheck ? '该打入会送将。' : '该打入不合法。' }));
                    return;
                }
                this._syncClockAfterTurnChange();
                this.broadcast({ type: 'broadcast', action: 'drop', ...this.getState(), showCheck: !!r.gaveCheck && !this.gameOver });
                break;
            }
            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                if (this.moveHistory.length === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                this.pendingUndo = { requester: slot, steps: 1 };
                const other = slot === 'player1' ? 'player2' : 'player1';
                const otherWs = this.room.getPlayerBySlot(other);
                if (!otherWs) { this._performUndo(1); return; }
                otherWs.send(JSON.stringify({ type: 'undoRequest', from: slot }));
                break;
            }
            case 'undoResponse': {
                if (!this.pendingUndo || slot !== this.pendingUndo.requester) return;
                const other = slot === 'player1' ? 'player2' : 'player1';
                if (slot === other) return;
                if (msg.accept) this._performUndo(this.pendingUndo.steps);
                else {
                    this.pendingUndo = null;
                    const w = this.room.getPlayerBySlot(slot);
                    if (w) w.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                break;
            }
            case 'resign': {
                if (!slot || this.gameOver) return;
                const winner = slot === 'player1' ? 'player2' : 'player1';
                this._endGame(winner, `${slot === 'player1' ? '白方' : '黑方'}认输，${winner === 'player1' ? '白胜' : '黑胜'}`);
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;
            }
            case 'requestNewGame': {
                if (!slot || !this.gameOver) return;
                this.resetToEmpty();
                this.broadcast({ type: 'newGameStarted', ...this.getState() });
                break;
            }
            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                this.pendingDraw = { requester: slot };
                const other = slot === 'player1' ? 'player2' : 'player1';
                const otherWs = this.room.getPlayerBySlot(other);
                if (!otherWs) return;
                otherWs.send(JSON.stringify({ type: 'drawRequest', from: slot }));
                break;
            }
            case 'drawResponse': {
                if (!this.pendingDraw || slot !== (this.pendingDraw.requester === 'player1' ? 'player2' : 'player1')) return;
                if (msg.accept) {
                    this.pendingDraw = null;
                    this._endGame('draw', '双方同意作和');
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = null;
                    const w = this.room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                    if (w) w.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                break;
            }
            default:
                break;
        }
    }

    _performUndo(steps) {
        for (let i = 0; i < steps && this.historySnaps.length; i++) {
            const snap = this.historySnaps.pop();
            this.historyBoards.pop();
            this.moveHistory.pop();
            this._restore(snap);
        }
        this.pendingUndo = null;
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this._syncClockAfterTurnChange();
        this.broadcast({ type: 'broadcast', action: 'undo', ...this.getState() });
    }

    _endGame(winnerSlot, resultText) {
        this.gameOver = true;
        this.winner = winnerSlot;
        this.recordResultText = resultText;
        this._stopClockTicker();
    }

    /**
     * 棋谱导入：清空后按记录逐步回放（含按记录回放加子），失败则复位并提示
     * 记录格式（与站内其它棋种一致）：走子 `W<fr>,<fc>-<tr>,<tc>`，打入 `WD<材料><tr>,<tc>`，
     *          打入 `W+<代号><tr>,<tc>`，融合/合并结果加 `=<结果代号>` 后缀，
     *          末尾 `;<材料代号>` 表示该手触发的驹台加子；代号一律大写、不靠大小写区分
     */
    importRecord(data, requesterWs) {
        const fail = (text, idx) => {
            this.resetToEmpty();
            if (requesterWs) {
                requesterWs.send(JSON.stringify({
                    type: 'error',
                    message: idx ? `棋谱回放失败：第${idx}手${text}` : text
                }));
            }
            this.broadcast({ type: 'roomReset', ...this.getState() });
        };
        if (!data || data.gameId !== 'hybrid-xiangqi') {
            fail('棋谱格式不匹配（需要融合象棋棋谱）。');
            return false;
        }
        this.resetToEmpty();
        const rawMoves = data.moves || [];
        for (let i = 0; i < rawMoves.length; i++) {
            const entry = rawMoves[i];
            let player = null, material = null, type = null;
            let fromRow = null, fromCol = null, toRow = null, toCol = null, grow, fuseTo = null;
            if (typeof entry === 'string') {
                let body = String(entry).trim();
                const gm = body.match(/;([A-Z]+)$/);
                if (gm) { grow = gm[1]; body = body.slice(0, gm.index); }
                const fm = body.match(/=([A-Z]+)$/);
                if (fm) { fuseTo = fm[1]; body = body.slice(0, fm.index); }   // 结果代号，全大写
                let m = body.match(/^([WB])\+([A-Z]+)(\d+),(\d+)$/);
                if (m) {
                    player = m[1] === 'B' ? 'player2' : 'player1';
                    material = m[2];
                    toRow = +m[3]; toCol = +m[4];
                } else {
                    m = body.match(/^([WB])(\d+),(\d+)-(\d+),(\d+)$/);
                    if (!m) { fail('格式错误。', i + 1); return false; }
                    player = m[1] === 'B' ? 'player2' : 'player1';
                    fromRow = +m[2]; fromCol = +m[3]; toRow = +m[4]; toCol = +m[5];
                }
            } else if (entry && typeof entry === 'object') {
                player = entry.player === 'player2' || entry.player === 'black' ? 'player2' : 'player1';
                if (entry.type === 'drop' || entry.material) {
                    material = entry.material;
                    toRow = entry.toRow; toCol = entry.toCol;
                } else {
                    type = entry.piece || null;
                    fromRow = entry.fromRow; fromCol = entry.fromCol;
                    toRow = entry.toRow; toCol = entry.toCol;
                }
                if (entry.grow !== undefined) grow = entry.grow || '';
            } else {
                fail('格式错误。', i + 1);
                return false;
            }
            const expect = this.sideToMove === 'white' ? 'player1' : 'player2';
            if (player !== expect) { fail('行棋方与局面不符。', i + 1); return false; }
            const opts = { grow };
            const r = material
                ? this._applyDropCore(material, toRow, toCol, player, opts)
                : this._applyMoveCore(fromRow, fromCol, toRow, toCol, player, opts);
            if (!r || !r.ok) { fail('着法非法。', i + 1); return false; }
            if (fuseTo) {
                const last = this.moveHistory[this.moveHistory.length - 1];
                const got = last && (last.merge || last.result) ? String(last.merge || last.result) : null;
                if (got !== fuseTo) { fail('融合结果与记录不符。', i + 1); return false; }
            }
            if (this.gameOver) break;
        }
        if (data.result && !this.gameOver) {
            this.gameOver = true;
            this.recordResultText = data.resultText || String(data.result);
            const rt = String(data.resultText || data.result);
            if (data.result === 'draw' || rt.includes('和')) this.winner = 'draw';
            else if (data.result === 'player1' || /白方|白胜/.test(rt)) this.winner = 'player1';
            else if (data.result === 'player2' || /黑方|黑胜/.test(rt)) this.winner = 'player2';
            else this.winner = data.result;
        }
        if (!this.matchStarted && this.moveHistory.length > 0) {
            this.matchStarted = true;
            this.tcSettings = this.tcSettings || { timed: false };
        }
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: { moves: this.exportRecord().moves, resultText: this.recordResultText }
        });
        return true;
    }

    exportRecord() {
        return {
            format: 'muzei',
            version: 2,
            gameType: '融合象棋',
            gameId: 'hybrid-xiangqi',
            boardRows: R.BOARD_H,
            boardCols: R.BOARD_W,
            // 与站内既有棋种同格式：走子 W1,4-3,4；打入 W+<代号>4,4；
            // 融合结果加 =<代号> 后缀（同国际象棋升变 =X）；;<代号> 表示该手触发的驹台加子
            moves: this.moveHistory.map((m) => {
                let s;
                if (m.type === 'drop') {
                    s = `${m.player === 'player1' ? 'W' : 'B'}+${m.material}${m.toRow},${m.toCol}`;
                    if (m.intoType) s += `=${m.result}`;
                } else {
                    s = `${m.player === 'player1' ? 'W' : 'B'}${m.fromRow},${m.fromCol}-${m.toRow},${m.toCol}`;
                    if (m.merge) s += `=${m.merge}`;
                }
                if (m.grow) s += `;${m.grow}`;
                return s;
            }),
            result: this.gameOver ? this.winner : null,
            timeControl: this.tcSettings ? {
                enabled: this.tcSettings.timed === true,
                mainMinutes: this.tcSettings.timed ? this.tcSettings.mainMinutes : 0,
                byoyomiSeconds: this.tcSettings.timed ? this.tcSettings.byoyomiSeconds : 0,
                maxTimeouts: this.tcSettings.timed ? this.tcSettings.maxTimeouts : 0
            } : null,
            resultText: this.recordResultText
        };
    }

    resetToEmpty() {
        this.board = R.createInitialBoard();
        this.hand = { white: R.createInitialHand(), black: R.createInitialHand() };
        this.turnCount = { white: 0, black: 0 };
        this.sideToMove = 'white';
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historySnaps = [];
        this.lastFrom = null;
        this.lastTo = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.winner = null;
        this.recordResultText = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.matchStarted = false;
        this.hostWs = null;
        this._stopClockTicker();
    }

    resetGame() {
        this.resetToEmpty();
        for (const [client, s] of this.room.players.entries()) {
            this.room.slotOccupancy.delete(s);
            this.room.players.delete(client);
            this.room.observers.add(client);
            client.send(JSON.stringify({ type: 'slotReleased', slot: s }));
        }
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player2: false, player1: false } });
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });
        if (slot) this.slotJoinedAt[slot] = null;
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
    }
}

/** 浏览器与服务器共用的规则对象（前端插件里有一份同样的拷贝） */
HybridXiangqiRoom.RULES = R;
HybridXiangqiRoom.sideFromSlot = R.sideOfSlot;
HybridXiangqiRoom.slotFromSide = R.slotOfSide;

module.exports = {
    HybridXiangqiRoom,
    RULES: R,
    sideFromSlot: R.sideOfSlot,
    slotFromSide: R.slotOfSide,
    initRoom(room) {
        room.gameLogic = new HybridXiangqiRoom(room);
        qiBoardSeatOverlay.install(room.gameLogic);
        room.maxPlayers = 2;
    }
};
