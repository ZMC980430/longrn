#!/usr/bin/env bash
#
# Longrn 插件构建脚本
# 同时构建 Obsidian 和 Logseq 插件
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================"
echo " Longrn 插件构建"
echo "================================================"
echo ""

# =====================================================
# 1. 构建核心库 (tsc)
# =====================================================
echo "[1/3] 构建核心库（TypeScript 编译）..."
npm run build
echo "✅ 核心库构建完成"
echo ""

# =====================================================
# 2. 构建 Obsidian 插件 (esbuild)
# =====================================================
echo "[2/3] 构建 Obsidian 插件（esbuild 打包）..."
npm run build:obsidian
echo "✅ Obsidian 插件构建完成"
echo ""

# =====================================================
# 3. 复制到 Obsidian vault 开发目录（可选）
# =====================================================
OBSIDIAN_VAULT_DIR="${OBSIDIAN_VAULT:-}"
if [ -n "$OBSIDIAN_VAULT_DIR" ]; then
  PLUGIN_DIR="$OBSIDIAN_VAULT_DIR/.obsidian/plugins/longrn-learning-path"
  echo "[3/3] 部署到 Obsidian vault: $PLUGIN_DIR"
  mkdir -p "$PLUGIN_DIR"
  cp dist/obsidian-plugin/main.js "$PLUGIN_DIR/main.js"
  cp dist/obsidian-plugin/manifest.json "$PLUGIN_DIR/manifest.json"
  if [ -f dist/obsidian-plugin/styles.css ]; then
    cp dist/obsidian-plugin/styles.css "$PLUGIN_DIR/styles.css"
  fi
  echo "✅ 部署完成"
else
  echo "[3/3] 跳过部署（设置 OBSIDIAN_VAULT 环境变量可自动部署）"
  echo "   示例: OBSIDIAN_VAULT=/path/to/your/vault ./scripts/build-plugins.sh"
fi

echo ""
echo "================================================"
echo " 全部构建完成！"
echo "  - dist/core/        : 核心库"
echo "  - dist/obsidian-plugin/ : Obsidian 插件 (已打包)"
echo "  - dist/logseq-plugin/   : Logseq 插件"
echo "================================================"
