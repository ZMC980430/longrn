// @xenova/transformers is loaded lazily via dynamic import to avoid
// blocking consumers that don't need real embeddings (e.g. tests).
let pipelineFn: ((...args: any[]) => Promise<any>) | null = null;

type FeatureExtractionResult = { data: Float32Array };

export class EmbeddingEngine {
  private model: ((text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<FeatureExtractionResult>) | null = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private dims = 384;

  async loadModel(): Promise<void> {
    if (this.model) return;
    if (!pipelineFn) {
      const mod = await import('@xenova/transformers');
      pipelineFn = mod.pipeline;
    }
    this.model = await pipelineFn('feature-extraction', this.modelName);
    console.log(`EmbeddingEngine: model "${this.modelName}" loaded`);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.model) await this.loadModel();
    const truncated = text.slice(0, 2000);
    const result = await this.model!(truncated, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(result.data as Float32Array);
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }

  isLoaded(): boolean {
    return this.model !== null;
  }

  getDimensions(): number {
    return this.dims;
  }

  getModelName(): string {
    return this.modelName;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) throw new Error('Vector dimensions mismatch');
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot; // Already L2-normalized
  }
}
