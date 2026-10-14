/**
 * 非四角围棋（non-rectangular-weiqi）：一个棋种，四个子棋类（subGameId 沿用原棋种 id）
 *   六角围棋 hexagon-weiqi / 花形五角围棋 floret-pentagon-weiqi /
 *   开罗五角围棋 cairo-pentagon-weiqi / 扭棱四角围棋 snub-quadrangle-weiqi
 *
 * 统一棋盘模型（四种棋盘共用一套，子棋类只提供几何）：
 *   - 盘    ：掩码二维网格 board[r][c]，-1 = 无效点、0/1/2 = 空/黑/白；gridW = 行数、gridH = 列数
 *   - 邻接  ：getNeighbors(r, c)；有效点：isValidVertex(r, c)；vertexCount = 有效格点数
 *   - 规则  ：公共层 gridGraphWeiqiRules（提子/禁全同/Benson/数点，与原开罗、扭棱一致）
 *   - 协议  ：一律坐标 行,列（棋谱 B5,5；虚着 Bp）；编辑盘面走公共 editBoardMode='maskedGrid'
 *   顶点图类（六角/花形）的生成器仍按顶点+边算，再由 vertexGraphModel() 摊进掩码网格。
 *
 * 人机对战：引擎目录 = katagos/{subGameId}/（权重围棋家族折叠到 weight-weiqi 是唯一例外），
 * 棋盘尺寸对引擎读 this.boardSize（路数类 = 路数、开罗 = 列数、扭棱 = 3×路数−2），
 * 非方形棋盘另给 katagoBoardWidth/Height（GTP 的 boardsize X:Y）。
 */

const { qiApplyRecordKomi, qiEffectiveKomi, QiTwoPlayerRoomBase, gridGraphWeiqiRules, qiMatchTimeControl, qiProtocol, qiBoardSeatOverlay } = require('../common');

/** 子棋类清单（顺序即下拉框顺序） */
const SUB_GAMES = ['triangle-weiqi', 'snub-quadrangle-weiqi', 'cairo-pentagon-weiqi', 'floret-pentagon-weiqi', 'hexagon-weiqi', 'rhom-triangle-weiqi', 'hexagon-triangle-weiqi'];
const DEFAULT_SUB_GAME = 'triangle-weiqi';

/**
 * 子棋类元数据。
 *   min/max/def：路数范围与默认路数（六角/花形 = 棋盘路数 n；开罗/扭棱 = 网格「道数」lanes）
 *   komi(lanes)：贴目；gtpSize(lanes)：引擎看到的棋盘尺寸（与该棋种 katagos 目录里 gtp.cfg 的 boardsize 约定一致）
 */
const SUB_META = {
    'triangle-weiqi': {
        name: '三角', gameType: '三角', prefix: '三角',
        min: 7, max: 31, def: 27,
        komi: () => 3.25, gtpSize: (lanes) => lanes
    },
    'snub-quadrangle-weiqi': {
        name: '扭棱四角', gameType: '扭棱四角', prefix: '扭棱四角',
        min: 3, max: 9, def: 7,
        komi: (lanes) => (lanes === 3 ? 3 : 2), gtpSize: (lanes) => 3 * lanes - 2
    },
    'cairo-pentagon-weiqi': {
        name: '开罗五角', gameType: '开罗五角', prefix: '开罗五角',
        min: 3, max: 9, def: 7,
        komi: (lanes) => (lanes === 3 ? 2 : 3), gtpSize: (lanes) => 4 * lanes - 3
    },
    'floret-pentagon-weiqi': {
        name: '花形五角', gameType: '花形五角', prefix: '花形五角',
        min: 3, max: 9, def: 7,
        komi: () => 3.25, gtpSize: (lanes) => lanes
    },
    'hexagon-weiqi': {
        name: '六角', gameType: '六角', prefix: '六角',
        min: 4, max: 11, def: 9,
        komi: (lanes) => (lanes >= 9 ? 7.5 : [0, 0, 0, 12, 7, 4.5, 5.5, 6.5, 7.5][lanes]), gtpSize: (lanes) => lanes
    },
    'rhom-triangle-weiqi': {
        name: '菱形三角', gameType: '菱形三角', prefix: '菱形三角',
        min: 5, max: 21, def: 13,
        komi: (lanes) => (lanes <= 8 ? 4.25 : 3.25), gtpSize: (lanes) => lanes
    },
    'hexagon-triangle-weiqi': {
        name: '六角形三角', gameType: '六角形三角', prefix: '六角形三角',
        min: 3, max: 15, def: 6,
        komi: () => 3.25, gtpSize: (lanes) => 2 * lanes - 1
    }
};

/* ============================ 一、七种棋盘的几何 ============================ */

/** 六角围棋：n 路正六边形密铺的顶点图（顶点 + 邻接 + 显示坐标表） */
function generateHexBoardData(n) {
    const S = n - 1;
    const R = 2;
    const sqrt3 = Math.sqrt(3);
    const vertexMap = new Map();
    const vertices = [];
    const hexagons = [];
    const dx = [R, R / 2, -R / 2, -R, -R / 2, R / 2];
    const dy = [0, R * sqrt3 / 2, R * sqrt3 / 2, 0, -R * sqrt3 / 2, -R * sqrt3 / 2];

    for (let q = -(S - 1); q <= S - 1; q++) {
        for (let r = -(S - 1); r <= S - 1; r++) {
            const s = -q - r;
            if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > S - 1) continue;
            const cx = R * (3 / 2) * q;
            const cy = R * sqrt3 * (r + q / 2);
            const hexIds = [];
            for (let j = 0; j < 6; j++) {
                const x = cx + dx[j];
                const y = cy + dy[j];
                const key = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
                if (!vertexMap.has(key)) {
                    vertexMap.set(key, vertices.length);
                    vertices.push({ x, y });
                }
                hexIds.push(vertexMap.get(key));
            }
            hexagons.push(hexIds);
        }
    }

    for (let i = 0; i < vertices.length; i++) {
        const { x, y } = vertices[i];
        vertices[i] = { x: -y, y: x };
    }

    const V = vertices.length;
    const neighborSets = Array.from({ length: V }, () => new Set());
    for (const hex of hexagons) {
        for (let i = 0; i < 6; i++) {
            const a = hex[i];
            const b = hex[(i + 1) % 6];
            if (a !== b) {
                neighborSets[a].add(b);
                neighborSets[b].add(a);
            }
        }
    }
    const neighborList = neighborSets.map(set => Array.from(set));
    return { vertexCount: V, neighbors: neighborList, koordOf: vertexRowsToKoord(vertices) };
}

