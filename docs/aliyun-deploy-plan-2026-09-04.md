# 阿里云生产环境部署方案（应用与数据库独立部署）— 2026-09-04

> 性质：**方案分析文档，未执行任何部署**。所有「现状事实」均来自当前源码（release/v1.1.0，eb1278f）；所有「建议」为待实施项。
> 前提变化：现有生产在腾讯云 `49.233.13.110`（单机自建 MySQL + 本机 Redis）；本方案目标是在**阿里云**重建生产环境，应用与数据库分别独立部署，最终替换现网。

---

## 1. 现状事实（源码依据）

| 事实 | 出处 |
| --- | --- |
| 前端 API 全部走相对路径 `/api`，无硬编码域名/IP，换环境零改动 | `src/lib/api.ts:3` |
| 后端 Express 监听 `PORT=3001`，由同机 Nginx 反代 `127.0.0.1:3001` | `server/src/index.ts:39`、`deploy/deploy-server.sh:383` |
| PM2 cluster 模式 `instances=max`、单实例内存上限 768M、`DB_POOL_SIZE=50`、`RATE_LIMIT_PER_MINUTE=1200` | `server/ecosystem.config.js` |
| 连接池 `connectionLimit=50 / queueLimit=100 / waitForConnections=true`（可被 env 覆盖） | `server/src/db/index.ts:20-22` |
| Redis 走 `REDIS_URL`（node-redis v4）；`REDIS_REQUIRED=true` 时 Redis 不可用则**启动直接抛错** | `server/src/redis.ts`、`server/src/index.ts:134-135` |
| CORS 白名单 = `FRONTEND_URL` + localhost，需随新域名更新 | `server/src/index.ts:40,47-51` |
| `trust proxy` 固定 `loopback, linklocal, uniquelocal` —— Nginx 必须与后端**同机**（或同私网段）才信任转发头 | `server/src/trust-proxy.ts` |
| 运行时环境文件在服务器 `/opt/duban/server/.env`（`RUNTIME_ENV_FILE` 可覆盖），**不进仓库、不随构建上传** | `deploy/deploy-server-lib.sh:15-34` |
| `.env` 需要的键：`DATABASE_URL`、`REDIS_URL`、`REDIS_REQUIRED`、`FRONTEND_URL`、`PORT`、`SEED_DEFAULT_PASSWORD`，可选 `DB_POOL_SIZE/DB_QUEUE_LIMIT/DB_QUERY_TIMEOUT/RATE_LIMIT_PER_MINUTE/AUTO_ENGINE_INTERVAL_MS/MESSAGES_STREAM_INTERVAL_MS` 等 | `server/src` 全量 `process.env` 枚举 |
| 附件存 DB JSON 列（`attachments json`），**无独立文件目录需迁移**；`MIGRATE_ATTACHMENTS` 仅处理存量 | `server/src/db/schema.ts:69,103` |
| 部署链路：本地构建 → rsync dist/server-dist/deploy → 远端 `deploy-server.sh`（releaseId 指纹 + 公开健康等待 + 角色刷新） | `deploy/deploy-local.sh`、`deploy/deploy-server.sh` |
| `deploy-local.sh` 硬编码 `SERVER_IP=49.233.13.110 / root / /root/duban`，`SERVER_INBOX` 已支持环境变量 | `deploy/deploy-local.sh:10-13` |
| `deploy-server.sh` 的 `REPO_DIR/RUNTIME_ROOT/FRONTEND_TARGET` 等均支持 `${VAR:-默认}` 覆盖 | `deploy/deploy-server.sh:8-22` |
| **部署脚本不含 `npm install`**：运行时依赖服务器上已存在的 `/opt/duban/server/node_modules`，新机必须一次性初始化 | `deploy/deploy-server.sh` 全文 |
| 远端 Nginx server 块由 `deploy-server.sh` 生成：**无 `client_max_body_size`（默认 1m）、无 gzip、无 SSE 专项 location、无限流**；`deploy/nginx.conf` 的 http 级调优（gzip/limit_req/keepalive upstream）并未被该脚本安装 | `deploy/deploy-server.sh:374-416` 对比 `deploy/nginx.conf` |
| SSE 接口 `/api/messages/stream` 豁免全局 30s 超时，靠心跳维持长连接 | `server/src/index.ts:53-63` |
| 认证 token 自签发（非 JWT、无外部密钥依赖），登录态随数据库迁移 | `server/src/routes/auth.session` |
| 自动引擎（超期/催办/亮灯）在服务端定时跑，**时间/时区敏感** | `server/src/jobs/item-auto-engine.ts` |
| 仓库内还有一处硬编码旧 IP：`e2e/scenario1-prod-verify.spec.ts` | 全仓 grep |

