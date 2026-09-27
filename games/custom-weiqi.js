/**
 * 自定义围棋（custom-weiqi）：标准围棋 + 可自由组合的变体规则。
 * 变体：短气（提子阈值 minLib = 2/3/4，即短一气/短二气/短三气）、
 *       磁性（弱/中/强，照磁性围棋）、
 *       附加物（洞/桥/中立子/雷，照洞围棋、桥围棋、中立子围棋、全家福围棋）、
 *       贪吃（照贪吃围棋）。
 * 附加物与磁力的关系（用户口径）：
 *   洞：挡住吸引/排斥射线；被推动的棋子遇到洞即停。
 *   桥：射线可跨越；被推动的棋子可跨桥（跳过连续桥格）。
 *   中立子：弱磁性挡射线；中/强磁性可跨越施加磁力；被推动时遇中立子即停。
 *   雷：射线可跨越；被推动时遇雷即停。
 *   任何附加物都不会因磁力移动；棋子（落子与移动）都不能停在附加物格上。
 * 客户端 public/room-plugins/custom-weiqi-room.js 内有一份等价规则实现（试下/乐观落子用）。
 */
const { QiTwoPlayerRoomBase, qiProtocol, qiMatchTimeControl, squareWeiqiRules, gridGraphWeiqiRules, applyInitialPositionCompact, encodeInitialPositionCompact, qiBoardSeatOverlay, encodeOpeningPositionCompact } = require('../common');
// 非方格棋盘的几何：六角/花形的顶点图与邻居表直接复用非四角围棋的生成器（同一份棋盘数据）
const { generateHexBoardData, generateFloretPentBoardData } = require('./non-rectangular-weiqi.js');

/** 附加物取值（与公共层 encodeInitialPositionCompact 的 H/N/I/M 字母代号一致） */
const HOLE = -1;
const BRIDGE = -2;
const MINE = -3;
const NEUTRAL = 10000;

/** 附加物表：数组顺序即生成顺序（洞 → 桥 → 中立子 → 雷） */
const EXTRAS_META = [
    { key: 'hole', value: HOLE },
    { key: 'bridge', value: BRIDGE },
    { key: 'neutral', value: NEUTRAL },
    { key: 'mine', value: MINE }
];
const EXTRA_KEYS = EXTRAS_META.map((e) => e.key);
/** 只勾选一种附加物时占棋盘 8.3%，勾选多种时每种占 5% */
const SINGLE_EXTRA_RATIO = 0.083;
const MULTI_EXTRA_RATIO = 0.05;

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * 「对称点」可选用的对称（与对称围棋 games/symmetry-weiqi.js 同一套口径，客户端插件里亦有一份映射）：
 *   轴对称四种 horizontal/vertical/diag1/diag2；旋转三种 rotate90cw/rotate90ccw/rotate180
 */
const SYMMETRY_TYPES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
/** 启用的对称（要停用某几种就删掉；目前七种全启用） */
const ENABLED_SYMMETRIES = ['horizontal', 'vertical', 'diag1', 'diag2', 'rotate90cw', 'rotate90ccw', 'rotate180'];
/** 「对称点」的第 1、2 手固定用主对角/反对角（同对称围棋） */
const OPENING_SYMMETRIES = ['diag1', 'diag2'];
/**
 * 按形状停用的对称（非方格形状的对称 id 形如 mirror0 / rot180，由几何实测得出）。
 * 花形五角实测只有旋转 180° 一种对称（花瓣整体偏 10.893°，中位线不成立），这里无需停用任何项。
 */
const DISABLED_SHAPE_SYMMETRIES = [];

/** 「不邻前手」的四种模式（+ none 不启用）；own = 参考己方上一手；near = 含四个斜角（八格） */
const PREV_RULES = {
    none: { own: false, near: false, label: '无' },
    adjacent: { own: false, near: false, label: '不邻前手' },
    'adjacent-own': { own: true, near: false, label: '不邻己方前手' },
    near: { own: false, near: true, label: '不近前手' },
    'near-own': { own: true, near: true, label: '不近己方前手' }
};
const PREV_RULE_KEYS = Object.keys(PREV_RULES);

function emptyBoard(size) {
    return Array(size).fill().map(() => Array(size).fill(0));
}

function copyGrid(src) {
    return src.map((row) => row.slice());
}

function gridToString(board) {
    return board.map((row) => row.join(',')).join(';');
}

/** 默认规则：全部「无/不勾」= 普通围棋 */
function defaultCustomConfig() {
    return {
        minLib: 1,
        magnetism: 'none',
        extras: { hole: false, bridge: false, neutral: false, mine: false },
        greedy: false,
        symmetry: false,          // 对称点：每手随机一种对称，在对称点同时落子
        prevRule: 'none',         // 不邻前手：四种模式之一（none = 不启用）
        boardShape: 'square'      // 棋盘形状（对话框最上方）
    };
}

/**
 * 棋盘形状：square 四角（默认，现有方格棋盘）、triangle 三角、snub 扭棱四角、cairo 开罗五角、
 * floret 花形五角、hexagon 六角。后五种沿用相应棋类的棋盘几何（三角取三角围棋的六角三角子棋类）。
 * 路数范围/默认值：四角 7～99 默认 19；三角 3～11 默认 9；扭棱四角/开罗五角/花形五角 3～9 默认 7；六角 4～11 默认 9。
 * 贴目：四角按普通围棋口径（≤8 路 4.25，其余 3.25），其余形状一律 3.25。
 * 磁性只在 square / triangle 生效；桥只在 square / triangle 生成（其它形状勾了也不生成、不提示）。
 */
const BOARD_SHAPES = ['square', 'triangle', 'snub', 'cairo', 'floret', 'hexagon'];
const SHAPE_META = {
    square: { label: '四角', min: 7, max: 99, def: 19, magnetism: true, bridge: true },
    triangle: { label: '三角', min: 3, max: 11, def: 9, magnetism: true, bridge: true },
    snub: { label: '扭棱四角', min: 3, max: 9, def: 7, magnetism: false, bridge: false },
    cairo: { label: '开罗五角', min: 3, max: 9, def: 7, magnetism: false, bridge: false },
    floret: { label: '花形五角', min: 3, max: 9, def: 7, magnetism: false, bridge: false },
    hexagon: { label: '六角', min: 4, max: 11, def: 9, magnetism: false, bridge: false }
};
function shapeMeta(shape) {
    return SHAPE_META[shape] || SHAPE_META.square;
}

/* ============================ 棋盘形状几何（非方格） ============================ */

/**
 * 各形状棋盘的点集与邻接。约定：
 *   points[i]  = [x, y] 屏幕单位坐标（x 向右、y 向下；与客户端绘制方向一致），等比缩放到画布由客户端做
 *   coord[i]   = [行, 列] 协议坐标（棋谱/消息与相邻棋种同口径；三角沿用六角三角的行列）
 *   neighbors  = 每点的相邻点下标
 * 来源：三角 = 三角围棋的六角三角子棋类；六角/花形 = 顶点图生成器（邻居与显示坐标直接复用
 *   games/non-rectangular-weiqi.js 的导出，顶点坐标按同款算法复算）；开罗/扭棱 = 掩码网格，
 *   与客户端 buildCairoLayout / buildSnubLayout 的坐标同源。
 */

/** 三角（六角三角）：行 0 在屏幕最下方，点距 1、行距 √3/2，六个方向相邻 */
function triangleGeom(lanes) {
    const ROWS = 2 * lanes - 1;
    const rowLen = (r) => lanes + Math.min(r, 2 * lanes - 2 - r);
    const points = [], coord = [], idx = new Map();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < rowLen(r); c++) {
            idx.set(r * ROWS + c, points.length);
            points.push([c - (rowLen(r) - 1) / 2, (ROWS - 1 - r) * (Math.sqrt(3) / 2)]);
            coord.push([r, c]);
        }
    }
    const at = (r, c) => idx.get(r * ROWS + c);
    const neighbors = coord.map(([r, c]) => {
        const out = [];
        const push = (nr, nc) => { if (nr >= 0 && nr < ROWS && nc >= 0 && nc < rowLen(nr)) out.push(at(nr, nc)); };
        push(r, c - 1); push(r, c + 1);
        if (r > 0) { if (rowLen(r - 1) > rowLen(r)) { push(r - 1, c); push(r - 1, c + 1); } else { push(r - 1, c - 1); push(r - 1, c); } }
        if (r < ROWS - 1) { if (rowLen(r + 1) > rowLen(r)) { push(r + 1, c); push(r + 1, c + 1); } else { push(r + 1, c - 1); push(r + 1, c); } }
        return out;
    });
    return { points, coord, neighbors, rows: ROWS, cols: ROWS };
}

/** 六角：顶点图（顶点坐标与 generateHexBoardData 逐行一致，末尾整体 90° 旋转） */
function hexVertexPoints(lanes) {
    const S = lanes - 1, R = 2, sqrt3 = Math.sqrt(3);
    const vertexMap = new Map(), vertices = [];
    const dx = [R, R / 2, -R / 2, -R, -R / 2, R / 2];
    const dy = [0, R * sqrt3 / 2, R * sqrt3 / 2, 0, -R * sqrt3 / 2, -R * sqrt3 / 2];
    for (let q = -(S - 1); q <= S - 1; q++) {
        for (let r = -(S - 1); r <= S - 1; r++) {
            const s = -q - r;
            if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > S - 1) continue;
            const cx = R * (3 / 2) * q;
            const cy = R * sqrt3 * (r + q / 2);
            for (let j = 0; j < 6; j++) {
                const x = cx + dx[j], y = cy + dy[j];
                const key = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
                if (!vertexMap.has(key)) { vertexMap.set(key, vertices.length); vertices.push({ x, y }); }
            }
        }
    }
    return vertices.map((v) => ({ x: -v.y, y: v.x }));
}