/** 花形五角围棋：六个花瓣五边形铺一格，n 路的顶点图 */
const FLORET_SQRT3 = Math.sqrt(3);
/** 将边长 2/1 的标准花形五边形缩放到与格距匹配 */
const FLORET_SIGMA = FLORET_SQRT3 / 2;
/** 花形五边形（60°+四个120°），CCW，A 为 60° 顶点；边长序 2,1,1,1,2（缩放前） */
const FLORET_PENT_UNSCALED = {
    A: [0, 0],
    B: [-1, FLORET_SQRT3],
    C: [-2, FLORET_SQRT3],
    D: [-2.5, FLORET_SQRT3 / 2],
    E: [-2, 0]
};

function rotPtFloret(p, r) {
    const c = Math.cos(r), s = Math.sin(r);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
}

function scaleFloretPt(p) {
    return [p[0] * FLORET_SIGMA, p[1] * FLORET_SIGMA];
}

/** 六个「花瓣」五边形共 60° 中心，铺满与开罗版相同的一个平行六边形格位。 */
function oneFloretFlower(ox, oy) {
    const out = [];
    for (let pet = 0; pet < 6; pet++) {
        const pts = {};
        for (const key of Object.keys(FLORET_PENT_UNSCALED)) {
            let q = rotPtFloret(FLORET_PENT_UNSCALED[key], pet * Math.PI / 3 - Math.atan(FLORET_SQRT3 / 9));
            q = scaleFloretPt(q);
            pts[key] = [q[0] + ox, q[1] + oy];
        }
        out.push(pts);
    }
    return out;
}