已核对附件密钥 `/Users/wtlm/Downloads/yl.pem`：RSA 2048 私钥、格式有效，权限已收紧为 `600`（原 644，OpenSSH 会拒绝过宽权限）。

---

## 2. 整体部署架构（推荐）

```
                        ┌──────────────── 阿里云 同地域 VPC（如 10.0.0.0/16）────────────────┐
                        │                                                                     │
  用户/浏览器 ──HTTPS──▶│  ┌────────────── ECS 应用机（公网交换机，绑定 EIP）──────────────┐    │
  （域名 → EIP）        │  │  Nginx :80/:443（静态 dist + /api 反代）                     │    │
                        │  │    └─▶ PM2 cluster（duban-server ×N，:3001 仅 127.0.0.1）   │    │
                        │  │  Redis :6379（仅 bind 127.0.0.1，本机自用）                 │    │
                        │  └──────────────┬──────────────────────────────────────────────┘    │
                        │                 │ 内网（VPC 内，走 RDS 内网地址，无公网）            │
                        │  ┌──────────────▼──────────────────────────────────────────────┐    │
                        │  │  RDS MySQL 8.0（数据库交换机，不开公网，白名单只放应用机）     │    │
                        │  └─────────────────────────────────────────────────────────────┘    │
                        └─────────────────────────────────────────────────────────────────────┘
```

组件与规格建议（起步值，可按压测调整）：

| 组件 | 建议 | 理由 |
| --- | --- | --- |
| ECS 应用机 | 4C8G（如 c8i.xlarge / e-instance 4C8G），系统盘 40G ESSD，Alibaba Cloud Linux 3 或 Ubuntu 22.04，绑定按流量计费 EIP（峰值带宽 20~50Mbps） | 现网 2C2G 承载 600 人；`instances=max` + `max_memory_restart 768M` 下 4 核更稳；**避开 CentOS 7**（EPEL Redis 仅 3.2，本项目 node-redis v4 需 Redis ≥ 6） |
| 数据库 | **首选 RDS MySQL 8.0**，通用型 2C4G（`mysql.x4.large.1` 级别）起步，ESSD 50G，同 VPC 内网 | 自带自动备份/binlog/监控/白名单；内网延迟 <1ms。对比自建见 §4.2 |
| Redis | 应用机本机自装 Redis 6/7，仅 127.0.0.1 | 沿用既有决策（热路径本机、故障半径小）；RDS 装不了 Redis |
| CDN/SLB | 暂不需要（内网系统、单应用机） | 后续双机时再引入 SLB，届时需同步调整 `trust proxy` |

---

## 3. 应用层部署方式

### 3.1 应用机一次性初始化（新 ECS 上手工执行一次）

1. 系统包：`nginx`、`redis`（≥6）、`nodejs 20 LTS`、全局 `pm2`、`rsync`（云镜像一般自带）。
2. 目录：
   - `/root/duban`（脚本副本目录，`deploy/` 与 `ecosystem.config.js` 会被 rsync 到这里）
   - `/opt/duban/server`（后端运行时目录）
   - `/opt/duban/incoming`（构建收件目录）
   - `/var/www/duban/dist`（前端根）
   - `/var/log/duban`
