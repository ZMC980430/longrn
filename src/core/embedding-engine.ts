/**
 * Semantic embedding engine powered by Transformers.js.
 *
 * Wraps @xenova/transformers' feature-extraction pipeline to generate
 * L2-normalized sentence embeddings using a lightweight model
 * (Xenova/all-MiniLM-L6-v2, 384 dimensions).
 *
 * The model is loaded lazily on first use to avoid startup cost for
 * consumers that don't need embeddings (e.g. non-semantic path planning).
 */

// Module-level lazy pipeline factory — shared across all EmbeddingEngine instances.
let pipelineFn: ((...args: any[]) => Promise<any>) | null = null;

type FeatureExtractionResult = { data: Float32Array };

export class EmbeddingEngine {
  private model: ((text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<FeatureExtractionResult>) | null = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private dims = 384;

  /**
   * Loads the model on first call. Subsequent calls are no-ops.
   * Downloads the model (~80MB) on first use via Transformers.js.
   */
  async loadModel(): Promise<void> {
    if (this.model) return;
    if (!pipelineFn) {
      const mod = await import('@xenova/transformers');
      pipelineFn = mod.pipeline;
    }
    this.model = await pipelineFn('feature-extraction', this.modelName);
    console.log(`EmbeddingEngine: model "${this.modelName}" loaded`);
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
