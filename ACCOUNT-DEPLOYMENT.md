# 账号功能部署

## 1. 更新代码和依赖

上传 `qi-server.js`、`qi-accounts.js`、`qi-match-records.js`、`common.js`、`package.json`、`package-lock.json`、`public/qi.html`、`public/room.html`、`public/auth-client.js`、`public/login.html`、`public/login.js` 和 `public/login.css`。

账号入口的更新还需要上传 `public/auth-client.css`、`public/super-24.html` 和 `public/speed-minesweeper.html`。首页与房间页共用账号入口：点击登入时在当前标签页进入登入页面，成功后返回原首页或房间；登入后显示带下划线的用户名，左键点击展开登出菜单。返回地址仅允许本站首页或房间，避免外部跳转。如果在其他标签页登入，已有房间连接通过30秒有效、单次使用的票据，由服务器验证会话后更新身份；页面不读取或传递Cookie中的会话token。

在项目目录运行 `npm ci`。建议使用受支持的 Node.js 22 或 24。Argon2 使用原生模块，若服务器安装时没有匹配的预编译包，需要安装编译工具（Ubuntu/Debian：`sudo apt install build-essential python3`）。

## 2. 扩展现有数据库

数据库 `variantqi` 和此前的 `users` 表可以保留。把 `database/accounts.sql` 上传到服务器，然后运行：

```bash
sudo -u postgres psql -d variantqi -v ON_ERROR_STOP=1 < database/accounts.sql
```

脚本在一个事务内执行，支持重复执行；更新用户名长度约束、增加会话表和对局记录表，并给此前的 `variantqi_app` 账号授权。若应用使用的数据库角色不是 `variantqi_app`，先修改脚本中的授权对象。若旧用户名不符合2–16个字符，约束会拒绝安装，请先处理这些数据，不会自动截断用户名。

如果账号功能已经部署，仅更新用户名长度限制，可在项目目录执行：

```bash
sudo -u postgres psql -d variantqi -v ON_ERROR_STOP=1 < database/migrations/username-length-2-16.sql
pm2 restart qi-server.js
```

数据库用户名、密码只供服务器使用，不能写入 `public` 下的文件。应用角色不需要超级用户权限。PostgreSQL 建议只监听本机，不向公网开放5432端口。

如需让接下来的新用户 ID 从10001开始，上传 `database/migrations/user-id-start-10001.sql`，在项目目录执行：

```bash
sudo -u postgres psql -d variantqi -v ON_ERROR_STOP=1 < database/migrations/user-id-start-10001.sql
```

