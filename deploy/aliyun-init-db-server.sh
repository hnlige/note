#!/bin/bash
# ============================================
# 督办管理系统 - 阿里云数据库服务器（自建 MySQL 8）一次性初始化
# 运行位置: 数据库 ECS（root 登录）
# 必填环境变量:
#   APP_DB_PASS      应用账号密码（强随机；含特殊字符时写入 DATABASE_URL 需 URL 编码）
#   APP_PRIVATE_IP   应用服务器私网 IP（限定应用账号只能从应用机连接，如 172.16.0.10）
# 可选:
#   APP_DB_NAME（默认 duban）/ APP_DB_USER（默认 duban）
#   ROOT_PASSWORD    新装 MySQL 的 root 新密码（RHEL 系走临时密码时必填）
#   BIND_ADDR        显式指定绑定 IP（默认自动探测私网地址）
# 作用: 安装 MySQL 8、bind 私网 IP、utf8mb4、时区 +8:00、建库建应用账号
# 安全前提（控制台操作，脚本无法代劳）:
#   - 本机不绑定 EIP/公网 IP
#   - 安全组入方向 3306 仅放行 APP_PRIVATE_IP，22 仅放行管理来源
# ============================================
set -euo pipefail

APP_DB_NAME="${APP_DB_NAME:-duban}"
APP_DB_USER="${APP_DB_USER:-duban}"
APP_DB_PASS="${APP_DB_PASS:-}"
APP_PRIVATE_IP="${APP_PRIVATE_IP:-}"
ROOT_PASSWORD="${ROOT_PASSWORD:-}"

log() { echo "[db-init] $1"; }
fail() { echo "[db-init][ERROR] $1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] && fail "请以 root 运行"
[ -n "$APP_DB_PASS" ] || fail "APP_DB_PASS 不能为空"
[ -n "$APP_PRIVATE_IP" ] || fail "APP_PRIVATE_IP 不能为空（应用服务器私网 IP，用于账号限源）"

detect_private_ip() {
    hostname -I 2>/dev/null | tr ' ' '\n' \
        | grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)' | head -1
}
BIND_ADDR="${BIND_ADDR:-$(detect_private_ip)}"
[ -n "$BIND_ADDR" ] || fail "未能探测私网 IP，请用 BIND_ADDR=<ip> 显式指定"

# ── 1. 安装 MySQL 8 ──
if ! command -v mysqld >/dev/null 2>&1 && ! command -v mysql >/dev/null 2>&1; then
    log "1/6 安装 MySQL Server ..."
    if command -v apt >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -y && apt-get install -y mysql-server
    else
        dnf install -y mysql-server || yum install -y mysql-server
    fi
fi
systemctl enable --now mysqld >/dev/null 2>&1 || systemctl enable --now mysql >/dev/null 2>&1 || true
sleep 3

# ── 2. root 访问（沿用 deploy/mysql8-init.sh 的成熟做法） ──
write_root_defaults() {
    cat > /root/.my.cnf <<EOF
[client]
user=root
password=${ROOT_PASSWORD}
default-character-set=utf8mb4
EOF
    chmod 600 /root/.my.cnf
}

mysql_root() {
    if [ -f /root/.my.cnf ]; then
        mysql --defaults-file=/root/.my.cnf "$@"
    elif [ -n "$ROOT_PASSWORD" ]; then
        MYSQL_PWD="$ROOT_PASSWORD" mysql -uroot "$@"
    else
        mysql -uroot "$@"
    fi
}

if [ -f /root/.my.cnf ] && mysql_root -e 'SELECT 1' >/dev/null 2>&1; then
    log "2/6 root 凭据可用（/root/.my.cnf）"
elif [ -n "$ROOT_PASSWORD" ] && MYSQL_PWD="$ROOT_PASSWORD" mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then
    write_root_defaults
    log "2/6 root 密码已验证并写入 /root/.my.cnf"
