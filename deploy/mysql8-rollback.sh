#!/usr/bin/env bash
set -euo pipefail

APP_DB_NAME="${APP_DB_NAME:-duban}"
APP_DB_USER="${APP_DB_USER:-duban}"
APP_DB_PASS="${APP_DB_PASS:-}"
ROOT_PASSWORD="${ROOT_PASSWORD:-}"
ROLLBACK_SQL="${ROLLBACK_SQL:-}"
BACKUP_DIR="${BACKUP_DIR:-/root/mysql8-rollback-backups}"
PM2_APP_NAME="${PM2_APP_NAME:-duban-server}"
STOP_PM2_APP="${STOP_PM2_APP:-1}"
START_PM2_APP="${START_PM2_APP:-1}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/api/health}"
RESTORE_SERVER_ENV_FILE="${RESTORE_SERVER_ENV_FILE:-}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-/opt/duban/server/.env}"

usage() {
  cat <<'EOF'
用法：
  APP_DB_PASS='应用库密码' ROLLBACK_SQL='/root/duban_backup.sql' bash deploy/mysql8-rollback.sh

可选环境变量：
  APP_DB_NAME             默认 duban
  APP_DB_USER             默认 duban
  APP_DB_PASS             回滚后应用库密码，必填
  ROOT_PASSWORD           root 密码；若 /root/.my.cnf 已存在可省略
  ROLLBACK_SQL            要回滚导入的 SQL 文件，必填
  BACKUP_DIR              回滚前自动备份当前库的位置
  PM2_APP_NAME            默认 duban-server
  STOP_PM2_APP            默认 1，回滚前停止 PM2 进程
  START_PM2_APP           默认 1，回滚完成后重启 PM2 进程
  HEALTHCHECK_URL         默认 http://127.0.0.1:3001/api/health
  RESTORE_SERVER_ENV_FILE 可选，将备份的 .env 恢复到 SERVER_ENV_FILE
  SERVER_ENV_FILE         默认 /opt/duban/server/.env

说明：
  1. 本脚本回滚的是当前 MySQL 8 实例中的业务数据，不负责把数据库引擎降级回 MariaDB。
  2. 回滚前会先自动导出当前库，避免二次误操作不可恢复。
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

mysql_root() {
  if [[ -f /root/.my.cnf ]]; then
    mysql --defaults-file=/root/.my.cnf "$@"
  elif [[ -n "$ROOT_PASSWORD" ]]; then
    MYSQL_PWD="$ROOT_PASSWORD" mysql -uroot "$@"
  else
    echo "无法以 root 连接 MySQL：请提供 ROOT_PASSWORD 或先准备 /root/.my.cnf" >&2
    exit 1
  fi
}

mysqldump_root() {
  if [[ -f /root/.my.cnf ]]; then
    mysqldump --defaults-file=/root/.my.cnf "$@"
  elif [[ -n "$ROOT_PASSWORD" ]]; then
    MYSQL_PWD="$ROOT_PASSWORD" mysqldump -uroot "$@"
  else
    echo "无法以 root 导出 MySQL：请提供 ROOT_PASSWORD 或先准备 /root/.my.cnf" >&2
    exit 1
  fi
}

require_command mysql
require_command mysqldump
require_command systemctl

if [[ -z "$APP_DB_PASS" ]]; then
  echo "APP_DB_PASS 不能为空。" >&2
  exit 1
fi

if [[ -z "$ROLLBACK_SQL" || ! -f "$ROLLBACK_SQL" ]]; then
  echo "ROLLBACK_SQL 不存在：$ROLLBACK_SQL" >&2
  exit 1
fi

systemctl start mysqld >/dev/null 2>&1 || true
sleep 3

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
CURRENT_BACKUP="$BACKUP_DIR/${APP_DB_NAME}_before_rollback_${TIMESTAMP}.sql"

mysqldump_root --single-transaction --routines --triggers --events "$APP_DB_NAME" > "$CURRENT_BACKUP"

if [[ "$STOP_PM2_APP" == "1" ]] && command -v pm2 >/dev/null 2>&1; then
  pm2 stop "$PM2_APP_NAME" >/dev/null 2>&1 || true
fi

mysql_root <<SQL
DROP DATABASE IF EXISTS ${APP_DB_NAME};
CREATE DATABASE ${APP_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '${APP_DB_USER}'@'localhost';
CREATE USER '${APP_DB_USER}'@'localhost' IDENTIFIED WITH mysql_native_password BY '${APP_DB_PASS}';
GRANT ALL PRIVILEGES ON ${APP_DB_NAME}.* TO '${APP_DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

mysql_root "$APP_DB_NAME" < "$ROLLBACK_SQL"

if [[ -n "$RESTORE_SERVER_ENV_FILE" && -f "$RESTORE_SERVER_ENV_FILE" ]]; then
  cp "$RESTORE_SERVER_ENV_FILE" "$SERVER_ENV_FILE"
fi

if [[ "$START_PM2_APP" == "1" ]] && command -v pm2 >/dev/null 2>&1; then
  pm2 start "$PM2_APP_NAME" >/dev/null 2>&1 || pm2 restart "$PM2_APP_NAME" >/dev/null 2>&1 || true
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1 || true
fi

echo "=== MySQL 8 回滚完成 ==="
echo "回滚前备份：$CURRENT_BACKUP"
mysql_root -N -e "SELECT VERSION(), @@version_comment; SELECT COUNT(*) FROM ${APP_DB_NAME}.users; SELECT COUNT(*) FROM ${APP_DB_NAME}.departments;"