3. **`cd /opt/duban/server && npm ci --omit=dev`**：部署脚本不装依赖（§1 事实），这一步漏掉则 PM2 起不来；后续 `package.json` 变更也要手动重跑。
4. 写入 `/opt/duban/server/.env`（键见 §6 清单），`chmod 600`。
5. `/etc/nginx/nginx.conf` 合入 `deploy/nginx.conf` 的 http 级配置（gzip、`limit_req_zone`、`worker_rlimit_nofile 65535`、`client_max_body_size 10m`、upstream keepalive），server 块继续由 `deploy-server.sh` 生成到 `conf.d`。
   - **吸取现网教训**：只保留一个 server 配置来源（`conf.d/duban.conf`），不要同时在 `sites-enabled` 和 `conf.d` 各放一份（现网曾因双配置旧块抢流量出过事故）。
   - 对 `/api/messages/stream` 单独 location：`proxy_buffering off; proxy_read_timeout 10m;`（SSE 长连接）；其余 `/api/` 保持 `proxy_read_timeout 30s`。
6. SSH 加固：登录仅 `yl.pem` 密钥、禁密码；安全组 22 端口只放本机出口 IP（见 §5）。

### 3.2 日常发布流水线（复用现有脚本，需先参数化）

现状 `deploy-local.sh:10-12` 把目标写死为腾讯云，切换阿里云需一处小改造（**待用户确认后实施，本文档不代改**）：

```bash
# deploy-local.sh 建议改为：
SERVER_IP="${SERVER_IP:-49.233.13.110}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_REPO="${SERVER_REPO:-/root/duban}"
```

之后阿里云发布命令：

```bash
SSH_KEY=/Users/wtlm/Downloads/yl.pem \
SERVER_IP=<阿里云EIP> bash deploy/deploy-local.sh
```

健康检查 URL 已跟随 `SERVER_IP` 变量（`deploy-local.sh:125`），无需其他改动；`deploy-server.sh` 侧的目录参数默认值与新机目录规划一致，不用动。

### 3.3 发布验证闸门（沿用 P0 铁律）

本地 `pnpm dev` + `server npm run dev` 验证通过 → 发布 → `curl http://<EIP>/api/health` 核对 `status:"ok"`、`releaseId` 为本次、`databaseTargetId` 为新库 → 浏览器走登录/菜单/事项/移动端回归（本地有效账号见既有记忆 admin/00000210）→ 更新 `e2e/scenario1-prod-verify.spec.ts` 的目标 IP 后跑 `pnpm test:e2e` 冒烟。

---

## 4. 数据库层部署方式

### 4.1 推荐方案：RDS MySQL 8.0（托管）

- 创建：同地域、同 VPC、数据库交换机（私网）；版本 MySQL 8.0（与现网 `deploy/mysql8-init.sh` 口径一致）；存储 ESSD 50G 起步、自动扩容打开。
- 账号：创建专用账号（如 `duban_app`），仅授权业务库 `duban.*` 的 DML+DDL；**不使用高权限账号写进 `DATABASE_URL`**。
- 白名单：只填应用 ECS 的**私网 IP**（或应用安全组）；不申请公网地址。
- 备份：自动备份（每日全量 + binlog），保留 ≥7 天；上云切换窗口加做一次手动快照。
- 参数核对：`time_zone = '+8:00'`（与旧库实测值对齐，见 §7 风险 R4）；`max_connections` ≥ 300（4 实例 × 50 连接 + 余量）；`character_set_server=utf8mb4`。

### 4.2 备选方案：第二台 ECS 自建 MySQL 8

省 RDS 费用（约省一半数据库成本），但需自担：每日备份脚本（`mysqldump`/xtrabackup + 异地副本）、慢日志与监控、内核参数与安全补丁、主从高可用（如需）。**600 人内网系统长期看 RDS 的运维成本优势更明显，推荐 RDS**；自建方案的网络隔离要求见 §5 末尾。

### 4.3 存量数据迁移（腾讯云 → 阿里云 RDS）

数据量小（600 人督办系统），推荐**停机窗口逻辑导出**，不用 DTS 常驻同步：

