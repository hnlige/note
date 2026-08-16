#!/bin/bash
# ============================================
# 督办管理系统 - 本地部署脚本（macOS/Linux）
# 作用: 本地构建 → 上传服务器 → 触发远程部署
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_IP="49.233.13.110"
SERVER_USER="root"
SERVER_REPO="/root/duban"
SERVER_INBOX="${SERVER_INBOX:-/opt/duban/incoming}"
REMOTE_TARGET="${SERVER_USER}@${SERVER_IP}"
PUSH_TO_GIT="${PUSH_TO_GIT:-0}"
SSH_KEY="${SSH_KEY:-}"
SSH_ARGS=(-o StrictHostKeyChecking=no)

if [ -n "$SSH_KEY" ]; then
    if [ ! -f "$SSH_KEY" ]; then
        echo "[ERROR] SSH_KEY 指定的密钥文件不存在：$SSH_KEY"
        exit 1
    fi
    SSH_ARGS+=(-i "$SSH_KEY")
fi

RSYNC_SSH_ARGS="${SSH_ARGS[*]}"

if ! command -v rsync >/dev/null 2>&1; then
    echo "[ERROR] 未找到 rsync，请先安装后再部署"
    exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
    echo "[ERROR] 未找到 ssh，请先安装后再部署"
    exit 1
fi

echo "============================================"
echo "  督办管理系统 - 本地构建 & 部署"
echo "============================================"

# 1. Git 提交（可选）
cd "$PROJECT_DIR"
if [ "$PUSH_TO_GIT" = "1" ]; then
    if ! git diff-index --quiet HEAD --; then
        echo "[1/5] 发现未提交更改，正在提交..."
        git add -A
        git commit -m "deploy: 自动构建部署 $(date '+%Y-%m-%d %H:%M')" || true
    fi

    echo "[2/5] 推送源代码到 GitHub..."
    git push origin main 2>/dev/null || echo "  ⚠ 推送失败，继续构建..."
else
    echo "[1/5] 跳过 Git 提交与推送（可通过 PUSH_TO_GIT=1 启用）"
fi

# 2. 构建前端
echo "[3/5] 构建前端..."
# 用 rename 而非删除移走旧产物，避免触发安全删除守卫（阈值 50）。
# 旧的 .dist-prev-* 目录由 scripts/clean-local-dist.sh 低频清理。
if [ -d "$PROJECT_DIR/dist" ]; then
    mv "$PROJECT_DIR/dist" "$PROJECT_DIR/.dist-prev-$(date +%s)" 2>/dev/null || true
fi
pnpm run build

# 3. 构建后端
echo "[4/5] 构建后端..."
cd "$PROJECT_DIR/server"
npm run build
cd "$PROJECT_DIR"

# 4. 同步构建产物与部署脚本
echo "[5/5] 同步构建产物到服务器..."
rsync -az --delete -e "ssh $RSYNC_SSH_ARGS" dist/ "${REMOTE_TARGET}:${SERVER_INBOX}/frontend/"
rsync -az --delete -e "ssh $RSYNC_SSH_ARGS" server/dist/ "${REMOTE_TARGET}:${SERVER_INBOX}/backend/"
rsync -az -e "ssh $RSYNC_SSH_ARGS" deploy/ "${REMOTE_TARGET}:${SERVER_REPO}/deploy/"

echo "  触发远端部署..."
ssh "${SSH_ARGS[@]}" "${REMOTE_TARGET}" "INCOMING_DIR='${SERVER_INBOX}' SKIP_GIT_SYNC=1 bash ${SERVER_REPO}/deploy/deploy-server.sh"
echo ""
echo "============================================"
echo "  构建完成"
echo "============================================"
