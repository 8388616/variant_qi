"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("./qi-accounts");
const { qiMatchTimeControl, qiForcedFriendlyMatch } = require("./common");
const ratings = require('./qi-ratings');
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
        record.winner_slot = null;
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
    if (room.gameLogic.computerSlot === slot) {
      out[slot] = { ...ratings.computerIdentity(room.gameLogic.aiLevel), role: role(room.gameLogic, slot) };
      continue;
    }
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
  const subGameId = room._qiRatingSubGameId || room._match?.data.sub_game_id || room.gameLogic.subGameId || room.gameType;
  for (const slot of ['player1', 'player2']) {
    if (!out[slot]) continue;
    const rating = ratings.gameRatingForRoom(out[slot].id, subGameId, room);
    out[slot] = { ...out[slot], rating: rating.rating, rank: rating.rank };
  }
  return out;
}
// 空座保留最后一位棋手的署名；重新落座（包括匿名棋手）则替换旧署名。
function syncMatchPlayers(room, client) {
  const match = room._match;
  if (!match) return;
  const current = identities(room);
  let changed = false;
  for (const slot of ['player1', 'player2']) {
    const seat = room.getPlayerBySlot(slot);
    if (client && seat !== client && seat?.localPlay?.client !== client) continue;
    const next = current[slot];
    const previous = match.players[slot];
    if (!next || (previous && previous.id === next.id && previous.username === next.username && previous.role === next.role)) continue;
    match.players[slot] = next;
    if (match.data.status === 'in_progress') {
      match.data[slot + '_id'] = next.id;
      match.data[slot + '_username'] = next.username;
      match.data[slot + '_role'] = next.role;
      changed = true;
    }
  }
  if (changed) enqueue(match.data);
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
      await ratings.writeMatch(pool, record);
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
  syncMatchPlayers(room);
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
    const subGameId = logic.getState?.()?.subGameId || room._qiRatingSubGameId || logic.subGameId || room.gameType;
    room._match = {
      players,
      data: {
        id: crypto.randomUUID(),
        room_id: room.roomId,
        game_type: room.gameType,
        sub_game_id: subGameId,
        is_friendly: logic.friendlyMatch === true || qiForcedFriendlyMatch(logic),
        is_local: !!room.localPlay,
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
        winner_slot: null,
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
    data.winner_slot = ['player1', 'player2', 'draw'].includes(winner) ? winner : null;
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
    data.winner_slot = null;
    enqueue(data);
    void flush();
  }
}
function install(room) {
  const logic = room.gameLogic;
  room._qiRatingSubGameId = logic.getState?.()?.subGameId || room.gameType;
  room._qiNotifyRatingUpdate = () => room.broadcast({ type: 'playerIdentities', playerIdentities: identities(room) });
  const broadcast = room.broadcast.bind(room);
  room.broadcast = (data, exclude) => {
    if (data.subGameId) room._qiRatingSubGameId = data.subGameId;
    if (data.type === 'editBoardAccepted' && !logic._qiApplyingHandicap) {
      logic._qiOpeningEdited = true;
      logic.friendlyMatch = true;
    }
    if (room._recordImporting && data.type === "importSuccess")
      room._importSucceeded = true;
    try { inspect(room, data); } catch (e) { console.error("[matches] 读取棋局失败:", e.message); }
    broadcast({ ...data, openingEdited: !!logic._qiOpeningEdited,
      forcedFriendlyMatch: qiForcedFriendlyMatch(logic),
      friendlyMatch: logic.friendlyMatch === true || qiForcedFriendlyMatch(logic),
      playerIdentities: identities(room) }, exclude);
  };
  if (logic.exportRecord) {
    const original = logic.exportRecord.bind(logic);
    logic.exportRecord = (...args) => {
      const record = original(...args);
      syncMatchPlayers(room);
      const players = identities(room);
      return {
        ...record,
        players: room.recordTree?.record?.players ||
          room._importedPlayers || {
            ...(record.players || {}),
            player1:
              players.player1 ? players.player1.username : record.players?.player1 || null,
            player2:
              players.player2 ? players.player2.username : record.players?.player2 || null,
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
  syncMatchPlayers(room, client);
}
module.exports = { install, inspect, close, identities, flush, refreshIdentity };