1. **前置（当前最大不确定项）**：9 月 4 日起本机 SSH 22 到 `49.233.13.110` 超时（HTTP 正常）。迁移前必须先恢复 SSH（查安全组/fail2ban/出口 IP 变更），否则拿不到最新 dump。本地 `~/Downloads/duban-db-backups/` 有历史备份可应急，但非最新。
2. 停写：旧环境 `pm2 stop duban-server`（同时停掉自动引擎，避免切换窗口重复催办/亮灯）。
3. 导出：`mysqldump --single-transaction --set-gtid-purged=OFF --routines --triggers --databases duban | gzip > duban-<date>.sql.gz`（--single-transaction 保证 InnoDB 一致性快照，不锁表）。
4. 传输：经本机中转 `scp` 到阿里云 ECS，再从 ECS 内网导入 RDS（ECS 与 RDS 同 VPC，导入走内网，快且安全）。
5. 导入：`gunzip < dump | mysql -h <RDS内网地址> -u duban_app -p duban`；RDS 无 SUPER 权限，dump 中若含 `DEFINER` 子句需先剥离。
6. 校验：核心表行数比对、抽样业务记录比对、`SELECT NOW()/@@time_zone` 与旧库比对。
7. 首次部署后 `deploy-server.sh` 会自动跑结构补齐（`ensureDatabaseSchema`）+ 内置角色刷新（`deploy-role-refresh`），在导入的存量库上执行即可，无额外步骤。

---

## 5. 网络连通与隔离策略

| 层面 | 策略 |
| --- | --- |
| VPC | 应用与 RDS 同地域同 VPC；两个交换机可分可用区（应用公网 SW + 数据库私网 SW），内网互通、跨公网零暴露 |
| 应用 ECS 安全组（入） | `80/443` 对 `0.0.0.0/0`；`22` 仅对本机出口 IP（可配多家宽带 IP 或改用堡垒机；**不要长期 0.0.0.0/0**）；其余端口默认拒绝 |
| 应用 ECS 安全组（出） | 保持默认放行（拉包、调外部服务需要） |
| 后端进程 | `PORT=3001` 仅监听 `127.0.0.1` 由 Nginx 反代（现状即如此）；数据库、Redis 端口一律不对公网开 |
| Redis | `bind 127.0.0.1`，可选 `requirepass`（`REDIS_URL=redis://:pass@127.0.0.1:6379`）；绝不加公网 |
| RDS | **不开公网模式**；白名单只放应用 ECS 私网 IP；应用侧 `DATABASE_URL` 使用内网连接地址（`rm-xxx.mysql.rds.aliyuncs.com:3306`） |
| 信任链 | `trust proxy=loopback,...` 与「Nginx 同机反代」配套成立；未来加 SLB/独立 LB 时必须把其内网网段加入 `server/src/trust-proxy.ts`，否则限流按 IP 失真或 X-Forwarded-For 不被信任 |
| 自建 MySQL 备选 | DB 专机**不绑 EIP**；SG 入方向 `3306` 仅允许应用 ECS 私网 IP，`22` 仅管理来源；`bind-address=<私网IP>`；应用账号 `user@'应用私网IP'` |
| 域名/备案 | 国内节点绑定域名走 80/443 **必须完成 ICP 备案**（阿里云备案通常 1~2 周）；未备案期间只能裸 EIP 访问（且 80 端口可能被拦截）。备案是本方案最长前置周期项，需最先启动 |

---

## 6. 关键配置清单

新环境 `/opt/duban/server/.env`（权限 600，不入库；`deploy-local.sh` 的新增文件黑名单已能防误提交）：

| 键 | 值（示例形态） | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `mysql://duban:<URL编码密码>@<DB私网IP>:3306/duban` | 自建库用数据库机私网 IP；密码含特殊字符必须 URL 编码 |
| `AUTH_TOKEN_SECRET` | 强随机串，**必填** | `server/src/routes/auth.session.ts:39-45`：生产环境缺失直接抛错；**迁移数据时须与旧环境同值**，否则全员登录态失效（token 为 HMAC 签名） |
| `REDIS_URL` | `redis://127.0.0.1:6379` | 本机 Redis；如设 requirepass 则带密码 |
| `REDIS_REQUIRED` | `true`（初始化/排障阶段可临时 `false`） | true 时 Redis 缺失会启动即失败——**必须先装好 Redis 再首次部署** |
| `FRONTEND_URL` | `http://<EIP>`（上域名后改 `https://<域名>`） | 进 CORS 白名单；上 HTTPS 后务必同步更新，否则跨域登录异常 |
| `PORT` | `3001` | 与 Nginx 反代一致 |
| `SEED_DEFAULT_PASSWORD` | 仅空库首次初始化需要 | 存量数据导入场景不需要 |
| 可选调优 | `DB_POOL_SIZE=50`、`DB_QUEUE_LIMIT=100`、`RATE_LIMIT_PER_MINUTE=1200` | ecosystem 已内置；改核数时保证 `实例数×DB_POOL_SIZE < MySQL max_connections（8.0 默认 151，需调大或减小实例数）` |

