#!/bin/bash
# ============================================
# 督办管理系统 - 服务器端部署脚本
# 运行位置: 服务器 /root/duban/
# ============================================
set -e

REPO_DIR="${REPO_DIR:-/root/duban}"
REPO_URL="https://github.com/hnlige/note.git"
RUNTIME_ROOT="${RUNTIME_ROOT:-/opt/duban}"
INCOMING_DIR="${INCOMING_DIR:-$RUNTIME_ROOT/incoming}"
FRONTEND_ROOT="${FRONTEND_ROOT:-/var/www/duban}"
FRONTEND_TARGET="${FRONTEND_TARGET:-$FRONTEND_ROOT/dist}"
BACKEND_RUNTIME_DIR="${BACKEND_RUNTIME_DIR:-$RUNTIME_ROOT/server}"
BACKEND_TARGET="${BACKEND_TARGET:-$BACKEND_RUNTIME_DIR/dist}"
RELEASES_DIR="${RELEASES_DIR:-$RUNTIME_ROOT/releases}"
APP_CONTAINER="${APP_CONTAINER:-duban-app}"
LOG_DIR="${LOG_DIR:-/var/log/duban}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/deploy.log}"
PM2="/usr/local/lib/node_modules/pm2/bin/pm2"
SKIP_GIT_SYNC="${SKIP_GIT_SYNC:-0}"
DEPLOY_SERVER_LIB="$REPO_DIR/deploy/deploy-server-lib.sh"

mkdir -p "$LOG_DIR" "$INCOMING_DIR" "$RELEASES_DIR" "$BACKEND_RUNTIME_DIR" "$FRONTEND_ROOT"

# 新流程从运行时收件目录读取构建产物；旧主机尚未切换时回退到仓库内产物。
if [ -d "$INCOMING_DIR/backend" ] && [ -n "$(ls -A "$INCOMING_DIR/backend" 2>/dev/null)" ]; then
    BACKEND_SOURCE_DIR="$INCOMING_DIR/backend"
else
    BACKEND_SOURCE_DIR="$REPO_DIR/server/dist"
fi
if [ -d "$INCOMING_DIR/frontend" ] && [ -n "$(ls -A "$INCOMING_DIR/frontend" 2>/dev/null)" ]; then
    FRONTEND_SOURCE_DIR="$INCOMING_DIR/frontend"
else
    FRONTEND_SOURCE_DIR="$REPO_DIR/dist"
fi

if [ ! -f "$DEPLOY_SERVER_LIB" ]; then
    echo "[deploy] Missing deployment helper: $DEPLOY_SERVER_LIB" >&2
    exit 1
fi
# shellcheck source=deploy-server-lib.sh
source "$DEPLOY_SERVER_LIB"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "========================================"
log "  督办管理系统 - 开始部署"
log "========================================"

# 1. 同步源代码
log "[1/7] 同步源代码..."
cd "$REPO_DIR"
if [ "$SKIP_GIT_SYNC" = "1" ]; then
    log "  ⏭ 跳过 git 同步，直接使用已上传产物"
elif [ ! -d .git ]; then
    log "  ⚠ 当前目录不是 git 仓库，先重新拉取远端仓库"
    TMP_REPO="$(mktemp -d)"
    if git clone --branch main --single-branch "$REPO_URL" "$TMP_REPO/repo" >/dev/null 2>&1; then
        cp -a "$TMP_REPO/repo/." "$REPO_DIR/"
        git fetch origin main >/dev/null 2>&1 && git reset --hard origin/main >/dev/null 2>&1
        log "  ✅ 已重建 git 仓库并同步到 latest main"
    else
        log "  ❌ 无法从远端仓库拉取最新代码"
        rm -rf "$TMP_REPO"
        exit 1
    fi
    rm -rf "$TMP_REPO"
elif git fetch origin main 2>/dev/null; then
    git reset --hard origin/main >/dev/null 2>&1
    log "  ✅ 已强制同步到 origin/main"
else
    log "  ⚠ git fetch 失败（网络问题），继续使用服务器本地代码"
