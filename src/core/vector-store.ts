import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Note } from './knowledge-builder.js';

/** A note paired with its similarity score (for search results). */
export interface ScoredNote {
  note: Note;
  score: number;
}

/**
 * Persistent index for vector embeddings.
 *
 * Stores L2-normalized embedding vectors in a JSON file
 * at `<vaultPath>/.longrn/embeddings.json`.
 *
 * Supports:
 * - Upsert (insert or update by note ID)
 * - Content-hash-based cache invalidation
 * - Cosine similarity (via dot product on normalized vectors) search
 */
export interface VectorIndex {
  modelName: string;
  dimensions: number;
  updatedAt: string;
  entries: Record<string, {
    embedding: number[];
    contentHash: string;
    cachedAt: string;
  }>;
}

export class VectorStore {
  private indexPath: string;
  public index: VectorIndex;

  /**
   * @param vaultPath - Base path of the vault (store sits at vaultPath/.longrn/)
   * @param modelName - Name of the embedding model used
   * @param dimensions - Vector dimensionality (e.g. 384 for all-MiniLM-L6-v2)
   */
  constructor(
    vaultPath: string,
    modelName: string,
    dimensions: number,
  ) {
    const storeDir = path.join(vaultPath, '.longrn');
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    this.indexPath = path.join(storeDir, 'embeddings.json');
    this.index = { modelName, dimensions, updatedAt: '', entries: {} };
  }

  /** Loads the vector index from disk. Returns false if no cached index exists. */
  load(): boolean {
    try {
      if (!fs.existsSync(this.indexPath)) return false;
      const raw = fs.readFileSync(this.indexPath, 'utf-8');
      this.index = JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  /** Persists the vector index to disk as JSON. */
  save(): void {
    this.index.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  /** Inserts or updates an embedding entry. */
  upsert(noteId: string, embedding: number[], contentHash: string): void {
    this.index.entries[noteId] = {
      embedding,
      contentHash,
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Checks whether a note needs re-embedding.
   * Returns true if the note was never cached, or its content hash has changed.
   */
  needsRefresh(noteId: string, contentHash: string): boolean {
    const entry = this.index.entries[noteId];
    if (!entry) return true;
    if (entry.contentHash !== contentHash) return true;
    return false;
  }

  /**
   * Searches the top-k notes by dot-product similarity.
   * All vectors are assumed L2-normalized, so dot product = cosine similarity.
   */
  search(queryEmbedding: number[], k: number, notes: Note[]): ScoredNote[] {
    const scored: ScoredNote[] = [];
    for (const note of notes) {
      const entry = this.index.entries[note.id];
      if (!entry?.embedding) continue;
      const score = this.dotProduct(queryEmbedding, entry.embedding);
      scored.push({ note, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Computes dot product between two equal-length vectors. */
  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /** Computes an MD5 content hash for cache invalidation. */
  static hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /** Retrieves a cached embedding by note ID, or null if not found. */
  getEntry(noteId: string): number[] | null {
    return this.index.entries[noteId]?.embedding ?? null;
  }
}