其他关键点：

1. **Nginx 请求体上限**：脚本生成的 server 块没有 `client_max_body_size`（默认 1m），而 `deploy/nginx.conf` 的 http 级配置也未自动安装——新机必须手工合入 `client_max_body_size 10m`，否则附件上传 >1m 直接 413（后端 `express.json` 限 1mb，链路三处限制要一起核对）。
2. **SSE**：`/api/messages/stream` 需 `proxy_buffering off` + 加大 `proxy_read_timeout`；心跳间隔（`MESSAGES_STREAM_INTERVAL_MS`）应小于 read 超时。
3. **HTTPS**：现网明文 HTTP 已被安全审查列为严重项，新环境应一次性上 443（阿里云免费 DV 证书）+ 80 跳转；`FRONTEND_URL`、企微侧配置同步。
4. **依赖安装**：新机 `npm ci --omit=dev` 一次性 + 依赖变更时手动（部署脚本不管 node_modules）。
5. **时区**：RDS `time_zone` 与旧库实测对齐（建议 `+8:00`）；ECS `timedatectl set-timezone Asia/Shanghai`。超期/亮灯/催办全靠日期列判定，时区漂移会直接改变业务结果。
6. **部署脚本参数化**：`deploy-local.sh` 三行改造（§3.2）+ `e2e/scenario1-prod-verify.spec.ts` 目标 IP。
7. **日志与监控**：PM2 日志在 `/opt/duban/server/logs/`（注意 logrotate）；云监控对 ECS（CPU/内存/磁盘）与 RDS（连接数、慢 SQL）配告警；`/api/health` 拨测。

---

## 7. 潜在风险与对策

| # | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| R1 | **旧生产 SSH 不通（9/4 起 22 超时）** | 拿不到最新数据 dump，迁移无法开始 | 最先恢复（查腾讯云安全组/fail2ban/出口 IP）；应急用本地历史备份（数据有损） |
| R2 | **ICP 备案周期** | 域名无法立即绑定，上线时间被拉长 | 备案与资源创建并行启动；未备案期用裸 EIP + 非标端口临时验证 |
| R3 | 切换窗口双环境并存 | 自动引擎两边都跑 → 重复催办/亮灯/企微通知 | 切流顺序固化：**先停旧环境 PM2 → 再导数 → 再切 DNS**；旧环境保留 ≥2 周仅作回滚 |
| R4 | 时区不一致 | 超期/亮灯/剩余天数判定漂移 | 导出前记录旧库 `NOW()`/`@@time_zone`；RDS 与 ECS 统一 `+8:00`；上线后抽查临界事项 |
| R5 | `REDIS_REQUIRED=true` 但 Redis 未就绪 | 首次部署健康等待 90 次全失败 | 初始化顺序：Redis → .env → npm ci → deploy |
| R6 | 连接数超限 | RDS 拒连、部署失败 | `PM2 实例数 × DB_POOL_SIZE < max_connections`；RDS 侧设告警 |
| R7 | Nginx 配置缺失/双配置 | 413、SSE 断流、旧 server 块抢流量（现网曾发生） | §6.1/§6.2 逐项合入；唯一配置来源 `conf.d/duban.conf`，改后 `nginx -t` |
| R8 | `npm ci` 缺失/依赖漂移 | 后端起不来、运行时缺模块 | 初始化清单强制项；依赖变更走一次「本地验证→重跑 npm ci→部署」 |
| R9 | RDS 权限差异（无 SUPER） | 含 `DEFINER` 的 dump 导入报错 | 导出/导入时剥离 DEFINER；本项目未用存储过程/触发器，风险低 |
| R10 | 回滚数据差异 | 切回旧环境会丢新环境写入 | 回滚仅限灾难场景；切换后 48h 内避免不可逆批量操作；RDS 快照兜底 |
| R11 | 22 端口对公网全开 | 暴力破解 | 安全组限源 IP + 密钥登录 + 可选 fail2ban |
| R12 | 凭证泄露 | 服务器失陷 | `yl.pem` 已 600；`.env`/RDS 密码不入库不入日志；部署脚本黑名单已有兜底 |