fi

# 2. 使用已构建产物
log "[2/7] 检查后端产物..."
if [ ! -d "$BACKEND_SOURCE_DIR" ] || [ -z "$(ls -A "$BACKEND_SOURCE_DIR" 2>/dev/null)" ]; then
    log "  ⚠ 缺少后端构建产物，尝试使用仓库内 tsc 直接构建..."
    if [ -x "$REPO_DIR/server/node_modules/.bin/tsc" ]; then
        (
            cd "$REPO_DIR/server"
            ./node_modules/.bin/tsc
        )
        BACKEND_SOURCE_DIR="$REPO_DIR/server/dist"
        log "  ✅ 后端已本地构建"
    else
        log "  ❌ 缺少后端构建产物，且未找到可用 tsc"
        exit 1
    fi
fi
log "  ✅ 已存在后端构建产物"

get_database_target_id_from_env_file() {
    local host_env_file="$1"

    (
        cd "$BACKEND_RUNTIME_DIR"
        DOTENV_CONFIG_PATH="$host_env_file" \
            DOTENV_CONFIG_OVERRIDE="true" \
            node -r dotenv/config -e '
const { getDatabaseTargetId, UNCONFIGURED_DATABASE_TARGET_ID } = require("./dist/health.js");
const targetId = getDatabaseTargetId(process.env.DATABASE_URL);
if (targetId === UNCONFIGURED_DATABASE_TARGET_ID) process.exit(1);
process.stdout.write(targetId);
'
    )
}

get_container_database_target_id() {
    docker exec "$APP_CONTAINER" node -e '
const { getDatabaseTargetId, UNCONFIGURED_DATABASE_TARGET_ID } = require("/app/server/dist/health.js");
const targetId = getDatabaseTargetId(process.env.DATABASE_URL);
if (targetId === UNCONFIGURED_DATABASE_TARGET_ID) process.exit(1);
process.stdout.write(targetId);
'
}

run_host_pm2() {
    local host_env_file="$1"
    local runtime_id="$2"
    shift 2

    (
        cd "$BACKEND_RUNTIME_DIR"
        DEPLOY_RUNTIME_ID="$runtime_id" \
            DOTENV_CONFIG_PATH="$host_env_file" \
            DOTENV_CONFIG_OVERRIDE="true" \
            node -r dotenv/config "$PM2" "$@"
    )
}

run_deploy_role_refresh() {
    local mode="$1"
    local expected_database_target_id="$2"
    local expected_runtime_id="$3"

    if [ "$mode" = "container" ]; then
        docker exec \
            -e EXPECTED_DATABASE_TARGET_ID="$expected_database_target_id" \
            -e EXPECTED_RUNTIME_ID="$expected_runtime_id" \
            -e DEPLOY_RUNTIME_ID="$expected_runtime_id" \
            "$APP_CONTAINER" \
            node /app/server/dist/db/deploy-role-refresh.js
        return
    fi

    if [ -z "$HOST_RUNTIME_ENV_FILE" ] || [ ! -f "$HOST_RUNTIME_ENV_FILE" ]; then
        log "  ❌ 缺少宿主机数据库配置文件，无法刷新内置角色"
        return 1
    fi

    (
        cd "$BACKEND_RUNTIME_DIR"
        EXPECTED_DATABASE_TARGET_ID="$expected_database_target_id" \
        EXPECTED_RUNTIME_ID="$expected_runtime_id" \
        DEPLOY_RUNTIME_ID="$expected_runtime_id" \
            DOTENV_CONFIG_PATH="$HOST_RUNTIME_ENV_FILE" \
            DOTENV_CONFIG_OVERRIDE="true" \
        node -r dotenv/config "$BACKEND_RUNTIME_DIR/dist/db/deploy-role-refresh.js"
    )
}

parse_public_health_identity() {
    local health_body="$1"

    node -e '
try {
  const payload = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const identity = [payload.releaseId, payload.databaseTargetId, payload.runtimeId];
  if (!identity.every((value) => typeof value === "string" && value.length > 0 && !/[\t\r\n]/.test(value))) {
    process.exit(1);
  }
  process.stdout.write(identity.join("\t"));
} catch {
  process.exit(1);
}
' <<< "$health_body"
}

