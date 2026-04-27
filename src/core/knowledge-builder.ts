import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingEngine } from './embedding-engine.js';
import { VectorStore, ScoredNote } from './vector-store.js';

/**
 * Represents a single note/article from the user's knowledge base.
 */
export interface Note {
  /** Unique identifier (UUID for scanned notes, file path for Obsidian) */
  id: string;
  /** Note title, extracted from first # heading or file name */
  title: string;
  /** Relative file path within vault */
  path: string;
  /** Full Markdown content */
  content: string;
  /** Extracted #tags */
  tags: string[];
  /** Extracted [[wikilinks]] */
  links: string[];
  /** Optional semantic embedding vector (set after embedAll) */
  embeddings?: number[];
}

/**
 * Directed graph representing relationships between notes.
 * Nodes = notes, Edges = link/tag relationships.
 */
export interface KnowledgeGraph {
  nodes: Map<string, Note>;
  edges: Map<string, { from: string; to: string; type: 'link' | 'tag' }>;
}

/**
 * Core engine for scanning, parsing, and building a knowledge graph.
 *
 * Responsibilities:
 * - Scan a directory of Markdown files
 * - Extract title, tags, and wikilinks from each file
 * - Build a graph structure based on links and shared tags
 * - Generate and cache semantic embeddings (Phase 2)
 */
export class KnowledgeBaseBuilder {
  private embeddingEngine?: EmbeddingEngine;
  private vectorStore?: VectorStore;

  /**
   * Scans a directory for .md files and parses each into a Note.
   * @param vaultPath - Absolute path to the vault directory
   * @returns Array of parsed Note objects
   */
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

  /**
   * Parses a Markdown string to extract title, tags, and links.
   * Title → first `# Title` line, or file name if absent.
   * Tags → `#tag` patterns (word characters only).
   * Links → `[[wikilink]]` patterns.
   */
  parseNote(content: string, fileName: string = ''): { title: string; tags: string[]; links: string[] } {
    const lines = content.split('\n');
    const title = lines[0].startsWith('# ') ? lines[0].substring(2).trim() : fileName.replace(/\.md$/i, '');
    const tags = (content.match(/#[\w]+/g) || []).map(tag => tag.substring(1));
    const links = (content.match(/\[\[([^\]]+)\]\]/g) || []).map(link => link.slice(2, -2));
    return { title, tags, links };
  }

  /**
   * Builds a KnowledgeGraph from notes.
   * - Creates a node for each note.
   * - Creates a 'link' edge when note A [[links]] to note B.
   * - Creates a 'tag' edge when two notes share a #tag.
   */
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

  /**
   * Generates and caches semantic embeddings for all notes.
   * - Loads the embedding model lazily.
   * - Uses VectorStore for caching: skips notes whose content hash hasn't changed.
   * - Only embeds notes that are new or have changed content.
   */
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

  /**
   * Performs semantic search across notes using a natural-language query.
   * @throws If embedAll() hasn't been called first.
   */
  async searchSemantic(query: string, notes: Note[], k = 5): Promise<ScoredNote[]> {
    if (!this.embeddingEngine || !this.vectorStore) {
      throw new Error('EmbeddingEngine not loaded. Call embedAll() first.');
    }
    const queryEmb = await this.embeddingEngine.embed(query);
    return this.vectorStore.search(queryEmb, k, notes);
  }

  /** Returns the internal EmbeddingEngine instance, if loaded. */
  getEmbeddingEngine(): EmbeddingEngine | undefined {
    return this.embeddingEngine;
  }

  /** Returns the internal VectorStore instance, if loaded. */
  getVectorStore(): VectorStore | undefined {
    return this.vectorStore;
  }
}