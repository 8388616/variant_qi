"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("./qi-accounts");
const { qiMatchTimeControl } = require("./common");
const pending = new Map();
const spoolPath = path.resolve(
  process.env.MATCH_RECORD_SPOOL ||
    path.join(__dirname, "data", "pending-matches.json"),
);
const bootTime = new Date();
let recovered = false;
try {
  if (fs.existsSync(spoolPath))
    for (const record of JSON.parse(fs.readFileSync(spoolPath, "utf8"))) {
      if (record.status === "in_progress") {
        record.status = "abandoned";
        record.ended_at = bootTime;
        record.winner_id = null;
        record.winner_role = null;
      }
      pending.set(record.id, record);
    }
} catch (e) {
  console.error("[matches] 恢复待写记录失败:", e.message);
}
let writing = false;
function role(logic, slot) {
  const label =
    typeof logic.getChatSideLabel === "function"
      ? logic.getChatSideLabel(slot)
      : slot === "player1"
        ? "黑方"
        : "白方";
  for (const [cn, en] of [
    ["黑", "black"],
    ["白", "white"],
    ["红", "red"],
    ["蓝", "blue"],
    ["绿", "green"],
    ["黄", "yellow"],
  ])
    if (String(label).includes(cn)) return en;
  return slot;
}
function identities(room) {
  const out = {};
  for (const slot of ["player1", "player2"]) {
    const client = room.getPlayerBySlot(slot);
    const user =
      (client && client.auth && client.auth.user) ||
      (client &&
        client.localPlay &&
        client.localPlay.client &&
        client.localPlay.client.auth &&
        client.localPlay.client.auth.user);
    if (client)
      out[slot] = {
        id: user ? user.id : null,
        username: user ? user.username : null,
        role: role(room.gameLogic, slot),
      };
    else if (room._match && room._match.players[slot])
      out[slot] = room._match.players[slot];
  }
  return out;
}
function enqueue(record) {
  if (!pool) return;
  pending.set(record.id, { ...record });
  if (pending.size > 10000) {
    console.error("[matches] 待写入记录超过10000，数据库需要检查");
  }
}
async function flush() {
  if (!pool || writing || (!pending.size && recovered)) return;
  writing = true;
  try {
    await fs.promises.mkdir(path.dirname(spoolPath), { recursive: true });
    await fs.promises.writeFile(
      spoolPath + ".tmp",
      JSON.stringify([...pending.values()]),
      { mode: 0o600 },
    );
    await fs.promises.rename(spoolPath + ".tmp", spoolPath);
    if (!recovered) {
      await pool.query(
        "UPDATE match_records SET status='abandoned',ended_at=$1,winner_id=NULL,winner_role=NULL WHERE status='in_progress' AND started_at<$1",
        [bootTime],
      );
      recovered = true;
    }
    for (const [id, record] of [...pending].slice(0, 100)) {
      const keys = Object.keys(record);
      const update = keys
        .filter((k) => k !== "id")
        .map((k) => `${k}=EXCLUDED.${k}`)
        .join(",");
      await pool.query(
        `INSERT INTO match_records(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(id) DO UPDATE SET ${update}`,
        keys.map((k) => record[k]),
      );
      if (pending.get(id) === record) pending.delete(id);
    }
    await fs.promises.writeFile(
      spoolPath + ".tmp",
      JSON.stringify([...pending.values()]),
      { mode: 0o600 },
    );
    await fs.promises.rename(spoolPath + ".tmp", spoolPath);
  } catch (e) {
    console.error("[matches] 写入失败，将重试:", e.message);
  } finally {
    writing = false;
  }
}
setInterval(flush, 5000).unref();
function inspect(room, event = {}) {
  if (!room.roomId || room.retired || room._recordImporting) return;
  const logic = room.gameLogic;
  // 此表描述双人棋局；多人排行榜游戏使用另一种结果结构。
  if (typeof logic.gameOver !== "boolean") return;
  const reset =
    ["newGameStarted", "roomReset"].includes(event.type) ||
    event.action === "newGameStarted";
  if (reset) {
    close(room);
    room._match = null;
    room._accountImported = false;
  }
  if (room._accountImported || room.recordTree) return;
  const moves =
    typeof logic.getMoveCount === "function"
      ? Number(logic.getMoveCount())
      : (logic.moveHistory || []).length;
  const started = logic.matchStarted || moves > 0 || logic.phase === "playing";
  if (!room._match && started) {
    const players = identities(room);
    const settings = logic.tcSettings || {};
    room._match = {
      players,
      data: {
        id: crypto.randomUUID(),
        room_id: room.roomId,
        game_type: room.gameType,
        player1_id: players.player1?.id || null,
        player2_id: players.player2?.id || null,
        player1_username: players.player1?.username || null,
        player2_username: players.player2?.username || null,
        player1_role: role(logic, "player1"),
        player2_role: role(logic, "player2"),
        base_time_seconds: settings.timed ? settings.mainMinutes * 60 : null,
        move_time_seconds: settings.timed ? settings.byoyomiSeconds : null,
        overtime_moves: settings.timed ? settings.maxTimeouts : null,
        handicap: /weiqi|go/.test(room.gameType)
          ? String(logic.handicap || 0)
          : null,
        total_moves: 0,
        started_at: new Date(),
        ended_at: null,
        player1_time_ms: settings.timed ? 0 : null,
        player2_time_ms: settings.timed ? 0 : null,
        winner_id: null,
        winner_role: null,
        status: "in_progress",
      },
    };
  }
  const match = room._match;
  if (!match || match.data.status !== "in_progress") return;
  const data = match.data;
  data.total_moves = Math.max(0, Number.isFinite(moves) ? moves : 0);
  let clock = logic.tcClock;
  if (clock && clock.timed) {
    clock = {
      ...clock,
      player1: { ...clock.player1 },
      player2: { ...clock.player2 },
    };
    qiMatchTimeControl.drain(clock, Date.now());
  }
  for (const slot of ["player1", "player2"])
    if (data.base_time_seconds != null)
      data[slot + "_time_ms"] = Math.round(clock?.[slot]?.spentMs || 0);
  if (logic.gameOver) {
    const winner = logic.winner;
    data.status = "finished";
    data.ended_at = new Date();
    data.winner_id =
      winner === "draw" ? "-1" : match.players[winner]?.id || null;
    data.winner_role =
      winner === "draw"
        ? null
        : ["player1", "player2"].includes(winner)
          ? role(logic, winner)
          : null;
  }
  enqueue(data);
  if (data.status === "finished") void flush();
}
function close(room) {
  const data = room._match && room._match.data;
  if (data && data.status === "in_progress") {
    data.status = "abandoned";
    data.ended_at = new Date();
    data.winner_id = null;
    data.winner_role = null;
    enqueue(data);
    void flush();
  }
}
function install(room) {
  const logic = room.gameLogic;
  const broadcast = room.broadcast.bind(room);
  room.broadcast = (data, exclude) => {
    if (room._recordImporting && data.type === "importSuccess")
      room._importSucceeded = true;
    try { inspect(room, data); } catch (e) { console.error("[matches] 读取棋局失败:", e.message); }
    broadcast({ ...data, playerIdentities: identities(room) }, exclude);
  };
  if (logic.exportRecord) {
    const original = logic.exportRecord.bind(logic);
    logic.exportRecord = (...args) => {
      const record = original(...args);
      const players = room._match?.players || identities(room);
      return {
        ...record,
        players: room.recordTree?.record?.players ||
          room._importedPlayers || {
            ...(record.players || {}),
            player1:
              players.player1?.username || record.players?.player1 || null,
            player2:
              players.player2?.username || record.players?.player2 || null,
          },
      };
    };
  }
  if (logic.importRecord) {
    const original = logic.importRecord.bind(logic);
    logic.importRecord = (...args) => {
      room._recordImporting = true;
      room._importSucceeded = false;
      try {
        const result = original(...args);
        if (room._importSucceeded) {
          close(room);
          room._accountImported = !!(
            (args[0]?.moves || []).length || args[0]?.result
          );
          room._importedPlayers = (args[0] && args[0].players) || null;
        }
        return result;
      } finally {
        room._recordImporting = false;
      }
    };
  }
  for (const method of ["resetGame", "resetToEmpty"])
    if (typeof logic[method] === "function") {
      const original = logic[method].bind(logic);
      logic[method] = (...args) => {
        close(room);
        room._match = null;
        room._accountImported = false;
        room._importedPlayers = null;
        return original(...args);
      };
    }
}
function refreshIdentity(room, client) {
  const match = room._match;
  if (!match || match.data.status !== 'in_progress') return;
  const current = identities(room);
  for (const slot of ['player1', 'player2']) {
    const seat = room.getPlayerBySlot(slot);
    if (seat !== client && seat?.localPlay?.client !== client) continue;
    if (match.players[slot]?.id || !current[slot]?.id) continue;
    match.players[slot] = current[slot];
    match.data[slot + '_id'] = current[slot].id;
    match.data[slot + '_username'] = current[slot].username;
  }
  enqueue(match.data);
}
module.exports = { install, inspect, close, identities, flush, refreshIdentity };