wait_for_public_backend_ready() {
    local expected_release_id="$1"
    local host_runtime_updated="$2"
    local host_database_target_id="$3"
    local host_runtime_id="$4"
    local container_runtime_updated="$5"
    local container_database_target_id="$6"
    local container_runtime_id="$7"
    local health_url="http://127.0.0.1/api/health"
    # 2C2G 单机上结构补齐/角色刷新可能让冷启动超过 60s，放宽到 90 次（3 分钟）；仍不健康则照常失败。
    local max_attempts=90
    local attempt=1

    PUBLIC_RUNTIME_MODE=""
    if ! command -v curl >/dev/null 2>&1; then
        log "  ❌ 未找到 curl，无法确认公开 API 后端身份"
        return 1
    fi

    while [ "$attempt" -le "$max_attempts" ]; do
        local health_body=""
        local health_identity=""
        local matched_runtime=""
        if capture_command_output health_body \
            curl --fail --silent --show-error --max-time 2 "$health_url" \
            && capture_command_output health_identity parse_public_health_identity "$health_body"; then
            local public_release_id=""
            local public_database_target_id=""
            local public_runtime_id=""
            IFS=$'\t' read -r public_release_id public_database_target_id public_runtime_id <<< "$health_identity"

            if capture_command_output matched_runtime select_public_runtime \
                "$expected_release_id" \
                "$public_release_id" \
                "$public_database_target_id" \
                "$public_runtime_id" \
                "$host_runtime_updated" \
                "$host_database_target_id" \
                "$host_runtime_id" \
                "$container_runtime_updated" \
                "$container_database_target_id" \
                "$container_runtime_id"; then
                PUBLIC_RUNTIME_MODE="$matched_runtime"
                log "  ✅ 公开 API 已加载本次发布，运行时：$PUBLIC_RUNTIME_MODE"
                return 0
            fi
        fi

        if [ "$attempt" -lt "$max_attempts" ]; then
            log "  ⏳ 等待后端就绪（$attempt/$max_attempts）..."
            sleep 2
        fi
        attempt=$((attempt + 1))
    done

    log "  ❌ 公开 API 身份检查超时或无法唯一对应运行时：$health_url"
    return 1
}

# 3. 为本次后端产物生成唯一发布指纹
log "[3/7] 生成后端发布指纹..."
EXPECTED_RELEASE_ID="$(date -u '+%Y%m%dT%H%M%SZ')-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
HOST_RUNTIME_ID="${EXPECTED_RELEASE_ID}-host"
CONTAINER_RUNTIME_ID="${EXPECTED_RELEASE_ID}-container"
RELEASE_DIR="$RELEASES_DIR/$EXPECTED_RELEASE_ID"
BACKEND_RELEASE_DIR="$RELEASE_DIR/backend"
FRONTEND_RELEASE_DIR="$RELEASE_DIR/frontend"
mkdir -p "$BACKEND_RELEASE_DIR" "$FRONTEND_RELEASE_DIR"
cp -r "$BACKEND_SOURCE_DIR/." "$BACKEND_RELEASE_DIR/"
cp -r "$FRONTEND_SOURCE_DIR/." "$FRONTEND_RELEASE_DIR/"
printf '%s\n' "$EXPECTED_RELEASE_ID" > "$BACKEND_RELEASE_DIR/release-id.txt"
BACKEND_SOURCE_DIR="$BACKEND_RELEASE_DIR"
FRONTEND_SOURCE_DIR="$FRONTEND_RELEASE_DIR"
log "  ✅ 后端发布指纹已写入：$EXPECTED_RELEASE_ID"

