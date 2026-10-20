"use strict";
const crypto = require("crypto");
const argon2 = require("argon2");
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");
const svgCaptcha = require("svg-captcha");
const challenges = new Map();
const COOKIE = "qi_session";
const TTL = 30 * 86400000;
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      query_timeout: 10000,
    })
  : null;
if (pool)
  pool.on("error", (e) =>
    console.error("[accounts] 数据库连接错误:", e.message),
  );
const sockets = new Map();
const socketTickets = new Map();
const revokedSessions = new Map();
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
function cookieToken(req) {
  const item = String(req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="));
  const token = item && item.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const configured = (process.env.AUTH_ORIGINS || "")
      .split(",")
      .filter(Boolean);
    return configured.length
      ? configured.includes(u.origin)
      : u.host === req.headers.host && ["https:", "http:"].includes(u.protocol);
  } catch (_) {
    return false;
  }
}
async function session(req) {
  const token = cookieToken(req);
  if (!pool || !token) return null;
  return sessionByHash(hashToken(token));
}
async function sessionByHash(hash) {
  const result = await pool.query(
    "SELECT s.token_hash,s.expires_at,u.id,u.username FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.id NOT IN (9001,9002,9003)",
    [hash],
  );
  const row = result.rows[0];
  return row
    ? {
        user: { id: row.id, username: row.username },
        tokenHash: row.token_hash,
        expiresAt: new Date(row.expires_at).getTime(),
      }
    : null;
}
function bindSocket(ws, auth) {
  if (!auth) return false;
  if (revokedSessions.has(auth.tokenHash)) {
    ws.close(1008, "登入已失效，请重新进入房间");
    return false;
  }
  if (ws.auth) {
    const previous = sockets.get(ws.auth.tokenHash);
    if (previous) {
      previous.delete(ws);
      if (!previous.size) sockets.delete(ws.auth.tokenHash);
    }
  }
  ws.auth = auth;
  if (!sockets.has(auth.tokenHash)) sockets.set(auth.tokenHash, new Set());
  sockets.get(auth.tokenHash).add(ws);
  if (ws._qiAuthCleanupRegistered) return true;
  ws._qiAuthCleanupRegistered = true;
  ws.once("close", () => {
    const hash = ws.auth && ws.auth.tokenHash;
    const set = sockets.get(hash);
    if (set) {
      set.delete(ws);
      if (!set.size) sockets.delete(hash);
    }
  });
  return true;
}
function revoke(hash) {
  for (const [token, expiresAt] of revokedSessions) if (expiresAt <= Date.now()) revokedSessions.delete(token);
  // 防止登出时尚未完成的会话查询把连接重新绑定到已撤销的会话。
  revokedSessions.set(hash, Date.now() + 60000);
  for (const [ticket, item] of socketTickets) if (item.tokenHash === hash) socketTickets.delete(ticket);
  const set = sockets.get(hash);
  if (set) for (const ws of set) ws.close(1008, "登入已失效，请重新进入房间");
}
async function socketTicket(ticket) {
  const item = typeof ticket === 'string' ? socketTickets.get(ticket) : null;
  if (!item) return null;
  socketTickets.delete(ticket);
  if (item.expiresAt <= Date.now() || revokedSessions.has(item.tokenHash)) return null;
  const auth = await sessionByHash(item.tokenHash);
  return revokedSessions.has(item.tokenHash) ? null : auth;
}
let hashing = 0;
async function passwordWork(fn) {
  if (hashing >= 2) {
    const e = new Error("服务器繁忙，请稍后重试。");
    e.status = 503;
    throw e;
  }
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
  }
}
const hashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const dummyHash = argon2.hash(crypto.randomBytes(32), hashOptions);
function credentials(body) {
  const username =
    typeof body.username === "string"
      ? body.username.normalize("NFC").trim()
      : "";
  const password = body.password;
  if (
    [...username].length < 2 ||
    [...username].length > 16 ||
    /[\p{C}\p{Z}<>]/u.test(username)
  )
    throw new Error("用户名须为2–16个字符，不能包含空白、控制字符或尖括号。");
  if (
    typeof password !== "string" ||
    [...password].length < 6 ||
    [...password].length > 256
  )
    throw new Error("密码须为6–256个字符。");
  return { username, password };
}
async function captcha(req, action) {
  const id = req.body.captchaId;
  const challenge = typeof id === "string" ? challenges.get(id) : null;
  if (challenge) challenges.delete(id);
  const answer =
    typeof req.body.captchaAnswer === "string"
      ? req.body.captchaAnswer.trim().toUpperCase()
      : "";
  if (
    !challenge ||
    challenge.expires <= Date.now() ||
    challenge.ip !== req.ip ||
    challenge.action !== action ||
    answer.length !== 5 ||
    !crypto.timingSafeEqual(
      Buffer.from(hashToken(answer)),
      Buffer.from(challenge.hash),
    )
  )
    throw new Error("验证码错误或已过期，请重新输入。");
}
function mount(app) {
  app.use("/qi/auth", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/qi/auth/config", (_req, res) => res.json({ enabled: !!pool }));
  app.get(
    "/qi/auth/captcha",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "验证码请求过于频繁。" },
    }),
    (req, res) => {
      if (!["login", "register"].includes(req.query.action))
        return res.status(400).json({ error: "验证类型无效。" });
      for (const [id, item] of challenges)
        if (item.expires <= Date.now()) challenges.delete(id);
      if (challenges.size >= 5000)
        return res.status(503).json({ error: "服务器繁忙，请稍后重试。" });
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const text = Array.from(
        { length: 5 },
        () => chars[crypto.randomInt(chars.length)],
      ).join("");
      const id = crypto.randomBytes(24).toString("hex");
      challenges.set(id, {
        hash: hashToken(text),
        ip: req.ip,
        action: req.query.action,
        expires: Date.now() + 300000,
      });
      res.json({
        id,
        image:
          "data:image/svg+xml;base64," +
          Buffer.from(
            svgCaptcha(text, {
              width: 180,
              height: 60,
              fontSize: 44,
              noise: 4,
              background: "#faf3e6",
            }),
          ).toString("base64"),
      });
    },
  );
  app.get("/qi/auth/me", async (req, res) => {
    try {
      const s = await session(req);
      res.json({ user: s ? s.user : null });
    } catch (_) {
      res.status(503).json({ error: "账号服务暂时不可用。" });
    }
  });
  app.get('/qi/auth/ratings', async (req, res) => {
    try {
      const auth = await session(req);
      if (!auth) return res.status(401).json({ error: '请先登入。' });
      res.json(await require('./qi-ratings').readUserRatings(auth.user.id));
    } catch (_) { res.status(503).json({ error: '等级分暂时不可用。' }); }
  });
  app.use("/qi/auth", (req, res, next) => {
    if (req.method !== "POST") return next();
    if (!originAllowed(req))
      return res.status(403).json({ error: "请求来源无效。" });
    if (!pool) return res.status(503).json({ error: "账号服务尚未配置。" });
    next();
  });
  const limiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "尝试过于频繁，请稍后重试。" },
  });
  app.post('/qi/auth/socket-ticket', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '请求过于频繁。' } }), async (req, res) => {
    try {
      const auth = await session(req);
      if (!auth) return res.status(401).json({ error: '请先登入。' });
      for (const [ticket, item] of socketTickets) if (item.expiresAt <= Date.now()) socketTickets.delete(ticket);
      if (socketTickets.size >= 5000) return res.status(503).json({ error: '服务器繁忙，请稍后重试。' });
      const ticket = crypto.randomBytes(32).toString('hex');
      socketTickets.set(ticket, { tokenHash: auth.tokenHash, expiresAt: Date.now() + 30000 });
      res.json({ ticket });
    } catch (_) { res.status(503).json({ error: '账号服务暂时不可用。' }); }
  });
  function setCookie(res, token, req) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: process.env.AUTH_COOKIE_SECURE !== "false",
      sameSite: "lax",
      path: "/",
      maxAge: TTL,
    });
  }
  for (const action of ["register", "login"])
    app.post("/qi/auth/" + action, limiter, async (req, res) => {
      try {
        const { username, password } = credentials(req.body || {});
        await captcha(req, action);
        let user;
        if (action === "register") {
          if (['电脑(新手)', '电脑(初级)', '电脑(中级)'].includes(username))
            return res.status(409).json({ error: '用户名已被使用。' });
          if (req.body.qq != null && typeof req.body.qq !== "string") throw new Error("QQ号格式无效。");
          const qq =
            req.body.qq == null || req.body.qq === ""
              ? null
              : String(req.body.qq).trim();
          if (
            qq &&
            (qq.length > 254 ||
              !/^(?:[0-9]{5,20}|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(qq))
          )
            throw new Error("请输入有效的QQ号或邮箱格式的QQ账号。");
          const passwordHash = await passwordWork(() =>
            argon2.hash(password, hashOptions),
          );
          const result = await pool.query(
            "INSERT INTO users(username,password_hash,qq) VALUES($1,$2,$3) RETURNING id,username",
            [username, passwordHash, qq],
          );
          user = result.rows[0];
        } else {
          const result = await pool.query(
            "SELECT id,username,password_hash FROM users WHERE username=$1 AND id NOT IN (9001,9002,9003)",
            [username],
          );
          const row = result.rows[0];
          const valid = await passwordWork(async () =>
            argon2.verify(row ? row.password_hash : await dummyHash, password),
          );
          if (!row || !valid) {
            res.status(401).json({ error: "用户名或密码错误。" });
            return;
          }
          user = { id: row.id, username: row.username };
        }
        const token = crypto.randomBytes(32).toString("hex");
        await pool.query(
          "INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
          [hashToken(token), user.id, new Date(Date.now() + TTL)],
        );
        const previous = cookieToken(req);
        if (previous) {
          await pool.query("DELETE FROM user_sessions WHERE token_hash=$1", [
            hashToken(previous),
          ]);
          revoke(hashToken(previous));
        }
        setCookie(res, token, req);
        res.json({ user });
      } catch (e) {
        if (e.code === "23505")
          return res.status(409).json({ error: "用户名已被使用。" });
        const publicError =
          !e.code &&
          !(e instanceof TypeError) &&
          !["AbortError", "TimeoutError"].includes(e.name);
        if (!publicError) console.error("[accounts]", e.message);
        res
          .status(e.status || (publicError ? 400 : 503))
          .json({
            error: publicError ? e.message : "账号服务暂时不可用，请稍后重试。",
          });
      }
    });
  app.post("/qi/auth/logout", async (req, res) => {
    try {
      const token = cookieToken(req);
      if (token) {
        const hash = hashToken(token);
        await pool.query("DELETE FROM user_sessions WHERE token_hash=$1", [
          hash,
        ]);
        revoke(hash);
      }
      res.clearCookie(COOKIE, {
        path: "/",
        httpOnly: true,
        secure: process.env.AUTH_COOKIE_SECURE !== "false",
        sameSite: "lax",
      });
      res.json({ success: true });
    } catch (_) {
      res.status(503).json({ error: "登出失败，请稍后重试。" });
    }
  });
}
if (pool) {
  setInterval(async () => {
    try {
      await pool.query("DELETE FROM user_sessions WHERE expires_at <= now()");
      if (sockets.size) {
        const active = await pool.query(
          "SELECT token_hash FROM user_sessions WHERE token_hash=ANY($1::text[]) AND expires_at>now()",
          [[...sockets.keys()]],
        );
        const hashes = new Set(active.rows.map((r) => r.token_hash));
        for (const hash of sockets.keys()) if (!hashes.has(hash)) revoke(hash);
      }
    } catch (e) {
      console.error("[accounts] 会话维护失败:", e.message);
    }
  }, 60000).unref();
}
module.exports = {
  pool,
  mount,
  session,
  bindSocket,
  originAllowed,
  credentials,
  socketTicket,
};
