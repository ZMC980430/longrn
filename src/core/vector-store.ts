import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Note } from './knowledge-builder.js';

export interface ScoredNote {
  note: Note;
  score: number;
}

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

  save(): void {
    this.index.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  upsert(noteId: string, embedding: number[], contentHash: string): void {
    this.index.entries[noteId] = {
      embedding,
      contentHash,
      cachedAt: new Date().toISOString(),
    };
  }

  needsRefresh(noteId: string, contentHash: string): boolean {
    const entry = this.index.entries[noteId];
    if (!entry) return true; // never cached
    if (entry.contentHash !== contentHash) return true; // content changed
    return false;
  }

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

  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  static hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  getEntry(noteId: string): number[] | null {
    return this.index.entries[noteId]?.embedding ?? null;
  }
}
