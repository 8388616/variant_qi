/**
 * 引擎身分診斷（暫時性工具，用完可刪）：把「同一顆模型、同一局面」下引擎的回答原封不動印出來，
 * 用來比對伺服器上的引擎二進位檔／參數與本機（GUI 用的那顆）是否一致。
 *
 * 用法（在網站根目錄，node 就在跑網站那個）：
 *   node probe-engine-identity.js [gameId]        # 預設 translocation-weiqi
 *
 * 它只做四件事，全部是唯讀命令，不動任何對局檔案：
 *   1. 問引擎版本／模型身分（version、kata-get-models）
 *   2. 問生效參數（kata-get-param maxVisits）與規則（kata-get-rules）、易位配額
 *   3. 擺一個固定的 30 手局面（本檔內嵌，與本機測試完全相同）
 *   4. 印出該局面下的 policy 前 5 名與易位頭（policyTranslocH/V）前 3 名、行棋方、引擎手數
 *
 * 把整份輸出貼回來即可：本機與伺服器只要有任何一項不同，就是引擎本體不同（不是模型、不是流程）。
 */
const fs = require('fs');
const { acquireKatagoSession, releaseKatagoSession } = require('./katago-gtp.js');

const GAME = process.argv[2] || 'translocation-weiqi';
const SIZE = 9, KOMI = 1.5, MAXX = 66;
const log = (s) => fs.writeSync(1, s + '\n');

// 固定局面：2026-09-28 那盤 9 路易位圍棋（紀錄 易位围棋_9路_20260928_025814）前 30 手
const MOVES = ('B4,4 W4,2 B6,4 W4,6 B2,4 W6,2 B2,2 W2,6 B6,6 W7,3 B7,4 W1,5 B1,4 W3,1 B2,1 W5,7 '
  + 'B6,7 W6,3 B5,3 W5,2 B4,3 W2,5 B3,2 W4,1 B3,5 W3,7 B3,6 W1,6 B0,5 W0,6').split(' ').map((s) => ({
  type: 'move', color: s[0] === 'B' ? 'black' : 'white',
  row: Number(s.slice(1).split(',')[0]), col: Number(s.slice(1).split(',')[1])
}));

const brief = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
function parseNn(text) {
  const res = { board: [], pass: null, h: [], v: [], owner: null };
  let mode = null;
  for (const raw of String(text).split('\n')) {
    const t = raw.trim(); if (!t) continue;
    if (t === 'policy') { mode = 'board'; continue; }
    if (t.startsWith('policyPass')) { mode = null; res.pass = t.split(/\s+/)[1]; continue; }
    if (t === 'policyTranslocH') { mode = 'h'; continue; }
    if (t === 'policyTranslocV') { mode = 'v'; continue; }
    if (t === 'whiteOwnership') { mode = 'owner'; res.owner = []; continue; }
    const toks = t.split(/\s+/);
    if (mode === 'board') for (const x of toks) res.board.push(x === 'NAN' ? null : parseFloat(x));
    else if (mode === 'h') for (const x of toks) res.h.push(x === 'NAN' ? null : parseFloat(x));
    else if (mode === 'v') for (const x of toks) res.v.push(x === 'NAN' ? null : parseFloat(x));
    else if (mode === 'owner') for (const x of toks) res.owner.push(x === 'NAN' ? null : parseFloat(x));
  }
  return res;
}
const top = (arr, n, tag) => arr.map((p, i) => ({ p, i })).filter((x) => x.p != null && Number.isFinite(x.p))
  .sort((a, b) => b.p - a.p).slice(0, n)
  .map((x) => `${tag === 'board' ? `${Math.floor(x.i / SIZE)},${x.i % SIZE}` : x.i}=`
    + (tag === 'board' ? x.p.toFixed(4) : x.p.toExponential(3))).join(' ');
// 易位槽位用指數表示：這裡的「0.0000」與「1e-4」差 10-100 倍，是判斷引擎好壞的關鍵，不能只看小數第四位

(async () => {
  const s = await acquireKatagoSession(GAME, { boardSize: SIZE });
  const ask = async (cmd) => { try { return brief(await s.command(cmd)); } catch (e) { return 'ERR ' + (e && e.message ? e.message : e); } };
  const rawAsk = async (cmd) => { try { return String(await s.command(cmd)); } catch (e) { return 'ERR ' + (e && e.message ? e.message : e); } };
  log(`gameId = ${GAME}`);
  log(`version = ${await ask('version')}`);
  log(`kata-get-models = ${await ask('kata-get-models')}`);
  log(`kata-get-param maxVisits = ${await ask('kata-get-param maxVisits')}`);
  log(`kata-set-param nnRandomize false = ${await ask('kata-set-param nnRandomize false')}`);
  log(`kata-get-rules = ${await ask('kata-get-rules')}`);
  log(`kata-get-max-translocation-moves = ${await ask('kata-get-max-translocation-moves')}`);
  // 權重圍棋：回讀引擎手上這一局的每點權重（n / 是否全相等 / 最大權重點）。
  // 全相等＝等於沒設權重（正按普通圍棋下）；n 不對或最大值位置不對＝權重沒送到或送錯。
  const wsum = (txt) => {
    const v = String(txt).trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (!v.length) return '(空/不支援)';
    const am = v.indexOf(Math.max(...v));
    return `n=${v.length} 全相等=${new Set(v.map((x) => x.toFixed(6))).size === 1} 最大在#${am}`;
  };
  log(`kata-get-weights = ${wsum(await rawAsk('kata-get-weights'))}`);

  await s.setupGame({ boardSize: SIZE, komi: KOMI, gameId: GAME, board: null, moveCount: MOVES.length,
    initialBoard: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)), replayHistory: MOVES, maxTranslocationMoves: MAXX });
  log(`quota（setupGame 之後）= ${await ask('kata-get-max-translocation-moves')}`);
  const rawShow = await rawAsk('showboard');
  const rulesLine = (rawShow.match(/^Rules:.*$/m) || [''])[0];
  const pb = typeof s.probeBoard === 'function' ? await s.probeBoard(SIZE, SIZE).catch(() => null) : null;
  log(`局面 = 前 30 手（紀錄 025814）`);
  log(`showboard ${rulesLine}`);
  log(`probeBoard = nextPlayer=${pb && pb.nextPlayer} moveNum=${pb && pb.moveNum} 盤上子數=${pb ? pb.stones.flat().filter((x) => x).length : '?'}`);
  // 每次前推都會抽一個隨機對稱（cfg nnRandomize=true 且無法用 kata-set-param 關掉），
  // 所以同一局面跑三次：三次之間的差異 = 對稱噪音；與本機基準的差異若遠大於噪音，才是引擎不同。
  for (let i = 1; i <= 3; i++) {
    const nn = parseNn(await rawAsk('kata-raw-nn all'));
    log(`--- 第 ${i} 次 kata-raw-nn all（共 ${nn.board.length} 點）：policyPass=${nn.pass}`);
    log(`    policy 前5 = ${top(nn.board, 5, 'board')}`);
    log(`    policyTranslocH 前3 = ${top(nn.h, 3, 'h')}（共 ${nn.h.length} 格）`);
    log(`    policyTranslocV 前3 = ${top(nn.v, 3, 'v')}（共 ${nn.v.length} 格）`);
  }
  releaseKatagoSession(s);
  process.exit(0);
})().catch((e) => { log('FAILED ' + (e && e.stack || e)); process.exit(1); });