# 4. 部署后端 + 重启服务
log "[4/7] 部署后端到 $BACKEND_TARGET..."
mkdir -p "$BACKEND_TARGET" "$BACKEND_RUNTIME_DIR"
cp "$REPO_DIR/server/ecosystem.config.js" "$BACKEND_RUNTIME_DIR/ecosystem.config.js"
cp -r "$BACKEND_SOURCE_DIR/"* "$BACKEND_TARGET/"
host_runtime_updated=0
container_runtime_updated=0
HOST_RUNTIME_ENV_FILE=""
HOST_DATABASE_TARGET_ID=""
CONTAINER_DATABASE_TARGET_ID=""

if HOST_RUNTIME_ENV_FILE="$(resolve_host_runtime_env_file "$BACKEND_RUNTIME_DIR")" \
    && HOST_DATABASE_TARGET_ID="$(get_database_target_id_from_env_file "$HOST_RUNTIME_ENV_FILE")"; then
    # 关键：pm2 7.x 的 restart / start(已存在) 不会用 --update-env 刷新应用 env，
    # DEPLOY_RUNTIME_ID 会一直停留在上次发布的旧值，导致 select_public_runtime 永远不匹配、
    # 自动角色刷新被跳过（即"每次部署后必须手动确认"的根因）。
    # 必须先 delete 再 start，强制 pm2 重新读取 ecosystem.config.js，
    # 使本次 DEPLOY_RUNTIME_ID（由 run_host_pm2 注入）真正进入 worker 进程环境。
    run_host_pm2 "$HOST_RUNTIME_ENV_FILE" "$HOST_RUNTIME_ID" delete duban-server 2>/dev/null || true
    if run_host_pm2 "$HOST_RUNTIME_ENV_FILE" "$HOST_RUNTIME_ID" start ecosystem.config.js --update-env 2>/dev/null; then
        log "  ✅ PM2 重启成功（已应用新运行时环境变量）"
        host_runtime_updated=1
    else
        log "  ❌ PM2 启动失败"
    fi
else
    log "  ⚠ 无法解析宿主机运行环境及数据库目标，跳过宿主机 PM2 更新"
fi

if command -v docker >/dev/null 2>&1 \
    && docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null | grep -qx true; then
    log "  检测到应用容器 $APP_CONTAINER，正在同步容器内 /app/server/dist..."
    docker exec "$APP_CONTAINER" mkdir -p /app/server/dist
    docker cp "$BACKEND_SOURCE_DIR/." "$APP_CONTAINER:/app/server/dist/"
    if docker exec \
        -e DEPLOY_RUNTIME_ID="$CONTAINER_RUNTIME_ID" \
        "$APP_CONTAINER" \
        pm2 restart /app/server/ecosystem.config.js --update-env 2>/dev/null \
        || docker exec \
        -e DEPLOY_RUNTIME_ID="$CONTAINER_RUNTIME_ID" \
        "$APP_CONTAINER" \
        pm2 start /app/server/ecosystem.config.js --update-env 2>/dev/null; then
        if CONTAINER_DATABASE_TARGET_ID="$(get_container_database_target_id)"; then
            log "  ✅ 容器后端已部署并重启"
            container_runtime_updated=1
        else
            log "  ❌ 无法确认容器数据库目标"
            exit 1
        fi
    else
        log "  ❌ 容器后端重启/启动失败"
        exit 1
    fi
fi

if [ "$host_runtime_updated" -ne 1 ] && [ "$container_runtime_updated" -ne 1 ]; then
    log "  ❌ 宿主机和容器均未成功更新后端运行时，终止部署"
    exit 1
fi

# 通过公开回环上游确认本次发布实际由哪个已更新运行时提供服务。
if ! wait_for_public_backend_ready "$EXPECTED_RELEASE_ID" \
    "$host_runtime_updated" \
    "$HOST_DATABASE_TARGET_ID" \
    "$HOST_RUNTIME_ID" \
    "$container_runtime_updated" \
    "$CONTAINER_DATABASE_TARGET_ID" \
    "$CONTAINER_RUNTIME_ID"; then
    log "  ❌ 公开 API 未唯一匹配本次发布、数据库目标和运行时，终止部署以避免刷新角色"
    exit 1
fi

