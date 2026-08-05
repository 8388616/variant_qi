/**
 * 乌克兰围棋前端 AI：
 * - 核心：若形势判断下「净目数收益」≤0（并扣掉落子手数惩罚），则不下，应虚着——填眼通常不增目甚至减目，会被挡掉。
 * - 生存/真眼等启发仍保留。
 * 全局：UkrainianWeiqiAI.chooseMove(ctx)，无满意着法时返回 null → 前端 pass。
 */
(function (global) {
    'use strict';

    const SHAPES = [
        [[-1, -1], [0, 0], [1, 1]],
        [[-1, -1], [-1, 0], [1, 1]],
        [[-1, -1], [0, 1], [1, -1]],
        [[-1, -1], [0, 1], [1, 0]],
        [[-1, -1], [1, -1], [-1, 1]]
    ];

    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const DIAGS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    function transformCoords(baseCoords, rot, flip) {
        return baseCoords.map(([dr, dc]) => {
            let r = dr, c = dc;
            for (let i = 0; i < rot; i++) { [r, c] = [-c, r]; }
            if (flip) c = -c;
            return [r, c];
        });
    }

    function generatePlacementCoords(shapeIdx, rot, flip, refRow, refCol) {
        const transformed = transformCoords(SHAPES[shapeIdx], rot, flip);
        return transformed.map(([dr, dc]) => [refRow + dr, refCol + dc]);
    }

    function boardToString(board) {
        return board.map(row => row.join(',')).join(';');
    }

    function copyBoard(board) {
        return board.map(row => row.slice());
    }

    function countStones(board, n) {
        let s = 0;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c]) s++;
        return s;
    }

    function countColor(board, n, color) {
        let s = 0;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c] === color) s++;
        return s;
    }

    /** 本手是否提掉对方子（用于允许必要的一口「紧气」） */
    function captureCount(boardBefore, boardAfter, n, opponentVal) {
        return countColor(boardBefore, n, opponentVal) - countColor(boardAfter, n, opponentVal);
    }

    /**
     * 正交方向无空点、无对方子（仅己方子或贴边）——封闭空点，多为眼位候选。
     */
    function fillsSealedOrthogonalEye(boardBefore, r, c, side, n) {
        if (boardBefore[r][c] !== 0) return false;
        for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            const v = boardBefore[nr][nc];
            if (v === 0) return false;
            if (v === 3 - side) return false;
        }
        return true;
    }

    /**
     * 入门教程中的「假眼」粗判：正交已被己方封住，但多个对角有对方子，
     * 该点往往仍可被破或尚非独立真眼，无提子时不按「填真眼」一律禁止。
     */
    function isLikelyFalseEye(board, r, c, side, n) {
        if (!fillsSealedOrthogonalEye(board, r, c, side, n)) return false;
        let oppDiag = 0;
        let inDiag = 0;
        for (const [dr, dc] of DIAGS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            inDiag++;
            if (board[nr][nc] === 3 - side) oppDiag++;
        }
        if (inDiag >= 3 && oppDiag >= 2) return true;
        if (inDiag === 2 && oppDiag >= 2) return true;
        return false;
    }

    /** 更可能是「真眼位」：正交封闭且不像典型假眼 */
    function isTrueEyePointDontFill(board, r, c, side, n) {
        return fillsSealedOrthogonalEye(board, r, c, side, n) && !isLikelyFalseEye(board, r, c, side, n);
    }

    /** 规则允许落子后，意图下的点必须仍为己方（防止「填无气点」被规则抹掉） */
    function intendedStonesSurvive(boardAfter, placedCells, side) {
        for (let i = 0; i < placedCells.length; i++) {
            const [r, c] = placedCells[i];
            if (boardAfter[r][c] !== side) return false;
        }
        return true;
    }

    /** 某连通块的所有气（空点坐标集合） */
    function collectLibertyCells(board, sr, sc, side, n) {
        const libs = new Set();
        const seen = new Set();
        const q = [[sr, sc]];
        const k0 = sr + ',' + sc;
        if (board[sr][sc] !== side) return libs;
        seen.add(k0);
        while (q.length) {
            const [r, c] = q.pop();
            for (const [dr, dc] of DIRS) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                const v = board[nr][nc];
                if (v === 0) {
                    libs.add(nr + ',' + nc);
                } else if (v === side) {
                    const kk = nr + ',' + nc;
                    if (!seen.has(kk)) {
                        seen.add(kk);
                        q.push([nr, nc]);
                    }
                }
            }
        }
        return libs;
    }

    /**
     * 与落子相关的己方块中，在「走完后棋盘」上统计：
     * 气点里有多少个看起来像「独立真眼位」（入门：两眼活棋，勿填自己的眼）。
     */
    function countTrueEyeLibertiesAmongGroup(boardAfter, placedCells, side, n) {
        const roots = new Set();
        const seenStone = new Set();
        for (let i = 0; i < placedCells.length; i++) {
            const [r, c] = placedCells[i];
            if (boardAfter[r][c] !== side) continue;
            const k = r + ',' + c;
            if (seenStone.has(k)) continue;
            markGroupKeys(boardAfter, n, r, c, side, seenStone);
            roots.add(k);
        }
        let eyeLib = 0;
        const counted = new Set();
        for (const key of roots) {
            const [r, c] = key.split(',').map(Number);
            const libSet = collectLibertyCells(boardAfter, r, c, side, n);
            for (const lk of libSet) {
                if (counted.has(lk)) continue;
                const [lr, lc] = lk.split(',').map(Number);
                if (isTrueEyePointDontFill(boardAfter, lr, lc, side, n)) {
                    counted.add(lk);
                    eyeLib++;
                }
            }
        }
        return eyeLib;
    }

    function markGroupKeys(board, n, sr, sc, color, seen) {
        const k0 = sr + ',' + sc;
        if (seen.has(k0)) return;
        const q = [[sr, sc]];
        seen.add(k0);
        while (q.length) {
            const [r, c] = q.pop();
            for (const [dr, dc] of DIRS) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
                if (board[nr][nc] !== color) continue;
                const kk = nr + ',' + nc;
                if (seen.has(kk)) continue;
                seen.add(kk);
                q.push([nr, nc]);
            }
        }
    }

    /**
     * 与本次落子相关的己方连通块中，气数的最小值（仅统计包含至少一个落子点的块）。
     */
    function minLibertyAmongPlacedGroups(boardAfter, placedCells, side, n, countGroupLiberties) {
        const groupRoots = new Set();
        const seenStone = new Set();
        for (const [r, c] of placedCells) {
            if (boardAfter[r][c] !== side) continue;
            const k = r + ',' + c;
            if (seenStone.has(k)) continue;
            markGroupKeys(boardAfter, n, r, c, side, seenStone);
            groupRoots.add(k);
        }
        let minL = 99;
        for (const key of groupRoots) {
            const [r, c] = key.split(',').map(Number);
            minL = Math.min(minL, countGroupLiberties(boardAfter, r, c));
        }
        return minL === 99 ? 99 : minL;
    }

    /**
     * strictEye: 禁填真眼位（含假眼粗分）
     * strictAtari: 无提子时相关块至少 2 气
     * requireMinLib3: 无提子时至少 3 气（第二阶段单步，防紧气自杀）
     * requireBreathingOrEyes: 无提子时若仅 2 气，须已有至少一眼形气（两眼活棋入门）
     */
    function movePassesSafety(boardBefore, boardAfter, placedCells, side, n, countGroupLiberties, caps, flags) {
        if (!intendedStonesSurvive(boardAfter, placedCells, side)) return false;

        const fe = flags.strictEye !== false;
        const fa = flags.strictAtari !== false;
        if (fe && caps === 0) {
            for (let i = 0; i < placedCells.length; i++) {
                const [r, c] = placedCells[i];
                if (boardBefore[r][c] !== 0) continue;
                if (isTrueEyePointDontFill(boardBefore, r, c, side, n)) return false;
            }
        }
        if (fa && caps === 0) {
            const minL = minLibertyAmongPlacedGroups(boardAfter, placedCells, side, n, countGroupLiberties);
            if (minL <= 1) return false;
            if (flags.requireMinLib3 && minL < 3) return false;
            if (flags.requireBreathingOrEyes && minL === 2) {
                const eyeL = countTrueEyeLibertiesAmongGroup(boardAfter, placedCells, side, n);
                if (eyeL < 1) return false;
            }
        }
        return true;
    }

    /** 己方弱棋惩罚（气越少惩罚越大），返回非负值 */
    function weakGroupPenalty(board, side, n, countGroupLiberties) {
        const seen = new Set();
        let pen = 0;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== side) continue;
                const k = r + ',' + c;
                if (seen.has(k)) continue;
                const L = countGroupLiberties(board, r, c);
                markGroupKeys(board, n, r, c, side, seen);
                if (L <= 1) pen += 6;
                else if (L === 2) pen += 2.5;
                else if (L === 3) pen += 0.8;
            }
        }
        return pen;
    }

    /** 做活倾向：己方总气（按块去重 liberty 较难，用块气之和近似） */
    function libertySumByGroups(board, side, n, countGroupLiberties) {
        const seen = new Set();
        let sum = 0;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (board[r][c] !== side) continue;
                const k = r + ',' + c;
                if (seen.has(k)) continue;
                sum += countGroupLiberties(board, r, c);
                markGroupKeys(board, n, r, c, side, seen);
            }
        }
        return sum;
    }

    function fastEval(board, boardSize, countGroupLiberties, side) {
        let blackStones = 0, whiteStones = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                const v = board[r][c];
                if (v === 1) blackStones++;
                else if (v === 2) whiteStones++;
            }
        }

        const KOMI_SCALE = 6.5;
        const material = (blackStones - whiteStones) * 1.05;

        const bLibSum = libertySumByGroups(board, 1, boardSize, countGroupLiberties);
        const wLibSum = libertySumByGroups(board, 2, boardSize, countGroupLiberties);
        const libSpread = (bLibSum - wLibSum) * 0.06;

        const bWeak = weakGroupPenalty(board, 1, boardSize, countGroupLiberties);
        const wWeak = weakGroupPenalty(board, 2, boardSize, countGroupLiberties);
        const shape = (wWeak - bWeak) * 1.15;

        const komiAdj = -KOMI_SCALE;
        const fromBlack = material + libSpread + shape + komiAdj;
        return side === 1 ? fromBlack : -fromBlack;
    }

    function estimateTerritoryLead(ctx, board, side) {
        if (!ctx.removeDeadAndDying || !ctx.assignTerritoryWithRange || !ctx.computeScore) return null;
        try {
            const live = ctx.removeDeadAndDying(copyBoard(board));
            const terr = ctx.assignTerritoryWithRange(live);
            const { blackTotal, whiteTotal } = ctx.computeScore(live, terr);
            const komi = ctx.komi != null ? Number(ctx.komi) : 3.25;
            const leadBlack = blackTotal - whiteTotal - 2 * komi;
            return side === 1 ? leadBlack : -leadBlack;
        } catch {
            return null;
        }
    }

    /** 相同目数下多落子应更差：每颗己方子一点惩罚（复合棋 3 子需更高目数增益才值得） */
    const STONE_TAX = 0.065;
    const TERRITORY_EPS = 0.02;

    /**
     * 着法是否「真正赚目」：形势 lead 的提升须超过噪声与手数税；填己方空/眼通常 Δ≤0 → false。
     * 有提子时略放宽（提子常显著改局面）。
     */
    function moveImprovesObjective(ctx, boardBefore, boardAfter, placedCells, side, n, countGroupLiberties) {
        const opp = 3 - side;
        const caps = captureCount(boardBefore, boardAfter, n, opp);
        const stonesAdded = Math.max(0, countColor(boardAfter, n, side) - countColor(boardBefore, n, side));
        const hurdle = TERRITORY_EPS + STONE_TAX * stonesAdded;

        const emptyBefore = n * n - countStones(boardBefore, n);
        if (emptyBefore > ((n * n * 0.88) | 0)) {
            if (caps > 0) return true;
            const l0 = estimateTerritoryLead(ctx, boardBefore, side);
            const l1 = estimateTerritoryLead(ctx, boardAfter, side);
            if (l0 != null && l1 != null && l1 - l0 > -0.035) return true;
            return fastEval(boardAfter, n, countGroupLiberties, side) > fastEval(boardBefore, n, countGroupLiberties, side) - 0.08;
        }

        const lead0 = estimateTerritoryLead(ctx, boardBefore, side);
        const lead1 = estimateTerritoryLead(ctx, boardAfter, side);
        if (lead0 != null && lead1 != null) {
            const delta = lead1 - lead0;
            if (caps > 0) return delta > -0.045 || delta > hurdle * 0.35;
            return delta > hurdle;
        }

        const ev0 = fastEval(boardBefore, n, countGroupLiberties, side);
        const ev1 = fastEval(boardAfter, n, countGroupLiberties, side);
        const feHurdle = 0.22 + 0.42 * stonesAdded;
        if (caps > 0) return ev1 - ev0 > -0.12;
        return ev1 - ev0 > feHurdle;
    }

    /** 用于排序：越大越倾向选择（形势 lead + 扣手数税） */
    function objectiveScoreAfter(ctx, boardBefore, boardAfter, side, n, countGroupLiberties) {
        const stonesAdded = Math.max(0, countColor(boardAfter, n, side) - countColor(boardBefore, n, side));
        const lead1 = estimateTerritoryLead(ctx, boardAfter, side);
        if (lead1 != null) {
            return lead1 - STONE_TAX * stonesAdded;
        }
        return fastEval(boardAfter, n, countGroupLiberties, side) - 0.45 * stonesAdded;
    }

    function interestingAnchors(board, boardSize) {
        const cand = new Set();
        let hasStone = false;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (board[r][c] === 0) continue;
                hasStone = true;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const rr = r + dr, cc = c + dc;
                        if (rr >= 0 && rr < boardSize && cc >= 0 && cc < boardSize)
                            cand.add(rr * boardSize + cc);
                    }
                }
            }
        }
        if (!hasStone) {
            const mid = (boardSize / 2) | 0;
            for (let dr = -3; dr <= 3; dr++) {
                for (let dc = -3; dc <= 3; dc++) {
                    const rr = mid + dr, cc = mid + dc;
                    if (rr >= 0 && rr < boardSize && cc >= 0 && cc < boardSize)
                        cand.add(rr * boardSize + cc);
                }
            }
        }
        return cand;
    }

    function openingBias(boardSize, coords, side) {
        const corners = [[3, 3], [3, boardSize - 4], [boardSize - 4, 3], [boardSize - 4, boardSize - 4]];
        const mid = (boardSize / 2) | 0;
        const set = new Set(coords.map(([r, c]) => r + ',' + c));
        let b = 0;
        for (const [r, c] of corners) if (set.has(r + ',' + c)) b += 0.35;
        if (set.has(mid + ',' + mid)) b += 0.25;
        return b * (side === 1 ? 1 : -1);
    }

    function chooseSingleStoneMove(ctx) {
        const {
            board,
            boardSize,
            currentPlayer,
            historySet,
            tryPlaceStonesAt,
            countGroupLiberties
        } = ctx;
        if (!tryPlaceStonesAt) return null;
        const rootSide = currentPlayer === 1 ? 1 : 2;
        const opp = 3 - rootSide;
        const hist = historySet instanceof Set ? historySet : new Set(historySet || []);
        const anchors = interestingAnchors(board, boardSize);
        const brd = board.map(row => row.slice());

        function collect(mode) {
            const f = mode === 'strict'
                ? { strictEye: true, strictAtari: true, requireMinLib3: true, requireBreathingOrEyes: true }
                : mode === 'relaxEye'
                    ? { strictEye: false, strictAtari: true, requireMinLib3: true, requireBreathingOrEyes: true }
                    : mode === 'relaxLib'
                        ? { strictEye: false, strictAtari: true, requireMinLib3: false, requireBreathingOrEyes: false }
                        : { strictEye: false, strictAtari: false, requireMinLib3: false, requireBreathingOrEyes: false };
            const out = [];
            for (const idx of anchors) {
                const row = (idx / boardSize) | 0;
                const col = idx % boardSize;
                const nb = tryPlaceStonesAt(brd.map(r => r.slice()), [[row, col]], rootSide);
                if (!nb) continue;
                const ns = boardToString(nb);
                if (hist.has(ns)) continue;
                const caps = captureCount(brd, nb, boardSize, opp);
                if (!movePassesSafety(brd, nb, [[row, col]], rootSide, boardSize, countGroupLiberties, caps, f)) continue;
                out.push({
                    row,
                    col,
                    _nb: nb,
                    s: fastEval(nb, boardSize, countGroupLiberties, rootSide)
                });
            }
            return out;
        }

        function worthFilter(list) {
            return list.filter((x) =>
                moveImprovesObjective(ctx, brd, x._nb, [[x.row, x.col]], rootSide, boardSize, countGroupLiberties));
        }

        let scored = worthFilter(collect('strict'));
        if (scored.length === 0) scored = worthFilter(collect('relaxEye'));
        if (scored.length === 0) scored = worthFilter(collect('relaxLib'));
        if (scored.length === 0) scored = worthFilter(collect('relaxAll'));
        if (scored.length === 0) return null;

        scored.forEach((x) => {
            x._obj = objectiveScoreAfter(ctx, brd, x._nb, rootSide, boardSize, countGroupLiberties);
        });
        scored.sort((a, b) => b._obj - a._obj);

        const pick = scored[0];
        if (!moveImprovesObjective(ctx, brd, pick._nb, [[pick.row, pick.col]], rootSide, boardSize, countGroupLiberties))
            return null;

        return { singleStone: true, row: pick.row, col: pick.col };
    }

    function genMovesRaw(brd, side, lb, lw, hset, tryPlaceShape, boardSize, anchorsOnly) {
        const out = [];
        const seen = new Set();
        const anchors = anchorsOnly || interestingAnchors(brd, boardSize);
        const lastUsed = side === 1 ? lb : lw;

        for (const idx of anchors) {
            const refRow = (idx / boardSize) | 0;
            const refCol = idx % boardSize;
            for (let si = 0; si < SHAPES.length; si++) {
                if (si === lastUsed) continue;
                for (let rot = 0; rot < 4; rot++) {
                    for (let flip = 0; flip < 2; flip++) {
                        const nb = tryPlaceShape(brd, si, rot, !!flip, refRow, refCol, side);
                        if (!nb) continue;
                        const ns = boardToString(nb);
                        if (hset.has(ns)) continue;
                        const coords = generatePlacementCoords(si, rot, !!flip, refRow, refCol);
                        const mk = coords.map(([r, c]) => r + ',' + c).sort().join(';');
                        if (seen.has(mk)) continue;
                        seen.add(mk);
                        out.push({
                            shapeIndex: si, rotation: rot, flipped: !!flip,
                            row: refRow, col: refCol, _nb: nb, _ns: ns, _coords: coords
                        });
                    }
                }
            }
        }
        return out;
    }

    function filterMovesBySafety(brd, moves, side, boardSize, countGroupLiberties, flags) {
        const opp = 3 - side;
        const out = [];
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const caps = captureCount(brd, m._nb, boardSize, opp);
            if (!movePassesSafety(brd, m._nb, m._coords, side, boardSize, countGroupLiberties, caps, flags)) continue;
            out.push(m);
        }
        return out;
    }

    function chooseMove(ctx) {
        if (ctx.normalGoPhase) {
            return chooseSingleStoneMove(ctx);
        }
        const {
            board,
            boardSize,
            currentPlayer,
            lastUsedShapeByColor,
            historySet,
            tryPlaceShape,
            countGroupLiberties
        } = ctx;

        const rootSide = currentPlayer === 1 ? 1 : 2;
        const lastB = lastUsedShapeByColor[1];
        const lastW = lastUsedShapeByColor[2];
        const hist = historySet instanceof Set ? historySet : new Set(historySet || []);

        const DEPTH = 2;
        const MAX_ROOT = 32;
        const MAX_PLY1 = 24;
        const QCAP = 12;
        const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 520;

        function timeUp() {
            return (typeof performance !== 'undefined' ? performance.now() : Date.now()) > deadline;
        }

        function evalForMover(brd, side) {
            return fastEval(brd, boardSize, countGroupLiberties, side);
        }

        function genMoves(brd, side, lb, lw, hset, anchorsOnly, safety) {
            const raw = genMovesRaw(brd, side, lb, lw, hset, tryPlaceShape, boardSize, anchorsOnly);
            const fStrict = {
                strictEye: true,
                strictAtari: true,
                requireMinLib3: false,
                requireBreathingOrEyes: true
            };
            const fRelaxEye = {
                strictEye: false,
                strictAtari: true,
                requireMinLib3: false,
                requireBreathingOrEyes: true
            };
            const fRelaxBreath = {
                strictEye: false,
                strictAtari: true,
                requireMinLib3: false,
                requireBreathingOrEyes: false
            };
            const fAll = {
                strictEye: false,
                strictAtari: false,
                requireMinLib3: false,
                requireBreathingOrEyes: false
            };
            let moves = filterMovesBySafety(brd, raw, side, boardSize, countGroupLiberties,
                safety === 'strict' ? fStrict : safety === 'relaxEye' ? fRelaxEye : safety === 'relaxBreath' ? fRelaxBreath : fAll);
            if (moves.length === 0 && safety === 'strict') {
                moves = filterMovesBySafety(brd, raw, side, boardSize, countGroupLiberties, fRelaxEye);
            }
            if (moves.length === 0 && safety === 'strict') {
                moves = filterMovesBySafety(brd, raw, side, boardSize, countGroupLiberties, fRelaxBreath);
            }
            if (moves.length === 0) {
                moves = filterMovesBySafety(brd, raw, side, boardSize, countGroupLiberties, fAll);
            }
            return moves;
        }

        function sortMoves(moves, brd, side, lb, lw, hset, cap) {
            const opp = 3 - side;
            const scored = moves.map(m => {
                const nb = m._nb;
                const h = -evalForMover(nb, 3 - side);
                const capN = countStones(brd, boardSize) - countStones(nb, boardSize);
                const ob = openingBias(boardSize, m._coords, side);
                const minL = minLibertyAmongPlacedGroups(nb, m._coords, side, boardSize, countGroupLiberties);
                const eyeL = countTrueEyeLibertiesAmongGroup(nb, m._coords, side, boardSize);
                let lifeBoost = minL >= 4 ? 0.35 : (minL >= 3 ? 0.18 : 0);
                lifeBoost += eyeL * 0.55;
                if (minL >= 3 && eyeL >= 2) lifeBoost += 0.5;
                return { m, s: h + capN * 2.6 + ob + lifeBoost };
            });
            scored.sort((a, b) => b.s - a.s);
            return scored.slice(0, cap).map(x => x.m);
        }

        function quiescence(brd, alpha, beta, side, lb, lw, hset, depthQ) {
            if (timeUp()) return evalForMover(brd, side);
            let stand = evalForMover(brd, side);
            let best = stand;
            if (best >= beta) return best;
            if (alpha < best) alpha = best;
            if (depthQ <= 0) return best;

            const moves = sortMoves(genMoves(brd, side, lb, lw, hset, null, 'strict'), brd, side, lb, lw, hset, QCAP);
            for (const mv of moves) {
                if (countStones(mv._nb, boardSize) >= countStones(brd, boardSize)) continue;
                const nlb = side === 1 ? mv.shapeIndex : lb;
                const nlw = side === 2 ? mv.shapeIndex : lw;
                const ch = new Set(hset);
                ch.add(mv._ns);
                const val = -quiescence(mv._nb, -beta, -alpha, 3 - side, nlb, nlw, ch, depthQ - 1);
                if (val > best) best = val;
                if (best >= beta) return best;
                if (alpha < best) alpha = best;
            }
            return best;
        }

        function negamax(depth, alpha, beta, brd, side, lb, lw, hset) {
            if (timeUp()) return evalForMover(brd, side);

            if (depth === 0) {
                return quiescence(brd, alpha, beta, side, lb, lw, hset, 3);
            }

            let moves;
            if (depth === DEPTH) {
                moves = sortMoves(valuableRoot, brd, side, lb, lw, hset, MAX_ROOT);
            } else {
                moves = genMoves(brd, side, lb, lw, hset, null, 'strict');
                if (moves.length === 0) return evalForMover(brd, side);
                const cap = depth > 1 ? MAX_ROOT : MAX_PLY1;
                moves = sortMoves(moves, brd, side, lb, lw, hset, cap);
            }
            if (moves.length === 0) return evalForMover(brd, side);

            let best = -Infinity;
            let bestMv = null;
            for (const mv of moves) {
                const nlb = side === 1 ? mv.shapeIndex : lb;
                const nlw = side === 2 ? mv.shapeIndex : lw;
                const ch = new Set(hset);
                ch.add(mv._ns);
                const sc = -negamax(depth - 1, -beta, -alpha, mv._nb, 3 - side, nlb, nlw, ch);
                if (sc > best) {
                    best = sc;
                    bestMv = mv;
                }
                if (best > alpha) alpha = best;
                if (alpha >= beta) break;
            }
            if (depth === DEPTH) negamax._lastBest = bestMv;
            return best;
        }

        const rootBoard = board.map(row => row.slice());
        const rootStrict = genMoves(rootBoard, rootSide, lastB, lastW, hist, null, 'strict');
        const valuableRoot = rootStrict.filter((m) =>
            moveImprovesObjective(ctx, rootBoard, m._nb, m._coords, rootSide, boardSize, countGroupLiberties));
        if (valuableRoot.length === 0) return null;

        negamax._lastBest = null;
        negamax(DEPTH, -1e9, 1e9, rootBoard, rootSide, lastB, lastW, hist);

        let pick = negamax._lastBest;
        if (!pick || !moveImprovesObjective(ctx, rootBoard, pick._nb, pick._coords, rootSide, boardSize, countGroupLiberties)) {
            let bestObj = -Infinity;
            let bestM = null;
            for (let i = 0; i < valuableRoot.length; i++) {
                const m = valuableRoot[i];
                if (!moveImprovesObjective(ctx, rootBoard, m._nb, m._coords, rootSide, boardSize, countGroupLiberties)) continue;
                const o = objectiveScoreAfter(ctx, rootBoard, m._nb, rootSide, boardSize, countGroupLiberties);
                if (o > bestObj) {
                    bestObj = o;
                    bestM = m;
                }
            }
            pick = bestM;
        }
        if (!pick) return null;

        const candidates = valuableRoot.filter((m) =>
            moveImprovesObjective(ctx, rootBoard, m._nb, m._coords, rootSide, boardSize, countGroupLiberties));
        let bestPick = pick;
        let bestO = objectiveScoreAfter(ctx, rootBoard, pick._nb, rootSide, boardSize, countGroupLiberties);
        for (let i = 0; i < candidates.length; i++) {
            const m = candidates[i];
            const o = objectiveScoreAfter(ctx, rootBoard, m._nb, rootSide, boardSize, countGroupLiberties);
            if (o > bestO) {
                bestO = o;
                bestPick = m;
            }
        }
        pick = bestPick;

        if (!moveImprovesObjective(ctx, rootBoard, pick._nb, pick._coords, rootSide, boardSize, countGroupLiberties))
            return null;

        return {
            shapeIndex: pick.shapeIndex,
            rotation: pick.rotation,
            flipped: pick.flipped,
            row: pick.row,
            col: pick.col
        };
    }

    global.UkrainianWeiqiAI = { chooseMove: chooseMove };
})(typeof window !== 'undefined' ? window : globalThis);
