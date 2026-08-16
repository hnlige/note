#!/bin/bash
# Rotate the MySQL application account password and token-signing secret.
# Real values are generated on the server and remain in its private .env file.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/duban}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-/opt/duban/server/.env}"
PM2_BIN="${PM2_BIN:-/usr/local/lib/node_modules/pm2/bin/pm2}"

if [ ! -f "$SERVER_ENV_FILE" ]; then
  echo "[rotate] missing private runtime environment file" >&2
  exit 1
fi

read_runtime_database_target() {
  node - "$SERVER_ENV_FILE" <<'NODE'
const fs = require('fs');
const envFile = process.argv[2];
const content = fs.readFileSync(envFile, 'utf8');
const databaseUrl = content.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const authSecret = content.match(/^AUTH_TOKEN_SECRET=(.+)$/m)?.[1]?.trim();
if (!databaseUrl || !authSecret) process.exit(1);
const url = new URL(databaseUrl);
if (!url.username || !url.hostname || !url.pathname) process.exit(1);
process.stdout.write([
  decodeURIComponent(url.username),
  url.hostname,
  url.port || '3306',
  url.pathname.slice(1),
].join('\t') + '\n');
NODE
}

IFS=$'\t' read -r DB_USER DB_HOST DB_PORT DB_NAME < <(read_runtime_database_target)
# Prefix guarantees MySQL's mixed-case, digit, and special-character policy;
# the random suffix provides the entropy. Node URL serialization encodes it safely.
NEW_DB_PASSWORD="Aa1!$(openssl rand -hex 32)"
NEW_AUTH_TOKEN_SECRET="$(openssl rand -hex 48)"

mapfile -t DB_ACCOUNT_HOSTS < <(mysql -N -u root -e "SELECT Host FROM mysql.user WHERE User = '${DB_USER}'")
if [ "${#DB_ACCOUNT_HOSTS[@]}" -eq 0 ]; then
  echo "[rotate] database application account was not found" >&2
  exit 1
fi

for DB_ACCOUNT_HOST in "${DB_ACCOUNT_HOSTS[@]}"; do
  mysql -u root -e "ALTER USER \`${DB_USER}\`@\`${DB_ACCOUNT_HOST}\` IDENTIFIED BY '${NEW_DB_PASSWORD}'"
done
mysql -u root -e 'FLUSH PRIVILEGES'

MYSQL_PWD="$NEW_DB_PASSWORD" mysql --protocol=TCP -u "$DB_USER" -h 127.0.0.1 -P "$DB_PORT" -D "$DB_NAME" -Nse 'SELECT 1' | grep -qx '1'
MYSQL_PWD="$NEW_DB_PASSWORD" mysql --protocol=TCP -u "$DB_USER" -h localhost -P "$DB_PORT" -D "$DB_NAME" -Nse 'SELECT 1' | grep -qx '1'

SERVER_ENV_FILE="$SERVER_ENV_FILE" NEW_DB_PASSWORD="$NEW_DB_PASSWORD" NEW_AUTH_TOKEN_SECRET="$NEW_AUTH_TOKEN_SECRET" node <<'NODE'
const fs = require('fs');
const envFile = process.env.SERVER_ENV_FILE;
const nextFile = `${envFile}.next-${process.pid}`;
const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
let updatedDatabaseUrl = false;
let updatedAuthSecret = false;
const nextLines = lines.map((line) => {
  if (line.startsWith('DATABASE_URL=')) {
    const url = new URL(line.slice('DATABASE_URL='.length));
    url.password = process.env.NEW_DB_PASSWORD;
    updatedDatabaseUrl = true;
    return `DATABASE_URL=${url.toString()}`;
  }
  if (line.startsWith('AUTH_TOKEN_SECRET=')) {
    updatedAuthSecret = true;
    return `AUTH_TOKEN_SECRET=${process.env.NEW_AUTH_TOKEN_SECRET}`;
  }
  return line;
});
if (!updatedDatabaseUrl) throw new Error('DATABASE_URL is missing');
if (!updatedAuthSecret) nextLines.push(`AUTH_TOKEN_SECRET=${process.env.NEW_AUTH_TOKEN_SECRET}`);
fs.writeFileSync(nextFile, nextLines.join('\n'), { mode: 0o600 });
fs.renameSync(nextFile, envFile);
fs.chmodSync(envFile, 0o600);
NODE

cd "$REPO_DIR/server"
DOTENV_CONFIG_PATH="$SERVER_ENV_FILE" DOTENV_CONFIG_OVERRIDE=true \
  node -r dotenv/config "$PM2_BIN" reload duban-server --update-env

curl -fsS --max-time 10 http://127.0.0.1/api/health | node -e '
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  if (payload.status !== "ok") process.exit(1);
  console.log(JSON.stringify({ status: payload.status, releaseId: payload.releaseId, runtimeId: payload.runtimeId }));
});
'
