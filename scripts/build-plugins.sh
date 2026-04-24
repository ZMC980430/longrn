#!/usr/bin/env bash
set -euo pipefail

echo "Building TypeScript project..."

# 使用根目录 package.json 中的构建任务
npm run build

echo "Build finished."
