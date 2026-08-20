window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['triangle-weiqi'] = {
    shell: {
        "title": "三角围棋",
        "rulesHtml": "基本规则同标准围棋。<br /><br />",
        "defaultKomiText": "黑贴白4.75点",
        "boardSizeMin": 9,
        "boardSizeMax": 31,
        "defaultBoardSize": 27,
        "minLib": 1,
        "recordDownloadPrefix": "三角围棋",
        "standardWeiqiMatchTime": true,
        "features": {
            "zoomScroll": false,
            "editBoard": true,
            "compoundPalette": false,
            "transparentCanvas": true
        },
        "editTools": [
            {
                "value": "empty",
                "label": "空"
            },
            {
                "value": "black",
                "label": "黑子"
            },
            {
                "value": "white",
                "label": "白子"
            }
        ]
    },
    mount: function (ctx) {
        var gameType = ctx.gameType;
        var roomId = ctx.roomId;
        var roomPassword = ctx.roomPassword || null;
        var config = ctx.config || {};
        var recordDownloadPrefix = config.recordDownloadPrefix != null ? config.recordDownloadPrefix : "三角围棋";
        var standardWeiqiMatchTime = config.standardWeiqiMatchTime != null ? config.standardWeiqiMatchTime : true;

        (function () {
// ======================== 配置 ========================
        // 棋盘形状：三角形 / 菱形（菱三角）/ 六角形（六角三角），共享同一棋种
        let SHAPE = 'triangle';
        const SHAPE_CONFIG = {
            triangle: { min: 9, max: 31, def: 27 },
            rhombus: { min: 5, max: 21, def: 13 },
            hexagon: { min: 3, max: 15, def: 6 }
        };
        function shapeCfg() { return SHAPE_CONFIG[SHAPE] || SHAPE_CONFIG.triangle; }
        /** 行数：三角/菱形 = 路数；六角 = 2×路数-1 */
        function rowsFor(shape, size) { return shape === 'hexagon' ? size * 2 - 1 : size; }
        let ROWS = 27;
        let KOMI = 4.75;
        const BASE_WIDTH = 500;        // 参考 27 路时的棋盘宽度（像素），用于确定固定外框
        const CENTER_X_REF = 300;      // 画布水平中心（参考）
        const ROWS_REF = 27;

        /** 行 r 格点数（按形状）：三角 r+1；菱形恒为行数；六角 (行数+1)/2+min(r, 行数-1-r) */
        function rowLen(r) {
            if (SHAPE === 'triangle') return r + 1;
            if (SHAPE === 'rhombus') return ROWS;
            const m = Math.min(r, ROWS - 1 - r);
            return (ROWS + 1) / 2 + m;
        }

        function gridCornersFromParams(rows, dx, dy, topY, centerX) {
            const rMax = rows - 1;
            const A = { x: centerX, y: topY };
            const leftX = centerX - (rMax * dx) / 2;
            const B = { x: leftX, y: topY + rMax * dy };
            const C = { x: leftX + rMax * dx, y: topY + rMax * dy };
            return { A, B, C };
        }

        function outwardExpandTriangle(A, B, C, margin) {
            const cx = (A.x + B.x + C.x) / 3;
            const cy = (A.y + B.y + C.y) / 3;
            const expand = (P) => {
                const vx = P.x - cx, vy = P.y - cy;
                const len = Math.hypot(vx, vy);
                return { x: P.x + (vx / len) * margin, y: P.y + (vy / len) * margin };
            };
            return { outerA: expand(A), outerB: expand(B), outerC: expand(C) };
        }

        const dxRef = BASE_WIDTH / (ROWS_REF - 1);
        const dyRef = (Math.sqrt(3) / 2) * dxRef;
        const totalHRef = dyRef * (ROWS_REF - 1);
        const topYRef = (600 - totalHRef) / 2;
        const { A: refGridA, B: refGridB, C: refGridC } = gridCornersFromParams(ROWS_REF, dxRef, dyRef, topYRef, CENTER_X_REF);
        const { outerA: FIXED_OUTER_A, outerB: FIXED_OUTER_B, outerC: FIXED_OUTER_C } = outwardExpandTriangle(refGridA, refGridB, refGridC, 45);

        const TRI_CENTROID = {
            x: (FIXED_OUTER_A.x + FIXED_OUTER_B.x + FIXED_OUTER_C.x) / 3,
            y: (FIXED_OUTER_A.y + FIXED_OUTER_B.y + FIXED_OUTER_C.y) / 3
        };
        const k27 = Math.hypot(refGridA.x - TRI_CENTROID.x, refGridA.y - TRI_CENTROID.y)
            / Math.hypot(FIXED_OUTER_A.x - TRI_CENTROID.x, FIXED_OUTER_A.y - TRI_CENTROID.y);

        /** 与 drawRoundedTriangle(FIXED_OUTER_*) 顶点一致的外接包围盒（600×600 坐标），用于标记条对齐三角外框 */
        const TRI_OUTER_BOUNDS = (() => {
            const pts = [FIXED_OUTER_A, FIXED_OUTER_B, FIXED_OUTER_C];
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            return { minX, maxX, minY, maxY };
        })();

        // ---- 六角外框（参考 27 行） ----
        function hexCornersFromParams(rows, dx, dy, topY, centerX) {
            const R = (rows - 1) / 2;
            const L = (r) => R + 1 + Math.min(r, 2 * R - r);
            const xOf = (r, c) => centerX + (c - (L(r) - 1) / 2) * dx;
            const yOf = (r) => topY + r * dy;
            return [
                { x: xOf(0, 0), y: yOf(0) },
                { x: xOf(R, 0), y: yOf(R) },
                { x: xOf(2 * R, 0), y: yOf(2 * R) },
                { x: xOf(2 * R, L(2 * R) - 1), y: yOf(2 * R) },
                { x: xOf(R, L(R) - 1), y: yOf(R) },
                { x: xOf(0, L(0) - 1), y: yOf(0) }
            ];
        }

        function outwardExpandHexagon(verts, margin) {
            const cx = verts.reduce((s, p) => s + p.x, 0) / verts.length;
            const cy = verts.reduce((s, p) => s + p.y, 0) / verts.length;
            return verts.map((P) => {
                const vx = P.x - cx, vy = P.y - cy;
                const len = Math.hypot(vx, vy);
                return { x: P.x + (vx / len) * margin, y: P.y + (vy / len) * margin };
            });
        }

        const dxRefHex = BASE_WIDTH / (ROWS_REF - 1);
        const dyRefHex = (Math.sqrt(3) / 2) * dxRefHex;
        const totalHRefHex = dyRefHex * (ROWS_REF - 1);
        const topYRefHex = (600 - totalHRefHex) / 2;
        const refHex = hexCornersFromParams(ROWS_REF, dxRefHex, dyRefHex, topYRefHex, CENTER_X_REF);
        const FIXED_OUTER_HEX = outwardExpandHexagon(refHex, 22);
        const HEX_CENTROID = {
            x: FIXED_OUTER_HEX.reduce((s, p) => s + p.x, 0) / FIXED_OUTER_HEX.length,
            y: FIXED_OUTER_HEX.reduce((s, p) => s + p.y, 0) / FIXED_OUTER_HEX.length
        };
        const k27Hex = Math.hypot(refHex[0].x - HEX_CENTROID.x, refHex[0].y - HEX_CENTROID.y)
            / Math.hypot(FIXED_OUTER_HEX[0].x - HEX_CENTROID.x, FIXED_OUTER_HEX[0].y - HEX_CENTROID.y);
        const HEX_OUTER_BOUNDS = (() => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of FIXED_OUTER_HEX) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            return { minX, maxX, minY, maxY };
        })();

        // ---- 菱形几何：方形格点纵向压缩 + 逆时针旋转 30°（平行四边形） ----
        const RHOM_Y_SCALE = 0.8660254037844386;
        const RHOM_ROT_CCW_RAD = -Math.PI / 6;
        const RHOM_CANVAS_SIZE = 600;
        const RHOM_FRAME_CORNER_RADIUS = 4;
        let RHOM_PADDING = 0;
        let RHOM_CELL = 0;
        const RhomBoardGeom = {
            displayScale: 1,
            displayOffsetX: 0,
            displayOffsetY: 0,
            _frameOutsetDisplay: 24,
            outerFrameBounds: { minX: 0, maxX: 600, minY: 0, maxY: 600 },
            _fitCacheKey: '',
            bottomY(padding, cellSize, boardSize) {
                return padding + (boardSize - 1) * cellSize;
            },
            shiftUnitsForRow(row, boardSize) {
                return 0.5 * (boardSize - 1 - row);
            },
            initGeometry(padding, cellSize, boardSize) {
                RHOM_PADDING = padding;
                RHOM_CELL = cellSize;
                this._fitCacheKey = '';
                this.recomputeDisplayFit(padding, cellSize, boardSize);
            },
            effectiveCellSize(cellSize) {
                return cellSize * this.displayScale;
            },
            frameOutsetDisplay(padding, cellSize, boardSize) {
                return cellSize * this.displayScale;
            },
            xyBase(row, col, padding, cellSize, boardSize) {
                const bottomY = this.bottomY(padding, cellSize, boardSize);
                const y = bottomY - (boardSize - 1 - row) * cellSize * RHOM_Y_SCALE;
                const shiftU = this.shiftUnitsForRow(row, boardSize);
                const x = padding + col * cellSize - shiftU * cellSize;
                return { x, y };
            },
            rotationCenter(padding, cellSize, boardSize) {
                const n = boardSize;
                const corners = [[0, 0], [0, n - 1], [n - 1, 0], [n - 1, n - 1]];
                let sx = 0, sy = 0;
                for (const [r, c] of corners) {
                    const p = this.xyBase(r, c, padding, cellSize, n);
                    sx += p.x;
                    sy += p.y;
                }
                return { cx: sx / 4, cy: sy / 4 };
            },
            rotatePointCCW(x, y, cx, cy) {
                const rad = RHOM_ROT_CCW_RAD;
                const dx = x - cx, dy = y - cy;
                const c = Math.cos(rad), s = Math.sin(rad);
                return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
            },
            unrotatePoint(x, y, cx, cy) {
                const rad = -RHOM_ROT_CCW_RAD;
                const dx = x - cx, dy = y - cy;
                const c = Math.cos(rad), s = Math.sin(rad);
                return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
            },
            xyRotated(row, col, padding, cellSize, boardSize) {
                const base = this.xyBase(row, col, padding, cellSize, boardSize);
                const { cx, cy } = this.rotationCenter(padding, cellSize, boardSize);
                return this.rotatePointCCW(base.x, base.y, cx, cy);
            },
            xy(row, col, padding, cellSize, boardSize) {
                const p = this.xyRotated(row, col, padding, cellSize, boardSize);
                return this.applyDisplayTransform(p.x, p.y);
            },
            applyDisplayTransform(x, y) {
                return { x: this.displayOffsetX + x * this.displayScale, y: this.displayOffsetY + y * this.displayScale };
            },
            invertDisplayTransform(x, y) {
                const s = this.displayScale || 1;
                return { x: (x - this.displayOffsetX) / s, y: (y - this.displayOffsetY) / s };
            },
            boardCornerVerts(padding, cellSize, boardSize) {
                const n = boardSize;
                return [
                    this.xy(0, 0, padding, cellSize, n),
                    this.xy(0, n - 1, padding, cellSize, n),
                    this.xy(n - 1, n - 1, padding, cellSize, n),
                    this.xy(n - 1, 0, padding, cellSize, n)
                ];
            },
            ensureCcW(verts) {
                let area = 0;
                for (let i = 0; i < verts.length; i++) {
                    const j = (i + 1) % verts.length;
                    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
                }
                if (area < 0) return verts.slice().reverse();
                return verts.slice();
            },
            lineIntersect(p1, p2, p3, p4) {
                const dax = p2.x - p1.x, day = p2.y - p1.y;
                const dbx = p4.x - p3.x, dby = p4.y - p3.y;
                const denom = dax * dby - day * dbx;
                if (Math.abs(denom) < 1e-9) return { x: p1.x, y: p1.y };
                const t = ((p3.x - p1.x) * dby - (p3.y - p1.y) * dbx) / denom;
                return { x: p1.x + t * dax, y: p1.y + t * day };
            },
            parallelOffsetQuad(verts, dist) {
                const n = verts.length;
                if (n !== 4) return verts.slice();
                const v = this.ensureCcW(verts);
                let area = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    area += v[i].x * v[j].y - v[j].x * v[i].y;
                }
                const sign = area >= 0 ? 1 : -1;
                const offsetLines = [];
                for (let i = 0; i < n; i++) {
                    const a = v[i], b = v[(i + 1) % n];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const nx = sign * (dy / len) * dist;
                    const ny = sign * (-dx / len) * dist;
                    offsetLines.push({ p1: { x: a.x + nx, y: a.y + ny }, p2: { x: b.x + nx, y: b.y + ny } });
                }
                const out = [];
                for (let i = 0; i < n; i++) {
                    const L0 = offsetLines[(i - 1 + n) % n];
                    const L1 = offsetLines[i];
                    out.push(this.lineIntersect(L0.p1, L0.p2, L1.p1, L1.p2));
                }
                return out;
            },
            recomputeDisplayFit(padding, cellSize, boardSize) {
                const key = padding + '|' + cellSize + '|' + boardSize;
                if (this._fitCacheKey === key) return;
                const n = boardSize;
                // 全部在未缩放坐标系测量：格点与外框偏移都用原始坐标（外框偏移 = cellSize），
                // fit 后整体乘 displayScale，保证含外框也不超出画布；
                // 勿用 boardCornerVerts/frameOutsetDisplay（它们已带旧 displayScale，会造成测量与显示单位不一致）。
                const corners = [
                    this.xyRotated(0, 0, padding, cellSize, n),
                    this.xyRotated(0, n - 1, padding, cellSize, n),
                    this.xyRotated(n - 1, n - 1, padding, cellSize, n),
                    this.xyRotated(n - 1, 0, padding, cellSize, n)
                ];
                const frameRaw = this.parallelOffsetQuad(corners, cellSize);
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const include = (p) => {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                };
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) include(this.xyRotated(r, c, padding, cellSize, n));
                }
                for (const p of frameRaw) include(p);
                const canvasMargin = 16;
                const avail = RHOM_CANVAS_SIZE - 2 * canvasMargin;
                const w = Math.max(1e-6, maxX - minX);
                const h = Math.max(1e-6, maxY - minY);
                const scale = Math.min(avail / w, avail / h);
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                this.displayScale = scale;
                this.displayOffsetX = RHOM_CANVAS_SIZE / 2 - scale * cx;
                this.displayOffsetY = RHOM_CANVAS_SIZE / 2 - scale * cy;
                this._frameOutsetDisplay = cellSize * scale;
                this._fitCacheKey = key;
                this.updateOuterFrameBounds(padding, cellSize, n);
            },
            frameOuterVerts(padding, cellSize, boardSize) {
                const corners = this.boardCornerVerts(padding, cellSize, boardSize);
                const outset = this._frameOutsetDisplay > 0
                    ? this._frameOutsetDisplay
                    : this.frameOutsetDisplay(padding, cellSize, boardSize);
                return this.parallelOffsetQuad(corners, outset);
            },
            updateOuterFrameBounds(padding, cellSize, boardSize) {
                const outer = this.frameOuterVerts(padding, cellSize, boardSize);
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const v of outer) {
                    minX = Math.min(minX, v.x);
                    maxX = Math.max(maxX, v.x);
                    minY = Math.min(minY, v.y);
                    maxY = Math.max(maxY, v.y);
                }
                this.outerFrameBounds = { minX, maxX, minY, maxY };
            },
            drawRoundedPolygon(ctx, vertices, radius, skipStroke) {
                const n = vertices.length;
                if (n < 3) return;
                const startPoints = [], endPoints = [];
                for (let i = 0; i < n; i++) {
                    const curr = vertices[i];
                    const prev = vertices[(i - 1 + n) % n];
                    const next = vertices[(i + 1) % n];
                    const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                    const len1 = Math.hypot(v1.x, v1.y);
                    const len2 = Math.hypot(v2.x, v2.y);
                    const dx1 = v1.x / len1, dy1 = v1.y / len1;
                    const dx2 = v2.x / len2, dy2 = v2.y / len2;
                    startPoints.push({ x: curr.x + dx1 * radius, y: curr.y + dy1 * radius });
                    endPoints.push({ x: curr.x + dx2 * radius, y: curr.y + dy2 * radius });
                }
                ctx.beginPath();
                ctx.moveTo(endPoints[n - 1].x, endPoints[n - 1].y);
                for (let i = 0; i < n; i++) {
                    ctx.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                }
                ctx.closePath();
                ctx.fill();
                if (!skipStroke) ctx.stroke();
            },
            drawWoodenFrame(ctx, boardSize) {
                const outer = this.frameOuterVerts(RHOM_PADDING, RHOM_CELL, boardSize);
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = '#fdcc90';
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 0.5;
                this.drawRoundedPolygon(ctx, outer, RHOM_FRAME_CORNER_RADIUS, false);
                ctx.restore();
            },
            drawGrid(ctx, boardSize) {
                const n = boardSize;
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let r = 0; r < n; r++) {
                    const a = this.xy(r, 0, RHOM_PADDING, RHOM_CELL, n);
                    const b = this.xy(r, n - 1, RHOM_PADDING, RHOM_CELL, n);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
                for (let c = 0; c < n; c++) {
                    const a = this.xy(0, c, RHOM_PADDING, RHOM_CELL, n);
                    const b = this.xy(n - 1, c, RHOM_PADDING, RHOM_CELL, n);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
                ctx.stroke();
            },
            drawAntiDiagonalLines(ctx, boardSize) {
                const n = boardSize;
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                for (let k = 0; k <= 2 * (n - 1); k++) {
                    const c0 = Math.max(0, k - (n - 1));
                    const c1 = Math.min(k, n - 1);
                    const r0 = k - c0;
                    const r1 = k - c1;
                    const p0 = this.xy(r0, c0, RHOM_PADDING, RHOM_CELL, n);
                    const p1 = this.xy(r1, c1, RHOM_PADDING, RHOM_CELL, n);
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                }
                ctx.stroke();
            },
            drawStarPoints(ctx, boardSize) {
                const pts = QiSquareWeiqiCanvas.getStarPoints(boardSize);
                const starR = this.effectiveCellSize(RHOM_CELL) * 0.12;
                ctx.fillStyle = '#3a281c';
                for (const [r, c] of pts) {
                    const p = this.xy(r, c, RHOM_PADDING, RHOM_CELL, boardSize);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, starR, 0, 2 * Math.PI);
                    ctx.fill();
                }
            },
            outwardNormalForEdge(p0, p1, interiorRef) {
                const tx = p1.x - p0.x, ty = p1.y - p0.y;
                const len = Math.hypot(tx, ty) || 1;
                let nx = -ty / len, ny = tx / len;
                const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
                if ((interiorRef.x - mx) * nx + (interiorRef.y - my) * ny > 0) {
                    nx = -nx;
                    ny = -ny;
                }
                return { x: nx, y: ny };
            },
            drawCoordLabels(ctx, boardSize) {
                const n = boardSize;
                const mid = Math.floor((n - 1) / 2);
                const interior = this.xy(mid, mid, RHOM_PADDING, RHOM_CELL, n);
                const topLeft = this.xy(0, 0, RHOM_PADDING, RHOM_CELL, n);
                const topRight = this.xy(0, n - 1, RHOM_PADDING, RHOM_CELL, n);
                const rightBot = this.xy(n - 1, n - 1, RHOM_PADDING, RHOM_CELL, n);
                const insideTop = this.xy(1, 0, RHOM_PADDING, RHOM_CELL, n);
                const topN = this.outwardNormalForEdge(topLeft, topRight, insideTop);
                const rightN = this.outwardNormalForEdge(topRight, rightBot, interior);
                const gapHalf = (this._frameOutsetDisplay > 0 ? this._frameOutsetDisplay : this.frameOutsetDisplay(RHOM_PADDING, RHOM_CELL, n)) * 0.5;
                const cellDisp = this.effectiveCellSize(RHOM_CELL);
                const numExtraX = -0.2 * cellDisp;
                const numExtraY = 0.115 * cellDisp;
                const letExtraX = 0.2 * cellDisp;
                const letExtraY = 0.115 * cellDisp;
                ctx.font = 'bold ' + Math.max(9, 250 / n * this.displayScale) + 'px Arial';
                ctx.fillStyle = '#3a281c';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                for (let c = 0; c < n; c++) {
                    const p = this.xy(0, c, RHOM_PADDING, RHOM_CELL, n);
                    ctx.fillText(String(c + 1), p.x + topN.x * gapHalf + numExtraX, p.y + topN.y * gapHalf + numExtraY);
                }
                for (let r = 0; r < n; r++) {
                    const p = this.xy(r, n - 1, RHOM_PADDING, RHOM_CELL, n);
                    ctx.fillText(String.fromCharCode(65 + r), p.x + rightN.x * gapHalf + letExtraX, p.y + rightN.y * gapHalf + letExtraY);
                }
            },
            pickIntersection(canvasX, canvasY, boardSize) {
                const n = boardSize;
                const outer = this.frameOuterVerts(RHOM_PADDING, RHOM_CELL, n);
                let inside = false;
                for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
                    const xi = outer[i].x, yi = outer[i].y;
                    const xj = outer[j].x, yj = outer[j].y;
                    if (((yi > canvasY) !== (yj > canvasY)) && (canvasX < (xj - xi) * (canvasY - yi) / (yj - yi) + xi)) {
                        inside = !inside;
                    }
                }
                if (!inside) return { row: -1, col: -1 };
                const { cx, cy } = this.rotationCenter(RHOM_PADDING, RHOM_CELL, n);
                const pre = this.invertDisplayTransform(canvasX, canvasY);
                const local = this.unrotatePoint(pre.x, pre.y, cx, cy);
                let bestR = -1, bestC = -1, bestD = Infinity;
                const hitR = this.effectiveCellSize(RHOM_CELL) * 0.48;
                const hitR2 = hitR * hitR;
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        const p = this.xyBase(r, c, RHOM_PADDING, RHOM_CELL, n);
                        const d = (p.x - local.x) ** 2 + (p.y - local.y) ** 2;
                        if (d < bestD) {
                            bestD = d;
                            bestR = r;
                            bestC = c;
                        }
                    }
                }
                if (bestD > hitR2) return { row: -1, col: -1 };
                return { row: bestR, col: bestC };
            }
        };

        function updateBoardMarkOuterPosition() {
            const el = document.getElementById('boardMarkOuter');
            if (!el) return;
            /* 窄屏与标准围棋相同：由 CSS 贴视口右缘、向左展开；勿保留桌面用的 left/bottom 内联 */
            if (window.matchMedia('(max-width: 700px)').matches) {
                el.style.left = '';
                el.style.right = '';
                el.style.bottom = '';
                el.style.top = '';
                return;
            }
            const bounds = SHAPE === 'rhombus'
                ? RhomBoardGeom.outerFrameBounds
                : (SHAPE === 'hexagon' ? HEX_OUTER_BOUNDS : TRI_OUTER_BOUNDS);
            const { maxX, maxY } = bounds;
            const gap = 6;
            el.style.left = 'calc(' + ((maxX / 600) * 100) + '% + ' + gap + 'px)';
            el.style.bottom = ((600 - maxY) / 600) * 100 + '%';
            el.style.right = 'auto';
            el.style.top = 'auto';
        }

        let PADDING;
        let CELL_SIZE;
        let DX, DY, TOP_Y, CENTER_X;

        function updateBoardGeometry() {
            if (SHAPE === 'rhombus') {
                const g = QiSquareWeiqiCanvas.computePaddingAndCell(ROWS);
                RhomBoardGeom.initGeometry(g.padding, g.cellSize, ROWS);
                // 显示格距/行距（供棋子半径、悬停等共用）
                DX = RhomBoardGeom.effectiveCellSize(g.cellSize);
                DY = DX * RHOM_Y_SCALE;
                return;
            }
            if (SHAPE === 'hexagon') {
                if (ROWS < 3) return;
                PADDING = 24.6 - 0.1 * ROWS;
                let factor = k27Hex * (22 / PADDING);
                if (factor > 1) factor = 1;
                const G = HEX_CENTROID;
                const innerFromOuter = (O) => ({
                    x: G.x + factor * (O.x - G.x),
                    y: G.y + factor * (O.y - G.y)
                });
                const innerVerts = FIXED_OUTER_HEX.map(innerFromOuter);
                const R = (ROWS - 1) / 2;
                DX = (innerVerts[5].x - innerVerts[0].x) / R;
                DY = (innerVerts[1].y - innerVerts[0].y) / R;
                TOP_Y = innerVerts[0].y;
                CENTER_X = (innerVerts[0].x + innerVerts[5].x) / 2;
                return;
            }
            // 三角
            if (ROWS < 2) return;
            PADDING = 50.4 - 0.2 * ROWS;
            let factor = k27 * (45 / PADDING);
            if (factor > 1) factor = 1;
            const G = TRI_CENTROID;
            const innerFromOuter = (O) => ({
                x: G.x + factor * (O.x - G.x),
                y: G.y + factor * (O.y - G.y)
            });
            const innerA = innerFromOuter(FIXED_OUTER_A);
            const innerB = innerFromOuter(FIXED_OUTER_B);
            const innerC = innerFromOuter(FIXED_OUTER_C);
            DX = (innerC.x - innerB.x) / (ROWS - 1);
            DY = (innerB.y - innerA.y) / (ROWS - 1);
            TOP_Y = innerA.y;
            CENTER_X = innerA.x;
        }
        updateBoardGeometry();

        function getShapeStars() {
            if (SHAPE === 'rhombus') return null; // 菱形用公共星位
            if (SHAPE === 'hexagon') {
                if (ROWS < 11) return [];
                const R = (ROWS - 1) / 2;
                return [{ r: R, c: R }];
            }
            const rows = ROWS;
            if (rows < 11) return [];
            const base = [{ r: 4, c: 2 }, { r: rows - 3, c: 2 }, { r: rows - 3, c: rows - 5 }];
            if (rows % 2 === 1 && rows >= 15) {
                base.push({ r: (1 + rows) / 2, c: 2 });
                base.push({ r: (1 + rows) / 2, c: (rows - 3) / 2 });
                base.push({ r: rows - 3, c: (rows - 3) / 2 });
            }
            return base;
        }

