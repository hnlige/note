#!/bin/bash
# ============================================
# 低频清理本地构建残留
# 作用: 删除前端构建产生的 .dist-prev-* 历史目录（emptyOutDir:false 后不会自动清理）
# 注意: 本脚本会删除较多文件，可能触发一次 WorkBuddy 安全删除守卫确认，属低频操作，点确认即可。
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "============================================"
echo "  本地构建残留清理"
echo "============================================"

PREV_DIRS=( "$PROJECT_DIR"/.dist-prev-* )
if [ ! -d "${PREV_DIRS[0]}" ]; then
    echo "  没有发现 .dist-prev-* 残留目录，无需清理。"
    exit 0
fi

echo "  将删除以下目录："
ls -d "${PREV_DIRS[@]}" 2>/dev/null || true
echo "  合计占用："
du -sh "${PREV_DIRS[@]}" 2>/dev/null | tail -1 || true
echo ""

rm -rf "${PREV_DIRS[@]}"

echo "  ✅ 已清理本地 .dist-prev-* 残留目录"
echo "============================================"
