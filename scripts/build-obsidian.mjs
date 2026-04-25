#!/usr/bin/env node

/**
 * Obsidian 插件构建脚本
 *
 * 使用 esbuild 将 Obsidian 插件打包为单个 main.js 文件。
 * Obsidian 要求插件以单个文件形式加载，且 obsidian API 模块由运行环境提供（标记为 external）。
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = resolve(rootDir, 'dist', 'obsidian-plugin');

async function build() {
  // 确保输出目录存在
  mkdirSync(outDir, { recursive: true });

  // 1. 清除 tsc 输出的多余文件（Obsidian 只需要 esbuild 打包的 main.js）
  const tscFiles = readdirSync(outDir).filter(f =>
    f.endsWith('.d.ts') || f.endsWith('.js.map')
  );
  for (const f of tscFiles) {
    rmSync(join(outDir, f));
  }
  if (tscFiles.length > 0) {
    console.log(`   Cleaned ${tscFiles.length} tsc-generated files from output`);
  }

  // 2. 用 esbuild 打包 Obsidian 插件
  await esbuild.build({
    entryPoints: [resolve(rootDir, 'src/obsidian-plugin/main.ts')],
    bundle: true,
    outfile: resolve(outDir, 'main.js'),
    external: [
      'obsidian',
      '@xenova/transformers',
      'onnxruntime-node',
      'onnxruntime-web',
    ],
    format: 'cjs',
    target: 'ES2020',
    logLevel: 'info',
    sourcemap: false,
    treeShaking: true,
    platform: 'node',
    loader: {
      '.ts': 'ts',
    },
  });

  // 2. 复制 manifest.json
  const manifestSrc = resolve(rootDir, 'src/obsidian-plugin/manifest.json');
  const manifestDest = resolve(outDir, 'manifest.json');
  if (existsSync(manifestSrc)) {
    copyFileSync(manifestSrc, manifestDest);
    console.log(`Copied manifest.json → ${manifestDest}`);
  } else {
    console.error('WARNING: manifest.json not found at', manifestSrc);
    process.exit(1);
  }

  // 3. 如果有 styles.css 则复制（可选）
  const stylesSrc = resolve(rootDir, 'src/obsidian-plugin/styles.css');
  const stylesDest = resolve(outDir, 'styles.css');
  if (existsSync(stylesSrc)) {
    copyFileSync(stylesSrc, stylesDest);
    console.log(`Copied styles.css → ${stylesDest}`);
  }

  console.log('\n✅ Obsidian plugin built successfully!');
  console.log(`   Output: ${outDir}/main.js (bundled)`);
  console.log(`          ${outDir}/manifest.json`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