selected_runtime="$PUBLIC_RUNTIME_MODE"
if [ "$selected_runtime" = "host" ]; then
    selected_database_target_id="$HOST_DATABASE_TARGET_ID"
    selected_runtime_id="$HOST_RUNTIME_ID"
elif [ "$selected_runtime" = "container" ]; then
    selected_database_target_id="$CONTAINER_DATABASE_TARGET_ID"
    selected_runtime_id="$CONTAINER_RUNTIME_ID"
else
    log "  ❌ 公开 API 返回了未知运行时，终止部署"
    exit 1
fi

# 5. 在选定运行时中补齐数据库结构并刷新内置角色
log "[5/7] 在 $selected_runtime 运行时刷新数据库结构与内置角色..."
if ! run_deploy_role_refresh "$selected_runtime" "$selected_database_target_id" "$selected_runtime_id"; then
    log "  ❌ 数据库结构或内置角色刷新失败，终止部署"
    exit 1
fi
log "  ✅ 数据库结构与内置角色已刷新"

# 6. 部署前端（从本地构建产物）
log "[6/7] 部署前端到 $FRONTEND_TARGET..."
if [ -d "$FRONTEND_SOURCE_DIR" ] && [ -n "$(ls -A "$FRONTEND_SOURCE_DIR" 2>/dev/null)" ]; then
    mkdir -p "$FRONTEND_TARGET"
    rm -rf "$FRONTEND_TARGET"/*
    cp -r "$FRONTEND_SOURCE_DIR/"* "$FRONTEND_TARGET/"
    # 安全兜底：即便产物源意外带出 .map（如构建配置回退），也不落到 web 根
    find "$FRONTEND_TARGET" -name '*.map' -type f -delete 2>/dev/null || true
    log "  ✅ 前端已部署到宿主机"

    if command -v docker >/dev/null 2>&1 \
        && docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null | grep -qx true; then
        log "  检测到前端容器 $APP_CONTAINER，正在同步容器内 /app/dist..."
        docker cp "$FRONTEND_SOURCE_DIR/." "$APP_CONTAINER:/app/dist/"
        docker exec "$APP_CONTAINER" sh -c "find /app/dist -name '*.map' -type f -delete" 2>/dev/null || true
        docker exec "$APP_CONTAINER" nginx -t
        docker exec "$APP_CONTAINER" nginx -s reload
        log "  ✅ 容器前端已部署并刷新 Nginx"
    fi
else
    log "  ⏭ 无前端 dist，跳过"
fi

# 7. 刷新 Nginx 配置，避免 /index.html 继续使用旧缓存
log "[7/7] 刷新 Nginx 配置..."
if [ "$selected_runtime" = "host" ]; then
cat > /tmp/duban.conf <<NGINX
server {
    listen 80;
    server_name _;

    root ${FRONTEND_TARGET};
    index index.html;

    # 附件上传上限 50MB，与后端 getMaxAttachmentBytes 保持一致（覆盖 http 级默认）
    client_max_body_size 50m;

    # 附件上传：50MB 大文件流式转发（不落盘缓冲），读超时与后端附件路由 180s 对齐
    location /api/attachments/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_request_buffering off;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 180s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        expires off;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    location ~ /\. {
        deny all;
    }

    # 安全：禁止下载 sourcemap，防止前端源码还原
    location ~* \.map$ {
        deny all;
    }
}
NGINX

if [ -d "/etc/nginx/sites-enabled" ]; then
    cp /tmp/duban.conf /etc/nginx/sites-available/duban.conf
    ln -sf /etc/nginx/sites-available/duban.conf /etc/nginx/sites-enabled/
elif [ -d "/etc/nginx/conf.d" ]; then
    cp /tmp/duban.conf /etc/nginx/conf.d/duban.conf
fi

if nginx -t; then
    systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true
    log "  ✅ Nginx 已刷新"
else
    log "  ❌ Nginx 配置校验失败"
    exit 1
fi
else
    log "  ⏭ 公开 API 使用容器运行时，保留现有容器上游配置"
fi

log "========================================"
log "  部署完成"
log "========================================"