// 全局状态
        function initBoardArray(/* rows */) {
            const n = Math.max(1, Math.floor(ROWS));
            return Array(n).fill().map((_, r) => Array(rowLen(r)).fill(0));
        }
        let board = initBoardArray(ROWS);
        let numberOfHands = 1;
        let currentPlayer = 1;
        let mySlot = null;
        let gameOver = false;
        let winner = null;
        let lastMoveMarkers = [];
        let showEstimateActive = false;
        let cachedLiveBoard = null;
        let cachedTerritory = null;
        let waitingScoreConfirm = false;
        let iRejected = false;
        let matchTime = null;
        let matchStarted = false;

        let ws;
        let isMyTurn = false;
        let slots = { black: false, white: false };
        let reconnectTimer = null;

        let replayMode = false;
        let replayBoards = [];
        let replayMarkers = [];
        let replayStepPlayers = [];
        let replayStep = 0;
        let replayTotalSteps = 0;

        let showMoveNumbers = false;
        let moveLog = [];

        let tryPlayMode = false;
        let tryPlayBaseStep = 0;
        let tryPlayBasePlayer = 1;
        let tryPlayBoards = [];
        let tryPlayMarkers = [];
        let tryPlayCurrentPlayer = 1;
        let tryPlayStep = 0;
        let tryPlayTotalSteps = 0;
        let tryPlayFromLive = false;
        let tryPlayFromLiveStep = null;

        let liveReplayBoards = [];
        let liveReplayMarkers = [];
        let liveReplayStepPlayers = [];
        let liveViewStep = 0;
        let liveFollowLatest = true;

        /** 本地棋盘标记（仅本机）键 "r,c" → 字符 */
        let userBoardMarks = Object.create(null);
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks) QiWeiqiSquarePageRuntime.bindActiveUserBoardMarks(userBoardMarks);
        const BOARD_MARK_CHAR_LIST = (() => {
            const a = [];
            a.push('?', '!');
            for (let i = 0; i < 26; i++) a.push(String.fromCharCode(65 + i));
            a.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            return a;
        })();

        // DOM
        const canvas = document.getElementById('goBoard');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 600 * dpr;
        canvas.height = 600 * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const turnDisplay = document.getElementById('turnDisplay');
        const colorStatus = document.getElementById('colorStatus');
