/**
 * Semantic embedding engine powered by Transformers.js.
 *
 * Wraps @xenova/transformers' feature-extraction pipeline to generate
 * L2-normalized sentence embeddings using a lightweight model
 * (Xenova/all-MiniLM-L6-v2, 384 dimensions).
 *
 * ## Electron / Obsidian compatibility
 *
 * @xenova/transformers detects `process.release.name === "node"` and
 * tries to load the native `onnxruntime-node` addon — which cannot be
 * bundled. We work around this by:
 *
 * 1. Temporarily setting `process.release.name = "browser"` before import
 *    so the library picks the Web (WASM) ONNX backend.
 * 2. The esbuild plugin in `scripts/build-obsidian.mjs` stubs the
 *    `onnxruntime-node` require to prevent a runtime crash from the
 *    unconditional `require("onnxruntime-node")` inside onnx.js.
 * 3. The ONNX WASM files load from the jsDelivr CDN at:
 *    `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/`
 */

// Module-level lazy pipeline factory — shared across all EmbeddingEngine instances.
let pipelineFn: ((task: string, model: string) => Promise<unknown>) | null = null;

type FeatureExtractionResult = { data: Float32Array };

export class EmbeddingEngine {
  private model: ((text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<FeatureExtractionResult>) | null = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private dims = 384;

  /**
   * Loads the model on first call. Subsequent calls are no-ops.
   *
   * In Obsidian's Electron renderer, we override process.release.name
   * to "browser" so @xenova/transformers uses onnxruntime-web (WASM)
   * instead of onnxruntime-node (native addon). The esbuild build script
   * stubs the onnxruntime-node require to prevent a crash from the
   * unconditional require inside the library's onnx.js backend init.
   *
   * The model (~80 MB) downloads from HuggingFace Hub on first use.
   * ONNX WASM runtime files load from jsDelivr CDN.
   *
   * @throws If @xenova/transformers cannot be loaded or model fails to initialize.
   */
  async loadModel(): Promise<void> {
    if (this.model) return;
    if (!pipelineFn) {
      // ---- Phase 1: Import @xenova/transformers ----
      // Force the browser (WASM) ONNX backend by faking the runtime env.
      const release: Record<string, unknown> | null = (typeof process !== 'undefined' && process.release)
        ? process.release as unknown as Record<string, unknown> : null;
      const savedReleaseName: string | undefined = release?.name as string | undefined;
      if (release) release.name = 'browser';

      try {
        // Dynamic import is resolved to an in-bundle module by esbuild.
        const mod = await import('@xenova/transformers');
        pipelineFn = mod.pipeline;

        // ---- Phase 2: Configure ONNX WASM paths ----
        // The bundled env.js sets wasmPaths to a CDN URL when it detects
        // we are NOT running locally (because fs/path stubs are empty).
        // We explicitly set the CDN path as a fallback to be safe.
        try {
          const ortEnv = (mod as Record<string, unknown>).env as Record<string, unknown> | undefined;
          const onnx = (ortEnv?.backends as Record<string, unknown> | undefined)?.onnx as Record<string, unknown> | undefined;
          const onnxWasm = onnx?.wasm as Record<string, unknown> | undefined;
          if (onnxWasm && (onnxWasm.wasmPaths === undefined || onnxWasm.wasmPaths === './')) {
            // CDN fallback — the official Transformers.js CDN endpoint.
            onnxWasm.wasmPaths =
              'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
          }
        } catch (_) {
          // env not accessible — library will use its own default.
        }
      } finally {
        // Restore original value to avoid side effects on other code.
        if (release && savedReleaseName !== undefined) {
          release.name = savedReleaseName;
        }
      }
    }

    // ---- Phase 3: Load the model ----
    try {
      this.model = await pipelineFn('feature-extraction', this.modelName) as unknown as typeof this.model;
      console.log(`EmbeddingEngine: model "${this.modelName}" loaded`);
    } catch (err: unknown) {
      throw new Error(
        `无法加载语义模型 "${this.modelName}"。\n` +
        `首次使用需联网下载模型（约 80MB），请检查网络连接。\n` +
        `原始错误: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Embeds a single text string into a 384-dimensional L2-normalized vector.
   * Text is truncated to 2000 characters to avoid excessive computation.
   */
  async embed(text: string): Promise<number[]> {
    if (!this.model) await this.loadModel();
    const truncated = text.slice(0, 2000);
    const result = await this.model!(truncated, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(result.data as Float32Array);
  }

  /**
   * Embeds multiple texts in parallel batches.
   * @param batchSize - Number of concurrent embeddings (default 32)
   */
  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }

  /** Whether the model has been loaded. */
  isLoaded(): boolean {
    return this.model !== null;
  }

  /** Returns the embedding dimensionality (e.g. 384). */
  getDimensions(): number {
    return this.dims;
  }

  /** Returns the HuggingFace model ID (e.g. "Xenova/all-MiniLM-L6-v2"). */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Computes cosine similarity between two L2-normalized vectors.
   * Since both vectors are normalized, this reduces to a dot product.
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) throw new Error('Vector dimensions mismatch');
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }
}
