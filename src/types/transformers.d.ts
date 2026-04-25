declare module '@xenova/transformers' {
  export interface FeatureExtractionPipeline {
    (text: string, options?: { pooling?: string; normalize?: boolean }): Promise<{ data: Float32Array }>;
  }
  export function pipeline(task: string, modelName?: string, options?: Record<string, unknown>): Promise<FeatureExtractionPipeline>;
}