elif mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then
    # Debian/Ubuntu 默认 auth_socket：root 本机免密可用
    if [ -n "$ROOT_PASSWORD" ]; then
        mysql -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';"
        write_root_defaults
        log "2/6 root 已改为密码认证并写入 /root/.my.cnf"
    else
        log "2/6 root 走 auth_socket 本机免密（未设 ROOT_PASSWORD，保持现状）"
    fi
else
    TEMP_PW="$(grep 'temporary password' /var/log/mysqld.log 2>/dev/null | tail -1 | awk '{print $NF}')"
    if [ -n "$TEMP_PW" ] && [ -n "$ROOT_PASSWORD" ]; then
        mysql --connect-expired-password -uroot -p"$TEMP_PW" \
            -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';"
        write_root_defaults
        log "2/6 已用临时密码改为正式 root 密码"
    else
        fail "无法建立 root 连接：RHEL 系新装 MySQL 需提供 ROOT_PASSWORD（或先自行配置 /root/.my.cnf 后重跑）"
    fi
fi

# ── 3. bind 私网 IP + utf8mb4 + 时区 +8:00 ──
log "3/6 配置 bind-address=${BIND_ADDR} / utf8mb4 / time_zone=+8:00 ..."
MYSQL_CNF_BODY="[mysqld]
bind-address = ${BIND_ADDR}
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
default-time_zone = '+8:00'
# MySQL 8 默认 max_connections=151；应用机 PM2 instances=max × DB_POOL_SIZE=50 可能到 200+，必须放大
max_connections = 500
"
if [ -d /etc/mysql/mysql.conf.d ]; then
    printf '%s\n' "$MYSQL_CNF_BODY" > /etc/mysql/mysql.conf.d/99-duban.cnf
    systemctl restart mysql
elif [ -d /etc/my.cnf.d ]; then
    printf '%s\n' "$MYSQL_CNF_BODY" > /etc/my.cnf.d/99-duban.cnf
    systemctl restart mysqld 2>/dev/null || systemctl restart mysql
else
    fail "未识别 MySQL 配置目录（/etc/mysql/mysql.conf.d 或 /etc/my.cnf.d），请手工配置后重跑"
fi
sleep 3

# ── 4. 建库建账号（账号限源：仅应用机私网 IP 可连） ──
log "4/6 创建数据库与账号（${APP_DB_USER}@${APP_PRIVATE_IP}）..."
mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS ${APP_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '${APP_DB_USER}'@'${APP_PRIVATE_IP}';
CREATE USER '${APP_DB_USER}'@'${APP_PRIVATE_IP}' IDENTIFIED WITH mysql_native_password BY '${APP_DB_PASS}';
GRANT ALL PRIVILEGES ON ${APP_DB_NAME}.* TO '${APP_DB_USER}'@'${APP_PRIVATE_IP}';
FLUSH PRIVILEGES;
SQL

# ── 5. 校验 ──
log "5/6 校验 ..."
mysql_root -N -e "SELECT @@version, @@bind_address, @@time_zone, @@character_set_server;"
mysql_root -N -e "SHOW DATABASES LIKE '${APP_DB_NAME}';"
mysql_root -N -e "SELECT User, Host, plugin FROM mysql.user WHERE User='${APP_DB_USER}';"

# ── 6. 汇总输出 ──
log "6/6 完成。应用侧 /opt/duban/server/.env 使用（密码需 URL 编码）："
echo "  DATABASE_URL=mysql://${APP_DB_USER}:<URL编码后的APP_DB_PASS>@${BIND_ADDR}:3306/${APP_DB_NAME}"
echo ""
echo "  安全组自查（控制台）：本机不绑公网 IP；3306 入方向仅放行 ${APP_PRIVATE_IP}；22 仅放行管理来源。"
echo "  应用机连通性自查（在应用机上执行）：mysql -h ${BIND_ADDR} -P 3306 -u ${APP_DB_USER} -p"
echo "============================================"
