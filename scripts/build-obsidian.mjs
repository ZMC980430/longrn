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

  // 1. 清除目录中的所有现有文件，确保 tsc 旧输出不会混淆
  for (const f of readdirSync(outDir)) {
    rmSync(join(outDir, f), { recursive: true });
  }
  console.log('   Cleaned output directory');

  // 2. 用 esbuild 打包 Obsidian 插件
  await esbuild.build({
    entryPoints: [resolve(rootDir, 'src/obsidian-plugin/main.ts')],
    bundle: true,
    outfile: resolve(outDir, 'main.js'),
    external: [
      'obsidian',
    ],
    // ---- Plugins ----
    plugins: [
      {
        name: 'stub-transformers-node-deps',
        setup(build) {
          // @xenova/transformers unconditionally requires onnxruntime-node
          // (in onnx.js) plus fs/path/url/worker_threads (in env.js etc).
          // In Obsidian's Electron renderer, native addons and some Node
          // builtins are unavailable. We force the browser/WASM path via
          // process.release.name, but the require() calls still execute.
          // Replace them with harmless stubs.
          const stubList = [
            'fs',
            'path',
            'url',
            'onnxruntime-node',
            'worker_threads',
            'sharp',
          ];
          const stubFilter = new RegExp(
            '^(' + stubList.join('|') + ')$',
          );
          build.onResolve({ filter: stubFilter }, (args) => {
            // Only stub inside @xenova/transformers.
            // Our own core modules genuinely need fs, path, crypto etc.
            if (args.importer.includes('@xenova')) {
              return { path: args.path, namespace: 'stub' };
            }
            return undefined; // let esbuild handle normally
          });
          build.onLoad(
            { filter: /.*/, namespace: 'stub' },
            () => ({ contents: 'module.exports = {};', loader: 'js' }),
          );
        },
      },
    ],
    // ---- /Plugins ----
    format: 'cjs',
    target: 'ES2020',
    logLevel: 'info',
    sourcemap: false,
    treeShaking: true,
    platform: 'node',
    // Use 'browser' condition so @xenova/transformers resolves its
    // browser entry (onnxruntime-web) over the Node.js one (onnxruntime-node).
    conditions: ['browser'],
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
