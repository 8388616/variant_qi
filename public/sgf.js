/* SGF（FF[4]）棋谱互转：站内 record ↔ SGF 文本
 *
 * 口径（用户定）：
 *   · 不要求无损：特殊状态（洞/桥/雷/中立子/权重/隐身/相位…）丢掉，不写自定义状态属性；
 *   · 凡是「方格棋盘 + 双方单点落子 + 虚着」能表达的棋种就给 SGF 选项（选点系剥掉 @候选点后缀，
 *     先一各二不轮流也照收）；
 *   · 用标准的 AP[muzei:1] + RU[muzei/<gameId>] 标记来源与棋种（RU 是自由文本，第三方工具会原样显示）；
 *     不带标记的第三方 SGF 也能导入（标记只用于识别，不做门禁）；
 *   · 导入只读主线、忽略分支；胜负按记录的 RE 走（与站内「导入以记录为准」一致）。
 *
 * 坐标：站内 row 0 是棋盘**最下行**；SGF 第一个字母是列、第二个字母是行且从**最上**数，
 *       所以 letterIndex = boardSize - 1 - row（列不变）。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QiSgf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * 能导 SGF 的棋种（方格棋盘 + 单点落子；**fail-closed**：不在这张表里的不给选项）。
     * 不给的：异形/环面/连续坐标盘（triangle-*、non-rectangular、large-small-circle、twisted-space、
     * torus、nogrid、continuous、dfw）、站内特有着法（易位、罗斯系复合子、扫雷/埋雷、隐身类、
     * 对称轴）、象棋族/国际跳棋等不吃单点落子的棋种。
     */
    const SGF_GAMES = new Set([
        // 围棋族（方格、单点落子）
        'weiqi', 'capture-weiqi', 'greedy-weiqi', 'short-liberty-weiqi', 'various-liberty-weiqi',
        'global-liberty-weiqi', 'zeroliberty-weiqi', 'no-adjacent-prev-weiqi', 'front-back-weiqi',
        'hole-weiqi', 'bridge-weiqi', 'neutral-stone-weiqi', 'weight-weiqi', 'broken-line-weiqi',
        'sudoku-weiqi', 'custom-weiqi', 'shizi-weiqi', 'family-weiqi', 'fat-weiqi',
        'drift-weiqi', 'rotation-weiqi', 'magnetism-weiqi', 'instability-weiqi', 'duo-quadricolour-weiqi',
        'noweiqi', 'reverse-noweiqi', 'nopincer', 'reversi-weiqi', 'wxd',
        // 五子棋族 + 放牛棋 + 黑白棋
        'wuziqi', 'choice-weiqi', 'choice-wuziqi', 'fotte-weiqi', 'nowuziqi', 'drift-wuziqi',
        'rotation-wuziqi', 'magnetism-wuziqi', 'guess-wuziqi', 'match-wuziqi', 'random-instability-wuziqi',
        'nort', 'reversi'
    ]);

    /** 不支持虚着的棋种（SGF 里出现 B[]/W[] 时按「导入不了」处理） */
    const SGF_NO_PASS = new Set(['noweiqi', 'reverse-noweiqi', 'nopincer', 'nowuziqi', 'nort']);

    /** 这些棋种回放需要站内特有的着法信息（SGF 表达不了）→ SGF 一律不能导入 */
    const SGF_IMPORT_REFUSE = {
        'choice-weiqi': 'SGF 没有候选点信息（选点围棋的着法要带 @候选点），请用本站 JSON 棋谱导入。',
        'choice-wuziqi': 'SGF 没有候选点信息（选点五子棋的着法要带 @候选点），请用本站 JSON 棋谱导入。'
    };

    /** 五子棋族用 GM[4]（Gomoku/Renju），其余围棋类（含先一各二/放牛棋/黑白棋）用 GM[1] */
    const GM4 = new Set([
        'wuziqi', 'choice-wuziqi', 'nowuziqi', 'drift-wuziqi', 'rotation-wuziqi',
        'magnetism-wuziqi', 'guess-wuziqi', 'match-wuziqi', 'random-instability-wuziqi'
    ]);

    const ALLOWED_GM = new Set([1, 4]);

    function sgfLetter(i) {
        if (i < 0 || i > 51) return null;
        return i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i - 26);
    }

    function sgfLetterIndex(ch) {
        if (typeof ch !== 'string' || ch.length !== 1) return -1;
        const c = ch.charCodeAt(0);
        if (c >= 97 && c <= 122) return c - 97;
        if (c >= 65 && c <= 90) return c - 65 + 26;
        return -1;
    }

    /** 站内 (row, col) → SGF 两字母（列, 行；行从最上数） */
    function encodePoint(row, col, size) {
        const a = sgfLetter(col);
        const b = sgfLetter(size - 1 - row);
        return a && b ? a + b : null;
    }

    /** SGF 两字母 → 站内 { row, col } */
    function decodePoint(value, size) {
        if (typeof value !== 'string' || value.length !== 2) return null;
        const col = sgfLetterIndex(value[0]);
        const letterRow = sgfLetterIndex(value[1]);
        if (col < 0 || letterRow < 0 || col >= size || letterRow >= size) return null;
        return { row: size - 1 - letterRow, col };
    }

    /** SGF 属性值转义（只有 \ 和 ] 需要处理） */
    function escapeSgfValue(s) {
        return String(s).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    }

    /* ---------- 终局文案 ↔ RE ---------- */

    /** 「黑方超时，白胜」这类文案里，取「胜」前最后一个分隔符之后那一段的颜色字 */
    function winColorOfResultText(text) {
        if (typeof text !== 'string' || !text) return null;
        const winIdx = text.lastIndexOf('胜');
        if (winIdx < 0) return null;
        const head = text.slice(0, winIdx);
        let cut = -1;
        for (const sep of ['，', ',', '、', '：', ':']) cut = Math.max(cut, head.lastIndexOf(sep));
        const segment = cut >= 0 ? head.slice(cut + 1) : head;
        const hit = /[黑白红绿蓝]/.exec(segment);
        if (hit) return hit[0];
        const all = head.match(/[黑白红绿蓝]/g);
        return all ? all[all.length - 1] : null;
    }

    /** 站内终局文案 → SGF 的 RE（拿不到颜色就写 B+ / W+，目数拿不到不带数字） */
    function resultTextToRe(text) {
        if (typeof text !== 'string' || !text) return null;
        if (text === 'draw' || text.includes('和')) return '0';
        const color = winColorOfResultText(text);
        if (color === '黑') return 'B+';
        if (color === '白') return 'W+';
        const point = /(黑|白)\s*胜\s*([\d.]+)\s*点/.exec(text);
        if (point) return (point[1] === '黑' ? 'B+' : 'W+') + point[2].replace(/0+$/, '').replace(/\.$/, '');
        return null;
    }

    /** SGF 的 RE → 站内终局文案（用站内既有词表，保证导入折座位与 JSON 路径一致） */
    function reToResultText(re) {
        if (typeof re !== 'string' || !re) return null;
        const v = re.trim();
        if (v === '0' || /^Draw$/i.test(v) || v === '和棋') return '和棋';
        const m = /^([BW])\+?(.*)$/.exec(v);
        if (!m) return null;
        const side = m[1] === 'B' ? '黑' : '白';
        const tail = (m[2] || '').trim();
        if (!tail || /^R$/i.test(tail)) return `${side}胜`;
        if (/^T$/i.test(tail)) return `${side === '黑' ? '白' : '黑'}方超时，${side}胜`;
        if (/^Resign$/i.test(tail)) return `${side === '黑' ? '白' : '黑'}方认输，${side}胜`;
        if (/^[\d.]+$/.test(tail)) return `${side}胜${Number(tail).toFixed(2).replace(/0$/, '')}点`;
        return `${side}胜`;
    }

    /* ---------- 记录 → SGF ---------- */

    const MOVE_RE = /^([BW])(?:(\d+),(\d+)(?:@[^@]*)?|(p))$/;

    /**
     * 这一盘能不能表达成 SGF（棋种白名单 + 记录级闸门）。
     * 返回 { ok: true } 或 { ok: false, reason }
     */
    function canExportSgf(record, gameId) {
        const id = gameId || (record && (record.gameId || record.gameType));
        if (!id || !SGF_GAMES.has(String(id))) return { ok: false, reason: '该棋种不支持 SGF' };
        if (!record || typeof record !== 'object') return { ok: false, reason: '没有棋谱' };
        const size = Number(record.boardSize);
        if (!Number.isInteger(size) || size < 1 || size > 52) return { ok: false, reason: '路数超出 SGF 能表达的范围（1–52）' };
        const moves = Array.isArray(record.moves) ? record.moves : [];
        for (const entry of moves) {
            const m = typeof entry === 'string' ? MOVE_RE.exec(entry) : null;
            if (!m) return { ok: false, reason: '着法含本站特有信息（交换/踩雷/翻洞/复合子等），SGF 表达不了' };
            if (m[4] !== 'p') {
                const row = Number(m[2]);
                const col = Number(m[3]);
                if (!(row >= 0 && row < size && col >= 0 && col < size)) return { ok: false, reason: '着法坐标越界' };
            }
        }
        return { ok: true };
    }

    /** 站内 record → SGF 文本（routeToSgf 只写能表达的部分，特殊状态丢弃） */
    function recordToSgf(record, opts) {
        opts = opts || {};
        const id = String(opts.gameId || record.gameId || record.gameType || '');
        const size = Number(record.boardSize) || 19;
        const gm = GM4.has(id) ? 4 : 1;
        const head = ['(;GM[' + gm + ']', 'FF[4]', 'CA[UTF-8]', 'AP[muzei:1]'];
        head.push('SZ[' + size + ']');
        const komi = Number(record.komi);
        if (Number.isFinite(komi) && Math.abs(komi) <= 100) head.push('KM[' + komi + ']');
        if (id) head.push('RU[' + escapeSgfValue('muzei/' + id) + ']');
        const name = opts.gameName || record.gameType;
        if (name) head.push('GN[' + escapeSgfValue(String(name)) + ']');
        const players = record.players || {};
        if (players.player1) head.push('PB[' + escapeSgfValue(players.player1) + ']');
        if (players.player2) head.push('PW[' + escapeSgfValue(players.player2) + ']');
        const re = resultTextToRe(record.result) || resultTextToRe(record.resultText);
        if (re) head.push('RE[' + re + ']');
        const d = opts.date instanceof Date ? opts.date : new Date();
        const pad = (n) => String(n).padStart(2, '0');
        head.push(`DT[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}]`);   // 本地日期，别用 UTC

        const ab = [];
        const aw = [];
        const init = Array.isArray(record.initialPosition) ? record.initialPosition : [];
        for (const entry of init) {
            if (typeof entry !== 'string' || entry.length < 4) continue;
            const kind = entry[0];
            if (kind !== 'B' && kind !== 'W') continue;   // 中立子/洞/桥/雷丢掉
            const parts = entry.slice(1).split(',');
            const pt = encodePoint(Number(parts[0]), Number(parts[1]), size);
            if (!pt) continue;
            (kind === 'B' ? ab : aw).push(pt);
        }
        if (ab.length) head.push('AB' + ab.map((p) => '[' + p + ']').join(''));
        if (aw.length) head.push('AW' + aw.map((p) => '[' + p + ']').join(''));
        if (ab.length || aw.length) head.push('PL[B]');   // 摆了子也别让阅读器判成白先

        const body = [];
        const moves = Array.isArray(record.moves) ? record.moves : [];
        for (const entry of moves) {
            const m = MOVE_RE.exec(String(entry));
            if (!m) continue;
            const color = m[1];
            if (m[4] === 'p') body.push(';' + color + '[]');
            else {
                const pt = encodePoint(Number(m[2]), Number(m[3]), size);
                if (pt) body.push(';' + color + '[' + pt + ']');
            }
        }
        return head.join('') + body.join('') + ')\n';
    }

    /* ---------- SGF → 记录 ---------- */

    /**
     * 最小 SGF 解析：只走主线（第一个分支），其余分支（variations）跳过。
     * 返回 { root, nodes, skippedVariations } 或 { error }
     */
    function parseSgf(text) {
        if (typeof text !== 'string') return { error: '不是有效的 SGF 文件' };
        let s = text.replace(/^﻿/, '').trim();
        if (!s) return { error: 'SGF 内容为空' };
        if (s[0] !== '(') return { error: '不是有效的 SGF 文件（应以 ( 开头）' };
        let i = 0;
        const root = {};
        const nodes = [root];   // 第一个 ';' 的节点就是根节点（SGF 的属性都在它上面）
        let current = root;
        let skippedVariations = 0;
        let sawNode = false;

        function skipBranch() {
            // i 指向 '('：完整跳过一棵子树（要配平括号与转义）
            let depth = 0;
            while (i < s.length) {
                const ch = s[i];
                if (ch === '\\') { i += 2; continue; }
                if (ch === '[') { while (i < s.length && s[i] !== ']') { if (s[i] === '\\') i++; i++; } }
                else if (ch === '(') depth++;
                else if (ch === ')') { depth--; if (depth === 0) { i++; return true; } }
                i++;
            }
            return false;
        }

        /**
         * 解析一层节点序列（i 指向 '(' 之后）。
         * SGF 里「节点的第一个子树」是主线的继续，后面的子树才是变着 → 第一个进去、其余整棵跳过。
         */
        function parseNodeSequence() {
            let tookContinuation = false;
            while (i < s.length) {
                const ch = s[i];
                if (ch === ';') {
                    i++;
                    if (!sawNode) sawNode = true;   // 第一个 ';'：属性落在根节点上（nodes[0] 就是 root）
                    else { current = {}; nodes.push(current); }
                    continue;
                }
                if (ch === '(') {
                    if (!tookContinuation) {
                        tookContinuation = true;
                        i++;   // 吃掉 '('
                        if (!parseNodeSequence()) return false;
                        continue;
                    }
                    const before = i;
                    if (!skipBranch()) return false;
                    if (before !== i) skippedVariations++;
                    continue;
                }
                if (ch === ')') { i++; return true; }
                const idm = /^([A-Za-z]+)/.exec(s.slice(i));
                if (!idm) { i++; continue; }
                const key = idm[1].toUpperCase();
                i += idm[1].length;
                const values = [];
                let unclosed = false;
                while (i < s.length && s[i] === '[') {
                    i++;
                    let val = '';
                    let closedValue = false;
                    while (i < s.length) {
                        const c = s[i];
                        if (c === '\\') {
                            const nxt = s[i + 1];
                            if (nxt === '\n' || nxt === '\r') { i += 2; continue; }   // 续行
                            val += nxt === undefined ? '' : nxt;
                            i += 2;
                            continue;
                        }
                        if (c === ']') { i++; closedValue = true; break; }
                        val += c;
                        i++;
                    }
                    if (!closedValue) { unclosed = true; break; }
                    values.push(val.replace(/\r\n?/g, '\n'));
                }
                if (unclosed) return 'unclosed';
                if (!values.length) continue;
                current[key] = (current[key] || []).concat(values);
            }
            return false;   // 括号没闭合
        }

        // 外层：一个或多个游戏树，只取第一个
        while (i < s.length && s[i] !== '(') i++;
        if (i >= s.length) return { error: '不是有效的 SGF 文件（找不到游戏树）' };
        i++;   // 吃掉 '('
        const closed = parseNodeSequence();
        if (closed === 'unclosed') return { error: 'SGF 属性值未闭合' };
        if (closed !== true) return { error: 'SGF 括号不配对' };
        if (!sawNode) return { error: '不是有效的 SGF 文件（没有节点）' };
        return { root, nodes, skippedVariations };
    }

    function recordSizeOf(szValue) {
        if (typeof szValue !== 'string' || !szValue) return 19;
        const m = /^(\d+)(?::(\d+))?$/.exec(szValue.trim());
        if (!m) return NaN;
        const w = Number(m[1]);
        const h = m[2] === undefined ? w : Number(m[2]);
        if (w !== h) return NaN;
        return w;
    }

    /**
     * SGF 文本 → 站内 record。
     *  opts.gameId：房间里的目标棋种（强制）；没有则用 optt.resolveGameId(markers) 或标记解析
     * 返回 { ok: true, record, gameId, warnings } 或 { ok: false, error }
     */
    function sgfToRecord(text, opts) {
        opts = opts || {};
        const parsed = parseSgf(text);
        if (parsed.error) return { ok: false, error: parsed.error };
        const { root, nodes, skippedVariations } = parsed;
        const first = (key) => (root[key] && root[key][0] !== undefined ? root[key][0] : null);
        const warnings = [];
        if (skippedVariations > 0) warnings.push(`已忽略 ${skippedVariations} 处分支（只取主线）`);

        const gmRaw = first('GM');
        const gm = gmRaw == null || gmRaw === '' ? 1 : Number(gmRaw);
        if (!ALLOWED_GM.has(gm)) return { ok: false, error: `暂不支持该 SGF 棋种（GM[${gmRaw}]）` };

        const size = recordSizeOf(first('SZ'));
        if (!Number.isFinite(size) || size < 1 || size > 52)
            return { ok: false, error: '棋盘路数不支持（要求 1–52 的方形盘，SZ[a:b] 这类非方形盘表达不了）' };

        const haRaw = first('HA');
        const ha = haRaw == null ? 0 : Number(haRaw) || 0;
        const plRaw = (first('PL') || '').toUpperCase();
        const hasStones = (key) => Array.isArray(root[key]) && root[key].length > 0;
        for (let n = 1; n < nodes.length; n++) {
            const node = nodes[n];
            if (node.AB || node.AW || node.AE)
                return { ok: false, error: '该棋谱在中盘设置了棋子（AB/AW/AE），本站无法表达' };
        }
        if (plRaw === 'W' && !hasStones('AB'))
            return { ok: false, error: '该棋谱是白先（PL[W]），本站棋谱按记录首手颜色重放，表达不了' };
        if (ha >= 2 && plRaw !== 'B' && !hasStones('AB'))
            return { ok: false, error: '该棋谱是让子白先（HA≥2），本站棋谱表达不了' };

        const initialPosition = [];
        for (const [key, kind] of [['AB', 'B'], ['AW', 'W']]) {
            for (const v of root[key] || []) {
                for (const one of String(v).split(/\s+/)) {
                    if (!one) continue;
                    const pt = decodePoint(one, size);
                    if (!pt) return { ok: false, error: `摆子坐标越界或非法（${key}[${one}]）` };
                    initialPosition.push(`${kind}${pt.row},${pt.col}`);
                }
            }
        }

        const moves = [];
        let passUsed = false;
        for (let n = 1; n < nodes.length; n++) {
            const node = nodes[n];
            for (const color of ['B', 'W']) {
                if (!node[color]) continue;
                const raw = String(node[color][0] || '').trim();
                if (raw === '' || (size <= 19 && raw.toLowerCase() === 'tt')) {
                    moves.push(color + 'p');
                    passUsed = true;
                    continue;
                }
                const pt = decodePoint(raw, size);
                if (!pt) return { ok: false, error: `第 ${moves.length + 1} 手坐标非法或越界（${raw}）` };
                moves.push(`${color}${pt.row},${pt.col}`);
            }
        }

        // 棋种：房间指定 > 标记（RU[muzei/<id>]）> 名字匹配 > GM 缺省
        let gameId = opts.gameId ? String(opts.gameId) : null;
        if (!gameId) {
            const ru = first('RU') || '';
            const marked = /muzei\/([A-Za-z0-9-]+)/.exec(ru);
            if (marked) gameId = marked[1];
            else if (typeof opts.resolveGameId === 'function')
                gameId = opts.resolveGameId({ gm, ru, gn: first('GN') || '' }) || null;
            if (!gameId) gameId = gm === 4 ? 'wuziqi' : 'weiqi';
        }
        if (SGF_IMPORT_REFUSE[gameId]) return { ok: false, error: SGF_IMPORT_REFUSE[gameId] };
        if (passUsed && SGF_NO_PASS.has(gameId))
            return { ok: false, error: '该棋谱含虚着，本棋种不支持虚着' };

        const komiRaw = first('KM');
        const komi = komiRaw == null ? undefined : Number(komiRaw);
        const resultText = reToResultText(first('RE') || '');
        if (resultText && /和/.test(resultText) === false && !/胜/.test(resultText)) warnings.push('未识别 SGF 的结果字段（RE）');

        const record = {
            format: 'muzei',
            version: 1,
            gameId,
            boardSize: size,
            initialPosition,
            moves,
            timeControl: null
        };
        if (Number.isFinite(komi)) record.komi = komi;
        if (resultText) {
            record.result = resultText;
            record.resultText = resultText;
        }
        return { ok: true, record, gameId, warnings };
    }

    return {
        SGF_GAMES,
        SGF_NO_PASS,
        SGF_IMPORT_REFUSE,
        GM4,
        canExportSgf,
        recordToSgf,
        sgfToRecord,
        parseSgf,
        encodePoint,
        decodePoint,
        sgfLetter,
        sgfLetterIndex,
        escapeSgfValue,
        resultTextToRe,
        reToResultText,
        winColorOfResultText
    };
});
