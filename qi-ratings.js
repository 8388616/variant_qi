'use strict';

const { pool } = require('./qi-accounts');
const gameCatalog = require('./public/game-catalog');
const gameRatings = new Map();
const GAME_RATING_TTL = 60000;
const defaultGameRating = () => ({ rating: 1500, rank: '1k' });

function notifyRatingRooms(entry, rooms) {
    for (const ref of entry.rooms) {
        const room = ref.deref();
        if (room && !room.retired) rooms.add(room);
        else entry.rooms.delete(ref);
    }
}
function publishGameRatings(update) {
    if (!update) return;
    const rooms = new Set();
    update.ids.forEach((id, i) => {
        const entry = gameRatings.get(`${id}:${update.subGameId}`);
        if (!entry) return;
        entry.version++;
        entry.value = { rating: update.ratings[i], rank: rankOf(update.ratings[i]) };
        entry.expires = Date.now() + GAME_RATING_TTL;
        notifyRatingRooms(entry, rooms);
    });
    for (const room of rooms) {
        try { room._qiNotifyRatingUpdate?.(); }
        catch (error) { console.warn('[ratings] 通知段位更新失败:', error.message); }
    }
}
function gameRatingForRoom(userId, subGameId, room) {
    if (!userId || !pool) return defaultGameRating();
    const key = `${userId}:${subGameId}`;
    let entry = gameRatings.get(key);
    if (!entry) {
        if (gameRatings.size >= 5000) gameRatings.delete(gameRatings.keys().next().value);
        entry = { value: defaultGameRating(), expires: 0, version: 0, rooms: new Set(), pending: null };
        gameRatings.set(key, entry);
    }
    // 缓存只弱引用房间，销毁房间后不保留连接或整个棋盘。
    room._qiRatingRefs ||= new WeakMap();
    if (!room._qiRatingRefs.has(entry)) {
        const ref = new WeakRef(room);
        room._qiRatingRefs.set(entry, ref);
        entry.rooms.add(ref);
    }
    if (entry.expires <= Date.now() && !entry.pending) {
        const version = entry.version;
        entry.pending = pool.query('SELECT rating FROM user_game_ratings WHERE user_id=$1 AND sub_game_id=$2', [userId, subGameId])
            .then(result => {
                if (version !== entry.version) return;
                const rating = result.rows[0] ? Number(result.rows[0].rating) : 1500;
                const changed = rating !== entry.value.rating;
                entry.value = { rating, rank: rankOf(rating) };
                entry.expires = Date.now() + GAME_RATING_TTL;
                if (changed) {
                    const rooms = new Set(); notifyRatingRooms(entry, rooms);
                    for (const target of rooms) {
                        try { target._qiNotifyRatingUpdate?.(); }
                        catch (error) { console.warn('[ratings] 通知段位更新失败:', error.message); }
                    }
                }
            }).catch(error => {
                entry.expires = Date.now() + 10000;
                console.warn('[ratings] 读取棋类段位失败:', error.message);
            }).finally(() => { entry.pending = null; });
    }
    return entry.value;
}
const COMPUTER_NAMES = Object.freeze({ novice: '电脑(新手)', basic: '电脑(初级)', intermediate: '电脑(中级)' });
const COMPUTER_INITIAL = Object.freeze({ novice: 1000, basic: 1200, intermediate: 1500 });
const COMPUTER_IDS = Object.freeze({ novice: 9001, basic: 9002, intermediate: 9003 });
const MATCH_COLUMNS = new Set([
    'id', 'room_id', 'game_type', 'sub_game_id', 'player1_id', 'player2_id',
    'player1_username', 'player2_username', 'player1_role', 'player2_role',
    'base_time_seconds', 'move_time_seconds', 'overtime_moves', 'handicap', 'total_moves',
    'started_at', 'ended_at', 'player1_time_ms', 'player2_time_ms', 'winner_id', 'winner_role', 'status',
    'is_friendly', 'is_local', 'winner_slot'
]);

function computerIdentity(level) {
    const selected = Object.hasOwn(COMPUTER_NAMES, level) ? level : 'basic';
    return { id: COMPUTER_IDS[selected], username: COMPUTER_NAMES[selected] };
}
function rankOf(rating) {
    const band = Math.floor((Number(rating) + 50) / 100);
    return band >= 16 ? `${band - 15}d` : `${16 - band}k`;
}
function initialRating(userId) {
    const level = Object.keys(COMPUTER_IDS).find(key => String(COMPUTER_IDS[key]) === String(userId));
    return level ? COMPUTER_INITIAL[level] : 1500;
}

function kFactor(row) {
    if (Number(row.rated_games) < 30) return 40;
    return Number(row.highest_rating) >= 2400 ? 10 : 20;
}
function eloPair(player1, player2, score) {
    const r1 = Number(player1.rating), r2 = Number(player2.rating);
    const expected = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
    const round = value => Math.round(value * 10000) / 10000;
    const delta1 = round(kFactor(player1) * (score - expected));
    const delta2 = round(kFactor(player2) * (expected - score));
    return { ratings: [round(r1 + delta1), round(r2 + delta2)], changes: [delta1, delta2] };
}