这项修改立即生效，无需重启 Node 或 PM2。已有用户 ID 和对局关联保持不变。如果已有 ID 或序列已超过10001，则从更大的下一个 ID 继续分配，避免重复和倒退；可以重复执行。执行时会短暂锁住用户表的写入，若5秒内无法取得锁则报错，可稍后重试。序列是自动编号，失败的注册也可能消耗编号，因此不保证 ID 连续。迁移使用事务性的 `ALTER SEQUENCE ... RESTART WITH`，参见 [PostgreSQL 文档](https://www.postgresql.org/docs/current/sql-altersequence.html)。

## 3. 设置环境变量

复制 `.env.example` 为项目根目录的 `.env`，填写真实数据库密码，并限制文件权限：

```bash
chmod 600 .env
```

```dotenv
DATABASE_URL=postgresql://variantqi_app:你的数据库密码@127.0.0.1:5432/variantqi
AUTH_ORIGINS=https://variantqi.com,https://maoshazhihe.com,https://159.75.75.218
AUTH_COOKIE_SECURE=true
```

密码含有 `@`、`:`、`#` 等字符时，需要在连接 URL 中对密码做百分号编码。`AUTH_ORIGINS` 必须写浏览器访问的完整 origin（协议、主机、非默认端口），不带路径或末尾斜杠。三个入口的账号共用数据库，但浏览器 Cookie 按主机独立，需要分别登入。

服务启动时会自动读取与 `qi-server.js` 同目录的 `.env`，无需添加 `--env-file`。读取发生在账号模块创建数据库连接之前，不受 PM2 当前工作目录影响。

这次更新增加了 `dotenv` 依赖。上传 `qi-server.js`、`package.json` 和 `package-lock.json` 后，在项目目录运行：

```bash
npm ci
pm2 restart qi-server.js
```

以后修改 `.env` 后，只需再次运行 `pm2 restart qi-server.js`。直接使用 Node 启动时运行 `node qi-server.js` 即可。不要再额外启动一个占用3100端口的进程。

进程中已有的环境变量优先于 `.env`（例如 PM2 或 systemd 显式配置的同名变量）；建议把账号配置统一放在 `.env`，避免两处配置不同。文件不存在时仍可使用进程环境变量；文件存在但不可读取时启动会报错，避免静默使用错误配置。

无需申请验证码密钥。图片验证码大小写不敏感，五分钟有效，提交一次即失效，并绑定请求IP及登入/注册用途。服务器重启会使尚未提交的验证码失效。没有数据库配置时账号服务会拒绝注册和登入，不会降级成不校验的模式。

## 4. Nginx 与 HTTPS

账号接口和 WebSocket 必须反向代理到同一 Node 实例，保留真实 Host，并设置以下请求头（沿用现有 `proxy_pass` 和 WebSocket 配置）：

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

当前 Node 只信任来自127.0.0.1的代理。若代理通过其他地址连接，需相应调整 `trust proxy`，不要直接信任任意客户端提供的代理头。80端口除 ACME 验证外应跳转到 HTTPS。`AUTH_COOKIE_SECURE=false` 仅用于本机 HTTP 测试。

## 5. 会话、安全和对局记录

- 密码使用 Argon2id 哈希，允许6–256个Unicode字符，包括纯数字；密码不会去空白或截断。用户名按Unicode字符计数，先去两端空白并规范化为NFC，限制2–16个字符，不允许空白、控制字符和尖括号。用户名区分大小写，数据库唯一约束负责处理并发注册。
- 登入成功会生成随机 token。浏览器通过30天有效的 HttpOnly、Secure、SameSite=Lax Cookie 保存；数据库只存 token 的SHA-256摘要。注册会自动登入。前端不会将 token 存入 localStorage。
- 登出会撤销当前会话并关闭它关联的房间连接，释放座位；其他设备的会话保留。WebSocket 在建立连接时从Cookie验证身份，检查来源，并在会话过期后关闭。跨进程的撤销最多一分钟生效。
- 数据库查询使用参数绑定；用户名在页面上按文本显示。注册和登入共用每IP每15分钟30次尝试限制，验证码每IP每分钟20次。哈希并发最多2个。图片验证码适合基本防刷，自动识图工具仍可能突破；它不能提供第三方风控服务同等的保障。
- 棋谱沿用 `players` 字段，例如 `{"player1":"用户甲","player2":"用户乙"}`；游客为 `null`。对局记录保留开局时的用户ID、用户名和实际角色，本地对战双方可为同一账号，电脑及游客的用户ID为空。
- `match_records` 针对双人棋局。`status` 的三种值：`in_progress`（对局中）、`finished`（结束）、`abandoned`（未完成即关闭）。和棋 `winner_id=-1`，`winner_role` 为空；游客或电脑胜利时获胜ID为空，角色仍保存。未完成时获胜信息为空，`ended_at` 是关闭时间。基础用时、读秒用时单位为秒，实际用时单位为毫秒；不限时的时间字段为空。让子记为字符串（无让子为 `"0"`；不支持让子的游戏为空）。总手数按各棋种的手数接口记录。
- 新局会结束旧记录并建立新的记录；导入棋谱和打谱不会伪造实战记录。双方退出后沿用现有房间销毁时限；房间真正关闭时记为未完成。
- 每5秒合并后台写入，结束时立即触发写入，不让落子等待数据库。数据库失败时重试，并保存到 `data/pending-matches.json`，请确保服务账号可写此目录。可用 `MATCH_RECORD_SPOOL` 指定其他持久目录；不要放在 `public`。不要删除仍有待写记录的文件。
- 服务器重启后，旧实例留在数据库中的进行中对局会记为未完成（房间本身仍为原来的内存存储）。突然断电可能损失最后一个后台写入周期内的数据。当前房间架构及恢复逻辑要求单实例运行，请勿用多个PM2实例共享此数据库处理房间。

## 6. 部署检查

先测试：注册一个纯数字密码账号，重复注册相同用户名，输入错误验证码，正常登入和登出。登入后落座，检查时间框和聊天姓名，再导出棋谱确认 `players` 字段。对局结束后查询：

```sql
SELECT id, game_type, player1_username, player2_username,
       status, total_moves, winner_id, winner_role
FROM match_records ORDER BY started_at DESC LIMIT 10;
```

本地已使用PostgreSQL引擎（PGlite）验证迁移、账号接口、密码哈希、重复用户名、验证码重用、会话撤销、对局写入与数据库故障恢复，并用Headless Edge验证首页、登入页和房间姓名。尚未连接你的生产数据库，部署后仍需完成上述检查。
