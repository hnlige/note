#!/bin/bash
# ============================================
# 督办管理系统 - 阿里云应用服务器一次性初始化
# 运行位置: 应用 ECS（root 登录）
# 作用: 安装 Node.js 22 / PM2 / Nginx / Redis，创建运行目录，合入 Nginx http 级调优
# 幂等: 可重复执行，已安装/已存在项自动跳过
# 说明:
#   - server 块（反代/静态目录/sourcemap 拦截）由 deploy-server.sh 部署时生成到
#     /etc/nginx/conf.d/duban.conf，本脚本只负责系统层与 http 上下文，避免双配置抢流量
#   - /opt/duban/server/.env 与 node_modules 不由本脚本处理（见 docs/aliyun-deploy-plan-2026-09-04.md）
# ============================================
set -e

log() { echo "[init] $1"; }
fail() { echo "[init][ERROR] $1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] && fail "请以 root 运行"

PKG=""
if command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
elif command -v apt >/dev/null 2>&1; then PKG="apt"
else fail "未识别的包管理器（支持 dnf/yum/apt）"; fi

# ── 1. 基础软件 ──
log "1/7 安装基础软件（nginx/redis/curl/git/tar/xz）..."
if [ "$PKG" = "apt" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y nginx redis-server curl git tar xz-utils
else
    "$PKG" install -y nginx redis curl git tar xz
fi

# ── 2. Node.js 22（官方 tarball 到 /usr/local，规避发行版仓库版本过老） ──
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ] 2>/dev/null; then
    log "2/7 Node 已存在 $(node -v)，跳过安装"
else
    log "2/7 安装 Node.js 22（官方 tarball）..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  ARCH="x64" ;;
        aarch64) ARCH="arm64" ;;
        *) fail "不支持的 CPU 架构：$ARCH" ;;
    esac
    NODE_TAR="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o "node-v22[0-9.]*-linux-${ARCH}\.tar\.xz" | head -1 || true)"
    [ -n "$NODE_TAR" ] || fail "无法从 nodejs.org 解析 v22 版本号，请手工安装 Node >= 18 后重跑"
    curl -fsSL -o "/tmp/$NODE_TAR" "https://nodejs.org/dist/latest-v22.x/$NODE_TAR"
    tar -xJf "/tmp/$NODE_TAR" -C /usr/local --strip-components=1
    rm -f "/tmp/$NODE_TAR"
fi
log "    Node $(node -v) / npm $(npm -v)"

# ── 3. PM2（deploy-server.sh 固定读取 /usr/local/lib/node_modules/pm2/bin/pm2） ──
PM2_BIN="/usr/local/lib/node_modules/pm2/bin/pm2"
if [ ! -x "$PM2_BIN" ]; then
    log "3/7 安装 PM2 ..."
    npm install -g pm2
else
    log "3/7 PM2 已存在，跳过"
fi
# 开机自启（ECS 重启后后端能自动拉起；pm2 save 在首次部署成功后由运维执行一次）
"$PM2_BIN" startup systemd >/dev/null 2>&1 || true

# ── 4. Redis：版本 >= 6，仅本机监听 ──
log "4/7 检查 Redis ..."
REDIS_MAJOR="$(redis-server --version 2>/dev/null | grep -oE 'v=[0-9]+' | head -1 | cut -d= -f2 || echo 0)"
[ "$REDIS_MAJOR" -ge 6 ] 2>/dev/null \
    || fail "Redis 版本过低（major=$REDIS_MAJOR）。本项目 node-redis v4 要求 >= 6；CentOS7/EPEL 的 3.2 不可用，请更换系统镜像或手工安装 Redis 6+"
REDIS_CONF=""
for f in /etc/redis/redis.conf /etc/redis.conf; do
    [ -f "$f" ] && REDIS_CONF="$f" && break
