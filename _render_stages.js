// 规则二四阶段可视化：只生成 SVG（矢量可放大）
const fs = require('fs');
const { generateHexBoardData, generateMapRule2 } = require('./games/dfw.js');

// —— 几何（与客户端一致）：六角格中心 + 六角形顶点 ——
const SIZE = 1200;
const FRAME_MARGIN = 10;
const HEX_R = 2;
const n = 64;
const { cellCount: V, neighbors } = generateHexBoardData(n);
// 轴向中心（逻辑坐标）
const sqrt3 = Math.sqrt(3);
const radius = n - 2;
const centers = [];
for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) {
        if (Math.abs(q + r) > radius) continue;
        centers.push({ x: HEX_R * 1.5 * q, y: HEX_R * sqrt3 * (r + q / 2) });
    }
let cx = 0, cy = 0;
for (const c of centers) { cx += c.x; cy += c.y; }
cx /= V; cy /= V;
let maxDist = 0;
for (const c of centers) { const d = Math.hypot(c.x - cx, c.y - cy); if (d > maxDist) maxDist = d; }
const scale = (SIZE / 2 - FRAME_MARGIN) / maxDist;
const px = centers.map(c => ({ x: SIZE / 2 + (c.x - cx) * scale, y: SIZE / 2 + (c.y - cy) * scale }));
const rs = HEX_R * scale;   // 六角外接半径（像素）

// 运行规则二，收集四阶段快照
const stages = [];
const removed = generateMapRule2(V, neighbors, generateHexBoardData(n).dirs, (board, label) => {
    stages.push({ label, board: board.slice() });
});
for (const st of stages) {
    let kept = 0;
    for (let i = 0; i < V; i++) if (!st.board[i]) kept++;
    console.log(st.label + ':', (kept / V * 100).toFixed(1) + '%');
    const pts = [];
    for (let v = 0; v < V; v++) {
        if (st.board[v]) continue;
        const cxp = px[v].x, cyp = px[v].y;
        const poly = [];
        for (let k = 0; k < 6; k++) {
            const a = (60 * k) * Math.PI / 180;
            poly.push((cxp + rs * Math.cos(a)).toFixed(1) + ',' + (cyp + rs * Math.sin(a)).toFixed(1));
        }
        pts.push('<polygon points="' + poly.join(' ') + '" fill="#e0a858"/>');
    }
    const fname = `dfw-stage-${st.label}.svg`;
    fs.writeFileSync(fname,
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 ' + SIZE + ' ' + SIZE + '">'
        + '<rect width="' + SIZE + '" height="' + SIZE + '" fill="#fdcc90"/>' + pts.join('') + '</svg>');
    console.log('  →', fname);
}
console.log('完成');
