/**
 * Minimal type declarations for `@xenova/transformers`.
 *
 * Only declares the `pipeline()` factory and `FeatureExtractionPipeline`
 * return type — the minimal surface used by EmbeddingEngine.
 *
 * The full library provides much more (text generation, image models, etc.),
 * but only feature extraction is needed for semantic embeddings.
 */
declare module '@xenova/transformers' {
  export interface FeatureExtractionPipeline {
    (text: string, options?: { pooling?: string; normalize?: boolean }): Promise<{ data: Float32Array }>;
  }
  export function pipeline(task: string, modelName?: string, options?: Record<string, unknown>): Promise<FeatureExtractionPipeline>;
}