done
if [ -n "$REDIS_CONF" ] && grep -qE '^\s*bind\s+0\.0\.0\.0' "$REDIS_CONF"; then
    sed -i -E 's/^\s*bind\s+0\.0\.0\.0.*/bind 127.0.0.1/' "$REDIS_CONF"
fi
systemctl enable --now redis >/dev/null 2>&1 || systemctl enable --now redis-server >/dev/null 2>&1 || true
redis-cli ping 2>/dev/null | grep -q PONG || fail "Redis 未运行，请 systemctl status redis / redis-server 排查"
log "    Redis OK"

# ── 5. 运行目录（与 deploy-server.sh 的默认路径一一对应） ──
log "5/7 创建目录 ..."
mkdir -p /opt/duban/server/logs /opt/duban/incoming /var/www/duban/dist /var/log/duban /root/duban/server

# ── 6. Nginx：清理默认站点 + http 级调优 ──
log "6/7 配置 Nginx ..."
# Debian/Ubuntu 默认站点（default_server）会与 deploy-server.sh 生成的 duban.conf 抢 80 端口，
# 现网曾因双配置旧块抢流量出过事故，必须移除，保证 conf.d/duban.conf 唯一生效。
rm -f /etc/nginx/sites-enabled/default
# 开启 gzip（Ubuntu 默认已开、RHEL 系默认注释；已开则不动，避免 http 上下文 duplicate 报错）
if ! grep -qE '^\s*gzip\s+on;' /etc/nginx/nginx.conf; then
    sed -i -E 's/^(\s*)#\s*(gzip\s+on\s*;)/\1\2/' /etc/nginx/nginx.conf
fi
# 只写 stock nginx.conf 默认不存在/注释态的指令，防止 http 上下文指令重复：
# client_max_body_size 默认 1m，会把 >1m 的附件上传打成 413，必须放大
cat > /etc/nginx/conf.d/00-duban-tuning.conf <<'NGINX'
# duban http 级调优（aliyun-init-app-server.sh 写入）
# 附件上传上限 50MB，与后端 getMaxAttachmentBytes 保持一致
client_max_body_size 50m;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 256;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
NGINX
# 连接数调优（events/main 上下文只能改主配置；已是更大值则不动）
sed -i -E 's/^(\s*worker_connections\s+)1024\s*;/\14096;/' /etc/nginx/nginx.conf || true
grep -qE '^\s*worker_rlimit_nofile' /etc/nginx/nginx.conf \
    || sed -i -E '0,/^events\s*\{/s//worker_rlimit_nofile 65535;\nevents {/' /etc/nginx/nginx.conf || true
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || systemctl reload nginx >/dev/null 2>&1 || true

# ── 7. 时区（超期/亮灯/催办按日期判定，必须与业务时区一致） ──
log "7/7 设置时区 Asia/Shanghai ..."
timedatectl set-timezone Asia/Shanghai 2>/dev/null || true

echo ""
echo "============================================"
echo "  应用服务器初始化完成"
echo "============================================"
echo "  Node:   $(node -v)"
echo "  PM2:    $("$PM2_BIN" --version 2>/dev/null || echo unknown)"
echo "  Redis:  $(redis-cli ping 2>/dev/null || echo unknown)"
echo "  Nginx:  $(nginx -v 2>&1)"
echo "  时区:   $(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"
echo ""
echo "  后续步骤（在本地开发机执行，本脚本不涉及密钥与数据）："
echo "   1. scp server/package.json server/package-lock.json <本机>:/opt/duban/server/ 并 npm ci --omit=dev"
echo "   2. 写入 /opt/duban/server/.env（chmod 600，含 DATABASE_URL/REDIS_URL/AUTH_TOKEN_SECRET 等）"
echo "   3. SSH_KEY=<key> SERVER_IP=<本机公网IP> bash deploy/deploy-local.sh"
echo "   4. 首次部署成功后执行一次 pm2 save（固化开机自启进程列表）"
echo "============================================"