async function settleRatings(client, match) {
    if (match.status !== 'finished' || match.rating_settled_at || match.is_friendly || match.is_local
        || !['player1', 'player2', 'draw'].includes(match.winner_slot) || !match.sub_game_id) return;
    const ids = [match.player1_id, match.player2_id];
    // 玩家 ID 来自已验证的登入身份；电脑 ID 由服务器棋力档位映射。
    const initial = ids.map(initialRating);
    if (!ids[0] || !ids[1] || String(ids[0]) === String(ids[1])) return;
    // 固定 ID 顺序锁定总分再锁棋类分，避免并发对局覆盖分数或产生相反锁顺序。
    const order = [0, 1].sort((a, b) => BigInt(ids[a]) < BigInt(ids[b]) ? -1 : 1);
    const overall = [], game = [];
    for (const i of order) {
        await client.query('INSERT INTO user_ratings(user_id,rating,highest_rating) VALUES($1,$2,$2) ON CONFLICT(user_id) DO NOTHING', [ids[i], initial[i]]);
        overall[i] = (await client.query('SELECT * FROM user_ratings WHERE user_id=$1 FOR UPDATE', [ids[i]])).rows[0];
    }
    for (const i of order) {
        await client.query('INSERT INTO user_game_ratings(user_id,sub_game_id,rating,highest_rating) VALUES($1,$2,$3,$3) ON CONFLICT(user_id,sub_game_id) DO NOTHING', [ids[i], match.sub_game_id, initial[i]]);
        game[i] = (await client.query('SELECT * FROM user_game_ratings WHERE user_id=$1 AND sub_game_id=$2 FOR UPDATE', [ids[i], match.sub_game_id])).rows[0];
    }
    const score = match.winner_slot === 'draw' ? 0.5 : match.winner_slot === 'player1' ? 1 : 0;
    const totalChange = eloPair(overall[0], overall[1], score);
    const gameChange = eloPair(game[0], game[1], score);
    for (const i of order) {
        await client.query('UPDATE user_ratings SET rating=$2,rated_games=rated_games+1,highest_rating=GREATEST(highest_rating,$2),updated_at=now() WHERE user_id=$1', [ids[i], totalChange.ratings[i]]);
        await client.query('UPDATE user_game_ratings SET rating=$3,rated_games=rated_games+1,highest_rating=GREATEST(highest_rating,$3),updated_at=now() WHERE user_id=$1 AND sub_game_id=$2', [ids[i], match.sub_game_id, gameChange.ratings[i]]);
    }
    await client.query(`UPDATE match_records SET rating_settled_at=now(),player1_id=$2,player2_id=$3,
        winner_id=$4,player1_rating_change=$5,player2_rating_change=$6,
        player1_game_rating_change=$7,player2_game_rating_change=$8 WHERE id=$1`,
    [match.id, ids[0], ids[1], score === 0.5 ? '-1' : ids[score === 1 ? 0 : 1],
        ...totalChange.changes, ...gameChange.changes]);
    return { ids, subGameId: match.sub_game_id, ratings: gameChange.ratings };
}

// 对局和两个评分维度一起提交；崩溃后的落盘重试由 match_records 的结算标记防重。
async function writeMatch(database, record) {
    const client = await database.connect();
    try {
        await client.query('BEGIN');
        const keys = Object.keys(record).filter(key => MATCH_COLUMNS.has(key));
        const update = keys.filter(key => key !== 'id').map(key => `${key}=EXCLUDED.${key}`).join(',');
        await client.query(`INSERT INTO match_records(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})
            ON CONFLICT(id) DO UPDATE SET ${update} WHERE match_records.status='in_progress'`, keys.map(key => record[key]));
        const result = await client.query('SELECT * FROM match_records WHERE id=$1 FOR UPDATE', [record.id]);
        const ratingUpdate = await settleRatings(client, result.rows[0]);
        await client.query('COMMIT');
        publishGameRatings(ratingUpdate);
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* 保留原错误 */ }
        throw error;
    } finally { client.release(); }
}

async function readUserRatings(userId) {
    const [overall, games] = await Promise.all([
        pool.query('SELECT rating,rated_games,highest_rating,updated_at FROM user_ratings WHERE user_id=$1', [userId]),
        pool.query('SELECT sub_game_id,rating,rated_games,highest_rating,updated_at FROM user_game_ratings WHERE user_id=$1 ORDER BY rating DESC,sub_game_id', [userId])
    ]);
    const format = row => ({ ...row, rating: Number(row.rating), highest_rating: Number(row.highest_rating), rank: rankOf(row.rating) });
    const initial = initialRating(userId);
    return {
        overall: overall.rows[0] ? format(overall.rows[0]) : {
            rating: initial, highest_rating: initial, rated_games: 0, updated_at: null, rank: rankOf(initial)
        },
        games: games.rows.map(row => ({ ...format(row), game_name: gameCatalog.getGameName(row.sub_game_id) }))
    };
}

module.exports = { computerIdentity, eloPair, kFactor, rankOf, writeMatch, readUserRatings, gameRatingForRoom };
