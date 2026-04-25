import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingEngine } from './embedding-engine.js';
import { VectorStore, ScoredNote } from './vector-store.js';

export interface Note {
  id: string;
  title: string;
  path: string;
  content: string;
  tags: string[];
  links: string[];
  embeddings?: number[];
}

export interface KnowledgeGraph {
  nodes: Map<string, Note>;
  edges: Map<string, { from: string; to: string; type: 'link' | 'tag' }>;
}

export class KnowledgeBaseBuilder {
  private embeddingEngine?: EmbeddingEngine;
  private vectorStore?: VectorStore;

  scanVault(vaultPath: string): Note[] {
    const files = fs.readdirSync(vaultPath).filter(f => f.endsWith('.md'));
    return files.map(file => {
      const filePath = path.join(vaultPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = this.parseNote(content, file);
      return {
        id: uuidv4(),
        title: parsed.title,
        path: file,
        content,
        tags: parsed.tags,
        links: parsed.links
      };
    });
  }

  parseNote(content: string, fileName: string = ''): { title: string; tags: string[]; links: string[] } {
    const lines = content.split('\n');
    const title = lines[0].startsWith('# ') ? lines[0].substring(2).trim() : fileName.replace(/\.md$/i, '');
    const tags = (content.match(/#[\w]+/g) || []).map(tag => tag.substring(1));
    const links = (content.match(/\[\[([^\]]+)\]\]/g) || []).map(link => link.slice(2, -2));
    return { title, tags, links };
  }

  buildGraph(notes: Note[]): KnowledgeGraph {
    const nodes = new Map<string, Note>();
    const edges = new Map<string, { from: string; to: string; type: 'link' | 'tag' }>();

    notes.forEach(note => {
      nodes.set(note.id, note);
      note.links.forEach(link => {
        const linkedNote = notes.find(n => n.title === link);
        if (linkedNote) {
          edges.set(`${note.id}-${linkedNote.id}`, { from: note.id, to: linkedNote.id, type: 'link' });
        }
      });
      note.tags.forEach(tag => {
        notes.forEach(other => {
          if (other.id !== note.id && other.tags.includes(tag)) {
            edges.set(`${note.id}-${other.id}-tag`, { from: note.id, to: other.id, type: 'tag' });
          }
        });
      });
    });

    return { nodes, edges };
  }

  // ===== Phase 2: Semantic Embedding =====

  async embedAll(notes: Note[], vaultPath: string): Promise<void> {
    this.embeddingEngine = new EmbeddingEngine();
    await this.embeddingEngine.loadModel();

    this.vectorStore = new VectorStore(
      vaultPath,
      this.embeddingEngine.getModelName(),
      this.embeddingEngine.getDimensions(),
    );
    this.vectorStore.load();

    const toEmbed: Note[] = [];
    const texts: string[] = [];

    for (const note of notes) {
      const contentHash = VectorStore.hashContent(note.content);
      if (!this.vectorStore.needsRefresh(note.id, contentHash)) {
        // Restore from cache
        const cached = this.vectorStore.getEntry(note.id);
        if (cached) {
          note.embeddings = cached;
        }
        continue;
      }
      toEmbed.push(note);
      texts.push(`${note.title}\n${note.content.slice(0, 1000)}`);
    }

    if (toEmbed.length > 0) {
      const embeddings = await this.embeddingEngine.embedBatch(texts);
      embeddings.forEach((emb, i) => {
        const note = toEmbed[i];
        note.embeddings = emb;
        this.vectorStore!.upsert(note.id, emb, VectorStore.hashContent(note.content));
      });
      this.vectorStore.save();
    }

    // Restore remaining from cache that weren't in toEmbed
    for (const note of notes) {
      if (!note.embeddings) {
        const cached = this.vectorStore.getEntry(note.id);
        if (cached) {
          note.embeddings = cached;
        }
      }
    }
  }

  async searchSemantic(query: string, notes: Note[], k = 5): Promise<ScoredNote[]> {
    if (!this.embeddingEngine || !this.vectorStore) {
      throw new Error('EmbeddingEngine not loaded. Call embedAll() first.');
    }
    const queryEmb = await this.embeddingEngine.embed(query);
    return this.vectorStore.search(queryEmb, k, notes);
  }

  getEmbeddingEngine(): EmbeddingEngine | undefined {
    return this.embeddingEngine;
  }

  getVectorStore(): VectorStore | undefined {
    return this.vectorStore;
  }
}