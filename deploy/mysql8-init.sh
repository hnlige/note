#!/usr/bin/env bash
set -euo pipefail

APP_DB_NAME="${APP_DB_NAME:-duban}"
APP_DB_USER="${APP_DB_USER:-duban}"
APP_DB_PASS="${APP_DB_PASS:-}"
ROOT_PASSWORD="${ROOT_PASSWORD:-}"
BACKUP_SQL="${BACKUP_SQL:-}"
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
UPDATE_SERVER_ENV="${UPDATE_SERVER_ENV:-0}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-/opt/duban/server/.env}"

usage() {
  cat <<'EOF'
用法：
  ROOT_PASSWORD='新的root密码' APP_DB_PASS='应用库密码' bash deploy/mysql8-init.sh

可选环境变量：
  APP_DB_NAME         默认 duban
  APP_DB_USER         默认 duban
  APP_DB_PASS         应用库密码，必填
  ROOT_PASSWORD       root 密码；若 /root/.my.cnf 已存在可省略
  BACKUP_SQL          初始化后立即导入的 SQL 文件路径
  UPDATE_SERVER_ENV   设为 1 时，自动更新 SERVER_ENV_FILE 中的 DATABASE_URL
  SERVER_ENV_FILE     默认 /opt/duban/server/.env
  MYSQL_HOST          默认 localhost
  MYSQL_PORT          默认 3306

说明：
  1. 本脚本用于 MySQL 8 已安装完成后的标准初始化。
  2. 若检测到临时 root 密码，会自动改成 mysql_native_password 并写入 /root/.my.cnf。
  3. 若应用库密码包含特殊字符，写回 DATABASE_URL 时会自动做 URL 编码。
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

write_root_defaults() {
  local password="$1"
  cat > /root/.my.cnf <<EOF
[client]
user=root
password=${password}
default-character-set=utf8mb4
EOF
  chmod 600 /root/.my.cnf
}

mysql_root() {
  if [[ -f /root/.my.cnf ]]; then
    mysql --defaults-file=/root/.my.cnf "$@"
  elif [[ -n "$ROOT_PASSWORD" ]]; then
    MYSQL_PWD="$ROOT_PASSWORD" mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -uroot "$@"
  else
    echo "无法以 root 连接 MySQL：请提供 ROOT_PASSWORD 或先准备 /root/.my.cnf" >&2
    exit 1
  fi
}

ensure_root_access() {
  systemctl start mysqld >/dev/null 2>&1 || true
  sleep 3

  if [[ -f /root/.my.cnf ]] && mysql_root -e 'SELECT 1' >/dev/null 2>&1; then
    return 0
  fi

  if [[ -n "$ROOT_PASSWORD" ]] && MYSQL_PWD="$ROOT_PASSWORD" mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -uroot -e 'SELECT 1' >/dev/null 2>&1; then
    write_root_defaults "$ROOT_PASSWORD"
    return 0
  fi

  local temp_password=""
  if [[ -f /var/log/mysqld.log ]]; then
    temp_password="$(grep 'temporary password' /var/log/mysqld.log | tail -1 | awk '{print $NF}')"
  fi

  if [[ -n "$temp_password" && -n "$ROOT_PASSWORD" ]]; then
    mysql --connect-expired-password -uroot -p"$temp_password" -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';"
    write_root_defaults "$ROOT_PASSWORD"
    return 0
  fi

  if [[ -n "$ROOT_PASSWORD" ]] && mysql -uroot -e 'SELECT 1' >/dev/null 2>&1; then
    mysql -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';"
    write_root_defaults "$ROOT_PASSWORD"
    return 0
  fi

  echo "无法建立 root 连接。请确认 mysqld 已启动，并提供 ROOT_PASSWORD。" >&2
  exit 1
}

urlencode() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import quote
print(quote(sys.argv[1], safe=''))
PY
}

update_server_env_file() {
  local encoded_password
  encoded_password="$(urlencode "$APP_DB_PASS")"

  python3 - "$SERVER_ENV_FILE" "$APP_DB_USER" "$encoded_password" "$APP_DB_NAME" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
db_user = sys.argv[2]
db_pass = sys.argv[3]
db_name = sys.argv[4]
text = env_path.read_text() if env_path.exists() else ""
lines = []
replaced = False
for line in text.splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append(f"DATABASE_URL=mysql://{db_user}:{db_pass}@localhost:3306/{db_name}")
        replaced = True
    else:
        lines.append(line)
if not replaced:
    lines.append(f"DATABASE_URL=mysql://{db_user}:{db_pass}@localhost:3306/{db_name}")
env_path.write_text("\n".join(lines).rstrip() + "\n")
PY
}

require_command mysql
require_command systemctl
require_command python3

if [[ -z "$APP_DB_PASS" ]]; then
  echo "APP_DB_PASS 不能为空。" >&2
  exit 1
fi

ensure_root_access

mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS ${APP_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '${APP_DB_USER}'@'localhost';
CREATE USER '${APP_DB_USER}'@'localhost' IDENTIFIED WITH mysql_native_password BY '${APP_DB_PASS}';
GRANT ALL PRIVILEGES ON ${APP_DB_NAME}.* TO '${APP_DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

if [[ -n "$BACKUP_SQL" ]]; then
  if [[ ! -f "$BACKUP_SQL" ]]; then
    echo "BACKUP_SQL 指向的文件不存在：$BACKUP_SQL" >&2
    exit 1
  fi
  mysql_root "$APP_DB_NAME" < "$BACKUP_SQL"
fi

if [[ "$UPDATE_SERVER_ENV" == "1" ]]; then
  update_server_env_file
fi

echo "=== MySQL 8 初始化完成 ==="
mysql_root -N -e "SELECT VERSION(), @@version_comment; SHOW DATABASES LIKE '${APP_DB_NAME}';"
mysql_root -N -e "SELECT User, Host, plugin FROM mysql.user WHERE User='${APP_DB_USER}';"