const scoreTitle = document.getElementById('scoreTitle');
        const scoreBoard = document.getElementById('scoreBoard');
        const leadInfo = document.getElementById('leadInfo');
        const scoreConfirmPanel = document.getElementById('scoreConfirmPanel');
        const scoreConfirmText = document.getElementById('scoreConfirmText');
        const scoreConfirmYes = document.getElementById('scoreConfirmYes');
        const scoreConfirmNo = document.getElementById('scoreConfirmNo');
        const boardMarkSelect = document.getElementById('boardMarkSelect');

        QiSquareWeiqiCanvas.initBoardMarkSelectDom(boardMarkSelect, BOARD_MARK_CHAR_LIST);
        QiSquareWeiqiCanvas.initBoardMarkFoldDom(
            document.getElementById('boardMarkPanel'),
            document.getElementById('boardMarkFoldBtn'),
            document.getElementById('boardMarkExpandBtn')
        );

        updateBoardMarkOuterPosition();
        window.addEventListener('resize', updateBoardMarkOuterPosition);

        let hoverR = -1, hoverC = -1, isHoverValid = false;
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        document.body.classList.add(isTouchDevice ? 'touch-device' : 'no-touch');

        function mobileTwoStepPlacing() {
            return !isMouseDevice && ROWS > 9;
        }
        function clearMobileMovePreview() {
            hoverR = -1;
            hoverC = -1;
            isHoverValid = false;
        }

        // ======================== 三角网格辅助 ========================
        function isValidCoord(r, c) {
            return r >= 0 && r < ROWS && c >= 0 && c < rowLen(r);
        }

        function isUserBoardMarkVisibleAt(r, c) {
            if (showEstimateActive) return false;
            if (!isValidCoord(r, c)) return false;
            if (board[r][c] !== 0) return false;
            return true;
        }

        function coordToPixel(r, c) {
            if (SHAPE === 'rhombus') {
                return RhomBoardGeom.xy(r, c, RHOM_PADDING, RHOM_CELL, ROWS);
            }
            if (SHAPE === 'hexagon') {
                const y = TOP_Y + r * DY;
                const leftX = CENTER_X - ((rowLen(r) - 1) / 2) * DX;
                return { x: leftX + c * DX, y };
            }
            const y = TOP_Y + r * DY;
            const leftX = CENTER_X - (r * DX) / 2;
            return { x: leftX + c * DX, y };
        }

        /** 点在多边形内判定（ray casting，顶点按 {x,y} 数组） */
        function pointInPolygon(px, py, verts) {
            let inside = false;
            for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
                const xi = verts[i].x, yi = verts[i].y;
                const xj = verts[j].x, yj = verts[j].y;
                if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        function getClosestIntersection(px, py) {
            // 点在三角棋盘区域之外时返回无效（-1）：避免正方形画布内的外部点击吸附到邻近格点
            if (!pointInPolygon(px, py, [FIXED_OUTER_A, FIXED_OUTER_B, FIXED_OUTER_C])) {
                return { row: -1, col: -1 };
            }
            let minDist = Infinity;
            let bestR = -1, bestC = -1;
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < rowLen(r); c++) {
                    let { x, y } = coordToPixel(r, c);
                    let dist = Math.hypot(px - x, py - y);
                    if (dist < minDist) {
                        minDist = dist;
                        bestR = r;
                        bestC = c;
                    }
                }
            }
            return { row: bestR, col: bestC };
        }

        // 六方向邻接（按形状）：三角/菱形固定方向，六角按行长推导
        function getNeighbors(r, c) {
            const out = [];
            const push = (nr, nc) => { if (isValidCoord(nr, nc)) out.push([nr, nc]); };
            if (SHAPE === 'triangle') {
                for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) push(r + dr, c + dc);
                return out;
            }
            if (SHAPE === 'rhombus') {
                for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, -1], [-1, 1]]) push(r + dr, c + dc);
                return out;
            }
            push(r, c - 1);
            push(r, c + 1);
            if (r > 0) {
                if (rowLen(r - 1) > rowLen(r)) { push(r - 1, c); push(r - 1, c + 1); }
                else { push(r - 1, c - 1); push(r - 1, c); }
            }
            if (r < ROWS - 1) {
                if (rowLen(r + 1) > rowLen(r)) { push(r + 1, c); push(r + 1, c + 1); }
                else { push(r + 1, c - 1); push(r + 1, c); }
            }
            return out;
        }

        function gridDistance(r1, c1, r2, c2) {
            if (r1 === r2 && c1 === c2) return 0;
            const visited = new Set();
            let frontier = [[r1, c1]];
            visited.add(r1 + ',' + c1);
            let dist = 0;
            while (frontier.length) {
                dist++;
                const next = [];
                for (const [fr, fc] of frontier) {
                    for (const [nr, nc] of getNeighbors(fr, fc)) {
                        const key = nr + ',' + nc;
                        if (visited.has(key)) continue;
                        if (nr === r2 && nc === c2) return dist;
                        visited.add(key);
                        next.push([nr, nc]);
                    }
                }
                frontier = next;
            }
            return Infinity;
        }

        // ======================== 围棋规则 ========================
        function deepCopyBoard(src)
        {
            return src.map(row => row.slice());
        }

        function countGroupLiberties(board, row, col)
        {
            const color = board[row][col];
            if (color === 0) return 0;
            const visited = Array(ROWS).fill().map(() => []);
            const queue = [[row, col]];
            visited[row][col] = true;
            const liberties = new Set();
            while (queue.length) {
                const [r, c] = queue.shift();
                for (const [nr, nc] of getNeighbors(r, c)) {
                    if (board[nr][nc] === 0) {
                        liberties.add(nr + ',' + nc);
                    } else if (board[nr][nc] === color && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }
            return liberties.size;
        }

        function hasLiberty(board, row, col) {
            return countGroupLiberties(board, row, col) > 0;
        }

        function removeGroup(board, row, col, color) {
            const queue = [[row, col]];
            board[row][col] = 0;
            while (queue.length) {
                const [r, c] = queue.shift();
                for (let [dr, dc] of DIRS) {
                    const nr = r + dr, nc = c + dc;
                    if (isValidCoord(nr, nc) && board[nr][nc] === color) {
                        board[nr][nc] = 0;
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        function tryPlaceStone(boardBefore, row, col, playerVal) {
            if (!isValidCoord(row, col) || boardBefore[row][col] !== 0)
                return null;
            let newBoard = deepCopyBoard(boardBefore);
            newBoard[row][col] = playerVal;
            for (const [nr, nc] of getNeighbors(row, col)) {
                if (newBoard[nr][nc] === 3 - playerVal) {
                    if (!hasLiberty(newBoard, nr, nc))
                        removeGroup(newBoard, nr, nc, 3 - playerVal);
                }
            }
            if (!hasLiberty(newBoard, row, col))
                removeGroup(newBoard, row, col, playerVal);
            return newBoard;
        }

        // ======================== 形势判断 ========================
        function removeDeadGroups(srcBoard) {
            let boardCopy = deepCopyBoard(srcBoard);
            let changed = true;
            while (changed) {
                changed = false;
                let visited = Array(ROWS).fill().map(() => []);
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        if (boardCopy[r][c] !== 0 && !visited[r][c]) {
                            let color = boardCopy[r][c];
                            let queue = [[r, c]];
                            visited[r][c] = true;
                            let stones = [[r, c]];
                            let hasLib = false;
                            let idx = 0;
                            while (idx < queue.length) {
                                let [rr, cc] = queue[idx++];
                                for (const [nr, nc] of getNeighbors(rr, cc)) {
                                    if (boardCopy[nr][nc] === 0) {
                                        hasLib = true;
                                    } else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                        visited[nr][nc] = true;
                                        queue.push([nr, nc]);
                                        stones.push([nr, nc]);
                                    }
                                }
                            }
                            if (!hasLib) {
                                for (let [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
            return boardCopy;
        }

        // 计算领地归属（基于格线距离，范围限制）
        function assignTerritoryWithRange(liveBoard) {
            const territory = Array(ROWS).fill().map((_, r) => Array(r + 1).fill(0));
            // 收集活子坐标
            let blackStones = [], whiteStones = [];
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < rowLen(r); c++) {
                    if (liveBoard[r][c] === 1) blackStones.push([r, c]);
                    else if (liveBoard[r][c] === 2) whiteStones.push([r, c]);
                }
            }
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < rowLen(r); c++) {
                    if (liveBoard[r][c] !== 0) continue; // 只处理空点
                    // 确定最大距离：边角（外圈两环）为5，否则4（按形状判断边界）
                    const isEdge = SHAPE === 'hexagon'
                        ? (getNeighbors(r, c).length < 6 || r <= 1 || r >= ROWS - 2 || c <= 1 || c >= rowLen(r) - 2)
                        : (r <= 1 || r >= ROWS - 2 || c <= 1 || c >= rowLen(r) - 2);
                    const maxDist = isEdge ? 5 : 4;
                    let minBlack = Infinity, minWhite = Infinity;
                    for (let [br, bc] of blackStones) {
                        let d = gridDistance(r, c, br, bc);
                        if (d < minBlack) minBlack = d;
                    }
                    for (let [wr, wc] of whiteStones) {
                        let d = gridDistance(r, c, wr, wc);
                        if (d < minWhite) minWhite = d;
                    }
                    // 只有距离在范围内的才归属，否则为公共地（0）
                    if (minBlack <= maxDist && minWhite <= maxDist) {
                        if (minBlack < minWhite) territory[r][c] = 1;
                        else if (minWhite < minBlack) territory[r][c] = 2;
                        else territory[r][c] = 3; // 平局
                    } else if (minBlack <= maxDist) {
                        territory[r][c] = 1;
                    } else if (minWhite <= maxDist) {
                        territory[r][c] = 2;
                    } else {
                        territory[r][c] = 3; // 公共地
                    }
                }
            }
            return territory;
        }

        function computeScore(liveBoard, territory) {
            let blackStones = 0, whiteStones = 0;
            let blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < rowLen(r); c++) {
                    if (liveBoard[r][c] === 1) blackStones++;
                    else if (liveBoard[r][c] === 2) whiteStones++;
                    else if (liveBoard[r][c] === 0) {
                        if (territory[r][c] === 1) blackTerritory++;
                        else if (territory[r][c] === 2) whiteTerritory++;
                        else if (territory[r][c] === 3) publicTerritory++;
                    }
                }
            }
            const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
            const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
            return { blackTotal, whiteTotal };
        }

        function computeLead() {
            const liveBoard = removeDeadGroups(board);
            const territory = assignTerritoryWithRange(liveBoard);
            const { blackTotal, whiteTotal } = computeScore(liveBoard, territory);
            return blackTotal - whiteTotal - 2 * KOMI;
        }

        function updateEstimateData() {
            cachedLiveBoard = removeDeadGroups(board);
            cachedTerritory = assignTerritoryWithRange(cachedLiveBoard);
            const { blackTotal, whiteTotal } = computeScore(cachedLiveBoard, cachedTerritory);
            const lead = blackTotal - whiteTotal - 2 * KOMI;
            scoreTitle.innerText = '形势判断';
            scoreBoard.innerText = `黑: ${blackTotal.toFixed(0)}　白: ${whiteTotal.toFixed(0)}`;
            leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${lead.toFixed(1)}点`;
        }

        // ======================== 绘制 ========================
        function computeStoneNumbers() {
            const nums = Array(ROWS).fill().map((_, r) => Array(r + 1).fill(0));
            if (replayMode && tryPlayMode) {
                for (let i = 1; i <= tryPlayStep; i++) {
                    const markers = tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (isValidCoord(m.row, m.col) && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (replayMode) {
                for (let i = 1; i <= replayStep; i++) {
                    const markers = replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (isValidCoord(m.row, m.col) && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (liveReplayBoards.length && liveViewStep < liveReplayBoards.length - 1) {
                for (let i = 1; i <= liveViewStep; i++) {
                    const markers = liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (isValidCoord(m.row, m.col) && board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else {
                for (let i = 0; i < moveLog.length; i++) {
                    const m = moveLog[i];
                    if (m && isValidCoord(m.row, m.col) && board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function rightEdgeLabel(r) {
            if (r < 26) return String.fromCharCode(65 + r);
            return String(r + 1);
        }

        function drawBoard() {
            ctx.clearRect(0, 0, 600, 600);

            const cornerRadius = 3;
            function drawRoundedPolygonLocal(vertices, radius, skipStroke) {
                const n = vertices.length;
                if (n < 3) return;
                const startPoints = [], endPoints = [];
                for (let i = 0; i < n; i++) {
                    const curr = vertices[i];
                    const prev = vertices[(i - 1 + n) % n];
                    const next = vertices[(i + 1) % n];
                    const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                    const len1 = Math.hypot(v1.x, v1.y);
                    const len2 = Math.hypot(v2.x, v2.y);
                    const dx1 = v1.x / len1, dy1 = v1.y / len1;
                    const dx2 = v2.x / len2, dy2 = v2.y / len2;
                    startPoints.push({ x: curr.x + dx1 * radius, y: curr.y + dy1 * radius });
                    endPoints.push({ x: curr.x + dx2 * radius, y: curr.y + dy2 * radius });
                }
                ctx.beginPath();
                ctx.moveTo(endPoints[n - 1].x, endPoints[n - 1].y);
                for (let i = 0; i < n; i++) {
                    ctx.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
                }
                ctx.closePath();
                ctx.fill();
                if (!skipStroke) ctx.stroke();
            }

            if (SHAPE === 'rhombus') {
                RhomBoardGeom.drawWoodenFrame(ctx, ROWS);
                RhomBoardGeom.drawGrid(ctx, ROWS);
                RhomBoardGeom.drawAntiDiagonalLines(ctx, ROWS);
                RhomBoardGeom.drawStarPoints(ctx, ROWS);
                RhomBoardGeom.drawCoordLabels(ctx, ROWS);
            } else if (SHAPE === 'hexagon') {
                // 木质外框与 weiqi 统一：无阴影、背景 #fdcc90、边线 #3a281c 0.5px
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = '#fdcc90';
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 0.5;
                drawRoundedPolygonLocal(FIXED_OUTER_HEX, cornerRadius, false);
                ctx.restore();
                // 网格线：每条格边只画一次（右邻 + 下方两邻）
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = '#3a281c';
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        const start = coordToPixel(r, c);
                        if (c + 1 < rowLen(r)) {
                            const end = coordToPixel(r, c + 1);
                            ctx.beginPath();
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                            ctx.stroke();
                        }
                        for (const [nr, nc] of getNeighbors(r, c)) {
                            if (nr > r) {
                                const end = coordToPixel(nr, nc);
                                ctx.beginPath();
                                ctx.moveTo(start.x, start.y);
                                ctx.lineTo(end.x, end.y);
                                ctx.stroke();
                            }
                        }
                    }
                }
                // 星位（中心）
                const starsHex = getShapeStars();
                ctx.fillStyle = '#3a281c';
                for (let { r, c } of starsHex) {
                    let { x, y } = coordToPixel(r, c);
                    ctx.beginPath();
                    ctx.arc(x, y, 10.1 - 0.3 * ROWS, 0, 2 * Math.PI);
                    ctx.fill();
                }
                // 坐标：上边字母（右移少许）、左上数字（偏上）、左下大写希腊字母（偏下）
                const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                const GREEK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
                const labelOff = 17.4 - 0.2 * ROWS;
                const labelDy = DY * 0.35;
                const RH = (ROWS - 1) / 2;
                ctx.font = `bold ${16.4 - 0.2 * ROWS}px Arial`;
                ctx.fillStyle = '#3a281c';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let c = 0; c < rowLen(0); c++) {
                    let { x, y } = coordToPixel(0, c);
                    x += labelOff * 0.5;
                    y -= labelOff;
                    ctx.fillText(LETTERS[c], x, y);
                }
                for (let r = 0; r <= RH; r++) {
                    let { x, y } = coordToPixel(r, 0);
                    x -= labelOff * 0.6;
                    y -= labelDy;
                    ctx.fillText(String(r + 1), x, y);
                }
                for (let r = RH; r < ROWS; r++) {
                    let { x, y } = coordToPixel(r, 0);
                    x -= labelOff * 0.6;
                    y += labelDy;
                    ctx.fillText(GREEK[r - RH] || String(r + 1), x, y);
                }
            } else {
                // 三角：木质外框
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = '#fdcc90';
                ctx.strokeStyle = '#3a281c';
                ctx.lineWidth = 0.5;
                drawRoundedPolygonLocal([FIXED_OUTER_A, FIXED_OUTER_B, FIXED_OUTER_C], cornerRadius, false);
                ctx.restore();
                // 网格线（三方向）
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = '#3a281c';
                for (let r = 0; r < ROWS; r++) {
                    let start = coordToPixel(r, 0);
                    let end = coordToPixel(r, r);
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();
                }
                for (let c = 0; c < ROWS; c++) {
                    let start = coordToPixel(c, c);
                    let end = coordToPixel(ROWS - 1, c);
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();
                }
                for (let s = 0; s < ROWS; s++) {
                    let start = coordToPixel(s, 0);
                    let end = coordToPixel(ROWS - 1, ROWS - 1 - s);
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();
                }
                // 星位
                const starsTri = getShapeStars();
                ctx.fillStyle = '#3a281c';
                for (let { r, c } of starsTri) {
                    let { x, y } = coordToPixel(r, c);
                    ctx.beginPath();
                    ctx.arc(x, y, 10.1 - 0.3 * ROWS, 0, 2 * Math.PI);
                    ctx.fill();
                }
                // 坐标：左数字右字母
                ctx.font = `bold ${16.4 - 0.2 * ROWS}px Arial`;
                ctx.fillStyle = '#3a281c';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < ROWS; r++) {
                    let { x, y } = coordToPixel(r, 0);
                    x -= (17.4 - 0.2 * ROWS);
                    ctx.fillText((r + 1).toString(), x, y);
                }
                ctx.textAlign = 'center';
                for (let r = 0; r < ROWS; r++) {
                    let { x, y } = coordToPixel(r, r);
                    x += (17.4 - 0.2 * ROWS);
                    ctx.fillText(rightEdgeLabel(r), x, y);
                }
            }

            const stoneRadius = DX * 0.42;
            const markSizeDefault = DX * 0.34;
            const lowerLastMoveMarker = showMoveNumbers || showEstimateActive;
            if (lowerLastMoveMarker) {
                for (let { row, col, color } of lastMoveMarkers) {
                    if (!isValidCoord(row, col)) continue;
                    let { x, y } = coordToPixel(row, col);
                    ctx.beginPath();
                    ctx.moveTo(x + stoneRadius, y + stoneRadius);
                    ctx.lineTo(x, y + stoneRadius);
                    ctx.lineTo(x + stoneRadius, y);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#ffffff' : '#222222';
                    ctx.fill();
                }
            }

            // 棋子
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < rowLen(r); c++) {
                    const val = board[r][c];
                    if (val === 0) 
                        continue;
                    const radius = stoneRadius;
                    let { x, y } = coordToPixel(r, c);
                    ctx.save();
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowOffsetY = 2;
                    const grad = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
                    if (val === 1) {
                        grad.addColorStop(0, '#444');
                        grad.addColorStop(0.6, '#222');
                        grad.addColorStop(1, '#111');
                    } else {
                        grad.addColorStop(0, '#fff');
                        grad.addColorStop(0.5, '#eee');
                        grad.addColorStop(1, '#aaa');
                    }
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    ctx.restore();
                    if (!showMoveNumbers) {
                        ctx.beginPath();
                        ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                        ctx.fillStyle = val === 1 ? '#444' : '#fff';
                        ctx.fill();
                    }
                }
            }

            if (showMoveNumbers) {
                const nums = computeStoneNumbers();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        if (nums[r][c] > 0 && board[r][c] !== 0) {
                            const { x, y } = coordToPixel(r, c);
                            const numStr = nums[r][c].toString();
                            const fontSize = Math.max(8, Math.floor(DX * (numStr.length >= 3 ? 0.28 : 0.36)));
                            ctx.font = `bold ${fontSize}px Arial`;
                            ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                            ctx.fillText(numStr, x, y + 1);
                        }
                    }
                }
            }

            // 最后一步标记（平常：棋子之上）
            if (!lowerLastMoveMarker) {
                const markSize = markSizeDefault;
                for (let { row, col, color } of lastMoveMarkers) {
                    if (!isValidCoord(row, col)) continue;
                    let { x, y } = coordToPixel(row, col);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + markSize, y);
                    ctx.lineTo(x, y + markSize);
                    ctx.closePath();
                    ctx.fillStyle = color === 1 ? '#ffffff' : '#222222';
                    ctx.fill();
                }
            }

            for (const key of Object.keys(userBoardMarks)) {
                const [r, c] = key.split(',').map(Number);
                if (!isUserBoardMarkVisibleAt(r, c)) continue;
                const ch = userBoardMarks[key];
                let { x, y } = coordToPixel(r, c);
                const markBgR = DX * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
                ctx.fill();
                const fontPx = DX * (ch === '🚩' ? 0.47 : 0.52);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }

            // 悬停预览
            const editCb = document.getElementById('editModeCheckbox');
            const editSel = document.getElementById('editToolSelect');
            const editing = !!(editCb && editCb.checked);
            const canHover = editing || tryPlayMode || (!gameOver && isMyTurn);
            if ((isMouseDevice || mobileTwoStepPlacing()) && canHover && isHoverValid && hoverR >= 0 && hoverC >= 0 && (editing || board[hoverR][hoverC] === 0)) {
                let hoverColor = null;
                if (editing) {
                    const t = (editSel && editSel.value) || 'empty';
                    if (t === 'white') hoverColor = '#fff';
                    else if (t === 'black') hoverColor = '#222';
                    else if (t !== 'empty') hoverColor = '#666';
                } else if (tryPlayMode) hoverColor = tryPlayCurrentPlayer === 1 ? '#222' : '#ddd';
                else hoverColor = mySlot === 'black' ? '#222' : '#ddd';
                if (hoverColor) {
                    let { x, y } = coordToPixel(hoverR, hoverC);
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath();
                    ctx.arc(x, y, DX * 0.35, 0, 2 * Math.PI);
                    ctx.fillStyle = hoverColor;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
            }

            // 形势判断叠加层（死子标记 + 领地归属点）
            if (showEstimateActive && cachedLiveBoard && cachedTerritory) {
                const dotRadius = 3;
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < rowLen(r); c++) {
                        // 死子标记（原棋盘有子，活棋盘无子）
                        if (board[r][c] !== 0 && cachedLiveBoard[r][c] === 0) {
                            let { x, y } = coordToPixel(r, c);
                            ctx.fillStyle = board[r][c] === 1 ? '#ffffff' : '#222222';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        }
                        // 领地归属点（仅当空点且归属明确且不为公共地）
                        else if (board[r][c] === 0 && cachedTerritory[r][c] === 1) {
                            let { x, y } = coordToPixel(r, c);
                            ctx.fillStyle = '#222222';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        } else if (board[r][c] === 0 && cachedTerritory[r][c] === 2) {
                            let { x, y } = coordToPixel(r, c);
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                        }
                    }
                }
            }
        }

        function drawBoardWithOverlay() {
            drawBoard();
        }

        function updateTurn() {
            if (replayMode) {
                isMyTurn = false;
                if (showEstimateActive) updateEstimateData();
                else drawBoardWithOverlay();
                return;
            }
            const liveTotal = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            const browsingLive = liveReplayBoards.length > 0 && liveViewStep < liveTotal;
            if (browsingLive) {
                if (liveViewStep === 0) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = liveReplayStepPlayers[liveViewStep] === 1 ? '⚫' : '⚪';
                    turnDisplay.innerText = `${emoji} 第${liveViewStep}手`;
                }
                isMyTurn = false;
                if (showEstimateActive) updateEstimateData();
                else drawBoardWithOverlay();
                return;
            }
            if (gameOver) {
                turnDisplay.innerText = '对局结束';
                if (winner === 'black') scoreTitle.innerText = '黑胜';
                else if (winner === 'white') scoreTitle.innerText = '白胜';
                else if (winner === 'draw') scoreTitle.innerText = '和棋';
                else scoreTitle.innerText = '　';
                isMyTurn = false;
                drawBoardWithOverlay();
                return;
            }
            if (tryPlayMode) {
                if (showEstimateActive) updateEstimateData();
                else drawBoardWithOverlay();
                return;
            }
            if (!matchStarted) {
                turnDisplay.innerText = QiWeiqiSquarePageRuntime.waitingSeatTurnText(slots, mySlot);
                isMyTurn = false;
                if (showEstimateActive) updateEstimateData();
                else drawBoardWithOverlay();
                return;
            }
            const total = liveReplayBoards.length > 0 ? liveReplayBoards.length - 1 : 0;
            if (liveReplayBoards.length === 0) {
                const emptyBoard = !board.some(row => row.some(v => v === 1 || v === 2));
                if (emptyBoard) {
                    turnDisplay.innerText = '初始局面';
                } else {
                    const lastPlayer = currentPlayer === 1 ? 2 : 1;
                    const lastHand = Math.max(1, numberOfHands - 1);
                    turnDisplay.innerText = `${lastPlayer === 1 ? '⚫' : '⚪'} 第${lastHand}手`;
                }
            } else if (total === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const p = liveReplayStepPlayers[total];
                turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            isMyTurn = (mySlot !== null) && ((mySlot === 'black' && currentPlayer === 1) || (mySlot === 'white' && currentPlayer === 2));
            if (showEstimateActive) updateEstimateData();
            else drawBoardWithOverlay();
        }

        function showEstimate() {
            if (!showEstimateActive) {
                clearEstimate();
                return;
            }
            updateEstimateData();
            drawBoardWithOverlay();
        }

        function clearEstimate() {
            cachedLiveBoard = null;
            cachedTerritory = null;
            scoreTitle.innerText = '　';
            scoreBoard.innerText = '　';
            leadInfo.innerText = '　';
            drawBoardWithOverlay();
        }

        function showScoreConfirm(lead) {
            QiSquareWeiqiCanvas.fillScoreConfirmText(scoreConfirmText, lead);
            scoreConfirmPanel.style.display = 'block';
        }

        function hideScoreConfirm() {
            scoreConfirmPanel.style.display = 'none';
        }

        function downloadRecord(data) {
            QiSquareWeiqiCanvas.downloadWeiqiJsonRecord(data, recordDownloadPrefix);
        }

        function enterReplayMode(data) {
            clearMobileMovePreview();
            const size = ROWS;
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [0];

            let curBoard = initBoardArray(size);
            if (data.initialPosition) {
                if (Array.isArray(data.initialPosition)) {
                    for (const s of data.initialPosition) {
                        if (typeof s !== 'string' || s.length < 4) continue;
                        const p = s[0];
                        if (p !== 'B' && p !== 'W') continue;
                        const comma = s.indexOf(',');
                        if (comma <= 1) continue;
                        const r = parseInt(s.slice(1, comma), 10);
                        const c = parseInt(s.slice(comma + 1), 10);
                        if (!isValidCoord(r, c)) continue;
                        curBoard[r][c] = p === 'B' ? 1 : 2;
                    }
                } else if (Array.isArray(data.initialPosition.black)) {
                    for (const pos of data.initialPosition.black) {
                        if (Array.isArray(pos) && pos.length === 2)
                            curBoard[pos[0]][pos[1]] = 1;
                    }
                }
                if (Array.isArray(data.initialPosition.white)) {
                    for (const pos of data.initialPosition.white) {
                        if (Array.isArray(pos) && pos.length === 2)
                            curBoard[pos[0]][pos[1]] = 2;
                    }
                }
            }
            replayBoards.push(deepCopyBoard(curBoard));
            replayMarkers.push([]);

            for (const move of (data.moves || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                replayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    replayBoards.push(deepCopyBoard(curBoard));
                    replayMarkers.push([]);
                }
            }

            replayTotalSteps = replayBoards.length - 1;
            replayMode = true;

            const slider = document.getElementById('replaySlider');
            slider.max = replayTotalSteps;
            setReplayStep(replayTotalSteps);
            updateReplayUI();
        }

        function exitReplayMode() {
            clearMobileMovePreview();
            tryPlayMode = false;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;
            replayMode = false;
            replayBoards = [];
            replayMarkers = [];
            replayStepPlayers = [];
            replayStep = 0;
            replayTotalSteps = 0;
            updateReplayUI();
        }

        function setReplayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > replayTotalSteps) step = replayTotalSteps;
            replayStep = step;
            board = deepCopyBoard(replayBoards[step]);
            lastMoveMarkers = replayMarkers[step].map(m => ({ ...m }));

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${replayTotalSteps}`;

            if (step === 0) {
                turnDisplay.innerText = '初始局面';
            } else {
                const emoji = replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 第${step}手`;
            }
            isMyTurn = false;

            if (showEstimateActive) updateEstimateData();
            drawBoardWithOverlay();
        }

        function updateReplayUI() {
            const gameButtonIds = ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!mySlot;
            const started = !!(matchStarted || (matchTime && matchTime.settings));
            const showMatchButtons = isPlayer && started && !replayMode;
            for (const id of gameButtonIds)
                document.getElementById(id).style.display = showMatchButtons ? '' : 'none';
            replayPanel.style.display = '';
            tryPlayBtn.style.display = showMatchButtons ? 'none' : '';
            tryPlayBtn.innerText = tryPlayMode ? '试下结束' : '试下';
            updateRecordButtons();
        }

        function enterTryPlay() {
            clearMobileMovePreview();
            tryPlayMode = true;
            tryPlayBaseStep = replayStep;
            tryPlayBoards = [deepCopyBoard(board)];
            tryPlayMarkers = [lastMoveMarkers.map(m => ({ ...m }))];

            const _fromLive = !replayMode;
            const _RT = typeof QiWeiqiSquarePageRuntime !== 'undefined' ? QiWeiqiSquarePageRuntime : null;
            const _startPlayer = _RT && _RT.resolveTryPlaySideToMove
                ? _RT.resolveTryPlaySideToMove({
                    fromLive: _fromLive,
                    replayStep,
                    replayStepPlayers,
                    liveViewStep,
                    liveReplayStepPlayers,
                    liveReplayBoardsLength: (liveReplayBoards && liveReplayBoards.length) || 0,
                    currentPlayer
                })
                : (replayStep > 0 ? (3 - replayStepPlayers[replayStep]) : ((currentPlayer === 1 || currentPlayer === 2) ? currentPlayer : 1));
            tryPlayBasePlayer = _startPlayer;
            tryPlayCurrentPlayer = _startPlayer;
            // 与公共 enterTryPlay 一致：从直播局面进入试下时挂 replayMode 脚手架。
            // 点击/绘制均以 replayMode && tryPlayMode 判断，缺了它试下点击无反应
            if (_fromLive) {
                tryPlayFromLive = true;
                tryPlayFromLiveStep = liveViewStep || 0;
                replayMode = true;
                replayBoards = [deepCopyBoard(board)];
                replayMarkers = [(lastMoveMarkers || []).map(m => ({ ...m }))];
                replayStepPlayers = [tryPlayCurrentPlayer === 1 ? 2 : 1];
                replayStep = 0;
                replayTotalSteps = 0;
            } else {
                tryPlayFromLive = false;
            }
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
        }

        function exitTryPlay() {
            clearMobileMovePreview();
            // 与公共 exitTryPlay 一致：从直播进入试下的要退回直播局面，而不是走打谱 setReplayStep
            const fromLive = !!tryPlayFromLive;
            const savedLiveStep = tryPlayFromLiveStep != null ? tryPlayFromLiveStep : liveViewStep;
            const snapBoard = fromLive && tryPlayBoards.length > 0 ? deepCopyBoard(tryPlayBoards[0]) : null;
            const snapMarkers = fromLive && tryPlayMarkers.length > 0 && tryPlayMarkers[0]
                ? tryPlayMarkers[0].map(m => ({ ...m }))
                : [];
            tryPlayMode = false;
            tryPlayFromLive = false;
            tryPlayFromLiveStep = null;
            tryPlayBoards = [];
            tryPlayMarkers = [];
            tryPlayStep = 0;
            tryPlayTotalSteps = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            if (fromLive) {
                replayMode = false;
                replayBoards = [];
                replayMarkers = [];
                replayStepPlayers = [];
                replayStep = 0;
                replayTotalSteps = 0;
                if (snapBoard) {
                    board = snapBoard;
                    lastMoveMarkers = snapMarkers;
                    if (liveReplayBoards.length > 0) {
                        const step = Math.min(Math.max(0, savedLiveStep), liveReplayBoards.length - 1);
                        liveReplayBoards[step] = deepCopyBoard(snapBoard);
                        if (!liveReplayMarkers[step]) liveReplayMarkers[step] = [];
                        liveReplayMarkers[step] = snapMarkers.map(m => ({ ...m }));
                        liveViewStep = step;
                    } else {
                        liveReplayBoards = [deepCopyBoard(snapBoard)];
                        liveReplayMarkers = [snapMarkers.map(m => ({ ...m }))];
                        liveReplayStepPlayers = [0];
                        liveViewStep = 0;
                    }
                } else {
                    applyLiveViewBoard();
                }
                updateLiveReplayPanelUI();
                updateTurn();
            } else {
                slider.max = replayTotalSteps;
                setReplayStep(tryPlayBaseStep);
            }
            updateReplayUI();
        }

        function tryPlayMove(row, col) {
            if (board[row][col] !== 0) return false;
            const playerVal = tryPlayCurrentPlayer;
            const newBoard = tryPlaceStone(board, row, col, playerVal);
            if (!newBoard) return false;

            if (tryPlayStep < tryPlayTotalSteps) {
                tryPlayBoards.length = tryPlayStep + 1;
                tryPlayMarkers.length = tryPlayStep + 1;
            }

            tryPlayBoards.push(deepCopyBoard(newBoard));
            tryPlayMarkers.push([{ row, col, color: playerVal }]);
            tryPlayTotalSteps = tryPlayBoards.length - 1;
            tryPlayStep = tryPlayTotalSteps;
            tryPlayCurrentPlayer = 3 - tryPlayCurrentPlayer;

            board = deepCopyBoard(newBoard);
            lastMoveMarkers = [{ row, col, color: playerVal }];

            const slider = document.getElementById('replaySlider');
            slider.max = tryPlayTotalSteps;
            slider.value = tryPlayStep;
            updateTryPlayDisplay();
            if (showEstimateActive) updateEstimateData();
            else drawBoardWithOverlay();
            return true;
        }

        function setTryPlayStep(step) {
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > tryPlayTotalSteps) step = tryPlayTotalSteps;
            tryPlayStep = step;
            board = deepCopyBoard(tryPlayBoards[step]);
            lastMoveMarkers = tryPlayMarkers[step].map(m => ({ ...m }));

            const basePlayer = (tryPlayBasePlayer === 1 || tryPlayBasePlayer === 2)
                ? tryPlayBasePlayer
                : (tryPlayBaseStep === 0 ? 1 : (3 - replayStepPlayers[tryPlayBaseStep]));
            tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);

            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            if (showEstimateActive) updateEstimateData();
            else drawBoardWithOverlay();
        }

        function updateTryPlayDisplay() {
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (tryPlayMode) {
                stepDisplay.innerText = `试下 ${tryPlayStep} / ${tryPlayTotalSteps}`;
                const emoji = tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                turnDisplay.innerText = `${emoji} 试下`;
            }
        }

        function rebuildLiveReplayFromMoveCoords(moveCoords, openingBoard) {
            liveReplayBoards = [];
            liveReplayMarkers = [];
            liveReplayStepPlayers = [0];
            let curBoard = openingBoard ? deepCopyBoard(openingBoard) : initBoardArray(ROWS);
            liveReplayBoards.push(deepCopyBoard(curBoard));
            liveReplayMarkers.push([]);
            for (const move of (moveCoords || [])) {
                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
            }
        }
 
        function applyLiveReplayIncremental(moveCoords) {
            const startLen = liveReplayBoards.length - 1;
            const mcs = moveCoords || [];
            if (mcs.length <= startLen) return true;
            let curBoard = deepCopyBoard(liveReplayBoards[liveReplayBoards.length - 1]);
            for (let i = startLen; i < mcs.length; i++) {
                const move = mcs[i];

                const playerVal = move.player === 'black' ? 1 : 2;
                liveReplayStepPlayers.push(playerVal);
                if (move.type === 'move') {
                    const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                    if (newBoard) curBoard = newBoard;
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
                } else if (move.type === 'pass') {
                    liveReplayBoards.push(deepCopyBoard(curBoard));
                    liveReplayMarkers.push([]);
                }
                else { return false; }
            }
            return true;
        }

        function syncLiveReplayFromState(state) {
            const mcs = state.moveCoords || [];
            const syncedLen = liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                if (applyLiveReplayIncremental(mcs)) return;
            }
            rebuildLiveReplayFromMoveCoords(mcs, state.initialBoard);
        }

        function applyLiveViewBoard() {
            if (!liveReplayBoards.length) {
                board = initBoardArray(ROWS);
                lastMoveMarkers = [];
                return;
            }
            if (liveViewStep < 0) liveViewStep = 0;
            if (liveViewStep >= liveReplayBoards.length) liveViewStep = liveReplayBoards.length - 1;
            board = deepCopyBoard(liveReplayBoards[liveViewStep]);
            lastMoveMarkers = liveReplayMarkers[liveViewStep].map(m => ({ ...m }));
        }

        function updateLiveReplayPanelUI() {
            if (replayMode) return;
            const total = Math.max(0, liveReplayBoards.length - 1);
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = total;
            slider.value = liveViewStep;
            document.getElementById('replayStepDisplay').innerText = `${liveViewStep} / ${total}`;
        }

        function setLiveViewStep(step) {
            clearMobileMovePreview();
            if (replayMode) return;
            const total = Math.max(0, liveReplayBoards.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            liveViewStep = step;
            liveFollowLatest = step >= total;
            applyLiveViewBoard();
            updateLiveReplayPanelUI();
            if (showEstimateActive) showEstimate();
            else updateTurn();
        }

        let updateRecordButtons = () => {};

        // ======================== WebSocket ========================

        function connectWebSocket() {
            ws = QiSquareWeiqiCanvas.connectWeiqiRoomWebSocket({
                gameType,
                roomId,
                roomPassword,
                onMessage: handleMessage,
                colorStatus,
                connectWebSocket,
                clearReconnectTimer: () => {
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => reconnectTimer,
                setReconnectTimer: (id) => { reconnectTimer = id; }
            });
        }

        function rebuildSizeSelect() {
            const sel = document.getElementById('boardSizeSelect');
            if (!sel) return;
            const cfg = shapeCfg();
            sel.innerHTML = '';
            for (let n = cfg.min; n <= cfg.max; n++) {
                const opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n + '路';
                if (n === cfg.def) opt.selected = true;
                sel.appendChild(opt);
            }
        }

        /** 三种形状的客户端显示贴目（沿用合并前各自口径：菱形 3.25，三角/六角 4.75） */
        function komiForShape(shape) {
            return shape === 'rhombus' ? 3.25 : 4.75;
        }
        function refreshKomiInfo() {
            KOMI = komiForShape(SHAPE);
            const el = document.getElementById('komiInfo');
            if (el) el.textContent = `黑贴白${KOMI}点`;
        }
        function refreshSeatOverlay() {
            if (typeof updateSeatOverlay === 'function') updateSeatOverlay();
        }

        function syncState(state)
        {
            clearMobileMovePreview();
            if (state.shape && state.shape !== SHAPE) {
                SHAPE = state.shape;
                rebuildSizeSelect();
                const shapeSel = document.getElementById('subGameSelect');
                if (shapeSel) shapeSel.value = SHAPE;
                refreshKomiInfo();
                refreshSeatOverlay();
            }
            if (state.boardSize && rowsFor(SHAPE, state.boardSize) !== ROWS)
            {
                ROWS = rowsFor(SHAPE, state.boardSize);
                board = initBoardArray(ROWS);
                updateBoardGeometry();
                const sizeSelect = document.getElementById('boardSizeSelect');
                if (sizeSelect) sizeSelect.value = state.boardSize;
                refreshSeatOverlay();
            }
            numberOfHands = state.numberOfHands || 1;
            currentPlayer = state.currentPlayer;
            gameOver = state.gameOver || false;
            winner = state.winner || null;
            matchTime = state.matchTime || null;
            matchStarted = !!state.matchStarted;
            if (state.moveCoords)
                moveLog = state.moveCoords.map(m => m.type === 'move' ? { row: m.row, col: m.col } : null);
            if (state.slots)
                slots = state.slots;

            if (!replayMode) {
                const prevTotal = Math.max(0, liveReplayBoards.length - 1);
                const wasAtEnd = liveFollowLatest || liveViewStep >= prevTotal;
                syncLiveReplayFromState(state);
                const newTotal = Math.max(0, liveReplayBoards.length - 1);
                if (newTotal === 0) {
                    liveViewStep = 0;
                    liveFollowLatest = true;
                } else if (wasAtEnd) {
                    liveViewStep = newTotal;
                    liveFollowLatest = true;
                } else {
                    liveViewStep = Math.min(liveViewStep, newTotal);
                    if (liveViewStep === newTotal)
                        liveFollowLatest = true;
                }
                if (!tryPlayMode) {
                    applyLiveViewBoard();
                    updateLiveReplayPanelUI();
                }
            } else if (!tryPlayMode) {
                board = state.board;
                lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = board.some(row => row.some(v => v !== 0));
            const hasPlayer = slots.black || slots.white;
            const canChange = !hasAnyStone && !hasPlayer && !gameOver && mySlot === null;
            const sizeSelect = document.getElementById('boardSizeSelect');
            if (sizeSelect) sizeSelect.style.display = canChange ? 'inline-block' : 'none';
            const shapeSelect = document.getElementById('subGameSelect');
            if (shapeSelect) shapeSelect.style.display = canChange ? 'inline-block' : 'none';

            if (showEstimateActive)
            {
                updateEstimateData();
                updateTurn();
            } else {
                updateTurn();
            }
            updateReplayUI();
        }

        let updateRadioStyles = () => {};
        let updateSeatOverlay = null;
        let handleMessage = () => {};
        const _weiqiBindings = QiBoardRoomClient.createWeiqiMessageBindings({
            roomId,
            gameType,
            pageState: {
                get mySlot() { return mySlot; },
                set mySlot(v) { mySlot = v; },
                get slots() { return slots; },
                set slots(v) { slots = v; },
                get isMyTurn() { return isMyTurn; },
                set isMyTurn(v) { isMyTurn = v; },
                get gameOver() { return gameOver; },
                set gameOver(v) { gameOver = v; },
                get waitingScoreConfirm() { return waitingScoreConfirm; },
                set waitingScoreConfirm(v) { waitingScoreConfirm = v; },
                get showEstimateActive() { return showEstimateActive; },
                set showEstimateActive(v) { showEstimateActive = v; },
                get replayMode() { return replayMode; },
                set replayMode(v) { replayMode = v; },
                get tryPlayMode() { return tryPlayMode; },
                set tryPlayMode(v) { tryPlayMode = v; },
                get tryPlayStep() { return tryPlayStep; },
                set tryPlayStep(v) { tryPlayStep = v; },
                get replayStep() { return replayStep; },
                set replayStep(v) { replayStep = v; },
                get liveViewStep() { return liveViewStep; },
                set liveViewStep(v) { liveViewStep = v; },
                get ws() { return ws; },
                set ws(v) { ws = v; },
                get showMoveNumbers() { return showMoveNumbers; },
                set showMoveNumbers(v) { showMoveNumbers = v; },
                get matchTime() { return matchTime; },
                set matchTime(v) { matchTime = v; },
                get matchStarted() { return matchStarted; },
                set matchStarted(v) { matchStarted = !!v; }
            },
            drawBoard: drawBoardWithOverlay,
            exitTryPlay,
            enterTryPlay,
            setTryPlayStep,
            setReplayStep,
            setLiveViewStep,
            getWs: () => ws,
            getBoardSize: () => (SHAPE === 'hexagon' ? (ROWS + 1) / 2 : ROWS),
            setBoardSize: (n) => { ROWS = rowsFor(SHAPE, n); },
            getKomi: () => KOMI,
            setKomi: (n) => { if (Number.isFinite(n)) KOMI = n; },
            getBoard: () => board,
            setBoard: (b) => { board = b; },
            getSlots: () => slots,
            setSlots: (s) => { slots = s; },
            getMySlot: () => mySlot,
            setMySlot: (s) => { mySlot = s; },
            getGameOver: () => gameOver,
            setGameOver: (v) => { gameOver = v; },
            getWinner: () => winner,
            setWinner: (w) => { winner = w; },
            getReplayMode: () => replayMode,
            getShowEstimateActive: () => showEstimateActive,
            setShowEstimateActive: (v) => { showEstimateActive = v; },
            getWaitingScoreConfirm: () => waitingScoreConfirm,
            setWaitingScoreConfirm: (v) => { waitingScoreConfirm = v; },
            getIRejected: () => iRejected,
            setIRejected: (v) => { iRejected = v; },
            colorStatus,
            scoreTitle,
            turnDisplay,
syncState,
            updateBoardGeometry,
            initBoardArray,
            exitReplayMode,
            clearEstimate,
            hideScoreConfirm,
            showEstimate,
            clearMobileMovePreview,
            downloadRecord,
            enterReplayMode,
            updateTurn,
            showScoreConfirm,
            // 限时协商/计时逻辑由 message bindings 托管（不要放到 page runtime 参数）
            standardWeiqiMatchTime,
            boardSeatOverlay: true,
            get seatOverlayShape() { return SHAPE; },
            getSeatOverlayVertices: () => {
                // 蒙版多边形与棋盘木质外框一致（600×600 逻辑画布坐标）
                if (SHAPE === 'hexagon') return FIXED_OUTER_HEX;
                if (SHAPE === 'rhombus') {
                    const n = SHAPE === 'hexagon' ? (ROWS + 1) / 2 : ROWS;
                    return RhomBoardGeom.frameOuterVerts(RHOM_PADDING, RHOM_CELL, n);
                }
                return [FIXED_OUTER_A, FIXED_OUTER_B, FIXED_OUTER_C];
            },
            seatOverlayCornerRadius: 3,
            onBoardSizeChanged: (msg) => {
                if (!msg.boardSize) return;
                const bs = rowsFor(SHAPE, msg.boardSize);
                if (bs !== ROWS) {
                    ROWS = bs;
                    board = initBoardArray(ROWS);
                    updateBoardGeometry();
                }
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = msg.boardSize;
                drawBoardWithOverlay();
                refreshSeatOverlay();
            }
        });
        updateSeatOverlay = _weiqiBindings.updateSeatOverlay;
        const _baseHandleMessage = _weiqiBindings.handleMessage;
        handleMessage = (msg) => {
            if (msg && msg.type === 'shapeChanged') {
                // 形状变更广播（带完整 state）：全量同步，覆盖本地乐观切换与其他观察者
                syncState(msg);
                return;
            }
            _baseHandleMessage(msg);
            if (msg && (msg.type === 'roomReset' || msg.type === 'newGameStarted')) {
                // 新局：蒙版重新显示，确保形状与当前棋盘一致
                refreshSeatOverlay();
            }
        };
        updateRecordButtons = _weiqiBindings.updateRecordButtons;
        updateRadioStyles = _weiqiBindings.updateRadioStyles;

        function commitMove(row, col) {
            if (gameOver) return false;
            if (!isMyTurn) return false;
            if (!isValidCoord(row, col) || board[row][col] !== 0) return false;
            ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            return {
                x: (clientX - rect.left) * scale,
                y: (clientY - rect.top) * scale
            };
        }

        function getSelectedBoardMark() {
            if (!boardMarkSelect) return { clear: false, ch: '?' };
            const v = boardMarkSelect.value;
            if (v === '') return { clear: true, ch: '' };
            return { clear: false, ch: v };
        }

        function applyUserBoardMark(row, col) {
            if (!isValidCoord(row, col)) return;
            if (board[row][col] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = row + ',' + col;
            const existing = userBoardMarks[key];
            if (clear) {
                if (existing !== undefined) {
                    delete userBoardMarks[key];
                    drawBoardWithOverlay();
                }
                return;
            }
            if (existing === undefined) {
                userBoardMarks[key] = ch;
            } else if (existing !== ch) {
                userBoardMarks[key] = ch;
            } else {
                delete userBoardMarks[key];
            }
            drawBoardWithOverlay();
        }

        let suppressCanvasClickAfterLongMark = false;

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
            const { row, col } = getClosestIntersection(x, y);
            applyUserBoardMark(row, col);
        });

        const LONG_MARK_MS = 500;
        const LONG_MARK_MOVE_CANCEL = 14;
        let longMarkTimer = null;
        let longMarkStart = null;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            longMarkStart = { x: t.clientX, y: t.clientY };
            longMarkTimer = setTimeout(() => {
                longMarkTimer = null;
                if (!longMarkStart) return;
                const { x, y } = canvasCoordsFromClient(longMarkStart.x, longMarkStart.y);
                const { row, col } = getClosestIntersection(x, y);
                applyUserBoardMark(row, col);
                suppressCanvasClickAfterLongMark = true;
                setTimeout(() => { suppressCanvasClickAfterLongMark = false; }, 450);
                longMarkStart = null;
            }, LONG_MARK_MS);
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (!longMarkTimer || !longMarkStart || e.touches.length !== 1) return;
            const t = e.touches[0];
            const dx = t.clientX - longMarkStart.x;
            const dy = t.clientY - longMarkStart.y;
            if (dx * dx + dy * dy > LONG_MARK_MOVE_CANCEL * LONG_MARK_MOVE_CANCEL) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
        }, { passive: true });

        function clearLongMarkTouch() {
            if (longMarkTimer) {
                clearTimeout(longMarkTimer);
                longMarkTimer = null;
            }
            longMarkStart = null;
        }
        canvas.addEventListener('touchend', clearLongMarkTouch);
        canvas.addEventListener('touchcancel', clearLongMarkTouch);

        canvas.addEventListener('click', (e) => {
            if (suppressCanvasClickAfterLongMark) {
                e.preventDefault();
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const scale = 600 / rect.width;
            const x = (e.clientX - rect.left) * scale;
            const y = (e.clientY - rect.top) * scale;
            const { row, col } = getClosestIntersection(x, y);
            if (tryPlayMode && replayMode) {
                if (row < 0 || col < 0 || !isValidCoord(row, col)) {
                    if (mobileTwoStepPlacing()) clearMobileMovePreview();
                    drawBoardWithOverlay();
                    return;
                }
                if (board[row][col] !== 0) return;
                if (mobileTwoStepPlacing()) {
                    if (hoverR === row && hoverC === col && isHoverValid) {
                        clearMobileMovePreview();
                        tryPlayMove(row, col);
                    } else {
                        hoverR = row;
                        hoverC = col;
                        isHoverValid = true;
                        drawBoardWithOverlay();
                    }
                    return;
                }
                tryPlayMove(row, col);
                return;
            }
            if (gameOver) return;
            if (!isMyTurn) return;
            if (waitingScoreConfirm) return;
            if (row < 0 || col < 0 || !isValidCoord(row, col)) {
                if (mobileTwoStepPlacing()) clearMobileMovePreview();
                drawBoardWithOverlay();
                return;
            }
            if (board[row][col] !== 0) return;
            if (mobileTwoStepPlacing()) {
                if (hoverR === row && hoverC === col && isHoverValid) {
                    clearMobileMovePreview();
                    commitMove(row, col);
                    drawBoardWithOverlay();
                } else {
                    hoverR = row;
                    hoverC = col;
                    isHoverValid = true;
                    drawBoardWithOverlay();
                }
                return;
            }
            commitMove(row, col);
        });

        if (isMouseDevice)
        {
            canvas.addEventListener('mousemove', (e) =>
            {
                if (waitingScoreConfirm) {
                    if (isHoverValid) { isHoverValid = false; hoverR = -1; hoverC = -1; drawBoardWithOverlay(); }
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const scale = 600 / rect.width;
                const x = (e.clientX - rect.left) * scale;
                const y = (e.clientY - rect.top) * scale;
                const { row, col } = getClosestIntersection(x, y);
                hoverR = row; hoverC = col;
                const editing = !!(document.getElementById('editModeCheckbox') || {}).checked;
                isHoverValid = (row >= 0 && col >= 0 && isValidCoord(row, col) && (editing || board[row][col] === 0));
                drawBoardWithOverlay();
            });
            canvas.addEventListener('mouseleave', () => {
                if (!waitingScoreConfirm) {
                    isHoverValid = false;
                    hoverR = -1; hoverC = -1;
                    drawBoardWithOverlay();
                }
            });
        }

        // 数点确认按钮
        if (scoreConfirmYes) {
            scoreConfirmYes.onclick = () => {
                ws.send(JSON.stringify({ type: 'scoreResponse', accept: true }));
                hideScoreConfirm();
            };
            scoreConfirmNo.onclick = () => {
                iRejected = true;
                ws.send(JSON.stringify({ type: 'scoreResponse', accept: false }));
                hideScoreConfirm();
                if (showEstimateActive) {
                    showEstimateActive = false;
                    clearEstimate();
                }
                waitingScoreConfirm = false;
            };
        }

        /* board edit UI */
        if (typeof QiWeiqiSquarePageRuntime !== 'undefined' && QiWeiqiSquarePageRuntime.installBoardEditUI) {
            const _editPs = {
                get board() { return board; },
                set board(v) { board = v; },
                get gameOver() { return typeof gameOver !== 'undefined' ? gameOver : false; },
                get mySlot() { return typeof mySlot !== 'undefined' ? mySlot : null; },
                get gameStarted() {
                    if (typeof gameStarted !== 'undefined') return !!gameStarted;
                    return (typeof numberOfHands !== 'undefined' ? numberOfHands : 1) > 1;
                },
                set gameStarted(v) { if (typeof gameStarted !== 'undefined') gameStarted = !!v; },
                editModeEnabled: false,
                editTool: 'empty',
                get hoverRow() { return hoverR; },
                set hoverRow(v) { hoverR = v == null ? -1 : v; },
                get hoverCol() { return hoverC; },
                set hoverCol(v) { hoverC = v == null ? -1 : v; },
                get isHoverValid() { return isHoverValid; },
                set isHoverValid(v) { isHoverValid = !!v; },
                get ws() { return typeof ws !== 'undefined' ? ws : null; }
            };
            const _editApi = QiWeiqiSquarePageRuntime.installBoardEditUI({
                ps: _editPs,
                canvas: document.getElementById('goBoard'),
                mode: 'grid2d',
                pickAtClient(clientX, clientY) {
                    if (typeof canvasCoordsFromClient === 'function' && typeof getClosestIntersection === 'function') {
                        const p = canvasCoordsFromClient(clientX, clientY);
                        return getClosestIntersection(p.x, p.y);
                    }
                    if (typeof pickIntersectionAtCanvas === 'function') {
                        const canvasEl = document.getElementById('goBoard');
                        const rect = canvasEl.getBoundingClientRect();
                        const scale = canvasEl.width / rect.width;
                        return pickIntersectionAtCanvas((clientX - rect.left) * scale, (clientY - rect.top) * scale);
                    }
                    return null;
                },
                drawBoard: typeof drawBoardWithOverlay === 'function' ? drawBoardWithOverlay
                    : (typeof drawBoard === 'function' ? drawBoard : function () {}),
                getBoard() { return board; },
                setBoard(b) { board = b; },
                emptyBoard() { return initBoardArray(ROWS); }
            });
            if (typeof syncState === 'function') {
                const _sync0 = syncState;
                syncState = function (state) {
                    if (state) _editPs.gameStarted = (state.numberOfHands || 1) > 1;
                    _sync0(state);
                    _editApi.updateEditModeUI();
                };
            }
        }

        // 形状选择器：三角形/菱形/六角形（开局前与路数选择器同显）
        rebuildSizeSelect();
        const shapeSelect = document.getElementById('subGameSelect');
        if (shapeSelect) {
            shapeSelect.addEventListener('change', () => {
                const v = shapeSelect.value;
                if (!v || v === SHAPE) return;
                // 本地立即切换（乐观更新）：棋盘、路数选项、贴目、蒙版马上生效；
                // 服务器广播 shapeChanged 回来时形状已相同，不会重复重建。
                SHAPE = v;
                ROWS = rowsFor(SHAPE, shapeCfg().def);
                board = initBoardArray(ROWS);
                updateBoardGeometry();
                rebuildSizeSelect();
                const sel = document.getElementById('boardSizeSelect');
                if (sel) sel.value = shapeCfg().def;
                refreshKomiInfo();
                if (ws && ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'setShape', shape: v }));
                }
                drawBoardWithOverlay();
                refreshSeatOverlay();
            });
        }

        connectWebSocket();
        })();
    }
};