function floretVertexKey(x, y) {
    return `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
}

/**
 * 路数 n：格矢 (ux,vy)=(1.5√7, 1.5√21)；主区 i∈[0,⌊√3·n−3⌋], j∈[0,n−2]，半格嵌入 i∈[0,⌊√3·n−4⌋], j∈[0,n−3]；子下在格点（顶点）上。
 * @param {number} n 路数 3～13
 */
function generateFloretPentBoardData(n) {
    const ux = 1.5 * Math.sqrt(7), uy = 0, vx = 0, vy = 1.5 * Math.sqrt(21);
    const vertexMap = new Map();
    const vertices = [];
    const edgeSet = new Set();

    function addVertex(x, y) {
        const k = floretVertexKey(x, y);
        if (!vertexMap.has(k)) {
            vertexMap.set(k, vertices.length);
            vertices.push({ x, y });
        }
        return vertexMap.get(k);
    }

    function addEdge(a, b) {
        if (a === b) return;
        edgeSet.add(a < b ? `${a},${b}` : `${b},${a}`);
    }

    function addFlowerAtGrid(px, py) {
        const ox = px * ux + py * vx;
        const oy = px * uy + py * vy;
        for (const P of oneFloretFlower(ox, oy)) {
            const order = ['A', 'B', 'C', 'D', 'E'];
            const ids = order.map(k => addVertex(P[k][0], P[k][1]));
            for (let k = 0; k < 5; k++)
                addEdge(ids[k], ids[(k + 1) % 5]);
        }
    }

    for (let i = 0; i <= FLORET_SQRT3 * n - 3; i++) {
        for (let j = 0; j <= n - 2; j++)
            addFlowerAtGrid(i, j);
    }
    for (let i = 0; i <= FLORET_SQRT3 * n - 4; i++) {
        for (let j = 0; j <= n - 3; j++)
            addFlowerAtGrid(i + 0.5, j + 0.5);
    }

    for (let i = 0; i < vertices.length; i++) {
        const { x, y } = vertices[i];
        vertices[i] = { x: -y, y: x };
    }

    const V = vertices.length;
    const neighborSets = Array.from({ length: V }, () => new Set());
    for (const e of edgeSet) {
        const [a, b] = e.split(',').map(Number);
        neighborSets[a].add(b);
        neighborSets[b].add(a);
    }
    const neighbors = neighborSets.map(set => Array.from(set));
    return { vertexCount: V, neighbors, koordOf: vertexRowsToKoord(vertices) };
}

/**
 * 顶点图共用：按显示坐标排出行列表。
 *   行 0 = 屏幕最上面一行：棋盘显示时 y 做了上下翻折（y 越大越靠上），故按 y 从大到小排行
 *   列 = 该行内自左往右，0 起
 */
function vertexRowsToKoord(vertices) {
    const rows = [];
    for (let v = 0; v < vertices.length; v++) {
        const y = vertices[v].y;
        let row = rows.find((r) => Math.abs(r.y - y) < 1e-6);
        if (!row) {
            row = { y, pts: [] };
            rows.push(row);
        }
        row.pts.push(v);
    }
    rows.sort((a, b) => b.y - a.y);
    const koordOf = new Array(vertices.length);
    rows.forEach((row, ri) => {
        row.pts.sort((a, b) => vertices[a].x - vertices[b].x);
        row.pts.forEach((v, ci) => { koordOf[v] = [ri, ci]; });
    });
    return koordOf;
}

/* ==================== 一之二、六角：站点坐标 ↔ 引擎网格坐标 ==================== */

/** 六角引擎（katagos/hexagon-weiqi）的网格尺寸：gridW = 4n−5（列/x）、gridH = 4n−4（行/y） */
function hexEngineGridDims(lanes) {
    return { w: 4 * lanes - 5, h: 4 * lanes - 4 };
}

/**
 * 六角的站点坐标 (r, c) → 引擎网格坐标 (row, col)。
 *   站点：行 0 = 屏幕最上、行内自左往右（vertexRowsToKoord）；
 *   引擎（hexagon.h）：row 0 = 最下一行、col 0 = 最左；每行是一段连续列区间且只取同奇偶列（蜂窝交错）。
 * 两条公式已用浮点顶点逐点对拍 n=3..11：row = gridH−1−r、行内 col = lo(row) + 2·(列数−1−c)。
 */
function hexEngineCoordOf(lanes, r, c) {
    const { w: gridW, h: gridH } = hexEngineGridDims(lanes);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= gridH || c < 0) return null;
    const row = gridH - 1 - r;
    const jj = Math.min(row, gridH - 1 - row);
    const lo = (lanes - 1) - Math.floor((jj + 1) / 2);
    const count = (gridW + 1) / 2 - lo;              // 该行有几个点
    if (c >= count) return null;
    return { row, col: lo + 2 * (count - 1 - c) };
}

/** 六角：引擎网格坐标 (row, col) → 站点坐标 (r, c)（hexEngineCoordOf 的逆） */
function hexSiteCoordOf(lanes, row, col) {
    const { w: gridW, h: gridH } = hexEngineGridDims(lanes);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= gridH) return null;
    const jj = Math.min(row, gridH - 1 - row);
    const lo = (lanes - 1) - Math.floor((jj + 1) / 2);
    const count = (gridW + 1) / 2 - lo;
    const k = Math.round((col - lo) / 2);            // 行内第几个点
    if (k < 0 || k >= count || lo + 2 * k !== col) return null;
    return { row: gridH - 1 - row, col: count - 1 - k };
}

/** 开罗五角：lanes 路 = (4·lanes−5) 行 × (4·lanes−3) 列（与 VariantQi / cpp cairopentagon.h 一致） */
function cairoGridDims(lanes) {
    return { w: 4 * lanes - 5, h: 4 * lanes - 3 };
}

/** 开罗：合法格 = 行偶 或 列奇（1-based 奇数行全列、偶数行仅偶数列） */
function cairoIsValidVertex(row, col, gridW, gridH) {
    if (row < 0 || col < 0 || row >= gridW || col >= gridH) return false;
    return !((row & 1) === 1 && (col & 1) === 0);
}

/** 开罗邻接（与 VariantQi / cpp 一致）：规则1 曼哈顿距离 1；规则2 水平 Δ2；规则3 垂直 Δ2（按 (r%4,c%4) 类） */
function cairoNeighborList(row, col) {
    const arr = [];
    if ((col & 1) === 1) arr.push([row - 1, col], [row + 1, col]);
    if ((row & 1) === 0) arr.push([row, col - 1], [row, col + 1]);
    const rm = row & 3, cm = col & 3;
    if (rm === 1) {
        if (cm === 1) arr.push([row, col + 2]);
        else if (cm === 3) arr.push([row, col - 2]);
    } else if (rm === 3) {
        if (cm === 3) arr.push([row, col + 2]);
        else if (cm === 1) arr.push([row, col - 2]);
    }
    if (cm === 0) {
        if (rm === 0) arr.push([row + 2, col]);
        else if (rm === 2) arr.push([row - 2, col]);
    } else if (cm === 2) {
        if (rm === 2) arr.push([row + 2, col]);
        else if (rm === 0) arr.push([row - 2, col]);
    }
    return arr;
}

/** 扭棱四角：lanes 路 = (3·lanes−2)² 的网格 */
function snubGridDims(lanes) {
    const n = 3 * lanes - 2;
    return { w: n, h: n };
}

function snubIsValidVertex(row, col, gridW, gridH) {
    if (row < 0 || col < 0 || row >= gridW || col >= gridH) return false;
    if (row % 3 === 2 && col % 3 === 2) return false;
    if (row === gridW - 1 && row % 3 === 0 && col % 3 === 1) return false;
    if (col === gridH - 1 && row % 3 === 0 && col % 3 === 0) return false;
    return true;
}

/** 扭棱四角邻接（与 C# 取得鄰點 一致） */
function snubNeighborList(row, col) {
    if (row % 3 === 0 && col % 3 === 0)
        return [[row - 1, col], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, col]];
    if (row % 3 === 1 && col % 3 === 0)
        return [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col]];
    if (row % 3 === 2 && col % 3 === 0)
        return [[row - 1, col - 1], [row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col]];
    if (row % 3 === 0 && col % 3 === 1)
        return [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col], [1 + row, 1 + col]];
    if (row % 3 === 1 && col % 3 === 1)
        return [[row - 1, col], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, col]];
    if (row % 3 === 2 && col % 3 === 1)
        return [[row - 1, col], [row - 1, 1 + col], [1 + row, col - 1], [1 + row, col], [1 + row, 1 + col]];
    if (row % 3 === 0 && col % 3 === 2)
        return [[row - 1, col - 1], [row - 1, 1 + col], [row, col - 1], [row, 1 + col], [1 + row, 1 + col]];
    return [[row - 1, col - 1], [row, col - 1], [row, 1 + col], [1 + row, col - 1], [1 + row, 1 + col]];
}

/**
 * 把「网格 + 有效性 + 邻接」整理成统一模型。
 * @returns {{gridW:number, gridH:number, vertexCount:number,
 *            isValidVertex:(r:number,c:number)=>boolean,
 *            getNeighbors:(r:number,c:number)=>number[][]}}
 */
function gridModel(gridW, gridH, isValidCell, neighborsOf) {
    // 线性键：越界一律当作无键（否则 c = -1 会串到上一行行尾，出现跨界假邻接）
    const keyOf = (r, c) => (r >= 0 && c >= 0 && r < gridW && c < gridH ? r * gridH + c : -1);
    const valid = [];
    const index = new Map();
    for (let r = 0; r < gridW; r++) {
        for (let c = 0; c < gridH; c++) {
            if (!isValidCell(r, c)) continue;
            index.set(keyOf(r, c), valid.length);
            valid.push([r, c]);
        }
    }
    const neighborRows = valid.map(([r, c]) => {
        const out = [];
        for (const [nr, nc] of neighborsOf(r, c)) {
            const k = index.get(keyOf(nr, nc));
            if (k !== undefined) out.push(k);
        }
        return out;
    });
    return {
        gridW, gridH,
        vertexCount: valid.length,
        /** 第 i 个有效点 → [行, 列]（棋谱/协议坐标） */
        koordAt: (i) => valid[i],
        koordToIndex: (r, c) => {
            const k = index.get(keyOf(r, c));
            return k === undefined ? -1 : k;
        },
        isValidVertex: (r, c) => keyOf(r, c) >= 0 && isValidCell(r, c),
        getNeighbors: (r, c) => {
            const i = index.get(keyOf(r, c));
            if (i === undefined) return [];
            return neighborRows[i].map((k) => valid[k]);
        }
    };
}

/** 顶点图（六角/花形）→ 统一模型：顶点按显示坐标表摊进掩码网格 */
function vertexGraphModel(gen, lanes) {
    const { neighbors, koordOf } = gen(lanes);
    let gridW = 0, gridH = 0;
    for (const rc of koordOf) {
        if (rc[0] + 1 > gridW) gridW = rc[0] + 1;
        if (rc[1] + 1 > gridH) gridH = rc[1] + 1;
    }
    const vertexAt = new Map();
    for (let v = 0; v < koordOf.length; v++) vertexAt.set(koordOf[v][0] * gridH + koordOf[v][1], v);
    const model = gridModel(
        gridW, gridH,
        (r, c) => vertexAt.has(r * gridH + c),
        (r, c) => {
            const v = vertexAt.get(r * gridH + c);
            if (v === undefined) return [];
            return neighbors[v].map((nv) => koordOf[nv]);
        }
    );
    return model;
}

/** 子棋类 → 统一模型 */
/* ---- 三角围棋族（三角 / 菱形三角 / 六角形三角）：三角形格点、6 向邻接 ----
   从合并前的 games/triangle-weiqi.js 原样搬来（行数/行长/邻接口径逐字一致），
   只是换成掩码网格模型：非格点 = −1，坐标 (r,c) 即棋谱坐标（与旧棋谱逐字相同）。 */

/** 行数：三角/菱形 = 路数；六角形 = 2·路数−1 */
function triRows(kind, lanes) {
    return kind === 'hexagon' ? 2 * lanes - 1 : lanes;
}

/** 行 r 的格点数：三角 r+1；菱形恒为路数；六角形 N+min(r, 2N−2−r) */
function triRowLen(kind, lanes, r) {
    if (kind === 'triangle') return r + 1;
    if (kind === 'rhombus') return lanes;
    return lanes + Math.min(r, 2 * lanes - 2 - r);
}

/** 6 向候选邻点（越界/掩码外的由 gridModel 过滤）：菱形斜向与三角相反；六角形按相邻行长增减推导 */
function triNeighborList(kind, lanes, r, c) {
    if (kind === 'triangle')
        return [[r, c + 1], [r, c - 1], [r + 1, c], [r - 1, c], [r + 1, c + 1], [r - 1, c - 1]];
    if (kind === 'rhombus')
        return [[r, c + 1], [r, c - 1], [r + 1, c], [r - 1, c], [r + 1, c - 1], [r - 1, c + 1]];
    const rows = triRows(kind, lanes);
    const out = [[r, c - 1], [r, c + 1]];
    if (r > 0) {
        if (triRowLen(kind, lanes, r - 1) > triRowLen(kind, lanes, r)) out.push([r - 1, c], [r - 1, c + 1]);
        else out.push([r - 1, c - 1], [r - 1, c]);
    }
    if (r < rows - 1) {
        if (triRowLen(kind, lanes, r + 1) > triRowLen(kind, lanes, r)) out.push([r + 1, c], [r + 1, c + 1]);
        else out.push([r + 1, c - 1], [r + 1, c]);
    }
    return out;
}

/** 三角族的掩码网格模型：网格是方阵（行数 × 最大行长），锯齿外的格点无效 */
function triGridModel(kind, lanes) {
    const rows = triRows(kind, lanes);
    const cols = kind === 'hexagon' ? 2 * lanes - 1 : lanes;
    return gridModel(rows, cols, (r, c) => c < triRowLen(kind, lanes, r), (r, c) => triNeighborList(kind, lanes, r, c));
}

/** 子棋类 → 统一模型 */
const MODEL_BUILDERS = {
    'hexagon-weiqi': (lanes) => vertexGraphModel(generateHexBoardData, lanes),
    'floret-pentagon-weiqi': (lanes) => vertexGraphModel(generateFloretPentBoardData, lanes),
    'cairo-pentagon-weiqi': (lanes) => {
        const { w, h } = cairoGridDims(lanes);
        return gridModel(w, h, (r, c) => cairoIsValidVertex(r, c, w, h), cairoNeighborList);
    },
    'snub-quadrangle-weiqi': (lanes) => {
        const { w, h } = snubGridDims(lanes);
        return gridModel(w, h, (r, c) => snubIsValidVertex(r, c, w, h), snubNeighborList);
    },
    'triangle-weiqi': (lanes) => triGridModel('triangle', lanes),
    'rhom-triangle-weiqi': (lanes) => triGridModel('rhombus', lanes),
    'hexagon-triangle-weiqi': (lanes) => triGridModel('hexagon', lanes)
};

/* ============================ 二、房间逻辑 ============================ */

class NonRectangularWeiqiRoom extends QiTwoPlayerRoomBase {
    constructor(room, subGameId = DEFAULT_SUB_GAME) {
        super(room);
        this.subGameId = SUB_GAMES.includes(subGameId) ? subGameId : DEFAULT_SUB_GAME;
        this.editBoardMode = 'maskedGrid';
        /** 各子棋类上次用的路数：首次进入某子棋类用它的默认路数，之后沿用前一次的 */
        this.sizeBySubGame = Object.create(null);
        this.boardLanes = this.subCfg().def;
        this._initState();
        this._buildBoard();
    }

    subCfg() {
        return SUB_META[this.subGameId] || SUB_META[DEFAULT_SUB_GAME];
    }

    /** 初始对局状态（构造与 resetToEmpty 共用） */
    _initState() {
        this.currentPlayer = 1;
        this.historyBoards = [];
        this.historyBoardSet = new Set();
        this.moveHistory = [];
        this.historyMarkers = [];
        this.lastMoveMarkers = [];
        this.moveCoords = [];
        this.gameOver = false;
        this.winner = null;
        this.passCounter = 0;
        this.pendingNewGame = null;
        this.pendingUndo = null;
        this.pendingDraw = null;
        this.pendingEnd = null;
        this.pendingScore = null;
        this.scoreProposalData = null;
        this.recordResultText = null;
        this.slotJoinedAt = { player1: null, player2: null };
        this.tcNego = null;
        this.tcSettings = null;
        this.tcClock = null;
        this._clockInterval = null;
        this.matchStarted = false;
    }

    /** 按当前子棋类与路数重建棋盘、邻接与开局盘（子棋类/路数变化的唯一入口） */
    _buildBoard() {
        const model = (MODEL_BUILDERS[this.subGameId] || MODEL_BUILDERS[DEFAULT_SUB_GAME])(this.boardLanes);
        this._model = model;
        this.gridW = model.gridW;
        this.gridH = model.gridH;
        this.vertexCount = model.vertexCount;
        this.board = Array.from({ length: this.gridW }, (_, r) =>
            Array.from({ length: this.gridH }, (_, c) => (model.isValidVertex(r, c) ? 0 : -1)));
        this.openingBoard = this.copyBoard(this.board);
        // 引擎看到的棋盘尺寸：路数类 = 路数、开罗 = 列数、扭棱 = 3×路数−2；
        // 非方形棋盘（开罗、以及顶点图摊出来的六角/花形）另给宽高，走 GTP 的 boardsize X:Y
        this.boardSize = this.subCfg().gtpSize(this.boardLanes);
        if (this.subGameId === 'hexagon-weiqi') {
            // 六角：引擎的网格与站点显示网格不是同一个坐标系（引擎是 4n−5 列 × 4n−4 行的细格、蜂窝交错），
            // 所以宽高按引擎网格给，坐标由 katagoCoordOf/katagoIndexAt 换算
            const g = hexEngineGridDims(this.boardLanes);
            this.katagoBoardWidth = g.w;
            this.katagoBoardHeight = g.h;
        } else if (this.gridH !== this.gridW) {
            this.katagoBoardWidth = this.gridH;
            this.katagoBoardHeight = this.gridW;
        } else {
            delete this.katagoBoardWidth;
            delete this.katagoBoardHeight;
        }
    }

    /** 记住当前子棋类用的路数 */
    _rememberSize() {
        this.sizeBySubGame[this.subGameId] = this.boardLanes;
    }

    /** 站点坐标 (r,c) → 引擎网格坐标 (row,col)。只有坐标系不同的子棋类（六角）需要换算，其余 1:1 */
    katagoCoordOf(r, c) {
        if (this.subGameId === 'hexagon-weiqi') return hexEngineCoordOf(this.boardLanes, r, c);
        return { row: r, col: c };
    }

    /** 引擎网格坐标 (row,col) → 站点坐标 (r,c)（katagoCoordOf 的逆） */
    katagoIndexAt(row, col) {
        if (this.subGameId === 'hexagon-weiqi') return hexSiteCoordOf(this.boardLanes, row, col);
        return { row, col };
    }

    isValidVertex(r, c) {
        return this._model.isValidVertex(r, c);
    }

    getNeighbors(r, c) {
        return this._model.getNeighbors(r, c);
    }

    _nb() {
        return (r, c) => this.getNeighbors(r, c);
    }

    komi() {
        if (this.importedKomi != null) return this.importedKomi;   // 导入棋谱采纳记录贴目
        return this.subCfg().komi(this.boardLanes);
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

    _firstPickerSlot() {
        const tb = this.slotJoinedAt.player1;
        const tw = this.slotJoinedAt.player2;
        if (tb == null || tw == null) return 'player1';
        return tb <= tw ? 'player1' : 'player2';
    }

    _finalizeTimeControl(valid) {
        this.tcSettings = valid.timed
            ? {
                timed: true,
                mainMinutes: valid.mainMinutes,
                byoyomiSeconds: valid.byoyomiSeconds,
                maxTimeouts: valid.maxTimeouts
            }
            : { timed: false };
        this.tcNego = null;
        this.matchStarted = true;
        const now = Date.now();
        this.tcClock = qiMatchTimeControl.createClock(this.tcSettings, now);
        if (this.tcClock.timed) {
            qiMatchTimeControl.setActiveSlot(this.tcClock, this.currentPlayer === 1 ? 'player1' : 'player2', now);
            this._startClockTicker();
            this._broadcastClock();
        } else {
            this.tcClock = null;
        }
        this.broadcast({
            type: 'timeControlAgreed',
            settings: this.tcSettings,
            clock: this.tcClock ? qiMatchTimeControl.snapshotForClient(this.tcClock) : null
        });
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

    copyBoard(src) { return src.map(row => row.slice()); }

    copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    boardToString(board) {
        let s = '';
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                if (this.isValidVertex(r, c)) s += board[r][c];
                else s += 'x';
            }
        }
        return s;
    }

    /* ---------- 规则：全部走公共层 gridGraphWeiqiRules ---------- */

    countGroupLiberties(board, row, col) {
        return gridGraphWeiqiRules.countGroupLiberties(board, row, col, this._nb());
    }

    removeGroup(board, row, col, color) {
        gridGraphWeiqiRules.removeGroup(board, row, col, color, this._nb());
    }

    tryPlaceStone(boardBefore, row, col, playerVal) {
        if (!this.isValidVertex(row, col) || boardBefore[row][col] !== 0) return null;
        return gridGraphWeiqiRules.tryPlaceStoneNLiberty(
            boardBefore, row, col, playerVal, (b) => this.copyBoard(b), this._nb(), 1
        );
    }

    removeDeadAndDying(srcBoard) {
        return gridGraphWeiqiRules.removeDeadAndDying(
            srcBoard, this.gridW, this.gridH,
            (b) => this.copyBoard(b), this._nb(), (r, c) => this.isValidVertex(r, c)
        );
    }

    assignTerritory(liveBoard) {
        return gridGraphWeiqiRules.assignTerritoryWithRange(
            liveBoard, this.gridW, this.gridH,
            this._nb(), (r, c) => this.isValidVertex(r, c)
        );
    }

    computeScore(liveBoard, territory) {
        return gridGraphWeiqiRules.computeScore(
            liveBoard, territory, this.gridW, this.gridH,
            (r, c) => this.isValidVertex(r, c)
        );
    }

    /** 形势判断/数点用的领先目数（Benson 保活 + 确定领地覆盖；四种棋盘同一套算法） */
    computeLead() {
        const bensonOf = (bd) => gridGraphWeiqiRules.bensonAlive(
            bd, this.gridH, this.gridW, this._nb(), (r, c) => this.isValidVertex(r, c)
        );
        const benson = bensonOf(this.board);
        let liveBoard = this.removeDeadAndDying(this.board);
        let changed = true;
        while (changed) {
            changed = false;
            const cleaned = this.removeDeadAndDying(liveBoard);
            for (let r = 0; r < this.gridW; r++) {
                for (let c = 0; c < this.gridH; c++) {
                    const v = this.board[r][c];
                    if (benson.alive[r][c] && (v === 1 || v === 2) && cleaned[r][c] !== v) {
                        cleaned[r][c] = v;
                        changed = true;
                    }
                }
            }
            liveBoard = cleaned;
        }
        const territory = this.assignTerritory(liveBoard);
        const secure = bensonOf(liveBoard);
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                if (liveBoard[r][c] === 0 && secure.territory[r][c]) territory[r][c] = secure.territory[r][c];
            }
        }
        const { blackTotal, whiteTotal } = this.computeScore(liveBoard, territory);
        return blackTotal - whiteTotal - 2 * this.komi();
    }

    /* ---------- 结果文案 ---------- */

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

    /* ---------- 状态 / 切子棋类 / 改路数 ---------- */

    getState() {
        return {
            subGameId: this.subGameId,
            subGameName: this.subCfg().name,
            boardLanes: this.boardLanes,
            // 客户端下拉用的「路数」；引擎读的是实例上的 boardSize（GTP 尺寸，语义见 _buildBoard）
            boardSize: this.boardLanes,
            gridWidth: this.gridH,
            gridHeight: this.gridW,
            vertexCount: this.vertexCount,
            komi: this.komi(),
            board: this.board,
            numberOfHands: 1 + this.historyBoards.length,
            currentPlayer: this.currentPlayer,
            lastMoveMarkers: this.lastMoveMarkers,
            gameOver: this.gameOver,
            winner: this.winner,
            recordResultText: this.recordResultText,
            moveCoords: this.moveCoords,
            slots: {
                player1: !!this.room.getPlayerBySlot('player1'),
                player2: !!this.room.getPlayerBySlot('player2')
            },
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
     * 切换子棋类（仅观战者、房内无棋手时）。首次进入某子棋类用它自己的默认路数，
     * 之后再切回该子棋类沿用上一次用的路数。
     */
    setSubGame(subGameId, requesterWs) {
        if (!SUB_GAMES.includes(subGameId)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '子棋类无效' }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this) || subGameId === this.subGameId) return false;
        this._rememberSize();
        qiProtocol.prepareRoomSettingsChange(this);
        this.subGameId = subGameId;
        const remembered = this.sizeBySubGame[subGameId];
        this.boardLanes = Number.isInteger(remembered) ? remembered : this.subCfg().def;
        this._buildBoard();
        this._initState();
        this.broadcast({ type: 'subGameChanged', subGameId: this.subGameId, ...this.getState() });
        return true;
    }

    setBoardSize(newSize, requesterWs) {
        const lanes = parseInt(String(newSize ?? ''), 10);
        const cfg = this.subCfg();
        if (!Number.isInteger(lanes) || lanes < cfg.min || lanes > cfg.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋盘路数无效（${cfg.min}-${cfg.max}）` }));
            return false;
        }
        if (!qiProtocol.canChangeRoomSettings(this)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '已有多人落座，不能修改棋盘大小' }));
            return false;
        }
        qiProtocol.prepareRoomSettingsChange(this);
        this.boardLanes = lanes;
        this._rememberSize();
        this._buildBoard();
        this._initState();
        this.broadcast({ type: 'boardSizeChanged', boardSize: this.boardLanes, ...this.getState() });
        return true;
    }

    resetGame() {
        this.importedKomi = undefined;
        this._stopClockTicker();
        this._buildBoard();
        this._initState();
        qiProtocol.releaseAllSeats(this);
        this.broadcast({ type: 'newGameStarted', ...this.getState(), slots: { player1: false, player2: false } });
    }

    resetToEmpty() {
        this.importedKomi = undefined;
        this._stopClockTicker();
        this._buildBoard();
        this._initState();
    }

    /* ---------- 棋谱 ---------- */

    parseMoveEntry(entry) {
        if (typeof entry !== 'string' || entry.length < 2) return entry;
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        const body = entry.slice(1);
        if (body === 'p') return { type: 'pass', player };
        const m = /^(\d+),(\d+)$/.exec(body);
        if (!m) return { type: 'move', player, row: -1, col: -1 };
        return { type: 'move', player, row: Number(m[1]), col: Number(m[2]) };
    }

    /** 坐标串（B5,5）→ [[行, 列, 颜色]]，忽略越界/无效点 */
    parseInitialPositionCoords(initialPosition) {
        if (!Array.isArray(initialPosition)) return [];
        const stones = [];
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 4) continue;
            const p = s[0];
            if (p !== 'B' && p !== 'W') continue;
            const m = /^(\d+),(\d+)$/.exec(s.slice(1));
            if (!m) continue;
            const r = Number(m[1]), c = Number(m[2]);
            if (!this.isValidVertex(r, c)) continue;
            stones.push([r, c, p === 'B' ? 1 : 2]);
        }
        return stones;
    }

    exportRecord() {
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
            gameType: this.subCfg().gameType,
            gameId: 'non-rectangular-weiqi',
            subGameId: this.subGameId,
            boardLanes: this.boardLanes,
            gridWidth: this.gridH,
            gridHeight: this.gridW,
            komi: this.komi(),
            players: { player1: null, player2: null },
            // 只写编辑出来的开局盘（默认空盘）：把终局全盘塞进来会与 moves 重放冲突
            initialPosition: this._encodeInitialPositionCoords(),
            moves: this.moveCoords.map(m => {
                const p = m.player === 'player1' ? 'B' : 'W';
                return m.type === 'pass' ? p + 'p' : `${p}${m.row},${m.col}`;
            }),
            timeControl: (this.tcSettings && this.tcSettings.timed)
                ? `S${this.tcSettings.mainMinutes || 0},${this.tcSettings.byoyomiSeconds || 0},${this.tcSettings.maxTimeouts || 0}`
                : null,
            result: resultText,
            resultText
        };
    }

    _encodeInitialPositionCoords() {
        const out = [];
        const opening = this.openingBoard;
        if (!opening) return out;
        for (let r = 0; r < this.gridW; r++) {
            for (let c = 0; c < this.gridH; c++) {
                const val = opening[r][c];
                if (val !== 1 && val !== 2) continue;
                out.push(`${val === 1 ? 'B' : 'W'}${r},${c}`);
            }
        }
        return out;
    }

    importRecord(data, requesterWs) {
        if (!data || data.gameId !== 'non-rectangular-weiqi' || !SUB_GAMES.includes(data.subGameId)) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要非四角围棋棋谱）。' }));
            return;
        }
        const subGameId = data.subGameId;
        const lanes = data.boardLanes != null ? data.boardLanes : data.boardSize;
        const cfg = SUB_META[subGameId];
        if (!Number.isInteger(lanes) || lanes < cfg.min || lanes > cfg.max) {
            requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱中棋盘路数无效（${cfg.min}-${cfg.max}）` }));
            return;
        }

        this.subGameId = subGameId;
        this.boardLanes = lanes;
        this._rememberSize();
        this._buildBoard();
        this.resetToEmpty();

        for (const [r, c, val] of this.parseInitialPositionCoords(data.initialPosition)) this.board[r][c] = val;

        const rawMoves = data.moves || [];
        const moves = rawMoves.map((e) => this.parseMoveEntry(e));
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'player1' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (!Number.isInteger(row) || !Number.isInteger(col) || !this.isValidVertex(row, col)) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const occ = this.board[row][col];
                if (occ !== 0 && occ !== playerVal) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手位置已有子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                // 开局盘里已有同色子（编辑开局）：盘面不变但仍记入手顺，供客户端从空盘复原
                if (occ === playerVal) {
                    this.historyBoards.push(this.copyBoard(this.board));
                    this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                    this.moveHistory.push(slot);
                    this.moveCoords.push({ type: 'move', player: slot, row, col });
                    this.lastMoveMarkers = [{ row, col, color: playerVal }];
                    this.currentPlayer = 3 - this.currentPlayer;
                    this.passCounter = 0;
                    continue;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(this.boardToString(newBoard));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            } else if (move.type === 'setup') {
                // 允许棋谱里显式给出摆子（颜色 + 坐标），与 initialPosition 等价
                const r = Number(move.row), c = Number(move.col);
                if (this.isValidVertex(r, c) && move.color != null) this.board[r][c] = Number(move.color);
            }
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

        qiApplyRecordKomi(this, data);   // 导入棋谱采纳记录贴目（新局/重置时清掉）
        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                subGameId: this.subGameId,
                boardLanes: this.boardLanes,
                // 打谱从空盘 + 全手顺即可；避免 initialPosition 与 moves 重复导致客户端回放失败
                initialPosition: [],
                moves: moves.map(m => (m.type === 'pass'
                    ? { type: 'pass', player: m.player }
                    : { type: 'move', player: m.player, row: m.row, col: m.col }))
            }
        });
    }

    /* ---------- 悔棋 ---------- */

    performUndo(steps, requesterWs) {
        if (steps === 0 || steps > this.historyBoards.length) return;
        for (let i = 0; i < steps; i++) {
            if (this.historyBoards.length > 0) {
                // 只有进过集合的手才该删（虚着/踩雷等手同样推了历史快照、盘面与上一手相同，
                // 拿它的快照去 delete 会误删上一次落子的记录 → 禁全同随后失效）
                const skPopped = this.historyBoards.pop();
                const skCoord = this.moveCoords.length > 0 ? this.moveCoords[this.moveCoords.length - 1] : null;
                if (skCoord && ['move'].includes(skCoord.type))
                    this.historyBoardSet.delete(this.boardToString(skPopped));
            }
            if (this.historyMarkers.length > 0)
                this.lastMoveMarkers = this.historyMarkers.pop() || [];
            else
                this.lastMoveMarkers = [];
            if (this.moveHistory.length > 0) this.moveHistory.pop();
            if (this.moveCoords.length > 0) this.moveCoords.pop();
            this.currentPlayer = 3 - this.currentPlayer;
        }
        if (this.historyBoards.length === 0)
            this.board = Array.from({ length: this.gridW }, (_, r) =>
                Array.from({ length: this.gridH }, (_, c) => (this.isValidVertex(r, c) ? 0 : -1)));
        else
            this.board = this.copyBoard(this.historyBoards.at(-1));
        this.broadcast({ type: 'broadcast', action: 'undoAccept', ...this.getState() });
    }

    /* ---------- 消息 ---------- */

    handleMessage(ws, msg) {
        const slot = this.room.getSlotByWs(ws);
        const room = this.room;

        switch (msg.type) {
            case 'selectColor':
                if (slot) return;
                const newSlot = this.assignSlot(ws, msg.color);
                if (newSlot) {
                    room.setPlayerSlot(ws, newSlot);
                    this.slotJoinedAt[newSlot] = Date.now();
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: newSlot }));
                    this.sendState(ws);
                    room.broadcast({ type: 'slotOccupied', slot: newSlot }, ws);
                    this._maybeBeginTimeNegotiation();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: '该颜色已被占用' }));
                }
                break;

            case 'timeControlSubmit':
                this._handleTimeControlSubmit(ws, msg);
                break;

            case 'timeControlAccept':
                this._handleTimeControlAccept(ws);
                break;

            case 'setBoardSize':
                if (qiProtocol.canChangeRoomSettings(this)) this.setBoardSize(msg.size, ws);
                break;

            case 'setSubGame':
                if (qiProtocol.canChangeRoomSettings(this)) {
                    this.setSubGame(msg.subGameId, ws);
                } else {
                    // 被拒绝：回推当前状态，纠正客户端本地乐观切换（子棋类/几何/路数以服务端为准）
                    this.sendState(ws);
                }
                break;

            case 'move': {
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                const { row, col } = msg;
                if (!this.isValidVertex(row, col)) {
                    ws.send(JSON.stringify({ type: 'error', message: '无效交点' }));
                    return;
                }
                if (this.board[row][col] !== 0) return;
                const playerVal = this.currentPlayer === 1 ? 1 : 2;
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) return;
                const newBoardStr = this.boardToString(newBoard);
                if (this.historyBoardSet.has(newBoardStr)) {
                    ws.send(JSON.stringify({ type: 'error', message: '禁全同。' }));
                    return;
                }
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter = 0;
                this.broadcast({ type: 'broadcast', action: 'move', ...this.getState() });
                this._syncClockAfterTurnChange();
                break;
            }

            case 'pass':
                if (this.gameOver) return;
                if (!this._timeAllowsPlay(slot)) {
                    if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                    return;
                }
                if (!this._drainClockBeforeMove(slot)) return;
                if (!slot || slot !== (this.currentPlayer === 1 ? 'player1' : 'player2')) return;
                qiProtocol.weiqiPass(this, ws, slot, {
                    afterBroadcast: () => this._syncClockAfterTurnChange(),
                });
                break;

            case 'requestUndo': {
                if (!slot || this.gameOver) return;
                let steps = 0;
                for (let i = this.moveHistory.length - 1; i >= 0; i--) {
                    steps++;
                    if (this.moveHistory[i] === slot) break;
                }
                if (steps === 0 || steps > this.historyBoards.length) {
                    ws.send(JSON.stringify({ type: 'error', message: '无法悔棋。' }));
                    return;
                }
                const opponentSlot = slot === 'player1' ? 'player2' : 'player1';
                const opponent = room.getPlayerBySlot(opponentSlot);
                if (!opponent) this.performUndo(steps, ws);
                else {
                    this.pendingUndo = { requester: ws, steps };
                    opponent.send(JSON.stringify({ type: 'undoRequest' }));
                }
                break;
            }

            case 'undoResponse':
                if (this.pendingUndo) {
                    if (msg.accept) this.performUndo(this.pendingUndo.steps, this.pendingUndo.requester);
                    else this.pendingUndo.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝悔棋。' }));
                }
                this.pendingUndo = null;
                break;

            case 'resign':
                if (!slot || this.gameOver) return;
                this.gameOver = true;
                this.winner = slot === 'player1' ? 'player2' : 'player1';
                this.onResignResolved(slot);
                this._stopClockTicker();
                this.broadcast({ type: 'broadcast', action: 'resign', player: slot, winner: this.winner, ...this.getState() });
                break;

            case 'requestNewGame':
                qiProtocol.requestNewGame(this, ws, slot);
                break;

            case 'newGameResponse':
                qiProtocol.newGameResponse(this, ws, msg, { newGameDeniedMsg: '对方拒绝开始新局' });
                break;

            case 'requestDraw': {
                if (!slot || this.gameOver) return;
                const drawOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!drawOpponent) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else {
                    this.pendingDraw = ws;
                    drawOpponent.send(JSON.stringify({ type: 'drawRequest' }));
                }
                break;
            }

            case 'drawResponse':
                if (this.pendingDraw && msg.accept) {
                    this.gameOver = true;
                    this.winner = 'draw';
                    this.onDrawResolved();
                    this._stopClockTicker();
                    this.broadcast({ type: 'broadcast', action: 'drawAgreed', ...this.getState() });
                } else if (this.pendingDraw && !msg.accept) {
                    this.pendingDraw.send(JSON.stringify({ type: 'error', message: '对方拒绝和棋。' }));
                }
                this.pendingDraw = null;
                break;

            case 'requestEnd': {
                if (!slot) return;
                const endOpponent = room.getPlayerBySlot(slot === 'player1' ? 'player2' : 'player1');
                if (!endOpponent) this.startScoreCounting(ws, ws);
                else {
                    this.pendingEnd = { requester: ws, opponent: endOpponent };
                    endOpponent.send(JSON.stringify({ type: 'requestEnd' }));
                }
                break;
            }

            case 'endResponse':
                if (this.pendingEnd && msg.accept) this.startScoreCounting(this.pendingEnd.requester, this.pendingEnd.opponent);
                else if (this.pendingEnd && !msg.accept) this.pendingEnd.requester.send(JSON.stringify({ type: 'error', message: '对方拒绝数点。' }));
                this.pendingEnd = null;
                break;

            case 'scoreResponse':
                if (this.pendingScore && (ws === this.pendingScore.requester || ws === this.pendingScore.opponent)) {
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
                ws.send(JSON.stringify({ type: 'gameRecord', data: this.exportRecord() }));
                break;

            case 'importRecord':
                if (room.getPlayerBySlot('player1') || room.getPlayerBySlot('player2')) {
                    ws.send(JSON.stringify({ type: 'error', message: '已有玩家入座，无法导入棋谱' }));
                    return;
                }
                this.importRecord(msg.data, ws);
                break;

            case 'resetRoom':
                if (room.getPlayerBySlot('player1') || room.getPlayerBySlot('player2')) return;
                this.resetToEmpty();
                this.broadcast({ type: 'roomReset', ...this.getState() });
                break;

            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (slot) this.room.broadcast({ type: 'playerLeft', slot });

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
    SUB_GAMES,
    SUB_META,
    DEFAULT_SUB_GAME,
    generateHexBoardData,
    generateFloretPentBoardData,
    NonRectangularWeiqiRoom,
    initRoom(room) {
        room.gameLogic = new NonRectangularWeiqiRoom(room);
        if (typeof qiBoardSeatOverlay !== 'undefined' && qiBoardSeatOverlay) qiBoardSeatOverlay.install(room.gameLogic);
        if (typeof qiProtocol.installStandardEditBoard === 'function') qiProtocol.installStandardEditBoard(room.gameLogic);
        room.maxPlayers = 2;
    }
};