---

## 8. 实施阶段（建议顺序）

1. **阶段 0（当天可启动）**：备案提交；恢复旧生产 SSH；确认预算/规格。
2. **阶段 1**：建 VPC/交换机/安全组、应用 ECS（绑定 EIP）、RDS（白名单先留空或只放应用私网 IP）。
3. **阶段 2**：应用机初始化（§3.1，含 npm ci、.env、Nginx http 级合入、Redis）。
4. **阶段 3**：`deploy-local.sh` 参数化改造 → 空库首发到新环境（`SEED_DEFAULT_PASSWORD` 初始化内置账号）→ `/api/health` 与浏览器冒烟通过。**此阶段先连空库验证部署链路，不动生产数据。**
5. **阶段 4**：停写旧环境 → dump → 导入 RDS → 校验 → 新环境重跑一次部署（触发结构补齐/角色刷新）→ 全量业务回归（PC + 移动端 + e2e）。
6. **阶段 5**：DNS 切到新 EIP、上 443 证书、`FRONTEND_URL` 改正式域名 → 观察监控 48h → 旧环境保留 ≥2 周 → 归档报告（区分已验证/未验证项）。

## 9. 回滚预案

- DNS 层：域名解析切回旧 EIP（TTL 建议提前调到 300s）。
- 应用层：旧环境 PM2 `start`（旧库数据停在切换时点，**切回即丢失新环境期间的写入**，需业务确认）。
- 数据层：RDS 手动快照可恢复到切换后任意时点；不可逆操作前强制快照。

---

## 10. 决策与准备记录（2026-09-04 第二次更新）

**已拍板决策**：两台阿里云 ECS（应用 + 数据库独立）；数据库机自建 MySQL 8（不用 RDS）；数据策略为「先空库跑通部署链路，再停写迁移现网数据」。

**事实修正**：
- `AUTH_TOKEN_SECRET` 为生产硬性必填（缺失启动即抛错，`server/src/routes/auth.session.ts:39-45`）；迁移数据时须与旧环境同值以保留登录态。
- 旧生产 SSH 已恢复：`ssh -i /Users/wtlm/Downloads/yldbxt.pem root@49.233.13.110` 可登（默认身份会被拒），PM2 双实例在线，`/api/health` 200。此前"SSH 超时"结论已过期。
- SSE 无需 nginx 专项配置：响应头自带 `X-Accel-Buffering: no`，心跳默认 10s（`server/src/routes/messages.stream.ts:21,55,82`）。

**已完成的准备（未发布）**：
1. `deploy/deploy-local.sh`：`SERVER_IP/SERVER_USER/SERVER_REPO` 参数化，默认值不变（仍指旧生产）。
2. 新增 `deploy/aliyun-init-app-server.sh`：应用机一次性初始化（Node 22 官方 tarball、PM2（路径对齐 deploy-server.sh）、Redis ≥6 校验、目录、Nginx 默认站点清理 + http 级调优含 `client_max_body_size 10m`、时区、`pm2 startup`）。
3. 新增 `deploy/aliyun-init-db-server.sh`：数据库机一次性初始化（MySQL 8 安装、root 加固、bind 私网 IP、utf8mb4、`time_zone=+8:00`、`max_connections=500`、应用账号限源 `duban@'<应用私网IP>'`）。
4. 三个脚本 `bash -n` 全部通过；`yl.pem` 权限已收紧 600。

**待用户输入**：两台 ECS 的 IP（应用机公网 IP、数据库机 SSH 可达 IP）及数据库机 SSH 密钥是否同为 `yl.pem`；两台机是否同 VPC（决定 3306 内网直连是否成立）。