/** 花形五角：顶点图（顶点坐标与 generateFloretPentBoardData 逐行一致，末尾整体 90° 旋转） */
function floretVertexPoints(lanes) {
    const sqrt3 = Math.sqrt(3), sigma = sqrt3 / 2;
    const pent = { A: [0, 0], B: [-1, sqrt3], C: [-2, sqrt3], D: [-2.5, sqrt3 / 2], E: [-2, 0] };
    const rot = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * p[0] - s * p[1], s * p[0] + c * p[1]]; };
    const ux = 1.5 * Math.sqrt(7), vy = 1.5 * Math.sqrt(21);
    const vertexMap = new Map(), vertices = [];
    const add = (x, y) => {
        const k = `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
        if (!vertexMap.has(k)) { vertexMap.set(k, vertices.length); vertices.push({ x, y }); }
    };
    const addFlower = (px, py) => {
        const ox = px * ux, oy = py * vy;
        for (let pet = 0; pet < 6; pet++) {
            for (const key of ['A', 'B', 'C', 'D', 'E']) {
                const q = rot(pent[key], pet * Math.PI / 3 - Math.atan(sqrt3 / 9));
                add(q[0] * sigma + ox, q[1] * sigma + oy);
            }
        }
    };
    for (let i = 0; i <= sqrt3 * lanes - 3; i++) for (let j = 0; j <= lanes - 2; j++) addFlower(i, j);
    for (let i = 0; i <= sqrt3 * lanes - 4; i++) for (let j = 0; j <= lanes - 3; j++) addFlower(i + 0.5, j + 0.5);
    return vertices.map((v) => ({ x: -v.y, y: v.x }));
}

/** 顶点图（六角/花形）：生成器给邻居与显示坐标，顶点坐标由上面两个复算函数提供，两者逐点对齐 */
function vertexGraphGeom(gen, lanes, verts) {
    const { neighbors, koordOf } = gen(lanes);
    const n = koordOf.length;
    if (verts.length !== n) throw new Error(`顶点图点数不一致：生成器 ${n}、复算 ${verts.length}（路数 ${lanes}）`);
    const points = [], coord = [];
    for (let v = 0; v < n; v++) {
        points.push([verts[v].x, -verts[v].y]);   // 客户端显示上下翻折（y 镜像）
        coord.push(koordOf[v]);
    }
    let rows = 0, cols = 0;
    for (const rc of coord) { if (rc[0] + 1 > rows) rows = rc[0] + 1; if (rc[1] + 1 > cols) cols = rc[1] + 1; }
    return { points, coord, neighbors: neighbors.map((l) => l.slice()), rows, cols };
}

/** 开罗五角：掩码网格，坐标与客户端 vertexUnitPos 同源（行号翻转：row=0 在底部） */
function cairoGeom(lanes) {
    const gw = 4 * lanes - 5, gh = 4 * lanes - 3;
    const h = Math.sqrt(3) / 2, WG = 0.5;
    const isValid = (r, c) => r >= 0 && c >= 0 && r < gw && c < gh && !((r & 1) === 1 && (c & 1) === 0);
    const unit = (row, col) => {
        let y = row * h;
        if ((row & 1) === 0) {
            const rm = row & 3, cm = col & 3;
            if (rm === 0) { if (cm === 2) y -= WG; else if (cm === 0) y += WG; }
            else if (rm === 2) { if (cm === 0) y -= WG; else if (cm === 2) y += WG; }
        }
        let x = col * h;
        if ((col & 1) === 1) {
            const rm = row & 3, cm = col & 3;
            if (cm === 1) { if (rm === 3) x -= WG; else if (rm === 1) x += WG; }
            else if (cm === 3) { if (rm === 3) x += WG; else if (rm === 1) x -= WG; }
        }
        return [x, y];
    };
    return maskGridGeom(gw, gh, isValid, (r, c) => {
        const arr = [];
        if ((c & 1) === 1) arr.push([r - 1, c], [r + 1, c]);
        if ((r & 1) === 0) arr.push([r, c - 1], [r, c + 1]);
        const rm = r & 3, cm = c & 3;
        if (rm === 1) { if (cm === 1) arr.push([r, c + 2]); else if (cm === 3) arr.push([r, c - 2]); }
        else if (rm === 3) { if (cm === 3) arr.push([r, c + 2]); else if (cm === 1) arr.push([r, c - 2]); }
        if (cm === 0) { if (rm === 0) arr.push([r + 2, c]); else if (rm === 2) arr.push([r - 2, c]); }
        else if (cm === 2) { if (rm === 2) arr.push([r + 2, c]); else if (rm === 0) arr.push([r - 2, c]); }
        return arr;
    }, (r, c) => unit(gw - 1 - r, c));
}

/** 扭棱四角：掩码网格，坐标与客户端 buildSnubLayout 同源（末尾顺时针 90° + 上下翻折） */
function snubGeom(lanes) {
    const gw = 3 * lanes - 2, gh = gw;
    const SM = 1, MID = Math.sqrt(3) * SM, LG = 2 * SM;
    const colW = (i) => (i % 3 === 2) ? LG : MID;
    const rowH = (i) => (i % 3 === 2) ? LG : MID;
    const cum = (f, k) => { let s = 0; for (let i = 0; i < k; i++) s += f(i); return s; };
    const spanW = (gc, span) => { let w = 0; for (let i = 0; i < span; i++) w += colW(gc + i); return w; };
    const spanH = (gr, span) => { let h = 0; for (let i = 0; i < span; i++) h += rowH(gr + i); return h; };
    const cellSpan = (r, c) => {
        let colOff = 0, colSpan = 1, rowOff = 0, rowSpan = 1;
        if (r % 3 === 0 && c % 3 !== 1) { colOff = -1; colSpan = 2; }
        if (r % 3 >= 1 && c % 3 === 0) { colOff = -1; colSpan = 2; rowOff = -1; rowSpan = 2; }
        if (r % 3 !== 1 && c % 3 === 1) { colOff = 0; colSpan = 1; }
        if (r % 3 === 1 && c % 3 >= 1) { rowOff = -1; rowSpan = 2; }
        return { colOff, colSpan, rowOff, rowSpan };
    };
    const margins = (r, c) => {
        const a = r % 3, b = c % 3;
        if (a === 0 && b === 0) return { L: MID, T: SM, R: MID, B: MID - SM };
        if (a === 0 && b === 1) return { L: SM, T: SM, R: MID - SM, B: SM };
        if (a === 0 && b === 2) return { L: MID, T: MID - SM, R: MID, B: SM };
        if (a === 1 && b === 0) return { L: MID, T: MID, R: LG, B: MID };
        if (a === 1 && b === 1) return { L: SM, T: MID, R: SM, B: LG };
        if (a === 1 && b === 2) return { L: SM, T: LG, R: SM, B: MID };
        if (a === 2 && b === 0) return { L: LG, T: MID, R: MID, B: MID };
        if (a === 2 && b === 1) return { L: MID - SM, T: SM, R: SM, B: SM };
        return null;
    };
    const isValid = (r, c) => {
        if (r < 0 || c < 0 || r >= gw || c >= gh) return false;
        if (r % 3 === 2 && c % 3 === 2) return false;
        if (r === gw - 1 && r % 3 === 0 && c % 3 === 1) return false;
        if (c === gh - 1 && r % 3 === 0 && c % 3 === 0) return false;
        return true;
    };
    const rawPos = (r, c) => {
        const sp = cellSpan(r, c);
        const gridCol = 1 + sp.colOff + r, gridRow = 1 + sp.rowOff + c;
        const m = margins(r, c);
        if (!m) return null;
        const Wp = spanW(gridCol, sp.colSpan), Hp = spanH(gridRow, sp.rowSpan);
        return [cum(colW, gridCol) + m.L + (Wp - m.L - m.R) / 2, cum(rowH, gridRow) + m.T + (Hp - m.T - m.B) / 2];
    };
    return maskGridGeom(gw, gh, isValid, (r, c) => {
        if (r % 3 === 0 && c % 3 === 0) return [[r - 1, c], [r - 1, 1 + c], [r, c - 1], [r, 1 + c], [1 + r, c]];
        if (r % 3 === 1 && c % 3 === 0) return [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, 1 + c], [1 + r, c]];
        if (r % 3 === 2 && c % 3 === 0) return [[r - 1, c - 1], [r - 1, c], [r - 1, 1 + c], [1 + r, c - 1], [1 + r, c]];
        if (r % 3 === 0 && c % 3 === 1) return [[r - 1, c], [r, c - 1], [r, 1 + c], [1 + r, c], [1 + r, 1 + c]];
        if (r % 3 === 1 && c % 3 === 1) return [[r - 1, c], [r, c - 1], [r, 1 + c], [1 + r, c - 1], [1 + r, c]];
        if (r % 3 === 2 && c % 3 === 1) return [[r - 1, c], [r - 1, 1 + c], [1 + r, c - 1], [1 + r, c], [1 + r, 1 + c]];
        if (r % 3 === 0 && c % 3 === 2) return [[r - 1, c - 1], [r - 1, 1 + c], [r, c - 1], [r, 1 + c], [1 + r, 1 + c]];
        return [[r - 1, c - 1], [r, c - 1], [r, 1 + c], [1 + r, c - 1], [1 + r, 1 + c]];
    }, rawPos, (p) => {
        // rotCW90（绕 300,300）之后上下翻折
        const p2 = { x: 300 - (p[1] - 300), y: 300 + (p[0] - 300) };
        return [p2.x, 600 - p2.y];
    });
}

/** 掩码网格通用：按有效性/邻居/坐标函数造点集（无效格与坐标为空的格都不收） */
function maskGridGeom(gw, gh, isValid, neighborList, unitPos, post) {
    const points = [], coord = [], idx = new Map();
    for (let r = 0; r < gw; r++) {
        for (let c = 0; c < gh; c++) {
            if (!isValid(r, c)) continue;
            let p = unitPos(r, c);
            if (!p) continue;
            if (post) p = post(p);
            idx.set(r * gh + c, points.length);
            points.push(p);
            coord.push([r, c]);
        }
    }
    // 越界一律当无键（否则 c = -1 会串到上一行行尾，出现跨界假邻接）
    const at = (r, c) => (r >= 0 && c >= 0 && r < gw && c < gh ? idx.get(r * gh + c) : undefined);
    const neighbors = coord.map(([r, c]) => {
        const out = [];
        for (const [nr, nc] of neighborList(r, c)) {
            const k = at(nr, nc);
            if (k !== undefined) out.push(k);
        }
        return out;
    });
    return { points, coord, neighbors, rows: gw, cols: gh };
}

/**
 * 棋盘的全部对称（不含恒等）：境轴对称与旋转，附「点 → 点」置换表。
 * 候选角由「边方向集合」完备推出——旋转 ρ 必须把边方向集合映到自身 ⇒ ρ ∈ {dᵢ − dⱼ}；
 * 镜像轴 α 同理 ⇒ 2α ∈ {dᵢ + dⱼ}。再逐点做容差匹配、双射与邻接保持校验。
 * （花形五角的边方向带 atan(√3/9)≈10.893° 的整体偏角，若按「相邻方向间隔」取步长会漏掉真对称。）
 */
function boardSymmetries(points, neighbors) {
    const n = points.length;
    const cx = points.reduce((a, p) => a + p[0], 0) / n;
    const cy = points.reduce((a, p) => a + p[1], 0) / n;
    const rel = points.map((p) => [p[0] - cx, p[1] - cy]);
    const dirs = [];
    for (let i = 0; i < n; i++) {
        for (const j of neighbors[i]) {
            const a = Math.atan2(points[j][1] - points[i][1], points[j][0] - points[i][0]);
            const m = ((a % Math.PI) + Math.PI) % Math.PI;
            if (!dirs.some((d) => Math.abs(d - m) < 1e-6 || Math.abs(Math.abs(d - m) - Math.PI) < 1e-6)) dirs.push(m);
        }
    }
    const canon = (a) => { let x = a % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x; };
    const dirs360 = [];
    for (const d of dirs) dirs360.push(d, canon(d + Math.PI));
    const cand = [];
    for (const di of dirs360) {
        for (const dj of dirs360) {
            cand.push({ kind: 'rot', angle: canon(di - dj) });
            cand.push({ kind: 'mir', angle: canon(di + dj) });
        }
    }
    const uniq = [];
    for (const c of cand) {
        if (uniq.some((s) => s.kind === c.kind && Math.abs(s.angle - c.angle) < 1e-9)) continue;
        uniq.push(c);
    }
    const BS = 1e-3;
    const bucket = new Map();
    for (let i = 0; i < n; i++) {
        const k = Math.round(points[i][0] / BS) + ',' + Math.round(points[i][1] / BS);
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(i);
    }
    const match = (x, y) => {
        const bx = Math.round(x / BS), by = Math.round(y / BS);
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                const list = bucket.get((bx + dx) + ',' + (by + dy));
                if (!list) continue;
                for (const i of list) if (Math.abs(points[i][0] - x) <= 1e-4 && Math.abs(points[i][1] - y) <= 1e-4) return i;
            }
        }
        return -1;
    };
    const nbSets = neighbors.map((l) => new Set(l));
    const out = [];
    const seen = new Set();
    for (const c of uniq) {
        const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
        const perm = new Array(n).fill(-1);
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
            const [x, y] = rel[i];
            let tx, ty;
            if (c.kind === 'rot') { tx = x * cos - y * sin; ty = x * sin + y * cos; }
            else { tx = x * cos + y * sin; ty = x * sin - y * cos; }   // 关于角度 c.angle/2 的直线镜像
            const j = match(tx + cx, ty + cy);
            if (j < 0) ok = false; else perm[i] = j;
        }
        if (!ok || new Set(perm).size !== n) continue;
        for (let i = 0; i < n && ok; i++) {
            const j = perm[i];
            if (nbSets[i].size !== nbSets[j].size) { ok = false; break; }
            for (const k of nbSets[i]) if (!nbSets[j].has(perm[k])) { ok = false; break; }
        }
        if (!ok) continue;
        const fp = perm.join(',');
        if (seen.has(fp)) continue;
        seen.add(fp);
        const angleDeg = +(((c.kind === 'mir' ? c.angle / 2 : c.angle) * 180 / Math.PI) % 360).toFixed(4);
        if (c.kind === 'rot' && angleDeg < 1e-6) continue;   // 恒等不算一种对称
        out.push({
            id: (c.kind === 'mir' ? 'mirror' : 'rot') + String(Math.round(angleDeg)),
            kind: c.kind,
            angleDeg,
            perm
        });
    }
    return out;
}

/** 三角/六角前三手固定用的三条「角对角」镜轴：半径最大的三条，顺序 左上-右下 → 右上-左下 → 左-右 */
function cornerAxisIds(symmetries, points) {
    const n = points.length;
    const cx = points.reduce((a, p) => a + p[0], 0) / n;
    const cy = points.reduce((a, p) => a + p[1], 0) / n;
    const mirrors = symmetries.filter((s) => s.kind === 'mir');
    const withR = mirrors.map((s) => {
        const th = s.angleDeg * Math.PI / 180;
        const ux = Math.cos(th), uy = Math.sin(th);
        let r = 0;
        for (const p of points) {
            const v = Math.abs((p[0] - cx) * ux + (p[1] - cy) * uy);
            if (v > r) r = v;
        }
        return { s, r };
    });
    withR.sort((a, b) => b.r - a.r);
    if (withR.length < 3) return null;
    const three = withR.slice(0, 3).map((x) => x.s);
    const diagDown = three.find((s) => s.angleDeg > 1 && s.angleDeg < 89);
    const diagUp = three.find((s) => s.angleDeg > 91 && s.angleDeg < 179);
    const horizon = three.find((s) => s.angleDeg <= 1 || s.angleDeg >= 179);
    if (!diagDown || !diagUp || !horizon) return null;
    return [diagDown.id, diagUp.id, horizon.id];
}

const SHAPE_GEOM_CACHE = new Map();

/**
 * 非方格形状的几何：按形状与路数生成并缓存；同一份数据（去掉服务端专用的索引表后）下发给客户端，
 * 客户端不再复制几何生成器。方格形状（square）不用它。
 */
function buildShapeGeometry(shape, lanes) {
    const key = shape + ':' + lanes;
    const hit = SHAPE_GEOM_CACHE.get(key);
    if (hit) return hit;
    let raw;
    if (shape === 'triangle') raw = triangleGeom(lanes);
    else if (shape === 'hexagon') raw = vertexGraphGeom(generateHexBoardData, lanes, hexVertexPoints(lanes));
    else if (shape === 'floret') raw = vertexGraphGeom(generateFloretPentBoardData, lanes, floretVertexPoints(lanes));
    else if (shape === 'cairo') raw = cairoGeom(lanes);
    else if (shape === 'snub') raw = snubGeom(lanes);
    else throw new Error(`未知棋盘形状：${shape}`);
    const symmetries = boardSymmetries(raw.points, raw.neighbors);
    // 三角/六角：三条角对角轴按用户口径命名 diag1/diag2/diag3（左上-右下 → 右上-左下 → 左-右）
    const cornerIds = cornerAxisIds(symmetries, raw.points);
    if (cornerIds) {
        cornerIds.forEach((id, i) => {
            const sy = symmetries.find((s) => s.id === id);
            if (sy) sy.id = 'diag' + (i + 1);
        });
    }
    const ids = symmetries.map((s) => s.id);
    // 前三手（或前两手）固定的对称：三角/六角 = 三条角对角轴（顺序 = 左上-右下 → 右上-左下 → 左-右），
    // 其余形状 = 旋转 180°
    const openingAxes = cornerIds ? ['diag1', 'diag2', 'diag3']
        : (ids.includes('rot180') ? ['rot180', 'rot180'] : ids.slice(0, 2));
    const byId = new Map(symmetries.map((s) => [s.id, s]));
    let centerCell = raw.coord[0];
    {
        const cx = raw.points.reduce((a, p) => a + p[0], 0) / raw.points.length;
        const cy = raw.points.reduce((a, p) => a + p[1], 0) / raw.points.length;
        let best = Infinity;
        for (const p of raw.points) {
            const d = Math.hypot(p[0] - cx, p[1] - cy);
            if (d < best) { best = d; centerCell = raw.coord[raw.points.indexOf(p)]; }
        }
    }
    const index = new Map();
    for (let i = 0; i < raw.coord.length; i++) index.set(raw.coord[i][0] * raw.cols + raw.coord[i][1], i);
    const geom = {
        shape, lanes,
        rows: raw.rows, cols: raw.cols, count: raw.points.length,
        coord: raw.coord,
        points: raw.points,
        neighbors: raw.neighbors,
        symmetries, byId, index, openingAxes,
        /** 行列是否在本形状棋盘上 */
        isValid: (r, c) => index.has(r * raw.cols + c),
        /** 行列 → 点下标（不在盘上返回 -1） */
        indexOf: (r, c) => { const i = index.get(r * raw.cols + c); return i === undefined ? -1 : i; },
        /** 点下标 → 行列 */
        coordOf: (i) => raw.coord[i],
        /** 点下标在该对称下的像（对称 id 非法返回 -1） */
        symImage: (i, symId) => { const s = byId.get(symId); return s ? s.perm[i] : -1; },
        /** 邻接（几何；[行,列] 数组） */
        neighborsOf: (r, c) => {
            const i = index.get(r * raw.cols + c);
            return i === undefined ? [] : raw.neighbors[i].map((j) => raw.coord[j]);
        },
        /** 中心格（附加物加权随机用）：离质心最近的有效点 */
        centerCell
    };
    SHAPE_GEOM_CACHE.set(key, geom);
    return geom;
}

/** 下发给客户端的几何数据（坐标留 4 位小数，省体积；对称只发置换表与角度） */
function shapeGeometryPayload(geom) {
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    return {
        shape: geom.shape,
        lanes: geom.lanes,
        rows: geom.rows,
        cols: geom.cols,
        count: geom.count,
        coord: geom.coord,
        points: geom.points.map((p) => [r4(p[0]), r4(p[1])]),
        neighbors: geom.neighbors,
        symmetries: geom.symmetries.map((s) => ({
            id: s.id,
            kind: s.kind === 'mir' ? 'mirror' : 'rotation',
            angleDeg: s.angleDeg,
            perm: s.perm
        })),
        openingAxes: geom.openingAxes
    };
}

/** 容错解析客户端配置（非法项一律退回默认值） */
function normalizeCustomConfig(raw) {
    const out = defaultCustomConfig();
    if (!raw || typeof raw !== 'object') return out;
    const minLib = Number(raw.minLib);
    if (Number.isInteger(minLib) && minLib >= 1 && minLib <= 4) out.minLib = minLib;
    if (raw.magnetism === 'none' || raw.magnetism === 'weak' || raw.magnetism === 'medium' || raw.magnetism === 'strong') {
        out.magnetism = raw.magnetism;
    }
    if (raw.extras && typeof raw.extras === 'object') {
        for (const key of EXTRA_KEYS) out.extras[key] = !!raw.extras[key];
    }
    out.greedy = !!raw.greedy;
    out.symmetry = !!raw.symmetry;
    if (PREV_RULE_KEYS.indexOf(raw.prevRule) >= 0) out.prevRule = raw.prevRule;
    if (BOARD_SHAPES.indexOf(raw.boardShape) >= 0) out.boardShape = raw.boardShape;
    return out;
}

/** 规则核心：短气 / 磁性 / 附加物 / 贪吃。棋盘值 0 空、1 黑、2 白、-1 洞、-2 桥、-3 雷、10000 中立子 */
class CustomWeiqiRules {
    constructor(boardSize, config) {
        this.boardSize = boardSize;
        this.minLib = Number(config && config.minLib) || 1;
        this.magnetism = (config && config.magnetism) || 'none';
        this.extras = Object.assign({ hole: false, bridge: false, neutral: false, mine: false }, (config && config.extras) || {});
        this.greedy = !!(config && config.greedy);
        this.symmetry = !!(config && config.symmetry);
        this.prevRule = (config && PREV_RULES[config.prevRule]) ? config.prevRule : 'none';
        this.shape = (config && BOARD_SHAPES.indexOf(config.boardShape) >= 0) ? config.boardShape : 'square';
        /** 非方格形状的几何（邻居表/对称映射/坐标）；方格为 null */
        this.geom = this.shape === 'square' ? null : buildShapeGeometry(this.shape, boardSize);
    }

    // ---------------- 棋盘几何（方格与非方格统一走这里）----------------

    /** 行数（方格 = 路数；非方格 = 掩码网格行数） */
    get rows() { return this.geom ? this.geom.rows : this.boardSize; }
    /** 列数（方格 = 路数；非方格 = 掩码网格列数，也是线性键的步长） */
    get cols() { return this.geom ? this.geom.cols : this.boardSize; }
    /** 盘上有效点数（方格 = 路数²；非方格 = 几何点数） */
    get pointCount() { return this.geom ? this.geom.count : this.boardSize * this.boardSize; }
    /** 空盘：方格外的地方一律填 -1（与洞同值，规则层一律当墙；在不在盘上只看几何） */
    emptyBoard() {
        const g = [];
        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) row.push(this.inBounds(r, c) ? 0 : -1);
            g.push(row);
        }
        return g;
    }
    /** 与棋盘同尺寸的二维表（盘外格也填，规则层不会读写它们的语义） */
    newGrid(fill) {
        const g = [];
        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) row.push(fill);
            g.push(row);
        }
        return g;
    }
    /** 线性键（同一盘内唯一即可）与反解 */
    keyOf(r, c) { return r * this.cols + c; }
    keyRow(key) { return Math.floor(key / this.cols); }
    keyCol(key) { return key % this.cols; }
    /** 三角（六角三角）第 r 行的点数（其它形状不用） */
    triRowLen(r) {
        const l = this.boardSize;
        return (r < 0 || r > 2 * l - 2) ? 0 : l + Math.min(r, 2 * l - 2 - r);
    }
    /**
     * 射线方向数：方格 4 向（上下左右 = DIRS 顺序）、三角 6 向（蜂窝六邻，编号自正右起按屏幕顺时针每 60° 一个）；
     * 其它形状不做磁力、也不生成桥，返回 0。
     */
    get rayDirs() { return this.shape === 'square' ? 4 : (this.shape === 'triangle' ? 6 : 0); }
    /** 沿方向 d 的下一格（越界返回 null） */
    stepDir(row, col, d) {
        if (this.shape !== 'triangle') {
            const dd = DIRS[d] || DIRS[0];
            return [row + dd[0], col + dd[1]];
        }
        if (d === 0) return [row, col + 1];
        if (d === 3) return [row, col - 1];
        const down = (d === 1 || d === 2);
        const nr = down ? row - 1 : row + 1;
        if (nr < 0 || nr >= 2 * this.boardSize - 1) return null;
        const longer = this.triRowLen(nr) > this.triRowLen(row);
        const right = (d === 1 || d === 5);
        return [nr, right ? (longer ? col + 1 : col) : (longer ? col : col - 1)];
    }
    /** 反方向（同一射线往回走） */
    oppositeDir(d) {
        if (this.shape !== 'triangle') return d ^ 1;   // DIRS：0↔1（上下）、2↔3（左右）
        return (d + 3) % 6;
    }
    /** 几何邻接（不含桥）：方格四邻（已查边界），非方格取几何邻居表 */
    baseNeighbors(row, col) {
        if (this.geom) return this.inBounds(row, col) ? this.geom.neighborsOf(row, col) : [];
        const out = [];
        for (let d = 0; d < 4; d++) {
            const p = this.stepDir(row, col, d);
            if (this.inBounds(p[0], p[1])) out.push(p);
        }
        return out;
    }

    /** 本手的对称轴：第 1、2 手固定 diag1/diag2，之后从启用集合随机（同对称围棋） */
    static nextSymmetryAxis(handNumber) {
        if (handNumber === 1) return OPENING_SYMMETRIES[0];
        if (handNumber === 2) return OPENING_SYMMETRIES[1];
        const pool = ENABLED_SYMMETRIES.length ? ENABLED_SYMMETRIES : SYMMETRY_TYPES;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** 对称点映射（与对称围棋同式；last = 路数−1，屏幕视角 row 0 在下边、col 0 在左边） */
    getSymmetryPoint(row, col, axis) {
        if (this.geom) {
            const i = this.geom.indexOf(row, col);
            const j = i < 0 ? -1 : this.geom.symImage(i, axis);
            if (j < 0) return { row, col };
            const rc = this.geom.coordOf(j);
            return { row: rc[0], col: rc[1] };
        }
        const last = this.boardSize - 1;
        if (axis === 'horizontal') return { row: last - row, col };
        if (axis === 'vertical') return { row, col: last - col };
        if (axis === 'diag1') return { row: col, col: row };
        if (axis === 'diag2') return { row: last - col, col: last - row };
        if (axis === 'rotate90cw') return { row: last - col, col: row };
        if (axis === 'rotate90ccw') return { row: col, col: last - row };
        if (axis === 'rotate180') return { row: last - row, col: last - col };
        return { row, col };
    }

    /**
     * 对称点这一格怎么处理：
     *   'place' 空点 → 落第二子；'mine' 雷 → 踩雷（消雷、不留子）；'skip' 洞/桥/中立子/已有子 → 不落第二子。
     */
    symmetryPointAction(board, r, c) {
        const v = board[r][c];
        if (v === MINE) return 'mine';
        if (v !== 0) return 'skip';
        return 'place';
    }

    /**
     * 「不邻前手」禁点：与参考点（上一手实际落下的棋子，0~2 颗）相邻（邻=上下左右，近=含四个斜角）。
     * 参考点由房间按棋谱给出；对手那一手若没落下棋子（虚着/踩雷）→ 参考点为空 → 不受限。
     */
    /** 相邻两步的方向角（mod π）：A→B 与 B→C 是否平行就靠它判断 */
    stepAngle(pr, pc, qr, qc) {
        if (this.geom) {
            const ip = this.geom.indexOf(pr, pc);
            const iq = this.geom.indexOf(qr, qc);
            if (ip < 0 || iq < 0) return 0;
            const p = this.geom.points[ip];
            const q = this.geom.points[iq];
            return Math.atan2(q[1] - p[1], q[0] - p[0]) % Math.PI;
        }
        return Math.atan2(-(qr - pr), qc - pc) % Math.PI;   // 方格：row 越大越靠上，y 取负
    }

    /** 两个方向是否平行（mod π） */
    static sameLineAngle(a1, a2) {
        return Math.abs(Math.sin(a1 - a2)) < 1e-6;
    }

    /**
     * 「不邻前手」的禁点集合（key = this.keyOf(r,c)）；无限制返回 null。
     *   邻点：与参考点「同组相邻」口径一致 —— 直接取 getBridgeNeighbors（异形棋盘走几何邻接、方格可跨桥）
     *   近点：存在 B 使 A-B 相邻、B-C 相邻，且 AB 与 BC **不平行**（即沿一个方向走一步、再沿另一个方向走一步）的 C。
     *         直线方向的两格（A-B-C 共线）不算近点；近点也包含邻点本身。
     *         蜂窝棋盘（六角）与扭棱四角没有共线的两步，故「邻点的邻点」全是近点；
     *         三角/花形五角/开罗五角存在共线的两步，那些点不算近。
     */
    bannedKeySet(board, prevPoints) {
        const meta = PREV_RULES[this.prevRule] || PREV_RULES.none;
        if (this.prevRule === 'none' || meta.own === undefined) return null;
        const refs = (prevPoints || []).filter((p) => p && Number.isInteger(p.row) && Number.isInteger(p.col) && this.inBounds(p.row, p.col));
        if (!refs.length) return null;
        const banned = new Set();
        const nearOnly = meta.near;   // 近点判定需要方向角
        for (const p of refs) {
            const refKey = this.keyOf(p.row, p.col);
            const refNb = this.getBridgeNeighbors(board, p.row, p.col);
            const refNbKeys = new Set(refNb.map((xy) => this.keyOf(xy[0], xy[1])));
            for (const k of refNbKeys) banned.add(k);
            if (!meta.near) continue;
            for (const [br, bc] of refNb) {
                const a1 = this.stepAngle(p.row, p.col, br, bc);
                for (const [cr, cc] of this.getBridgeNeighbors(board, br, bc)) {
                    const k = this.keyOf(cr, cc);
                    if (k === refKey || refNbKeys.has(k)) continue;   // 自己与邻点已加过
                    const a2 = this.stepAngle(br, bc, cr, cc);
                    if (CustomWeiqiRules.sameLineAngle(a1, a2)) continue;   // 共线（同一方向走两步）不算近
                    banned.add(k);
                }
            }
        }
        return banned;
    }

    isBannedByPrev(board, r, c, prevPoints) {
        const set = this.bannedKeySet(board, prevPoints);
        return !!(set && set.has(this.keyOf(r, c)));
    }

    /** 该行列是否在本棋盘上：方格 = 路数范围；非方格 = 掩码网格的有效点 */
    inBounds(r, c) {
        if (this.geom) return r >= 0 && c >= 0 && r < this.geom.rows && c < this.geom.cols && this.geom.isValid(r, c);
        return r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize;
    }

    /** 附加物：不可落子、不可被提、不因磁力移动 */
    static isExtra(v) {
        return v === HOLE || v === BRIDGE || v === MINE || v === NEUTRAL;
    }

    /** 可被提的「子」：黑白棋 + 中立子（可提的第三色） */
    static isPiece(v) {
        return v === 1 || v === 2 || v === NEUTRAL;
    }

    // ---------------- 桥感知的连通与气 ----------------

    /** 沿方向 d 前进；连续桥格直接跳过（桥是通道） */
    resolveBridgeStep(board, row, col, dirIdx) {
        let cur = [row, col];
        for (;;) {
            const nxt = this.stepDir(cur[0], cur[1], dirIdx);
            if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
            if (board[nxt[0]][nxt[1]] === BRIDGE) { cur = nxt; continue; }
            return nxt;
        }
    }

    /**
     * 邻接（全规则唯一的邻接口径）：方格走四向、三角走六向，都可跨桥；
     * 其它形状不生成桥，直接取几何邻居表。
     */
    getBridgeNeighbors(board, row, col) {
        const n = this.rayDirs;
        if (!n) return this.baseNeighbors(row, col);
        const out = [];
        const seen = new Set();
        for (let d = 0; d < n; d++) {
            const p = this.resolveBridgeStep(board, row, col, d);
            if (!p) continue;
            const key = this.keyOf(p[0], p[1]);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
        return out;
    }

    collectGroup(board, row, col, color, visited) {
        const group = [];
        if (!this.inBounds(row, col) || board[row][col] !== color) return group;
        const seen = visited || new Set();
        const stack = [[row, col]];
        while (stack.length) {
            const [r, c] = stack.pop();
            const key = this.keyOf(r, c);
            if (seen.has(key)) continue;
            seen.add(key);
            if (!this.inBounds(r, c) || board[r][c] !== color) continue;
            group.push([r, c]);
            for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                if (board[nr][nc] === color) stack.push([nr, nc]);
            }
        }
        return group;
    }

    /** 一组棋的气点集合（key = r*size+c）：洞/桥/中立子不算气；空点与雷算气 */
    groupLiberties(board, group) {
        const libs = new Set();
        for (const [r, c] of group) {
            for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) {
                const nv = board[nr][nc];
                if (nv === 0 || nv === MINE) libs.add(this.keyOf(nr, nc));
            }
        }
        return libs;
    }

    countLiberties(board, row, col) {
        const color = board[row][col];
        if (!CustomWeiqiRules.isPiece(color)) return 0;
        return this.groupLiberties(board, this.collectGroup(board, row, col, color)).size;
    }

    removeGroup(board, row, col, color, numGrid) {
        for (const [r, c] of this.collectGroup(board, row, col, color)) {
            board[r][c] = 0;
            if (numGrid) numGrid[r][c] = 0;
        }
    }

    /** 该气点是否被对方控制（桥可达的邻点里有对方子即算，照公共层口径） */
    isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
        for (const [nr, nc] of this.getBridgeNeighbors(board, libertyRow, libertyCol)) {
            if (board[nr][nc] === opponentColor) return true;
        }
        return false;
    }

    // ---------------- 磁力结算 ----------------

    /** 射线扫描时各类格的语义：block 挡住射线 / pass 穿透 / target 可被推动的棋子 */
    rayAction(v) {
        if (v === 0) return 'pass';
        if (v === HOLE) return 'block';
        if (v === NEUTRAL) return this.magnetism === 'weak' ? 'block' : 'pass';
        if (v === BRIDGE || v === MINE) return 'pass';
        return 'target';
    }

    /** 沿方向 dirIdx 收集可推动的棋子（中/强磁性） */
    rayTargets(board, row, col, dirIdx) {
        const out = [];
        let cur = [row, col];
        for (let step = 1; ; step++) {
            const nxt = this.stepDir(cur[0], cur[1], dirIdx);
            if (!nxt || !this.inBounds(nxt[0], nxt[1])) break;
            cur = nxt;
            const v = board[cur[0]][cur[1]];
            const action = this.rayAction(v);
            if (action === 'block') break;
            if (action === 'target') out.push({ r: cur[0], c: cur[1], step, dirIdx, color: v });
        }
        return out;
    }

    /** 弱磁性：每方向只看最近的一个棋子 */
    nearestTarget(board, row, col, dirIdx) {
        let cur = [row, col];
        for (let step = 1; ; step++) {
            const nxt = this.stepDir(cur[0], cur[1], dirIdx);
            if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
            cur = nxt;
            const v = board[cur[0]][cur[1]];
            const action = this.rayAction(v);
            if (action === 'block') return null;
            if (action === 'target') return { r: cur[0], c: cur[1], step, dirIdx, color: v };
        }
    }

    /** 被推动棋子的落脚点：可跨连续桥格；洞/中立子/雷/子/出界都算停住（不可停在附加物上） */
    shiftDestination(board, r, c, dirIdx) {
        let cur = [r, c];
        for (;;) {
            const nxt = this.stepDir(cur[0], cur[1], dirIdx);
            if (!nxt || !this.inBounds(nxt[0], nxt[1])) return null;
            if (board[nxt[0]][nxt[1]] === BRIDGE) { cur = nxt; continue; }
            return board[nxt[0]][nxt[1]] === 0 ? [nxt[0], nxt[1]] : null;
        }
    }

    shiftPiece(board, numGrid, r, c, dirIdx) {
        const dest = this.shiftDestination(board, r, c, dirIdx);
        if (!dest) return false;
        const color = board[r][c];
        board[dest[0]][dest[1]] = color;
        board[r][c] = 0;
        if (numGrid) {
            numGrid[dest[0]][dest[1]] = numGrid[r][c];
            numGrid[r][c] = 0;
        }
        return true;
    }

    /** 落子后按磁性强度结算：弱/中一轮，强重复到稳定 */
    applyMagnetism(board, row, col, playerVal, numGrid) {
        if (this.magnetism === 'none') return board;
        if (!shapeMeta(this.shape).magnetism) return board;   // 磁性只在四角/三角棋盘生效，其它形状直接忽略
        if (this.magnetism === 'weak') {
            for (let d = 0; d < this.rayDirs; d++) {
                const target = this.nearestTarget(board, row, col, d);
                if (!target) continue;
                this.shiftPiece(board, numGrid, target.r, target.c, target.color === playerVal ? d : this.oppositeDir(d));
            }
            return board;
        }
        if (this.magnetism === 'strong') {
            let guard = 0;
            const maxRounds = this.geom ? this.pointCount * 4 + 1000 : this.boardSize * this.boardSize * this.boardSize * 8 + 1000;
            while (this.applyOneMagneticRound(board, row, col, playerVal, numGrid)) {
                if (++guard > maxRounds) break;
            }
            return board;
        }
        this.applyOneMagneticRound(board, row, col, playerVal, numGrid);
        return board;
    }

    /** 中/强磁性单轮：己方从远到近、对方从近到远各滑动一格；有任何棋子移动返回 true */
    applyOneMagneticRound(board, row, col, playerVal, numGrid) {
        const ownList = [];
        const oppList = [];
        for (let dirIdx = 0; dirIdx < this.rayDirs; dirIdx++) {
            for (const item of this.rayTargets(board, row, col, dirIdx)) {
                const entry = { r: item.r, c: item.c, step: item.step, dirIdx, color: item.color };
                if (item.color === playerVal) ownList.push(entry);
                else oppList.push(entry);
            }
        }
        ownList.sort((a, b) => b.step - a.step || a.dirIdx - b.dirIdx);
        oppList.sort((a, b) => a.step - b.step || a.dirIdx - b.dirIdx);
        let movedAny = false;
        const tryShift = (item) => {
            const { r, c, dirIdx, color } = item;
            if (board[r][c] !== color) return;
            // 己方远离落子点、对方靠近落子点
            const d = color === playerVal ? dirIdx : this.oppositeDir(dirIdx);
            if (this.shiftPiece(board, numGrid, r, c, d)) movedAny = true;
        };
        for (const item of ownList) tryShift(item);
        for (const item of oppList) tryShift(item);
        return movedAny;
    }

    // ---------------- 磁力：两颗子同时落下（对称点） ----------------

    /**
     * 单源位移场：在「两颗新子都已落下」的盘面上，只让 (sr,sc) 这一颗施加磁力，
     * 用一份唯一编号跟踪每颗棋子（编号按行扫描顺序，两次调用可比），得到各棋子的位移。
     */
    displacementField(board, sr, sc, playerVal) {
        const b = copyGrid(board);
        const idGrid = this.newGrid(0);
        const pieces = [];
        let id = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (CustomWeiqiRules.isPiece(board[r][c])) {
                    id += 1;
                    idGrid[r][c] = id;
                    pieces.push({ id, r, c, color: board[r][c] });
                }
            }
        }
        this.applyMagnetism(b, sr, sc, playerVal, idGrid);
        const pos = new Map();
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (idGrid[r][c]) pos.set(idGrid[r][c], [r, c]);
            }
        }
        const field = new Map();
        for (const p of pieces) {
            const end = pos.get(p.id) || [p.r, p.c];
            field.set(p.id, { id: p.id, fromR: p.r, fromC: p.c, toR: end[0], toC: end[1], color: p.color });
        }
        return field;
    }

    /**
     * 两颗子同时落下时的磁力结算（用户口径）：
     *  1) 分别假定「只落了 A」「只落了 B」，各算一遍每颗棋子的位移；
     *  2) 每颗棋子的最终位移 = 两个位移的**矢量和**，目标点在这一步就确定，之后是否腾空都不改；
     *  3) 目标点不可停（出界／初始盘面上是棋子、洞、桥、中立子、雷）的棋子排除；
     *     再循环把「目标点是已排除棋子原位」的也排除（按 B.4 一轮即稳定，保留循环兜底）；
     *  4) 其余棋子一起移动；多颗指向同一点时**哪一色多就留那一色一颗，一样多则一起消失**。
     * 只在落了两颗子（对称点）时走这里；只落一颗仍走原来的单源结算。
     */
    applyPairedMagnetism(board, placed, playerVal, numGrid) {
        const fieldA = this.displacementField(board, placed[0][0], placed[0][1], playerVal);
        const fieldB = this.displacementField(board, placed[1][0], placed[1][1], playerVal);
        const key = (r, c) => this.keyOf(r, c);
        const movers = [];
        for (const [id, ea] of fieldA) {
            const eb = fieldB.get(id);
            const dr = (ea.toR - ea.fromR) + (eb ? eb.toR - eb.fromR : 0);
            const dc = (ea.toC - ea.fromC) + (eb ? eb.toC - eb.fromC : 0);
            if (!dr && !dc) continue;
            movers.push({
                id,
                fromR: ea.fromR, fromC: ea.fromC,
                toR: ea.fromR + dr, toC: ea.fromC + dc,
                color: ea.color,
                num: numGrid ? (Number(numGrid[ea.fromR][ea.fromC]) || 0) : 0
            });
        }
        if (!movers.length) return;
        const canStop = (r, c) => this.inBounds(r, c) && board[r][c] === 0;
        const excluded = new Set();
        let movable = [];
        for (const m of movers) {
            if (canStop(m.toR, m.toC)) movable.push(m);
            else excluded.add(key(m.fromR, m.fromC));
        }
        for (;;) {
            const next = movable.filter((m) => !excluded.has(key(m.toR, m.toC)));
            if (next.length === movable.length) break;
            for (const m of movable) if (next.indexOf(m) < 0) excluded.add(key(m.fromR, m.fromC));
            movable = next;
        }
        if (!movable.length) return;
        const nums = new Map();
        for (const m of movable) nums.set(m.id, m.num);
        for (const m of movable) {                       // 先全部腾空原位，再落位
            board[m.fromR][m.fromC] = 0;
            if (numGrid) numGrid[m.fromR][m.fromC] = 0;
        }
        const byTarget = new Map();
        for (const m of movable) {
            const k = key(m.toR, m.toC);
            if (!byTarget.has(k)) byTarget.set(k, { r: m.toR, c: m.toC, groups: new Map() });
            const t = byTarget.get(k);
            if (!t.groups.has(m.color)) t.groups.set(m.color, []);
            t.groups.get(m.color).push(m);
        }
        for (const t of byTarget.values()) {
            const counts = new Map();
            for (const [color, list] of t.groups) counts.set(color, list.length);
            const winner = CustomWeiqiRules.majorityColor(counts);
            if (!winner) continue;                       // 一样多 → 一起消失
            board[t.r][t.c] = winner;
            if (numGrid) numGrid[t.r][t.c] = nums.get(t.groups.get(winner)[0].id) || 0;
        }
    }

    /** 多颗棋子移动到同一点：哪一色多就留那一色（返回该色），一样多返回 0（一起消失） */
    static majorityColor(counts) {
        let best = 0, bestN = 0, tie = false;
        for (const [color, n] of counts) {
            if (n > bestN) { best = color; bestN = n; tie = false; }
            else if (n === bestN) tie = true;
        }
        return tie ? 0 : best;
    }

    // ---------------- 提子 ----------------

    /**
     * 提子：只处理本次落子/磁力推动「波及到」的组（含中立子）。
     * 与短气围棋的局部口径一致：未被波及的组即使气数不足也不动（例如编辑出来的死形）；
     * 且先提它组、最后才判落子组自身（否则落子组被提掉会把它组的气还回去）。
     */
    settleCaptures(boardBefore, board, placedPoints, numGrid) {
        const placedGroups = new Set();
        const placedList = (placedPoints || []).filter(([pr, pc]) => CustomWeiqiRules.isPiece(board[pr][pc]));
        for (const [pr, pc] of placedList) {
            for (const [r, c] of this.collectGroup(board, pr, pc, board[pr][pc])) placedGroups.add(this.keyOf(r, c));
        }
        const reps = [];
        const pushed = new Set();
        const pushRep = (r, c) => {
            if (!CustomWeiqiRules.isPiece(board[r][c])) return;
            const key = this.keyOf(r, c);
            if (pushed.has(key)) return;
            pushed.add(key);
            reps.push([r, c]);
        };
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (board[r][c] === boardBefore[r][c]) continue;
                pushRep(r, c);
                for (const [nr, nc] of this.getBridgeNeighbors(board, r, c)) pushRep(nr, nc);
            }
        }
        for (const [r, c] of reps) {
            const v = board[r][c];
            if (!CustomWeiqiRules.isPiece(v) || placedGroups.has(this.keyOf(r, c))) continue;
            if (this.countLiberties(board, r, c) < this.minLib) this.removeGroup(board, r, c, v, numGrid);
        }
        // 落子组最后判：先在同一张盘面上各算一次气数，再一起提
        // （对称点会落两颗子：同色、可能相邻成同一组；避免先提的那组把气还给另一组）
        const toRemove = [];
        for (const [pr, pc] of placedList) {
            const v = board[pr][pc];
            if (CustomWeiqiRules.isPiece(v) && this.countLiberties(board, pr, pc) < this.minLib) toRemove.push([pr, pc]);
        }
        for (const [pr, pc] of toRemove) {
            const v = board[pr][pc];
            if (CustomWeiqiRules.isPiece(v)) this.removeGroup(board, pr, pc, v, numGrid);
        }
        return board;
    }

    // ---------------- 落子 ----------------

    /**
     * 落子：落子（含对称点第二子）→ 磁力结算 → 提子循环 → 贪吃校验。
     * @param {object} [opts] numGrid/moveNum 用于手数跟踪；historyBoardSet 供贪吃禁全同过滤；
     *                       skipGreedy=true 时不做贪吃限制（棋谱回放与候选点统计用）；
     *                       symmetryAxis = 本手的对称轴（对称点开启时必传）；prevPoints = 「不邻前手」的参考点
     * @returns {{board:number[][], numGrid:number[][]|null, placed:number[][], clearedMine:number[]|null}|null}
     */
    placeStone(boardBefore, row, col, playerVal, opts = {}) {
        if (!this.inBounds(row, col) || boardBefore[row][col] !== 0) return null;
        const prevPoints = opts.prevPoints || [];
        if (this.isBannedByPrev(boardBefore, row, col, prevPoints)) return null;
        const board = copyGrid(boardBefore);
        const numGrid = opts.numGrid ? copyGrid(opts.numGrid) : null;
        board[row][col] = playerVal;
        if (numGrid) numGrid[row][col] = Number(opts.moveNum) || 0;
        const placed = [[row, col]];
        let clearedMine = null;
        if (this.symmetry && opts.symmetryAxis) {
            const sp = this.getSymmetryPoint(row, col, opts.symmetryAxis);
            if (!(sp.row === row && sp.col === col)) {
                const action = this.symmetryPointAction(board, sp.row, sp.col);
                if (action === 'place') {
                    if (!this.isBannedByPrev(boardBefore, sp.row, sp.col, prevPoints)) {
                        board[sp.row][sp.col] = playerVal;
                        if (numGrid) numGrid[sp.row][sp.col] = Number(opts.moveNum) || 0;
                        placed.push([sp.row, sp.col]);
                    }
                } else if (action === 'mine') {
                    board[sp.row][sp.col] = 0;                 // 对称点是雷：消雷、不留子
                    clearedMine = [sp.row, sp.col];
                }
            }
        }
        if (placed.length === 2 && this.magnetism !== 'none') this.applyPairedMagnetism(board, placed, playerVal, numGrid);
        else this.applyMagnetism(board, row, col, playerVal, numGrid);
        this.settleCaptures(boardBefore, board, placed, numGrid);
        if (this.greedy && !opts.skipGreedy) {
            const myCap = this.countCaptures(boardBefore, board, playerVal);
            if (this.hasStrictlyBetterCapture(boardBefore, playerVal, myCap, row, col, opts.historyBoardSet, opts)) return null;
        }
        return { board, numGrid, placed, clearedMine };
    }

    tryPlaceStone(boardBefore, row, col, playerVal, opts = {}) {
        const placed = this.placeStone(boardBefore, row, col, playerVal, opts);
        return placed ? placed.board : null;
    }

    // ---------------- 贪吃 ----------------

    /** 提子数：对方棋子 + 中立子（可提的第三色都算） */
    countCaptures(boardBefore, boardAfter, playerVal) {
        const enemy = 3 - playerVal;
        let before = 0;
        let after = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const bv = boardBefore[r][c];
                if (bv === enemy || bv === NEUTRAL) before++;
                const av = boardAfter[r][c];
                if (av === enemy || av === NEUTRAL) after++;
            }
        }
        return before - after;
    }

    /** 是否存在比 myCap 提子更多的合法点（含禁全同过滤）；opts 带对称轴/禁点参考点 */
    hasStrictlyBetterCapture(boardBefore, playerVal, myCap, skipRow, skipCol, historyBoardSet, probeOpts = {}) {
        const extra = { symmetryAxis: probeOpts.symmetryAxis, prevPoints: probeOpts.prevPoints };
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (!this.inBounds(r, c) || boardBefore[r][c] !== 0) continue;
                if (r === skipRow && c === skipCol) continue;
                const nb = this.tryPlaceStone(boardBefore, r, c, playerVal, { skipGreedy: true, ...extra });
                if (!nb) continue;
                if (historyBoardSet && historyBoardSet.has(gridToString(nb))) continue;
                if (this.countCaptures(boardBefore, nb, playerVal) > myCap) return true;
            }
        }
        return false;
    }

    /** 当前行棋方在本局面上能提的最多子数（对称点开启时按「该点 + 它的对称点」这一对算） */
    maxLegalCaptureCount(boardBefore, playerVal, historyBoardSet, probeOpts = {}) {
        const extra = { symmetryAxis: probeOpts.symmetryAxis, prevPoints: probeOpts.prevPoints };
        let maxCap = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (!this.inBounds(r, c) || boardBefore[r][c] !== 0) continue;
                const nb = this.tryPlaceStone(boardBefore, r, c, playerVal, { skipGreedy: true, ...extra });
                if (!nb) continue;
                if (historyBoardSet && historyBoardSet.has(gridToString(nb))) continue;
                const cap = this.countCaptures(boardBefore, nb, playerVal);
                if (cap > maxCap) maxCap = cap;
            }
        }
        return maxCap;
    }

    /** 必须走的「提子最多」点；无需提子时返回 [] */
    collectMaxCaptureCandidates(boardBefore, playerVal, historyBoardSet, probeOpts = {}) {
        const extra = { symmetryAxis: probeOpts.symmetryAxis, prevPoints: probeOpts.prevPoints };
        const scored = [];
        let maxCap = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (!this.inBounds(r, c) || boardBefore[r][c] !== 0) continue;
                const nb = this.tryPlaceStone(boardBefore, r, c, playerVal, { skipGreedy: true, ...extra });
                if (!nb) continue;
                if (historyBoardSet && historyBoardSet.has(gridToString(nb))) continue;
                const cap = this.countCaptures(boardBefore, nb, playerVal);
                if (cap > 0) scored.push({ row: r, col: c, cap });
                if (cap > maxCap) maxCap = cap;
            }
        }
        if (maxCap <= 0) return [];
        return scored.filter((p) => p.cap === maxCap).map((p) => ({ row: p.row, col: p.col }));
    }

    // ---------------- 形势判断 / 数点 ----------------

    /** 反复去掉「气不足」的组（含中立子），供形势判断与数点使用 */
    removeDeadAndDying(srcBoard) {
        const maxWeakLiberties = Math.max(2, this.minLib);
        let board = copyGrid(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = new Set();
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const val = board[r][c];
                    if (!CustomWeiqiRules.isPiece(val) || visited.has(this.keyOf(r, c))) continue;
                    const group = this.collectGroup(board, r, c, val, visited);
                    if (!group.length) continue;
                    const liberties = this.groupLiberties(board, group);
                    let dead = liberties.size === 0;
                    if (!dead && liberties.size <= maxWeakLiberties) {
                        dead = true;
                        for (const key of liberties) {
                            const lr = this.keyRow(key);
                            const lc = this.keyCol(key);
                            if (!this.isLibertyControlledByEnemy(board, lr, lc, val)) { dead = false; break; }
                        }
                    }
                    if (dead) {
                        for (const [rr, cc] of group) board[rr][cc] = 0;
                        changed = true;
                    }
                }
            }
        }
        return board;
    }

    isLibertyControlledByEnemy(board, lr, lc, val) {
        const enemies = val === NEUTRAL ? [1, 2] : [3 - val];
        return enemies.some((color) => this.isLibertySurroundedByOpponent(board, lr, lc, color));
    }

    /** 归属（限定步数内更近者得，更远算公共）；洞/桥/雷/中立子都不可作为 BFS 落脚点 */
    assignTerritory(liveBoard) {
        const territory = this.newGrid(0);
        const stepNeighbors = (row, col) => {
            const out = [];
            const seen = new Set();
            const n = this.rayDirs;
            for (let d = 0; d < n; d++) {
                const p = this.resolveBridgeStep(liveBoard, row, col, d);
                if (!p) continue;
                if (CustomWeiqiRules.isExtra(liveBoard[p[0]][p[1]])) continue;
                const key = this.keyOf(p[0], p[1]);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(p);
            }
            return out;
        };
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= this.rows - 2 || c <= 1 || c >= this.cols - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = this.newGrid(Infinity);
                dist[r][c] = 0;
                const queue = [[r, c]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [nr, nc] of stepNeighbors(cr, cc)) {
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    }

    computeScore(liveBoard, territory) {
        if (!this.geom) return squareWeiqiRules.computeScore(liveBoard, territory, this.boardSize);
        return gridGraphWeiqiRules.computeScore(liveBoard, territory, this.rows, this.cols, (r, c) => this.inBounds(r, c));
    }

    /** 贴目：四角按普通围棋口径（≤8 路 4.25，其余 3.25）；其它形状一律 3.25 */
    komi() {
        if (this.shape && this.shape !== 'square') return 3.25;
        return this.boardSize <= 8 ? 4.25 : 3.25;
    }

    // ---------------- 附加物生成 ----------------

    /** 越靠中心权重越高（照洞围棋） */
    distanceWeight(row, col) {
        const center = this.geom ? this.geom.centerCell : [Math.floor(this.boardSize / 2), Math.floor(this.boardSize / 2)];
        const d = Math.max(Math.abs(row - center[0]), Math.abs(col - center[1]));
        return 1 + d * 0.5;
    }

    /** 就地摆放已勾选的附加物；调用方需先清空旧的同类附加物 */
    generateExtras(board) {
        const checked = EXTRA_KEYS.filter((key) => this.extras[key]).length;
        const ratio = checked >= 2 ? MULTI_EXTRA_RATIO : SINGLE_EXTRA_RATIO;
        const count = Math.floor(ratio * this.pointCount);
        for (const { key, value } of EXTRAS_META) {
            if (!this.extras[key]) continue;
            if (key === 'bridge' && !shapeMeta(this.shape).bridge) continue;   // 桥只在有直线的四角/三角生成（其它形状勾了也不生成、不提示）
            this.placeExtraType(board, value, count);
        }
        return board;
    }

    /** 连续重试直到「剩余可下区域」连通（只把本类附加物当墙，其它附加物一律可通行） */
    placeExtraType(board, value, count) {
        const MAX_ATTEMPTS = 100;
        let last = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const trial = copyGrid(board);
            for (const [r, c] of this.pickWeightedCells(trial, count)) trial[r][c] = value;
            last = trial;
            if (this.isPlayableAreaConnected(trial, value)) break;
        }
        if (!last) return board;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) board[r][c] = last[r][c];
        }
        return board;
    }

    /** 只在空点上加权抽取 count 个不重复格 */
    pickWeightedCells(board, count) {
        const pool = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.inBounds(r, c) && board[r][c] === 0) pool.push({ r, c, weight: this.distanceWeight(r, c) });
            }
        }
        const out = [];
        const want = Math.min(count, pool.length);
        for (let i = 0; i < want; i++) {
            const total = pool.reduce((sum, p) => sum + p.weight, 0);
            const rand = Math.random() * total;
            let accum = 0;
            let idx = -1;
            for (let j = 0; j < pool.length; j++) {
                accum += pool[j].weight;
                if (rand <= accum) { idx = j; break; }
            }
            if (idx === -1) idx = pool.length - 1;
            out.push([pool[idx].r, pool[idx].c]);
            pool.splice(idx, 1);
        }
        return out;
    }

    isPlayableAreaConnected(board, wallValue) {
        let startRow = -1;
        let startCol = -1;
        for (let r = 0; r < this.rows && startRow === -1; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (!this.inBounds(r, c)) continue;
                if (board[r][c] !== wallValue) { startRow = r; startCol = c; break; }
            }
        }
        if (startRow === -1) return true;
        const visited = this.newGrid(false);
        visited[startRow][startCol] = true;
        const queue = [[startRow, startCol]];
        let front = 0;
        while (front < queue.length) {
            const [r, c] = queue[front++];
            for (const [nr, nc] of this.baseNeighbors(r, c)) {
                if (visited[nr][nc] || board[nr][nc] === wallValue) continue;
                visited[nr][nc] = true;
                queue.push([nr, nc]);
            }
        }
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (!this.inBounds(r, c)) continue;
                if (board[r][c] !== wallValue && !visited[r][c]) return false;
            }
        }
        return true;
    }
}

class CustomWeiqiRoom extends QiTwoPlayerRoomBase
{
    constructor(room, initialSize = 19)
    {
        super(room);
        this.editBoardAllowedValues = [0, 1, 2, HOLE, BRIDGE, MINE, NEUTRAL];
        /** 各形状上次用过的路数（换形状时沿用；没记录过就用该形状的默认路数） */
        this.sizeByShape = Object.create(null);
        this.boardSize = initialSize;
        this.config = defaultCustomConfig();
        this.rules = new CustomWeiqiRules(this.boardSize, this.config);
        this.editBoardMode = this.config.boardShape === 'square' ? 'grid2d' : 'maskedGrid';
        this.board = this.createOpeningBoard();
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.moveCoords = [];
        /** 「对称点」本手用的对称轴（开局第 1 手 diag1、第 2 手 diag2，之后每手随机；未开启时为 null） */
        this.symmetryAxis = null;
        /** 各手用过的对称轴（悔棋回退用） */
        this.historySymmetryAxis = [];
        /** 最近一次 tryPlaceStone 的细节（落了两点/消了雷），供落子路径写入棋谱 */
        this._lastPlaceResult = null;
        this.recordResultText = null;
        /** @type {{ player1: number|null, player2: number|null }} */
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        /** @type {{ timed: boolean, mainMinutes?: number, byoyomiSeconds?: number, maxTimeouts?: number }|null} */
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
        /** 先落座者为房主（WebSocket） */
        this.hostWs = null;
        /** 是否启用棋盘落座蒙版协议（执子由房主在限时对话框选择） */
        this.boardSeatOverlay = true;
    }

    /** 空盘 + 按当前规则随机摆放附加物 */
    /** 按当前形状与路数重建规则核心（并同步编辑盘面模式），返回一张空盘 */
    _rebuildRules() {
        this.editBoardMode = this.config.boardShape === 'square' ? 'grid2d' : 'maskedGrid';
        this.rules = new CustomWeiqiRules(this.boardSize, this.config);
        this.gridW = this.rules.rows;      // 掩码网格行数（编辑盘面协议用；方格 = 路数）
        this.gridH = this.rules.cols;      // 掩码网格列数
        return this.rules.emptyBoard();
    }

    /** 该坐标是否在本棋盘上（落子/棋谱/编辑都用它；方格 = 路数范围） */
    isValidMoveCoord(r, c) {
        return this.rules.inBounds(r, c);
    }

    /** 掩码网格盘的有效点判定（公共编辑盘面协议 maskedGrid 用） */
    isValidVertex(r, c) {
        return this.rules.inBounds(r, c);
    }

    /** 当前形状的路数范围/默认值 */
    _shapeMeta() {
        return shapeMeta(this.config.boardShape);
    }

    /** 换形状：路数按新形状的范围取（沿用该形状上次用过的，否则用默认），返回是否换了形状 */
    _applyShapeIfChanged(nextShape) {
        const cur = this.config.boardShape || 'square';
        const next = BOARD_SHAPES.indexOf(nextShape) >= 0 ? nextShape : 'square';
        if (next === cur) return false;
        this.sizeByShape[cur] = this.boardSize;
        const meta = shapeMeta(next);
        const remembered = this.sizeByShape[next];
        this.boardSize = (Number.isInteger(remembered) && remembered >= meta.min && remembered <= meta.max) ? remembered : meta.def;
        this.config.boardShape = next;
        return true;
    }

    /** 下发给客户端的棋盘几何（方格形状返回 null；客户端按形状+路数缓存） */
    shapeGeometryPayload() {
        return this.rules && this.rules.geom ? shapeGeometryPayload(this.rules.geom) : null;
    }

    createOpeningBoard() {
        const board = this._rebuildRules();
        this.rules.generateExtras(board);
        return board;
    }

    configSnapshot() {
        return {
            minLib: this.config.minLib,
            magnetism: this.config.magnetism,
            extras: {
                hole: !!this.config.extras.hole,
                bridge: !!this.config.extras.bridge,
                neutral: !!this.config.extras.neutral,
                mine: !!this.config.extras.mine
            },
            greedy: !!this.config.greedy,
            symmetry: !!this.config.symmetry,
            prevRule: this.config.prevRule,
            boardShape: this.config.boardShape || 'square'
        };
    }

    _stopClockTicker() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _broadcastClock() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const snap = qiMatchTimeControl.snapshotForClient(this.tcClock);
        this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _startClockTicker() {
        this._stopClockTicker();
        if (!this.tcClock || !this.tcClock.timed) return;
        this._clockInterval = setInterval(() => {
            if (!this.tcClock || !this.tcClock.timed || this.gameOver) {
                this._stopClockTicker();
                return;
            }
            if (this.pendingScore) return;
            const now = Date.now();
            const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, now);
            if (lostSlot) {
                this._stopClockTicker();
                this.gameOver = true;
                this.winner = winnerSlot;
                this.setTimeLossResultText(lostSlot);
                this.broadcast({
                    type: 'broadcast',
                    action: 'timeLoss',
                    player: lostSlot,
                    winner: winnerSlot,
                    ...this.getState()
                });
                return;
            }
            this._broadcastClock();
        }, 1000);
    }

    _timeAllowsPlay(slot) {
        if (this.gameOver) return false;
        if (!this.matchStarted) return false;
        if (this.tcNego || this.tcSettings === null) return false;
        if (!this.tcClock || !this.tcClock.timed) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        return slot === expect;
    }

    _drainClockBeforeMove(slot) {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return true;
        const expect = this.currentPlayer === 1 ? 'player1' : 'player2';
        if (slot !== expect) return true;
        const { lostSlot, winnerSlot } = qiMatchTimeControl.drain(this.tcClock, Date.now());
        if (lostSlot) {
            this._stopClockTicker();
            this.gameOver = true;
            this.winner = winnerSlot;
            this.setTimeLossResultText(lostSlot);
            this.broadcast({
                type: 'broadcast',
                action: 'timeLoss',
                player: lostSlot,
                winner: winnerSlot,
                ...this.getState()
            });
            return false;
        }
        return true;
    }

    _syncClockAfterTurnChange() {
        if (!this.tcClock || !this.tcClock.timed || this.gameOver) return;
        const slot = this.currentPlayer === 1 ? 'player1' : 'player2';
        qiMatchTimeControl.setActiveSlot(this.tcClock, slot, Date.now());
        this._broadcastClock();
    }

    /**
     * 「不邻前手」的参考点：上一手**实际落下**的棋子（己方模式则取该方最近一手实际落下的棋子）。
     * 该手若没落下棋子（虚着 / 踩雷）→ 返回空数组 = 本手不受限（不回退去看更早的手）。
     */
    _banRefPoints(playerVal) {
        if (this.config.prevRule === 'none') return [];
        const mcs = this.moveCoords || [];
        const own = !!(PREV_RULES[this.config.prevRule] || {}).own;
        const slot = playerVal === 2 ? 'player2' : 'player1';
        for (let i = mcs.length - 1; i >= 0; i--) {
            const m = mcs[i];
            if (!m) continue;
            if (own && m.player !== slot) continue;
            if (m.type !== 'move') return [];
            const out = [{ row: m.row, col: m.col }];
            if (Number.isInteger(m.symRow) && Number.isInteger(m.symCol)) out.push({ row: m.symRow, col: m.symCol });
            return out;
        }
        return [];
    }

    /** 一手结束后抽下一手的对称轴（只在开启「对称点」时抽；虚着/踩雷也算一手） */
    _advanceSymmetryAxis() {
        if (!this.config.symmetry) { this.symmetryAxis = null; this.historySymmetryAxis = []; return; }
        this.historySymmetryAxis.push(this.symmetryAxis || this._nextSymmetryAxis(1));
        this.symmetryAxis = this._nextSymmetryAxis((this.moveCoords || []).length + 1);
    }

    /** 回到「第 1 手之前」的对称轴状态（新局/清盘/改规则/改路数时用） */
    _resetSymmetryAxis() {
        this.historySymmetryAxis = [];
        this.symmetryAxis = this.config.symmetry ? this._nextSymmetryAxis(1) : null;
    }

    /**
     * 本手的对称轴。方格：第 1、2 手固定 diag1/diag2，之后从启用集合随机（同对称围棋）；
     * 非方格：前几手按该盘固定的开手对称（三角/六角 = 三条角对角轴：左上-右下 → 右上-左下 → 左-右；
     * 扭棱/开罗/花形 = 旋转 180°），之后从实测成立的对称里随机。
     */
    _nextSymmetryAxis(handNumber) {
        const geom = this.rules.geom;
        if (!geom) return CustomWeiqiRules.nextSymmetryAxis(handNumber);
        const opening = geom.openingAxes || [];
        if (handNumber <= opening.length) return opening[handNumber - 1];
        const pool = geom.symmetries.map((sy) => sy.id).filter((id) => DISABLED_SHAPE_SYMMETRIES.indexOf(id) < 0);
        if (!pool.length) return opening.length ? opening[0] : null;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** 规则核心的额外参数：本手对称轴 + 「不邻前手」参考点 */
    _ruleOpts(playerVal) {
        return { symmetryAxis: this.symmetryAxis, prevPoints: this._banRefPoints(playerVal) };
    }

    /** 落子（短气/磁性/附加物/贪吃/对称点/不邻前手 全部走规则核心） */
    tryPlaceStone(boardBefore, row, col, playerVal, opts = {}) {
        const res = this.rules.placeStone(boardBefore, row, col, playerVal, {
            historyBoardSet: this.historyBoardSet,
            symmetryAxis: this.symmetryAxis,
            prevPoints: this._banRefPoints(playerVal),
            ...opts
        });
        this._lastPlaceResult = res;
        return res ? res.board : null;
    }

    countLiberties(board, row, col) {
        return this.rules.countLiberties(board, row, col);
    }

    removeGroup(board, row, col, color) {
        this.rules.removeGroup(board, row, col, color);
    }

    removeDeadAndDying(srcBoard) {
        return this.rules.removeDeadAndDying(srcBoard);
    }

    assignTerritoryWithRange(liveBoard) {
        return this.rules.assignTerritory(liveBoard);
    }

    computeScore(liveBoard, territory) {
        return this.rules.computeScore(liveBoard, territory);
    }

    /**
     * Benson 加成的盘面净活盘：先用现有启发式去死子，再恢复无条件活棋链
     * （附加物一律不可落子，视作「洞」）。
     */
    bensonLiveBoard() {
        const size = this.boardSize;
        const isWall = (r, c) => CustomWeiqiRules.isExtra(this.board[r][c]);
        const benson = squareWeiqiRules.bensonAliveWithHoles(this.board, size, isWall);
        let live = this.copyBoard(this.board);
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = this.removeDeadAndDying(live);
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const v = this.board[r][c];
                    if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
            }
            live = cleaned;
        }
        return live;
    }

    computeLead()
    {
        const size = this.boardSize;
        const liveBoard = this.bensonLiveBoard();
        const territory = this.assignTerritoryWithRange(liveBoard);
        // Benson 确定领地优先于「距离扩张」归属
        const secure = squareWeiqiRules.bensonAliveWithHoles(liveBoard, size, (r, c) => CustomWeiqiRules.isExtra(liveBoard[r][c]));
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
        }
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        return blackTotal - whiteTotal - 2 * this.rules.komi();
    }

    /** 当前行棋方是否必须提子（贪吃）；返回需提的最大子数 */
    _mustCaptureCount() {
        if (!this.config.greedy || this.gameOver) return 0;
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        return this.rules.maxLegalCaptureCount(this.board, playerVal, this.historyBoardSet, this._ruleOpts(playerVal));
    }

    onResignResolved(resignSlot) {
        this.recordResultText = resignSlot === 'player1' ? '白中盘胜' : '黑中盘胜';
    }

    onDrawResolved() {
        this.recordResultText = '和棋';
    }

    setScoreResultTextByLead(lead) {
        if (!Number.isFinite(lead) || lead === 0) {
            this.recordResultText = '和棋';
            return;
        }
        const winnerSide = lead > 0 ? '黑' : '白';
        this.recordResultText = `${winnerSide}胜${Math.abs(lead).toFixed(2)}点`;
    }

    setTimeLossResultText(lostSlot) {
        if (lostSlot === 'player1') this.recordResultText = '黑方超时，白胜';
        else if (lostSlot === 'player2') this.recordResultText = '白方超时，黑胜';
    }

    getState()
    {
        const initialBoard = this.openingBoard
            ? this.copyBoard(this.openingBoard)
            : this.copyBoard(this.board);
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        const shape = this.config.boardShape || 'square';
        return {
            boardSize: this.boardSize,
            boardShape: shape,
            gridWidth: this.rules.cols,
            gridHeight: this.rules.rows,
            // 非方格形状广播子棋类 id：qi-katago-opponent 会去找 katagos/custom-weiqi-{形状}/，目录不存在 → 自动不显示人机
            ...(shape === 'square' ? {} : { subGameId: `custom-weiqi-${shape}` }),
            komi: this.rules.komi(),
            board: this.board,
            initialBoard,
            customRules: this.configSnapshot(),
            // 「对称点」本手用的对称轴（客户端据此画镜像线/旋转符号并做对称点悬停预览）
            symmetryAxis: this.config.symmetry ? this.symmetryAxis : null,
            enabledSymmetries: ENABLED_SYMMETRIES.slice(),
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            moveCoords: this.moveCoords,
            candidates: this.config.greedy ? this.rules.collectMaxCaptureCandidates(this.board, playerVal, this.historyBoardSet, this._ruleOpts(playerVal)) : [],
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
            hostSlot: this.hostWs ? this.room.getSlotByWs(this.hostWs) : null,
            boardSeatOverlay: !!this.boardSeatOverlay,
            matchTime: {
                negotiation: this.tcNego,
                settings: this.tcSettings,
                clock: this.tcClock && this.tcClock.timed
                    ? qiMatchTimeControl.snapshotForClient(this.tcClock)
                    : (this.tcSettings && this.tcSettings.timed === false
                        ? { timed: false, ruleLine: '本局不限时' }
                        : null)
            },
            matchStarted: this.matchStarted
        };
    }

    getInitialState() {
        return this.getState();
    }

    getStateForClient() {
        return this.getState();
    }

    startScoreCounting(requester, opponent) {
        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, true);
        const lead = this.computeLead();
        this.scoreProposalData = { lead, requester, opponent };
        const proposalMsg = { type: 'scoreProposal', lead };
        requester.send(JSON.stringify(proposalMsg));
        opponent.send(JSON.stringify(proposalMsg));
        this.pendingScore = { requester, opponent, agreed: new Set() };
    }

    /**
     * 踩雷：不落子、清除该雷并换手（照全家福围棋）；该手在棋谱里记为 mineHit。
     * 贪吃模式下与虚着同口径：有提子可提时不能踩雷。
     */
    performMineHit(slot, row, col) {
        const playerVal = this.currentPlayer === 1 ? 1 : 2;
        this.board[row][col] = 0;
        this.historyBoards.push(this.copyBoard(this.board));
        this.historyBoardSet.add(this.boardToString(this.board));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.moveHistory.push(slot);
        this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
        this.currentPlayer = 3 - this.currentPlayer;
        this.passCounter = 0;
        this.lastMoveMarkers = [{ row, col, color: playerVal }];
        this._advanceSymmetryAxis();     // 踩雷也算一手：抽下一手的对称轴
        this.broadcast({ type: 'broadcast', action: 'mineHit', player: slot, row, col, ...this.getState() });
    }

    handleMessage(ws, msg)
    {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type)
        {
            case 'setBoardSize':
                qiProtocol.setBoardSizeWeiqiObserver(this, ws, msg, slot);
                break;

            case 'requestShapeGeometry':
                if (this.shapeGeometryPayload()) {
                    ws.send(JSON.stringify({ type: 'shapeGeometry', geometry: this.shapeGeometryPayload() }));
                }
                break;
            case 'setCustomRules':
                this.setCustomRules(msg.config ?? msg.customRules, ws);
                break;

            case 'move': {
                const moveSlot = slot;
                if (!this._timeAllowsPlay(moveSlot)) {
                    if (moveSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                const { row, col } = msg;
                const inBoard = Number.isInteger(row) && Number.isInteger(col) && this.rules.inBounds(row, col);
                if (inBoard && this.board[row][col] === MINE) {
                    // 踩雷：不落子、清除该雷并换手
                    if (!moveSlot || moveSlot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                    if (this._mustCaptureCount() > 0) {
                        ws.send(JSON.stringify({ type: 'error', message: '必须提子' }));
                        return;
                    }
                    if (!this._drainClockBeforeMove(moveSlot)) return;
                    this.performMineHit(moveSlot, row, col);
                    this._syncClockAfterTurnChange();
                    return;
                }
                if (inBoard && this.board[row][col] === 0 && this.config.greedy) {
                    // 贪吃：有提子必提，有多个提子必须提最多（提子数含磁力结算后的盘面；对称点按「该点+对称点」这一对算）
                    const maxCap = this._mustCaptureCount();
                    if (maxCap > 0) {
                        const playerVal = this.currentPlayer === 1 ? 1 : 2;
                        const nb = this.rules.tryPlaceStone(this.board, row, col, playerVal, {
                            skipGreedy: true, ...this._ruleOpts(playerVal)
                        });
                        if (!nb || this.rules.countCaptures(this.board, nb, playerVal) < maxCap) {
                            ws.send(JSON.stringify({ type: 'error', message: '必须提子' }));
                            return;
                        }
                    }
                }
                const before = () => this._drainClockBeforeMove(moveSlot);
                qiProtocol.weiqiMove(this, ws, msg, moveSlot, {
                    beforeCommit: before,
                    // 落子成功后把这手的对称轴与第二子/消雷写进棋谱，并抽下一手的轴（广播前完成，客户端才能重演）
                    afterPlace: () => {
                        const res = this._lastPlaceResult;
                        const last = this.moveCoords[this.moveCoords.length - 1];
                        if (last && last.type === 'move') {
                            if (this.config.symmetry) last.symmetryAxis = this.symmetryAxis;
                            if (res && res.placed && res.placed.length > 1) {
                                last.symRow = res.placed[1][0];
                                last.symCol = res.placed[1][1];
                                // 最后手标记：对称点落了两颗，两颗都要标
                                this.lastMoveMarkers = [
                                    { row: last.row, col: last.col, color: this.currentPlayer === 1 ? 1 : 2 },
                                    { row: res.placed[1][0], col: res.placed[1][1], color: this.currentPlayer === 1 ? 1 : 2 }
                                ];
                            }
                            if (res && res.clearedMine) last.clearedMine = res.clearedMine;
                        }
                        this._advanceSymmetryAxis();
                        return false;   // 不因本回调结束对局
                    }
                });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass': {
                const passSlot = slot;
                if (!this._timeAllowsPlay(passSlot)) {
                    if (passSlot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (this._mustCaptureCount() > 0) {
                    ws.send(JSON.stringify({ type: 'error', message: '必须提子' }));
                    return;
                }
                const beforeP = () => this._drainClockBeforeMove(passSlot);
                qiProtocol.weiqiPass(this, ws, passSlot, {
                    beforeCommit: beforeP,
                    afterBroadcast: () => this._advanceSymmetryAxis()   // 虚着也算一手
                });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'requestUndo':
                qiProtocol.weiqiRequestUndo(this, ws, slot);
                break;

            case 'undoResponse':
                qiProtocol.weiqiUndoResponse(this, ws, msg);
                break;

            case 'resign':
                qiProtocol.resign(this, ws, slot);
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw':
                qiProtocol.requestDraw(this, ws, slot);
                break;

            case 'drawResponse':
                qiProtocol.drawResponse(this, ws, msg);
                break;

            case 'requestEnd':
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!endOpponent) {
                    this.startScoreCounting(ws, ws);
                } else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;

            case 'endResponse':
                if (this.pendingEnd && msg.accept) {
                    this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                } else if (this.pendingEnd && !msg.accept) {
                    this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                }
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent))
                {
                    if (msg.accept) {
                        this.pendingScore.agreed.add(ws);
                        if (this.pendingScore.agreed.size === 2) {
                            const lead = this.scoreProposalData.lead;
                            this.gameOver = true;
                            this.winner = lead > 0 ? 'player1' : (lead < 0 ? 'player2' : 'draw');
                            this.setScoreResultTextByLead(lead);
                            this.broadcast({ type: 'scoreAgreed', winner: this.winner, lead });
                            this.pendingScore = null;
                            this.scoreProposalData = null;
                            this._stopClockTicker();
                        }
                    } else {
                        if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
                        this.broadcast({ type: 'scoreRejected' });
                        this.pendingScore = null;
                        this.scoreProposalData = null;
                    }
                }
                break;

            case 'exportRecord':
                qiProtocol.exportRecord(this, ws);
                break;

            case 'importRecord':
                qiProtocol.importRecord(this, ws, msg, { importBlockedMsg: '已有玩家入座，无法导入棋谱' });
                break;

            case 'resetRoom':
                qiProtocol.resetRoomToEmpty(this, ws);
                break;

            default:
                break;
        }
    }

    performUndo(steps, requesterWs)
    {
        if (steps === 0 || steps > this.historyBoards.length)
            return;

        for (let i = 0; i < steps; i++)
        {
            if (this.historyBoards.length > 0) {
                // 只有进过集合的手才该删（虚着/踩雷等手同样推了历史快照、盘面与上一手相同，
                // 拿它的快照去 delete 会误删上一次落子的记录 → 禁全同随后失效）
                const skPopped = this.historyBoards.pop();
                const skCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
                if (skCoord && ['move', 'mineHit'].includes(skCoord.type))
                    this.historyBoardSet.delete(this.boardToString(skPopped));
            }
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0)
                this.moveHistory.pop();
            if (this.moveCoords.length > 0)
                this.moveCoords.pop();
            if (this.config.symmetry) {
                this.symmetryAxis = this.historySymmetryAxis.length
                    ? this.historySymmetryAxis.pop()
                    : CustomWeiqiRules.nextSymmetryAxis(1);
            }

            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length == 0)
            this.board = this.copyBoard(this.openingBoard);
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
        this._syncClockAfterTurnChange();
    }

    copyMarkers(markers)
    {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    /** 开新局：沿用上一局的规则；勾选了附加物则重新随机摆放（手摆的黑白子不保留，与普通围棋一致） */
    resetGame()
    {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = this.createOpeningBoard();
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.moveCoords = [];
        this._resetSymmetryAxis();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getInitialState(), slots: { player1: false, player2: false } });
    }

    /**
     * 应用自定义规则（仅开局前、盘上无黑白子、房内无玩家时可改）。
     * 附加物相关选项有变化时先清空棋盘上全部附加物再按新配置随机摆放；
     * 只改短气/磁性/贪吃时棋盘一点不动（手摆的附加物保留）。
     */
    setCustomRules(rawConfig, requesterWs)
    {
        if (this.matchStarted || this.gameOver) return false;
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer || this.moveCoords.length > 0) return false;

        const next = normalizeCustomConfig(rawConfig);
        const shapeChanged = next.boardShape !== (this.config.boardShape || 'square');
        const extrasChanged = shapeChanged || EXTRA_KEYS.some((key) => !!next.extras[key] !== !!this.config.extras[key]);
        if (extrasChanged && !shapeChanged) this.clearExtras(this.board);
        if (shapeChanged) this._applyShapeIfChanged(next.boardShape);   // 必须在 this.config 换新之前（按旧形状记路数、取新形状路数）
        this.config = next;
        this.rules = new CustomWeiqiRules(this.boardSize, this.config);
        this.editBoardMode = this.config.boardShape === 'square' ? 'grid2d' : 'maskedGrid';
        this.gridW = this.rules.rows;
        this.gridH = this.rules.cols;
        if (shapeChanged) this.board = this.rules.emptyBoard();     // 换形状：旧盘面在新棋盘上不存在，整盘重来
        if (extrasChanged) this.rules.generateExtras(this.board);
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));
        this._resetSymmetryAxis();
        this.broadcast({ type: 'customRulesChanged', ...this.getState() });
        this._broadcastShapeGeometry();
        return true;
    }

    /** 把当前棋盘几何推给客户端（方格形状不发） */
    _broadcastShapeGeometry() {
        const geometry = this.shapeGeometryPayload();
        if (geometry) this.broadcast({ type: 'shapeGeometry', geometry });
    }

    /** 清空棋盘上全部附加物（黑白子与空点不动） */
    clearExtras(board) {
        for (let r = 0; r < this.rules.rows; r++) {
            for (let c = 0; c < this.rules.cols; c++) {
                if (!this.rules.inBounds(r, c)) continue;   // 盘外格不动（它们本来就是 -1）
                if (CustomWeiqiRules.isExtra(board[r][c])) board[r][c] = 0;
            }
        }
        return board;
    }

    setBoardSize(newSize, requesterWs)
    {
        const meta = this._shapeMeta();
        if (!Number.isInteger(newSize) || newSize < meta.min || newSize > meta.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘大小无效（${meta.label}支持 ${meta.min}～${meta.max} 路）` }));
            return false;
        }
        const hasAnyStone = this.board.some(row => row.some(v => v === 1 || v === 2));
        const hasPlayer = this.room.getPlayerBySlot('player1') || this.room.getPlayerBySlot('player2');
        if (hasAnyStone || hasPlayer) {

            return false;
        }
        this.sizeByShape[this.config.boardShape] = newSize;
        this.boardSize = newSize;
        this.rules = new CustomWeiqiRules(this.boardSize, this.config);
        this.gridW = this.rules.rows;
        this.gridH = this.rules.cols;
        this.resetGame();
        this.broadcast({ type: 'boardSizeChanged', ...this.getInitialState() });
        this._broadcastShapeGeometry();
        return true;
    }

    exportRecord()
    {
        let resultText = null;
        if (this.gameOver) {
            if (this.recordResultText) resultText = this.recordResultText;
            else if (this.winner === 'draw') resultText = '和棋';
            else if (this.winner === 'player1') resultText = '黑胜';
            else if (this.winner === 'player2') resultText = '白胜';
        }
        return {
            format: 'muzei',
            version: 1,
            gameType: '自定义围棋',
            gameId: 'custom-weiqi',
            boardSize: this.boardSize,
            komi: this.rules.komi(),
            customRules: this.configSnapshot(),
            players: { player1: null, player2: null },
            // 附加物随开局盘面一起导出（H/I/N/M 字母代号）
            initialPosition: encodeOpeningPositionCompact(this),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                if (m.type === 'pass') return p + 'p';
                if (m.type === 'mineHit') return p + 'm' + m.row + ',' + m.col;
                // 对称点：把本手用的对称轴记进棋谱（回放要靠它复原第二子）
                return p + m.row + ',' + m.col + (m.symmetryAxis ? ':' + m.symmetryAxis : '');
            }),
            timeControl: this.tcSettings === null
                ? null
                : (this.tcSettings.timed
                    ? {
                        enabled: true,
                        mainMinutes: this.tcSettings.mainMinutes,
                        byoyomiSeconds: this.tcSettings.byoyomiSeconds,
                        maxTimeouts: this.tcSettings.maxTimeouts
                    }
                    : { enabled: false }),
            result: resultText
        };
    }

    resetToEmpty() {
        this._stopClockTicker();
        this.slotJoinedAt = { player1: null, player2: null };
        this.hostWs = null;
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this.recordResultText = null;
        this.matchStarted = false;
        this.board = this._rebuildRules();
        this.openingBoard = this.copyBoard(this.board);
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.historyBoardSet.add(this.boardToString(this.board));
        this.moveHistory = [];
        this.moveCoords = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this._resetSymmetryAxis();
    }

    static parseMove(entry) {
        if (typeof entry === 'string') {
            const player = entry[0] === 'B' ? 'player1' : 'player2';
            // 对称点：普通着法带 `:轴名` 后缀（如 B5,5:rotate90cw）
            const colon = entry.indexOf(':');
            const axis = colon >= 0 ? entry.substring(colon + 1) : null;
            const body = colon >= 0 ? entry.substring(0, colon) : entry;
            if (body[1] === 'p') return { type: 'pass', player };
            if (body[1] === 'm') {
                const coords = body.substring(2).split(',').map(Number);
                return { type: 'mineHit', player, row: coords[0], col: coords[1] };
            }
            const coords = body.substring(1).split(',').map(Number);
            return { type: 'move', player, row: coords[0], col: coords[1], symmetryAxis: axis };
        }
        return entry;
    }

    /** 棋谱回放：附加物来自 initialPosition，规则来自棋谱里的 customRules */
    _replayRecordMoves(data, requesterWs) {
        const moves = (data.moves || []).map(CustomWeiqiRoom.parseMove);
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (!Number.isInteger(row) || !Number.isInteger(col) || !this.rules.inBounds(row, col)) {
                    return `第${i + 1}手坐标越界`;
                }
                // 回放不受贪吃限制影响：棋谱里记下的着手当时已经合法
                if (move.symmetryAxis) this.symmetryAxis = move.symmetryAxis;   // 对称点：用棋谱里记的轴
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal, { skipGreedy: true });
                if (!newBoard) return `第${i + 1}手无法落子`;
                const res = this._lastPlaceResult;
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(this.boardToString(newBoard));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push(Object.assign(
                    { type: 'move', player: slot, row, col },
                    this.config.symmetry ? { symmetryAxis: this.symmetryAxis } : {},
                    (res && res.placed && res.placed.length > 1) ? { symRow: res.placed[1][0], symCol: res.placed[1][1] } : {},
                    (res && res.clearedMine) ? { clearedMine: res.clearedMine } : {}
                ));
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this._advanceSymmetryAxis();
            } else if (move.type === 'mineHit') {
                const { row, col } = move;
                if (!Number.isInteger(row) || !Number.isInteger(col) || !this.rules.inBounds(row, col)) {
                    return `第${i + 1}手坐标越界`;
                }
                if (this.board[row][col] === MINE) this.board[row][col] = 0;
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyBoardSet.add(this.boardToString(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'mineHit', player: slot, row, col });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this._advanceSymmetryAxis();
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
                this._advanceSymmetryAxis();
            }
        }
        return null;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'custom-weiqi') {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要自定义围棋棋谱）。' }));
            return;
        }
        if (data.customRules) this.config = normalizeCustomConfig(data.customRules);
        const meta = this._shapeMeta();
        const newSize = data.boardSize || meta.def;
        if (!Number.isInteger(newSize) || newSize < meta.min || newSize > meta.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱中棋盘大小无效（${meta.label}支持 ${meta.min}～${meta.max} 路）` }));
            return;
        }

        this.sizeByShape[this.config.boardShape] = newSize;
        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition, { isValid: (r, cc) => this.rules.inBounds(r, cc) });
        this.openingBoard = this.copyBoard(this.board);
        this.historyBoards = [];
        this.historyBoardSet.clear();
        this.historyBoardSet.add(this.boardToString(this.board));

        this._broadcastShapeGeometry();
        const replayError = this._replayRecordMoves(data, requesterWs);
        if (replayError) {
            this.resetToEmpty();
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：${replayError}` }));
            this.broadcast({ type: 'roomReset', ...this.getState() });
            return;
        }

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
            }
            this.matchStarted = true;
        }

        if (data.result || data.resultText) {
            // 导入不做任何判定：结果只按棋谱记录显示（公共层已按本棋种执方名把文案折成座位）
            this.gameOver = true;
            this.recordResultText = data.resultText ? String(data.resultText) : '';
            if (data.result === 'player1' || data.result === 'player2' || data.result === 'draw')
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }

    getMoveCount() {
        return this.moveHistory.length;
    }

    onPlayerLeave(ws)
    {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot, matchStarted: !!this.matchStarted });

        if (this.hostWs === ws) {
            const other = slot === 'player1'
                ? this.room.getPlayerBySlot('player2')
                : this.room.getPlayerBySlot('player1');
            this.hostWs = other || null;
        }

        if (this.pendingUndo && this.pendingUndo.requester === ws) this.pendingUndo = null;
        if (this.pendingNewGame === ws) this.pendingNewGame = null;
        if (this.pendingDraw === ws) this.pendingDraw = null;
        if (this.pendingEnd && (this.pendingEnd.requester === ws || this.pendingEnd.opponent === ws)) this.pendingEnd = null;
        if (this.pendingScore && (this.pendingScore.requester === ws || this.pendingScore.opponent === ws)) {
            if (this.tcClock && this.tcClock.timed) qiMatchTimeControl.setPaused(this.tcClock, false);
            this.pendingScore = null;
            this.scoreProposalData = null;
        }
        if (this.tcNego) {
            this.tcNego = null;
            this.room.broadcast({ type: 'timeControlReset', reason: 'playerLeft' });
        }
        if (slot) this.slotJoinedAt[slot] = null;
    }
}

module.exports = {
    CustomWeiqiRoom,
    CustomWeiqiRules,
    HOLE,
    BRIDGE,
    MINE,
    NEUTRAL,
    SYMMETRY_TYPES,
    ENABLED_SYMMETRIES,
    OPENING_SYMMETRIES,
    PREV_RULES,
    BOARD_SHAPES,
    SHAPE_META,
    shapeMeta,
    buildShapeGeometry,
    shapeGeometryPayload,
    normalizeCustomConfig,
    initRoom(room) {
        room.gameLogic = new CustomWeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};
