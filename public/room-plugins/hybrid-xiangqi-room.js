window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins["hybrid-xiangqi"] = {
    shell: {
        "title": "融合象棋",
        "rulesHtml": "吃掉对方的旗/將/帥/王即获胜。<br /><br />"
			+ "可以将驹台的棋子打入到棋盘上的空格，或打入到棋子上以融合；也可以将己方的棋子走到另一枚棋子上融合。<br /><br />"
			+ "每3回合驹台随机增加一枚士、卒或包。吃掉对方的棋子可以将其分解后放入驹台。<br /><br />"
			
			+ "<strong>旗</strong>：基础棋子，不可移动。<br />"
			+ "<strong>士</strong>：基础棋子，斜向移动一格。<br />"
			+ "<strong>卒</strong>：基础棋子，直向移动一格。<br />"
			+ "<strong>包</strong>：基础棋子，不可单独出现在棋盘上，只能融合。<br /><br />"

			+ "<strong>帥</strong>：旗+士，移动方式同士。<br />"
			+ "<strong>將</strong>：旗+卒，移动方式同卒。<br />"
			+ "<strong>象</strong>：士+士，斜向移动两格，路径上不能有其它棋子。<br />"
			+ "<strong>馬</strong>：士+卒，先直向移动一格，再斜着沿远离的方向移动一格，路径上不能有其它棋子。<br />"
			+ "<strong>兵</strong>：卒+卒，直向移动两格，路径上不能有其它棋子。<br />"
			+ "<strong>砲</strong>：包+士，斜向移动任意格，路径上不能有其它棋子；吃子时需隔一子吃。<br />"
			+ "<strong>軳</strong>：包+卒，直向移动任意格，路径上不能有其它棋子；吃子时需隔一子吃。<br /><br />"

			+ "<strong>王</strong>：旗+士+卒，直向或斜向移动一格。<br />"
			+ "<strong>撫</strong>：3士，斜向移动任意格，路径上不能有其它棋子。<br />"
			+ "<strong>卫</strong>：2士+卒，按士或馬的方式移动。<br />"
			+ "<strong>騎</strong>：士+2卒，移动到横纵坐标分别差1和2的格内。<br />"
			+ "<strong>車</strong>：3卒，直向移动任意格，路径上不能有其它棋子。<br />"
			+ "<strong>驍</strong>：士+卒+包，沿馬的方向走任意步，路径上不能有其它棋子，但是吃子时需隔一子吃。<br /><br />"

			+ "<strong>驡</strong>：3士+卒，斜向移动任意格或直向移动一格，路径上不能有其它棋子。<br />"
			+ "<strong>驥</strong>：2士+2卒，沿馬的方向走任意步，路径上不能有其它棋子。<br />"
			+ "<strong>龍</strong>：士+3卒，直向移动任意格或斜向移动一格，路径上不能有其它棋子。<br />"
			+ "<strong>炮</strong>：士+卒+2包，按砲或軳的方式移动。<br /><br />"
			
			+ "<strong>督</strong>：4士+2卒，按騎或撫的方式移动。<br />"
			+ "<strong>后</strong>：3士+3卒，按騎或車的方式移动。<br />"
			+ "<strong>相</strong>：士+5卒，按撫或車的方式移动。<br /><br />",
        "defaultKomiText": "白先",
        "boardSizeMin": 9,
        "boardSizeMax": 9,
        "defaultBoardSize": 9,
        "minLib": 1,
        "recordDownloadPrefix": "融合象棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "xiangqi": true,
            "chess": true,
            "hideBoardSize": true,
            "dyeingBags": true,
            "shogiBags": true
        },
        "editTools": []
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "融合象棋";

        (function () {
            /* ================= 规则（与 games/hybrid-xiangqi.js 的服务端副本一致） ================= */
            const BOARD_W = 9, BOARD_H = 9;
            const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
            const ALL8 = ORTH.concat(DIAG);
            const KNIGHT_OFFSETS = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

            /* move 名一律以 Move 结尾，与 kind 分属两套名字（见 games/hybrid-xiangqi.js 的棋子表注释） */
            const PIECES = {
                S: { name: '士', comp: { S: 1 }, move: 'stepMove', dirs: DIAG, kind: 'scholar' },
                Z: { name: '卒', comp: { Z: 1 }, move: 'stepMove', dirs: ORTH, kind: 'pawn' },
                BA: { name: '包', comp: { BA: 1 }, move: 'noneMove', kind: 'bundle' },
                Q: { name: '旗', comp: { Q: 1 }, move: 'noneMove', royal: true, kind: 'flag' },
                X: { name: '象', comp: { S: 2 }, move: 'leap2Move', dirs: DIAG, kind: 'elephant' },
                M: { name: '馬', comp: { S: 1, Z: 1 }, move: 'knightMove', leg: true, kind: 'horse' },
                XI: { name: '驍', comp: { S: 1, Z: 1, BA: 1 }, move: 'cannonKnightMove', kind: 'xiao' },
                P: { name: '兵', comp: { Z: 2 }, move: 'leap2Move', dirs: ORTH, kind: 'soldier' },
                WE: { name: '卫', comp: { S: 2, Z: 1 }, move: 'stepKnightMove', dirs: DIAG, leg: true, kind: 'guard' },
                DZ: { name: '督', comp: { S: 4, Z: 2 }, move: 'slideKnightMove', dirs: DIAG, kind: 'archbishop' },
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
            const COMP_ORDER = ['Q', 'S', 'Z', 'BA'];
            function compKey(comp) { return COMP_ORDER.map((k) => comp[k] || 0).join(''); }
            const FUSION = Object.create(null);
            for (const t of Object.keys(PIECES)) FUSION[compKey(PIECES[t].comp)] = t;
            function fuseType(comp, material) {
                const c = Object.assign({}, comp);
                c[material] = (c[material] || 0) + 1;
                return FUSION[compKey(c)] || null;
            }
            /** 两枚棋子组成相加 → 棋子类型（走上去合并） */
            function fuseComps(a, b) {
                const c = {};
                for (const k of COMP_ORDER) c[k] = (a[k] || 0) + (b[k] || 0);
                return FUSION[compKey(c)] || null;
            }
            function materialList(comp) {
                const out = [];
                for (const k of ['S', 'Z', 'BA']) for (let i = 0; i < (comp[k] || 0); i++) out.push(k);
                return out;
            }
            /** 初始局面（与服务端一致）：底线偶数格士、正中旗；倒数第二行 1/3/7/9 卒、正中士 */
            function createInitialBoard() {
                const b = emptyBoard();
                const back = [0, BOARD_H - 1];
                const front = [1, BOARD_H - 2];
                const chars = ['w', 'b'];
                for (let i = 0; i < 2; i++) {
                    for (const c of [1, 3, 5, 7]) b[back[i]][c] = chars[i] + 'S';
                    b[back[i]][4] = chars[i] + 'Q';
                    for (const c of [0, 2, 6, 8]) b[front[i]][c] = chars[i] + 'Z';
                    b[front[i]][4] = chars[i] + 'S';
                }
                return b;
            }
            function createInitialHand() { return { S: 0, Z: 0, BA: 0 }; }
            const inBounds = (r, c) => r >= 0 && r < BOARD_H && c >= 0 && c < BOARD_W;
            const sideOfCode = (code) => (code ? (code[0] === 'w' ? 'white' : 'black') : null);
            const typeOf = (code) => (code ? code.slice(1) : null);
            const isRoyal = (code) => { const t = typeOf(code); return !!(t && PIECES[t] && PIECES[t].royal); };
            const sideOfSlot = (slot) => (slot === 'player1' ? 'white' : 'black');
            const slotOfSide = (side) => (side === 'white' ? 'player1' : 'player2');
            const oppositeSide = (side) => (side === 'white' ? 'black' : 'white');
            const copyBoard = (b) => b.map((r) => r.slice());
            const emptyBoard = () => Array.from({ length: BOARD_H }, () => new Array(BOARD_W).fill(''));

            function genPieceMoves(board, row, col) {
                const code = board[row] && board[row][col];
                if (!code) return [];
                const def = PIECES[typeOf(code)];
                if (!def || def.move === 'noneMove') return [];
                const side = sideOfCode(code);
                const out = [];
                const at = (r, c) => (inBounds(r, c) ? board[r][c] : undefined);
                const push = (r, c) => {
                    const v = at(r, c);
                    if (v === undefined) return false;
                    if (!v) { out.push({ row: r, col: c, capture: false }); return true; }
                    if (sideOfCode(v) !== side) { out.push({ row: r, col: c, capture: true }); return false; }
                    const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
                    if (merged) out.push({ row: r, col: c, capture: false, merge: merged });
                    return false;
                };
                const slide = (dirs) => {
                    for (const [dr, dc] of dirs) { let r = row + dr, c = col + dc; while (push(r, c)) { r += dr; c += dc; } }
                };
                const step = (dirs) => { for (const [dr, dc] of dirs) push(row + dr, col + dc); };
                const leap2 = (dirs) => {
                    for (const [dr, dc] of dirs) {
                        if (!inBounds(row + dr, col + dc) || board[row + dr][col + dc]) continue;
                        push(row + 2 * dr, col + 2 * dc);
                    }
                };
                const knight = () => {
                    for (const [dr, dc] of KNIGHT_OFFSETS) {
                        if (def.leg) {
                            const lr = row + (Math.abs(dr) === 2 ? dr / 2 : 0);
                            const lc = col + (Math.abs(dc) === 2 ? dc / 2 : 0);
                            if (!inBounds(lr, lc) || board[lr][lc]) continue;
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
                            if (!inBounds(legR, legC) || board[legR][legC]) break;
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
                                break;
                            }
                            r = nr; c = nc;
                        }
                    }
                };

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
                                    // 炮架前的第一枚棋子：己方且有配方 → 按正常走法走上去融合（吃子仍须隔炮架）
                                    if (sideOfCode(v) === side) {
                                        const merged = fuseComps(def.comp, PIECES[typeOf(v)].comp);
                                        if (merged) out.push({ row: r, col: c, capture: false, merge: merged });
                                    }
                                    screen = true;
                                }
                            }
                            else if (v) { if (sideOfCode(v) !== side) out.push({ row: r, col: c, capture: true }); break; }
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
            function findMove(board, fromRow, fromCol, toRow, toCol) {
                if (!inBounds(fromRow, fromCol) || !inBounds(toRow, toCol)) return null;
                for (const m of genPieceMoves(board, fromRow, fromCol)) {
                    if (m.row === toRow && m.col === toCol) return m;
                }
                return null;
            }
            function codeOf(side, t) { return (side === 'white' ? 'w' : 'b') + t; }

            /** 在棋盘副本上执行一步（含走上去合并）——送将预判用 */
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
            function applyDropToBoard(board, side, toRow, toCol, resultType) {
                const next = copyBoard(board);
                next[toRow][toCol] = codeOf(side, resultType);
                return next;
            }
            function findRoyal(board, side) {
                for (let r = 0; r < BOARD_H; r++) {
                    for (let c = 0; c < BOARD_W; c++) {
                        const code = board[r][c];
                        if (code && sideOfCode(code) === side && isRoyal(code)) return { row: r, col: c, code };
                    }
                }
                return null;
            }
            /** 某方皇棋（旗/將/帥/王）是否正被对方攻击 */
            function isRoyalAttacked(board, side) {
                const royal = findRoyal(board, side);
                if (!royal) return true;
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
            /** 合法走法：剔除走后己方皇棋被吃的着法（不能送将） */
            function legalMovesFrom(board, row, col) {
                const code = board[row] && board[row][col];
                if (!code) return [];
                const side = sideOfCode(code);
                return genPieceMoves(board, row, col).filter((m) =>
                    !isRoyalAttacked(applyMoveToBoard(board, row, col, m.row, m.col, m), side));
            }
            /** 打入是否合法：空格可落（包除外）、己方棋子可融合，且不能送将 */
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

            /* ===== 棋子符号库（单色矢量，内联以便插件单文件部署） =====
             * 坐标盒 100×120，地面 y=108；线宽：主轮廓 5、细节 3、实体附件 7。
             * drawSymbol(ctx, kind, cx, cy, size, color) */
            const QiSymbols = window;
    (function (global) {
        const W = 100, H = 120, G = 108, CX = 50;
        const LW = 7, DETAIL = 4.2, SOLID = 9.5;

        function line(ctx, x1, y1, x2, y2, w) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = w || DETAIL;
            ctx.stroke();
        }
        function curve(ctx, x1, y1, cx1, cy1, cx2, cy2, x2, y2, w) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
            ctx.lineWidth = w || DETAIL;
            ctx.stroke();
        }
        function quad(ctx, x1, y1, cx, cy, x2, y2, w) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo(cx, cy, x2, y2);
            ctx.lineWidth = w || DETAIL;
            ctx.stroke();
        }
        function dot(ctx, x, y, r) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        function ring(ctx, x, y, r, w) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.lineWidth = w || DETAIL;
            ctx.stroke();
        }
        function poly(ctx, pts, close, w) {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            if (close !== false) ctx.closePath();
            ctx.lineWidth = w || LW;
            ctx.stroke();
        }
        function path(ctx, d, w) {
            ctx.beginPath();
            d(ctx);
            ctx.lineWidth = w || LW;
            ctx.stroke();
        }

        const SYMBOLS = {
            /* 車：城垛塔 */
            rook(ctx) {
                path(ctx, (c) => {
                    c.moveTo(28, G); c.lineTo(25, 48); c.lineTo(15, 48); c.lineTo(15, 26);
                    c.lineTo(30, 26); c.lineTo(30, 12); c.lineTo(43, 12); c.lineTo(43, 26);
                    c.lineTo(57, 26); c.lineTo(57, 12); c.lineTo(70, 12); c.lineTo(70, 26);
                    c.lineTo(85, 26); c.lineTo(85, 48); c.lineTo(75, 48); c.lineTo(72, G);
                });
                line(ctx, 25, 60, 75, 60);
                line(ctx, 27, 78, 73, 78);
            },

            /* 馬：中式馬头（圆颅、长鬃、笼头） */
            horse(ctx) {
                path(ctx, (c) => {
                    c.moveTo(30, G); c.lineTo(32, 78);
                    c.quadraticCurveTo(20, 70, 16, 58);
                    c.lineTo(14, 50);
                    c.quadraticCurveTo(24, 42, 32, 40);
                    c.lineTo(40, 28);
                    c.lineTo(44, 12); c.lineTo(50, 22); c.lineTo(56, 12); c.lineTo(61, 26);
                    c.quadraticCurveTo(72, 36, 75, 56);
                    c.lineTo(78, 82); c.lineTo(76, G);
                });
                dot(ctx, 34, 40, 3.2);
                dot(ctx, 20, 54, 2.4);
                curve(ctx, 58, 26, 68, 42, 72, 62, 70, 86, SOLID);
                line(ctx, 17, 52, 33, 42);
            },

            /* 象：正面象头（双大耳紧贴头侧 + 粗鼻垂地） */
            elephant(ctx) {
                ctx.beginPath();
                ctx.ellipse(28, 58, 14, 23, -0.20, 0, Math.PI * 2);
                ctx.lineWidth = LW;
                ctx.stroke();
                ctx.beginPath();
                ctx.ellipse(72, 58, 14, 23, 0.20, 0, Math.PI * 2);
                ctx.lineWidth = LW;
                ctx.stroke();
                path(ctx, (c) => {                       // 头（宽钟形）
                    c.moveTo(34, 86);
                    c.quadraticCurveTo(32, 14, 50, 12);
                    c.quadraticCurveTo(68, 14, 66, 86);
                });
                quad(ctx, 52, 78, 50, 92, 46, 100, 10);  // 鼻
                quad(ctx, 46, 100, 42, 108, 33, 105, 10);
                dot(ctx, 41, 46, 3);
                dot(ctx, 59, 46, 3);
            },

            /* 士：盾（斜带 —— 士走斜线） */
            scholar(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, 12); c.lineTo(76, 12); c.lineTo(76, 52);
                    c.quadraticCurveTo(76, 88, 50, 106);
                    c.quadraticCurveTo(24, 88, 24, 52);
                    c.closePath();
                });
                line(ctx, 33, 88, 67, 26, SOLID);
                dot(ctx, 33, 88, 3);
                dot(ctx, 67, 26, 3);
            },

            /* 將：帥盔（盔沿 + 护颈 + 顶缨） */
            general(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, G); c.lineTo(26, 80); c.lineTo(14, 74);
                    c.quadraticCurveTo(18, 30, 50, 26);
                    c.quadraticCurveTo(82, 30, 86, 74);
                    c.lineTo(74, 80); c.lineTo(76, G);
                });
                line(ctx, 20, 58, 80, 58);
                line(ctx, 50, 26, 50, 12, SOLID);
                dot(ctx, 50, 9, 4.5);
                quad(ctx, 53, 18, 70, 16, 62, 28, SOLID);
                dot(ctx, 40, 68, 3);
                dot(ctx, 60, 68, 3);
            },

            /* 旗：帥旗（旗杆 + 燕尾旗）—— 本棋种的「旗」，不可移动、被吃即负 */
            flag(ctx) {
                line(ctx, 44, 6, 44, G, SOLID);
                poly(ctx, [[44, 4], [38, 16], [50, 16]], true, DETAIL);
                path(ctx, (c) => {
                    c.moveTo(44, 22); c.lineTo(88, 22); c.lineTo(74, 38);
                    c.lineTo(88, 54); c.lineTo(44, 54); c.closePath();
                });
                line(ctx, 52, 34, 74, 34);
                dot(ctx, 44, G, 4.5);
            },

            /* 帥：节钺（长柄双刃斧）—— 与「將」的盔互为对偶，且不同于「旗」 */
            marshal(ctx) {
                line(ctx, 50, 14, 50, G, SOLID);
                dot(ctx, 50, G, 4.5);
                poly(ctx, [[50, 4], [43, 20], [57, 20]], true, DETAIL);
                path(ctx, (c) => {                       // 左刃
                    c.moveTo(50, 24);
                    c.bezierCurveTo(30, 26, 16, 38, 18, 52);
                    c.bezierCurveTo(30, 44, 40, 42, 50, 42);
                    c.closePath();
                });
                path(ctx, (c) => {                       // 右刃
                    c.moveTo(50, 24);
                    c.bezierCurveTo(70, 26, 84, 38, 82, 52);
                    c.bezierCurveTo(70, 44, 60, 42, 50, 42);
                    c.closePath();
                });
                line(ctx, 34, 72, 66, 72);
                line(ctx, 34, 84, 66, 84);
            },

            /* 兵：戴盔持矛（长矛竖直） */
            soldier(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, G); c.quadraticCurveTo(28, 64, 44, 56);
                    c.lineTo(52, 54); c.quadraticCurveTo(62, 62, 64, G);
                });
                path(ctx, (c) => {                       // 头盔 + 小顶缨
                    c.moveTo(36, 42); c.quadraticCurveTo(36, 20, 48, 20);
                    c.quadraticCurveTo(60, 20, 60, 42); c.closePath();
                });
                line(ctx, 33, 42, 63, 42);
                line(ctx, 48, 20, 48, 11);
                dot(ctx, 48, 9, 3);
                line(ctx, 72, 10, 72, G, SOLID);
                poly(ctx, [[72, 5], [66, 18], [78, 18]], true, DETAIL);
                line(ctx, 64, 80, 82, 80);
            },

            /* 卒：无盔持刀（立式长方盾 + 斜举弯刀） */
            pawn(ctx) {
                path(ctx, (c) => {
                    c.moveTo(34, G); c.quadraticCurveTo(36, 64, 52, 56);
                    c.lineTo(60, 54); c.quadraticCurveTo(70, 62, 74, G);
                });
                ring(ctx, 52, 34, 12, LW);               // 头（无盔）
                path(ctx, (c) => {                       // 长方盾立在身前
                    c.moveTo(20, 50); c.lineTo(40, 50); c.lineTo(40, 96); c.lineTo(20, 96);
                    c.closePath();
                });
                line(ctx, 30, 50, 30, 96);
                curve(ctx, 62, 92, 58, 58, 66, 28, 84, 12, SOLID);   // 弯刀
                line(ctx, 66, 30, 78, 40);
                line(ctx, 56, 84, 66, 94);
            },

            knight(ctx) {
                path(ctx, (c) => {
                    c.moveTo(26, 108);                       // 颈后下方
                    c.lineTo(34, 74);
                    c.quadraticCurveTo(38, 60, 30, 52);      // 颈前
                    c.lineTo(16, 46); c.lineTo(20, 32);      // 鼻梁 → 鼻尖
                    c.lineTo(38, 28);                        // 额
                    c.lineTo(42, 10); c.lineTo(52, 22);      // 前耳
                    c.lineTo(58, 6);  c.lineTo(70, 16);      // 后耳
                    c.quadraticCurveTo(84, 36, 80, 70);
                    c.lineTo(82, 108);
                    c.closePath();
                });
                dot(ctx, 42, 36, 3.2);                       // 眼
                line(ctx, 28, 62, 48, 52);                   // 颊线
                quad(ctx, 60, 10, 74, 2, 86, 6, SOLID);      // 盔缨
            },
            /* 撫：撫冠（尖顶 + 斜裂口 + 座） */
            bishop(ctx) {
                path(ctx, (c) => {
                    c.moveTo(34, 76);
                    c.bezierCurveTo(24, 58, 32, 30, 50, 12);
                    c.bezierCurveTo(68, 30, 76, 58, 66, 76);
                    c.closePath();
                });
                dot(ctx, 50, 7, 4.5);
                line(ctx, 36, 52, 60, 30, SOLID);
                path(ctx, (c) => {
                    c.moveTo(26, 80); c.lineTo(74, 80); c.quadraticCurveTo(80, 80, 80, 88);
                    c.lineTo(80, 94); c.lineTo(20, 94); c.lineTo(20, 88);
                    c.quadraticCurveTo(20, 80, 26, 80); c.closePath();
                });
            },

            /* 王：王冠 + 十字 */
            king(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, 78); c.lineTo(24, 40); c.lineTo(34, 54); c.lineTo(43, 34);
                    c.lineTo(50, 48); c.lineTo(57, 34); c.lineTo(66, 54); c.lineTo(76, 40);
                    c.lineTo(76, 78); c.closePath();
                });
                dot(ctx, 24, 36, 3.5);
                dot(ctx, 76, 36, 3.5);
                line(ctx, 50, 34, 50, 8, SOLID);
                line(ctx, 40, 18, 60, 18, SOLID);
                line(ctx, 24, 88, 76, 88);
            },

            /* 后：后冠（五尖 + 五珠） */
            queen(ctx) {
                path(ctx, (c) => {
                    c.moveTo(22, 80); c.lineTo(18, 48);
                    c.lineTo(28, 28); c.lineTo(36, 44); c.lineTo(44, 20);
                    c.lineTo(50, 38); c.lineTo(56, 20); c.lineTo(64, 44); c.lineTo(72, 28);
                    c.lineTo(82, 48); c.lineTo(78, 80); c.closePath();
                });
                dot(ctx, 18, 42, 3.2); dot(ctx, 28, 24, 3.2); dot(ctx, 50, 13, 3.2);
                dot(ctx, 72, 24, 3.2); dot(ctx, 82, 42, 3.2);
                line(ctx, 22, 90, 78, 90);
                line(ctx, 44, 32, 50, 44);
            },

            /* 相：着官服半身像（展脚幞头 + 竖直持笏） */
            chancellor(ctx) {
                path(ctx, (c) => {                       // 宽肩官服
                    c.moveTo(24, G); c.quadraticCurveTo(26, 76, 50, 66);
                    c.quadraticCurveTo(74, 76, 76, G);
                });
                ring(ctx, 50, 48, 13, LW);               // 头
                path(ctx, (c) => {                       // 幞头圆顶
                    c.moveTo(34, 36); c.bezierCurveTo(34, 12, 66, 12, 66, 36); c.closePath();
                });
                line(ctx, 33, 36, 67, 36);
                poly(ctx, [[33, 32], [14, 26], [12, 36], [33, 41]], true, LW);   // 左翅（厚）
                poly(ctx, [[67, 32], [86, 26], [88, 36], [67, 41]], true, LW);   // 右翅
                dot(ctx, 50, 10, 3.5);
                line(ctx, 62, 96, 62, 68, SOLID);        // 朝天笏
                line(ctx, 57, 66, 67, 66);
            },

            /* 砲：长管炮 + 弹丸（炮口朝左上） */
            trebuchet(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, 34); c.lineTo(70, 62); c.lineTo(62, 76); c.lineTo(16, 48);
                    c.closePath();
                });
                line(ctx, 18, 40, 26, 46);
                line(ctx, 68, 56, 76, 62);
                dot(ctx, 18, 18, 8);
                path(ctx, (c) => {
                    c.moveTo(34, 78); c.lineTo(72, 78); c.lineTo(78, G); c.lineTo(28, G);
                    c.closePath();
                });
                ring(ctx, 54, 92, 15, LW);
                dot(ctx, 54, 92, 3);
            },

            /* 軳：正交炮（炮口水平向右，喷火） */
            artillery‌(ctx) {
                path(ctx, (c) => {
                    c.moveTo(30, 46); c.lineTo(74, 46); c.lineTo(74, 62); c.lineTo(30, 62);
                    c.closePath();
                });
                line(ctx, 46, 46, 46, 62);
                line(ctx, 62, 46, 62, 62);
                path(ctx, (c) => {                       // 三条火舌
                    c.moveTo(74, 54);
                    c.bezierCurveTo(84, 44, 82, 34, 86, 22);
                    c.bezierCurveTo(92, 32, 96, 40, 94, 54);
                    c.closePath();
                });
                path(ctx, (c) => {
                    c.moveTo(28, 62); c.lineTo(76, 62); c.lineTo(82, 76); c.lineTo(22, 76);
                    c.closePath();
                });
                ring(ctx, 36, 94, 14, LW);
                dot(ctx, 36, 94, 3);
            },

            /* 包：越过障碍（低矮砖墙 + 折线轨迹，顶点一枚抛过墙的球、落点带箭头）—— 只能融合 */
            bundle(ctx) {
                path(ctx, (c) => {                          // 低矮砖墙
                    c.moveTo(24, 92); c.lineTo(76, 92); c.lineTo(76, 108); c.lineTo(24, 108);
                    c.closePath();
                });
                line(ctx, 24, 100, 76, 100, DETAIL);        // 砖缝：一横一竖
                line(ctx, 50, 92, 50, 100, DETAIL);
                line(ctx, 2, 96, 46, 30, SOLID);            // 上升段
                line(ctx, 46, 30, 96, 96, SOLID);           // 下落段
                dot(ctx, 46, 18, 8);                        // 抛过墙顶的球
                poly(ctx, [[96, 96], [80, 88], [86, 108]], true, SOLID);   // 落点箭头
            },

            /* 驡：祥云（云头 + 云卷 + 飘带）—— 驡行云；不再画馬，也不取龙形，与「龍」及诸馬形都不重样 */
            loongma(ctx) {
                path(ctx, (c) => {                          // 云头：连绵的圆弧轮廓
                    c.moveTo(16, 72);
                    c.quadraticCurveTo(2, 70, 6, 58);
                    c.quadraticCurveTo(10, 46, 24, 50);
                    c.quadraticCurveTo(28, 30, 48, 32);
                    c.quadraticCurveTo(60, 18, 74, 28);
                    c.quadraticCurveTo(90, 30, 90, 48);
                    c.quadraticCurveTo(100, 56, 93, 68);
                    c.quadraticCurveTo(86, 78, 73, 73);
                    c.quadraticCurveTo(62, 84, 48, 78);
                    c.quadraticCurveTo(34, 86, 26, 77);
                    c.closePath();
                });
                for (const [cx, cy, r, a0] of [[32, 58, 9, 0.5], [54, 50, 8, 0.9], [74, 56, 7, 1.3]]) {
                    ctx.beginPath();                        // 云卷：螺旋弧（留口）
                    ctx.arc(cx, cy, r, a0, a0 + 4.6);
                    ctx.lineWidth = DETAIL;
                    ctx.stroke();
                }
                quad(ctx, 24, 82, 12, 94, 2, 92, DETAIL);   // 飘带
                quad(ctx, 48, 84, 40, 99, 28, 99, DETAIL);
            },

            /* 卫：行囊（沿用原「包」的布包图形；驮在馬背上的行装） */
            guard(ctx) {
                path(ctx, (c) => {
                    c.moveTo(24, 50);
                    c.quadraticCurveTo(15, 70, 19, 90);
                    c.quadraticCurveTo(24, 104, 50, 104);
                    c.quadraticCurveTo(76, 104, 81, 90);
                    c.quadraticCurveTo(85, 70, 76, 50);
                    c.closePath();
                });
                line(ctx, 32, 57, 68, 57);
                line(ctx, 50, 52, 50, 104);
                path(ctx, (c) => {
                    c.moveTo(34, 50); c.quadraticCurveTo(40, 23, 50, 23);
                    c.quadraticCurveTo(60, 23, 66, 50);
                });
                dot(ctx, 50, 19, 4);
                line(ctx, 50, 19, 38, 4);
                line(ctx, 50, 19, 62, 4);
            },

        steed(ctx) {
            path(ctx, (c) => {                          // 星头：四角星
                c.moveTo(74, 8);
                c.lineTo(80, 26); c.lineTo(98, 32);
                c.lineTo(80, 38); c.lineTo(74, 56);
                c.lineTo(68, 38); c.lineTo(50, 32);
                c.lineTo(68, 26);
                c.closePath();
            });
            poly(ctx, [[58, 46], [6, 102], [20, 108], [66, 52]], true, LW);       // 尾迹三道
            poly(ctx, [[66, 58], [34, 106], [46, 108], [72, 62]], true, DETAIL);
            poly(ctx, [[76, 66], [58, 108], [68, 108], [82, 70]], true, DETAIL);
        },

        /* 驍：后腿蹬地、前腿腾空的跃馬（无騎手、无甲）—— 与「馬」四腿站立的姿态完全不同 */
        xiao(ctx) {
            path(ctx, (c) => {                          // 躯干：自左下（臀）向右上（肩）腾起
                c.moveTo(16, 80);
                c.quadraticCurveTo(20, 52, 46, 44);
                c.quadraticCurveTo(68, 38, 78, 26);
            });
            path(ctx, (c) => {                          // 颈与头（朝右上）
                c.moveTo(72, 34);
                c.lineTo(82, 22); c.lineTo(91, 18); c.lineTo(89, 9);
                c.lineTo(97, 5); c.lineTo(85, 8);
                c.quadraticCurveTo(78, 16, 70, 28);
            });
            dot(ctx, 86, 14, 2.4);                      // 馬眼
            quad(ctx, 17, 78, 3, 92, 13, 103, LW);      // 后腿：蹬地
            quad(ctx, 30, 66, 21, 90, 31, 101, LW);
            quad(ctx, 60, 40, 74, 55, 90, 57, LW);      // 前腿：腾空
            quad(ctx, 52, 44, 62, 59, 77, 63, LW);
            curve(ctx, 16, 78, 3, 76, 0, 62, 11, 52, SOLID);   // 尾：飘起
        },

        /* 大炮：炮身厚度约为「砲」「軳」的两倍，配大炮弹与双轮炮座 —— 两门炮合一，一眼更粗 */
        cannon(ctx) {
            path(ctx, (c) => {                          // 粗炮身（45°，厚 ~49，另两门炮约 16）
                c.moveTo(30, 10); c.lineTo(80, 44); c.lineTo(56, 88); c.lineTo(6, 54);
                c.closePath();
            });
            line(ctx, 18, 32, 68, 66, DETAIL);          // 炮身中线
            line(ctx, 30, 10, 6, 54, SOLID);            // 炮口加厚
            dot(ctx, 28, 14, 12);                       // 大炮弹
            path(ctx, (c) => {                          // 炮座
                c.moveTo(28, 88); c.lineTo(78, 88); c.lineTo(86, 100); c.lineTo(20, 100);
                c.closePath();
            });
            ring(ctx, 34, 104, 11, LW);                 // 双轮：两门炮合一
            ring(ctx, 66, 104, 11, LW);
            dot(ctx, 34, 104, 2.6);
            dot(ctx, 66, 104, 2.6);
        },

        /* 督：撫冠 + 十字（与「撫」的顶珠、「王」的皇冠区分） */
        archbishop(ctx) {
            path(ctx, (c) => {
                c.moveTo(33, 82);
                c.bezierCurveTo(23, 62, 31, 32, 50, 14);
                c.bezierCurveTo(69, 32, 77, 62, 67, 82);
                c.closePath();
            });
            line(ctx, 50, 34, 50, 0, 11);               // 大十字：再加长加粗
            line(ctx, 30, 15, 70, 15, 11);
            line(ctx, 36, 56, 58, 34, SOLID);
            line(ctx, 36, 68, 64, 68);
            path(ctx, (c) => {
                c.moveTo(24, 86); c.lineTo(76, 86); c.quadraticCurveTo(82, 86, 82, 94);
                c.lineTo(82, 100); c.lineTo(18, 100); c.lineTo(18, 94);
                c.quadraticCurveTo(18, 86, 24, 86); c.closePath();
            });
        },

        /* 龍：龙首（长吻 + 双角 + 龙须 + 牙） */
            /* 龍：盘曲的龙身（S 形）＋ 龙首、双角、长须、龙爪与鳍尾 —— 与所有馬形彻底分开 */
            loong(ctx) {
                const prevCap = ctx.lineCap, prevW = ctx.lineWidth;
                ctx.lineCap = 'round';
                ctx.lineWidth = 9;
                ctx.beginPath();
                ctx.moveTo(24, 104);
                ctx.bezierCurveTo(4, 88, 28, 66, 50, 72);
                ctx.bezierCurveTo(74, 79, 88, 60, 72, 44);
                ctx.stroke();
                ctx.lineWidth = prevW;
                ctx.lineCap = prevCap;
                path(ctx, (c) => {                          // 龙首（右上）
                    c.moveTo(72, 44);
                    c.lineTo(80, 30); c.lineTo(97, 25);
                    c.lineTo(84, 17);
                    c.lineTo(90, 2);  c.lineTo(74, 11);
                    c.lineTo(64, 3);  c.lineTo(62, 21);
                    c.quadraticCurveTo(58, 36, 72, 44);
                    c.closePath();
                });
                dot(ctx, 82, 26, 3);                        // 眼
                quad(ctx, 66, 20, 52, 26, 46, 38, DETAIL);  // 长须
                quad(ctx, 92, 32, 102, 42, 104, 56, DETAIL);
                poly(ctx, [[36, 84], [26, 92], [40, 94]], true, DETAIL);   // 龙爪
                poly(ctx, [[62, 78], [56, 90], [70, 88]], true, DETAIL);
                path(ctx, (c) => {                          // 鳍尾
                    c.moveTo(24, 104); c.lineTo(8, 114); c.lineTo(26, 116); c.lineTo(32, 106);
                    c.closePath();
                });
            },
        };

        const LABELS = {
            rook: '車', horse: '馬', elephant: '象', scholar: '士',
            general: '將', marshal: '帥', soldier: '兵', pawn: '卒',
            knight: '騎', bishop: '撫', king: '王', queen: '后',
            chancellor: '相', trebuchet: '砲', artillery‌: '軳',
            flag: '旗', bundle: '包', loongma: '驡', loong: '龍',
            cannon: '炮', xiao: '驍', steed: '驥',
            guard: '卫', archbishop: '督'
        };

        /** 通用底座（所有棋子共用，保证风格统一） */
        function drawBase(ctx) {
            ctx.beginPath();
            ctx.ellipse(CX, G + 4, 30, 7, 0, 0, Math.PI * 2);
            ctx.lineWidth = LW;
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(CX, G + 4, 30, 7, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        /**
         * 在 (cx, cy) 处以高 size 绘制一个棋子符号
         * @param {CanvasRenderingContext2D} ctx
         * @param {string} kind  SYMBOLS 的键
         * @param {number} cx 水平中心
         * @param {number} cy 垂直中心
         * @param {number} size 高度（盒子 120 单位 → size 像素）
         * @param {string} color 单色
         * @param {{base?: boolean}} [opts]
         */
        function drawSymbol(ctx, kind, cx, cy, size, color, opts) {
            const fn = SYMBOLS[kind];
            if (!fn) return;
            const k = size / H;
            ctx.save();
            ctx.translate(cx - (W / 2) * k, cy - (H / 2) * k);
            ctx.scale(k, k);
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.miterLimit = 2;
            if (!opts || opts.base !== false) drawBase(ctx);
            fn(ctx);
            ctx.restore();
        }

        global.QiXiangqiSymbols = { SYMBOLS, LABELS, drawSymbol, BOX: { W, H, GROUND: G } };
    })(typeof window !== 'undefined' ? window : globalThis);

            /* ================= 画布与几何 ================= */
            const LOGICAL = 560;         // 逻辑画布边长（正方形，与国际象棋一致）
            const PAD_UNITS = 0.55;      // 四周边距（单位：格）——上下左右相等
            const units = BOARD_W + 2 * PAD_UNITS;
            let cellSize = 0, offsetX = 0, offsetY = 0;

            const canvas = document.getElementById('goBoard');
            const ctx2d = canvas.getContext('2d');
            function applyHiDpiCanvas(redraw) {
                if (typeof QiWeiqiSquarePageRuntime === 'undefined' || !QiWeiqiSquarePageRuntime.setupHiDpiCanvas) return;
                QiWeiqiSquarePageRuntime.setupHiDpiCanvas(canvas, LOGICAL);
                if (redraw) drawBoard();
            }
            applyHiDpiCanvas(false);
            if (window.requestAnimationFrame) window.requestAnimationFrame(() => applyHiDpiCanvas(true));
            window.addEventListener('resize', () => applyHiDpiCanvas(true));

            const turnDisplay = document.getElementById('turnDisplay');
            const colorStatus = document.getElementById('colorStatus');
            const scoreTitle = document.getElementById('scoreTitle');
            const scoreBoard = document.getElementById('scoreBoard');
            const leadInfo = document.getElementById('leadInfo');
            const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            const SLOT_UI = {
                player2: { name: '黑方', emoji: '⚫', continueText: '继续执黑', choiceText: '执黑', youText: '您执黑', absentText: '黑方已退出', statusText: '黑方' },
                player1: { name: '白方', emoji: '⚪', continueText: '继续执白', choiceText: '执白', youText: '您执白', absentText: '白方已退出', statusText: '白方' }
            };

            const ps = {
                board: emptyBoard(),
                sideToMove: 'white',
                currentPlayer: 1,
                mySlot: null,
                gameOver: false,
                gameStarted: false,
                winner: null,
                hand: createInitialHand(),
                turnCount: { white: 0, black: 0 },
                lastFrom: null,
                lastTo: null,
                ws: null,
                isMyTurn: false,
                slots: { player2: false, player1: false },
                reconnectTimer: null,
                replayMode: false,
                tryPlayMode: false,
                matchStarted: false,
                matchTime: null,
                selKind: '',        // 'board' | 'hand'
                selRow: -1,
                selCol: -1,
                selMaterial: '',
                legalTargets: [],
                dropTargets: [],
                selSide: '',
                inCheck: false,
                checkBannerUntil: 0,
                hoverRow: -1,
                hoverCol: -1,
                hoverHandIdx: -1,
                moveHistory: [],
                liveViewStep: 0,
                liveFollowLatest: true,
                replayStep: 0,
                replayTotalSteps: 0,
                replaySnapshots: [],
                tryPlayBaseStep: 0,
                tryPlayStep: 0,
                tryPlayTotalSteps: 0,
                tryPlaySnapshots: [],
                tryPlaySide: 'white',
                recordResultText: null,
                waitingScoreConfirm: false,
                iRejected: false,
                showEstimateActive: false
            };
            // 我的驹台（观战者看白方）
            function myHandSide() { return ps.mySlot ? sideOfSlot(ps.mySlot) : 'white'; }
            function handOf(side) { return ps.hand[side] || { S: 0, Z: 0, BA: 0 }; }
            const MATERIALS = ['Z', 'S', 'BA'];   // 驹台显示顺序：卒 士 包
            /** 己方颜色：白方用白、黑方用深色 */
            function sideInk(side) { return side === 'black' ? '#241a10' : '#ffffff'; }
            function withAlpha(hex, a) {
                const n = parseInt(hex.slice(1), 16);
                return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
            }
            const MARK_LW = () => Math.max(2, cellSize * 0.06);   // 与「最后一步」框同粗细
            const MARK_DOT = () => Math.max(3, cellSize * 0.24);  // 候选格小方块边长

            /* ================= 视角翻转 ================= */
            function boardFlipped() { return ps.mySlot === 'player2'; }
            function toDisplayCoord(row, col) {
                // 先手方(白)在 row 小的一侧且显示在下：先做视角 180° 旋转，再整体 y 镜像
                let r = row, c = col;
                if (boardFlipped()) { r = BOARD_H - 1 - r; c = BOARD_W - 1 - c; }
                return { row: BOARD_H - 1 - r, col: c };
            }
            function toOriginalCoord(dispRow, dispCol) {
                let r = BOARD_H - 1 - dispRow, c = dispCol;
                if (boardFlipped()) { r = BOARD_H - 1 - r; c = BOARD_W - 1 - c; }
                return { row: r, col: c };
            }
            function calcGeometry() {
                cellSize = Math.min(LOGICAL / units, LOGICAL / units);
                offsetX = (LOGICAL - BOARD_W * cellSize) / 2;
                offsetY = (LOGICAL - BOARD_H * cellSize) / 2;
            }
            function squareCenter(dispRow, dispCol) {
                return { x: offsetX + (dispCol + 0.5) * cellSize, y: offsetY + (dispRow + 0.5) * cellSize };
            }

            /* ================= 绘制 ================= */
            function symbolsReady() { return !!(window.QiXiangqiSymbols && window.QiXiangqiSymbols.drawSymbol); }
            function drawPieceSymbol(g, side, type, cx, cy, size) {
                if (!symbolsReady() || !g) return;
                const S = window.QiXiangqiSymbols;
                const kind = PIECES[type] && PIECES[type].kind;
                if (!kind) return;
                g.save();
                g.lineJoin = 'round';
                g.lineCap = 'round';
                if (side === 'white') {
                    // 白方：纯白棋身 + 纯黑硬边（八向偏移描边，不用模糊光晕）
                    const off = Math.max(1.2, size * 0.04);
                    g.shadowColor = '#241a10';          // 与黑棋同色
                    g.shadowBlur = 0;
                    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        g.shadowOffsetX = dx * off;
                        g.shadowOffsetY = dy * off;
                        S.drawSymbol(g, kind, cx, cy, size, '#ffffff');
                    }
                    g.shadowOffsetX = 0;
                    g.shadowOffsetY = 0;
                } else {
                    S.drawSymbol(g, kind, cx, cy, size, '#241a10');
                }
                g.restore();
            }

            function drawCoordinates() {
                const files = [];
                for (let c = 0; c < BOARD_W; c++) files.push(String.fromCharCode(65 + c));
                if (boardFlipped()) files.reverse();
                const ranks = [];
                for (let r = 0; r < BOARD_H; r++) ranks.push(String(BOARD_H - r));
                if (boardFlipped()) ranks.reverse();
                ctx2d.fillStyle = '#5a3a1e';
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';
                ctx2d.font = `bold ${cellSize * 0.375}px Arial`;
                for (let c = 0; c < BOARD_W; c++) {
                    const x = offsetX + (c + 0.5) * cellSize;
                    ctx2d.fillText(files[c], x, offsetY * 0.6);
                    ctx2d.fillText(files[c], x, offsetY + BOARD_H * cellSize + offsetY * 0.6);
                }
                for (let r = 0; r < BOARD_H; r++) {
                    const y = offsetY + (r + 0.5) * cellSize;
                    ctx2d.fillText(ranks[r], offsetX * 0.5, y);
                    ctx2d.fillText(ranks[r], offsetX + BOARD_W * cellSize + offsetX * 0.5, y);
                }
            }

            function drawCheckBanner() {
                if (!ps.checkBannerUntil || Date.now() >= ps.checkBannerUntil) return;
                const cx = offsetX + (BOARD_W * cellSize) / 2;
                const cy = offsetY + (BOARD_H * cellSize) / 2;
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

            function drawBoard() {
                calcGeometry();
                ctx2d.clearRect(0, 0, LOGICAL, LOGICAL);

                // 格盘：无黑白格、格子不铺底色（直接用棋盘背景色），只画格线
                const x0 = offsetX, y0 = offsetY, w = BOARD_W * cellSize, h = BOARD_H * cellSize;
                ctx2d.strokeStyle = '#3a281c';   // 与 chess / 路墙棋同一线色
                ctx2d.lineWidth = 1.5;
                for (let i = 0; i <= BOARD_W; i++) {
                    ctx2d.beginPath(); ctx2d.moveTo(x0 + i * cellSize, y0); ctx2d.lineTo(x0 + i * cellSize, y0 + h); ctx2d.stroke();
                }
                for (let j = 0; j <= BOARD_H; j++) {
                    ctx2d.beginPath(); ctx2d.moveTo(x0, y0 + j * cellSize); ctx2d.lineTo(x0 + w, y0 + j * cellSize); ctx2d.stroke();
                }
                ctx2d.strokeStyle = '#3a281c';
                ctx2d.lineWidth = 2;
                ctx2d.strokeRect(x0, y0, w, h);
                drawCoordinates();

                const board = ps.board;

                if (ps.lastFrom || ps.lastTo) {
                    for (const sq of [ps.lastFrom, ps.lastTo]) {
                        if (!sq) continue;
                        const d = toDisplayCoord(sq.row, sq.col);
                        ctx2d.fillStyle = 'rgba(255,255,120,0.38)';
                        ctx2d.fillRect(x0 + d.col * cellSize, y0 + d.row * cellSize, cellSize, cellSize);
                    }
                }
                if (ps.inCheck) {
                    const royal = findRoyal(ps.board, ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove);
                    if (royal) {
                        const d = toDisplayCoord(royal.row, royal.col);
                        ctx2d.fillStyle = 'rgba(200,40,40,0.35)';
                        ctx2d.fillRect(x0 + d.col * cellSize, y0 + d.row * cellSize, cellSize, cellSize);
                    }
                }
                // 选中格：己方颜色的框（尺寸/粗细与「最后一步」的框一致）
                if (ps.selKind === 'board' && ps.selRow >= 0) {
                    const d = toDisplayCoord(ps.selRow, ps.selCol);
                    ctx2d.strokeStyle = sideInk(ps.selSide || 'white');
                    ctx2d.lineWidth = MARK_LW();
                    ctx2d.strokeRect(x0 + d.col * cellSize + 2, y0 + d.row * cellSize + 2, cellSize - 4, cellSize - 4);
                }
                const ink = sideInk(ps.selSide || 'white');
                // 可走点 / 可吃点 / 可合并点
                for (const t of ps.legalTargets) {
                    const d = toDisplayCoord(t.row, t.col);
                    const px = x0 + d.col * cellSize, py = y0 + d.row * cellSize;
                    const cx = px + cellSize / 2, cy = py + cellSize / 2;
                    if (t.merge) {
                        // 可融合：己方颜色、30% 透明、与选中框同尺寸的实心方块
                        ctx2d.fillStyle = withAlpha(ink, 0.3);
                        ctx2d.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
                    } else if (t.capture) {
                        // 棋类通用：可吃子是棕色方框
                        const half = cellSize * 0.38;
                        ctx2d.strokeStyle = 'rgba(163,92,39,0.9)';
                        ctx2d.lineWidth = 4;
                        ctx2d.strokeRect(cx - half, cy - half, half * 2, half * 2);
                    } else {
                        // 可走空格：己方颜色的小方块
                        ctx2d.fillStyle = ink;
                        ctx2d.fillRect(cx - MARK_DOT() / 2, cy - MARK_DOT() / 2, MARK_DOT(), MARK_DOT());
                    }
                }
                // 打入 / 融合目标
                for (const t of ps.dropTargets) {
                    const d = toDisplayCoord(t.row, t.col);
                    const px = x0 + d.col * cellSize, py = y0 + d.row * cellSize;
                    if (t.fuse) {
                        ctx2d.fillStyle = withAlpha(ink, 0.3);
                        ctx2d.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
                    } else {
                        ctx2d.fillStyle = ink;
                        ctx2d.fillRect(px + (cellSize - MARK_DOT()) / 2, py + (cellSize - MARK_DOT()) / 2, MARK_DOT(), MARK_DOT());
                    }
                }
                // 棋子
                for (let r = 0; r < BOARD_H; r++) {
                    for (let c = 0; c < BOARD_W; c++) {
                        const code = board[r][c];
                        if (!code) continue;
                        const d = toDisplayCoord(r, c);
                        const p = squareCenter(d.row, d.col);
                        drawPieceSymbol(ctx2d, sideOfCode(code), typeOf(code), p.x, p.y - cellSize * 0.01, cellSize * 0.74);
                    }
                }
                drawCheckBanner();
                renderBags();   // 驹台是棋盘下方的 DOM 面板
            }

            /* ================= 驹台（DOM，棋盘下方左右两栏） ================= */
            let bagRoot = null, bagWhiteRow = null, bagBlackRow = null, bagSig = '';

            function ensureBagDom() {
                if (bagRoot) return;
                // 站内通用背包槽（左=红方槽、右=绿方槽，与模拟日本将棋共用同一套 DOM/CSS）
                const container = document.getElementById('dyeingBagsPalette');
                const leftSlot = document.getElementById('dyeingRedBagRow');
                const rightSlot = document.getElementById('dyeingGreenBagRow');
                if (!leftSlot || !rightSlot) return;
                bagRoot = container || leftSlot.parentElement;
                bagWhiteRow = leftSlot;
                bagBlackRow = rightSlot;
                if (container) container.classList.add('hx-bags-host');
                const style = document.createElement('style');
                style.textContent = `
                    .hx-bags-host .dyeing-bag-inner{grid-auto-rows:auto}
                    .hx-bag-wrap{grid-column:1/-1;justify-self:stretch;width:100%;display:flex;
                        flex-direction:column;align-items:flex-start;gap:4px;min-height:34px;align-self:start}
                    .hx-bag-items{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}
                    .hx-bag-name{font:700 11px/16px "Microsoft YaHei",Arial;color:#5a3a1e;opacity:.8}
                    .hx-bag-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;min-height:34px}
                    .hx-bag-item{display:flex;align-items:center;gap:2px;border:none;background:transparent;
                        padding:1px 2px;cursor:pointer;border-radius:8px}
                    .hx-bag-item.sel{background:rgba(90,160,90,0.35)}
                    .hx-bag-item:disabled{cursor:default}
                    .hx-bag-cnt{font:700 12px/1 Arial;color:#2b1d12}
                    .hx-bag-empty{font:400 11px/20px "Microsoft YaHei",Arial;color:#5a3a1e;opacity:.45}
                    .hx-tip{position:fixed;z-index:80;pointer-events:none;padding:2px 8px;border-radius:6px;
                        background:rgba(43,29,18,0.92);color:#fdfaf3;font:600 12px/18px "Microsoft YaHei",Arial;
                        white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);transform:translate(-50%,-160%)}
                    .hx-tip[hidden]{display:none}
                    .hx-rules-icon{width:18px;height:18px;vertical-align:-4px;margin-right:1px}
                `;
                document.head.appendChild(style);
            }

            function renderBags() {
                ensureBagDom();
                if (!bagWhiteRow) return;
                const sig = [
                    JSON.stringify(ps.hand.white || {}), JSON.stringify(ps.hand.black || {}),
                    ps.selKind === 'hand' ? ps.selMaterial : '',
                    ps.tryPlayMode ? ps.tryPlaySide : viewSideToMove(),
                    ps.mySlot || '',
                    window.QiXiangqiSymbols ? '1' : '0'
                ].join('|');
                if (sig === bagSig) return;
                bagSig = sig;
                const canPick = (side) => window.QiXiangqiSymbols
                    && (ps.tryPlayMode ? ps.tryPlaySide === side : (ps.mySlot && sideOfSlot(ps.mySlot) === side));
                const fill = (row, side) => {
                    row.innerHTML = '';
                    const wrap = document.createElement('div');
                    wrap.className = 'hx-bag-wrap';
                    const name = document.createElement('span');
                    name.className = 'hx-bag-name';
                    name.textContent = side === 'white' ? '白方驹台' : '黑方驹台';
                    wrap.appendChild(name);
                    const items = document.createElement('div');
                    items.className = 'hx-bag-items';
                    wrap.appendChild(items);
                    row.appendChild(wrap);
                    const hand = handOf(side);
                    let any = false;
                    for (const m of MATERIALS) {
                        const n = hand[m] || 0;
                        if (n <= 0) continue;
                        any = true;
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'hx-bag-item' + (ps.selKind === 'hand' && ps.selMaterial === m && canPick(side) ? ' sel' : '');
                        btn.disabled = !canPick(side);
                        const h = 30, w = (100 / 120) * h, dpr = 2;
                        const cv = document.createElement('canvas');
                        cv.width = w * dpr; cv.height = h * dpr;
                        cv.style.width = w + 'px'; cv.style.height = h + 'px';
                        const g = cv.getContext('2d');
                        g.scale(dpr, dpr);
                        drawPieceSymbol(g, side, m, w / 2, h / 2, h);
                        btn.appendChild(cv);
                        const cnt = document.createElement('span');
                        cnt.className = 'hx-bag-cnt';
                        cnt.textContent = '\u00d7' + n;
                        btn.appendChild(cnt);
                        btn.onclick = () => {
                            if (!canPick(side)) return;
                            if (ps.selKind === 'hand' && ps.selMaterial === m) clearSelection();
                            else selectHandMaterial(m);
                            drawBoard();
                        };
                        btn.addEventListener('mouseenter', (e) => showTip(PIECES[m].name, e.clientX, e.clientY));
                        btn.addEventListener('mousemove', (e) => showTip(PIECES[m].name, e.clientX, e.clientY));
                        btn.addEventListener('mouseleave', hideTip);
                        items.appendChild(btn);
                    }
                    if (!any) {
                        const em = document.createElement('span');
                        em.className = 'hx-bag-empty';
                        em.textContent = '（空）';
                        items.appendChild(em);
                    }
                };
                fill(bagWhiteRow, 'white');
                fill(bagBlackRow, 'black');
            }

            /* ================= 视图（直播 / 回放 / 试下） ================= */
            // 服务器局面是真值（syncState 写入 ps.live*）；ps.board / ps.hand 始终是「当前显示」的局面。
            // 回放与试下都通过 applySnapshot 把快照写进显示局面（与国际象棋同一模型）。
            function snapFrom(board, hand, lastFrom, lastTo, side) {
                return {
                    board: copyBoard(board),
                    hand: {
                        white: { S: 0, Z: 0, BA: 0, ...(hand && hand.white) },
                        black: { S: 0, Z: 0, BA: 0, ...(hand && hand.black) }
                    },
                    lastFrom: lastFrom ? { ...lastFrom } : null,
                    lastTo: lastTo ? { ...lastTo } : null,
                    side
                };
            }

            function applySnapshot(s) {
                if (!s) return;
                ps.board = copyBoard(s.board);
                ps.hand = { white: { ...s.hand.white }, black: { ...s.hand.black } };
                ps.lastFrom = s.lastFrom ? { ...s.lastFrom } : null;
                ps.lastTo = s.lastTo ? { ...s.lastTo } : null;
                ps.viewSide = s.side;
                ps.inCheck = isRoyalAttacked(ps.board, s.side);
                clearSelection();
                drawBoard();
                updateTurn();
            }

            /** 服务器 moveHistory → 逐手快照（含吃子分解、融合、合并、每 3 手加子） */
            function buildSnapshots(entries) {
                const snaps = [];
                const board = createInitialBoard();
                const hand = { white: createInitialHand(), black: createInitialHand() };
                snaps.push(snapFrom(board, hand, null, null, 'white'));
                for (const m of entries || []) {
                    const side = sideOfSlot(m.player);
                    let lastFrom = null, lastTo = null;
                    if (m.type === 'drop') {
                        hand[side][m.material] = (hand[side][m.material] || 0) - 1;
                        board[m.toRow][m.toCol] = (side === 'white' ? 'w' : 'b') + (m.result || m.material);
                        lastTo = { row: m.toRow, col: m.toCol };
                    } else if (m.merge) {
                        board[m.toRow][m.toCol] = (side === 'white' ? 'w' : 'b') + m.merge;
                        board[m.fromRow][m.fromCol] = '';
                        lastFrom = { row: m.fromRow, col: m.fromCol };
                        lastTo = { row: m.toRow, col: m.toCol };
                    } else {
                        const code = board[m.fromRow][m.fromCol];
                        const captured = board[m.toRow][m.toCol];
                        if (captured) {
                            for (const mm of materialList(PIECES[typeOf(captured)].comp)) {
                                hand[side][mm] = (hand[side][mm] || 0) + 1;
                            }
                        }
                        board[m.toRow][m.toCol] = code;
                        board[m.fromRow][m.fromCol] = '';
                        lastFrom = { row: m.fromRow, col: m.fromCol };
                        lastTo = { row: m.toRow, col: m.toCol };
                    }
                    if (m.grow) hand[side][m.grow] = (hand[side][m.grow] || 0) + 1;
                    snaps.push(snapFrom(board, hand, lastFrom, lastTo, oppositeSide(side)));
                }
                return snaps;
            }

            function rebuildLiveSnapshots() {
                ps.liveSnapshots = buildSnapshots(ps.moveHistory);
            }

            /** 回放：冻结快照后浏览本局已走的手数 */
            function enterReplayMode() {
                rebuildLiveSnapshots();
                ps.replaySnapshots = ps.liveSnapshots.slice();
                ps.replayTotalSteps = ps.replaySnapshots.length - 1;
                ps.replayMode = true;
                ps.tryPlayMode = false;
                setReplayStep(ps.replayTotalSteps);
                const btn = document.getElementById('tryPlayBtn');
                if (btn) btn.textContent = '试下';
            }
            function exitReplayMode() {
                ps.replayMode = false;
                ps.tryPlayMode = false;
                if (ps.liveSnapshots.length) setLiveViewStep(ps.liveSnapshots.length - 1);
                else { drawBoard(); updateTurn(); updateReplayUI(); }
            }
            function setReplayStep(step) {
                step = Math.max(0, Math.min(ps.replayTotalSteps, step));
                ps.replayStep = step;
                applySnapshot(ps.replaySnapshots[step]);
                updateReplayUI();
            }
            /** 直播态浏览历史（不离开直播） */
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
                const btn = document.getElementById('tryPlayBtn');
                if (btn) btn.textContent = ps.tryPlayMode ? '退出试下' : '试下';
            }

            /** 试下：在「当前显示的局面」上试走，退出后回到原处 */
            function enterTryPlay() {
                let base;
                if (!ps.replayMode) {
                    if (!ps.liveSnapshots || !ps.liveSnapshots.length) rebuildLiveSnapshots();
                    ps.tryPlayBaseStep = ps.liveViewStep;
                    base = ps.liveSnapshots[ps.liveViewStep];
                } else {
                    ps.tryPlayBaseStep = ps.replayStep;
                    base = ps.replaySnapshots[ps.replayStep];
                }
                ps.tryPlayBase = base;
                ps.tryPlaySnapshots = [snapFrom(base.board, base.hand, base.lastFrom, base.lastTo, base.side)];
                ps.tryPlayStep = 0;
                ps.tryPlayTotalSteps = 0;
                ps.tryPlaySide = base.side;
                ps.tryPlayMode = true;
                applySnapshot(ps.tryPlaySnapshots[0]);
                updateReplayUI();
            }
            function exitTryPlay() {
                ps.tryPlayMode = false;
                if (ps.replayMode) setReplayStep(ps.tryPlayBaseStep);
                else setLiveViewStep(ps.liveSnapshots ? ps.liveSnapshots.length - 1 : 0);
                updateTurn();
                updateReplayUI();
            }
            function setTryPlayStep(step) {
                const n = Math.max(0, Math.min(step, ps.tryPlaySnapshots.length - 1));
                ps.tryPlayStep = n;
                ps.tryPlaySide = ps.tryPlaySnapshots[n].side;
                applySnapshot(ps.tryPlaySnapshots[n]);
                updateReplayUI();
            }
            function tryPlayPush(snap) {
                ps.tryPlaySnapshots = ps.tryPlaySnapshots.slice(0, ps.tryPlayStep + 1);
                ps.tryPlaySnapshots.push(snap);
                ps.tryPlayStep = ps.tryPlaySnapshots.length - 1;
                ps.tryPlayTotalSteps = ps.tryPlayStep;
                ps.tryPlaySide = snap.side;
                applySnapshot(snap);
                updateReplayUI();
            }
            /** 当前显示局面由哪一方行棋 */
            function viewSideToMove() {
                if (ps.tryPlayMode) return ps.tryPlaySide;
                if (ps.replayMode) return ps.viewSide || ps.sideToMove;
                return ps.sideToMove;
            }

            /* ================= 交互 ================= */
            function isMyTurnNow() {
                if (ps.tryPlayMode) return true;              // 试下沙盒：两侧都可摆
                if (!ps.mySlot || ps.gameOver || ps.replayMode) return false;
                return sideOfSlot(ps.mySlot) === ps.sideToMove;
            }

            function clearSelection() {
                ps.selKind = ''; ps.selRow = -1; ps.selCol = -1; ps.selMaterial = '';
                ps.selSide = '';
                ps.legalTargets = []; ps.dropTargets = [];
            }

            function selectBoardPiece(row, col) {
                const board = ps.board;
                const side = viewSideToMove();
                const code = board[row][col];
                clearSelection();
                if (!code || sideOfCode(code) !== side) return false;
                ps.selKind = 'board';
                ps.selRow = row;
                ps.selCol = col;
                ps.selSide = side;
                ps.legalTargets = legalMovesFrom(board, row, col)
                    .map((m) => ({ row: m.row, col: m.col, capture: m.capture, merge: m.merge || null }));
                return true;
            }

            function selectHandMaterial(m) {
                const side = ps.tryPlayMode ? ps.tryPlaySide : (ps.mySlot ? sideOfSlot(ps.mySlot) : viewSideToMove());
                const hand = handOf(side);
                clearSelection();
                if (!hand || (hand[m] || 0) <= 0) return false;
                ps.selKind = 'hand';
                ps.selMaterial = m;
                ps.selSide = side;
                ps.dropTargets = [];
                const board = ps.board;
                for (let r = 0; r < BOARD_H; r++) {
                    for (let c = 0; c < BOARD_W; c++) {
                        if (!isLegalDrop(board, side, m, r, c)) continue;
                        const target = board[r][c];
                        ps.dropTargets.push({ row: r, col: c, fuse: !!target });
                    }
                }
                return true;
            }

            function attemptMove(fr, fc, tr, tc) {
                if (ps.tryPlayMode) {
                    const side = ps.tryPlaySide;
                    const board = copyBoard(ps.board);
                    const hand = { white: { ...ps.hand.white }, black: { ...ps.hand.black } };
                    const code = board[fr][fc];
                    const captured = board[tr][tc];
                    board[fr][fc] = '';
                    if (captured && sideOfCode(captured) === side) {
                        board[tr][tc] = (side === 'white' ? 'w' : 'b') + fuseComps(PIECES[typeOf(code)].comp, PIECES[typeOf(captured)].comp);
                    } else {
                        board[tr][tc] = code;
                        if (captured) {
                            for (const mm of materialList(PIECES[typeOf(captured)].comp)) hand[side][mm] = (hand[side][mm] || 0) + 1;
                        }
                    }
                    tryPlayPush(snapFrom(board, hand, { row: fr, col: fc }, { row: tr, col: tc }, oppositeSide(side)));
                    return;
                }
                if (!isMyTurnNow()) return;
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'move', fromRow: fr, fromCol: fc, toRow: tr, toCol: tc }));
                }
                clearSelection();
                drawBoard();
            }

            function attemptDrop(material, tr, tc) {
                if (ps.tryPlayMode) {
                    const side = ps.tryPlaySide;
                    const board = copyBoard(ps.board);
                    const hand = { white: { ...ps.hand.white }, black: { ...ps.hand.black } };
                    const target = board[tr][tc];
                    hand[side][material] = (hand[side][material] || 0) - 1;
                    const result = target ? fuseType(PIECES[typeOf(target)].comp, material) : material;
                    board[tr][tc] = (side === 'white' ? 'w' : 'b') + result;
                    tryPlayPush(snapFrom(board, hand, null, { row: tr, col: tc }, oppositeSide(side)));
                    return;
                }
                if (!isMyTurnNow()) return;
                if (ps.ws && ps.ws.readyState === 1) {
                    ps.ws.send(JSON.stringify({ type: 'drop', material, toRow: tr, toCol: tc }));
                }
                clearSelection();
                drawBoard();
            }

            /* ===== 棋子名称提示 ===== */
            let tipEl = null;
            function ensureTip() {
                if (tipEl) return tipEl;
                tipEl = document.createElement('div');
                tipEl.className = 'hx-tip';
                tipEl.hidden = true;
                document.body.appendChild(tipEl);
                return tipEl;
            }
            function showTip(text, clientX, clientY) {
                const el = ensureTip();
                el.textContent = text;
                el.hidden = false;
                el.style.left = clientX + 'px';
                el.style.top = clientY + 'px';
            }
            function hideTip() { if (tipEl) tipEl.hidden = true; }

            /** 屏幕坐标 → 棋盘格子（引擎坐标）；不在盘内返回 null */
            function cellAtPoint(clientX, clientY) {
                const rect = canvas.getBoundingClientRect();
                const dispCol = Math.floor(((clientX - rect.left) / rect.width * LOGICAL - offsetX) / cellSize);
                const dispRow = Math.floor(((clientY - rect.top) / rect.height * LOGICAL - offsetY) / cellSize);
                if (dispRow < 0 || dispRow >= BOARD_H || dispCol < 0 || dispCol >= BOARD_W) return null;
                return toOriginalCoord(dispRow, dispCol);
            }

            canvas.addEventListener('mousemove', (e) => {
                const hit = cellAtPoint(e.clientX, e.clientY);
                const code = hit ? (ps.board[hit.row] && ps.board[hit.row][hit.col]) : null;
                if (code) showTip(PIECES[typeOf(code)].name, e.clientX, e.clientY);
                else hideTip();
            });
            canvas.addEventListener('mouseleave', hideTip);

            /* ===== 说明里的棋子图标 ===== */
            function pieceIconDataUrl(type, px) {
                const cv = document.createElement('canvas');
                const dpr = 2;
                cv.width = Math.round(px * dpr);
                cv.height = Math.round(px * dpr);
                const g = cv.getContext('2d');
                g.scale(dpr, dpr);
                drawPieceSymbol(g, 'black', type, px / 2, px / 2 + px * 0.04, px * 0.92);
                return cv.toDataURL();
            }
            function decorateRulesHtml(html) {
                if (!symbolsReady() || !html) return html;
                const byName = {};
                for (const t of Object.keys(PIECES)) byName[PIECES[t].name] = t;
                let out = html;
                const names = Object.keys(byName).sort((a, b) => b.length - a.length);
                for (const name of names) {
                    const img = '<img class="hx-rules-icon" alt="" src="' + pieceIconDataUrl(byName[name], 20) + '">';
                    out = out.split('<strong>' + name + '</strong>').join(img + '<strong>' + name + '</strong>');
                }
                return out;
            }

            function handleBoardClick(clientX, clientY) {
                if (ps.replayMode && !ps.tryPlayMode) return;
                const viewingPast = !ps.replayMode && !ps.tryPlayMode && ps.liveSnapshots.length
                    && ps.liveViewStep < ps.liveSnapshots.length - 1;
                if (viewingPast) return;
                const hit0 = cellAtPoint(clientX, clientY);
                if (!hit0) return;
                const row = hit0.row, col = hit0.col;

                if (ps.selKind === 'hand') {
                    if (ps.dropTargets.some((t) => t.row === row && t.col === col)) attemptDrop(ps.selMaterial, row, col);
                    else { clearSelection(); drawBoard(); }
                    return;
                }
                if (ps.selKind === 'board') {
                    if (ps.legalTargets.some((t) => t.row === row && t.col === col)) {
                        attemptMove(ps.selRow, ps.selCol, row, col);
                        return;
                    }
                }
                if (!isMyTurnNow() && !ps.tryPlayMode) return;
                if (!selectBoardPiece(row, col)) clearSelection();
                drawBoard();
            }

            canvas.addEventListener('click', (e) => handleBoardClick(e.clientX, e.clientY));

            /* ================= 状态同步 ================= */
            function syncState(state) {
                if (!state) return;
                if (Array.isArray(state.board)) ps.board = state.board;
                if (state.hand) ps.hand = state.hand;
                if (state.turnCount) ps.turnCount = state.turnCount;
                if (state.sideToMove) ps.sideToMove = state.sideToMove;
                if (state.currentPlayer) ps.currentPlayer = state.currentPlayer;
                if (state.lastFrom !== undefined) ps.lastFrom = state.lastFrom;
                if (state.lastTo !== undefined) ps.lastTo = state.lastTo;
                if (state.gameOver !== undefined) ps.gameOver = state.gameOver;
                if (state.winner !== undefined) ps.winner = state.winner;
                if (state.recordResultText !== undefined) ps.recordResultText = state.recordResultText;
                if (Array.isArray(state.moveHistory)) ps.moveHistory = state.moveHistory;
                if (state.matchStarted !== undefined) ps.matchStarted = state.matchStarted;
                if (state.numberOfHands) ps.gameStarted = state.numberOfHands > 1 || !!state.matchStarted;
                if (state.slots) ps.slots = state.slots;
                if (state.inCheck !== undefined) ps.inCheck = !!state.inCheck;
                if (state.showCheck) triggerCheckBanner();
                rebuildLiveSnapshots();
                if (!ps.replayMode && !ps.tryPlayMode && ps.liveFollowLatest) {
                    ps.liveViewStep = Math.max(0, ps.liveSnapshots.length - 1);
                }
                if (!ps.tryPlayMode && !ps.replayMode) {
                    ps.legalTargets = [];
                    ps.dropTargets = [];
                    ps.selKind = '';
                }
                updateTurn();
                updateReplayUI();
                drawBoard();
            }

            /** turnDisplay：与国际象棋逐字一致 */
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

            function updateTurn() {
                if (ps.gameOver) {
                    let text = '';
                    if (ps.winner === 'draw') text = '和棋';
                    else if (ps.winner === 'player2') text = '⚫ 黑方胜';
                    else if (ps.winner === 'player1') text = '⚪ 白方胜';
                    if (ps.recordResultText) text = ps.recordResultText;
                    turnDisplay.innerText = '对局结束';
                    scoreTitle.innerText = text || '\u3000';   // 结果放这里（与围棋一致）
                    scoreBoard.innerText = '\u3000';
                    leadInfo.innerText = '\u3000';
                    return;
                }
                const bothSelected = !!(ps.slots && ps.slots.player2 && ps.slots.player1);
                const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
                if (!matchStarted && !ps.tryPlayMode && !ps.replayMode) {
                    turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(ps.slots, ps.mySlot);
                    scoreTitle.innerText = '\u3000';
                    scoreBoard.innerText = '\u3000';
                    leadInfo.innerText = '\u3000';
                    return;
                }
                const side = ps.tryPlayMode ? ps.tryPlaySide : ps.sideToMove;
                if (!ps.tryPlayMode && !ps.replayMode) {
                    // turnDisplay 显示「刚下完这手棋」的一方与回合数（不再写 scoreBoard）
                    const moverLabel = side === 'white' ? '⚫' : '⚪';
                    turnDisplay.innerText = QiWeiqiSquarePageRuntime.roundTurnText(ps.moveHistory.length, moverLabel);
                } else {
                    const label = side === 'white' ? '⚪ 白方行棋' : '⚫ 黑方行棋';
                    turnDisplay.innerText = (ps.tryPlayMode ? '试下 · ' : '') + label + (ps.inCheck ? '（将军）' : '');
                }
                scoreTitle.innerText = '\u3000';
                scoreBoard.innerText = '\u3000';
                leadInfo.innerText = '\u3000';
            }
            function updateIsMyTurn() { ps.isMyTurn = isMyTurnNow(); }

            /* ================= 棋谱下载 ================= */
            function downloadRecord(record) {
                const moves = (record && record.moves) || [];
                const text = [`# ${recordDownloadPrefix}`].concat(moves).join('\n');
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${recordDownloadPrefix}_${roomId}.txt`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
            }

            /* ================= 框架绑定 ================= */
            const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
                standardWeiqiMatchTime,
                boardSeatOverlay: true,
                slotUi: SLOT_UI,
                timeControlDefaults: { mainMinutes: 5, byoyomiSeconds: 30, maxTimeouts: 3 },
                roomId,
                gameType,
                pageState: ps,
                tryPlayOppositeSide: (side) => oppositeSide(side),
                drawBoard,
                exitTryPlay,
                enterTryPlay,
                setTryPlayStep,
                setReplayStep,
                setLiveViewStep,
                getWs: () => ps.ws,
                getBoardSize: () => BOARD_W,
                setBoardSize: () => { },
                getKomi: () => 0,
                setKomi: () => { },
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
                setShowEstimateActive: () => { },
                getWaitingScoreConfirm: () => false,
                setWaitingScoreConfirm: () => { },
                getIRejected: () => false,
                setIRejected: () => { },
                colorStatus,
                scoreTitle,
                turnDisplay,
                syncState: (state) => syncState(state),
                updateBoardGeometry: () => { },
                initBoardArray: () => emptyBoard(),
                exitReplayMode,
                clearEstimate: () => { },
                hideScoreConfirm: () => { },
                showEstimate: () => { },
                clearMobileMovePreview: () => { },
                downloadRecord,
                enterReplayMode,
                updateTurn,
                updateReplayUI: () => { },
                showScoreConfirm: () => { },
                isMouseDevice,
                onSeatOverlayUpdated() { drawBoard(); }
            });
            const handleMessage = _weiqiBindings.handleMessage;

            function connectWebSocket() {
                const proto = location.protocol === 'https:' ? 'wss' : 'ws';
                const url = `${proto}://${location.host}/qi/ws?game=${encodeURIComponent(gameType)}&room=${encodeURIComponent(roomId)}`;
                const ws = new WebSocket(url);
                ps.ws = ws;
                ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', password: roomPassword || '' })); };
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
                    }
                    if (msg.type === 'gameRecord') downloadRecord(msg.data);
                };
                ws.onclose = () => {
                    if (window.__qiRoomLeaving) return;
                    if (ps.reconnectTimer) return;
                    ps.reconnectTimer = setTimeout(() => { ps.reconnectTimer = null; connectWebSocket(); }, 1200);
                };
            }

            connectWebSocket();
            const tryBtn = document.getElementById('tryPlayBtn');
            if (tryBtn) tryBtn.onclick = () => { if (ps.tryPlayMode) exitTryPlay(); else enterTryPlay(); };
            const backBtn = document.getElementById('replayBackBtn');
            if (backBtn) backBtn.onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                else if (ps.replayMode) setReplayStep(ps.replayStep - 1);
                else setLiveViewStep(ps.liveViewStep - 1);
            };
            const fwdBtn = document.getElementById('replayForwardBtn');
            if (fwdBtn) fwdBtn.onclick = () => {
                if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                else if (ps.replayMode) setReplayStep(ps.replayStep + 1);
                else setLiveViewStep(ps.liveViewStep + 1);
            };
            const slider = document.getElementById('replaySlider');
            if (slider) slider.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10) || 0;
                if (ps.tryPlayMode) setTryPlayStep(v);
                else if (ps.replayMode) setReplayStep(v);
                else setLiveViewStep(v);
            });
            applyHiDpiCanvas(true);

            /* 侧栏双方名称：背包沿用了通用槽（该槽的默认命名是染色象棋的红/绿方），本棋种按 SLOT_UI 用白/黑 */
            function applySideTitles() {
                const dot = (c) => `<span class="qi-side-dot qi-side-dot--${c}" aria-hidden="true"></span>`;
                const first = document.getElementById('goTimerBlackTitle');   // 先手卡片
                const second = document.getElementById('goTimerWhiteTitle');
                if (first) first.innerHTML = dot('white') + '白方';
                if (second) second.innerHTML = dot('black') + '黑方';
            }
            applySideTitles();
            setTimeout(applySideTitles, 400);

            /* 说明文本里的棋子名前面补上棋子图标（文本内容本身不动） */
            function injectRulesIcons() {
                const self = window.RoomPlugins && window.RoomPlugins['hybrid-xiangqi'];
                const plain = ((self && self.shell && self.shell.rulesHtml) || '').replace(/<img class="hx-rules-icon"[^>]*>/g, '');
                const decorated = decorateRulesHtml(plain);
                if (self && self.shell) self.shell.rulesHtml = decorated;
                const body = document.getElementById('rulesBody');
                if (body && body.innerHTML.indexOf('hx-rules-icon') < 0) body.innerHTML = decorated;
            }
            injectRulesIcons();
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectRulesIcons);
            setTimeout(injectRulesIcons, 400);
        })();
    }
};
